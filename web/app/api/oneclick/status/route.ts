// GET /api/oneclick/status?depositAddress= — proxy of 1Click GET /v0/status.
// On SUCCESS it calls unit.sync_deposits() once with the relayer key (anyone may call sync; it's idempotent),
// but only when the recipient is a unit account of an estate configured on this network (NEXT_PUBLIC_ESTATES).
// Any other recipient — e.g. the Mainnet Lite unit (scripts/mainnet-lite.ts), a bare account with no contract —
// is skipped and the response says so: `sync: "skipped"` with `sync_note`. The USDC is on the account either way.

import { ESTATES, NETWORK, TABLES } from "@/lib/config";
import { unit as U } from "@/lib/unit";
import { jsonError, ok } from "@/lib/server/http";
import { oneclickFetch } from "@/lib/server/oneclick-server";
import { markOnce } from "@/lib/server/rate-limit";
import { callAsRelayer, isAllowedReceiver, relayerCredentials } from "@/lib/server/relayer";
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
  let sync: "done" | "pending" | "skipped" | "failed" | "not_needed" = synced ? "done" : j.status === "SUCCESS" ? "pending" : "not_needed";
  let syncNote: string | undefined;
  if (j.status === "SUCCESS" && !synced && recipient) {
    if (!isAllowedReceiver(recipient) || ESTATES.includes(recipient)) {
      // Not a unit of a configured estate on this network (Mainnet Lite's unit has no contract): nothing to sync.
      sync = "skipped";
      syncNote = `${recipient} isn't a unit of an estate configured on ${NETWORK}, so there is no estate to sync; the USDC stays on that account.`;
    } else if (!relayerCredentials()) {
      syncNote = "The relayer isn't configured here; anyone can call sync_deposits on the unit to credit the payment.";
    } else if (markOnce(`sync:${dep}`, 10 * 60_000)) {
      try {
        await callAsRelayer(U.syncDeposits(recipient)); // throws on a failed transaction
        synced = true;
        sync = "done";
        if (sb) await sb.from(TABLES.oneclickQuotes).update({ synced: true }).eq("deposit_address", dep);
      } catch (e) {
        sync = "failed";
        syncNote = `sync_deposits on ${recipient} failed (${e instanceof Error ? e.message : "unknown error"}); a later poll retries it.`;
      }
    }
  }
  return ok({ ...j, synced, sync, ...(syncNote ? { sync_note: syncNote } : {}) }, { headers: { "cache-control": "no-store" } });
}
