import { NEAR_AI_URL, SUPABASE_URL, TABLES } from "@/lib/config";
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
  return ok({ nearai, oneclick: { ...oneclick, configured: true }, supabase, relayer }, { headers: { "cache-control": "no-store" } });
}
