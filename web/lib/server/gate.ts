// Server-side gate pass check (SPEC §9.5) for POST /api/gate/verify. Same rules as the guard-phone check in
// lib/gate.ts, plus a single-use claim of the pass nonce in Postgres (claim_once, migration 0003), so a pass
// screenshot can't be replayed at a second gate or on a second guard device inside its 60-second life.

import { estate as E } from "../estate";
import { estateSlug } from "../estates";
import { GATE_TTL_MS, decodeGatePass, nonceFromBase64, parseGateMessage } from "../nep413";
import type { NftToken, UnitView } from "../types";
import { checkSignatureAndKey, type KeyReader } from "./auth";
import { claimOnceShared } from "./once";
import { viewAccessKey } from "../near";

export type GateCheck =
  | { ok: true; unit: string; label: string; accountId: string; replayCheck: "shared" | "local" }
  | { ok: false; code: string; reason: string; unit?: string };

export type GateDeps = {
  readKey: KeyReader;
  token: (estate: string, unit: string) => Promise<Pick<NftToken, "owner_id"> | null>;
  unit: (estate: string, unit: string) => Promise<Pick<UnitView, "status" | "label"> | null>;
  claim: (scope: string, key: string, ttlMs: number) => Promise<{ ok: boolean; shared: boolean }>;
};

export const gateDeps: GateDeps = {
  readKey: viewAccessKey,
  token: (e, u) => E.nftToken(e, u),
  unit: (e, u) => E.getUnit(e, u),
  claim: claimOnceShared,
};

/** The nonce stays claimed a little longer than a pass can be accepted (60 s old, 30 s clock skew). */
export const GATE_CLAIM_TTL_MS = GATE_TTL_MS + 60_000;

/** Throws only when NEAR can't be reached. */
export async function verifyGatePassServer(text: string, estateAccountId: string, deps: GateDeps = gateDeps, now = Date.now()): Promise<GateCheck> {
  const pass = decodeGatePass(text.trim());
  if (!pass) return { ok: false, code: "GATE_BAD_PASS", reason: "This isn't a Plote gate pass." };
  const msg = parseGateMessage(pass.message);
  if (!msg) return { ok: false, code: "GATE_BAD_PASS", reason: "The pass message is malformed." };
  const unit = msg.unit;
  if (msg.estate !== estateSlug(estateAccountId)) return { ok: false, code: "GATE_WRONG_ESTATE", reason: `This pass is for ${msg.estate}, not this estate.`, unit };
  if (now - msg.ts > GATE_TTL_MS || msg.ts - now > 30_000) return { ok: false, code: "GATE_EXPIRED", reason: "The pass has expired. Ask the holder to refresh it.", unit };
  let nonce: Uint8Array;
  try {
    nonce = nonceFromBase64(pass.nonce);
  } catch {
    return { ok: false, code: "GATE_BAD_PASS", reason: "Bad nonce.", unit };
  }
  if (nonce.length !== 32) return { ok: false, code: "GATE_BAD_PASS", reason: "Bad nonce.", unit };
  // Full-access keys only (a function-call app key on someone's phone isn't proof of holding the account).
  const k = await checkSignatureAndKey({ ...pass, recipient: estateAccountId }, nonce, { readKey: deps.readKey });
  if (!k.ok) {
    const reason = k.code === "BAD_SIGNATURE" ? "The signature doesn't match." : `That key isn't a full-access key of ${pass.accountId}.`;
    return { ok: false, code: k.code, reason, unit };
  }
  const [tok, u] = await Promise.all([deps.token(estateAccountId, unit), deps.unit(estateAccountId, unit)]);
  if (!tok || tok.owner_id !== pass.accountId) return { ok: false, code: "E_NOT_HOLDER", reason: `${pass.accountId} doesn't hold ${unit.toUpperCase()}.`, unit };
  if (!u || u.status !== "HandedOver") return { ok: false, code: "GATE_NOT_HANDED_OVER", reason: `${unit.toUpperCase()} hasn't been handed over yet.`, unit };
  // Last, so a pass that fails a check above isn't burned; the claim is atomic, so only one scan of a pass passes.
  const c = await deps.claim("gate", `${estateAccountId}:${pass.nonce}`, GATE_CLAIM_TTL_MS);
  if (!c.ok) return { ok: false, code: "NONCE_USED", reason: "This pass was already used. Replays are rejected.", unit };
  return { ok: true, unit, label: u.label, accountId: pass.accountId, replayCheck: c.shared ? "shared" : "local" };
}
