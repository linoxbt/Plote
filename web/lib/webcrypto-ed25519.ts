// Non-extractable Ed25519 keys through WebCrypto (Chrome 137+, Firefox 129+, Safari 17+, Node 18+).
// The private key never exists as bytes JavaScript can read: it lives in the browser's key store and is kept in
// IndexedDB as a CryptoKey (structured clone). Used for the app's login/dev function-call keys (lib/near.ts) the
// same way lib/phone-key.ts does for the surveyor's phone key.

import bs58 from "bs58";

let supported: Promise<boolean> | null = null;

/** Whether this runtime can generate, sign with and store non-extractable Ed25519 keys. Cached. */
export function ed25519WebCryptoSupported(): Promise<boolean> {
  supported ??= (async () => {
    try {
      if (typeof crypto === "undefined" || !crypto.subtle) return false;
      const kp = (await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"])) as CryptoKeyPair;
      const msg = new Uint8Array([1, 2, 3]);
      const sig = await crypto.subtle.sign({ name: "Ed25519" }, kp.privateKey, msg);
      return await crypto.subtle.verify({ name: "Ed25519" }, kp.publicKey, sig, msg);
    } catch {
      return false;
    }
  })();
  return supported;
}

/** "ed25519:<base58>" for a WebCrypto public key (public keys are always exportable). */
export async function nearPublicKey(publicKey: CryptoKey): Promise<string> {
  return "ed25519:" + bs58.encode(new Uint8Array(await crypto.subtle.exportKey("raw", publicKey)));
}

/** A fresh key pair whose private half can't be exported. */
export async function generateNonExtractable(): Promise<{ privateKey: CryptoKey; publicKey: string }> {
  const kp = (await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"])) as CryptoKeyPair;
  return { privateKey: kp.privateKey, publicKey: await nearPublicKey(kp.publicKey) };
}

// PKCS#8 wrapper for a raw 32-byte Ed25519 seed (RFC 8410): SEQUENCE { 0, AlgorithmIdentifier { 1.3.101.112 }, OCTET STRING { OCTET STRING seed } }.
const PKCS8_ED25519_PREFIX = new Uint8Array([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]);

/**
 * Import a near-api-js secret ("ed25519:<base58 of seed‖public>") as a NON-extractable WebCrypto key, and prove it
 * signs for `expectedPublicKey` before anyone relies on it. Used to migrate keys that older builds kept in localStorage.
 * Returns null if the runtime can't, or if the result doesn't match (the caller then keeps the old key).
 */
export async function importSecretNonExtractable(secret: string, expectedPublicKey: string): Promise<CryptoKey | null> {
  try {
    const raw = bs58.decode(secret.replace(/^ed25519:/, ""));
    if (raw.length !== 64 && raw.length !== 32) return null;
    const pkcs8 = new Uint8Array(PKCS8_ED25519_PREFIX.length + 32);
    pkcs8.set(PKCS8_ED25519_PREFIX);
    pkcs8.set(raw.slice(0, 32), PKCS8_ED25519_PREFIX.length);
    const privateKey = await crypto.subtle.importKey("pkcs8", pkcs8, { name: "Ed25519" }, false, ["sign"]);
    pkcs8.fill(0);
    const pub = bs58.decode(expectedPublicKey.replace(/^ed25519:/, ""));
    const publicKey = await crypto.subtle.importKey("raw", pub as BufferSource, { name: "Ed25519" }, true, ["verify"]);
    const probe = crypto.getRandomValues(new Uint8Array(32));
    const sig = await crypto.subtle.sign({ name: "Ed25519" }, privateKey, probe);
    return (await crypto.subtle.verify({ name: "Ed25519" }, publicKey, sig, probe)) ? privateKey : null;
  } catch {
    return null;
  }
}

/** Ed25519 signature over `bytes` (near-api-js hands a Signer the SHA-256 of the transaction). */
export async function signWith(privateKey: CryptoKey, bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, privateKey, bytes as BufferSource));
}
