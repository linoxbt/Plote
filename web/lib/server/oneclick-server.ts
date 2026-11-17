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

/**
 * Is `account` registered on Circle USDC on NEAR mainnet? Used by a testnet build that quotes for the Mainnet Lite unit
 * (its own RPC is testnet's). Throws when no mainnet RPC answers.
 */
export async function mainnetUsdcRegistered(account: string, rpcs = ["https://rpc.mainnet.fastnear.com", "https://rpc.mainnet.near.org"]): Promise<boolean> {
  const args = Buffer.from(JSON.stringify({ account_id: account })).toString("base64");
  const body = JSON.stringify({
    jsonrpc: "2.0", id: "plote", method: "query",
    params: { request_type: "call_function", finality: "final", account_id: MAINNET_USDC, method_name: "storage_balance_of", args_base64: args },
  });
  let last: unknown;
  for (const url of rpcs) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body, cache: "no-store", signal: AbortSignal.timeout(8000) });
      const j = (await r.json()) as { result?: { result?: number[] }; error?: unknown };
      if (!j.result?.result) throw new Error("rpc error");
      const v = JSON.parse(Buffer.from(j.result.result).toString("utf8")) as unknown;
      return v !== null;
    } catch (e) {
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error("mainnet RPC unavailable");
}
const MAINNET_USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

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
