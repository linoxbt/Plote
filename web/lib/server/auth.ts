// Server-side NEP-413 checks: signature valid, key belongs to the account, message fresh.

import { viewAccessKey } from "../near";
import { nonceFromBase64, nonceTimestamp, verifyNep413 } from "../nep413";
import { claimOnce } from "./once";

export type SignedRequest = {
  accountId: string;
  publicKey: string;
  signature: string;
  nonce: string; // base64, 32 bytes, first 8 bytes = ms timestamp
  message: string;
  recipient: string;
};

export type KeyReader = (accountId: string, publicKey: string) => ReturnType<typeof viewAccessKey>;

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
  const k = await checkSignatureAndKey(r, nonce, { allowFunctionCallFor: opts.allowFunctionCallFor });
  if (!k.ok) return k;
  const keyKind = k.keyKind;
  // Single use: a captured request can't be replayed inside the freshness window.
  if (!(await claimOnce("nep413", `${r.accountId}:${r.nonce}`, maxAge + 120_000))) {
    return { ok: false, code: "NONCE_USED", message: "This signed message was already used. Sign again." };
  }
  return { ok: true, keyKind };
}

/**
 * The NEP-413 signature verifies and the key is on the account: a full-access key, or a function-call key whose
 * receiver is `allowFunctionCallFor`. No freshness or single-use check (callers add their own). Throws only when NEAR
 * can't be reached.
 */
export async function checkSignatureAndKey(
  r: Pick<SignedRequest, "accountId" | "publicKey" | "signature" | "message" | "recipient">,
  nonce: Uint8Array,
  opts: { allowFunctionCallFor?: string; readKey?: KeyReader } = {},
): Promise<AuthResult> {
  let valid = false;
  try {
    valid = verifyNep413({ message: r.message, nonce, recipient: r.recipient }, r);
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, code: "BAD_SIGNATURE", message: "The signature doesn't match the message." };
  const key = await (opts.readKey ?? viewAccessKey)(r.accountId, r.publicKey);
  if (!key) return { ok: false, code: "KEY_NOT_ON_ACCOUNT", message: `That key isn't on ${r.accountId}.` };
  if (key.permission === "FullAccess") return { ok: true, keyKind: "FullAccess" };
  if (opts.allowFunctionCallFor && key.permission.FunctionCall.receiver_id === opts.allowFunctionCallFor) return { ok: true, keyKind: "FunctionCall" };
  return { ok: false, code: "KEY_NOT_ALLOWED", message: "That key can't be used for this." };
}
