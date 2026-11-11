//! `plote-estate`: one contract per estate (e.g. `harmattan-court.plote.testnet`).
//!
//! It owns the unit registry, the allocation NFT (token ID = unit ID), the milestone schedule,
//! TEE-checked evidence, surveyor sign-offs, releases, refunds, resale, defaults and holder votes.
//! Buyers' USDC never sits here: each unit is its own sub-account running `plote-unit`, and the only
//! way money leaves a unit is `unit.transfer_out`, which only this contract can call.
//!
//! See docs/SPEC.md §5 for the design and docs/INTERFACE.md for the exact JSON interface.

pub mod errors;
pub mod events;
mod milestones;
mod nft;
mod payments;
mod resale;
mod safety;
pub mod svg;
pub mod types;
mod units;
mod views;
mod votes;

#[cfg(test)]
mod tests;

use near_contract_standards::non_fungible_token::metadata::NFTContractMetadata;
use near_sdk::collections::LazyOption;
use near_sdk::json_types::Base58CryptoHash;
use near_sdk::store::{IterableMap, LookupMap, Vector};
use near_sdk::{env, near, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault};

pub use types::*;

// ---------- money and gas constants ----------

/// Storage deposit a buyer attaches to `reserve` (covers the NFT and reservation state; refunded on burn).
pub const RESERVE_DEPOSIT: NearToken = NearToken::from_millinear(50);
/// NEAR sent to each new unit account (its own storage with a global contract + 1-yocto transfers).
pub const UNIT_ACCOUNT_FUNDING: NearToken = NearToken::from_micronear(25_000);
/// NEP-145 registration of the unit account on the USDC contract.
pub const USDC_STORAGE: NearToken = NearToken::from_micronear(1_250);
/// What `add_units` requires per unit (funding + registration + the unit record stored here).
pub const ADD_UNIT_DEPOSIT: NearToken = NearToken::from_millinear(35);
/// NEAR attached to each OutLayer `request_execution` (unused part is refunded by OutLayer).
pub const VERIFY_DEPOSIT: NearToken = NearToken::from_millinear(50);
pub const MAX_UNITS_PER_CALL: usize = 8;
/// Each release is a unit transfer (25 Tgas) + callback (15 Tgas): 6 fit in one 300 Tgas call.
pub const MAX_RELEASE_PER_CALL: usize = 6;
pub const BPS: u128 = 10_000;
/// Storage deposit `propose` requires; the estate keeps it (a proposal's record lives forever). Covers ~5 KB, well
/// above a proposal with a 280-char reason and a 100-token `voted` list, and makes proposal spam cost real NEAR.
pub const PROPOSAL_DEPOSIT: NearToken = NearToken::from_millinear(50);
/// Money-moving or estate-stopping votes (`StepIn`, `ReplaceSurveyor`, `Freeze`) need at least this many tokens in
/// the electorate, so a single early buyer (one 10% deposit) can't pass them alone; a majority then needs ≥ 2 holders'
/// tokens.
pub const MIN_ELECTORATE: u32 = 3;
/// ...and at least 1/`MIN_ELECTORATE_SHARE` of all units (25%), so a majority always represents > 12.5% of the estate.
pub const MIN_ELECTORATE_SHARE: u32 = 4;

/// NEP-178 approvals kept per token (each lives in the unit record every callback reads; bounded so a holder can't
/// grow a unit past what `on_out` and the views can afford).
pub const MAX_APPROVALS: usize = 16;
/// Units per estate: every O(units) path (`propose`, `get_estate`, `nft_total_supply`) stays far inside the gas limit.
pub const MAX_UNITS: u32 = 500;
/// Instalments per unit plan (the plan lives in the unit record).
pub const MAX_PLAN_LEN: usize = 24;
/// Evidence ids kept on a milestone (the milestones live in the root state, read by every call). Older evidence stays
/// in the `evidence` map and in `list_evidence`; only the per-milestone index is trimmed to the newest ones.
pub const MAX_EVIDENCE_IDS: usize = 32;
/// `reopen_stale_check`: a milestone stuck in Checking this long after its latest evidence can be reopened by anyone.
pub const STALE_CHECK_NS: u64 = ONE_HOUR_NS;
pub const MAX_APP_URL_LEN: usize = 200;
/// Tokens counted per `vote` call (bounds `voted.contains` and the unit reads); a holder with more calls again.
pub const MAX_VOTE_TOKENS_PER_CALL: usize = 50;
/// A vote's weight is the token's `min(paid, price)` in whole USDC (rounded up), so `electorate`/`yes`/`no` (u32)
/// hold up to ~4.29 billion USDC.
pub const VOTE_WEIGHT_UNIT: u128 = 1_000_000;

pub const GAS_UNIT_INIT: Gas = Gas::from_tgas(5);
pub const GAS_USDC_REGISTER: Gas = Gas::from_tgas(5);
pub const GAS_ON_UNIT_CREATED: Gas = Gas::from_tgas(5);
pub const GAS_FT_BALANCE: Gas = Gas::from_tgas(5);
pub const GAS_ON_BALANCE: Gas = Gas::from_tgas(10);
/// `on_report_first` reads the unit and schedules the second balance read and `on_report_second`.
pub const GAS_ON_REPORT_FIRST: Gas = Gas::from_tgas(35);
/// `on_report_second` credits (may mint the NFT, cure a default, update open proposals' electorates).
pub const GAS_ON_REPORT_SECOND: Gas = Gas::from_tgas(20);
pub const GAS_TRANSFER_OUT: Gas = Gas::from_tgas(25);
/// `on_out` for releases, excess and sweeps (read + write one bounded unit record and the root state).
pub const GAS_ON_OUT: Gas = Gas::from_tgas(15);
/// `on_out` for a refund, which may burn the token and return the storage deposit.
pub const GAS_ON_OUT_REFUND: Gas = Gas::from_tgas(20);
/// `on_out` for a reservation refund: if the reserver can't receive it, it schedules the transfer to the estate's
/// own account (`GAS_TRANSFER_OUT` + `GAS_ON_OUT`) and must carry that gas.
pub const GAS_ON_OUT_RESERVATION: Gas = Gas::from_tgas(60);
pub const GAS_OUTLAYER: Gas = Gas::from_tgas(100);
pub const GAS_ON_VERDICT: Gas = Gas::from_tgas(40);
pub const GAS_FT_TRANSFER: Gas = Gas::from_tgas(15);
pub const GAS_ON_PAYOUT: Gas = Gas::from_tgas(5);
pub const GAS_NFT_ON_TRANSFER: Gas = Gas::from_tgas(25);
pub const GAS_NFT_RESOLVE: Gas = Gas::from_tgas(15);
pub const GAS_NFT_ON_APPROVE: Gas = Gas::from_tgas(15);

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Units,
    Evidence,
    Captures,
    Phashes,
    Owed,
    Proposals,
    OwnerTokens,
    Metadata,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Estate {
    // roles
    pub(crate) developer_id: AccountId,
    pub(crate) payout_id: AccountId,
    pub(crate) payout_redirect: Option<AccountId>,
    pub(crate) surveyor_id: AccountId,
    pub(crate) recovery_id: AccountId,
    pub(crate) verdict_relayer: Option<AccountId>,
    // integrations
    pub(crate) usdc_id: AccountId,
    pub(crate) outlayer_id: AccountId,
    pub(crate) verify_mode: String,
    pub(crate) verifier: VerifierSource,
    pub(crate) unit_code_hash: Base58CryptoHash,
    // site
    pub(crate) name: String,
    pub(crate) location: String,
    pub(crate) geofence: Geofence,
    pub(crate) app_url: String,
    // data
    pub(crate) milestones: Vec<Milestone>,
    pub(crate) units: IterableMap<UnitId, Unit>,
    pub(crate) evidence: IterableMap<u64, Evidence>,
    pub(crate) next_evidence_id: u64,
    pub(crate) captures: LookupMap<u8, Capture>,
    pub(crate) accepted_phashes: Vector<u64>,
    pub(crate) owed: LookupMap<AccountId, u128>,
    pub(crate) proposals: IterableMap<u64, Proposal>,
    pub(crate) next_proposal_id: u64,
    // NFT
    pub(crate) owner_tokens: LookupMap<AccountId, Vec<UnitId>>,
    pub(crate) metadata: LazyOption<NFTContractMetadata>,
    // switches and counters
    pub(crate) frozen: Option<Freeze>,
    pub(crate) params: Params,
    pub(crate) stats: DevStatsStored,
    pub(crate) verification_budget: u128,
    pub(crate) first_sale_done: bool,
    pub(crate) total_paid_in: u128,
    pub(crate) total_released: u128,
    pub(crate) total_refunded: u128,
}

#[near]
impl Estate {
    #[init]
    pub fn new(args: NewArgs) -> Self {
        let NewArgs {
            developer_id,
            payout_id,
            surveyor_id,
            recovery_id,
            usdc_id,
            outlayer_id,
            verdict_relayer,
            verify_mode,
            verifier,
            unit_code_hash,
            name,
            location,
            geofence,
            milestones,
            params,
            nft_metadata,
            app_url,
        } = args;

        ensure!(
            !milestones.is_empty() && milestones.len() <= 8,
            "E_BAD_ARGS",
            "1 to 8 milestones"
        );
        ensure!(
            params.mobilisation_bps <= 1_000,
            "E_BPS_SUM",
            "mobilisation_bps must be at most 1000"
        );
        ensure!(
            params.min_initial_bps <= BPS as u16 && params.penalty_bps <= 2_000,
            "E_BAD_ARGS",
            "bps out of range"
        );
        let sum: u32 =
            milestones.iter().map(|m| m.bps as u32).sum::<u32>() + params.mobilisation_bps as u32;
        ensure!(
            sum == BPS as u32,
            "E_BPS_SUM",
            "milestone bps + mobilisation_bps must equal 10000, got {}",
            sum
        );
        for w in milestones.windows(2) {
            ensure!(
                w[1].deadline.0 > w[0].deadline.0,
                "E_DEADLINES",
                "deadlines must strictly increase"
            );
        }
        let mode = verify_mode.unwrap_or_else(|| "outlayer".to_string());
        ensure!(
            mode == "outlayer" || mode == "https",
            "E_BAD_ARGS",
            "verify_mode must be outlayer or https"
        );
        ensure!(
            mode == "outlayer" || verdict_relayer.is_some(),
            "E_BAD_ARGS",
            "https mode needs a verdict_relayer"
        );
        nft_metadata.assert_valid();
        assert_safe_checks(&params, &geofence, &verifier);
        assert_safe_params(&params);
        assert_app_url(&app_url);

        Self {
            developer_id,
            payout_id,
            payout_redirect: None,
            surveyor_id,
            recovery_id,
            verdict_relayer,
            usdc_id,
            outlayer_id,
            verify_mode: mode,
            verifier,
            unit_code_hash,
            name,
            location,
            geofence,
            app_url,
            milestones: milestones
                .into_iter()
                .map(|m| Milestone {
                    key: m.key,
                    title: m.title,
                    bps: m.bps,
                    deadline: m.deadline.0,
                    status: MilestoneStatus::Open,
                    evidence_ids: vec![],
                    verified_at: None,
                    signed_at: None,
                    veto_until: None,
                })
                .collect(),
            units: IterableMap::new(StorageKey::Units),
            evidence: IterableMap::new(StorageKey::Evidence),
            next_evidence_id: 1,
            captures: LookupMap::new(StorageKey::Captures),
            accepted_phashes: Vector::new(StorageKey::Phashes),
            owed: LookupMap::new(StorageKey::Owed),
            proposals: IterableMap::new(StorageKey::Proposals),
            next_proposal_id: 1,
            owner_tokens: LookupMap::new(StorageKey::OwnerTokens),
            metadata: LazyOption::new(StorageKey::Metadata, Some(&nft_metadata)),
            frozen: None,
            params,
            stats: DevStatsStored::default(),
            verification_budget: 0,
            first_sale_done: false,
            total_paid_in: 0,
            total_released: 0,
            total_refunded: 0,
        }
    }
}

// ---------- internal helpers shared by the modules ----------

/// Did the promise result at `i` succeed? (Payload ignored.)
pub(crate) fn result_ok(i: u64) -> bool {
    env::promise_results_count() > i && env::promise_result_checked(i, 64 * 1024).is_ok()
}

/// Outside the playground, the photo checks can't be configured away (pre-audit review H2/M3): a real geofence, a
/// meaningful reuse threshold and AI confidence, a bounded photo age, and a pinned verifier build.
pub(crate) fn assert_safe_checks(params: &Params, geofence: &Geofence, verifier: &VerifierSource) {
    if params.playground {
        return;
    }
    ensure!(
        (50..=2_000).contains(&geofence.radius_m),
        "E_BAD_ARGS",
        "geofence.radius_m must be 50..=2000 outside the playground"
    );
    ensure!(
        (6..=16).contains(&params.max_phash_distance),
        "E_BAD_ARGS",
        "max_phash_distance must be 6..=16 outside the playground"
    );
    ensure!(
        params.min_ai_confidence >= 60 && params.min_ai_confidence <= 100,
        "E_BAD_ARGS",
        "min_ai_confidence must be 60..=100 outside the playground"
    );
    ensure!(
        (1..=168).contains(&params.max_exif_age_h),
        "E_BAD_ARGS",
        "max_exif_age_h must be 1..=168 outside the playground"
    );
    ensure!(
        !verifier.commit.trim().is_empty(),
        "E_BAD_ARGS",
        "the verifier must be pinned (non-empty commit / version key) outside the playground"
    );
}

/// Outside the playground and testnet, a new estate's timing and money parameters must give holders real protection
/// (audit finding 9): no demo shortcuts, at least a day to veto a sign-off and to react to a missed deadline or
/// instalment, a dust threshold of at most 1 USDC and a capture code that lives between 5 minutes and a day. Estates on
/// a `.testnet` account are exempt, so the demo estates (Harmattan Court, Baobab Heights: `demo_mode`, minute-long
/// windows) still deploy fresh; any other account (mainnet) is checked. Only `new` applies this; no `set_*` path
/// re-checks it, so an in-place upgrade can't brick a live estate either.
pub(crate) fn assert_safe_params(params: &Params) {
    if params.playground || is_testnet_account(&env::current_account_id()) {
        return;
    }
    ensure!(
        !params.demo_mode,
        "E_BAD_ARGS",
        "demo_mode is only allowed on the playground"
    );
    ensure!(
        params.veto_window_ns.0 >= ONE_DAY_NS,
        "E_BAD_ARGS",
        "veto_window_ns must be at least 24 h outside the playground"
    );
    ensure!(
        params.grace_ns.0 >= ONE_DAY_NS && params.default_grace_ns.0 >= ONE_DAY_NS,
        "E_BAD_ARGS",
        "grace_ns and default_grace_ns must be at least 24 h outside the playground"
    );
    ensure!(
        params.dust_threshold.0 <= 1_000_000,
        "E_BAD_ARGS",
        "dust_threshold must be at most 1 USDC (1000000) outside the playground"
    );
    ensure!(
        (5 * 60_000_000_000..=ONE_DAY_NS).contains(&params.capture_ttl_ns.0),
        "E_BAD_ARGS",
        "capture_ttl_ns must be 5 minutes to 24 h outside the playground"
    );
}

/// Demo-only values are allowed on testnet estates (`<name>.testnet` and its sub-accounts) and nowhere else.
pub(crate) fn is_testnet_account(account: &AccountId) -> bool {
    account.as_str().ends_with(".testnet")
}

/// The app URL the NFT `reference` points at: https, bounded, no spaces or quotes.
pub(crate) fn assert_app_url(url: &str) {
    ensure!(
        url.starts_with("https://")
            && url.len() > "https://".len()
            && url.len() <= MAX_APP_URL_LEN
            && !url.chars().any(|c| c.is_whitespace()
                || c.is_control()
                || matches!(c, '"' | '\'' | '<' | '>')),
        "E_BAD_ARGS",
        "app_url must be an https:// URL of at most {} characters",
        MAX_APP_URL_LEN
    );
}

/// The payload of promise result `i`, if it succeeded.
pub(crate) fn result_bytes(i: u64, max_len: usize) -> Option<Vec<u8>> {
    if env::promise_results_count() <= i {
        return None;
    }
    env::promise_result_checked(i, max_len).ok()
}

impl Estate {
    pub(crate) fn now() -> u64 {
        env::block_timestamp()
    }

    pub(crate) fn unit(&self, unit_id: &str) -> Unit {
        self.units
            .get(unit_id)
            .cloned()
            .unwrap_or_else(|| errors::fail("E_UNIT_NOT_FOUND", format!("no unit {}", unit_id)))
    }

    pub(crate) fn save(&mut self, unit: Unit) {
        self.units.insert(unit.id.clone(), unit);
    }

    pub(crate) fn assert_developer(&self) {
        ensure!(
            env::predecessor_account_id() == self.developer_id,
            "E_NOT_DEVELOPER",
            "only the developer can do this"
        );
    }

    pub(crate) fn assert_surveyor(&self) {
        if self.params.playground {
            return;
        }
        ensure!(
            env::predecessor_account_id() == self.surveyor_id,
            "E_NOT_SURVEYOR",
            "only the surveyor can do this"
        );
    }

    pub(crate) fn assert_not_frozen(&self) {
        if let Some(f) = &self.frozen {
            errors::fail("E_FROZEN", format!("releases are frozen: {}", f.reason));
        }
    }

    pub(crate) fn assert_holder(&self, unit: &Unit) -> AccountId {
        let caller = env::predecessor_account_id();
        ensure!(
            unit.status.has_token() && unit.holder.as_ref() == Some(&caller),
            "E_NOT_HOLDER",
            "only the holder of {} can do this",
            unit.id
        );
        caller
    }

    pub(crate) fn payout_account(&self) -> AccountId {
        self.payout_redirect
            .clone()
            .unwrap_or_else(|| self.payout_id.clone())
    }

    /// A milestone has been missed: its refund point (deadline + grace) has passed and it wasn't
    /// approved in time. A late approval doesn't close refunds; only a holder `ExtendDeadline` vote does.
    pub(crate) fn milestone_missed(&self, i: usize, now: u64) -> bool {
        let m = &self.milestones[i];
        let refund_point = m.deadline.saturating_add(self.params.grace_ns.0);
        if now <= refund_point {
            return false;
        }
        !(m.status == MilestoneStatus::Approved
            && m.signed_at.map(|s| s <= refund_point).unwrap_or(false))
    }

    pub(crate) fn refunds_open(&self, now: u64) -> bool {
        if self
            .frozen
            .as_ref()
            .map(|f| f.refunds_open)
            .unwrap_or(false)
        {
            return true;
        }
        (0..self.milestones.len()).any(|i| self.milestone_missed(i, now))
    }

    /// Basis points whose release is unlocked: mobilisation + every approved milestone whose veto window passed.
    pub(crate) fn approved_bps(&self, now: u64) -> u128 {
        let mut bps = self.params.mobilisation_bps as u128;
        for m in &self.milestones {
            if m.status == MilestoneStatus::Approved
                && m.veto_until.map(|v| now >= v).unwrap_or(false)
            {
                bps += m.bps as u128;
            }
        }
        bps
    }

    pub(crate) fn approved_count(&self) -> u32 {
        self.milestones
            .iter()
            .filter(|m| m.status == MilestoneStatus::Approved)
            .count() as u32
    }

    pub(crate) fn releasable(&self, unit: &Unit, now: u64) -> u128 {
        if !unit.status.has_token() || !unit.ready {
            return 0;
        }
        let base = unit.paid.min(unit.price);
        let cap = base.saturating_mul(self.approved_bps(now)) / BPS;
        cap.saturating_sub(unit.released)
    }

    pub(crate) fn refundable(&self, unit: &Unit) -> u128 {
        unit.paid
            .saturating_sub(unit.released)
            .saturating_sub(unit.refunded_out)
    }

    pub(crate) fn excess(&self, unit: &Unit) -> u128 {
        unit.paid
            .saturating_sub(unit.price)
            .saturating_sub(unit.excess_out)
    }

    /// O(units), bounded by `MAX_UNITS`. (`stats.units_sold - stats.units_refunded` tracks the same number, but
    /// estates deployed before every burn path counted refunds would drift; the scan is exact.)
    pub(crate) fn allocated_count(&self) -> u32 {
        self.units.values().filter(|u| u.status.has_token()).count() as u32
    }

    /// The USDC the unit account should hold by the estate's books.
    pub(crate) fn expected_balance(unit: &Unit) -> u128 {
        (unit.paid + unit.unattributed).saturating_sub(unit.released + unit.refunded_out)
    }
}
