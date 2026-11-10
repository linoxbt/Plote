import { NEAR_AI_URL, SUPABASE_URL, TABLES } from "@/lib/config";
import { balances } from "@/lib/server/balances";
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

type Check = { ok: boolean; detail: string; configured?: boolean };
type Health = Record<string, Check>;

/** Full details (account names, allowlist, balances, error text) only with `x-cron-secret`; the public view keeps the flags. */
function detailed(req: Request): boolean {
  const want = Buffer.from(serverEnv.cronSecret() ?? "");
  const got = Buffer.from(req.headers.get("x-cron-secret") ?? "");
  return want.length > 0 && want.length === got.length && timingSafeEqual(want, got);
}

function publicView(h: Health): Health {
  const out: Health = {};
  for (const [k, v] of Object.entries(h)) {
    const detail =
      v.configured === false ? "not configured on this deployment"
      : k === "balances" ? (v.ok ? "relayer gas and verification budgets above their minimums" : "a gas or verification balance is below its minimum")
      : k === "relayer" ? (v.ok ? "configured" : "not working")
      : v.ok ? "reachable" : "unreachable or returning errors";
    out[k] = { ok: v.ok, ...(v.configured !== undefined ? { configured: v.configured } : {}), detail };
  }
  return out;
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
  const ctrl = () => AbortSignal.timeout(5000);
  const [nearai, oneclick] = await Promise.all([
    timed(() => fetch(`${NEAR_AI_URL}/models`, { signal: ctrl(), cache: "no-store" })),
    timed(() => oneclickFetch("/tokens", {}, 5000)),
  ]);
  let supabase: { ok: boolean; detail: string; configured: boolean };
  const sb = supabaseAdmin();
  if (!sb) supabase = { ok: false, configured: false, detail: "not configured (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)" };
  else {
    const t0 = Date.now();
    const { error } = await sb.from(TABLES.events).select("id", { head: true, count: "exact" }).limit(1);
    supabase = { ok: !error, configured: true, detail: error ? error.message : `${SUPABASE_URL} · ${Date.now() - t0} ms` };
  }
  const rc = relayerCredentials();
  const relayer = rc
    ? { ok: true, configured: true, detail: `${rc.accountId} · allowlist ${serverEnv.relayerAllowedMethods().join(",")}` }
    : { ok: false, configured: false, detail: "not configured (RELAYER_ACCOUNT_ID / RELAYER_PRIVATE_KEY)" };
  const funds = await balances(rc?.accountId ?? null);
  return { nearai, oneclick: { ...oneclick, configured: true }, supabase, relayer, balances: { ok: funds.ok, detail: funds.detail } };
}
