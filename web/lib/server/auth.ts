// Server-side NEP-413 checks: signature valid, key belongs to the account, message fresh.

import { viewAccessKey } from "../near";
import { nonceFromBase64, nonceTimestamp, verifyNep413 } from "../nep413";

export type SignedRequest = {
  accountId: string;
  publicKey: string;
  signature: string;
  nonce: string; // base64, 32 bytes, first 8 bytes = ms timestamp
  message: string;
  recipient: string;
};

export type AuthResult = { ok: true; keyKind: "FullAccess" | "FunctionCall" } | { ok: false; code: string; message: string };

/**
 * @param allowFunctionCallFor a function-call key is accepted only if its receiver_id equals this (e.g. the estate).
 */
export async function verifySignedRequest(
  r: SignedRequest,
  opts: { maxAgeMs?: number; allowFunctionCallFor?: string } = {},
): Promise<AuthResult> {
  let nonce: Uint8Array;
  try {
    nonce = nonceFromBase64(r.nonce);
  } catch {
    return { ok: false, code: "BAD_SIGNATURE", message: "Nonce must be base64." };
  }
  if (nonce.length !== 32) return { ok: false, code: "BAD_SIGNATURE", message: "Nonce must be 32 bytes." };
  const age = Date.now() - nonceTimestamp(nonce);
  const maxAge = opts.maxAgeMs ?? 5 * 60_000;
  if (age > maxAge || age < -60_000) return { ok: false, code: "SIGNATURE_EXPIRED", message: "The signed message is too old. Sign again." };
  if (!verifyNep413({ message: r.message, nonce, recipient: r.recipient }, r)) {
    return { ok: false, code: "BAD_SIGNATURE", message: "The signature doesn't match the message." };
  }
  const key = await viewAccessKey(r.accountId, r.publicKey);
  if (!key) return { ok: false, code: "KEY_NOT_ON_ACCOUNT", message: `That key isn't on ${r.accountId}.` };
  if (key.permission === "FullAccess") return { ok: true, keyKind: "FullAccess" };
  if (opts.allowFunctionCallFor && key.permission.FunctionCall.receiver_id === opts.allowFunctionCallFor) {
    return { ok: true, keyKind: "FunctionCall" };
  }
  return { ok: false, code: "KEY_NOT_ALLOWED", message: "That key can't be used for this." };
}
