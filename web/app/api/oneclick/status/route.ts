import { PloteError } from "@/lib/errors";
// GET /api/oneclick/status?depositAddress= — proxy of 1Click GET /v0/status.
// On SUCCESS it calls estate.report_deposit({ unit_id, amount }) once with the relayer key (the estate's deposit reporter),
// but only when the recipient is a unit account of an estate configured on this network (NEXT_PUBLIC_ESTATES).
// Any other recipient — e.g. the Mainnet Lite unit (scripts/mainnet-lite.ts), a bare account with no contract —
// is skipped and the response says so: `sync: "skipped"` with `sync_note`. The USDC is on the account either way.
// The relayer only syncs deposit addresses Plote itself quoted (a row in oneclick_quotes), claimed once in Postgres.
// On SUCCESS it also copies the quote's chip_name / chip_note to the family wall (chipins), once per deposit address.
// Testnet builds (no NEAR Intents) only answer for deposit addresses Plote quoted (the Mainnet Lite unit); anything
// else gets ONECLICK_MAINNET_ONLY instead of being proxied.

import { ESTATES, IS_MAINNET, NETWORK, TABLES } from "@/lib/config";
import { estate as E } from "@/lib/estate";
import { clientIp, jsonError, ok } from "@/lib/server/http";
import { oneclickChipin, oneclickFetch, oneclickMainnetOnly } from "@/lib/server/oneclick-server";
import { markOnce, rateLimitShared } from "@/lib/server/rate-limit";
import { callAsRelayer, isAllowedReceiver, relayerCredentials } from "@/lib/server/relayer";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import type { StatusResponse } from "@/lib/oneclick";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const dep = new URL(req.url).searchParams.get("depositAddress")?.trim();
  if (!dep || dep.length < 10 || dep.length > 120) return jsonError("E_BAD_ARGS", "depositAddress is required.");
  // The pay-status page polls every 5 s; 40/min leaves room for two tabs.
  const rl = await rateLimitShared(`oneclick-status:${clientIp(req)}`, 40, 60_000);
  if (!rl.ok) return jsonError("RATE_LIMITED", `Too many status checks. Try again in ${rl.retryAfterS}s.`, 429, { "retry-after": String(rl.retryAfterS) });
  const sb = supabaseAdmin();
  const row = sb
    ? ((await sb.from(TABLES.oneclickQuotes).select("synced,unit,estate,chip_name,chip_note").eq("deposit_address", dep).maybeSingle()).data as QuoteRow | null)
    : null;
  if (!IS_MAINNET && !row) return oneclickMainnetOnly();
  let r: Response;
  try {
    r = await oneclickFetch(`/status?depositAddress=${encodeURIComponent(dep)}`);
  } catch (e) {
    return jsonError("ONECLICK_UNAVAILABLE", e instanceof Error ? e.message : "1Click unreachable", 503);
  }
  const j = (await r.json().catch(() => ({}))) as StatusResponse & { message?: string };
  if (!r.ok) return jsonError("ONECLICK_STATUS_FAILED", j.message ?? `1Click returned HTTP ${r.status}.`, r.status === 404 ? 404 : 502);

  let synced = !!row?.synced;
  if (sb && row) await sb.from(TABLES.oneclickQuotes).update({ status: j.status, updated_at: new Date().toISOString() }).eq("deposit_address", dep);
  if (sb && row && j.status === "SUCCESS") await recordChipin(sb, dep, row, j.swapDetails?.amountOut);

  const recipient = j.quoteResponse?.quoteRequest?.recipient as string | undefined;
  let sync: "done" | "pending" | "skipped" | "failed" | "not_needed" = synced ? "done" : j.status === "SUCCESS" ? "pending" : "not_needed";
  let syncNote: string | undefined;
  if (j.status === "SUCCESS" && !synced && recipient) {
    if (!isAllowedReceiver(recipient) || ESTATES.includes(recipient)) {
      // Not a unit of a configured estate on this network (Mainnet Lite's unit has no contract): nothing to sync.
      sync = "skipped";
      syncNote = `${recipient} isn't a unit of an estate configured on ${NETWORK}, so there is no estate to sync; the USDC stays on that account.`;
    } else if (!relayerCredentials()) {
      syncNote = "The relayer isn't configured here, and only the estate's deposit reporter (the relayer) can credit a 1Click payment.";
    } else if (!sb || !row) {
      syncNote = "This payment wasn't quoted through Plote, so the relayer doesn't report it; the USDC stays on the unit until the estate's deposit reporter credits it.";
    } else if (!markOnce(`sync:${dep}`, 60_000)) {
      syncNote = "A sync was tried less than a minute ago; the next poll retries it."; // backoff after a failed sync
    } else {
      // Claim: only the request that flips synced false→true sends the transaction.
      const { data: claimed } = await sb.from(TABLES.oneclickQuotes).update({ synced: true }).eq("deposit_address", dep).eq("synced", false).select("deposit_address");
      if (claimed?.length) {
        try {
          // Plain-transfer (1Click) deposits are booked only by the estate's deposit reporter (its verdict_relayer =
          // this relayer): estate.report_deposit({ unit_id, amount }) with the delivered USDC in base units. The estate
          // credits min(amount, surplus seen in two balance reads); E_BALANCE_PENDING / E_IN_FLIGHT fail the tx, so the
          // rollback below retries on a later poll. `sync_deposits` only checks now (credits nothing).
          const amount = String(j.swapDetails?.amountOut ?? j.quoteResponse?.quote?.amountOut ?? "");
          if (!/^[1-9][0-9]{0,30}$/.test(amount)) throw new Error("1Click status has no delivered amount");
          const dot = recipient.indexOf(".");
          await callAsRelayer(E.reportDeposit(recipient.slice(dot + 1), recipient.slice(0, dot), amount)); // throws on a failed transaction
          synced = true;
          sync = "done";
        } catch (e) {
          // Retry only when the estate definitely refused the report (a contract panic with a stable E_ code, e.g.
          // E_BALANCE_PENDING / E_IN_FLIGHT): nothing was booked. A timeout or network error may have landed anyway,
          // and reporting again would let a refunded ft_transfer_call spanning both reads be booked twice (audit 3
          // reporter residual), so those stay claimed and are flagged for an operator instead of retried blindly.
          const refused = e instanceof PloteError && e.code.startsWith("E_");
          if (refused) {
            await sb.from(TABLES.oneclickQuotes).update({ synced: false }).eq("deposit_address", dep);
            sync = "failed";
            syncNote = `report_deposit for ${recipient} was refused (${e.code}); a later poll retries it.`;
          } else {
            sync = "pending";
            syncNote = `report_deposit for ${recipient} didn't confirm (${e instanceof Error ? e.message.slice(0, 120) : "unknown error"}); it isn't retried automatically, so an operator should check the unit's paid amount before reporting again.`;
            console.warn("plote:report-deposit-uncertain", JSON.stringify({ deposit: dep, unit: recipient }));
          }
        }
      } else {
        syncNote = "Another request is syncing this payment right now.";
      }
    }
  }
  return ok({ ...j, synced, sync, ...(syncNote ? { sync_note: syncNote } : {}) }, { headers: { "cache-control": "no-store" } });
}

type QuoteRow = { synced: boolean; unit: string; estate: string; chip_name: string | null; chip_note: string | null };
type Admin = NonNullable<ReturnType<typeof supabaseAdmin>>;

/** Copy the payer's wall name/note once: only the request that flips chipin_recorded false→true inserts the row. */
async function recordChipin(sb: Admin, dep: string, row: QuoteRow, amountOut: unknown): Promise<void> {
  const chip = oneclickChipin(row, dep, amountOut);
  if (!chip) return;
  // Before migration 0004 the column doesn't exist: the update errors and nothing is copied (no duplicate rows).
  const { data: claimed, error } = await sb.from(TABLES.oneclickQuotes).update({ chipin_recorded: true }).eq("deposit_address", dep).eq("chipin_recorded", false).select("deposit_address");
  if (error || !claimed?.length) return;
  const ins = await sb.from(TABLES.chipins).insert(chip);
  if (ins.error && ins.error.code !== "23505") await sb.from(TABLES.oneclickQuotes).update({ chipin_recorded: false }).eq("deposit_address", dep);
}
