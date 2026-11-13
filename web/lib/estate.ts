// Typed client for every `plote-estate` method in INTERFACE §1.
// Views return promises (via the cached RPC view). Change methods return a TxSpec that the caller
// sends through the wallet (`sendTx`), the login key (`callNoPopup`) or the relayer (surveyor phone).

import { z } from "zod";
import { fnCall, ONE_YOCTO, view, viewChecked, ZERO, type TxSpec } from "./near";
import { nearToYocto } from "./format";
import {
  CaptureViewSchema, EstateViewSchema, EvidenceViewSchema, MilestoneViewSchema, PendingLienSchema, ProposalViewSchema, SurplusRequestSchema, TakenViewSchema, UnitViewSchema,
} from "./schemas";
import type {
  CaptureView, DevStats, EstateView, EvidenceView, MilestoneView, NftContractMetadata, NftToken, PendingLien, SurplusRequest,
  ProposalKind, ProposalView, TakenView, U128, U64, UnitInput, UnitView, Verdict, VerifierSource,
} from "./types";

/** Gas in Tgas (SPEC §5.7 starting values, with margin). */
export const GAS = {
  add_units: 240, // 30 per unit, ≤ 8 per call
  fund_verification: 10,
  set_verifier: 10,
  playground_reset: 100,
  reserve: 30,
  cancel_reservation: 150, // transfer_out 25 + on_out 60 (may re-route a failed refund to `owed`)
  expire_reservation: 150,
  sync: 50,
  report_deposit: 100, // two chained balance reads + two callbacks (≈ 70 Tgas attached inside)
  set_app_url: 10,
  retry_unit_setup: 50,
  reopen_stale_check: 15,
  refund: 100,
  withdraw_excess: 100,
  sweep_unattributed: 100,
  list_for_sale: 15,
  cancel_listing: 15,
  declare_default: 15,
  handover: 15,
  set_beneficiary: 10,
  set_guardians: 10,
  guardian_recover: 15,
  finish_recovery: 15,
  cancel_recovery: 10,
  request_surplus_booking: 50, // one balance read + callback
  finalize_surplus_booking: 150, // two chained balance reads, the booking and the transfer in one flow (the contract needs ≥ 150 Tgas)
  set_lien: 10,
  accept_lien: 10,
  clear_lien: 10,
  open_capture: 15,
  submit_evidence: 300,
  submit_verdict: 50,
  qs_sign: 15,
  claim_release: 300,
  withdraw_owed: 50,
  propose: 100, // checks the quorum over every unit
  vote: 100, // walks the caller's eligible tokens (≤ 50 per call) and re-counts distinct holders
  expire_proposal: 15,
  nft_transfer: 30,
  nft_approve: 30,
  nft_revoke: 15,
  nft_revoke_all: 15,
} as const;

/** Exactly 0.05 NEAR on reserve (storage, not price). */
export const RESERVE_DEPOSIT = nearToYocto("0.05");
/** ≥ 0.035 NEAR per unit on add_units (unit account funding + USDC registration + the unit record). */
export const ADD_UNIT_DEPOSIT_EACH = nearToYocto("0.035");
export const MAX_UNITS_PER_ADD = 8;
export const MAX_UNITS_PER_CLAIM = 6;
export const MAX_GUARDIANS = 3;

export const estate = {
  // ---------------- views (INTERFACE §1.3) ----------------
  getEstate: (e: string) => view<EstateView>(e, "get_estate"),
  getUnit: (e: string, unit_id: string) => view<UnitView | null>(e, "get_unit", { unit_id }),
  listUnits: (e: string, from_index = 0, limit = 100) => view<UnitView[]>(e, "list_units", { from_index, limit }),
  isTaken: (e: string, unit_id: string) => view<TakenView>(e, "is_taken", { unit_id }),
  getMilestones: (e: string) => view<MilestoneView[]>(e, "get_milestones"),
  getCapture: (e: string, milestone: number) => view<CaptureView | null>(e, "get_capture", { milestone }),
  getEvidence: (e: string, id: string) => view<EvidenceView | null>(e, "get_evidence", { id }),
  checkInput: (e: string, evidence_id: string) => view<string | null>(e, "check_input", { evidence_id }, { fresh: true }),
  listEvidence: (e: string, opts: { milestone?: number; from_index?: number; limit?: number } = {}) =>
    view<EvidenceView[]>(e, "list_evidence", opts),
  getProposal: (e: string, id: string) => view<ProposalView | null>(e, "get_proposal", { id }),
  listProposals: (e: string, from_index = 0, limit = 50) => view<ProposalView[]>(e, "list_proposals", { from_index, limit }),
  devStats: (e: string) => view<DevStats>(e, "dev_stats"),
  verificationBudget: (e: string) => view<U128>(e, "verification_budget"),
  owedOf: (e: string, account_id: string) => view<U128>(e, "owed_of", { account_id }),
  votesAvailable: (e: string, proposal_id: string, account_id: string) =>
    view<number>(e, "votes_available", { proposal_id, account_id }),
  /** The weight (whole USDC of min(paid, price) per token) `vote` would cast now. */
  voteWeightAvailable: (e: string, proposal_id: string, account_id: string) =>
    view<number>(e, "vote_weight_available", { proposal_id, account_id }),
  nftToken: (e: string, token_id: string) => view<NftToken | null>(e, "nft_token", { token_id }),
  nftTokens: (e: string, from_index = "0", limit = 100) => view<NftToken[]>(e, "nft_tokens", { from_index, limit }),
  nftTokensForOwner: (e: string, account_id: string, from_index = "0", limit = 100) =>
    view<NftToken[]>(e, "nft_tokens_for_owner", { account_id, from_index, limit }),
  nftSupplyForOwner: (e: string, account_id: string) => view<string>(e, "nft_supply_for_owner", { account_id }),
  nftTotalSupply: (e: string) => view<string>(e, "nft_total_supply"),
  nftMetadata: (e: string) => view<NftContractMetadata>(e, "nft_metadata"),
  nftIsApproved: (e: string, token_id: string, approved_account_id: string, approval_id?: number) =>
    view<boolean>(e, "nft_is_approved", { token_id, approved_account_id, approval_id }),
  /** A lien the holder set that its lender hasn't accepted yet, or null. */
  /** A pending surplus booking for a unit, or null. */
  getSurplusRequest: (e: string, unit_id: string) => viewChecked<SurplusRequest | null>(e, "get_surplus_request", { unit_id }, SurplusRequestSchema.nullable()),
  getPendingLien: (e: string, unit_id: string) => viewChecked<PendingLien | null>(e, "get_pending_lien", { unit_id }, PendingLienSchema.nullable()),

  // ---------------- change methods (INTERFACE §1.2) ----------------
  /** Developer. Returns nothing: each unit's account is created asynchronously (`UnitView.ready` turns true when done). */
  addUnits: (e: string, units: UnitInput[]): TxSpec =>
    fnCall(e, "add_units", { units }, Math.min(300, 30 * Math.max(1, units.length)), (BigInt(ADD_UNIT_DEPOSIT_EACH) * BigInt(units.length)).toString()),
  fundVerification: (e: string, yocto: string): TxSpec => fnCall(e, "fund_verification", {}, GAS.fund_verification, yocto),
  /** Developer: repoint the verifier (before the first sale; any time on the playground). 1 yocto (full-access key). */
  setVerifier: (e: string, verifier: VerifierSource): TxSpec => fnCall(e, "set_verifier", { verifier }, GAS.set_verifier, ONE_YOCTO),
  /** Developer: correct the NFT `reference` app URL (https, ≤ 200 chars). 1 yocto (full-access key). */
  setAppUrl: (e: string, url: string): TxSpec => fnCall(e, "set_app_url", { url }, GAS.set_app_url, ONE_YOCTO),
  /** Developer: finish a unit whose USDC registration failed; attach ≥ 0.00125 NEAR. */
  retryUnitSetup: (e: string, unit_id: string): TxSpec =>
    fnCall(e, "retry_unit_setup", { unit_id }, GAS.retry_unit_setup, nearToYocto("0.00125")),
  playgroundReset: (e: string): TxSpec => fnCall(e, "playground_reset", {}, GAS.playground_reset),

  reserve: (e: string, unit_id: string): TxSpec => fnCall(e, "reserve", { unit_id }, GAS.reserve, RESERVE_DEPOSIT),
  cancelReservation: (e: string, unit_id: string): TxSpec => fnCall(e, "cancel_reservation", { unit_id }, GAS.cancel_reservation, ONE_YOCTO),
  expireReservation: (e: string, unit_id: string): TxSpec => fnCall(e, "expire_reservation", { unit_id }, GAS.expire_reservation),
  /** Anyone: CHECK the unit's USDC balance against its books (logs `balance_checked`). Credits nothing. */
  sync: (e: string, unit_id: string): TxSpec => fnCall(e, "sync", { unit_id }, GAS.sync),
  /**
   * Deposit reporter only (the estate's `verdict_relayer` = the server's relayer account): book a plain-transfer
   * (1Click) delivery. `amount` = delivered USDC in base units (1Click status `swapDetails.amountOut`). The estate
   * credits min(amount, surplus seen in two chained balance reads); fails E_BALANCE_PENDING (retry) if the unit's
   * books changed meanwhile, E_IN_FLIGHT while a transfer out is pending. No deposit.
   */
  reportDeposit: (e: string, unit_id: string, amount: U128, deferred?: boolean): TxSpec =>
    fnCall(e, "report_deposit", deferred ? { unit_id, amount, deferred: true } : { unit_id, amount }, GAS.report_deposit),
  refund: (e: string, unit_id: string): TxSpec => fnCall(e, "refund", { unit_id }, GAS.refund, ONE_YOCTO),
  withdrawExcess: (e: string, unit_id: string): TxSpec => fnCall(e, "withdraw_excess", { unit_id }, GAS.withdraw_excess, ONE_YOCTO),
  sweepUnattributed: (e: string, unit_id: string): TxSpec => fnCall(e, "sweep_unattributed", { unit_id }, GAS.sweep_unattributed),
  /** Developer or recovery_id, on a unit with no holder, reservation or booked escrow: record its stray USDC (starts the 7-day delay). No deposit. */
  requestSurplusBooking: (e: string, unit_id: string): TxSpec => fnCall(e, "request_surplus_booking", { unit_id }, GAS.request_surplus_booking),
  /** Developer or recovery_id, ≥ 7 days after the request: book what is still seen and send it on, like a sweep (E_TIMELOCK before). */
  finalizeSurplusBooking: (e: string, unit_id: string): TxSpec => fnCall(e, "finalize_surplus_booking", { unit_id }, GAS.finalize_surplus_booking),
  listForSale: (e: string, unit_id: string, ask: U128): TxSpec => fnCall(e, "list_for_sale", { unit_id, ask }, GAS.list_for_sale, ONE_YOCTO),
  cancelListing: (e: string, unit_id: string): TxSpec => fnCall(e, "cancel_listing", { unit_id }, GAS.cancel_listing, ONE_YOCTO),
  declareDefault: (e: string, unit_id: string): TxSpec => fnCall(e, "declare_default", { unit_id }, GAS.declare_default),
  // Holder / guardian / lender methods that change who may take the token or its money: 1 yocto (wallet only).
  handover: (e: string, unit_id: string): TxSpec => fnCall(e, "handover", { unit_id }, GAS.handover, ONE_YOCTO),
  setBeneficiary: (e: string, unit_id: string, beneficiary: string | null): TxSpec =>
    fnCall(e, "set_beneficiary", { unit_id, beneficiary }, GAS.set_beneficiary, ONE_YOCTO),
  setGuardians: (e: string, unit_id: string, guardians: string[]): TxSpec =>
    fnCall(e, "set_guardians", { unit_id, guardians: guardians.slice(0, MAX_GUARDIANS) }, GAS.set_guardians, ONE_YOCTO),
  guardianRecover: (e: string, unit_id: string, new_owner: string): TxSpec =>
    fnCall(e, "guardian_recover", { unit_id, new_owner }, GAS.guardian_recover, ONE_YOCTO),
  finishRecovery: (e: string, unit_id: string): TxSpec => fnCall(e, "finish_recovery", { unit_id }, GAS.finish_recovery),
  cancelRecovery: (e: string, unit_id: string): TxSpec => fnCall(e, "cancel_recovery", { unit_id }, GAS.cancel_recovery, ONE_YOCTO),
  /** Holder: name a lender. The lien is PENDING until the lender calls `accept_lien`. */
  setLien: (e: string, unit_id: string, lender: string, cap: U128): TxSpec =>
    fnCall(e, "set_lien", { unit_id, lender, cap }, GAS.set_lien, ONE_YOCTO),
  /** Lender: activate a pending lien naming you. 1 yocto. */
  acceptLien: (e: string, unit_id: string): TxSpec => fnCall(e, "accept_lien", { unit_id }, GAS.accept_lien, ONE_YOCTO),
  clearLien: (e: string, unit_id: string): TxSpec => fnCall(e, "clear_lien", { unit_id }, GAS.clear_lien, ONE_YOCTO),

  openCapture: (e: string, milestone: number): TxSpec => fnCall(e, "open_capture", { milestone }, GAS.open_capture),
  submitEvidence: (
    e: string,
    a: { milestone: number; url: string; sha256: string; captured_at: U64; device_gps: [number, number] | null },
  ): TxSpec => fnCall(e, "submit_evidence", a, GAS.submit_evidence),
  submitVerdict: (e: string, evidence_id: U64, verdict: Verdict): TxSpec =>
    fnCall(e, "submit_verdict", { evidence_id, verdict }, GAS.submit_verdict),
  qsSign: (e: string, milestone: number): TxSpec => fnCall(e, "qs_sign", { milestone }, GAS.qs_sign),
  /** Anyone: reopen a milestone stuck in Checking ≥ 1 h after its latest evidence (E_CHECK_PENDING before). */
  reopenStaleCheck: (e: string, milestone: number): TxSpec => fnCall(e, "reopen_stale_check", { milestone }, GAS.reopen_stale_check),

  claimRelease: (e: string, unit_ids: string[]): TxSpec =>
    fnCall(e, "claim_release", { unit_ids: unit_ids.slice(0, MAX_UNITS_PER_CLAIM) }, GAS.claim_release),
  withdrawOwed: (e: string): TxSpec => fnCall(e, "withdraw_owed", {}, GAS.withdraw_owed),

  /** Opening a proposal attaches PROPOSAL_DEPOSIT, which the estate keeps (anti-spam), so it always needs the wallet. */
  propose: (e: string, kind: ProposalKind): TxSpec => fnCall(e, "propose", { kind }, GAS.propose, PROPOSAL_DEPOSIT),
  vote: (e: string, proposal_id: U64, approve: boolean): TxSpec => fnCall(e, "vote", { proposal_id, approve }, GAS.vote),
  expireProposal: (e: string, proposal_id: U64): TxSpec => fnCall(e, "expire_proposal", { proposal_id }, GAS.expire_proposal),

  nftTransfer: (e: string, receiver_id: string, token_id: string, memo?: string): TxSpec =>
    fnCall(e, "nft_transfer", { receiver_id, token_id, memo: memo ?? null }, GAS.nft_transfer, ONE_YOCTO),
  nftApprove: (e: string, token_id: string, account_id: string, msg?: string): TxSpec =>
    fnCall(e, "nft_approve", { token_id, account_id, msg: msg ?? null }, GAS.nft_approve, nearToYocto("0.001")),
  nftRevoke: (e: string, token_id: string, account_id: string): TxSpec =>
    fnCall(e, "nft_revoke", { token_id, account_id }, GAS.nft_revoke, ONE_YOCTO),
  nftRevokeAll: (e: string, token_id: string): TxSpec => fnCall(e, "nft_revoke_all", { token_id }, GAS.nft_revoke_all, ONE_YOCTO),
};

/**
 * Methods the login function-call key may call (non-payable only). Requested at sign-in (SPEC §9.1:
 * `sync`, `qs_sign`, `submit_evidence`, plus votes §8.4) so frequent calls don't open the wallet.
 */
export const LOGIN_KEY_METHODS = [
  "vote", "expire_proposal", "sync", "sweep_unattributed", "declare_default", "expire_reservation",
  "open_capture", "submit_evidence", "qs_sign", "reopen_stale_check",
];
/** The developer's day-to-day key (SPEC §4 "Keys on each account"): claims. Proposals carry a deposit, so they use the wallet. */
export const DEV_KEY_METHODS = ["claim_release"];
/** Methods the surveyor's phone key may call (SPEC §9.3). */
export const SURVEYOR_KEY_METHODS = ["open_capture", "submit_evidence", "qs_sign"];

export { ZERO };
/** 0.05 NEAR, kept by the estate (contract `PROPOSAL_DEPOSIT`). */
export const PROPOSAL_DEPOSIT = "50000000000000000000000";

/**
 * The main views with a runtime shape check (lib/schemas.ts), for the browser: a contract that answers in an
 * unexpected shape fails with a clear BAD_VIEW error instead of rendering garbage or building a payment from it.
 */
export const checkedViews = {
  getEstate: (e: string, opts?: { fresh?: boolean }) => viewChecked<EstateView>(e, "get_estate", {}, EstateViewSchema, opts),
  getUnit: (e: string, unit_id: string, opts?: { fresh?: boolean }) => viewChecked<UnitView | null>(e, "get_unit", { unit_id }, UnitViewSchema.nullable(), opts),
  listUnits: (e: string, from_index = 0, limit = 100) => viewChecked<UnitView[]>(e, "list_units", { from_index, limit }, z.array(UnitViewSchema)),
  isTaken: (e: string, unit_id: string) => viewChecked<TakenView>(e, "is_taken", { unit_id }, TakenViewSchema),
  getMilestones: (e: string, opts?: { fresh?: boolean }) => viewChecked<MilestoneView[]>(e, "get_milestones", {}, z.array(MilestoneViewSchema), opts),
  getCapture: (e: string, milestone: number, opts?: { fresh?: boolean }) => viewChecked<CaptureView | null>(e, "get_capture", { milestone }, CaptureViewSchema.nullable(), opts),
  getEvidence: (e: string, id: string, opts?: { fresh?: boolean }) => viewChecked<EvidenceView | null>(e, "get_evidence", { id }, EvidenceViewSchema.nullable(), opts),
  listEvidence: (e: string, opts: { milestone?: number; from_index?: number; limit?: number } = {}) =>
    viewChecked<EvidenceView[]>(e, "list_evidence", opts, z.array(EvidenceViewSchema)),
  getProposal: (e: string, id: string) => viewChecked<ProposalView | null>(e, "get_proposal", { id }, ProposalViewSchema.nullable()),
  listProposals: (e: string, from_index = 0, limit = 50) => viewChecked<ProposalView[]>(e, "list_proposals", { from_index, limit }, z.array(ProposalViewSchema)),
};

// ---------------- derived helpers ----------------

/** Approved milestone count with the veto window passed (what releases count). */
export function approvedCount(ms: MilestoneView[] | null | undefined): number {
  return (ms ?? []).filter((m) => m.status === "Approved" && m.veto_passed).length;
}

/** The count the contract's NFT image draws (`approved_count`: every Approved milestone, veto window or not). Pass
 *  this as `approvedCount` to houseSvg to get the exact on-chain SVG. */
export function nftApprovedCount(ms: MilestoneView[] | null | undefined): number {
  return (ms ?? []).filter((m) => m.status === "Approved").length;
}

/** The first milestone not yet approved, or null when all are done. */
export function currentMilestone(ms: MilestoneView[] | null | undefined): MilestoneView | null {
  return (ms ?? []).find((m) => !(m.status === "Approved" && m.veto_passed)) ?? null;
}

export function proposalKindName(kind: unknown): string {
  if (typeof kind === "string") return kind;
  if (kind && typeof kind === "object") return Object.keys(kind)[0] ?? "Unknown";
  return "Unknown";
}

export function describeProposal(kind: unknown, milestones?: MilestoneView[]): string {
  const name = proposalKindName(kind);
  const body = kind && typeof kind === "object" ? (kind as Record<string, Record<string, unknown>>)[name] ?? {} : {};
  const mTitle = (i: unknown) => milestones?.[Number(i)]?.title ?? `milestone ${Number(i) + 1}`;
  switch (name) {
    case "ReplaceSurveyor": return `Replace the surveyor with ${String(body.account)}`;
    case "Veto": return `Veto the sign-off on ${mTitle(body.milestone)}`;
    case "Freeze": return `Freeze releases${body.refunds_open ? " and open refunds" : ""}: “${String(body.reason)}”`;
    case "Unfreeze": return "Lift the freeze on releases";
    case "ExtendDeadline": return `Extend the ${mTitle(body.milestone)} deadline`;
    case "StepIn": return `Send future releases to ${String(body.new_payout_id)}`;
    default: return name;
  }
}
