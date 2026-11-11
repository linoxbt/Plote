import { describe, expect, it } from "vitest";
import { KeyPair } from "near-api-js";
import { ed25519WebCryptoSupported, generateNonExtractable, importSecretNonExtractable, signWith } from "@/lib/webcrypto-ed25519";
import { reservationActions } from "@/lib/reservation";
import { dataUriSvgSize, svgSize } from "@/lib/svg-size";
import { houseSvg, houseSvgDataUri } from "@/lib/svg-house";
import type { EstateView, UnitView } from "@/lib/types";

describe("non-extractable app keys (WebCrypto Ed25519)", () => {
  it("is available in this runtime", async () => {
    expect(await ed25519WebCryptoSupported()).toBe(true);
  });
  it("migrates a near-api-js secret into a non-extractable key that signs for the same public key", async () => {
    const kp = KeyPair.fromRandom("ed25519");
    const key = await importSecretNonExtractable(kp.toString(), kp.getPublicKey().toString());
    expect(key).not.toBeNull();
    expect(key!.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("pkcs8", key!)).rejects.toThrow();
    const msg = crypto.getRandomValues(new Uint8Array(32));
    const sig = await signWith(key!, msg);
    expect(kp.verify(msg, sig)).toBe(true);
  });
  it("refuses a secret that doesn't match the expected public key (the old key is kept)", async () => {
    const a = KeyPair.fromRandom("ed25519");
    const b = KeyPair.fromRandom("ed25519");
    expect(await importSecretNonExtractable(a.toString(), b.getPublicKey().toString())).toBeNull();
    expect(await importSecretNonExtractable("ed25519:notbase58!!", a.getPublicKey().toString())).toBeNull();
  });
  it("generates keys with a NEAR-format public key and a private half that can't be exported", async () => {
    const { privateKey, publicKey } = await generateNonExtractable();
    expect(publicKey).toMatch(/^ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}$/);
    expect(privateKey.extractable).toBe(false);
  });
});

describe("reservation actions", () => {
  const e = { params: { dust_threshold: "1000000" } } as unknown as EstateView;
  const now = 1_700_000_000_000;
  const ns = (ms: number) => (BigInt(ms) * 1_000_000n).toString();
  const unit = (p: Partial<UnitView>) => ({ status: "Available", reservation: null, unattributed: "0", ...p }) as UnitView;
  const reserved = (expiresMs: number) => unit({ status: "Reserved", reservation: { by: "alice.testnet", expires_at: ns(expiresMs) } });

  it("lets only the reserver cancel, and only while the reservation is live", () => {
    expect(reservationActions(reserved(now + 60_000), e, "alice.testnet", now)).toMatchObject({ cancel: true, expire: false });
    expect(reservationActions(reserved(now + 60_000), e, "bob.testnet", now)).toMatchObject({ cancel: false, expire: false });
    expect(reservationActions(reserved(now + 60_000), e, null, now).cancel).toBe(false);
  });
  it("lets anyone expire once expires_at has passed", () => {
    expect(reservationActions(reserved(now - 1), e, "bob.testnet", now)).toMatchObject({ cancel: false, expire: true, reserver: "alice.testnet" });
    expect(reservationActions(reserved(now - 1), e, null, now).expire).toBe(true);
  });
  it("offers a sweep only above the dust threshold", () => {
    expect(reservationActions(unit({ unattributed: "1000000" }), e, null, now).sweep).toBe(false);
    expect(reservationActions(unit({ unattributed: "1000001" }), e, null, now).sweep).toBe(true);
    expect(reservationActions(unit({}), e, null, now)).toEqual({ cancel: false, expire: false, sweep: false, reserver: null });
  });
});

describe("token image size", () => {
  it("reads the viewBox of the local drawing and of data URIs", () => {
    const input = { estateName: "E", unitLabel: "A-1", unitId: "a-1", approvedCount: 1, total: 4, status: "Allocated", paid: "0", price: "0" };
    const [w, h] = svgSize(houseSvg(input))!;
    expect(w).toBeGreaterThan(0);
    expect(dataUriSvgSize(houseSvgDataUri(input))).toEqual([w, h]);
    expect(dataUriSvgSize(`data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"></svg>')}`)).toEqual([400, 400]);
    expect(dataUriSvgSize("https://example.com/x.png")).toBeNull();
  });
});
