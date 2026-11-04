// Gate pass verification (SPEC §9.5). Public: runs on the guard's phone, no login.

import { estate as E } from "./estate";
import { estateSlug } from "./estates";
import { viewAccessKey } from "./near";
import { GATE_TTL_MS, decodeGatePass, nonceFromBase64, parseGateMessage, verifyNep413 } from "./nep413";

export type GateResult =
  | { ok: true; unit: string; label: string; accountId: string }
  | { ok: false; reason: string; unit?: string };

const seenNonces = new Map<string, number>(); // nonce → seen at (ms); kept 2 minutes

export async function verifyGatePass(text: string, estateAccountId: string, now = Date.now()): Promise<GateResult> {
  const pass = decodeGatePass(text.trim());
  if (!pass) return { ok: false, reason: "This isn't a Plote gate pass." };
  const msg = parseGateMessage(pass.message);
  if (!msg) return { ok: false, reason: "The pass message is malformed." };
  if (msg.estate !== estateSlug(estateAccountId)) return { ok: false, reason: `This pass is for ${msg.estate}, not this estate.`, unit: msg.unit };
  if (now - msg.ts > GATE_TTL_MS || msg.ts - now > 30_000) return { ok: false, reason: "The pass has expired. Ask the holder to refresh it.", unit: msg.unit };
  for (const [n, t] of seenNonces) if (now - t > 120_000) seenNonces.delete(n);
  if (seenNonces.has(pass.nonce)) return { ok: false, reason: "This pass was already used. Replays are rejected.", unit: msg.unit };
  let nonce: Uint8Array;
  try {
    nonce = nonceFromBase64(pass.nonce);
  } catch {
    return { ok: false, reason: "Bad nonce." };
  }
  if (!verifyNep413({ message: pass.message, nonce, recipient: estateAccountId }, pass)) {
    return { ok: false, reason: "The signature doesn't match.", unit: msg.unit };
  }
  const key = await viewAccessKey(pass.accountId, pass.publicKey);
  if (!key || key.permission !== "FullAccess") return { ok: false, reason: `That key isn't a full-access key of ${pass.accountId}.`, unit: msg.unit };
  const [tok, unit] = await Promise.all([E.nftToken(estateAccountId, msg.unit), E.getUnit(estateAccountId, msg.unit)]);
  if (!tok || tok.owner_id !== pass.accountId) return { ok: false, reason: `${pass.accountId} doesn't hold ${msg.unit.toUpperCase()}.`, unit: msg.unit };
  if (!unit || unit.status !== "HandedOver") return { ok: false, reason: `${msg.unit.toUpperCase()} hasn't been handed over yet.`, unit: msg.unit };
  seenNonces.set(pass.nonce, now);
  return { ok: true, unit: msg.unit, label: unit.label, accountId: pass.accountId };
}
