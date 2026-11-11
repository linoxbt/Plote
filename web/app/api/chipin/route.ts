// POST /api/chipin — records a family-wall note (C1, Path A) after checking the ft_transfer_call on-chain.
// Everything is read from the chain: the amount the unit actually kept (ft_resolve_transfer's return value) and the
// name and note from the transfer's signed `msg`, so whoever posts the hash can't change what the wall says.
// One row per transaction (unique tx_hash); posting the same hash again is a no-op.

import { z } from "zod";
import { ESTATES, TABLES, USDC_ID } from "@/lib/config";
import { unitAccount } from "@/lib/estates";
import { base64ToBytes, rpc } from "@/lib/near";
import { clientIp, jsonError, notConfigured, ok, parseJson } from "@/lib/server/http";
import { rateLimitShared } from "@/lib/server/rate-limit";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import { type TxView, usedAmount, wallText } from "@/lib/server/chipin";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

/** The whole chain lookup (both RPCs) gets this long; a transaction that isn't final yet is retried by the client. */
const LOOKUP_DEADLINE_MS = 8000;

const Body = z.object({
  estate: z.string().min(2).max(64),
  unit: z.string().regex(/^[a-z0-9-]{1,16}$/),
  txHash: z.string().min(30).max(60),
  sender: z.string().min(2).max(64),
  // Accepted for older clients and ignored: the wall shows the name and note from the signed transaction.
  displayName: z.string().max(40).optional(),
  note: z.string().max(140).optional(),
});

export async function POST(req: Request) {
  const sb = supabaseAdmin();
  if (!sb) return notConfigured("The family wall", ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);
  const p = await parseJson(req, Body);
  if (!p.ok) return p.res;
  const b = p.data;
  if (!ESTATES.includes(b.estate)) return jsonError("E_BAD_ARGS", "Unknown estate.");
  // Each post costs one or two RPC lookups: a few per minute per IP is plenty for a person posting their own payment.
  const rl = await rateLimitShared(`chipin:${clientIp(req)}`, 10, 60_000);
  if (!rl.ok) return jsonError("RATE_LIMITED", `Too many requests. Try again in ${rl.retryAfterS}s.`, 429, { "retry-after": String(rl.retryAfterS) });
  let tx: TxView;
  try {
    const lookup = rpc<TxView>("EXPERIMENTAL_tx_status", { tx_hash: b.txHash, sender_account_id: b.sender, wait_until: "FINAL" }, { timeoutMs: 4000 });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, rej) => {
      timer = setTimeout(() => rej(new Error("deadline")), LOOKUP_DEADLINE_MS);
    });
    try {
      tx = await Promise.race([lookup, deadline]);
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return jsonError("TX_NOT_FOUND", "Couldn't find that transaction yet. Try again in a few seconds.", 404);
  }
  const t = tx.transaction;
  const acts = t?.actions ?? [];
  const last = acts[acts.length - 1];
  const fc = typeof last === "object" && last.FunctionCall?.method_name === "ft_transfer_call" ? last.FunctionCall : undefined;
  const transfers = acts.filter((a) => typeof a === "object" && a.FunctionCall?.method_name === "ft_transfer_call").length;
  if (!t || t.receiver_id !== USDC_ID || t.signer_id !== b.sender || !fc || transfers !== 1) return jsonError("E_BAD_ARGS", "That isn't a USDC payment.");
  let args: { receiver_id?: string; amount?: string; msg?: string };
  try {
    args = JSON.parse(new TextDecoder().decode(base64ToBytes(fc.args)));
  } catch {
    return jsonError("E_BAD_ARGS", "Unreadable transaction args.");
  }
  if (args.receiver_id !== unitAccount(b.estate, b.unit)) return jsonError("E_BAD_ARGS", "That payment went to a different account.");
  const used = usedAmount(tx.status);
  if (used === null) return jsonError("TX_FAILED", "That payment didn't go through.", 400);
  if (used === 0n) return jsonError("TX_FAILED", "That payment was refunded, so there's nothing to show on the wall.", 400);
  const { data: dup } = await sb.from(TABLES.chipins).select("id").eq("tx_hash", b.txHash).limit(1);
  if (dup?.length) return ok({ ok: true, duplicate: true });
  const { name, note } = wallText(args.msg);
  const { error } = await sb.from(TABLES.chipins).insert({ estate: b.estate, unit: b.unit, tx_hash: b.txHash, display_name: name, note, amount: used.toString() });
  if (error?.code === "23505") return ok({ ok: true, duplicate: true }); // lost a race with the same hash
  if (error) return jsonError("STORAGE_ERROR", "Couldn't save the note.", 502);
  return ok({ ok: true });
}
