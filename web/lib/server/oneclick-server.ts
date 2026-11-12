// Server-side 1Click client. The JWT never leaves the server.

import { serverEnv } from "./env";
import { jsonError } from "./http";

export async function oneclickFetch(path: string, init: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const jwt = serverEnv.oneclickJwt();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(`${serverEnv.oneclickBaseUrl()}/v0${path}`, {
      ...init,
      signal: ctrl.signal,
      cache: "no-store",
      headers: {
        accept: "application/json",
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(jwt ? { authorization: `Bearer ${jwt}` } : {}),
        ...(init.headers ?? {}),
      },
    });
  } finally {
    clearTimeout(t);
  }
}

/** 503 ONECLICK_MAINNET_ONLY: NEAR Intents (1Click) has no testnet, so testnet builds don't proxy it. */
export function oneclickMainnetOnly() {
  return jsonError("ONECLICK_MAINNET_ONLY", "Cross-chain payments use NEAR Intents, which only runs on mainnet. Use the mainnet demo build.", 503);
}

/** Family-wall row for a delivered 1Click payment: the name/note the payer typed at quote time, if any. */
export function oneclickChipin(
  row: { estate: string; unit: string; chip_name: string | null; chip_note: string | null },
  depositAddress: string,
  amountOut: unknown,
): { estate: string; unit: string; deposit_address: string; display_name: string | null; note: string | null; amount: string | null } | null {
  const name = row.chip_name?.trim() ? row.chip_name.trim().slice(0, 40) : null;
  const note = row.chip_note?.trim() ? row.chip_note.trim().slice(0, 140) : null;
  if (!name && !note) return null;
  const amount = typeof amountOut === "string" && /^\d{1,30}$/.test(amountOut) ? amountOut : null;
  return { estate: row.estate, unit: row.unit, deposit_address: depositAddress, display_name: name, note, amount };
}

/**
 * The estate and unit a 1Click quote pays, derived only from the recipient (a unit account is `<unit>.<estate>`), so a
 * quote's family-wall note can't be filed under another unit. An `estate` (account or slug) or `unit` in the body is
 * only cross-checked: if either disagrees with the recipient, the quote is refused.
 */
export function quoteTarget(recipient: string, body: { estate?: string; unit?: string } = {}): { ok: true; estate: string; unit: string } | { ok: false; message: string } {
  const dot = recipient.indexOf(".");
  if (dot <= 0 || dot === recipient.length - 1) return { ok: false, message: "The recipient must be a unit account (<unit>.<estate>)." };
  const unit = recipient.slice(0, dot);
  const estate = recipient.slice(dot + 1);
  const be = body.estate?.trim().toLowerCase();
  if (be && be !== estate && be !== estate.split(".")[0]) return { ok: false, message: "estate doesn't match the recipient unit account." };
  const bu = body.unit?.trim().toLowerCase();
  if (bu && bu !== unit) return { ok: false, message: "unit doesn't match the recipient unit account." };
  return { ok: true, estate, unit };
}
