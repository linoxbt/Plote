// Surveyor phone key (SPEC §9.3). An ed25519 key generated in the phone browser:
//  - WebCrypto Ed25519, non-extractable, kept in IndexedDB (where supported), else
//  - a near-api-js key encrypted with a PIN (AES-GCM, PBKDF2) in IndexedDB.
// The phone signs NEP-366 delegate actions with it; /api/relay submits them and pays gas.


import bs58 from "bs58";
import { NETWORK, RPC_URLS } from "./config";
import { bytesToBase64, clearViewCache, type TxResult, type TxSpec } from "./near";
import { hashNep413, type Nep413Payload } from "./nep413";
import { PloteError } from "./errors";
import { parseEventLogs } from "./events";

type StoredKey =
  | { kind: "webcrypto"; accountId: string; publicKey: string; keyPair: CryptoKeyPair; createdAt: number }
  | { kind: "pin"; accountId: string; publicKey: string; salt: string; iv: string; ciphertext: string; createdAt: number };

const DB = "plote";
const STORE = "keys";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

const slot = (accountId: string) => `${NETWORK}:surveyor:${accountId}`;

export async function loadPhoneKey(accountId: string): Promise<StoredKey | null> {
  try {
    return (await idb<StoredKey | undefined>("readonly", (s) => s.get(slot(accountId)))) ?? null;
  } catch {
    return null;
  }
}

export async function listPhoneKeys(): Promise<StoredKey[]> {
  try {
    const all = await idb<StoredKey[]>("readonly", (s) => s.getAll());
    return all ?? [];
  } catch {
    return [];
  }
}

export async function deletePhoneKey(accountId: string): Promise<void> {
  await idb("readwrite", (s) => s.delete(slot(accountId)));
}

export async function webCryptoEd25519Supported(): Promise<boolean> {
  try {
    const kp = (await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"])) as CryptoKeyPair;
    return !!kp.privateKey;
  } catch {
    return false;
  }
}

async function pinKey(pin: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: 210_000, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Create and store a new phone key. Returns its public key ("ed25519:…"). */
export async function createPhoneKey(accountId: string, pin?: string): Promise<string> {
  let stored: StoredKey;
  if (!pin && (await webCryptoEd25519Supported())) {
    const keyPair = (await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"])) as CryptoKeyPair;
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));
    stored = { kind: "webcrypto", accountId, publicKey: "ed25519:" + bs58.encode(raw), keyPair, createdAt: Date.now() };
  } else {
    if (!pin || pin.length < 4) throw new Error("This browser can't keep a non-exportable key. Choose a PIN of at least 4 digits.");
    const { KeyPair } = await import("near-api-js");
    const kp = KeyPair.fromRandom("ed25519");
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await pinKey(pin, salt);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(kp.toString())));
    stored = {
      kind: "pin", accountId, publicKey: kp.getPublicKey().toString(),
      salt: bytesToBase64(salt), iv: bytesToBase64(iv), ciphertext: bytesToBase64(ct), createdAt: Date.now(),
    };
  }
  await idb("readwrite", (s) => s.put(stored, slot(accountId)));
  return stored.publicKey;
}

const unlocked = new Map<string, string>(); // accountId → secret (PIN keys, this tab only)

export async function unlockPhoneKey(accountId: string, pin: string): Promise<void> {
  const k = await loadPhoneKey(accountId);
  if (!k || k.kind !== "pin") return;
  const b = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  try {
    const key = await pinKey(pin, b(k.salt));
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b(k.iv) }, key, b(k.ciphertext));
    unlocked.set(accountId, new TextDecoder().decode(pt));
  } catch {
    throw new Error("Wrong PIN");
  }
}

export function needsUnlock(k: StoredKey | null): boolean {
  return !!k && k.kind === "pin" && !unlocked.has(k.accountId);
}

async function signRaw(k: StoredKey, bytes: Uint8Array): Promise<Uint8Array> {
  if (k.kind === "webcrypto") {
    return new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, k.keyPair.privateKey, bytes as BufferSource));
  }
  const secret = unlocked.get(k.accountId);
  if (!secret) throw new Error("Unlock the phone key with your PIN first");
  const { ed25519 } = await import("@noble/curves/ed25519.js");
  return ed25519.sign(bytes, bs58.decode(secret.replace(/^ed25519:/, "")).slice(0, 32));
}

/** NEP-413 signature with the phone key (for /api/evidence/upload-url). */
export async function phoneSignNep413(accountId: string, payload: Nep413Payload) {
  const k = await loadPhoneKey(accountId);
  if (!k) throw new Error("No phone key on this device. Run /qs/setup first.");
  const sig = await signRaw(k, hashNep413(payload));
  return { accountId, publicKey: k.publicKey, signature: bytesToBase64(sig) };
}

async function makeSigner(k: StoredKey) {
  const { Signer, PublicKey } = await import("near-api-js");
  class PhoneSigner extends Signer {
    async getPublicKey() {
      return PublicKey.fromString(k.publicKey);
    }
    protected async signBytes(bytes: Uint8Array) {
      return signRaw(k, bytes);
    }
  }
  return new PhoneSigner();
}

/** Sign a delegate action with the phone key and submit it through /api/relay (gasless). */
export async function relayWithPhoneKey(accountId: string, spec: TxSpec): Promise<TxResult> {
  const k = await loadPhoneKey(accountId);
  if (!k) throw new PloteError("WALLET_NOT_CONNECTED", "no phone key", "No phone key on this device. Run /qs/setup first.");
  const { Account, JsonRpcProvider, actions, encodeSignedDelegate } = await import("near-api-js");
  const provider = new JsonRpcProvider({ url: RPC_URLS[0] });
  const signer = await makeSigner(k);
  const account = new Account(accountId, provider, signer);
  const { signedDelegate } = await account.createSignedMetaTransaction({
    receiverId: spec.receiverId,
    actions: spec.actions.map((a) => actions.functionCall(a.method, a.args, BigInt(a.gas), BigInt(a.deposit))),
    blockHeightTtl: 120,
  });
  const res = await fetch("/api/relay", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ signedDelegate: bytesToBase64(encodeSignedDelegate(signedDelegate)) }),
  });
  const j = (await res.json().catch(() => ({}))) as { code?: string; message?: string; hash?: string; logs?: string[]; returnValue?: unknown };
  if (!res.ok) throw new PloteError(j.code ?? "UNKNOWN", j.message ?? `relay HTTP ${res.status}`, j.code?.startsWith("E_") ? undefined : j.message);
  clearViewCache(spec.receiverId);
  const logs = j.logs ?? [];
  return { hash: j.hash ?? "", logs, events: parseEventLogs(logs), returnValue: j.returnValue };
}
