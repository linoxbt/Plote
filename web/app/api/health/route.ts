// GET /api/health — operational checks. Public view: ok / not-ok flags only (cached 30 s). With `x-cron-secret`:
// details (account names, balances, error text).
//  photo_checks: data-driven — failing when the latest verdicts across estates all show an infrastructure failure
//                (ai_unavailable / challenge_unverified / worker_error), instead of pinging NEAR AI without a key.
//  oneclick:     "mainnet only" on testnet builds (NEAR Intents has no testnet); probed on mainnet.
//  accounts:     estates' developer and payout accounts (+ MONITOR_ACCOUNTS) above 0.5 NEAR.

import { IS_MAINNET, SUPABASE_URL, TABLES } from "@/lib/config";
import { balances } from "@/lib/server/balances";
import { accountBalances, photoCheckStatus, publicView, recentEvidence, type Check, type Health } from "@/lib/server/health";
import { timingSafeEqual } from "node:crypto";
import { ok } from "@/lib/server/http";
import { serverEnv } from "@/lib/server/env";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import { relayerCredentials } from "@/lib/server/relayer";
import { oneclickFetch } from "@/lib/server/oneclick-server";

export const dynamic = "force-dynamic";

async function timed(fn: () => Promise<Response>): Promise<{ ok: boolean; detail: string }> {
  const t0 = Date.now();
  try {
    const r = await fn();
    return { ok: r.ok, detail: `HTTP ${r.status} · ${Date.now() - t0} ms` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

/** Full details (account names, allowlist, balances, error text) only with `x-cron-secret`; the public view keeps the flags. */
function detailed(req: Request): boolean {
  const want = Buffer.from(serverEnv.cronSecret() ?? "");
  const got = Buffer.from(req.headers.get("x-cron-secret") ?? "");
  return want.length > 0 && want.length === got.length && timingSafeEqual(want, got);
}

// The public view is cached briefly so the endpoint can't be used to fan out requests to NEAR, 1Click and Supabase.
let cache: { at: number; h: Health } | null = null;
const CACHE_MS = 30_000;

export async function GET(req: Request) {
  const full = detailed(req);
  if (!full && cache && Date.now() - cache.at < CACHE_MS) return ok(publicView(cache.h), { headers: { "cache-control": "no-store" } });
  const h = await check();
  cache = { at: Date.now(), h };
  return ok(full ? h : publicView(h), { headers: { "cache-control": "no-store" } });
}

async function check(): Promise<Health> {
  const oneclickP: Promise<Check> = IS_MAINNET
    ? timed(() => oneclickFetch("/tokens", {}, 5000)).then((r) => ({ ...r, configured: true }))
    : Promise.resolve({ ok: true, configured: false, mainnet_only: true, detail: "mainnet only: NEAR Intents (1Click) has no testnet" });
  const rc = relayerCredentials();
  const [oneclick, evidence, funds, accounts] = await Promise.all([oneclickP, recentEvidence(), balances(rc?.accountId ?? null), accountBalances()]);
  const pc = photoCheckStatus(evidence);
  let supabase: { ok: boolean; detail: string; configured: boolean };
  const sb = supabaseAdmin();
  if (!sb) supabase = { ok: false, configured: false, detail: "not configured (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)" };
  else {
    const t0 = Date.now();
    const { error } = await sb.from(TABLES.events).select("id", { head: true, count: "exact" }).limit(1);
    supabase = { ok: !error, configured: true, detail: error ? error.message : `${SUPABASE_URL} · ${Date.now() - t0} ms` };
  }
  const relayer = rc
    ? { ok: true, configured: true, detail: `${rc.accountId} · allowlist ${serverEnv.relayerAllowedMethods().join(",")}` }
    : { ok: false, configured: false, detail: "not configured (RELAYER_ACCOUNT_ID / RELAYER_PRIVATE_KEY)" };
  return {
    photo_checks: { ok: pc.ok, detail: pc.detail },
    oneclick,
    supabase,
    relayer,
    balances: { ok: funds.ok, detail: funds.detail },
    accounts: { ok: accounts.ok, detail: accounts.detail },
  };
}
