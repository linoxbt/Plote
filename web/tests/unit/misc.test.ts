import { describe, expect, it } from "vitest";
import { estateAccount, estateSlug, isValidAccountId, parseUnitQuery } from "@/lib/estates";
import { devScore, EMPTY_STATS } from "@/lib/score";
import { hamming, haversineM } from "@/lib/geo";
import { proofChecks, verdictSentence } from "@/lib/proof";
import { checkDelegate, type PlainDelegate } from "@/lib/server/relayer";
import type { EvidenceView } from "@/lib/types";

describe("unit lookup parsing (/check)", () => {
  it("accepts ids, accounts and URLs", () => {
    expect(parseUnitQuery("A-4B")).toEqual({ estate: "harmattan-court.plote.testnet", unit: "a-4b" });
    expect(parseUnitQuery("a-4b.harmattan-court")).toEqual({ estate: "harmattan-court.plote.testnet", unit: "a-4b" });
    expect(parseUnitQuery("a-4b.harmattan-court.plote.testnet")).toEqual({ estate: "harmattan-court.plote.testnet", unit: "a-4b" });
    expect(parseUnitQuery("https://plote.vercel.app/estates/baobab-heights/units/b-2a")).toEqual({ estate: "baobab-heights.plote.testnet", unit: "b-2a" });
    expect(parseUnitQuery("https://plote.vercel.app/w/playground/p-01")).toEqual({ estate: "playground.plote.testnet", unit: "p-01" });
    expect(parseUnitQuery("/check?u=a-1a")).toEqual({ estate: "harmattan-court.plote.testnet", unit: "a-1a" });
    expect(parseUnitQuery("")).toBeNull();
    expect(parseUnitQuery("not a unit!!")).toBeNull();
  });
  it("maps slugs to accounts", () => {
    expect(estateAccount("playground")).toBe("playground.plote.testnet");
    expect(estateSlug("playground.plote.testnet")).toBe("playground");
    expect(isValidAccountId("qs-adaeze.testnet")).toBe(true);
    expect(isValidAccountId("Bad..id")).toBe(false);
  });
});

describe("developer score (S7)", () => {
  it("is 'New on Plote' below 4 milestones due", () => {
    expect(devScore(EMPTY_STATS).isNew).toBe(true);
  });
  it("weights 40/25/15/10/10", () => {
    const s = devScore({ milestones_due: 4, milestones_on_time: 3, units_sold: 10, units_refunded: 1, evidence_submitted: 5, evidence_passed: 4, signoffs: 4, vetoes: 0, units_handed_over: 2 });
    // 40*.75 + 25*.9 + 15*.8 + 10*1 + 10*.1 = 30 + 22.5 + 12 + 10 + 1 = 75.5
    expect(s.isNew).toBe(false);
    expect(s.score).toBe(76);
    expect(s.components.map((c) => c.weight)).toEqual([40, 25, 15, 10, 10]);
  });
});

describe("geo + pHash", () => {
  it("haversine", () => {
    expect(Math.round(haversineM([6.447, 3.474], [6.447, 3.474]))).toBe(0);
    const d = haversineM([6.447, 3.474], [6.4472, 3.4742]);
    expect(d).toBeGreaterThan(25);
    expect(d).toBeLessThan(35);
  });
  it("hamming distance of 64-bit hex hashes", () => {
    expect(hamming("0000000000000000", "0000000000000000")).toBe(0);
    expect(hamming("ffffffffffffffff", "0000000000000000")).toBe(64);
    expect(hamming("8e71c0d2a4b39f05", "8e71c0d2a4b39f04")).toBe(1);
  });
});

describe("proof checklist", () => {
  const ev: EvidenceView = {
    id: "17", milestone: 1, url: "https://x/17.jpg", sha256: "9f".repeat(32), captured_at: "1793739420000000000", device_gps: null,
    challenge: "K7RQ4M", challenge_opened_at: "1793739000000000000", submitted_by: "qs.testnet", submitted_at: "1793743020000000000",
    status: "Pass", raw_response_hash: null, error: null,
    verdict: {
      pass: true, reasons: [], warnings: ["ai_unavailable"], phash: "8e71c0d2a4b39f05", nearest_distance: 27, exif_time: "1793739420000000000",
      gps: [6447118, 3474201], gps_source: "exif", distance_m: 23, ai_stage: "roofing", ai_confidence: 88, challenge_read: "K7RQ4M",
      ai_chat_id: null, worker_commit: "abc", attestation: null, source: "outlayer",
    },
  };
  it("marks warnings amber and others pass", () => {
    const c = Object.fromEntries(proofChecks(ev).map((x) => [x.key, x.state]));
    expect(c).toEqual({ integrity: "pass", freshness: "pass", location: "pass", reuse: "pass", stage: "warn", challenge: "pass" });
  });
  it("writes the plain-English verdict", () => {
    expect(verdictSentence(ev)).toContain("was taken 23 m from the site, 1h 0m before it was submitted, has not been used before, and shows roofing work.");
  });
  it("lists fail reasons", () => {
    const bad = { ...ev, status: "Fail" as const, verdict: { ...ev.verdict!, pass: false, reasons: ["phash_reuse:3"], warnings: [] } };
    expect(proofChecks(bad).find((x) => x.key === "reuse")?.state).toBe("fail");
    expect(verdictSentence(bad)).toContain("distance 3/64");
  });
});

describe("relayer allowlist", () => {
  const fc = (methodName: string, deposit = 0n, gas = 30_000_000_000_000n) => ({ functionCall: { methodName, args: [], gas, deposit } });
  const sd = (receiverId: string, actions: Record<string, unknown>[]): PlainDelegate => ({
    delegateAction: { senderId: "qs.testnet", receiverId, actions, nonce: 1n, maxBlockHeight: 10n, publicKey: {} },
    signature: {},
  });
  const opts = { allowedMethods: ["open_capture", "submit_evidence", "qs_sign", "sync", "sync_deposits", "sweep_unattributed"], maxGasTgas: 300, estates: ["playground.plote.testnet"] };
  it("accepts allowlisted zero-deposit calls to an estate or a unit's sync_deposits", () => {
    expect(checkDelegate(sd("playground.plote.testnet", [fc("qs_sign")]), opts).ok).toBe(true);
    expect(checkDelegate(sd("p-01.playground.plote.testnet", [fc("sync_deposits")]), opts).ok).toBe(true);
  });
  it("rejects other receivers, methods, deposits, gas and action types", () => {
    const code = (x: ReturnType<typeof checkDelegate>) => (x.ok ? "ok" : x.code);
    expect(code(checkDelegate(sd("musdc.plote.testnet", [fc("qs_sign")]), opts))).toBe("RECEIVER_NOT_ALLOWED");
    expect(code(checkDelegate(sd("playground.plote.testnet", [fc("claim_release")]), opts))).toBe("METHOD_NOT_ALLOWED");
    expect(code(checkDelegate(sd("p-01.playground.plote.testnet", [fc("qs_sign")]), opts))).toBe("METHOD_NOT_ALLOWED");
    expect(code(checkDelegate(sd("playground.plote.testnet", [fc("qs_sign", 1n)]), opts))).toBe("DEPOSIT_NOT_ALLOWED");
    expect(code(checkDelegate(sd("playground.plote.testnet", [fc("qs_sign", 0n, 301_000_000_000_000n)]), opts))).toBe("GAS_TOO_HIGH");
    expect(code(checkDelegate(sd("playground.plote.testnet", [{ transfer: { deposit: 1n } }]), opts))).toBe("ACTION_NOT_ALLOWED");
  });
});
