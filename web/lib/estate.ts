// Typed client for every `plote-estate` method in INTERFACE §1.
// Views return promises (via the cached RPC view). Change methods return a TxSpec that the caller
// sends through the wallet (`sendTx`), the login key (`callNoPopup`) or the relayer (surveyor phone).

import { fnCall, ONE_YOCTO, view, ZERO, type TxSpec } from "./near";
import { nearToYocto } from "./format";
import type {
  CaptureView, DevStats, EstateView, EvidenceView, MilestoneView, NftContractMetadata, NftToken,
  ProposalKind, ProposalView, TakenView, U128, U64, UnitInput, UnitView, Verdict, VerifierSource,
} from "./types";

/** Gas in Tgas (SPEC §5.7 starting values, with margin). */
export const GAS = {
  add_units: 240, // 30 per unit, ≤ 8 per call
  fund_verification: 10,
  set_verifier: 10,
  playground_reset: 100,
  reserve: 30,
  cancel_reservation: 100,
  expire_reservation: 100,
  sync: 50,
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
  set_lien: 10,
  clear_lien: 10,
  open_capture: 15,
  submit_evidence: 300,
  submit_verdict: 50,
  qs_sign: 15,
  claim_release: 300,
  withdraw_owed: 50,
  propose: 15,
  vote: 30,
  expire_proposal: 15,
  nft_transfer: 30,
  nft_approve: 30,
  nft_revoke: 15,
} as const;

/** Exactly 0.05 NEAR on reserve (storage, not price). */
export const RESERVE_DEPOSIT = nearToYocto("0.05");
/** ≥ 0.03 NEAR per unit on add_units (unit storage + USDC registration). */
export const ADD_UNIT_DEPOSIT_EACH = nearToYocto("0.03");
export const MAX_UNITS_PER_ADD = 8;
export const MAX_UNITS_PER_CLAIM = 20;
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
  listEvidence: (e: string, opts: { milestone?: number; from_index?: number; limit?: number } = {}) =>
    view<EvidenceView[]>(e, "list_evidence", opts),
  getProposal: (e: string, id: string) => view<ProposalView | null>(e, "get_proposal", { id }),
  listProposals: (e: string, from_index = 0, limit = 50) => view<ProposalView[]>(e, "list_proposals", { from_index, limit }),
  devStats: (e: string) => view<DevStats>(e, "dev_stats"),
  verificationBudget: (e: string) => view<U128>(e, "verification_budget"),
  owedOf: (e: string, account_id: string) => view<U128>(e, "owed_of", { account_id }),
  votesAvailable: (e: string, proposal_id: string, account_id: string) =>
    view<number>(e, "votes_available", { proposal_id, account_id }),
  nftToken: (e: string, token_id: string) => view<NftToken | null>(e, "nft_token", { token_id }),
  nftTokens: (e: string, from_index = "0", limit = 100) => view<NftToken[]>(e, "nft_tokens", { from_index, limit }),
  nftTokensForOwner: (e: string, account_id: string, from_index = "0", limit = 100) =>
    view<NftToken[]>(e, "nft_tokens_for_owner", { account_id, from_index, limit }),
  nftSupplyForOwner: (e: string, account_id: string) => view<string>(e, "nft_supply_for_owner", { account_id }),
  nftTotalSupply: (e: string) => view<string>(e, "nft_total_supply"),
  nftMetadata: (e: string) => view<NftContractMetadata>(e, "nft_metadata"),
  nftIsApproved: (e: string, token_id: string, approved_account_id: string, approval_id?: number) =>
    view<boolean>(e, "nft_is_approved", { token_id, approved_account_id, approval_id }),

  // ---------------- change methods (INTERFACE §1.2) ----------------
  addUnits: (e: string, units: UnitInput[]): TxSpec =>
    fnCall(e, "add_units", { units }, Math.min(300, 30 * Math.max(1, units.length)), (BigInt(ADD_UNIT_DEPOSIT_EACH) * BigInt(units.length)).toString()),
  fundVerification: (e: string, yocto: string): TxSpec => fnCall(e, "fund_verification", {}, GAS.fund_verification, yocto),
  setVerifier: (e: string, verifier: VerifierSource): TxSpec => fnCall(e, "set_verifier", { verifier }, GAS.set_verifier),
  playgroundReset: (e: string): TxSpec => fnCall(e, "playground_reset", {}, GAS.playground_reset),

  reserve: (e: string, unit_id: string): TxSpec => fnCall(e, "reserve", { unit_id }, GAS.reserve, RESERVE_DEPOSIT),
  cancelReservation: (e: string, unit_id: string): TxSpec => fnCall(e, "cancel_reservation", { unit_id }, GAS.cancel_reservation),
  expireReservation: (e: string, unit_id: string): TxSpec => fnCall(e, "expire_reservation", { unit_id }, GAS.expire_reservation),
  sync: (e: string, unit_id: string): TxSpec => fnCall(e, "sync", { unit_id }, GAS.sync),
  refund: (e: string, unit_id: string): TxSpec => fnCall(e, "refund", { unit_id }, GAS.refund, ONE_YOCTO),
  withdrawExcess: (e: string, unit_id: string): TxSpec => fnCall(e, "withdraw_excess", { unit_id }, GAS.withdraw_excess, ONE_YOCTO),
  sweepUnattributed: (e: string, unit_id: string): TxSpec => fnCall(e, "sweep_unattributed", { unit_id }, GAS.sweep_unattributed),
  listForSale: (e: string, unit_id: string, ask: U128): TxSpec => fnCall(e, "list_for_sale", { unit_id, ask }, GAS.list_for_sale),
  cancelListing: (e: string, unit_id: string): TxSpec => fnCall(e, "cancel_listing", { unit_id }, GAS.cancel_listing),
  declareDefault: (e: string, unit_id: string): TxSpec => fnCall(e, "declare_default", { unit_id }, GAS.declare_default),
  handover: (e: string, unit_id: string): TxSpec => fnCall(e, "handover", { unit_id }, GAS.handover),
  setBeneficiary: (e: string, unit_id: string, beneficiary: string | null): TxSpec =>
    fnCall(e, "set_beneficiary", { unit_id, beneficiary }, GAS.set_beneficiary),
  setGuardians: (e: string, unit_id: string, guardians: string[]): TxSpec =>
    fnCall(e, "set_guardians", { unit_id, guardians: guardians.slice(0, MAX_GUARDIANS) }, GAS.set_guardians),
  guardianRecover: (e: string, unit_id: string, new_owner: string): TxSpec =>
    fnCall(e, "guardian_recover", { unit_id, new_owner }, GAS.guardian_recover),
  finishRecovery: (e: string, unit_id: string): TxSpec => fnCall(e, "finish_recovery", { unit_id }, GAS.finish_recovery),
  cancelRecovery: (e: string, unit_id: string): TxSpec => fnCall(e, "cancel_recovery", { unit_id }, GAS.cancel_recovery),
  setLien: (e: string, unit_id: string, lender: string, cap: U128): TxSpec => fnCall(e, "set_lien", { unit_id, lender, cap }, GAS.set_lien),
  clearLien: (e: string, unit_id: string): TxSpec => fnCall(e, "clear_lien", { unit_id }, GAS.clear_lien),

  openCapture: (e: string, milestone: number): TxSpec => fnCall(e, "open_capture", { milestone }, GAS.open_capture),
  submitEvidence: (
    e: string,
    a: { milestone: number; url: string; sha256: string; captured_at: U64; device_gps: [number, number] | null },
  ): TxSpec => fnCall(e, "submit_evidence", a, GAS.submit_evidence),
  submitVerdict: (e: string, evidence_id: U64, verdict: Verdict): TxSpec =>
    fnCall(e, "submit_verdict", { evidence_id, verdict }, GAS.submit_verdict),
  qsSign: (e: string, milestone: number): TxSpec => fnCall(e, "qs_sign", { milestone }, GAS.qs_sign),

  claimRelease: (e: string, unit_ids: string[]): TxSpec =>
    fnCall(e, "claim_release", { unit_ids: unit_ids.slice(0, MAX_UNITS_PER_CLAIM) }, GAS.claim_release),
  withdrawOwed: (e: string): TxSpec => fnCall(e, "withdraw_owed", {}, GAS.withdraw_owed),

  propose: (e: string, kind: ProposalKind): TxSpec => fnCall(e, "propose", { kind }, GAS.propose),
  vote: (e: string, proposal_id: U64, approve: boolean): TxSpec => fnCall(e, "vote", { proposal_id, approve }, GAS.vote),
  expireProposal: (e: string, proposal_id: U64): TxSpec => fnCall(e, "expire_proposal", { proposal_id }, GAS.expire_proposal),

  nftTransfer: (e: string, receiver_id: string, token_id: string, memo?: string): TxSpec =>
    fnCall(e, "nft_transfer", { receiver_id, token_id, memo: memo ?? null }, GAS.nft_transfer, ONE_YOCTO),
  nftApprove: (e: string, token_id: string, account_id: string, msg?: string): TxSpec =>
    fnCall(e, "nft_approve", { token_id, account_id, msg: msg ?? null }, GAS.nft_approve, nearToYocto("0.001")),
  nftRevoke: (e: string, token_id: string, account_id: string): TxSpec =>
    fnCall(e, "nft_revoke", { token_id, account_id }, GAS.nft_revoke, ONE_YOCTO),
};

/** Methods the login function-call key may call (non-payable only). */
export const LOGIN_KEY_METHODS = ["vote", "propose", "expire_proposal", "sync", "sweep_unattributed", "declare_default", "expire_reservation"];
/** Methods the surveyor's phone key may call (SPEC §9.3). */
export const SURVEYOR_KEY_METHODS = ["open_capture", "submit_evidence", "qs_sign"];

export { ZERO };

// ---------------- derived helpers ----------------

export const TAKEN_STATUSES = ["Allocated", "InDefault", "HandedOver"] as const;

export function isTakenStatus(s: string | null | undefined): boolean {
  return !!s && (TAKEN_STATUSES as readonly string[]).includes(s);
}

/** Approved milestone count for the NFT drawing (veto passed). */
export function approvedCount(ms: MilestoneView[] | null | undefined): number {
  return (ms ?? []).filter((m) => m.status === "Approved" && m.veto_passed).length;
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
