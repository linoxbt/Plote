// Types copied verbatim from docs/INTERFACE.md §1.3 (the source of truth for field names and types).
// U128 / U64 values are JSON strings; times are nanoseconds since the Unix epoch.

export type U128 = string;
export type U64 = string;

export type Params = {
  reserve_ttl_ns: string;
  min_initial_bps: number;
  mobilisation_bps: number;
  grace_ns: string;
  veto_window_ns: string;
  default_grace_ns: string;
  penalty_bps: number;
  dust_threshold: string;
  late_claim_ns: string;
  capture_ttl_ns: string;
  proposal_period_ns: string;
  max_phash_distance: number;
  max_exif_age_h: number;
  min_ai_confidence: number;
  demo_mode: boolean;
  playground: boolean;
};

export type EstateView = {
  name: string; location: string; account: string; app_url: string;
  developer_id: string; payout_id: string; surveyor_id: string; recovery_id: string;
  usdc_id: string; outlayer_id: string; verdict_relayer: string | null;
  verify_mode: "outlayer" | "https";
  verifier: { repo: string; commit: string; build_target: string };
  unit_code_hash: string | null;
  geofence: { lat_e6: number; lon_e6: number; radius_m: number };
  params: Params;                       // same keys as init; u64/u128 as strings
  frozen: { reason: string; since: string; refunds_open: boolean } | null;
  payout_redirect: string | null;       // set by an executed StepIn
  unit_count: number; allocated_count: number; available_count: number;
  totals: { paid: string; released: string; refunded: string; in_escrow: string };
  stats: DevStats;
  verification_budget: string;
  refunds_open: boolean;                // a missed deadline + grace, or a Freeze with refunds
  now: string;                          // block timestamp at view time
};

export type UnitStatus = "Available" | "Reserved" | "Allocated" | "InDefault" | "HandedOver";

export type UnitView = {
  id: string; account: string; label: string; price: string; status: UnitStatus;
  ready: boolean;            // account created and registered on USDC (else reserve/pay are refused; see retry_unit_setup)
  holder: string | null; allocated_at: string | null;
  reservation: { by: string; expires_at: string } | null;
  last_reservation: { by: string; expires_at: string } | null;
  plan: { due_at: string; cumulative: string }[];
  paid: string; unattributed: string; released: string; refunded_out: string; in_flight: string;
  listing: { ask: string; kind: "Voluntary" | "Default"; since: string } | null;
  beneficiary: string | null; guardians: string[];
  recovery: { new_owner: string; approvals: string[]; ready_at: string | null } | null;
  lien: { lender: string; cap: string } | null;
  // computed
  refundable_now: string;    // what refund() would pay right now ("0" if refunds aren't open)
  releasable_now: string;    // what claim_release would move right now
  excess_now: string;        // what withdraw_excess would pay
  refunds_open: boolean;
  next_due: { due_at: string; cumulative: string; shortfall: string } | null;
  progress_bps: number;      // approved (veto passed) bps incl. mobilisation
  approved_bps: number;      // same as progress_bps (kept for clarity)
};

export type TakenView = {
  exists: boolean; status: UnitStatus | null; holder: string | null;
  /** Net of refunds (paid − refunded_out). */
  paid: string; released: string; price: string; label: string | null;
  account: string | null; reserved_until: string | null; allocated_at: string | null;
};

export type MilestoneStatus = "Open" | "Checking" | "Verified" | "Approved" | "Vetoed" | "Missed";
export type MilestoneView = {
  index: number; key: string; title: string; bps: number; deadline: string;
  status: MilestoneStatus;              // Missed is computed at view time
  late: boolean;                        // deadline + grace passed without a timely sign-off (refunds open)
  evidence_ids: string[]; verified_at: string | null; signed_at: string | null;
  veto_until: string | null; veto_passed: boolean;   // Approved and veto window over
  refunds_open_at: string;             // deadline + grace
};

export type CaptureView = { milestone: number; code: string; by: string; opened_at: string; expires_at: string };

export type Verdict = {
  pass: boolean; reasons: string[]; warnings: string[];
  phash: string; nearest_distance: number;
  exif_time: string | null; gps: [number, number] | null; gps_source: "exif" | "device" | null;
  distance_m: number | null; ai_stage: string | null; ai_confidence: number | null;
  challenge_read: string | null; ai_chat_id: string | null; ai_observations?: string[];
  /** The NEAR AI model id that judged the stage. Added by newer verifier builds; absent on older verdicts. */
  ai_model?: string | null;
  worker_commit: string; attestation: string | null;
  /** Absent on verdicts stored before the field existed (the contract keeps it as an Option). */
  source?: "outlayer" | "https" | null;
};

export type EvidenceStatus = "Pending" | "Pass" | "Fail" | "Error";

export type EvidenceView = {
  id: string; milestone: number; url: string; sha256: string; captured_at: string;
  device_gps: [number, number] | null; challenge: string; challenge_opened_at: string;
  submitted_by: string; submitted_at: string;
  status: EvidenceStatus;
  verdict: Verdict | null; raw_response_hash: string | null; error: string | null;
  /** The worker's NEAR AI model id (≤ 64 chars), stored beside the evidence. Absent on older estates. */
  ai_model?: string | null;
};

/** A pending surplus booking (`get_surplus_request`): finalize from `ready_at` (7 days after `at`). */
export type SurplusRequest = { at: string; amount: string; ready_at: string };

export type ProposalStatus = "Open" | "Executed" | "Rejected" | "Expired";

export type ProposalView = {
  id: string; kind: unknown /* ProposalKind */; proposer: string;
  created_at: string; expires_at: string;
  /** With `weighted`: whole USDC of min(paid, price) per token; otherwise token counts (proposals opened before the rule). */
  electorate: number; yes: number; no: number;
  voted: string[]; status: ProposalStatus;
  weighted: boolean;
  /** Every kind but Veto also needs a strict majority of distinct eligible holders (audit 3): holders_yes * 2 > holders_eligible. */
  holders_eligible: number; holders_yes: number; holders_no: number;
};

/** A lien the holder set that the lender hasn't accepted yet (`get_pending_lien`). */
export type PendingLien = { lender: string; cap: string };

export type DevStats = {
  milestones_due: number; milestones_on_time: number; units_sold: number; units_refunded: number;
  evidence_submitted: number; evidence_passed: number; signoffs: number; vetoes: number;
  units_handed_over: number;
};

// ProposalKind (serde externally tagged), INTERFACE §1.2
export type ProposalKind =
  | { ReplaceSurveyor: { account: string } }
  | { Veto: { milestone: number } }
  | { Freeze: { reason: string; refunds_open: boolean } }
  | "Unfreeze"
  | { ExtendDeadline: { milestone: number; new_deadline: U64 } }
  | { StepIn: { new_payout_id: string } };

export type VerifierSource = { repo: string; commit: string; build_target: string };

export type UnitInput = {
  id: string;
  label: string;
  price: U128;
  plan: { due_at: U64; cumulative: U128 }[];
};

// NEP-171 / NEP-177 token as returned by nft_token (metadata.media = live SVG data URI)
export type NftToken = {
  token_id: string;
  owner_id: string;
  metadata?: {
    title?: string | null;
    description?: string | null;
    media?: string | null;
    extra?: string | null;
    reference?: string | null;
  } | null;
  approved_account_ids?: Record<string, number> | null;
};

export type NftContractMetadata = {
  spec: string; name: string; symbol: string; icon: string | null;
  base_uri: string | null; reference: string | null; reference_hash: string | null;
};

export type StorageBalance = { total: string; available: string };
export type StorageBalanceBounds = { min: string; max: string | null };
export type FtMetadata = { spec: string; name: string; symbol: string; decimals: number; icon?: string | null };
