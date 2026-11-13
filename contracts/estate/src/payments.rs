//! Money in and out of unit accounts. Deposits are booked only from an accepted `ft_transfer_call` amount or from a
//! deposit report confirmed by two balance reads (see "deposits" below); a raw balance read never credits anything.

use crate::events::emit;
use crate::*;
use near_contract_standards::non_fungible_token::events::{NftBurn, NftMint};
use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::{self, json};
use near_sdk::{assert_one_yocto, env, ext_contract, near, AccountId, Promise, PromiseOrValue};

#[allow(dead_code)]
#[ext_contract(ext_unit)]
pub trait UnitContract {
    fn transfer_out(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
    ) -> Promise;
}

#[allow(dead_code)]
#[ext_contract(ext_ft)]
pub trait FtContract {
    fn ft_balance_of(&self, account_id: AccountId) -> U128;
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

#[near]
impl Estate {
    // ---------- reservations ----------

    /// Available → Reserved for `reserve_ttl_ns`. Attach at least 0.05 NEAR (storage, refunded on burn); anything above
    /// is returned at once.
    #[payable]
    pub fn reserve(&mut self, unit_id: String) {
        let deposit = env::attached_deposit();
        ensure!(
            deposit >= RESERVE_DEPOSIT,
            "E_DEPOSIT",
            "attach {} to reserve (storage, refundable)",
            RESERVE_DEPOSIT
        );
        self.assert_not_frozen();
        let mut unit = self.unit(&unit_id);
        ensure!(
            unit.ready,
            "E_UNIT_NOT_FOUND",
            "unit {} is still being created",
            unit_id
        );
        ensure!(
            unit.status == UnitStatus::Available,
            "E_UNIT_TAKEN",
            "unit {} is not available",
            unit_id
        );
        ensure!(
            unit.in_flight == 0,
            "E_IN_FLIGHT",
            "a transfer out of {} is pending",
            unit_id
        );
        ensure!(
            unit.unattributed <= self.params.dust_threshold.0,
            "E_BALANCE_PENDING",
            "unit {} holds unattributed USDC; call sweep_unattributed first",
            unit_id
        );
        let by = env::predecessor_account_id();
        let now = Self::now();
        // A 1Click payment for the last reservation can land after it lapsed. `report_deposit` credits whoever holds
        // the reservation at that moment, so until `late_claim_ns` after the last reservation ended only that reserver
        // may reserve again; late money meanwhile becomes unattributed and `sweep_unattributed` returns it to them.
        if let Some(last) = &unit.last_reservation {
            let open_at = last
                .expires_at
                .0
                .saturating_add(self.params.late_claim_ns.0);
            ensure!(
                last.by == by || now >= open_at,
                "E_LATE_CLAIM",
                "unit {} was reserved until recently and a late payment may still land; it opens to others at {}",
                unit_id,
                open_at
            );
        }
        if unit.unattributed > 0 {
            // Dust (≤ dust_threshold) is credited to the reserver so it can never block a unit.
            unit.paid += unit.unattributed;
            self.total_paid_in += unit.unattributed;
            unit.unattributed = 0;
        }
        let expires_at = now + self.params.reserve_ttl_ns.0;
        unit.reservation = Some(Reservation {
            by: by.clone(),
            expires_at: U64(expires_at),
        });
        unit.deposit_owner = Some(by.clone());
        unit.status = UnitStatus::Reserved;
        emit(
            "reserved",
            json!({ "unit_id": unit_id, "by": by, "expires_at": U64(expires_at) }),
        );
        self.maybe_allocate(&mut unit, now);
        self.save(unit);
        let extra = deposit.saturating_sub(RESERVE_DEPOSIT);
        if !extra.is_zero() {
            Promise::new(by).transfer(extra).detach();
        }
    }

    /// The reserver gives the unit back. Any USDC they paid is returned with the 0.05 NEAR deposit. Attach 1 yocto.
    #[payable]
    pub fn cancel_reservation(&mut self, unit_id: String) -> PromiseOrValue<bool> {
        assert_one_yocto();
        let unit = self.unit(&unit_id);
        let r = unit
            .reservation
            .clone()
            .unwrap_or_else(|| errors::fail("E_NO_RESERVATION", "unit is not reserved"));
        ensure!(
            r.by == env::predecessor_account_id(),
            "E_NOT_RESERVER",
            "only the reserver can cancel"
        );
        self.end_reservation(unit)
    }

    /// Anyone, after the reservation lapsed: frees the unit so it can't be blocked.
    pub fn expire_reservation(&mut self, unit_id: String) -> PromiseOrValue<bool> {
        let unit = self.unit(&unit_id);
        let r = unit
            .reservation
            .clone()
            .unwrap_or_else(|| errors::fail("E_NO_RESERVATION", "unit is not reserved"));
        ensure!(
            Self::now() >= r.expires_at.0,
            "E_RESERVATION_ACTIVE",
            "reservation is still active"
        );
        self.end_reservation(unit)
    }

    // ---------- deposits ----------
    //
    // How USDC on a unit account becomes `paid` (audit finding 1). USDC credits the receiver *before* it calls
    // `ft_on_transfer` and takes the money back in `ft_resolve_transfer` when the receiver refuses it, so a balance read
    // while an `ft_transfer_call` is pending can see money that is about to leave. Nothing may be credited from a raw
    // balance read alone:
    //
    // * `ft_transfer_call` (wallets): the unit's `ft_on_transfer` asks `on_unit_deposit`, which credits exactly the
    //   `amount` it accepts (returns 0). Accepted money can't be refunded any more; refused money is never credited.
    // * plain `ft_transfer` (1Click / NEAR Intents deliver this way): no callback reaches the estate. Only the deposit
    //   reporter, the estate's `verdict_relayer` (the app server that watches the 1Click status), may credit it with
    //   `report_deposit`, passing the amount 1Click says it delivered. The estate credits
    //   `min(attested, surplus at read 1, surplus at read 2)`, where both reads come from a chained promise
    //   (read → callback → read → callback) and the books (`expected`) must not change in between; otherwise it
    //   credits nothing and fails `E_BALANCE_PENDING` so the reporter retries.
    //   Residual trust: the reporter can credit at most the surplus really observed on the unit account in two reads
    //   in a row, never more than it attests. A dishonest reporter could still book a surplus that isn't a finished
    //   plain transfer — a pending `ft_transfer_call` that spans both reads and is later refunded — so the role must be
    //   an account Plote controls; it can't mint money that never reached the unit.
    // * `sync` (anyone) only checks: it reads the balance and logs how it compares with the books.

    /// Anyone: read the unit's USDC balance and log how it compares with the books. Credits nothing (see above).
    pub fn sync(&mut self, unit_id: String) -> Promise {
        let unit = self.unit(&unit_id);
        ensure!(
            unit.ready,
            "E_UNIT_NOT_FOUND",
            "unit {} is still being created",
            unit_id
        );
        self.read_balance(&unit).then(
            Self::ext(env::current_account_id())
                .with_static_gas(GAS_ON_BALANCE)
                .on_balance(unit_id),
        )
    }

    /// Callback of `sync`. Logs (and emits `balance_checked`) the balance against the books; returns the surplus seen.
    /// Never credits: the read may include a pending `ft_transfer_call` that will be refunded.
    #[private]
    pub fn on_balance(&mut self, unit_id: String) -> U128 {
        let Some(unit) = self.units.get(&unit_id).cloned() else {
            return U128(0);
        };
        let Some(balance) = read_balance_result() else {
            env::log_str("balance read failed");
            return U128(0);
        };
        let expected = Self::expected_balance(&unit);
        let surplus = balance.saturating_sub(expected);
        if surplus > 0 {
            env::log_str(&format!(
                "unit {} holds {} above its books; a plain-transfer deposit is credited when the deposit reporter calls report_deposit, an ft_transfer_call one by on_unit_deposit",
                unit_id, surplus
            ));
        } else if balance < expected {
            env::log_str(&format!(
                "WARN unit {} balance {} below expected {}{}",
                unit_id,
                balance,
                expected,
                if unit.in_flight > 0 {
                    " (a transfer out is pending)"
                } else {
                    ""
                }
            ));
        }
        emit(
            "balance_checked",
            json!({ "unit_id": unit_id, "balance": U128(balance), "expected": U128(expected) }),
        );
        U128(surplus)
    }

    /// The deposit reporter (`verdict_relayer`) credits a plain-transfer deposit 1Click reported delivered to this
    /// unit; `amount` is the delivered USDC in base units. Credits `min(amount, surplus over the books seen in two
    /// chained balance reads)`; returns (via the promise) the amount credited. Fails `E_BALANCE_PENDING` (nothing
    /// credited, report again) if the unit's books changed between the reads, `E_IN_FLIGHT` while a transfer out is
    /// pending. `deferred: true` books money `on_unit_deposit` accepted but deferred (event `deposit_deferred`): the
    /// credit is capped at what is still recorded as deferred on the unit and uses it up, so a retried deferred report
    /// can't book it twice (review N6).
    pub fn report_deposit(&mut self, unit_id: String, amount: U128, deferred: Option<bool>) -> Promise {
        ensure!(
            self.verdict_relayer.as_ref() == Some(&env::predecessor_account_id()),
            "E_NOT_RELAYER",
            "only the deposit reporter (the estate's verdict_relayer) can report a plain-transfer deposit"
        );
        let unit = self.unit(&unit_id);
        ensure!(
            unit.ready,
            "E_UNIT_NOT_FOUND",
            "unit {} is still being created",
            unit_id
        );
        ensure!(amount.0 > 0, "E_BAD_ARGS", "amount must be positive");
        ensure!(
            unit.in_flight == 0,
            "E_IN_FLIGHT",
            "a transfer out of {} is pending; report after it lands",
            unit_id
        );
        let deferred = deferred.unwrap_or(false);
        let amount = if deferred {
            let rec = deferred_of(&unit_id);
            ensure!(
                rec > 0,
                "E_NOTHING_TO_SWEEP",
                "no deferred deposit is waiting on unit {}",
                unit_id
            );
            U128(amount.0.min(rec))
        } else {
            amount
        };
        let expected = U128(Self::expected_balance(&unit));
        self.read_balance(&unit).then(
            Self::ext(env::current_account_id())
                .with_static_gas(GAS_ON_REPORT_FIRST)
                .on_report_first(unit_id, amount, expected, None, Some(deferred)),
        )
    }

    /// First read of `report_deposit`: the books must be what they were when the report started; then read again.
    /// `surplus: true` only comes from callbacks scheduled by an earlier build's `finalize_surplus_booking`; such a
    /// booking is now ignored (it used to book without moving the money; see `on_surplus_second`).
    #[private]
    pub fn on_report_first(
        &mut self,
        unit_id: String,
        amount: U128,
        expected: U128,
        surplus: Option<bool>,
        deferred: Option<bool>,
    ) -> PromiseOrValue<U128> {
        if surplus.unwrap_or(false) {
            env::log_str("a surplus booking scheduled by an earlier build is ignored; request it again");
            return PromiseOrValue::Value(U128(0));
        }
        let unit = self.unchanged_unit(&unit_id, expected.0);
        let first = read_balance_result().unwrap_or_else(|| {
            errors::fail("E_BALANCE_PENDING", "the balance read failed; report again")
        });
        if first <= expected.0 {
            env::log_str(&format!(
                "unit {} holds nothing above its books (balance {}, expected {}); nothing credited",
                unit_id, first, expected.0
            ));
            return PromiseOrValue::Value(U128(0));
        }
        PromiseOrValue::Promise(
            self.read_balance(&unit).then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_ON_REPORT_SECOND)
                    .on_report_second(unit_id, amount, expected, U128(first), None, deferred),
            ),
        )
    }

    /// Second read of `report_deposit`: credits `min(amount, first − expected, second − expected)` (for a deferred
    /// report also at most what is still recorded as deferred, which it uses up). `surplus: true`: see
    /// `on_report_first` (ignored).
    #[private]
    pub fn on_report_second(
        &mut self,
        unit_id: String,
        amount: U128,
        expected: U128,
        first: U128,
        surplus: Option<bool>,
        deferred: Option<bool>,
    ) -> U128 {
        if surplus.unwrap_or(false) {
            env::log_str("a surplus booking scheduled by an earlier build is ignored; request it again");
            return U128(0);
        }
        let mut unit = self.unchanged_unit(&unit_id, expected.0);
        let second = read_balance_result().unwrap_or_else(|| {
            errors::fail("E_BALANCE_PENDING", "the balance read failed; report again")
        });
        let seen = first.0.min(second);
        let mut credit = seen.saturating_sub(expected.0).min(amount.0);
        let deferred = deferred.unwrap_or(false);
        if deferred {
            credit = credit.min(deferred_of(&unit_id));
        }
        if credit == 0 {
            env::log_str(&format!(
                "unit {} holds nothing above its books on the second read; nothing credited",
                unit_id
            ));
            return U128(0);
        }
        if deferred {
            set_deferred(&unit_id, deferred_of(&unit_id) - credit);
        }
        if credit < amount.0 {
            env::log_str(&format!(
                "reported {} but only {} is on unit {} above its books; credited {}",
                amount.0, credit, unit_id, credit
            ));
        }
        let now = Self::now();
        self.credit(&mut unit, credit, now, "report");
        self.save(unit);
        // What the reads saw above the books that this report left unbooked (see `on_unit_deposit`).
        let spare = seen.saturating_sub(expected.0 + credit);
        crate::ext::set(
            &crate::ext::key(crate::ext::P_LAST_REPORT, unit_id.as_bytes()),
            &(now, spare),
        );
        U128(credit)
    }

    /// Called by a unit's `ft_on_transfer`. Credits exactly `amount` and returns 0 when the unit takes payments (a
    /// holder, or an active reservation, and no transfer out pending); otherwise returns `amount`, which USDC refunds.
    pub fn on_unit_deposit(
        &mut self,
        unit_id: String,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> U128 {
        let mut unit = self.unit(&unit_id);
        ensure!(
            env::predecessor_account_id() == unit.account,
            "E_NOT_UNIT",
            "only the unit account can report deposits"
        );
        let now = Self::now();
        if !Self::takes_payments(&unit, now) {
            env::log_str(&format!(
                "deposit of {} from {} bounced: unit {} isn't reserved",
                amount.0, sender_id, unit_id
            ));
            return amount;
        }
        if unit.in_flight > 0 {
            // A reservation refund in flight resets `paid` when it lands; don't take money meanwhile.
            env::log_str(&format!(
                "deposit of {} from {} bounced: a transfer out of {} is pending; pay again after it lands",
                amount.0, sender_id, unit_id
            ));
            return amount;
        }
        if !msg.is_empty() {
            env::log_str(&format!(
                "chip-in note from {}: {}",
                sender_id,
                msg.chars().take(200).collect::<String>()
            ));
        }
        // Finding 14: USDC credited the unit before this receipt ran, so a `report_deposit` that finished in between may
        // already have booked this money from its balance reads (e.g. a retried report). Booking it again would put
        // the books above the balance. A report remembers the surplus its reads saw and left unbooked (`spare`); within
        // `REPORT_SETTLE_NS` of it, a deposit larger than `spare` is accepted (the money stays on the unit) but not
        // booked: it is a surplus the deposit reporter books with `report_deposit` (two balance reads, never twice).
        // Event `deposit_deferred`. A deposit within `spare` is booked and uses that much of it up.
        let lr_key = crate::ext::key(crate::ext::P_LAST_REPORT, unit_id.as_bytes());
        let last_report: Option<(u64, u128)> = crate::ext::get(&lr_key);
        if let Some((t, spare)) =
            last_report.filter(|(t, _)| now < t.saturating_add(REPORT_SETTLE_NS))
        {
            if amount.0 <= spare {
                crate::ext::set(&lr_key, &(t, spare - amount.0));
                self.credit(&mut unit, amount.0, now, "ft_transfer_call");
                self.save(unit);
                return U128(0);
            }
            env::log_str(&format!(
                "deposit of {} from {} to {} accepted but not booked: a report_deposit just credited this unit; report it",
                amount.0, sender_id, unit_id
            ));
            emit(
                "deposit_deferred",
                json!({ "unit_id": unit_id, "sender_id": sender_id, "amount": amount }),
            );
            set_deferred(&unit_id, deferred_of(&unit_id).saturating_add(amount.0));
            return U128(0);
        }
        self.credit(&mut unit, amount.0, now, "ft_transfer_call");
        self.save(unit);
        U128(0)
    }

    // ---------- unbooked surplus (finding 7, review N1) ----------
    //
    // USDC that reached an EMPTY unit by plain transfer and was never reported (a 1Click delivery for a reservation that
    // ended, a mistaken transfer) is on the unit but in no book, so nothing could ever move it. The developer or the
    // recovery account can move it out in two steps: `request_surplus_booking` reads the balance and records the surplus
    // seen; `finalize_surplus_booking`, at least `SURPLUS_DELAY_NS` (7 days) later, reads twice more like `report_deposit`
    // and books `min(recorded, first − expected, second − expected)` as `unattributed` and **in the same flow** transfers
    // exactly that to the sweep recipient (the last reserver within `late_claim_ns`, else `recovery_id`); a failed
    // transfer undoes the booking.
    //
    // Both steps (and both callbacks) need an empty unit: no token, no reservation, nothing booked as escrow
    // (`paid − released − refunded_out == 0`), nothing in flight, the estate not frozen. A balance read can be inflated
    // for a few blocks (an `ft_transfer_call` whose `ft_on_transfer` fails is refunded by `ft_resolve_transfer` later), so
    // a "surplus" might be transient. On an empty unit that can only move the inflater's own transient money (USDC then
    // can't refund all of it to them); holder or reserver escrow is never reachable.

    /// Developer or `recovery_id`: record an empty unit's current surplus over its books (one balance read). Starts the
    /// 7-day delay; a new request replaces the old one. Returns (via the promise) the surplus recorded.
    pub fn request_surplus_booking(&mut self, unit_id: String) -> Promise {
        self.assert_surplus_role();
        self.assert_not_frozen();
        let unit = self.unit(&unit_id);
        ensure!(
            unit.ready,
            "E_UNIT_NOT_FOUND",
            "unit {} is still being created",
            unit_id
        );
        self.assert_surplus_unit(&unit);
        let expected = U128(Self::expected_balance(&unit));
        self.read_balance(&unit).then(
            Self::ext(env::current_account_id())
                .with_static_gas(GAS_ON_BALANCE)
                .on_surplus_request(unit_id, expected),
        )
    }

    #[private]
    pub fn on_surplus_request(&mut self, unit_id: String, expected: U128) -> U128 {
        let unit = self.unchanged_unit(&unit_id, expected.0);
        self.assert_surplus_unit(&unit);
        let balance = read_balance_result().unwrap_or_else(|| {
            errors::fail(
                "E_BALANCE_PENDING",
                "the balance read failed; request again",
            )
        });
        let amount = balance.saturating_sub(expected.0);
        ensure!(
            amount > 0,
            "E_NOTHING_TO_SWEEP",
            "unit {} holds nothing above its books",
            unit_id
        );
        let at = Self::now();
        crate::ext::set(
            &crate::ext::key(crate::ext::P_SURPLUS, unit_id.as_bytes()),
            &crate::ext::SurplusRequest { at, amount },
        );
        emit(
            "surplus_requested",
            json!({ "unit_id": unit_id, "amount": U128(amount), "ready_at": U64(at.saturating_add(SURPLUS_DELAY_NS)) }),
        );
        U128(amount)
    }

    /// Developer or `recovery_id`, at least 7 days after `request_surplus_booking`, on a still-empty unit: book the
    /// surplus still seen (two reads, capped at what was recorded) and transfer it out at once. The request is used up by
    /// this call whatever the outcome. `E_TIMELOCK` before then, `E_BAD_ARGS` without a request. Attach ≥ 150 Tgas.
    pub fn finalize_surplus_booking(&mut self, unit_id: String) -> Promise {
        self.assert_surplus_role();
        self.assert_not_frozen();
        let unit = self.unit(&unit_id);
        let k = crate::ext::key(crate::ext::P_SURPLUS, unit_id.as_bytes());
        let req: crate::ext::SurplusRequest = crate::ext::get(&k)
            .unwrap_or_else(|| errors::fail("E_BAD_ARGS", "no surplus booking was requested"));
        let ready_at = req.at.saturating_add(SURPLUS_DELAY_NS);
        ensure!(
            Self::now() >= ready_at,
            "E_TIMELOCK",
            "the surplus of {} can be booked from {}",
            unit_id,
            ready_at
        );
        self.assert_surplus_unit(&unit);
        // Used up now: a finalize that books nothing (or fails in a callback) needs a new request and a new delay.
        crate::ext::del(&k);
        let expected = U128(Self::expected_balance(&unit));
        self.read_balance(&unit).then(
            Self::ext(env::current_account_id())
                .with_static_gas(GAS_ON_SURPLUS_FIRST)
                .on_surplus_first(unit_id, U128(req.amount), expected),
        )
    }

    /// First read of `finalize_surplus_booking`. Books nothing (returns 0) if the unit is no longer empty, its books
    /// changed, the estate froze, or it holds nothing above its books; otherwise reads again.
    #[private]
    pub fn on_surplus_first(
        &mut self,
        unit_id: String,
        amount: U128,
        expected: U128,
    ) -> PromiseOrValue<U128> {
        let Some(unit) = self.surplus_unit_unchanged(&unit_id, expected.0) else {
            return PromiseOrValue::Value(U128(0));
        };
        let first = read_balance_result().unwrap_or(0);
        if first <= expected.0 {
            env::log_str(&format!(
                "unit {} holds nothing above its books; nothing booked",
                unit_id
            ));
            return PromiseOrValue::Value(U128(0));
        }
        PromiseOrValue::Promise(
            self.read_balance(&unit).then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_ON_SURPLUS_SECOND)
                    .on_surplus_second(unit_id, amount, expected, U128(first)),
            ),
        )
    }

    /// Second read: books `min(amount, first − expected, second − expected)` as `unattributed` and starts its transfer to
    /// the sweep recipient in the same receipt (`OutKind::SurplusSweep`; a failed transfer unbooks it).
    #[private]
    pub fn on_surplus_second(
        &mut self,
        unit_id: String,
        amount: U128,
        expected: U128,
        first: U128,
    ) -> U128 {
        let Some(mut unit) = self.surplus_unit_unchanged(&unit_id, expected.0) else {
            return U128(0);
        };
        let second = read_balance_result().unwrap_or(0);
        let credit = first
            .0
            .min(second)
            .saturating_sub(expected.0)
            .min(amount.0);
        if credit == 0 {
            env::log_str(&format!(
                "unit {} holds nothing above its books; nothing booked",
                unit_id
            ));
            return U128(0);
        }
        unit.unattributed += credit;
        emit(
            "surplus_booked",
            json!({ "unit_id": unit_id, "amount": U128(credit), "unattributed": U128(unit.unattributed) }),
        );
        let to = self.sweep_recipient(&unit, Self::now());
        self.send_from_unit(&mut unit, OutKind::SurplusSweep, to, credit)
            .detach();
        U128(credit)
    }

    /// View: a pending surplus booking request, if any: `{ at, amount }` (`at` + 7 days = when it can be finalized).
    pub fn get_surplus_request(&self, unit_id: String) -> Option<SurplusRequestView> {
        crate::ext::get::<crate::ext::SurplusRequest>(&crate::ext::key(
            crate::ext::P_SURPLUS,
            unit_id.as_bytes(),
        ))
        .map(|r| SurplusRequestView {
            at: U64(r.at),
            amount: U128(r.amount),
            ready_at: U64(r.at.saturating_add(SURPLUS_DELAY_NS)),
        })
    }

    // ---------- money out ----------

    /// Holder pulls back everything not released, once refunds are open. Burns the NFT when complete.
    #[payable]
    pub fn refund(&mut self, unit_id: String) -> Promise {
        assert_one_yocto();
        let unit = self.unit(&unit_id);
        let holder = self.assert_holder(&unit);
        ensure!(
            unit.status != UnitStatus::HandedOver,
            "E_HANDOVER",
            "unit was handed over"
        );
        ensure!(
            self.refunds_open(Self::now()),
            "E_NO_REFUND_YET",
            "refunds open after a missed deadline + grace or a freeze vote"
        );
        ensure!(
            unit.in_flight == 0,
            "E_IN_FLIGHT",
            "a transfer out of {} is pending",
            unit_id
        );
        self.assert_no_nft_pending(&unit_id);
        let amount = self.refundable(&unit);
        ensure!(amount > 0, "E_NOTHING_TO_REFUND", "nothing left to refund");
        // A lender with a lien is repaid first, up to its cap.
        let (receiver, amount) = match &unit.lien {
            Some(l) if l.cap.0 > 0 => (l.lender.clone(), amount.min(l.cap.0)),
            _ => (holder, amount),
        };
        let mut unit = unit;
        self.send_from_unit(&mut unit, OutKind::Refund, receiver, amount)
    }

    /// Holder withdraws whatever was paid above the price. Never releasable to the developer.
    #[payable]
    pub fn withdraw_excess(&mut self, unit_id: String) -> Promise {
        assert_one_yocto();
        let mut unit = self.unit(&unit_id);
        let holder = self.assert_holder(&unit);
        ensure!(
            unit.in_flight == 0,
            "E_IN_FLIGHT",
            "a transfer out of {} is pending",
            unit_id
        );
        self.assert_no_nft_pending(&unit_id);
        // Never more than is still in the unit for the holder (a lender-first refund may have taken part of it).
        let amount = self.excess(&unit).min(self.refundable(&unit));
        ensure!(amount > 0, "E_NO_EXCESS", "nothing paid above the price");
        self.send_from_unit(&mut unit, OutKind::Excess, holder, amount)
    }

    /// Anyone: move unattributed USDC off an Available unit — to the last reserver within `late_claim_ns`
    /// of their reservation ending (a late 1Click delivery), otherwise to `recovery_id`. Refused (`E_UNIT_TAKEN`) while
    /// the unit is reserved or held (review N1): stray money there waits until the unit is empty again (end a lapsed
    /// reservation with `expire_reservation` first), so a sweep can never reach holder or reserver escrow.
    pub fn sweep_unattributed(&mut self, unit_id: String) -> Promise {
        let mut unit = self.unit(&unit_id);
        ensure!(
            unit.status == UnitStatus::Available,
            "E_UNIT_TAKEN",
            "unit {} is {:?}; unattributed money is swept only from an Available unit",
            unit_id,
            unit.status
        );
        ensure!(
            unit.unattributed > self.params.dust_threshold.0,
            "E_NOTHING_TO_SWEEP",
            "nothing above the dust threshold to sweep"
        );
        ensure!(
            unit.in_flight == 0,
            "E_IN_FLIGHT",
            "a transfer out of {} is pending",
            unit_id
        );
        let to = self.sweep_recipient(&unit, Self::now());
        let amount = unit.unattributed;
        self.send_from_unit(&mut unit, OutKind::Sweep, to, amount)
    }

    /// Anyone: move each unit's released share to the payout account. Returns how many transfers started.
    pub fn claim_release(&mut self, unit_ids: Vec<String>) -> u32 {
        self.assert_not_frozen();
        ensure!(
            unit_ids.len() <= MAX_RELEASE_PER_CALL,
            "E_TOO_MANY",
            "at most {} units per call",
            MAX_RELEASE_PER_CALL
        );
        let now = Self::now();
        // While holders can take their money back, none of it goes to the developer (audit finding 5): a milestone
        // signed after its deadline + grace doesn't close refunds, so it mustn't unlock releases either.
        ensure!(
            !self.refunds_open(now),
            "E_REFUNDS_OPEN",
            "refunds are open (a missed deadline or a freeze vote); nothing is released meanwhile"
        );
        let payout = self.payout_account();
        let mut started = 0;
        for id in unit_ids {
            let Some(mut unit) = self.units.get(&id).cloned() else {
                continue;
            };
            if unit.in_flight > 0 {
                continue;
            }
            let due = self.releasable(&unit, now);
            if due == 0 {
                continue;
            }
            self.send_from_unit(&mut unit, OutKind::Release, payout.clone(), due)
                .detach();
            started += 1;
        }
        started
    }

    /// Callback for every transfer out of a unit account.
    #[private]
    pub fn on_out(
        &mut self,
        unit_id: String,
        kind: OutKind,
        receiver: AccountId,
        amount: U128,
    ) -> bool {
        let Some(mut unit) = self.units.get(&unit_id).cloned() else {
            return false;
        };
        unit.in_flight = 0;
        let ok = result_ok(0);
        if !ok {
            env::log_str(&format!(
                "transfer of {} from {} to {} failed; nothing moved",
                amount.0, unit_id, receiver
            ));
            if kind == OutKind::SurplusSweep {
                // Nothing moved: undo the booking, so a surplus that was only transient isn't left in the books.
                unit.unattributed = unit.unattributed.saturating_sub(amount.0);
            }
            if kind == OutKind::ReservationRefund && unit.status == UnitStatus::Reserved {
                // The reserver can't receive it (e.g. not registered on USDC). Don't keep the unit hostage: move the
                // money to the estate's own account, credit it to `owed` for the reserver (`withdraw_owed`) and end
                // the reservation when that lands (audit finding 6).
                let estate = env::current_account_id();
                self.send_from_unit(&mut unit, OutKind::OwedEscrow, estate, amount.0)
                    .detach();
                return false;
            }
            self.save(unit);
            return false;
        }
        let a = amount.0;
        match kind {
            OutKind::Release => {
                unit.released += a;
                self.total_released += a;
                emit(
                    "released",
                    json!({ "unit_id": unit_id, "amount": amount, "to": receiver }),
                );
                self.save(unit);
            }
            OutKind::Excess => {
                unit.refunded_out += a;
                unit.excess_out += a;
                emit(
                    "excess_withdrawn",
                    json!({ "unit_id": unit_id, "amount": amount, "to": receiver }),
                );
                self.save(unit);
            }
            OutKind::Sweep | OutKind::SurplusSweep => {
                unit.unattributed = unit.unattributed.saturating_sub(a);
                emit(
                    "unattributed_swept",
                    json!({ "unit_id": unit_id, "amount": amount, "to": receiver }),
                );
                self.save(unit);
            }
            OutKind::Refund => {
                let before = crate::votes::vote_weight(&unit);
                unit.refunded_out += a;
                self.total_refunded += a;
                if let Some(l) = unit.lien.as_mut() {
                    if l.lender == receiver {
                        l.cap = U128(l.cap.0.saturating_sub(a));
                        if l.cap.0 == 0 {
                            unit.lien = None;
                        }
                    }
                }
                emit(
                    "refunded",
                    json!({ "unit_id": unit_id, "amount": amount, "to": receiver }),
                );
                if self.refundable(&unit) == 0 {
                    self.burn_and_reset(&mut unit);
                    self.stats.units_refunded += 1;
                } else {
                    // A partial (lien-first) refund: the token lives on with less at stake (finding 2a/5).
                    self.note_weight_change(&unit, before, Self::now());
                }
                self.save(unit);
            }
            OutKind::ReservationRefund => {
                let by = unit
                    .reservation
                    .as_ref()
                    .map(|r| r.by.clone())
                    .unwrap_or(receiver.clone());
                unit.paid = unit.paid.saturating_sub(a);
                self.total_paid_in = self.total_paid_in.saturating_sub(a);
                emit(
                    "reservation_ended",
                    json!({ "unit_id": unit_id, "by": by, "refunded": amount }),
                );
                self.finish_reservation(&mut unit);
                self.save(unit);
            }
            OutKind::OwedEscrow => {
                let by = unit
                    .reservation
                    .as_ref()
                    .map(|r| r.by.clone())
                    .or_else(|| unit.deposit_owner.clone());
                unit.paid = unit.paid.saturating_sub(a);
                self.total_paid_in = self.total_paid_in.saturating_sub(a);
                match by {
                    Some(by) => {
                        let prev = self.owed.get(&by).copied().unwrap_or(0);
                        self.owed.insert(by.clone(), prev + a);
                        emit(
                            "reservation_ended",
                            json!({ "unit_id": unit_id, "by": by, "refunded": amount, "owed": true }),
                        );
                    }
                    None => {
                        // Unreachable (only a Reserved unit schedules this); keep the money claimable anyway.
                        let prev = self.owed.get(&self.recovery_id).copied().unwrap_or(0);
                        self.owed.insert(self.recovery_id.clone(), prev + a);
                    }
                }
                if unit.status == UnitStatus::Reserved {
                    self.finish_reservation(&mut unit);
                }
                self.save(unit);
            }
        }
        true
    }

    /// Anyone with an owed balance (a resale payout that failed) pulls it. `E_NOTHING_OWED` if there is none.
    pub fn withdraw_owed(&mut self) -> Promise {
        let who = env::predecessor_account_id();
        let amount = self.owed.get(&who).copied().unwrap_or(0);
        ensure!(amount > 0, "E_NOTHING_OWED", "nothing owed to {}", who);
        self.owed.remove(&who);
        self.pay_from_estate(who, amount, "owed")
    }

    #[private]
    pub fn on_estate_payout(&mut self, receiver: AccountId, amount: U128) -> bool {
        if result_ok(0) {
            return true;
        }
        let prev = self.owed.get(&receiver).copied().unwrap_or(0);
        self.owed.insert(receiver.clone(), prev + amount.0);
        env::log_str(&format!(
            "payout of {} to {} failed; recorded as owed",
            amount.0, receiver
        ));
        false
    }
}

#[near(serializers = [json])]
pub struct SurplusRequestView {
    pub at: U64,
    pub amount: U128,
    pub ready_at: U64,
}

/// USDC `on_unit_deposit` accepted on this unit but deferred (not booked) that no deferred report has booked yet.
fn deferred_of(unit_id: &str) -> u128 {
    crate::ext::get(&crate::ext::key(crate::ext::P_DEFERRED, unit_id.as_bytes())).unwrap_or(0)
}

fn set_deferred(unit_id: &str, v: u128) {
    let k = crate::ext::key(crate::ext::P_DEFERRED, unit_id.as_bytes());
    if v == 0 {
        crate::ext::del(&k);
    } else {
        crate::ext::set(&k, &v);
    }
}

impl Estate {
    /// A unit the surplus booking may touch: no token, no reservation, no escrow booked, nothing in flight.
    fn surplus_unit_empty(unit: &Unit) -> bool {
        unit.status == UnitStatus::Available
            && unit.reservation.is_none()
            && unit.holder.is_none()
            && unit.in_flight == 0
            && unit.paid.saturating_sub(unit.released + unit.refunded_out) == 0
    }

    fn assert_surplus_unit(&self, unit: &Unit) {
        ensure!(
            unit.in_flight == 0,
            "E_IN_FLIGHT",
            "a transfer out of {} is pending",
            unit.id
        );
        ensure!(
            Self::surplus_unit_empty(unit),
            "E_UNIT_TAKEN",
            "unit {} is reserved, held or holds escrow; a surplus is booked only on an empty unit",
            unit.id
        );
    }

    /// The unit for a surplus callback if it is still empty, the estate unfrozen and its books unchanged; else `None`.
    fn surplus_unit_unchanged(&self, unit_id: &str, expected: u128) -> Option<Unit> {
        let unit = self.units.get(unit_id).cloned()?;
        if self.frozen.is_some()
            || !Self::surplus_unit_empty(&unit)
            || Self::expected_balance(&unit) != expected
        {
            env::log_str(&format!(
                "unit {} changed (or the estate froze) while its surplus was being read; nothing booked",
                unit_id
            ));
            return None;
        }
        Some(unit)
    }

    /// Who swept money goes to: the last reserver within `late_claim_ns` of their reservation ending (a late 1Click
    /// delivery), otherwise `recovery_id`.
    fn sweep_recipient(&self, unit: &Unit, now: u64) -> AccountId {
        let latest = match &unit.reservation {
            Some(r) if now >= r.expires_at.0 => Some(r),
            _ => unit.last_reservation.as_ref(),
        };
        match latest {
            Some(r) if now < r.expires_at.0.saturating_add(self.params.late_claim_ns.0) => {
                r.by.clone()
            }
            _ => self.recovery_id.clone(),
        }
    }

    fn assert_surplus_role(&self) {
        let caller = env::predecessor_account_id();
        ensure!(
            caller == self.developer_id || caller == self.recovery_id,
            "E_NOT_DEVELOPER",
            "only the developer or the recovery account can book an unbooked surplus"
        );
    }

    pub(crate) fn read_balance(&self, unit: &Unit) -> Promise {
        ext_ft::ext(self.usdc_id.clone())
            .with_static_gas(GAS_FT_BALANCE)
            .ft_balance_of(unit.account.clone())
    }

    /// The unit as `report_deposit` left it: same books, nothing in flight. Otherwise a transfer out (or an
    /// `ft_transfer_call` credit) landed between the reads, and the balance can't be compared with `expected`.
    fn unchanged_unit(&self, unit_id: &str, expected: u128) -> Unit {
        let unit = self.unit(unit_id);
        ensure!(
            unit.in_flight == 0 && Self::expected_balance(&unit) == expected,
            "E_BALANCE_PENDING",
            "unit {} changed while its balance was being read; nothing credited, report again",
            unit_id
        );
        unit
    }

    /// Does the unit take payments right now: a token holder, or an active reservation?
    pub(crate) fn takes_payments(unit: &Unit, now: u64) -> bool {
        let active_reservation = unit
            .reservation
            .as_ref()
            .map(|r| now < r.expires_at.0)
            .unwrap_or(false);
        unit.status.has_token() || (unit.status == UnitStatus::Reserved && active_reservation)
    }

    /// Book `amount` of new money that is known to be on the unit account: to `paid` if the unit takes payments,
    /// else to `unattributed` (sweepable). Then allocate the token or cure a default. (Open proposals' electorates are
    /// fixed at creation: growing them with top-ups helped a flash-weight capture; see votes.rs.)
    pub(crate) fn credit(&mut self, unit: &mut Unit, amount: u128, now: u64, source: &str) {
        let before = unit
            .status
            .has_token()
            .then(|| crate::votes::vote_weight(unit));
        if Self::takes_payments(unit, now) {
            unit.paid += amount;
            self.total_paid_in += amount;
        } else {
            unit.unattributed += amount;
        }
        emit(
            "deposit_synced",
            json!({ "unit_id": unit.id, "new_money": U128(amount), "paid": U128(unit.paid), "unattributed": U128(unit.unattributed), "source": source }),
        );
        self.maybe_allocate(unit, now);
        // A defaulter who catches up is cured before anyone buys the listing.
        if unit.status == UnitStatus::InDefault && !self.overdue(unit, now) {
            unit.status = UnitStatus::Allocated;
            unit.listing = None;
        }
        // A top-up while proposals are open is remembered, so it can't add weight to them (finding 2b).
        if let Some(b) = before {
            self.note_weight_change(unit, b, now);
        }
    }

    pub(crate) fn send_from_unit(
        &mut self,
        unit: &mut Unit,
        kind: OutKind,
        receiver: AccountId,
        amount: u128,
    ) -> Promise {
        unit.in_flight = amount;
        self.save(unit.clone());
        ext_unit::ext(unit.account.clone())
            .with_static_gas(GAS_TRANSFER_OUT)
            .transfer_out(
                receiver.clone(),
                U128(amount),
                Some(format!("plote:{:?}:{}", kind, unit.id).to_lowercase()),
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(match kind {
                        OutKind::Refund => GAS_ON_OUT_REFUND,
                        OutKind::ReservationRefund => GAS_ON_OUT_RESERVATION,
                        _ => GAS_ON_OUT,
                    })
                    .on_out(unit.id.clone(), kind, receiver, U128(amount)),
            )
    }

    pub(crate) fn pay_from_estate(&self, receiver: AccountId, amount: u128, memo: &str) -> Promise {
        ext_ft::ext(self.usdc_id.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(
                receiver.clone(),
                U128(amount),
                Some(format!("plote:{}", memo)),
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_ON_PAYOUT)
                    .on_estate_payout(receiver, U128(amount)),
            )
    }

    fn end_reservation(&mut self, mut unit: Unit) -> PromiseOrValue<bool> {
        ensure!(
            unit.status == UnitStatus::Reserved,
            "E_NO_RESERVATION",
            "unit is not reserved"
        );
        ensure!(
            unit.in_flight == 0,
            "E_IN_FLIGHT",
            "a transfer out of {} is pending",
            unit.id
        );
        let by = unit.reservation.as_ref().map(|r| r.by.clone()).unwrap();
        let to_return = unit.paid.saturating_sub(unit.refunded_out);
        if to_return > 0 {
            return PromiseOrValue::Promise(self.send_from_unit(
                &mut unit,
                OutKind::ReservationRefund,
                by,
                to_return,
            ));
        }
        emit(
            "reservation_ended",
            json!({ "unit_id": unit.id, "by": by, "refunded": U128(0) }),
        );
        self.finish_reservation(&mut unit);
        self.save(unit);
        PromiseOrValue::Value(true)
    }

    /// Reserved → Available: remember who reserved (for late claims) and return their storage deposit.
    fn finish_reservation(&mut self, unit: &mut Unit) {
        let now = Self::now();
        if let Some(r) = unit.reservation.take() {
            let ended = now.min(r.expires_at.0);
            unit.last_reservation = Some(Reservation {
                by: r.by,
                expires_at: U64(ended),
            });
        }
        unit.status = UnitStatus::Available;
        unit.paid = 0;
        unit.released = 0;
        unit.refunded_out = 0;
        unit.excess_out = 0;
        set_deferred(&unit.id, 0);
        if let Some(owner) = unit.deposit_owner.take() {
            Promise::new(owner).transfer(RESERVE_DEPOSIT).detach();
        }
    }

    pub(crate) fn maybe_allocate(&mut self, unit: &mut Unit, now: u64) {
        if unit.status != UnitStatus::Reserved {
            return;
        }
        let Some(r) = unit.reservation.clone() else {
            return;
        };
        if now >= r.expires_at.0 {
            return;
        }
        let threshold = unit
            .price
            .saturating_mul(self.params.min_initial_bps as u128)
            / BPS;
        if unit.paid < threshold.max(1) {
            return;
        }
        unit.holder = Some(r.by.clone());
        unit.status = UnitStatus::Allocated;
        unit.allocated_at = Some(now);
        // Plan dates are absolute. A unit allocated after some instalments fell due (a late first buyer, or a unit
        // re-sold after a full refund) would be in default at once: every unmet instalment already due moves to now, so
        // the new holder gets a full `default_grace_ns` (as for a default sale). Met and future ones keep their dates.
        for inst in unit.plan.iter_mut() {
            if inst.due_at.0 < now && unit.paid < inst.cumulative.0 {
                inst.due_at = U64(now);
            }
        }
        unit.reservation = None;
        unit.last_reservation = None;
        self.add_token(&r.by, &unit.id);
        NftMint {
            owner_id: &r.by,
            token_ids: &[unit.id.as_str()],
            memo: None,
        }
        .emit();
        emit("allocated", json!({ "unit_id": unit.id, "holder": r.by }));
        self.stats.units_sold += 1;
        self.first_sale_done = true;
    }

    /// Token burned (complete refund): the unit starts over as Available.
    pub(crate) fn burn_and_reset(&mut self, unit: &mut Unit) {
        if let Some(holder) = unit.holder.take() {
            self.remove_token(&holder, &unit.id);
            NftBurn {
                owner_id: &holder,
                token_ids: &[unit.id.as_str()],
                authorized_id: None,
                memo: Some("refund"),
            }
            .emit();
        }
        if let Some(owner) = unit.deposit_owner.take() {
            Promise::new(owner).transfer(RESERVE_DEPOSIT).detach();
        }
        unit.status = UnitStatus::Available;
        unit.allocated_at = None;
        unit.paid = 0;
        unit.released = 0;
        unit.refunded_out = 0;
        unit.excess_out = 0;
        unit.listing = None;
        unit.beneficiary = None;
        unit.guardians.clear();
        unit.recovery = None;
        unit.lien = None;
        unit.approvals.clear();
        self.clear_weight_history(&unit.id);
        self.clear_holder_history(&unit.id);
        crate::ext::del(&crate::ext::key(
            crate::ext::P_PENDING_LIEN,
            unit.id.as_bytes(),
        ));
        set_deferred(&unit.id, 0);
    }
}

/// The `U128` an `ft_balance_of` returned as promise result 0, if the read succeeded.
fn read_balance_result() -> Option<u128> {
    let bytes = result_bytes(0, 256)?;
    serde_json::from_slice::<U128>(&bytes).ok().map(|b| b.0)
}
