// What happened to USDC sent with `ft_transfer_call` (NEP-141). The transaction SUCCEEDS even when the receiver
// refuses the money: `ft_on_transfer` returns the amount unused and `ft_resolve_transfer` gives it back to the sender.
// So a green transaction is not a payment. The transaction's own return value is `ft_resolve_transfer`'s: the amount
// the receiver kept ("0" when it refused everything). The estate also logs why it refused:
//   - unit deposit (`on_unit_deposit`): "deposit of N from X bounced: <why>"; accepted → `deposit_synced` event
//   - listing purchase (estate `ft_on_transfer`): "purchase rejected: E_CODE: <why>"; accepted → `sold` event
//   - wrong token: "E_BAD_TOKEN: …"

import { messageForCode, parseErrorCode, PloteError } from "./errors";
import type { TxResult } from "./near";

export type FtCallKind = "deposit" | "purchase";

export type FtCallOutcome = {
  /** "accepted": all (or, for a purchase, enough) of the amount was kept. "refused": none kept, money returned. */
  status: "accepted" | "partial" | "refused" | "unknown";
  sent: bigint;
  used: bigint | null;
  refunded: bigint | null;
  /** Plain-English reason when refused. */
  reason: string | null;
  /** Contract error code when the estate gave one (purchases). */
  code: string | null;
};

function toBigOrNull(v: unknown): bigint | null {
  if (typeof v === "string" && /^\d+$/.test(v)) return BigInt(v);
  if (typeof v === "number" && Number.isInteger(v) && v >= 0) return BigInt(v);
  return null;
}

const BOUNCE_RE = /deposit of \d+ from \S+ bounced: (.+)$/i;
const PURCHASE_RE = /purchase rejected: (.+)$/i;

/** The estate's own reason for refusing, from the transaction logs. */
export function refusalFromLogs(logs: string[]): { reason: string; code: string | null } | null {
  for (const line of logs) {
    const p = PURCHASE_RE.exec(line);
    if (p) {
      const code = parseErrorCode(p[1]);
      return { code, reason: code ? messageForCode(code) : p[1] };
    }
    const b = BOUNCE_RE.exec(line);
    if (b) {
      const why = b[1].trim();
      const reason = /isn't reserved/i.test(why)
        ? "The unit isn't reserved by you (or your reservation ran out), so it doesn't take payments right now."
        : /transfer out .* is pending/i.test(why)
          ? "A transfer out of this unit is still settling. Pay again in a few seconds."
          : why;
      return { code: null, reason };
    }
    if (/^E_BAD_TOKEN\b/.test(line)) return { code: "E_BAD_TOKEN", reason: messageForCode("E_BAD_TOKEN") };
  }
  return null;
}

/**
 * Classify an `ft_transfer_call` result. `sent` is the amount in the call. Uses the transaction's return value
 * (`ft_resolve_transfer`'s used amount) first, then the estate's events and logs.
 */
export function ftCallOutcome(r: Pick<TxResult, "returnValue" | "logs" | "events">, sent: string | bigint, kind: FtCallKind): FtCallOutcome {
  const amount = BigInt(sent);
  const used = toBigOrNull(r.returnValue);
  const refusal = refusalFromLogs(r.logs ?? []);
  const okEvent = (r.events ?? []).some((e) => e.event === (kind === "deposit" ? "deposit_synced" : "sold"));
  const base = { sent: amount, used, refunded: used === null ? null : amount - used, reason: refusal?.reason ?? null, code: refusal?.code ?? null };
  if (used !== null) {
    if (used === 0n) return { ...base, status: "refused", reason: base.reason ?? "The receiver didn't accept the USDC, so it was returned to you." };
    if (used >= amount) return { ...base, status: "accepted", reason: null, code: null };
    // A purchase keeps the ask and returns any overpayment: that is a completed purchase.
    if (kind === "purchase" && okEvent) return { ...base, status: "accepted", reason: null, code: null };
    return { ...base, status: "partial" };
  }
  if (refusal) return { ...base, status: "refused", used: 0n, refunded: amount };
  if (okEvent) return { ...base, status: "accepted" };
  return { ...base, status: "unknown" };
}

/**
 * Throw (so the toast shows a failure, not "Paid") unless the USDC was really taken. A partial deposit is reported
 * as an error too: the rest came back, and the user must know.
 */
export function assertFtCallAccepted(r: TxResult, sent: string | bigint, kind: FtCallKind): FtCallOutcome {
  const o = ftCallOutcome(r, sent, kind);
  if (o.status === "accepted") return o;
  const what = kind === "deposit" ? "payment" : "purchase";
  let message: string;
  if (o.status === "refused") message = `Your ${what} was refused and the USDC came back to your account. ${o.reason ?? ""}`.trim();
  else if (o.status === "partial") message = `Only part of the ${what} was taken (${o.used} of ${o.sent} base units); the rest came back to your account. ${o.reason ?? ""}`.trim();
  else message = `The wallet didn't return the transaction result, so Plote can't confirm the ${what} was accepted. Check the unit page before paying again.`;
  const err = new PloteError(o.code ?? (o.status === "unknown" ? "PAYMENT_UNCONFIRMED" : "PAYMENT_REFUNDED"), JSON.stringify({ status: o.status, used: o.used?.toString() ?? null, logs: r.logs?.slice(-6) }), message);
  (err as PloteError & { txHash?: string }).txHash = r.hash;
  throw err;
}
