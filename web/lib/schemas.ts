// Runtime shapes of the main estate views (docs/INTERFACE.md §1.3). `view()` only JSON-parses what the RPC returns;
// these schemas check the fields the app relies on before a page renders or a payment is built from them, so a
// contract that answers in an unexpected shape fails with a clear error instead of `undefined` deep in the UI.
// Objects are loose: fields added later (e.g. `Verdict.ai_model`) pass through untouched.

import { z } from "zod";

const str = z.string();
const nstr = z.string().nullable();
const num = z.number();
const bool = z.boolean();
/** U128 / U64 as JSON strings of digits. */
const amount = z.string().regex(/^\d+$/, "expected a number as a string");

const UnitStatus = z.enum(["Available", "Reserved", "Allocated", "InDefault", "HandedOver"]);
const MilestoneStatus = z.enum(["Open", "Checking", "Verified", "Approved", "Vetoed", "Missed"]);

export const ParamsSchema = z.looseObject({
  reserve_ttl_ns: amount,
  min_initial_bps: num,
  mobilisation_bps: num,
  grace_ns: amount,
  veto_window_ns: amount,
  default_grace_ns: amount,
  penalty_bps: num,
  dust_threshold: amount,
  late_claim_ns: amount,
  capture_ttl_ns: amount,
  proposal_period_ns: amount,
  max_phash_distance: num,
  max_exif_age_h: num,
  min_ai_confidence: num,
  demo_mode: bool,
  playground: bool,
});

export const EstateViewSchema = z.looseObject({
  name: str,
  location: str,
  account: str,
  developer_id: str,
  payout_id: str,
  surveyor_id: str,
  usdc_id: str,
  outlayer_id: str,
  verdict_relayer: nstr,
  verify_mode: z.enum(["outlayer", "https"]),
  verifier: z.looseObject({ repo: str, commit: str, build_target: str }),
  unit_code_hash: nstr,
  geofence: z.looseObject({ lat_e6: num, lon_e6: num, radius_m: num }),
  params: ParamsSchema,
  frozen: z.looseObject({ reason: str, since: amount, refunds_open: bool }).nullable(),
  payout_redirect: nstr,
  unit_count: num,
  allocated_count: num,
  available_count: num,
  totals: z.looseObject({ paid: amount, released: amount, refunded: amount, in_escrow: amount }),
  verification_budget: amount,
  refunds_open: bool,
  now: amount,
});

const Reservation = z.looseObject({ by: str, expires_at: amount });
const Instalment = z.looseObject({ due_at: amount, cumulative: amount });

export const UnitViewSchema = z.looseObject({
  id: str,
  account: str,
  label: str,
  price: amount,
  status: UnitStatus,
  ready: bool,
  holder: nstr,
  allocated_at: amount.nullable(),
  reservation: Reservation.nullable(),
  last_reservation: Reservation.nullable(),
  plan: z.array(Instalment),
  paid: amount,
  unattributed: amount,
  released: amount,
  refunded_out: amount,
  in_flight: amount,
  listing: z.looseObject({ ask: amount, kind: z.enum(["Voluntary", "Default"]), since: amount }).nullable(),
  beneficiary: nstr,
  guardians: z.array(str),
  recovery: z.looseObject({ new_owner: str, approvals: z.array(str), ready_at: amount.nullable() }).nullable(),
  lien: z.looseObject({ lender: str, cap: amount }).nullable(),
  refundable_now: amount,
  releasable_now: amount,
  excess_now: amount,
  refunds_open: bool,
  next_due: z.looseObject({ due_at: amount, cumulative: amount, shortfall: amount }).nullable(),
  progress_bps: num,
  approved_bps: num,
});

export const TakenViewSchema = z.looseObject({
  exists: bool,
  status: UnitStatus.nullable(),
  holder: nstr,
  paid: amount,
  released: amount,
  price: amount,
  label: nstr,
  account: nstr,
  reserved_until: amount.nullable(),
  allocated_at: amount.nullable(),
});

export const MilestoneViewSchema = z.looseObject({
  index: num,
  key: str,
  title: str,
  bps: num,
  deadline: amount,
  status: MilestoneStatus,
  late: bool,
  evidence_ids: z.array(amount),
  verified_at: amount.nullable(),
  signed_at: amount.nullable(),
  veto_until: amount.nullable(),
  veto_passed: bool,
  refunds_open_at: amount,
});

export const CaptureViewSchema = z.looseObject({ milestone: num, code: str, by: str, opened_at: amount, expires_at: amount });

export const VerdictSchema = z.looseObject({
  pass: bool,
  reasons: z.array(str),
  warnings: z.array(str),
  phash: str,
  nearest_distance: num,
  worker_commit: str,
  // optional across verifier versions
  ai_observations: z.array(str).optional(),
  ai_model: nstr.optional(),
  source: z.enum(["outlayer", "https"]).nullable().optional(),
});

export const EvidenceViewSchema = z.looseObject({
  id: amount,
  milestone: num,
  url: str,
  sha256: str,
  captured_at: amount,
  challenge: str,
  challenge_opened_at: amount,
  submitted_by: str,
  submitted_at: amount,
  status: z.enum(["Pending", "Pass", "Fail", "Error"]),
  verdict: VerdictSchema.nullable(),
  raw_response_hash: nstr,
  error: nstr,
});

export const ProposalViewSchema = z.looseObject({
  id: amount,
  kind: z.unknown(),
  proposer: str,
  created_at: amount,
  expires_at: amount,
  electorate: num,
  yes: num,
  no: num,
  voted: z.array(str),
  weighted: bool,
  holders_eligible: num,
  holders_yes: num,
  holders_no: num,
  status: z.enum(["Open", "Executed", "Rejected", "Expired"]),
});

export const PendingLienSchema = z.looseObject({ lender: str, cap: amount });
