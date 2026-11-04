// POST /api/chipin — records a family-wall note (C1, Path A) after checking the ft_transfer_call on-chain.
// Amounts are always read from the chain; only the name and note come from the sender.

import { z } from "zod";
import { ESTATES, TABLES, USDC_ID } from "@/lib/config";
import { unitAccount } from "@/lib/estates";
import { base64ToBytes, rpc } from "@/lib/near";
import { jsonError, notConfigured, ok, parseJson } from "@/lib/server/http";
import { supabaseAdmin } from "@/lib/server/supabase-admin";

export const dynamic = "force-dynamic";

const Body = z.object({
  estate: z.string().min(2).max(64),
  unit: z.string().regex(/^[a-z0-9-]{1,16}$/),
  txHash: z.string().min(30).max(60),
  sender: z.string().min(2).max(64),
  displayName: z.string().max(40).optional().default(""),
  note: z.string().max(140).optional().default(""),
});

type TxView = { transaction?: { receiver_id?: string; signer_id?: string; actions?: { FunctionCall?: { method_name: string; args: string } }[] } };

export async function POST(req: Request) {
  const sb = supabaseAdmin();
  if (!sb) return notConfigured("The family wall", ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);
  const p = await parseJson(req, Body);
  if (!p.ok) return p.res;
  const b = p.data;
  if (!ESTATES.includes(b.estate)) return jsonError("E_BAD_ARGS", "Unknown estate.");
  let tx: TxView;
  try {
    tx = await rpc<TxView>("EXPERIMENTAL_tx_status", { tx_hash: b.txHash, sender_account_id: b.sender, wait_until: "FINAL" });
  } catch {
    return jsonError("TX_NOT_FOUND", "Couldn't find that transaction yet.", 404);
  }
  const t = tx.transaction;
  const fc = t?.actions?.find((a) => a.FunctionCall?.method_name === "ft_transfer_call")?.FunctionCall;
  if (!t || t.receiver_id !== USDC_ID || t.signer_id !== b.sender || !fc) return jsonError("E_BAD_ARGS", "That isn't a USDC payment.");
  let args: { receiver_id?: string; amount?: string };
  try {
    args = JSON.parse(new TextDecoder().decode(base64ToBytes(fc.args)));
  } catch {
    return jsonError("E_BAD_ARGS", "Unreadable transaction args.");
  }
  if (args.receiver_id !== unitAccount(b.estate, b.unit)) return jsonError("E_BAD_ARGS", "That payment went to a different account.");
  const { error } = await sb.from(TABLES.chipins).insert({ estate: b.estate, unit: b.unit, tx_hash: b.txHash, display_name: b.displayName || null, note: b.note || null, amount: args.amount ?? null });
  if (error) return jsonError("STORAGE_ERROR", error.message, 502);
  return ok({ ok: true });
}
