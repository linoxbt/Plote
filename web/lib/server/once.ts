// Single-use claims in Postgres (supabase/migrations/0003_security.sql), so they hold across serverless instances.
// If the database is missing or slow, each falls back to a per-instance claim rather than failing the request.

import { markOnce } from "./rate-limit";
import { supabaseAdmin } from "./supabase-admin";

const DB_TIMEOUT_MS = 1500;

async function rpcRow<T>(fn: string, args: Record<string, unknown>): Promise<T | null> {
  const sb = supabaseAdmin();
  if (!sb) return null;
  try {
    const res = await Promise.race([sb.rpc(fn, args), new Promise<null>((r) => setTimeout(() => r(null), DB_TIMEOUT_MS))]);
    if (!res || res.error) return null;
    return (Array.isArray(res.data) ? res.data[0] : res.data) as T;
  } catch {
    return null;
  }
}

/** True the first time `key` is seen in `scope` within `ttlMs` (NEP-413 nonces, relayed delegates). */
export async function claimOnce(scope: string, key: string, ttlMs: number): Promise<boolean> {
  const r = await rpcRow<boolean>("claim_once", { p_scope: scope, p_nonce: key, p_ttl_seconds: Math.max(1, Math.ceil(ttlMs / 1000)) });
  if (typeof r === "boolean") return r;
  return markOnce(`${scope}:${key}`, ttlMs);
}

export type VerifyClaim = { ok: boolean; reason: "claimed" | "busy" | "exhausted"; attempts: number | null };

/**
 * Lease one evidence id for an HTTPS verification run: at most one run at a time per evidence, and at most
 * `maxAttempts` runs in total (so an evidence stuck in Error can't be re-run forever at OutLayer's cost).
 */
export async function claimVerify(estate: string, evidenceId: string, opts: { leaseMs: number; maxAttempts: number }): Promise<VerifyClaim> {
  const r = await rpcRow<{ ok: boolean; tries: number; why: string }>("verify_claim", {
    p_estate: estate,
    p_evidence_id: evidenceId,
    p_lease_seconds: Math.ceil(opts.leaseMs / 1000),
    p_max_attempts: opts.maxAttempts,
  });
  if (r && typeof r.ok === "boolean") return { ok: r.ok, reason: r.why === "exhausted" ? "exhausted" : r.ok ? "claimed" : "busy", attempts: r.tries ?? null };
  return markOnce(`verify:${estate}:${evidenceId}`, opts.leaseMs) ? { ok: true, reason: "claimed", attempts: null } : { ok: false, reason: "busy", attempts: null };
}

/** End the lease early once a run has finished (the attempt still counts). */
export async function releaseVerify(estate: string, evidenceId: string): Promise<void> {
  await rpcRow("verify_release", { p_estate: estate, p_evidence_id: evidenceId });
}
