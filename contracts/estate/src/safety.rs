//! Stretch safety features: next-of-kin beneficiary, 2-of-3 guardian recovery (C2) and lender liens (C3).
//! Every method that changes who may take the token or its money needs 1 yoctoNEAR (a full-access key), so an app
//! function-call key can't redirect a unit.

use crate::*;
use near_sdk::json_types::{U128, U64};
use near_sdk::{assert_one_yocto, env, near, AccountId};

/// Recovery delay after two guardians agree: 72 h, or the grace period in demo mode.
fn recovery_delay(p: &Params) -> u64 {
    if p.demo_mode {
        p.grace_ns.0
    } else {
        72 * ONE_HOUR_NS
    }
}

#[near]
impl Estate {
    #[payable]
    pub fn set_beneficiary(&mut self, unit_id: String, beneficiary: Option<AccountId>) {
        assert_one_yocto();
        let mut unit = self.unit(&unit_id);
        self.assert_holder(&unit);
        unit.beneficiary = beneficiary;
        self.save(unit);
    }

    #[payable]
    pub fn set_guardians(&mut self, unit_id: String, guardians: Vec<AccountId>) {
        assert_one_yocto();
        let mut unit = self.unit(&unit_id);
        let holder = self.assert_holder(&unit);
        ensure!(guardians.len() <= 3, "E_TOO_MANY", "at most 3 guardians");
        ensure!(
            !guardians.contains(&holder),
            "E_BAD_ARGS",
            "the holder can't be their own guardian"
        );
        let mut g = guardians;
        g.sort();
        g.dedup();
        unit.guardians = g;
        unit.recovery = None;
        self.save(unit);
    }

    /// A guardian backs moving the token to `new_owner`. The second distinct guardian starts the delay.
    #[payable]
    pub fn guardian_recover(&mut self, unit_id: String, new_owner: AccountId) {
        assert_one_yocto();
        let mut unit = self.unit(&unit_id);
        let caller = env::predecessor_account_id();
        ensure!(unit.status.has_token(), "E_RECOVERY", "unit has no holder");
        ensure!(
            unit.guardians.contains(&caller),
            "E_NOT_GUARDIAN",
            "only a guardian can do this"
        );
        ensure!(
            unit.holder.as_ref() != Some(&new_owner),
            "E_BAD_ARGS",
            "new owner is already the holder"
        );
        let mut r = match unit.recovery.take() {
            Some(r) if r.new_owner == new_owner => r,
            _ => Recovery {
                new_owner,
                approvals: vec![],
                ready_at: None,
            },
        };
        if !r.approvals.contains(&caller) {
            r.approvals.push(caller);
        }
        if r.approvals.len() >= 2 && r.ready_at.is_none() {
            r.ready_at = Some(U64(Self::now() + recovery_delay(&self.params)));
        }
        unit.recovery = Some(r);
        self.save(unit);
    }

    /// Anyone, after the delay: complete the recovery.
    pub fn finish_recovery(&mut self, unit_id: String) {
        let mut unit = self.unit(&unit_id);
        let r = unit
            .recovery
            .clone()
            .unwrap_or_else(|| errors::fail("E_RECOVERY", "no recovery in progress"));
        let ready = r.ready_at.map(|t| Self::now() >= t.0).unwrap_or(false);
        ensure!(ready, "E_RECOVERY", "recovery isn't ready yet");
        let from = unit.holder.clone().unwrap();
        // Recovery moves the token to the same person's new account, so their guardians and beneficiary carry
        // over (move_token clears them for every other change of hands).
        let guardians = unit.guardians.clone();
        let beneficiary = unit.beneficiary.clone();
        self.move_token(&mut unit, &from, &r.new_owner, false);
        unit.guardians = guardians
            .into_iter()
            .filter(|g| g != &r.new_owner)
            .collect();
        unit.beneficiary = beneficiary;
        self.save(unit);
    }

    #[payable]
    pub fn cancel_recovery(&mut self, unit_id: String) {
        assert_one_yocto();
        let mut unit = self.unit(&unit_id);
        self.assert_holder(&unit);
        unit.recovery = None;
        self.save(unit);
    }

    /// The holder offers a lien to `lender` (audit round 4, finding 2c: liens need the lender's consent). It is stored
    /// as **pending** (replacing any earlier offer) and does nothing until the lender calls `accept_lien`. Once active,
    /// a lien blocks transfer and listing, and refunds go to the lender first, up to `cap`.
    #[payable]
    pub fn set_lien(&mut self, unit_id: String, lender: AccountId, cap: U128) {
        assert_one_yocto();
        let unit = self.unit(&unit_id);
        let holder = self.assert_holder(&unit);
        self.assert_lien_allowed(&unit, &holder, &lender);
        crate::ext::set(
            &crate::ext::key(crate::ext::P_PENDING_LIEN, unit_id.as_bytes()),
            &crate::ext::PendingLien {
                lender: lender.clone(),
                cap: cap.0,
                holder,
            },
        );
        crate::events::emit(
            "lien_offered",
            near_sdk::serde_json::json!({ "unit_id": unit_id, "lender": lender, "cap": cap }),
        );
    }

    /// The lender named in a pending lien activates it. Attach 1 yocto. The offer must still come from the current
    /// holder (it is void once the token changes hands) and the unit must still be able to take a lien.
    #[payable]
    pub fn accept_lien(&mut self, unit_id: String) {
        assert_one_yocto();
        self.assert_no_nft_pending(&unit_id);
        let k = crate::ext::key(crate::ext::P_PENDING_LIEN, unit_id.as_bytes());
        let pending: crate::ext::PendingLien = crate::ext::get(&k)
            .unwrap_or_else(|| errors::fail("E_LIEN", "no pending lien on this unit"));
        let caller = env::predecessor_account_id();
        ensure!(
            pending.lender == caller,
            "E_NOT_LENDER",
            "only the lender named in the pending lien can accept it"
        );
        let mut unit = self.unit(&unit_id);
        ensure!(
            unit.status.has_token() && unit.holder.as_ref() == Some(&pending.holder),
            "E_LIEN",
            "the lien was offered by an earlier holder; it is void"
        );
        self.assert_lien_allowed(&unit, &pending.holder, &pending.lender);
        crate::ext::del(&k);
        unit.lien = Some(Lien {
            lender: pending.lender.clone(),
            cap: U128(pending.cap),
        });
        // Only a voluntary listing can be open here; a lien blocks selling, so it goes.
        unit.listing = None;
        self.save(unit);
        crate::events::emit(
            "lien_accepted",
            near_sdk::serde_json::json!({ "unit_id": unit_id, "lender": pending.lender, "cap": U128(pending.cap) }),
        );
    }

    /// View: the lien the holder offered and the lender hasn't accepted yet (`{ lender, cap }`), if any.
    pub fn get_pending_lien(&self, unit_id: String) -> Option<Lien> {
        let p: crate::ext::PendingLien = crate::ext::get(&crate::ext::key(
            crate::ext::P_PENDING_LIEN,
            unit_id.as_bytes(),
        ))?;
        let unit = self.units.get(&unit_id)?;
        // An offer from an earlier holder is void (move_token deletes it; this also hides any stale one).
        (unit.holder.as_ref() == Some(&p.holder)).then_some(Lien {
            lender: p.lender,
            cap: U128(p.cap),
        })
    }

    #[payable]
    pub fn clear_lien(&mut self, unit_id: String) {
        assert_one_yocto();
        let mut unit = self.unit(&unit_id);
        let lien = unit
            .lien
            .clone()
            .unwrap_or_else(|| errors::fail("E_LIEN", "no lien"));
        ensure!(
            lien.lender == env::predecessor_account_id(),
            "E_NOT_LENDER",
            "only the lender can clear the lien"
        );
        unit.lien = None;
        self.save(unit);
    }
}

impl Estate {
    /// Who may be a lender, and when a unit can take a lien (checked when the lien is offered and when it is accepted).
    fn assert_lien_allowed(&self, unit: &Unit, holder: &AccountId, lender: &AccountId) {
        ensure!(
            lender != holder,
            "E_BAD_ARGS",
            "the holder can't be the lender"
        );
        ensure!(unit.lien.is_none(), "E_LIEN", "a lien is already set");
        // A defaulter must not escape the default listing by pledging the unit (the old code cleared any listing).
        ensure!(
            matches!(unit.status, UnitStatus::Allocated | UnitStatus::HandedOver)
                && unit
                    .listing
                    .as_ref()
                    .map(|l| l.kind != ListingKind::Default)
                    .unwrap_or(true),
            "E_LISTING",
            "a unit in default can't take a lien; it can only change hands by sale"
        );
    }
}
