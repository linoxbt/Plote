// Chain checks for /api/chipin (family wall).

import { base64ToBytes } from "../near";

export type TxView = {
  status?: { SuccessValue?: string } | { Failure?: unknown } | string;
  transaction?: { receiver_id?: string; signer_id?: string; actions?: ({ FunctionCall?: { method_name: string; args: string } } | string)[] };
};

/** The family-wall name and note the payer signed into the transfer's `msg` ({"from","note"}). */
export function wallText(msg: unknown): { name: string | null; note: string | null } {
  if (typeof msg !== "string") return { name: null, note: null };
  try {
    const j = JSON.parse(msg) as { from?: unknown; note?: unknown };
    const s = (x: unknown, n: number) => (typeof x === "string" && x.trim() ? x.trim().slice(0, n) : null);
    return { name: s(j.from, 40), note: s(j.note, 140) };
  } catch {
    return { name: null, note: null };
  }
}

/** Amount the receiver kept: the transaction's final value is ft_resolve_transfer's U128 ("123"). */
export function usedAmount(status: TxView["status"]): bigint | null {
  const v = status && typeof status === "object" && "SuccessValue" in status ? status.SuccessValue : undefined;
  if (typeof v !== "string" || !v) return null;
  try {
    const j = JSON.parse(new TextDecoder().decode(base64ToBytes(v)));
    return typeof j === "string" && /^\d{1,30}$/.test(j) ? BigInt(j) : null;
  } catch {
    return null;
  }
}
