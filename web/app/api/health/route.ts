import { ESTATES, NEAR_AI_URL, SUPABASE_URL, TABLES } from "@/lib/config";
import { viewAccount, viewUncached } from "@/lib/near";
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

const YOCTO = 10n ** 24n;
const nearStr = (y: bigint) => (Number(y / 10n ** 21n) / 1000).toFixed(2);
// Below these the app stops working: the relayer can't pay gas, and an estate can't pay OutLayer for a photo check.
const RELAYER_MIN = YOCTO; // 1 NEAR
const BUDGET_MIN = (3n * YOCTO) / 10n; // 0.3 NEAR

/** Low-balance check: an uptime monitor pointed at /api/health alerts when `balances.ok` turns false. */
async function balances(relayerId: string | null): Promise<{ ok: boolean; detail: string; low: string[] }> {
  const low: string[] = [];
  const parts: string[] = [];
  try {
    if (relayerId) {
      const a = await viewAccount(relayerId);
      const bal = a ? BigInt(a.amount) : 0n;
      parts.push(`relayer ${nearStr(bal)} NEAR`);
      if (bal < RELAYER_MIN) low.push(`relayer ${relayerId} below 1 NEAR`);
    }
    const budgets = await Promise.all(
      ESTATES.map(async (e) => {
        const v = await viewUncached<{ verification_budget?: string }>(e, "get_estate").catch(() => null);
        return [e, v?.verification_budget ? BigInt(v.verification_budget) : null] as const;
      }),
    );
    for (const [e, b] of budgets) {
      if (b === null) continue;
      parts.push(`${e.split(".")[0]} ${nearStr(b)} NEAR`);
      if (b < BUDGET_MIN) low.push(`${e} verification budget below 0.3 NEAR (fund_verification)`);
    }
    return { ok: low.length === 0, detail: (low.length ? `LOW: ${low.join("; ")} · ` : "") + parts.join(" · "), low };
  } catch (e) {
    return { ok: false, detail: `couldn't read balances: ${e instanceof Error ? e.message : String(e)}`, low };
  }
}

export async function GET() {
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
  return ok({ nearai, oneclick: { ...oneclick, configured: true }, supabase, relayer, balances: funds }, { headers: { "cache-control": "no-store" } });
}
