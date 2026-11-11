// POST /api/oneclick/quote — proxy of 1Click POST /v0/quote. Adds the JWT server-side, forces the destination asset to
// native USDC and the recipient to a real, USDC-registered unit account (so Plote can't be used as a free swap proxy).
// 1Click only delivers on mainnet. On a testnet build the only allowed recipient is MAINNET_UNIT_ACCOUNT (the Mainnet
// Lite unit, scripts/mainnet-lite.ts): a testnet unit account name isn't a mainnet account, so a quote for it would
// send real USDC to an address nobody controls.

import { z } from "zod";
import { ESTATES, MAINNET_USDC_ASSET, NETWORK, TABLES, USDC_ID } from "@/lib/config";
import { estate as E } from "@/lib/estate";
import { usdc } from "@/lib/usdc";
import { serverEnv } from "@/lib/server/env";
import { clientIp, jsonError, ok, parseJson } from "@/lib/server/http";
import { oneclickFetch } from "@/lib/server/oneclick-server";
import { rateLimitShared } from "@/lib/server/rate-limit";
import { supabaseAdmin } from "@/lib/server/supabase-admin";

export const dynamic = "force-dynamic";

const Body = z.object({
  dry: z.boolean(),
  originAsset: z.string().min(3).max(200),
  amount: z.string().regex(/^\d{1,15}$/),
  refundTo: z.string().min(20).max(120),
  recipient: z.string().min(2).max(64),
  estate: z.string().max(64).optional(),
  unit: z.string().max(16).optional(),
  chipName: z.string().max(40).optional(),
  chipNote: z.string().max(140).optional(),
});

async function isRealUnit(recipient: string): Promise<boolean> {
  if (recipient === serverEnv.mainnetUnitAccount()) return true;
  const dot = recipient.indexOf(".");
  if (dot <= 0) return false;
  const unitId = recipient.slice(0, dot);
  const estate = recipient.slice(dot + 1);
  if (!ESTATES.includes(estate)) return false;
  const t = await E.isTaken(estate, unitId);
  return !!t?.exists && t.account === recipient;
}

export async function POST(req: Request) {
  const lite = serverEnv.mainnetUnitAccount();
  if (NETWORK !== "mainnet" && !lite) {
    return jsonError("ONECLICK_MAINNET_ONLY", "Cross-chain payments use NEAR Intents, which only runs on mainnet. Use the mainnet demo build.", 503);
  }
  const rl = await rateLimitShared(`quote:${clientIp(req)}`, 20, 60_000);
  if (!rl.ok) return jsonError("RATE_LIMITED", "Too many quotes. Wait a minute.", 429);
  const p = await parseJson(req, Body);
  if (!p.ok) return p.res;
  const b = p.data;
  if (NETWORK !== "mainnet" && b.recipient !== lite) {
    return jsonError("ONECLICK_MAINNET_ONLY", "On the testnet build, cross-chain payments can only go to the Mainnet Lite demo unit. Testnet units can't receive mainnet USDC.", 400);
  }
  try {
    if (NETWORK === "mainnet" && !(await isRealUnit(b.recipient))) return jsonError("E_UNIT_NOT_FOUND", "The recipient must be a Plote unit account.", 400);
    if (NETWORK === "mainnet" && !(await usdc.storageBalanceOf(b.recipient, USDC_ID))) {
      return jsonError("UNIT_NOT_REGISTERED", "That unit account isn't registered on USDC yet, so delivery would fail.", 400);
    }
  } catch {
    return jsonError("RPC_UNAVAILABLE", "Couldn't check the unit account on NEAR.", 503);
  }
  const body = {
    dry: b.dry,
    swapType: "EXACT_OUTPUT",
    slippageTolerance: 100,
    originAsset: b.originAsset,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: MAINNET_USDC_ASSET,
    amount: b.amount,
    refundTo: b.refundTo,
    refundType: "ORIGIN_CHAIN",
    recipient: b.recipient,
    recipientType: "DESTINATION_CHAIN",
    deadline: new Date(Date.now() + 30 * 60_000).toISOString(),
    referral: "plote",
    quoteWaitingTimeMs: 3000,
  };
  let r: Response;
  try {
    r = await oneclickFetch("/quote", { method: "POST", body: JSON.stringify(body) });
  } catch (e) {
    return jsonError("ONECLICK_UNAVAILABLE", e instanceof Error ? e.message : "1Click unreachable", 503);
  }
  const j = (await r.json().catch(() => ({}))) as { quote?: { depositAddress?: string }; message?: string };
  if (!r.ok) return jsonError("ONECLICK_QUOTE_FAILED", j.message ?? `1Click returned HTTP ${r.status}.`, 502);
  const dep = j.quote?.depositAddress;
  if (!b.dry && dep) {
    const sb = supabaseAdmin();
    if (sb) {
      await sb.from(TABLES.oneclickQuotes).upsert({
        deposit_address: dep, network: "mainnet", estate: b.estate ?? b.recipient.split(".").slice(1).join("."), unit: b.unit ?? b.recipient.split(".")[0],
        quote: j, status: "PENDING_DEPOSIT", chip_name: b.chipName ?? null, chip_note: b.chipNote ?? null,
      });
    }
  }
  return ok(j);
}
