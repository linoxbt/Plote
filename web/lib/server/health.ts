// Data-driven checks for /api/health and the poller's alerts.

import { ESTATES } from "../config";
import { viewAccount, viewUncached } from "../near";
import type { EstateView, EvidenceView } from "../types";
import { serverEnv } from "./env";

/** Reason codes that mean the checking pipeline (NEAR AI, the worker, OutLayer) failed rather than the photo. */
export const INFRA_REASONS = ["ai_unavailable", "challenge_unverified", "worker_error"] as const;
export const PHOTO_CHECK_WINDOW = 5;
export const PHOTO_CHECK_MIN_SAMPLE = 3;

export type PhotoChecks = { ok: boolean; detail: string; reason?: string; sample: number };

function infraFailed(e: Pick<EvidenceView, "status" | "verdict">): boolean {
  if (e.status === "Error") return true;
  const codes = [...(e.verdict?.reasons ?? []), ...(e.verdict?.warnings ?? [])];
  return codes.some((c) => (INFRA_REASONS as readonly string[]).includes(c));
}

/**
 * Photo checks are failing when each of the latest `n` (up to 5) decided verdicts across all estates (Pass/Fail/Error,
 * newest first by submitted_at) carries ai_unavailable, challenge_unverified or worker_error (also as a demo-mode
 * warning), or errored. Fewer than `minSample` (3) decided verdicts: not enough data, reported ok.
 */
export function photoCheckStatus(evidence: Pick<EvidenceView, "status" | "verdict" | "submitted_at">[], n = PHOTO_CHECK_WINDOW, minSample = PHOTO_CHECK_MIN_SAMPLE): PhotoChecks {
  const decided = evidence
    .filter((e) => e.status !== "Pending")
    .sort((a, b) => (BigInt(b.submitted_at || "0") > BigInt(a.submitted_at || "0") ? 1 : BigInt(b.submitted_at || "0") < BigInt(a.submitted_at || "0") ? -1 : 0))
    .slice(0, n);
  if (decided.length < Math.min(n, minSample)) return { ok: true, detail: `only ${decided.length} decided verdicts so far`, sample: decided.length };
  const bad = decided.filter(infraFailed);
  if (bad.length === decided.length) {
    const codes = new Set<string>();
    for (const e of bad) {
      if (e.status === "Error") codes.add("worker_error");
      for (const c of [...(e.verdict?.reasons ?? []), ...(e.verdict?.warnings ?? [])]) if ((INFRA_REASONS as readonly string[]).includes(c)) codes.add(c);
    }
    const reason = `the last ${decided.length} photo checks all reported ${[...codes].sort().join("/")}`;
    return { ok: false, detail: reason, reason, sample: decided.length };
  }
  return { ok: true, detail: `${decided.length - bad.length} of the last ${decided.length} checks ran normally`, sample: decided.length };
}

/** Latest evidence of every configured estate (10 each), for photoCheckStatus. Estates that can't be read are skipped. */
export async function recentEvidence(estates: string[] = ESTATES): Promise<EvidenceView[]> {
  const lists = await Promise.all(estates.map((e) => viewUncached<EvidenceView[]>(e, "list_evidence", { limit: 10 }).catch(() => [] as EvidenceView[])));
  return lists.flat();
}

const YOCTO = 10n ** 24n;
export const ACCOUNT_MIN = YOCTO / 2n; // 0.5 NEAR: enough gas for claim_release / withdraw_owed for a while
const nearStr = (y: bigint) => (Number(y / 10n ** 21n) / 1000).toFixed(2);

export type AccountCheck = { ok: boolean; detail: string; low: string[] };

/**
 * NEAR balance of each estate's developer and payout accounts (they pay gas for claim_release / withdraw_owed) and of
 * any MONITOR_ACCOUNTS, warning below 0.5 NEAR. Detail names accounts: show it only on the secret-gated health view.
 */
export async function accountBalances(estates: string[] = ESTATES, extra: string[] = serverEnv.monitorAccounts()): Promise<AccountCheck> {
  try {
    const views = await Promise.all(estates.map((e) => viewUncached<Pick<EstateView, "developer_id" | "payout_id">>(e, "get_estate").catch(() => null)));
    const ids = new Set<string>(extra);
    for (const v of views) {
      if (v?.developer_id) ids.add(v.developer_id);
      if (v?.payout_id) ids.add(v.payout_id);
    }
    const low: string[] = [];
    const parts: string[] = [];
    await Promise.all(
      [...ids].sort().map(async (id) => {
        const a = await viewAccount(id).catch(() => null);
        const bal = a ? BigInt(a.amount) : 0n;
        parts.push(`${id} ${nearStr(bal)} NEAR`);
        if (bal < ACCOUNT_MIN) low.push(`${id} below 0.5 NEAR`);
      }),
    );
    parts.sort();
    low.sort();
    return { ok: low.length === 0, detail: (low.length ? `LOW: ${low.join("; ")} · ` : "") + (parts.join(" · ") || "no accounts to watch"), low };
  } catch (e) {
    return { ok: false, detail: `couldn't read account balances: ${e instanceof Error ? e.message : String(e)}`, low: [] };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Poller freshness: every successful estate pass stamps poll_cursor.updated_at (poll_cursor_save, migration 0006).

export const POLLER_MAX_AGE_MS = 20 * 60_000;

/** Not ok when any configured estate's cursor wasn't saved in the last 20 minutes (or never). Detail names estates. */
export function pollerFreshness(rows: { estate: string; updated_at: string | null }[], estates: string[] = ESTATES, now: number = Date.now(), maxAgeMs = POLLER_MAX_AGE_MS): { ok: boolean; detail: string } {
  const at = new Map(rows.map((r) => [r.estate, r.updated_at ? Date.parse(r.updated_at) : NaN]));
  const parts: string[] = [];
  const stale: string[] = [];
  for (const e of estates) {
    const t = at.get(e);
    const age = t !== undefined && Number.isFinite(t) ? now - t : null;
    parts.push(`${e} ${age === null ? "never" : `${Math.round(age / 60_000)} min ago`}`);
    if (age === null || age > maxAgeMs) stale.push(e);
  }
  return { ok: stale.length === 0, detail: (stale.length ? `STALE: ${stale.join(", ")} · ` : "") + (parts.join(" · ") || "no estates") };
}

// ---------------------------------------------------------------------------------------------------------------
// /api/health public view

export type Check = { ok: boolean; detail: string; configured?: boolean; mainnet_only?: boolean };
export type Health = Record<string, Check>;

const PUBLIC_DETAIL: Record<string, [ok: string, notOk: string]> = {
  balances: ["relayer gas and verification budgets above their minimums", "a gas or verification balance is below its minimum"],
  accounts: ["developer and payout accounts above 0.5 NEAR", "a developer or payout account is below 0.5 NEAR"],
  photo_checks: ["recent photo checks ran normally", "recent photo checks are failing (AI, challenge read or worker)"],
  relayer: ["configured", "not working"],
  reporter: ["configured", "not working"],
  poller: ["indexed events within the last 20 minutes", "the event poller hasn't completed a run recently"],
};

export function publicView(h: Health): Health {
  const out: Health = {};
  for (const [k, v] of Object.entries(h)) {
    const detail =
      v.mainnet_only ? "mainnet only"
      : v.configured === false ? "not configured on this deployment"
      : PUBLIC_DETAIL[k] ? PUBLIC_DETAIL[k][v.ok ? 0 : 1]
      : v.ok ? "reachable" : "unreachable or returning errors";
    out[k] = { ok: v.ok, ...(v.configured !== undefined ? { configured: v.configured } : {}), ...(v.mainnet_only ? { mainnet_only: true } : {}), detail };
  }
  return out;
}

