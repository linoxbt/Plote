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

    /// A lien blocks transfer and listing; refunds go to the lender first, up to `cap`.
    #[payable]
    pub fn set_lien(&mut self, unit_id: String, lender: AccountId, cap: U128) {
        assert_one_yocto();
        let mut unit = self.unit(&unit_id);
        let holder = self.assert_holder(&unit);
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
        unit.lien = Some(Lien { lender, cap });
        // Only a voluntary listing can be open here; a lien blocks selling, so it goes.
        unit.listing = None;
        self.save(unit);
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
