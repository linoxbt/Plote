// Audit 4 (web): estate genuineness, payment outcomes, wizard output vs the deploy scripts, callNoPopup fallback,
// cache invalidation, capture rules, verifier pin text and small helpers.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { captureEligibility, captureReuse, nextCapturable } from "@/lib/capture";
import { buildEstateConfig, firstErrorStep, GEOFENCE_MIN_M, nearNeeded, type WizardValues } from "@/lib/estate-config";
import { accountNetworkMismatch } from "@/lib/estates";
import { PloteError } from "@/lib/errors";
import { assertPayable, checkEstate, isDirectSubaccount, parseCodeHashes } from "@/lib/genuine";
import { isOptimizableImage, supabaseImagePattern } from "@/lib/images";
import { accountsTouchedBy, afterOwnTx, callNoPopup, fnCall, isKeyError, KeyUnusableError, parseView, viewFinality, type TxResult, type TxSpec } from "@/lib/near";
import { pinProblem } from "@/lib/phone-key";
import { verifierPin } from "@/lib/proof";
import { MilestoneViewSchema, SurplusRequestSchema, UnitViewSchema } from "@/lib/schemas";
import { messageForCode } from "@/lib/errors";
import { assertFtCallAccepted, ftCallOutcome } from "@/lib/tx-outcome";
import type { CaptureView, MilestoneView } from "@/lib/types";

const HASH = "J31YPbxD3kVvoezwLtMkiMW4FE52r51rRPbamEg9beNX";
const deps = (codeHash: string | null) => ({ estates: ["harmattan-court.plote.testnet"], root: "plote.testnet", hashes: [HASH], codeHashOf: vi.fn(async () => codeHash) });

describe("estate genuineness (audit 4 critical)", () => {
  it("accepts configured estates without an RPC call", async () => {
    const d = deps(null);
    expect(await checkEstate("harmattan-court.plote.testnet", d)).toEqual({ genuine: true, how: "configured" });
    expect(d.codeHashOf).not.toHaveBeenCalled();
  });

  it("accepts a direct root subaccount only when its code hash is a published estate build", async () => {
    expect(await checkEstate("new-estate.plote.testnet", deps(HASH))).toEqual({ genuine: true, how: "code_hash" });
    const bad = await checkEstate("new-estate.plote.testnet", deps("4dsXqDqZWZ6fV1cXP2xhm8Zn9XyNv7QKkLQWj3eYfRSU"));
    expect(bad.genuine).toBe(false);
    expect((await checkEstate("empty.plote.testnet", deps(null))).genuine).toBe(false);
  });

  it("rejects look-alike contracts outside the root and nested accounts without asking the chain", async () => {
    for (const a of ["scam.testnet", "harmattan-court.scam.testnet", "a-1.harmattan-court.plote.testnet", "plote.testnet.evil.testnet"]) {
      const d = deps(HASH);
      expect((await checkEstate(a, d)).genuine).toBe(false);
      expect(d.codeHashOf).not.toHaveBeenCalled();
    }
    expect(isDirectSubaccount("x.plote.testnet", "plote.testnet")).toBe(true);
    expect(isDirectSubaccount("a.x.plote.testnet", "plote.testnet")).toBe(false);
    expect(isDirectSubaccount("x.plote.testnet", "")).toBe(false);
  });

  it("parses a comma-separated hash list and drops junk", () => {
    expect(parseCodeHashes(` ${HASH}, nope ,${HASH},11111111111111111111111111111111 `)).toEqual([HASH, "11111111111111111111111111111111"]);
    expect(parseCodeHashes(undefined)).toEqual([]);
  });

  it("assertPayable refuses a non-genuine estate and a unit account that isn't <id>.<estate>", async () => {
    await expect(assertPayable("scam.testnet", { id: "a-1", account: "a-1.scam.testnet" }, deps(HASH))).rejects.toMatchObject({ code: "NOT_PLOTE" });
    await expect(assertPayable("harmattan-court.plote.testnet", { id: "a-1", account: "attacker.testnet" }, deps(HASH))).rejects.toMatchObject({ code: "NOT_PLOTE" });
    await expect(assertPayable("harmattan-court.plote.testnet", { id: "a-1", account: "a-1.harmattan-court.plote.testnet" }, deps(HASH))).resolves.toBeUndefined();
  });
});

const tx = (p: Partial<TxResult>): TxResult => ({ hash: "H", logs: [], events: [], returnValue: undefined, ...p });

describe("ft_transfer_call outcome (audit 4 high: refunded USDC is not a success)", () => {
  it("a deposit the unit refused (used 0, bounce log) is refused, with the reason", () => {
    const r = tx({ returnValue: "0", logs: ["deposit of 1000000 from bob.testnet bounced: unit a-1 isn't reserved"] });
    const o = ftCallOutcome(r, "1000000", "deposit");
    expect(o.status).toBe("refused");
    expect(o.refunded).toBe(1000000n);
    expect(o.reason).toMatch(/isn't reserved/);
    expect(() => assertFtCallAccepted(r, "1000000", "deposit")).toThrow(/refused and the USDC came back/);
  });

  it("a deposit kept in full is accepted", () => {
    expect(ftCallOutcome(tx({ returnValue: "1000000" }), "1000000", "deposit").status).toBe("accepted");
    expect(assertFtCallAccepted(tx({ returnValue: "1000000" }), "1000000", "deposit").used).toBe(1000000n);
  });

  it("a rejected purchase carries the contract code", () => {
    const r = tx({ returnValue: "5000000", logs: ["purchase rejected: E_LIEN: a lien blocks the sale"] });
    // used = 5000000 here would be a full purchase; a rejection returns "0"
    expect(ftCallOutcome({ ...r, returnValue: "0" }, "5000000", "purchase")).toMatchObject({ status: "refused", code: "E_LIEN" });
    try {
      assertFtCallAccepted({ ...r, returnValue: "0" }, "5000000", "purchase");
      throw new Error("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(PloteError);
      expect((e as PloteError).code).toBe("E_LIEN");
      expect((e as PloteError & { txHash?: string }).txHash).toBe("H");
    }
  });

  it("a purchase that keeps the ask and returns an overpayment is accepted when the sale happened", () => {
    const r = tx({ returnValue: "4000000", events: [{ standard: "plote", version: "1.0.0", event: "sold", data: [{ unit_id: "a-1" }] }] });
    expect(ftCallOutcome(r, "5000000", "purchase").status).toBe("accepted");
    expect(ftCallOutcome(tx({ returnValue: "4000000" }), "5000000", "deposit").status).toBe("partial");
  });

  it("falls back to events/logs without a return value, and never claims success when nothing is known", () => {
    expect(ftCallOutcome(tx({ events: [{ standard: "plote", version: "1.0.0", event: "deposit_synced", data: [{}] }] }), "1", "deposit").status).toBe("accepted");
    expect(ftCallOutcome(tx({ logs: ["deposit of 1 from x.testnet bounced: a transfer out of a-1 is pending; pay again after it lands"] }), "1", "deposit").status).toBe("refused");
    expect(() => assertFtCallAccepted(tx({}), "1", "deposit")).toThrow(/can't confirm/);
  });
});

const wizard: WizardValues = {
  name: "Test Estate", slug: "test-estate", location: "Lagos", lat: 6.5, lon: 3.4, radius: 300, mobilisation: 0,
  milestones: [
    { key: "foundation", title: "Foundation", pct: 20, deadline: "2027-02-01" },
    { key: "roofing", title: "Roofing", pct: 30, deadline: "2027-05-01" },
    { key: "finishing", title: "Finishing", pct: 30, deadline: "2027-08-01" },
    { key: "handover", title: "Handover", pct: 20, deadline: "2027-11-01" },
  ],
  developer: "dev.testnet", payout: "dev.testnet", surveyor: "qs.testnet", demo: true, units: 12, unitPrice: 60000, unitLabel: "Unit {n}", unitPrefix: "u", verifierKey: "abc",
};

describe("estate wizard output = scripts/deploy-estate.ts config schema (audit 4 high)", () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const deploy = readFileSync(`${root}scripts/deploy-estate.ts`, "utf8");
  const addUnits = readFileSync(`${root}scripts/add-units.ts`, "utf8");
  const sample = JSON.parse(readFileSync(`${root}config/harmattan-court.testnet.json`, "utf8")) as Record<string, unknown>;
  const cfg = buildEstateConfig(wizard, { network: "testnet", root: "plote.testnet" }) as unknown as Record<string, unknown>;

  it("emits every field the deploy scripts read, and no contract-style *_id names", () => {
    const read = new Set([...deploy.matchAll(/\bcfg\.([a-z_]+)/g), ...addUnits.matchAll(/\bcfg\.([a-z_]+)/g)].map((m) => m[1]));
    expect(read.size).toBeGreaterThan(5);
    for (const k of read) expect(cfg, `deploy script reads cfg.${k}`).toHaveProperty(k);
    for (const k of Object.keys(cfg)) expect(k.endsWith("_id")).toBe(false);
  });

  it("has the same top-level keys and param keys as the checked-in testnet config", () => {
    for (const k of Object.keys(sample)) if (k !== "units") expect(cfg, k).toHaveProperty(k);
    expect(Object.keys(cfg.params as object).sort()).toEqual(Object.keys(sample.params as object).sort());
    expect(Object.keys(cfg.verifier as object).sort()).toEqual(Object.keys(sample.verifier as object).sort());
    expect((cfg.milestones as { bps: number }[]).reduce((n, m) => n + m.bps, 0)).toBe(10000);
  });

  it("honours the unit count and price, and forces demo off on mainnet", () => {
    expect(cfg.generate_units).toEqual({ prefix: "u", count: 12, label: "Unit {n}", price: "60000000000" });
    expect(cfg.units).toEqual([]);
    const main = buildEstateConfig({ ...wizard, demo: true }, { network: "mainnet", root: "plote.near" });
    expect(main.params.demo_mode).toBe(false);
    expect(main.verdict_relayer).toBeNull();
    expect(Number(main.params.veto_window_ns)).toBeGreaterThanOrEqual(24 * 3600 * 1e9);
    expect(buildEstateConfig({ ...wizard, units: 0 }, { network: "testnet", root: "plote.testnet" }).generate_units).toBeUndefined();
  });

  it("estimates 0.035 NEAR per unit and jumps Review to the first step with an error", () => {
    expect(nearNeeded(10)).toBeCloseTo(7 + 0.35 + 5);
    expect(GEOFENCE_MIN_M).toBe(50);
    expect(firstErrorStep({ surveyor: {}, radius: {} })).toBe(0);
    expect(firstErrorStep({ unitPrice: {} })).toBe(3);
    expect(firstErrorStep({})).toBeNull();
  });
});

const spec = fnCall("harmattan-court.plote.testnet", "vote", { proposal_id: "1", approve: true }, 100);
const key = { publicKey: "ed25519:x", privateKey: {} as CryptoKey, methods: ["vote"] };
const ok: TxResult = { hash: "K", logs: [], events: [], returnValue: null };

describe("callNoPopup falls back to the wallet only on key errors (audit 4 medium)", () => {
  it("uses the app key when it works", async () => {
    const wallet = vi.fn(async () => ok);
    const r = await callNoPopup("me.testnet", spec, { load: async () => key, send: async () => ok, wallet });
    expect(r.hash).toBe("K");
    expect(wallet).not.toHaveBeenCalled();
  });

  it("falls back on a missing/unusable key or an invalid-access-key rejection", async () => {
    for (const err of [new KeyUnusableError("key not found on the account"), new Error('{"InvalidTxError":{"InvalidAccessKeyError":"AccessKeyNotFound"}}'), Object.assign(new Error("tx rejected"), { type: "NotEnoughAllowance" })]) {
      const wallet = vi.fn(async () => ok);
      await callNoPopup("me.testnet", spec, { load: async () => key, send: async () => { throw err; }, wallet });
      expect(wallet).toHaveBeenCalledTimes(1);
    }
  });

  it("never asks the wallet after a timeout, a network error or a contract panic (the tx may already be sent)", async () => {
    for (const err of [new Error("Request timed out"), new TypeError("Failed to fetch"), new PloteError("E_ALREADY_VOTED", "panicked")]) {
      const wallet = vi.fn(async () => ok);
      await expect(callNoPopup("me.testnet", spec, { load: async () => key, send: async () => { throw err; }, wallet })).rejects.toBe(err);
      expect(wallet).not.toHaveBeenCalled();
    }
  });

  it("goes straight to the wallet for payable calls and without a stored key", async () => {
    const send = vi.fn(async () => ok);
    const wallet = vi.fn(async () => ok);
    await callNoPopup("me.testnet", fnCall("e.testnet", "propose", {}, 100, "50000000000000000000000"), { load: async () => key, send, wallet });
    await callNoPopup("me.testnet", spec, { load: async () => null, send, wallet });
    expect(send).not.toHaveBeenCalled();
    expect(wallet).toHaveBeenCalledTimes(2);
  });

  it("classifies errors", () => {
    expect(isKeyError(new Error("access key ed25519:abc does not exist while viewing"))).toBe(true);
    expect(isKeyError(new Error("MethodNameMismatch"))).toBe(true);
    expect(isKeyError(new Error("504 Gateway Timeout"))).toBe(false);
    expect(isKeyError(new PloteError("E_NOT_HOLDER", "AccessKeyNotFound in message"))).toBe(false);
  });
});

describe("cache invalidation and finality after the user's own tx (audit 4 medium)", () => {
  it("a USDC payment to a unit touches the unit, its estate and USDC", () => {
    const s: TxSpec = fnCall("musdc.plote.testnet", "ft_transfer_call", { receiver_id: "a-1.harmattan-court.plote.testnet", amount: "1", msg: "" }, 150, "1");
    const t = accountsTouchedBy(s);
    expect(t).toEqual(expect.arrayContaining(["musdc.plote.testnet", "a-1.harmattan-court.plote.testnet", "harmattan-court.plote.testnet"]));
    expect(accountsTouchedBy(fnCall("a-1.harmattan-court.plote.testnet", "sync_deposits", {}, 80))).toContain("harmattan-court.plote.testnet");
  });

  it("reads optimistic state for a while after a transaction", () => {
    const now = Date.now();
    afterOwnTx(spec);
    expect(viewFinality(now + 1000)).toBe("optimistic");
    expect(viewFinality(now + 3_600_000)).toBe("final");
  });
});

const M = (index: number, status: MilestoneView["status"]): MilestoneView => ({
  index, key: `m${index}`, title: `M${index}`, bps: 2500, deadline: "1", status, late: false, evidence_ids: [],
  verified_at: null, signed_at: null, veto_until: null, veto_passed: status === "Approved", refunds_open_at: "1",
});

describe("capture rules (audit 4 medium + milestone order)", () => {
  it("offers only the next milestone in order, and only Open/Vetoed/Missed", () => {
    const ms = [M(0, "Approved"), M(1, "Open"), M(2, "Open"), M(3, "Open")];
    expect(captureEligibility(ms, 1).ok).toBe(true);
    expect(captureEligibility(ms, 2)).toMatchObject({ ok: false });
    expect(captureEligibility([M(0, "Checking"), M(1, "Open")], 0)).toMatchObject({ ok: false });
    expect(captureEligibility([M(0, "Missed")], 0).ok).toBe(true);
    expect(nextCapturable([M(0, "Approved"), M(1, "Vetoed"), M(2, "Open")])?.index).toBe(1);
  });

  it("reuses only my own live capture; someone else's blocks unless I'm the surveyor", () => {
    const ns = (ms: number) => (BigInt(ms) * 1_000_000n).toString();
    const now = 1_000_000_000;
    const cap = (by: string, leftMs: number): CaptureView => ({ milestone: 0, code: "ABC123", by, opened_at: ns(now - 1000), expires_at: ns(now + leftMs) });
    expect(captureReuse(null, "me", now, { surveyorId: "qs" })).toEqual({ action: "open" });
    expect(captureReuse(cap("me", 20 * 60_000), "me", now, { surveyorId: "qs" })).toEqual({ action: "reuse" });
    expect(captureReuse(cap("me", 60_000), "me", now, { surveyorId: "qs" })).toEqual({ action: "open" });
    expect(captureReuse(cap("judge", 20 * 60_000), "me", now, { surveyorId: "qs" })).toMatchObject({ action: "blocked", by: "judge" });
    expect(captureReuse(cap("judge", 20 * 60_000), "qs", now, { surveyorId: "qs" })).toEqual({ action: "open" });
    expect(captureReuse(cap("judge", -1), "me", now, { surveyorId: "qs" })).toEqual({ action: "open" });
  });
});

describe("proof page verifier pin (audit 4 medium)", () => {
  it("never compares a git SHA with a WASM hash and builds no project: link", () => {
    const p = verifierPin({ repo: "project:plote.testnet/plote-verifier", commit: "31c7225d" }, "affdf57aaaa");
    expect(p).toMatchObject({ kind: "project", sourceUrl: null, match: "n/a" });
    expect(verifierPin({ repo: "project:plote.testnet/plote-verifier", commit: "ABC" }, "abc").match).toBe("matches");
  });

  it("matches / differs for a GitHub pin, with a real tree link", () => {
    const sha = "a".repeat(40);
    expect(verifierPin({ repo: "https://github.com/x/plote-verifier", commit: sha }, sha.toUpperCase())).toMatchObject({ match: "matches", sourceUrl: `https://github.com/x/plote-verifier/tree/${sha}` });
    expect(verifierPin({ repo: "https://github.com/x/plote-verifier", commit: sha }, "b".repeat(40)).match).toBe("differs");
    expect(verifierPin({ repo: "https://github.com/x/plote-verifier", commit: sha }, null).match).toBe("no-verdict");
  });
});

describe("small helpers", () => {
  it("network mismatch", () => {
    expect(accountNetworkMismatch("alice.near", "testnet")).toMatch(/mainnet account/);
    expect(accountNetworkMismatch("alice.testnet", "mainnet")).toMatch(/testnet account/);
    expect(accountNetworkMismatch("alice.testnet", "testnet")).toBeNull();
    expect(accountNetworkMismatch("a".repeat(64), "mainnet")).toBeNull();
  });

  it("PIN needs at least 6 digits", () => {
    expect(pinProblem("1234")).toMatch(/6 digits/);
    expect(pinProblem("12345a")).toMatch(/6 digits/);
    expect(pinProblem("123456")).toBeNull();
  });

  it("only this project's Supabase public bucket goes through the image optimiser", () => {
    const sb = "https://abc.supabase.co";
    expect(supabaseImagePattern(sb)).toEqual({ protocol: "https", hostname: "abc.supabase.co", pathname: "/storage/v1/object/public/**" });
    expect(isOptimizableImage("https://abc.supabase.co/storage/v1/object/public/evidence/x.jpg", sb)).toBe(true);
    expect(isOptimizableImage("https://evil.example/storage/v1/object/public/evidence/x.jpg", sb)).toBe(false);
    expect(isOptimizableImage("https://abc.supabase.co/storage/v1/object/sign/evidence/x.jpg", sb)).toBe(false);
    expect(isOptimizableImage("https://abc.supabase.co/storage/v1/object/public/x.jpg", undefined)).toBe(false);
  });

  it("view shapes are validated with a clear error", () => {
    expect(() => parseView({ id: "a-1" }, UnitViewSchema, "e get_unit")).toThrow(/doesn't understand/);
    try {
      parseView([{ index: 0 }], MilestoneViewSchema.array(), "e get_milestones");
    } catch (e) {
      expect((e as PloteError).code).toBe("BAD_VIEW");
    }
    const m = M(0, "Open");
    expect(parseView({ ...m, extra: 1 }, MilestoneViewSchema, "x")).toMatchObject({ extra: 1, late: false });
  });
});

describe("audit 4 follow-up", () => {
  it("app and server codes have their own messages", () => {
    for (const c of ["NOT_PLOTE", "PAYMENT_REFUNDED", "PAYMENT_UNCONFIRMED", "BAD_VIEW", "APP_KEY_UNSUPPORTED", "APP_KEY_UNUSABLE", "LISTING_BLOCKED", "NOTHING_RELEASED", "SETUP_PENDING", "REPLAY_CHECK_UNAVAILABLE", "QUOTE_NOT_RECORDED", "POLL_LOCK_UNAVAILABLE"]) {
      expect(messageForCode(c), c).not.toBe(messageForCode("UNKNOWN"));
    }
  });

  it("get_surplus_request shape", () => {
    expect(parseView({ at: "1", amount: "5", ready_at: "604800000000001" }, SurplusRequestSchema.nullable(), "x")).toMatchObject({ amount: "5" });
    expect(parseView(null, SurplusRequestSchema.nullable(), "x")).toBeNull();
    expect(() => parseView({ at: 1 }, SurplusRequestSchema, "x")).toThrow();
  });
});
