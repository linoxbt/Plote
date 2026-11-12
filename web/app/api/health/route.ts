// GET /api/health — operational checks. Public view: ok / not-ok flags only (cached 30 s). With `x-cron-secret`:
// details (account names, balances, error text).
//  photo_checks: data-driven — failing when the latest verdicts across estates all show an infrastructure failure
//                (ai_unavailable / challenge_unverified / worker_error), instead of pinging NEAR AI without a key.
//  oneclick:     "mainnet only" on testnet builds (NEAR Intents has no testnet); probed on mainnet.
//  accounts:     estates' developer and payout accounts (+ MONITOR_ACCOUNTS, the reporter) above 0.5 NEAR.
//  poller:       every configured estate's poll_cursor.updated_at within the last 20 minutes (public: ok flag only).
//  reporter:     the key that signs submit_verdict / report_deposit (REPORTER_*, or the relayer on testnet).

import { ESTATES, IS_MAINNET, SUPABASE_URL, TABLES } from "@/lib/config";
import { balances } from "@/lib/server/balances";
import { accountBalances, photoCheckStatus, pollerFreshness, publicView, recentEvidence, type Check, type Health } from "@/lib/server/health";
import { timingSafeEqual } from "node:crypto";
import { ok } from "@/lib/server/http";
import { serverEnv } from "@/lib/server/env";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import { relayerCredentials, relayerEnvNames, reporterCredentials, reporterEnvNames } from "@/lib/server/relayer";
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
  const rep = reporterCredentials();
  const [oneclick, evidence, funds, accounts] = await Promise.all([
    oneclickP,
    recentEvidence(),
    balances(rc?.accountId ?? null),
    accountBalances(ESTATES, [...serverEnv.monitorAccounts(), ...(rep ? [rep.accountId] : [])]),
  ]);
  const pc = photoCheckStatus(evidence);
  let supabase: { ok: boolean; detail: string; configured: boolean };
  let poller: Check;
  const sb = supabaseAdmin();
  if (!sb) {
    supabase = { ok: false, configured: false, detail: "not configured (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)" };
    poller = { ok: false, configured: false, detail: "no database" };
  } else {
    const t0 = Date.now();
    const { error } = await sb.from(TABLES.events).select("id", { head: true, count: "exact" }).limit(1);
    supabase = { ok: !error, configured: true, detail: error ? error.message : `${SUPABASE_URL} · ${Date.now() - t0} ms` };
    const cur = await sb.from("poll_cursor").select("estate,updated_at").in("estate", ESTATES);
    poller = cur.error ? { ok: false, detail: `poll_cursor: ${cur.error.message}` } : pollerFreshness((cur.data ?? []) as { estate: string; updated_at: string | null }[]);
  }
  const relayer = rc
    ? { ok: true, configured: true, detail: `${rc.accountId} · allowlist ${serverEnv.relayerAllowedMethods().join(",")} · max ${serverEnv.relayerMaxGasTgas()} Tgas` }
    : { ok: false, configured: false, detail: `not configured (${relayerEnvNames().join(" / ")})` };
  const reporter = rep
    ? { ok: true, configured: true, detail: `${rep.accountId}${rc && rep.accountId === rc.accountId ? " (the relayer key; set REPORTER_* to separate them)" : ""}` }
    : { ok: false, configured: false, detail: `not configured (${reporterEnvNames().join(" / ")})` };
  return {
    photo_checks: { ok: pc.ok, detail: pc.detail },
    oneclick,
    supabase,
    relayer,
    reporter,
    poller,
    balances: { ok: funds.ok, detail: funds.detail },
    accounts: { ok: accounts.ok, detail: accounts.detail },
  };
}
