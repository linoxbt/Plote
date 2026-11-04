// NEP-413 signed messages: encode, sign (for keys the app holds) and verify.
// payload = borsh({ message: string, nonce: [u8; 32], recipient: string, callbackUrl: Option<string> })
// hash    = sha256( u32_le(2^31 + 413) ‖ payload ); the ed25519 signature is over `hash`.

import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import bs58 from "bs58";
import { base64ToBytes, bytesToBase64 } from "./near";

export const NEP413_TAG = 2147483648 + 413; // 2^31 + 413

export type Nep413Payload = {
  message: string;
  nonce: Uint8Array; // 32 bytes
  recipient: string;
  callbackUrl?: string | null;
};

export type SignedNep413 = {
  accountId: string;
  publicKey: string; // "ed25519:<base58>"
  signature: string; // base64 (wallet format); base58 also accepted on verify
};

function u32le(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}

function borshString(s: string): Uint8Array {
  const bytes = new TextEncoder().encode(s);
  const out = new Uint8Array(4 + bytes.length);
  out.set(u32le(bytes.length), 0);
  out.set(bytes, 4);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** borsh(tag) ‖ borsh(payload) */
export function encodeNep413(p: Nep413Payload): Uint8Array {
  if (p.nonce.length !== 32) throw new Error("NEP-413 nonce must be 32 bytes");
  const cb = p.callbackUrl ? concat([new Uint8Array([1]), borshString(p.callbackUrl)]) : new Uint8Array([0]);
  return concat([u32le(NEP413_TAG), borshString(p.message), p.nonce, borshString(p.recipient), cb]);
}

export function hashNep413(p: Nep413Payload): Uint8Array {
  return sha256(encodeNep413(p));
}

export function parsePublicKey(pk: string): Uint8Array {
  const [type, data] = pk.includes(":") ? pk.split(":") : ["ed25519", pk];
  if (type !== "ed25519") throw new Error(`unsupported key type ${type}`);
  const bytes = bs58.decode(data);
  if (bytes.length !== 32) throw new Error("bad ed25519 public key length");
  return bytes;
}

export function decodeSignature(sig: string): Uint8Array {
  const s = sig.startsWith("ed25519:") ? sig.slice(8) : sig;
  // base64 first (wallet default); fall back to base58
  try {
    const b = base64ToBytes(s);
    if (b.length === 64) return b;
  } catch {
    /* not base64 */
  }
  const b = bs58.decode(s);
  if (b.length !== 64) throw new Error("bad signature length");
  return b;
}

/** Pure cryptographic check (does not check that the key belongs to the account — see verifyKeyOwnership on the server). */
export function verifyNep413(payload: Nep413Payload, signed: Pick<SignedNep413, "publicKey" | "signature">): boolean {
  try {
    return ed25519.verify(decodeSignature(signed.signature), hashNep413(payload), parsePublicKey(signed.publicKey));
  } catch {
    return false;
  }
}

/** Sign with a raw NEAR secret key string "ed25519:<base58 64-byte secret>" (used for keys the app holds). */
export function signNep413WithSecret(payload: Nep413Payload, secretKey: string): { publicKey: string; signature: string } {
  const raw = bs58.decode(secretKey.replace(/^ed25519:/, ""));
  const seed = raw.slice(0, 32);
  const pub = ed25519.getPublicKey(seed);
  const sig = ed25519.sign(hashNep413(payload), seed);
  return { publicKey: "ed25519:" + bs58.encode(pub), signature: bytesToBase64(sig) };
}

export function randomNonce(): Uint8Array {
  const n = new Uint8Array(32);
  crypto.getRandomValues(n);
  return n;
}

/** Nonce that embeds a timestamp in its first 8 bytes (ms, big-endian), so servers can reject stale messages. */
export function timestampedNonce(nowMs: number = Date.now()): Uint8Array {
  const n = randomNonce();
  new DataView(n.buffer).setBigUint64(0, BigInt(nowMs), false);
  return n;
}

export function nonceTimestamp(nonce: Uint8Array): number {
  return Number(new DataView(nonce.buffer, nonce.byteOffset, nonce.byteLength).getBigUint64(0, false));
}

export const nonceToBase64 = bytesToBase64;
export const nonceFromBase64 = base64ToBytes;

// ---------------- gate pass (SPEC §9.5) ----------------

export const GATE_TTL_MS = 60_000;

export function gateMessage(estateSlug: string, unitId: string, tsMs: number = Date.now()): string {
  return `plote-gate:${estateSlug}:${unitId}:${tsMs}`;
}

export function parseGateMessage(msg: string): { estate: string; unit: string; ts: number } | null {
  const m = /^plote-gate:([a-z0-9-]+):([a-z0-9-]{1,16}):(\d{10,16})$/.exec(msg);
  if (!m) return null;
  return { estate: m[1], unit: m[2], ts: Number(m[3]) };
}

export type GatePass = {
  accountId: string;
  publicKey: string;
  signature: string;
  nonce: string; // base64
  message: string;
};

export function encodeGatePass(p: GatePass): string {
  return JSON.stringify(p);
}

export function decodeGatePass(text: string): GatePass | null {
  try {
    const j = JSON.parse(text) as Partial<GatePass>;
    if (
      typeof j.accountId === "string" && typeof j.publicKey === "string" && typeof j.signature === "string" &&
      typeof j.nonce === "string" && typeof j.message === "string"
    ) return j as GatePass;
    return null;
  } catch {
    return null;
  }
}

/** Upload / notify auth messages (signed by the surveyor or subscriber). */
export function uploadMessage(estate: string, sha256Hex: string, tsMs: number = Date.now()): string {
  return `plote-upload:${estate}:${sha256Hex}:${tsMs}`;
}

export function parseUploadMessage(msg: string): { estate: string; sha256: string; ts: number } | null {
  const m = /^plote-upload:([a-z0-9._-]+):([0-9a-f]{64}):(\d{10,16})$/.exec(msg);
  return m ? { estate: m[1], sha256: m[2], ts: Number(m[3]) } : null;
}

export function notifyMessage(estate: string, unit: string, email: string, tsMs: number = Date.now()): string {
  return `plote-notify:${estate}:${unit}:${email}:${tsMs}`;
}
