//! Money in and out of unit accounts. Core rule (SPEC 5.1): the unit account's USDC balance is the
//! truth; the estate never trusts a message about an amount, it re-reads the balance.

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

    /// Available → Reserved for `reserve_ttl_ns`. Attach exactly 0.05 NEAR (storage, refunded on burn).
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

    /// The reserver gives the unit back. Any USDC they paid is returned with the 0.05 NEAR deposit.
    pub fn cancel_reservation(&mut self, unit_id: String) -> PromiseOrValue<bool> {
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

    /// Public and idempotent: re-read the unit's USDC balance and credit what changed.
    pub fn sync(&mut self, unit_id: String) -> Promise {
        let unit = self.unit(&unit_id);
        ensure!(
            unit.ready,
            "E_UNIT_NOT_FOUND",
            "unit {} is still being created",
            unit_id
        );
        ensure!(
            unit.in_flight == 0,
            "E_IN_FLIGHT",
            "a transfer out of {} is pending; sync after it lands",
            unit_id
        );
        self.balance_check(&unit)
    }

    #[private]
    pub fn on_balance(&mut self, unit_id: String) -> U128 {
        let Some(mut unit) = self.units.get(&unit_id).cloned() else {
            return U128(0);
        };
        let Some(bytes) = result_bytes(0, 256) else {
            env::log_str("balance read failed");
            return U128(0);
        };
        let balance: U128 = serde_json::from_slice(&bytes).unwrap_or(U128(0));
        if unit.in_flight > 0 {
            env::log_str("transfer out pending; sync skipped");
            return U128(0);
        }
        let now = Self::now();
        let expected =
            (unit.paid + unit.unattributed).saturating_sub(unit.released + unit.refunded_out);
        if balance.0 <= expected {
            if balance.0 < expected {
                env::log_str(&format!(
                    "WARN unit {} balance {} below expected {}",
                    unit_id, balance.0, expected
                ));
            }
            return U128(0);
        }
        let new_money = balance.0 - expected;
        let active_reservation = unit
            .reservation
            .as_ref()
            .map(|r| now < r.expires_at.0)
            .unwrap_or(false);
        if unit.status.has_token() || (unit.status == UnitStatus::Reserved && active_reservation) {
            unit.paid += new_money;
            self.total_paid_in += new_money;
        } else {
            unit.unattributed += new_money;
        }
        emit(
            "deposit_synced",
            json!({ "unit_id": unit_id, "new_money": U128(new_money), "paid": U128(unit.paid), "unattributed": U128(unit.unattributed) }),
        );
        self.maybe_allocate(&mut unit, now);
        // A defaulter who catches up is cured before anyone buys the listing.
        if unit.status == UnitStatus::InDefault && !self.overdue(&unit, now) {
            unit.status = UnitStatus::Allocated;
            unit.listing = None;
        }
        self.save(unit);
        U128(new_money)
    }

    /// Called by a unit's `ft_on_transfer`. Returns the unused amount: everything for a unit nobody
    /// reserved (the token bounces back to the sender), nothing otherwise.
    pub fn on_unit_deposit(
        &mut self,
        unit_id: String,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> U128 {
        let unit = self.unit(&unit_id);
        ensure!(
            env::predecessor_account_id() == unit.account,
            "E_NOT_UNIT",
            "only the unit account can report deposits"
        );
        let now = Self::now();
        let active_reservation = unit
            .reservation
            .as_ref()
            .map(|r| now < r.expires_at.0)
            .unwrap_or(false);
        let accepts =
            unit.status.has_token() || (unit.status == UnitStatus::Reserved && active_reservation);
        if !accepts {
            env::log_str(&format!(
                "deposit of {} from {} bounced: unit {} isn't reserved",
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
        if unit.in_flight == 0 {
            self.balance_check(&unit).detach();
        }
        U128(0)
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
        let amount = self.excess(&unit);
        ensure!(amount > 0, "E_NO_EXCESS", "nothing paid above the price");
        self.send_from_unit(&mut unit, OutKind::Excess, holder, amount)
    }

    /// Anyone: move unattributed USDC off a unit — to the last reserver within `late_claim_ns`
    /// of their reservation ending (a late 1Click delivery), otherwise to `recovery_id`.
    pub fn sweep_unattributed(&mut self, unit_id: String) -> Promise {
        let mut unit = self.unit(&unit_id);
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
        let now = Self::now();
        let to = match &unit.last_reservation {
            Some(r) if now < r.expires_at.0.saturating_add(self.params.late_claim_ns.0) => {
                r.by.clone()
            }
            _ => self.recovery_id.clone(),
        };
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
            OutKind::Sweep => {
                unit.unattributed = unit.unattributed.saturating_sub(a);
                emit(
                    "unattributed_swept",
                    json!({ "unit_id": unit_id, "amount": amount, "to": receiver }),
                );
                self.save(unit);
            }
            OutKind::Refund => {
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
        }
        true
    }

    /// Anyone with an owed balance (a resale payout that failed) pulls it.
    pub fn withdraw_owed(&mut self) -> Promise {
        let who = env::predecessor_account_id();
        let amount = self.owed.get(&who).copied().unwrap_or(0);
        ensure!(amount > 0, "E_BAD_ARGS", "nothing owed to {}", who);
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

impl Estate {
    pub(crate) fn balance_check(&self, unit: &Unit) -> Promise {
        ext_ft::ext(self.usdc_id.clone())
            .with_static_gas(GAS_FT_BALANCE)
            .ft_balance_of(unit.account.clone())
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_ON_BALANCE)
                    .on_balance(unit.id.clone()),
            )
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
                    .with_static_gas(GAS_ON_OUT)
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
    }
}
