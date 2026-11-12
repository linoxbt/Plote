//! Fair exit: voluntary listings, defaults that resell instead of forfeit, and atomic purchase via
//! `usdc.ft_transfer_call(estate, ask, {"buy": unit_id})`. The escrow on the unit account never moves.

use crate::events::emit;
use crate::*;
use near_sdk::json_types::{U128, U64};
use near_sdk::serde::Deserialize;
use near_sdk::serde_json::{self, json};
use near_sdk::{assert_one_yocto, env, near, AccountId, PromiseOrValue};

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct BuyMsg {
    buy: String,
}

#[near]
impl Estate {
    /// Holder lists the unit at `ask`. Attach 1 yocto (a full-access key: a listing lets anyone take the token).
    #[payable]
    pub fn list_for_sale(&mut self, unit_id: String, ask: U128) {
        assert_one_yocto();
        self.assert_no_nft_pending(&unit_id);
        let mut unit = self.unit(&unit_id);
        self.assert_holder(&unit);
        ensure!(
            matches!(unit.status, UnitStatus::Allocated | UnitStatus::HandedOver),
            "E_LISTING",
            "unit can't be listed in status {:?}",
            unit.status
        );
        ensure!(unit.lien.is_none(), "E_LIEN", "a lien blocks listing");
        ensure!(
            unit.listing
                .as_ref()
                .map(|l| l.kind != ListingKind::Default)
                .unwrap_or(true),
            "E_LISTING",
            "a default listing is open"
        );
        ensure!(ask.0 > 0, "E_BAD_ARGS", "ask must be positive");
        unit.listing = Some(Listing {
            ask,
            kind: ListingKind::Voluntary,
            since: U64(Self::now()),
        });
        emit(
            "listed",
            json!({ "unit_id": unit_id, "ask": ask, "kind": "Voluntary" }),
        );
        self.save(unit);
    }

    /// Holder withdraws a voluntary listing. Attach 1 yocto.
    #[payable]
    pub fn cancel_listing(&mut self, unit_id: String) {
        assert_one_yocto();
        let mut unit = self.unit(&unit_id);
        self.assert_holder(&unit);
        ensure!(
            unit.listing
                .as_ref()
                .map(|l| l.kind == ListingKind::Voluntary)
                .unwrap_or(false),
            "E_LISTING",
            "no voluntary listing to cancel"
        );
        unit.listing = None;
        self.save(unit);
    }

    /// Anyone: an instalment is overdue past `default_grace_ns` → the unit is listed at what the holder paid and didn't
    /// take back. The ask tracks later payments and refunds: a purchase pays `paid − refunded_out` at that moment.
    pub fn declare_default(&mut self, unit_id: String) {
        let mut unit = self.unit(&unit_id);
        ensure!(
            unit.status == UnitStatus::Allocated,
            "E_NOT_DUE",
            "only an Allocated unit can default"
        );
        let now = Self::now();
        ensure!(
            self.overdue(&unit, now),
            "E_NOT_DUE",
            "no instalment is overdue past the grace period"
        );
        unit.status = UnitStatus::InDefault;
        let ask = U128(Self::default_ask(&unit));
        unit.listing = Some(Listing {
            ask,
            kind: ListingKind::Default,
            since: U64(now),
        });
        emit("defaulted", json!({ "unit_id": unit_id, "ask": ask }));
        emit(
            "listed",
            json!({ "unit_id": unit_id, "ask": ask, "kind": "Default" }),
        );
        self.save(unit);
    }

    /// NEP-141 receiver for purchases. Any failure returns the full amount to the buyer.
    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        if env::predecessor_account_id() != self.usdc_id {
            env::log_str("E_BAD_TOKEN: only the estate's USDC is accepted");
            return PromiseOrValue::Value(amount);
        }
        match self.try_buy(&sender_id, amount.0, &msg) {
            Ok(unused) => PromiseOrValue::Value(U128(unused)),
            Err(e) => {
                env::log_str(&format!("purchase rejected: {}", e));
                PromiseOrValue::Value(amount)
            }
        }
    }
}

impl Estate {
    pub(crate) fn overdue(&self, unit: &Unit, now: u64) -> bool {
        unit.plan.iter().any(|i| {
            now > i.due_at.0.saturating_add(self.params.default_grace_ns.0)
                && unit.paid < i.cumulative.0
        })
    }

    /// What a buyer pays for a listing now: a voluntary listing's ask, or for a default listing what the holder has
    /// paid at this moment (payments made after `declare_default` raise it; audit finding 12).
    pub(crate) fn listing_ask(unit: &Unit, listing: &Listing) -> u128 {
        match listing.kind {
            ListingKind::Voluntary => listing.ask.0,
            ListingKind::Default => Self::default_ask(unit),
        }
    }

    /// A default listing's price: what the holder has put in and not taken back (`paid − refunded_out`, i.e. their
    /// equity in the unit, incl. what was released to the developer for proven work), at least 1.
    pub(crate) fn default_ask(unit: &Unit) -> u128 {
        unit.paid.saturating_sub(unit.refunded_out).max(1)
    }

    fn try_buy(&mut self, buyer: &AccountId, amount: u128, msg: &str) -> Result<u128, String> {
        let m: BuyMsg = serde_json::from_str(msg)
            .map_err(|_| "E_BAD_ARGS: msg must be {\"buy\":\"<unit_id>\"}".to_string())?;
        let mut unit = self
            .units
            .get(&m.buy)
            .cloned()
            .ok_or("E_UNIT_NOT_FOUND: no such unit")?;
        let listing = unit.listing.clone().ok_or("E_LISTING: unit isn't listed")?;
        if self.frozen.is_some() {
            return Err("E_FROZEN: estate is frozen".into());
        }
        // A lien set before the default doesn't block the default sale (finding 6): the lender is paid first from the
        // proceeds (below). A voluntary listing can't coexist with a lien (set_lien/accept_lien clear it).
        if unit.lien.is_some() && listing.kind != ListingKind::Default {
            return Err("E_LIEN: a lien blocks the sale".into());
        }
        if unit.in_flight > 0 {
            return Err("E_IN_FLIGHT: a transfer out is pending".into());
        }
        let ask = Self::listing_ask(&unit, &listing);
        if amount < ask {
            return Err("E_UNDERPAID: amount is below the ask".into());
        }
        let seller = unit.holder.clone().ok_or("E_LISTING: no holder")?;
        if &seller == buyer {
            return Err("E_BAD_ARGS: buyer is the seller".into());
        }
        let penalty = if listing.kind == ListingKind::Default {
            (ask.saturating_mul(self.params.penalty_bps as u128) / BPS).min(ask)
        } else {
            0
        };
        let lien = unit.lien.take();
        self.move_token(&mut unit, &seller, buyer, false);
        if listing.kind == ListingKind::Default {
            unit.status = UnitStatus::Allocated;
            // The buyer inherits the plan, including instalments the defaulter missed. Without a rebase anyone
            // could `declare_default` on the buyer in the next block and resell the unit (another 5% penalty).
            // Every unmet instalment already due moves to the sale time, so the buyer gets a full
            // `default_grace_ns` to catch up. Met instalments and future ones keep their dates (the plan stays
            // non-decreasing). Voluntary sales don't rebase, so a holder can't reset their own clock by selling
            // to themselves; doing it through a default sale costs the 5% penalty every time.
            let now = Self::now();
            for inst in unit.plan.iter_mut() {
                if inst.due_at.0 < now && unit.paid < inst.cumulative.0 {
                    inst.due_at = U64(now);
                }
            }
        }
        unit.listing = None;
        emit(
            "sold",
            json!({ "unit_id": unit.id, "from": seller, "to": buyer, "price": U128(ask) }),
        );
        self.save(unit);
        let mut proceeds = ask - penalty;
        if let Some(l) = lien {
            // Lender first, up to its cap; the lien ends with the sale (the buyer takes the token free of it).
            let to_lender = proceeds.min(l.cap.0);
            if to_lender > 0 {
                self.pay_from_estate(l.lender.clone(), to_lender, "lien").detach();
                proceeds -= to_lender;
            }
            emit(
                "lien_settled",
                json!({ "unit_id": m.buy, "lender": l.lender, "amount": U128(to_lender) }),
            );
        }
        if proceeds > 0 {
            self.pay_from_estate(seller, proceeds, "sale").detach();
        }
        if penalty > 0 {
            self.pay_from_estate(self.payout_account(), penalty, "default-penalty")
                .detach();
        }
        Ok(amount - ask)
    }
}
