//! `plote-musdc`: testnet stand-in for USDC with an open faucet. NEP-141 + NEP-145 + NEP-148, 6 decimals.
//! Anyone may mint up to 10,000 USDC per call so judges can buy a unit in two clicks.

use near_contract_standards::fungible_token::events::FtMint;
use near_contract_standards::fungible_token::metadata::{
    FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC,
};
use near_contract_standards::fungible_token::{
    FungibleToken, FungibleTokenCore, FungibleTokenResolver,
};
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::json_types::U128;
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault, PromiseOrValue,
};

/// 10,000 USDC in base units.
pub const MAX_MINT: u128 = 10_000_000_000;

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Token,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct MockUsdc {
    token: FungibleToken,
}

#[near]
impl MockUsdc {
    #[init]
    pub fn new() -> Self {
        Self {
            token: FungibleToken::new(StorageKey::Token),
        }
    }

    /// Open faucet. Mints to `account_id` (default: caller). Registers the receiver when it isn't
    /// registered yet and enough NEAR is attached for storage; unused deposit is refunded.
    #[payable]
    pub fn mint(&mut self, amount: U128, account_id: Option<AccountId>) -> U128 {
        require!(
            amount.0 > 0 && amount.0 <= MAX_MINT,
            "E_BAD_ARGS: amount must be 1..=10000 USDC (6 decimals)"
        );
        let receiver = account_id.unwrap_or_else(env::predecessor_account_id);
        let mut deposit = env::attached_deposit();
        if !self.token.accounts.contains_key(&receiver) {
            let min = self.token.storage_balance_bounds().min;
            require!(
                deposit >= min,
                "E_STORAGE: receiver isn't registered; attach 0.00125 NEAR to register it"
            );
            self.token.internal_register_account(&receiver);
            deposit = deposit.saturating_sub(min);
        }
        self.token.internal_deposit(&receiver, amount.0);
        FtMint {
            owner_id: &receiver,
            amount,
            memo: Some("faucet"),
        }
        .emit();
        if deposit > NearToken::from_yoctonear(0) {
            near_sdk::Promise::new(env::predecessor_account_id())
                .transfer(deposit)
                .detach();
        }
        U128(self.token.ft_balance_of(receiver).0)
    }
}

#[near]
impl FungibleTokenCore for MockUsdc {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.token.ft_transfer(receiver_id, amount, memo)
    }

    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for MockUsdc {
    #[private]
    fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        let (used, _burned) =
            self.token
                .internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        used.into()
    }
}

#[near]
impl StorageManagement for MockUsdc {
    #[payable]
    fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        self.token.internal_storage_unregister(force).is_some()
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for MockUsdc {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name: "Plote test USDC".to_string(),
            symbol: "USDC".to_string(),
            icon: Some("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='15' fill='%232DD4BF'/%3E%3Ctext x='16' y='21' font-size='13' text-anchor='middle' font-family='monospace' fill='%230A0B0D'%3E$%3C/text%3E%3C/svg%3E".to_string()),
            reference: None,
            reference_hash: None,
            decimals: 6,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn acc(s: &str) -> AccountId {
        s.parse().unwrap()
    }

    fn ctx(pred: &str, deposit: NearToken) {
        let mut b = VMContextBuilder::new();
        b.current_account_id(acc("musdc.testnet"))
            .predecessor_account_id(acc(pred))
            .attached_deposit(deposit);
        testing_env!(b.build());
    }

    #[test]
    fn mint_registers_and_credits() {
        ctx("alice.testnet", NearToken::from_millinear(10));
        let mut c = MockUsdc::new();
        let bal = c.mint(U128(5_000_000_000), None);
        assert_eq!(bal.0, 5_000_000_000);
        assert_eq!(c.ft_total_supply().0, 5_000_000_000);
    }

    #[test]
    #[should_panic(expected = "E_BAD_ARGS")]
    fn mint_capped() {
        ctx("alice.testnet", NearToken::from_millinear(10));
        let mut c = MockUsdc::new();
        c.mint(U128(MAX_MINT + 1), None);
    }

    #[test]
    #[should_panic(expected = "E_STORAGE")]
    fn mint_needs_registration_deposit() {
        ctx("alice.testnet", NearToken::from_yoctonear(0));
        let mut c = MockUsdc::new();
        c.mint(U128(1), None);
    }
}
