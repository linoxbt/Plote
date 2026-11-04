import { describe, expect, it } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import bs58 from "bs58";
import {
  decodeGatePass, encodeGatePass, encodeNep413, gateMessage, hashNep413, NEP413_TAG, nonceTimestamp, parseGateMessage,
  parseUploadMessage, signNep413WithSecret, timestampedNonce, uploadMessage, verifyNep413,
} from "@/lib/nep413";

function keypair(seedByte = 7) {
  const seed = new Uint8Array(32).fill(seedByte);
  const pub = ed25519.getPublicKey(seed);
  const secret = new Uint8Array(64);
  secret.set(seed, 0);
  secret.set(pub, 32);
  return { secret: "ed25519:" + bs58.encode(secret), publicKey: "ed25519:" + bs58.encode(pub) };
}

describe("NEP-413 encoding", () => {
  const nonce = new Uint8Array(32).fill(1);
  const payload = { message: "hi", nonce, recipient: "estate.testnet" };

  it("prefixes the 2^31+413 tag, little-endian", () => {
    const b = encodeNep413(payload);
    expect(NEP413_TAG).toBe(2147484061);
    expect(Array.from(b.slice(0, 4))).toEqual([0x9d, 0x01, 0x00, 0x80]);
  });
  it("lays out borsh fields: string, [u8;32], string, Option<string>", () => {
    const b = encodeNep413(payload);
    // u32 len 2 + "hi"
    expect(Array.from(b.slice(4, 10))).toEqual([2, 0, 0, 0, 104, 105]);
    expect(Array.from(b.slice(10, 42))).toEqual(Array(32).fill(1));
    expect(Array.from(b.slice(42, 46))).toEqual([14, 0, 0, 0]);
    expect(new TextDecoder().decode(b.slice(46, 60))).toBe("estate.testnet");
    expect(b[60]).toBe(0); // None
    expect(b.length).toBe(61);
    const withCb = encodeNep413({ ...payload, callbackUrl: "https://x" });
    expect(withCb[60]).toBe(1);
    expect(withCb.length).toBe(61 + 4 + 9);
  });
  it("hashes with sha256 over the full encoding", () => {
    expect(hashNep413(payload)).toEqual(sha256(encodeNep413(payload)));
  });
  it("rejects a short nonce", () => {
    expect(() => encodeNep413({ ...payload, nonce: new Uint8Array(8) })).toThrow();
  });
});

describe("NEP-413 sign + verify", () => {
  const kp = keypair();
  const payload = { message: gateMessage("harmattan-court", "a-4b", 1_762_250_000_000), nonce: new Uint8Array(32).fill(9), recipient: "harmattan-court.plote.testnet" };

  it("verifies a signature made with the matching key", () => {
    const s = signNep413WithSecret(payload, kp.secret);
    expect(s.publicKey).toBe(kp.publicKey);
    expect(verifyNep413(payload, s)).toBe(true);
  });
  it("accepts base58 signatures too", () => {
    const s = signNep413WithSecret(payload, kp.secret);
    const b58 = bs58.encode(Uint8Array.from(atob(s.signature), (c) => c.charCodeAt(0)));
    expect(verifyNep413(payload, { publicKey: s.publicKey, signature: b58 })).toBe(true);
  });
  it("fails on any change: message, recipient, nonce or key", () => {
    const s = signNep413WithSecret(payload, kp.secret);
    expect(verifyNep413({ ...payload, message: payload.message + "x" }, s)).toBe(false);
    expect(verifyNep413({ ...payload, recipient: "evil.testnet" }, s)).toBe(false);
    expect(verifyNep413({ ...payload, nonce: new Uint8Array(32) }, s)).toBe(false);
    expect(verifyNep413(payload, { ...s, publicKey: keypair(8).publicKey })).toBe(false);
    expect(verifyNep413(payload, { ...s, signature: "garbage" })).toBe(false);
  });
});

describe("app messages", () => {
  it("gate messages carry estate, unit and timestamp", () => {
    expect(parseGateMessage(gateMessage("harmattan-court", "a-4b", 1762250000000))).toEqual({ estate: "harmattan-court", unit: "a-4b", ts: 1762250000000 });
    expect(parseGateMessage("plote-gate:x")).toBeNull();
  });
  it("gate pass round-trips through QR text", () => {
    const p = { accountId: "a.testnet", publicKey: "ed25519:x", signature: "s", nonce: "n", message: "m" };
    expect(decodeGatePass(encodeGatePass(p))).toEqual(p);
    expect(decodeGatePass("{}")).toBeNull();
    expect(decodeGatePass("not json")).toBeNull();
  });
  it("timestamped nonces embed the time", () => {
    const n = timestampedNonce(1762250000123);
    expect(n.length).toBe(32);
    expect(nonceTimestamp(n)).toBe(1762250000123);
  });
  it("upload messages bind estate + sha256", () => {
    const sha = "a".repeat(64);
    expect(parseUploadMessage(uploadMessage("playground.plote.testnet", sha, 1762250000000))).toEqual({ estate: "playground.plote.testnet", sha256: sha, ts: 1762250000000 });
    expect(parseUploadMessage(uploadMessage("x.testnet", "zz", 1))).toBeNull();
  });
});
