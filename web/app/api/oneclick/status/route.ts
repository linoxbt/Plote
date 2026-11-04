// GET /api/oneclick/status?depositAddress= — proxy of 1Click GET /v0/status.
// On SUCCESS it calls unit.sync_deposits() once with the relayer key (anyone may call sync; it's idempotent).

import { TABLES } from "@/lib/config";
import { unit as U } from "@/lib/unit";
import { jsonError, ok } from "@/lib/server/http";
import { oneclickFetch } from "@/lib/server/oneclick-server";
import { markOnce } from "@/lib/server/rate-limit";
import { callAsRelayer, isAllowedReceiver, relayerCredentials } from "@/lib/server/relayer";
import { serverEnv } from "@/lib/server/env";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import type { StatusResponse } from "@/lib/oneclick";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const dep = new URL(req.url).searchParams.get("depositAddress")?.trim();
  if (!dep || dep.length < 10 || dep.length > 120) return jsonError("E_BAD_ARGS", "depositAddress is required.");
  let r: Response;
  try {
    r = await oneclickFetch(`/status?depositAddress=${encodeURIComponent(dep)}`);
  } catch (e) {
    return jsonError("ONECLICK_UNAVAILABLE", e instanceof Error ? e.message : "1Click unreachable", 503);
  }
  const j = (await r.json().catch(() => ({}))) as StatusResponse & { message?: string };
  if (!r.ok) return jsonError("ONECLICK_STATUS_FAILED", j.message ?? `1Click returned HTTP ${r.status}.`, r.status === 404 ? 404 : 502);

  const sb = supabaseAdmin();
  let synced = false;
  const row = sb ? (await sb.from(TABLES.oneclickQuotes).select("synced,unit,estate").eq("deposit_address", dep).maybeSingle()).data : null;
  synced = !!row?.synced;
  if (sb && row) await sb.from(TABLES.oneclickQuotes).update({ status: j.status, updated_at: new Date().toISOString() }).eq("deposit_address", dep);

  const recipient = j.quoteResponse?.quoteRequest?.recipient as string | undefined;
  if (j.status === "SUCCESS" && !synced && recipient && relayerCredentials() && (isAllowedReceiver(recipient) || recipient === serverEnv.mainnetUnitAccount())) {
    if (markOnce(`sync:${dep}`, 10 * 60_000)) {
      try {
        await callAsRelayer(U.syncDeposits(recipient));
        synced = true;
        if (sb) await sb.from(TABLES.oneclickQuotes).update({ synced: true }).eq("deposit_address", dep);
      } catch {
        // Mainnet Lite: the unit account has no contract, so sync fails — the balance is still on the account.
      }
    }
  }
  return ok({ ...j, synced }, { headers: { "cache-control": "no-store" } });
}
