//! State and JSON types. Big numbers in JSON are strings (`U64`/`U128`); see docs/INTERFACE.md.

use near_sdk::json_types::{Base58CryptoHash, U128, U64};
use near_sdk::{near, AccountId};
use std::collections::HashMap;

pub type UnitId = String;

pub const ONE_HOUR_NS: u64 = 3_600_000_000_000;
pub const ONE_DAY_NS: u64 = 24 * ONE_HOUR_NS;

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct VerifierSource {
    pub repo: String,
    pub commit: String,
    pub build_target: String,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Geofence {
    pub lat_e6: i32,
    pub lon_e6: i32,
    /// 0 = no geofence (playground)
    pub radius_m: u32,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Params {
    pub reserve_ttl_ns: U64,
    pub min_initial_bps: u16,
    pub mobilisation_bps: u16,
    pub grace_ns: U64,
    pub veto_window_ns: U64,
    pub default_grace_ns: U64,
    pub penalty_bps: u16,
    pub dust_threshold: U128,
    pub late_claim_ns: U64,
    pub capture_ttl_ns: U64,
    pub proposal_period_ns: U64,
    pub max_phash_distance: u8,
    pub max_exif_age_h: u32,
    pub min_ai_confidence: u8,
    pub demo_mode: bool,
    pub playground: bool,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Instalment {
    pub due_at: U64,
    pub cumulative: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Reservation {
    pub by: AccountId,
    /// For an active reservation: when it lapses. For `last_reservation`: when it actually ended.
    pub expires_at: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ListingKind {
    Voluntary,
    Default,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Listing {
    pub ask: U128,
    pub kind: ListingKind,
    pub since: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Lien {
    pub lender: AccountId,
    pub cap: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Recovery {
    pub new_owner: AccountId,
    pub approvals: Vec<AccountId>,
    pub ready_at: Option<U64>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UnitStatus {
    Available,
    Reserved,
    Allocated,
    InDefault,
    HandedOver,
}

impl UnitStatus {
    /// Statuses in which the unit has an allocation token (and so a holder and a vote).
    pub fn has_token(self) -> bool {
        matches!(
            self,
            UnitStatus::Allocated | UnitStatus::InDefault | UnitStatus::HandedOver
        )
    }
}

/// What a pending transfer out of the unit account is for (decides what the callback does).
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OutKind {
    Release,
    Refund,
    Excess,
    ReservationRefund,
    Sweep,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Unit {
    pub id: UnitId,
    pub account: AccountId,
    pub label: String,
    pub price: u128,
    pub status: UnitStatus,
    pub ready: bool,
    pub holder: Option<AccountId>,
    pub allocated_at: Option<u64>,
    pub deposit_owner: Option<AccountId>,
    pub reservation: Option<Reservation>,
    pub last_reservation: Option<Reservation>,
    pub plan: Vec<Instalment>,
    pub paid: u128,
    pub unattributed: u128,
    pub released: u128,
    pub refunded_out: u128,
    pub excess_out: u128,
    pub in_flight: u128,
    pub listing: Option<Listing>,
    pub beneficiary: Option<AccountId>,
    pub guardians: Vec<AccountId>,
    pub recovery: Option<Recovery>,
    pub lien: Option<Lien>,
    pub approvals: HashMap<AccountId, u64>,
    pub next_approval_id: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MilestoneStatus {
    Open,
    Checking,
    Verified,
    Approved,
    Vetoed,
    Missed,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Milestone {
    pub key: String,
    pub title: String,
    pub bps: u16,
    pub deadline: u64,
    pub status: MilestoneStatus,
    pub evidence_ids: Vec<u64>,
    pub verified_at: Option<u64>,
    pub signed_at: Option<u64>,
    pub veto_until: Option<u64>,
}

#[near(serializers = [json])]
pub struct MilestoneInput {
    pub key: String,
    pub title: String,
    pub bps: u16,
    pub deadline: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Capture {
    pub code: String,
    pub by: AccountId,
    pub opened_at: U64,
    pub expires_at: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EvidenceStatus {
    Pending,
    Pass,
    Fail,
    Error,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Default)]
pub struct Verdict {
    pub pass: bool,
    #[serde(default)]
    pub reasons: Vec<String>,
    #[serde(default)]
    pub warnings: Vec<String>,
    #[serde(default)]
    pub phash: String,
    #[serde(default)]
    pub nearest_distance: u8,
    #[serde(default)]
    pub exif_time: Option<U64>,
    #[serde(default)]
    pub gps: Option<(i32, i32)>,
    #[serde(default)]
    pub gps_source: Option<String>,
    #[serde(default)]
    pub distance_m: Option<u32>,
    #[serde(default)]
    pub ai_stage: Option<String>,
    #[serde(default)]
    pub ai_confidence: Option<u8>,
    #[serde(default)]
    pub challenge_read: Option<String>,
    /// The model's short notes on what it saw (SPEC 6.4 `observations`; ≤ 4, shown on the proof page).
    #[serde(default)]
    pub ai_observations: Vec<String>,
    #[serde(default)]
    pub ai_chat_id: Option<String>,
    #[serde(default)]
    pub worker_commit: String,
    #[serde(default)]
    pub attestation: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Evidence {
    pub id: u64,
    pub milestone: u8,
    pub url: String,
    pub sha256: String,
    pub captured_at: u64,
    pub device_gps: Option<(i32, i32)>,
    pub challenge: String,
    pub challenge_opened_at: u64,
    pub submitted_by: AccountId,
    pub submitted_at: u64,
    pub status: EvidenceStatus,
    pub verdict: Option<Verdict>,
    pub raw_response_hash: Option<String>,
    pub error: Option<String>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Freeze {
    pub reason: String,
    pub since: U64,
    pub refunds_open: bool,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Default)]
pub struct DevStatsStored {
    pub units_sold: u32,
    pub units_refunded: u32,
    pub evidence_submitted: u32,
    pub evidence_passed: u32,
    pub signoffs: u32,
    pub vetoes: u32,
    pub units_handed_over: u32,
}

#[near(serializers = [json])]
pub struct DevStats {
    pub milestones_due: u32,
    pub milestones_on_time: u32,
    pub units_sold: u32,
    pub units_refunded: u32,
    pub evidence_submitted: u32,
    pub evidence_passed: u32,
    pub signoffs: u32,
    pub vetoes: u32,
    pub units_handed_over: u32,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub enum ProposalKind {
    ReplaceSurveyor { account: AccountId },
    Veto { milestone: u8 },
    Freeze { reason: String, refunds_open: bool },
    Unfreeze,
    ExtendDeadline { milestone: u8, new_deadline: U64 },
    StepIn { new_payout_id: AccountId },
}

impl ProposalKind {
    pub fn name(&self) -> &'static str {
        match self {
            ProposalKind::ReplaceSurveyor { .. } => "ReplaceSurveyor",
            ProposalKind::Veto { .. } => "Veto",
            ProposalKind::Freeze { .. } => "Freeze",
            ProposalKind::Unfreeze => "Unfreeze",
            ProposalKind::ExtendDeadline { .. } => "ExtendDeadline",
            ProposalKind::StepIn { .. } => "StepIn",
        }
    }
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProposalStatus {
    Open,
    Executed,
    Rejected,
    Expired,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Proposal {
    pub id: u64,
    pub kind: ProposalKind,
    pub proposer: AccountId,
    pub created_at: u64,
    pub expires_at: u64,
    pub electorate: u32,
    pub yes: u32,
    pub no: u32,
    pub voted: Vec<UnitId>,
    pub status: ProposalStatus,
}

#[near(serializers = [json])]
pub struct UnitInput {
    pub id: UnitId,
    pub label: String,
    pub price: U128,
    #[serde(default)]
    pub plan: Vec<Instalment>,
}

#[near(serializers = [json])]
pub struct NewArgs {
    pub developer_id: AccountId,
    pub payout_id: AccountId,
    pub surveyor_id: AccountId,
    pub recovery_id: AccountId,
    pub usdc_id: AccountId,
    pub outlayer_id: AccountId,
    #[serde(default)]
    pub verdict_relayer: Option<AccountId>,
    /// "outlayer" (default: on-chain request_execution + yield/resume) or "https" (relayer submits verdicts)
    #[serde(default)]
    pub verify_mode: Option<String>,
    pub verifier: VerifierSource,
    pub unit_code_hash: Base58CryptoHash,
    pub name: String,
    #[serde(default)]
    pub location: String,
    pub geofence: Geofence,
    pub milestones: Vec<MilestoneInput>,
    pub params: Params,
    pub nft_metadata: near_contract_standards::non_fungible_token::metadata::NFTContractMetadata,
    #[serde(default)]
    pub app_url: Option<String>,
}
