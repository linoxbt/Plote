//! `plote-unit`: the contract that runs on every unit account (e.g. `a-4b.harmattan-court.plote.testnet`).
//!
//! The unit account holds the buyer's USDC. It has no access keys and obeys only its estate contract:
//! the only way USDC leaves is `transfer_out`, callable by the estate alone. Incoming USDC sent with
//! `ft_transfer_call` is accepted or bounced by asking the estate (`on_unit_deposit`); any other token
//! is bounced straight back.

use near_sdk::json_types::U128;
use near_sdk::{
    env, ext_contract, near, require, AccountId, Gas, NearToken, Promise, PromiseOrValue,
};

const GAS_FOR_ESTATE_DEPOSIT: Gas = Gas::from_tgas(40);
const GAS_FOR_FT_TRANSFER: Gas = Gas::from_tgas(15);
const GAS_FOR_SYNC: Gas = Gas::from_tgas(40);

#[ext_contract(ext_estate)]
pub trait Estate {
    fn on_unit_deposit(
        &mut self,
        unit_id: String,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> U128;
    fn sync(&mut self, unit_id: String) -> Promise;
}

#[ext_contract(ext_ft)]
pub trait FungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

#[near(contract_state)]
#[derive(near_sdk::PanicOnDefault)]
pub struct Unit {
    estate_id: AccountId,
    usdc_id: AccountId,
    unit_id: String,
}

#[near]
impl Unit {
    /// Called by the estate contract in the same batch that creates this account.
    #[init]
    pub fn new(estate_id: AccountId, usdc_id: AccountId, unit_id: String) -> Self {
        require!(
            env::predecessor_account_id() == estate_id,
            "E_NOT_ESTATE: only the estate can initialise a unit"
        );
        Self {
            estate_id,
            usdc_id,
            unit_id,
        }
    }

    /// NEP-141 receiver. Non-USDC tokens are returned in full. USDC is accepted or bounced by the estate.
    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        if env::predecessor_account_id() != self.usdc_id {
            return PromiseOrValue::Value(amount);
        }
        PromiseOrValue::Promise(
            ext_estate::ext(self.estate_id.clone())
                .with_static_gas(GAS_FOR_ESTATE_DEPOSIT)
                .on_unit_deposit(self.unit_id.clone(), sender_id, amount, msg),
        )
    }

    /// The only way USDC leaves this account. The returned promise fails if the transfer fails,
    /// so the estate's callback can tell.
    pub fn transfer_out(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
    ) -> Promise {
        require!(
            env::predecessor_account_id() == self.estate_id,
            "E_NOT_ESTATE: only the estate can move funds"
        );
        require!(amount.0 > 0, "E_BAD_ARGS: amount must be positive");
        ext_ft::ext(self.usdc_id.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FOR_FT_TRANSFER)
            .ft_transfer(receiver_id, amount, memo)
    }

    /// Anyone: ask the estate to re-read this account's USDC balance (e.g. after a 1Click delivery).
    pub fn sync_deposits(&self) -> Promise {
        ext_estate::ext(self.estate_id.clone())
            .with_static_gas(GAS_FOR_SYNC)
            .sync(self.unit_id.clone())
    }

    pub fn get_info(&self) -> (AccountId, AccountId, String) {
        (
            self.estate_id.clone(),
            self.usdc_id.clone(),
            self.unit_id.clone(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{get_created_receipts, VMContextBuilder};
    use near_sdk::testing_env;

    fn acc(s: &str) -> AccountId {
        s.parse().unwrap()
    }

    fn ctx(pred: &str) {
        let mut b = VMContextBuilder::new();
        b.current_account_id(acc("a-4b.estate.testnet"))
            .predecessor_account_id(acc(pred));
        testing_env!(b.build());
    }

    fn unit() -> Unit {
        ctx("estate.testnet");
        Unit::new(acc("estate.testnet"), acc("usdc.testnet"), "a-4b".into())
    }

    #[test]
    #[should_panic(expected = "E_NOT_ESTATE")]
    fn only_estate_can_init() {
        ctx("mallory.testnet");
        Unit::new(acc("estate.testnet"), acc("usdc.testnet"), "a-4b".into());
    }

    #[test]
    fn bounces_foreign_tokens() {
        let mut u = unit();
        ctx("other-token.testnet");
        match u.ft_on_transfer(acc("alice.testnet"), U128(5), String::new()) {
            PromiseOrValue::Value(v) => assert_eq!(v.0, 5),
            _ => panic!("expected bounce"),
        }
    }

    #[test]
    fn usdc_asks_estate() {
        let mut u = unit();
        ctx("usdc.testnet");
        match u.ft_on_transfer(acc("alice.testnet"), U128(5), String::new()) {
            PromiseOrValue::Promise(_) => {}
            _ => panic!("expected promise"),
        }
        assert!(!get_created_receipts().is_empty());
    }

    #[test]
    #[should_panic(expected = "E_NOT_ESTATE")]
    fn only_estate_moves_funds() {
        let mut u = unit();
        ctx("alice.testnet");
        u.transfer_out(acc("alice.testnet"), U128(1), None).detach();
    }

    #[test]
    fn estate_moves_funds() {
        let mut u = unit();
        ctx("estate.testnet");
        u.transfer_out(acc("dev.testnet"), U128(1), None).detach();
        assert_eq!(u.get_info().2, "a-4b");
    }
}
