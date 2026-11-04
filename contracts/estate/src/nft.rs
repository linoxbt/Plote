//! Allocation NFT (NEP-171 core, NEP-177 metadata, NEP-178 approvals, NEP-181 enumeration).
//! Token ID = unit ID, so a second mint for the same unit is impossible by construction.
//! Ownership lives in `Unit.holder`; `owner_tokens` is the per-owner index.

use crate::*;
use near_contract_standards::non_fungible_token::events::NftTransfer;
use near_contract_standards::non_fungible_token::metadata::{NFTContractMetadata, TokenMetadata};
use near_contract_standards::non_fungible_token::Token;
use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::{assert_one_yocto, env, ext_contract, near, AccountId, Promise, PromiseOrValue};
use std::collections::HashMap;

#[allow(dead_code)]
#[ext_contract(ext_nft_receiver)]
pub trait NftReceiver {
    fn nft_on_transfer(
        &mut self,
        sender_id: AccountId,
        previous_owner_id: AccountId,
        token_id: String,
        msg: String,
    ) -> PromiseOrValue<bool>;
}

#[allow(dead_code)]
#[ext_contract(ext_nft_approval_receiver)]
pub trait NftApprovalReceiver {
    fn nft_on_approve(
        &mut self,
        token_id: String,
        owner_id: AccountId,
        approval_id: u64,
        msg: String,
    );
}

const APPROVAL_STORAGE: NearToken = NearToken::from_micronear(1_000);

#[near]
impl Estate {
    // ---------- NEP-171 core ----------

    #[payable]
    pub fn nft_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: String,
        approval_id: Option<u64>,
        memo: Option<String>,
    ) {
        assert_one_yocto();
        let mut unit = self.unit(&token_id);
        let sender = env::predecessor_account_id();
        let owner = self.authorize_transfer(&unit, &sender, approval_id);
        let _ = memo;
        self.move_token(&mut unit, &owner, &receiver_id, true);
        self.save(unit);
    }

    #[payable]
    pub fn nft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        token_id: String,
        approval_id: Option<u64>,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<bool> {
        assert_one_yocto();
        let mut unit = self.unit(&token_id);
        let sender = env::predecessor_account_id();
        let owner = self.authorize_transfer(&unit, &sender, approval_id);
        let previous_approvals = unit.approvals.clone();
        let _ = memo;
        self.move_token(&mut unit, &owner, &receiver_id, true);
        self.save(unit);
        ext_nft_receiver::ext(receiver_id.clone())
            .with_static_gas(GAS_NFT_ON_TRANSFER)
            .nft_on_transfer(sender, owner.clone(), token_id.clone(), msg)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_NFT_RESOLVE)
                    .nft_resolve_transfer(owner, receiver_id, token_id, Some(previous_approvals)),
            )
            .into()
    }

    /// Returns true if the token stayed with the receiver.
    #[private]
    pub fn nft_resolve_transfer(
        &mut self,
        previous_owner_id: AccountId,
        receiver_id: AccountId,
        token_id: String,
        approved_account_ids: Option<HashMap<AccountId, u64>>,
    ) -> bool {
        let keep = match result_bytes(0, 64) {
            Some(b) => near_sdk::serde_json::from_slice::<bool>(&b)
                .map(|r| !r)
                .unwrap_or(true),
            None => false,
        };
        if keep {
            return true;
        }
        let Some(mut unit) = self.units.get(&token_id).cloned() else {
            return true;
        };
        if unit.holder.as_ref() != Some(&receiver_id) {
            return true; // moved on meanwhile; nothing to undo
        }
        self.move_token(&mut unit, &receiver_id, &previous_owner_id, false);
        if let Some(a) = approved_account_ids {
            unit.approvals = a;
        }
        self.save(unit);
        false
    }

    pub fn nft_token(&self, token_id: String) -> Option<Token> {
        self.units
            .get(&token_id)
            .filter(|u| u.status.has_token())
            .map(|u| self.token_view(u))
    }

    // ---------- NEP-178 approvals ----------

    #[payable]
    pub fn nft_approve(
        &mut self,
        token_id: String,
        account_id: AccountId,
        msg: Option<String>,
    ) -> Option<Promise> {
        ensure!(
            env::attached_deposit() >= APPROVAL_STORAGE,
            "E_DEPOSIT",
            "attach {} for approval storage",
            APPROVAL_STORAGE
        );
        let mut unit = self.unit(&token_id);
        let owner = self.assert_holder(&unit);
        ensure!(unit.lien.is_none(), "E_LIEN", "a lien blocks approvals");
        let approval_id = unit.next_approval_id;
        unit.next_approval_id += 1;
        unit.approvals.insert(account_id.clone(), approval_id);
        self.save(unit);
        msg.map(|m| {
            ext_nft_approval_receiver::ext(account_id)
                .with_static_gas(GAS_NFT_ON_APPROVE)
                .nft_on_approve(token_id, owner, approval_id, m)
        })
    }

    #[payable]
    pub fn nft_revoke(&mut self, token_id: String, account_id: AccountId) {
        assert_one_yocto();
        let mut unit = self.unit(&token_id);
        self.assert_holder(&unit);
        unit.approvals.remove(&account_id);
        self.save(unit);
    }

    #[payable]
    pub fn nft_revoke_all(&mut self, token_id: String) {
        assert_one_yocto();
        let mut unit = self.unit(&token_id);
        self.assert_holder(&unit);
        unit.approvals.clear();
        self.save(unit);
    }

    pub fn nft_is_approved(
        &self,
        token_id: String,
        approved_account_id: AccountId,
        approval_id: Option<u64>,
    ) -> bool {
        let Some(unit) = self.units.get(&token_id) else {
            return false;
        };
        match unit.approvals.get(&approved_account_id) {
            Some(id) => approval_id.map(|a| a == *id).unwrap_or(true),
            None => false,
        }
    }

    // ---------- NEP-181 enumeration ----------

    pub fn nft_total_supply(&self) -> U128 {
        U128(self.allocated_count() as u128)
    }

    pub fn nft_tokens(&self, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        let from = from_index.map(|f| f.0 as usize).unwrap_or(0);
        let limit = limit.unwrap_or(50).min(100) as usize;
        self.units
            .values()
            .filter(|u| u.status.has_token())
            .skip(from)
            .take(limit)
            .map(|u| self.token_view(u))
            .collect()
    }

    pub fn nft_supply_for_owner(&self, account_id: AccountId) -> U128 {
        U128(
            self.owner_tokens
                .get(&account_id)
                .map(|v| v.len())
                .unwrap_or(0) as u128,
        )
    }

    pub fn nft_tokens_for_owner(
        &self,
        account_id: AccountId,
        from_index: Option<U128>,
        limit: Option<u64>,
    ) -> Vec<Token> {
        let from = from_index.map(|f| f.0 as usize).unwrap_or(0);
        let limit = limit.unwrap_or(50).min(100) as usize;
        self.owner_tokens
            .get(&account_id)
            .map(|ids| {
                ids.iter()
                    .skip(from)
                    .take(limit)
                    .filter_map(|id| self.units.get(id))
                    .map(|u| self.token_view(u))
                    .collect()
            })
            .unwrap_or_default()
    }

    // ---------- NEP-177 metadata ----------

    pub fn nft_metadata(&self) -> NFTContractMetadata {
        self.metadata.get().expect("metadata")
    }
}

impl Estate {
    pub(crate) fn add_token(&mut self, owner: &AccountId, id: &str) {
        let mut v = self.owner_tokens.get(owner).cloned().unwrap_or_default();
        if !v.iter().any(|x| x == id) {
            v.push(id.to_string());
        }
        self.owner_tokens.insert(owner.clone(), v);
    }

    pub(crate) fn remove_token(&mut self, owner: &AccountId, id: &str) {
        if let Some(mut v) = self.owner_tokens.get(owner).cloned() {
            v.retain(|x| x != id);
            if v.is_empty() {
                self.owner_tokens.remove(owner);
            } else {
                self.owner_tokens.insert(owner.clone(), v);
            }
        }
    }

    /// Who may move this token: its holder, or an approved account with a matching approval id.
    fn authorize_transfer(
        &self,
        unit: &Unit,
        sender: &AccountId,
        approval_id: Option<u64>,
    ) -> AccountId {
        ensure!(
            unit.status.has_token(),
            "E_UNIT_NOT_FOUND",
            "token {} doesn't exist",
            unit.id
        );
        let owner = unit.holder.clone().unwrap();
        if sender != &owner {
            let id = unit
                .approvals
                .get(sender)
                .unwrap_or_else(|| errors::fail("E_NOT_HOLDER", "sender is not approved"));
            ensure!(
                approval_id.map(|a| a == *id).unwrap_or(true),
                "E_NOT_HOLDER",
                "approval id mismatch"
            );
        }
        owner
    }

    /// Moves the token. `guarded` applies the lien / default / in-flight rules of a normal transfer.
    pub(crate) fn move_token(
        &mut self,
        unit: &mut Unit,
        from: &AccountId,
        to: &AccountId,
        guarded: bool,
    ) {
        if guarded {
            ensure!(
                unit.lien.is_none(),
                "E_LIEN",
                "a lien blocks transfers until the lender clears it"
            );
            ensure!(
                unit.listing
                    .as_ref()
                    .map(|l| l.kind != ListingKind::Default)
                    .unwrap_or(true),
                "E_LISTING",
                "a default listing is open; the unit can only change hands by sale"
            );
            ensure!(
                unit.in_flight == 0,
                "E_IN_FLIGHT",
                "a transfer out of {} is pending",
                unit.id
            );
        }
        ensure!(
            from != to,
            "E_BAD_ARGS",
            "current and next owner must differ"
        );
        self.remove_token(from, &unit.id);
        self.add_token(to, &unit.id);
        unit.holder = Some(to.clone());
        unit.approvals.clear();
        unit.recovery = None;
        if unit
            .listing
            .as_ref()
            .map(|l| l.kind == ListingKind::Voluntary)
            .unwrap_or(false)
        {
            unit.listing = None;
        }
        NftTransfer {
            old_owner_id: from,
            new_owner_id: to,
            token_ids: &[unit.id.as_str()],
            authorized_id: None,
            memo: None,
        }
        .emit();
    }

    pub(crate) fn token_view(&self, unit: &Unit) -> Token {
        Token {
            token_id: unit.id.clone(),
            owner_id: unit.holder.clone().unwrap_or_else(env::current_account_id),
            metadata: Some(self.token_metadata(unit)),
            approved_account_ids: Some(unit.approvals.clone()),
        }
    }

    pub(crate) fn token_metadata(&self, unit: &Unit) -> TokenMetadata {
        let approved = self.approved_count();
        let total = self.milestones.len() as u32;
        let svg = svg::unit_svg(&svg::SvgInput {
            estate: &self.name,
            label: &unit.label,
            unit_id: &unit.id,
            approved,
            total,
            status: svg::status_text(unit.status),
            paid: unit.paid,
            price: unit.price,
        });
        let extra = json!({
            "estate": env::current_account_id(),
            "unit_account": unit.account,
            "price": U128(unit.price),
            "paid": U128(unit.paid),
            "status": unit.status,
            "milestones_approved": approved,
        });
        TokenMetadata {
            title: Some(format!("{} · {}", self.name, unit.id.to_uppercase())),
            description: Some(format!(
                "Allocation of {} at {}. The unit's own escrow account is {}. Money moves to the developer only on proven milestones.",
                unit.label, self.name, unit.account
            )),
            media: Some(svg::data_uri(&svg)),
            media_hash: None,
            copies: Some(1),
            issued_at: unit.allocated_at.map(|t| (t / 1_000_000).to_string()),
            expires_at: None,
            starts_at: None,
            updated_at: None,
            extra: Some(extra.to_string()),
            reference: Some(format!("{}/api/meta/{}/{}", self.app_url.trim_end_matches('/'), env::current_account_id(), unit.id)),
            reference_hash: None,
        }
    }
}
