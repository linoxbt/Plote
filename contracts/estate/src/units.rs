//! Unit creation and estate setup.

use crate::events::emit;
use crate::*;
use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::{env, near, require, AccountId, Promise};
use std::collections::HashMap;

pub(crate) fn valid_unit_id(id: &str) -> bool {
    let len_ok = !id.is_empty() && id.len() <= 16;
    let chars_ok = id
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    let edges_ok = !id.starts_with('-') && !id.ends_with('-') && !id.contains("--");
    len_ok && chars_ok && edges_ok
}

#[near]
impl Estate {
    /// Creates each unit sub-account, points it at the global unit code, initialises it and registers it
    /// on USDC. Attach `ADD_UNIT_DEPOSIT` (0.035 NEAR) per unit; at most 8 units per call.
    #[payable]
    pub fn add_units(&mut self, units: Vec<UnitInput>) {
        self.assert_developer();
        ensure!(
            !units.is_empty() && units.len() <= MAX_UNITS_PER_CALL,
            "E_TOO_MANY",
            "1 to {} units per call",
            MAX_UNITS_PER_CALL
        );
        let need = ADD_UNIT_DEPOSIT.saturating_mul(units.len() as u128);
        ensure!(
            env::attached_deposit() >= need,
            "E_DEPOSIT",
            "attach at least {} for {} units",
            need,
            units.len()
        );

        let estate = env::current_account_id();
        for input in units {
            ensure!(
                valid_unit_id(&input.id),
                "E_BAD_UNIT_ID",
                "unit id '{}' must be 1-16 chars of a-z, 0-9, -",
                input.id
            );
            ensure!(
                self.units.get(&input.id).is_none(),
                "E_UNIT_EXISTS",
                "unit {} already exists",
                input.id
            );
            ensure!(input.price.0 > 0, "E_BAD_ARGS", "price must be positive");
            ensure!(input.label.len() <= 64, "E_BAD_ARGS", "label too long");
            let mut last = 0u128;
            for (k, inst) in input.plan.iter().enumerate() {
                ensure!(
                    inst.cumulative.0 >= last && inst.cumulative.0 <= input.price.0,
                    "E_BAD_ARGS",
                    "plan must be cumulative and at most the price"
                );
                if k > 0 {
                    ensure!(
                        inst.due_at.0 > input.plan[k - 1].due_at.0,
                        "E_BAD_ARGS",
                        "plan dates must increase"
                    );
                }
                last = inst.cumulative.0;
            }
            let account: AccountId =
                format!("{}.{}", input.id, estate)
                    .parse()
                    .unwrap_or_else(|_| {
                        errors::fail("E_BAD_UNIT_ID", "unit account id is invalid (too long?)")
                    });

            let unit = Unit {
                id: input.id.clone(),
                account: account.clone(),
                label: input.label,
                price: input.price.0,
                status: UnitStatus::Available,
                ready: false,
                holder: None,
                allocated_at: None,
                deposit_owner: None,
                reservation: None,
                last_reservation: None,
                plan: input.plan,
                paid: 0,
                unattributed: 0,
                released: 0,
                refunded_out: 0,
                excess_out: 0,
                in_flight: 0,
                listing: None,
                beneficiary: None,
                guardians: vec![],
                recovery: None,
                lien: None,
                approvals: HashMap::new(),
                next_approval_id: 0,
            };
            emit(
                "unit_added",
                json!({ "unit_id": unit.id, "account": account, "price": U128(unit.price) }),
            );
            self.save(unit);

            let create = Promise::new(account.clone())
                .create_account()
                .transfer(UNIT_ACCOUNT_FUNDING)
                .use_global_contract(self.unit_code_hash)
                .function_call(
                    "new".to_string(),
                    json!({ "estate_id": estate, "usdc_id": self.usdc_id, "unit_id": input.id })
                        .to_string()
                        .into_bytes(),
                    NearToken::from_yoctonear(0),
                    GAS_UNIT_INIT,
                );
            let register = Promise::new(self.usdc_id.clone()).function_call(
                "storage_deposit".to_string(),
                json!({ "account_id": account, "registration_only": true })
                    .to_string()
                    .into_bytes(),
                USDC_STORAGE,
                GAS_USDC_REGISTER,
            );
            create
                .then(register)
                .then(
                    Self::ext(estate.clone())
                        .with_static_gas(GAS_ON_UNIT_CREATED)
                        .on_unit_created(input.id),
                )
                .detach();
        }
    }

    #[private]
    pub fn on_unit_created(&mut self, unit_id: String) -> bool {
        let Some(mut unit) = self.units.get(&unit_id).cloned() else {
            return false;
        };
        if crate::result_ok(0) {
            unit.ready = true;
            self.save(unit);
            true
        } else {
            // The account (or its USDC registration) couldn't be created. Drop the record so it can be retried.
            env::log_str(&format!("unit {} creation failed; removed", unit_id));
            self.units.remove(&unit_id);
            false
        }
    }

    /// Tops up the NEAR budget used to pay OutLayer for photo checks.
    #[payable]
    pub fn fund_verification(&mut self) {
        self.verification_budget = self
            .verification_budget
            .saturating_add(env::attached_deposit().as_yoctonear());
    }

    /// Developer may repoint the verifier worker until the first unit is sold; afterwards the code is fixed.
    pub fn set_verifier(&mut self, verifier: VerifierSource) {
        self.assert_developer();
        ensure!(
            !self.first_sale_done,
            "E_ALREADY_SOLD",
            "the verifier is fixed once a unit is sold"
        );
        self.verifier = verifier;
    }

    /// Playground only: reopen every milestone with deadlines re-based on now, so the next judge can run
    /// the whole flow again. Units, payments and releases are untouched.
    pub fn playground_reset(&mut self) {
        ensure!(
            self.params.playground,
            "E_PLAYGROUND_ONLY",
            "only the playground estate can be reset"
        );
        let now = Self::now();
        let spacing = 30 * ONE_DAY_NS;
        for (i, m) in self.milestones.iter_mut().enumerate() {
            m.status = MilestoneStatus::Open;
            m.verified_at = None;
            m.signed_at = None;
            m.veto_until = None;
            m.deadline = now + spacing * (i as u64 + 1);
        }
        for i in 0..self.milestones.len() as u8 {
            self.captures.remove(&i);
        }
        emit("playground_reset", json!({}));
    }
}

impl Estate {
    pub(crate) fn assert_valid_milestone(&self, milestone: u8) -> usize {
        let i = milestone as usize;
        require!(i < self.milestones.len(), "E_BAD_ARGS: no such milestone");
        i
    }
}
