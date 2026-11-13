import { afterEach, describe, expect, it, vi } from "vitest";
import { KeyPair } from "near-api-js";
import { bytesToBase64 } from "@/lib/near";
import { encodeGatePass, gateMessage, randomNonce, signNep413WithSecret } from "@/lib/nep413";
import { collectWindow, memoryStore, parseTxReceipts, pollEstate, supabaseStore, type NbReceipt, type OutcomeReceipt, type PollDeps } from "@/lib/server/poller";
import { planCleanup, PLAYGROUND_RETENTION_MS } from "@/lib/server/storage-cleanup";
import { photoCheckStatus, publicView } from "@/lib/server/health";
import { confirmToken, notifyConfigured, readToken, readUnsubscribeToken, UNSUBSCRIBE_TTL_MS, unsubscribeToken } from "@/lib/server/notify";
import { createHmac } from "node:crypto";
import { verifyGatePassServer, type GateDeps } from "@/lib/server/gate";
import { relayLimits, uploadLimits } from "@/lib/server/limits";
import { warnFallback } from "@/lib/server/rate-limit";
import { oneclickChipin } from "@/lib/server/oneclick-server";

const ESTATE = "playground.plote.testnet";
const ev = (event: string, data: Record<string, unknown> = {}) => `EVENT_JSON:${JSON.stringify({ standard: "plote", version: "1.0.0", event, data: [data] })}`;

function rec(id: string, tx: string, height: number, from: string, to = ESTATE): NbReceipt {
  return { receipt_id: id, transaction_hash: tx, predecessor_account_id: from, receiver_account_id: to, block: { block_height: String(height), block_timestamp: `${height}000000000` } };
}

/** NearBlocks-like listing: newest first, pages of `size`. */
function lister(all: NbReceipt[], size = 3): PollDeps["listReceipts"] & { calls: number } {
  const sorted = [...all].sort((a, b) => Number(b.block!.block_height) - Number(a.block!.block_height));
  const f = (async (_e: string, next: string | null) => {
    f.calls++;
    const start = next ? Number(next) : 0;
    const page = sorted.slice(start, start + size);
    return { receipts: page, next: start + size < sorted.length ? String(start + size) : null };
  }) as PollDeps["listReceipts"] & { calls: number };
  f.calls = 0;
  return f;
}

describe("event poller: indexes receipts, not transactions", () => {
  // tx A: relayed meta-tx (outer receiver = the surveyor) → submit_evidence on the estate, then the OutLayer callback.
  // tx B: USDC ft_transfer_call (outer receiver = USDC) → ft_on_transfer on the estate.
  // tx C: a failed call; tx D: a call with no events.
  const outcomes: Record<string, OutcomeReceipt[]> = {
    A: [
      { id: "a0", executor: "qs.testnet", logs: [], success: true },
      { id: "a1", executor: ESTATE, logs: [ev("evidence_submitted", { evidence_id: "7" })], success: true },
      { id: "a2", executor: ESTATE, logs: [ev("verdict", { evidence_id: "7", pass: true }), ev("qs_signed", { milestone: 1 })], success: true },
    ],
    B: [{ id: "b1", executor: ESTATE, logs: [ev("deposit_synced", { unit_id: "a-1" })], success: true }],
    C: [{ id: "c1", executor: ESTATE, logs: [ev("released", { unit_id: "a-1" })], success: false }],
    D: [{ id: "d1", executor: ESTATE, logs: ["plain log"], success: true }],
  };
  const txReceipts = vi.fn(async (tx: string) => outcomes[tx]);

  it("finds relayed, ft_transfer_call and callback receipts; records event-less ones; skips failed receipts", async () => {
    const receipts = [
      rec("a0", "A", 100, "relayer.testnet", "qs.testnet"), // outer meta-tx receipt: not the estate's
      rec("a1", "A", 101, "qs.testnet"),
      rec("b1", "B", 102, "musdc.testnet"),
      rec("x1", "B", 102, ESTATE, "a-1." + ESTATE), // estate → unit: outgoing, ignored
      rec("c1", "C", 103, "bob.testnet"),
      rec("d1", "D", 104, "bob.testnet"),
    ];
    const mem = memoryStore({ cursor: { [ESTATE]: 90 } });
    const { report, inserted } = await pollEstate(ESTATE, { listReceipts: lister(receipts), txReceipts, store: mem.store });
    expect(inserted.map((e) => e.event).sort()).toEqual(["deposit_synced", "evidence_submitted"]);
    expect([...mem.seen].sort()).toEqual(["a1", "b1", "c1", "d1"]);
    expect(report).toMatchObject({ fresh: 4, processed: 4, inserted: 2, gap: false, errors: [] });
    expect(mem.cursor.get(ESTATE)).toBe(104);
    expect(inserted[0]).toMatchObject({ network: "testnet", estate: ESTATE, tx_hash: "A", block_height: 101 });

    // Next run: the OutLayer callback (a later receipt of tx A) lands. Only it is read and inserted; nothing is refetched.
    txReceipts.mockClear();
    const again = await pollEstate(ESTATE, { listReceipts: lister([...receipts, rec("a2", "A", 120, ESTATE)]), txReceipts, store: mem.store });
    expect(txReceipts).toHaveBeenCalledTimes(1);
    expect(again.inserted.map((e) => e.event)).toEqual(["verdict", "qs_signed"]);
    expect(mem.cursor.get(ESTATE)).toBe(120);

    // Idempotent: a third run reads no outcomes and inserts nothing (so no email is sent twice).
    txReceipts.mockClear();
    const third = await pollEstate(ESTATE, { listReceipts: lister([...receipts, rec("a2", "A", 120, ESTATE)]), txReceipts, store: mem.store });
    expect(txReceipts).not.toHaveBeenCalled();
    expect(third.inserted).toEqual([]);
  });

  it("keeps the cursor below a transaction it couldn't read, and retries it", async () => {
    const mem = memoryStore({ cursor: { [ESTATE]: 50 } });
    const flaky = vi.fn(async (tx: string) => {
      if (tx === "B") throw new Error("rpc down");
      return outcomes[tx];
    });
    const receipts = [rec("a1", "A", 101, "qs.testnet"), rec("b1", "B", 102, "musdc.testnet"), rec("d1", "D", 104, "bob.testnet")];
    const r = await pollEstate(ESTATE, { listReceipts: lister(receipts), txReceipts: flaky, store: mem.store });
    expect(r.report.errors).toHaveLength(1);
    expect(mem.cursor.get(ESTATE)).toBe(101);
    expect(mem.seen.has("b1")).toBe(false);
    const r2 = await pollEstate(ESTATE, { listReceipts: lister(receipts), txReceipts, store: mem.store });
    expect(r2.inserted.map((e) => e.event)).toEqual(["deposit_synced"]);
    expect(mem.cursor.get(ESTATE)).toBe(104);
  });

  it("walks pages down to the cursor (with lookback) and flags a gap when it can't reach it", async () => {
    const many = Array.from({ length: 20 }, (_, i) => rec(`r${i}`, `T${i}`, 1000 + i, "bob.testnet"));
    const l = lister(many, 3);
    const w = await collectWindow(ESTATE, 1010, l, 10);
    expect(w.reachedFloor).toBe(true);
    expect(w.refs.map((r) => r.height).sort()).toEqual([1011, 1012, 1013, 1014, 1015, 1016, 1017, 1018, 1019]);
    expect(w.newest).toBe(1019);
    const short = await collectWindow(ESTATE, 900, lister(many, 3), 2);
    expect(short.reachedFloor).toBe(false);
    expect(short.refs).toHaveLength(6);
  });

  it("first run bootstraps from the newest page only", async () => {
    const many = Array.from({ length: 10 }, (_, i) => rec(`r${i}`, "D", 1000 + i, "bob.testnet"));
    const l = lister(many, 3);
    const mem = memoryStore();
    const r = await pollEstate(ESTATE, { listReceipts: l, txReceipts: async () => many.map((m) => ({ id: m.receipt_id, executor: ESTATE, logs: [], success: true })), store: mem.store });
    expect(l.calls).toBe(1);
    expect(r.report.gap).toBe(false);
    expect(mem.cursor.get(ESTATE)).toBe(1009);
  });

  it("defers transactions beyond the per-run cap without skipping them", async () => {
    const receipts = [rec("a1", "A", 101, "qs.testnet"), rec("b1", "B", 102, "musdc.testnet"), rec("d1", "D", 104, "bob.testnet")];
    const mem = memoryStore({ cursor: { [ESTATE]: 50 } });
    const r = await pollEstate(ESTATE, { listReceipts: lister(receipts), txReceipts, store: mem.store }, { maxTxs: 1 });
    expect(r.report.deferred).toBe(2);
    expect(mem.cursor.get(ESTATE)).toBe(101);
    await pollEstate(ESTATE, { listReceipts: lister(receipts), txReceipts, store: mem.store });
    expect([...mem.seen].sort()).toEqual(["a1", "b1", "d1"]);
  });

  it("reads RPC outcomes: success statuses only, executor and logs per receipt", () => {
    const out = parseTxReceipts({
      receipts_outcome: [
        { id: "1", outcome: { logs: ["x"], executor_id: ESTATE, status: { SuccessValue: "" } } },
        { id: "2", outcome: { logs: [], executor_id: ESTATE, status: { SuccessReceiptId: "9" } } },
        { id: "3", outcome: { logs: ["y"], executor_id: ESTATE, status: { Failure: {} } } },
      ],
    });
    expect(out.map((o) => o.success)).toEqual([true, true, false]);
    expect(out[0]).toEqual({ id: "1", executor: ESTATE, logs: ["x"], success: true });
  });

  it("dry-run store reads Supabase but never writes", async () => {
    const writes: string[] = [];
    const q = (table: string) => {
      const chain: Record<string, unknown> = {};
      const ret = (data: unknown) => Promise.resolve({ data, error: null });
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.in = () => ret([{ receipt_id: "seen1" }]);
      chain.maybeSingle = () => ret({ block_height: 42, resume_next: null });
      chain.upsert = () => {
        writes.push(table);
        return { select: () => ret([]) , then: (f: (x: unknown) => unknown) => f({ error: null }) };
      };
      return chain;
    };
    const rpc = () => {
      writes.push("rpc");
      return Promise.resolve({ error: null });
    };
    const store = supabaseStore({ from: q, rpc } as never, { dryRun: true });
    expect(await store.getState(ESTATE)).toEqual({ height: 42, resume: null });
    expect([...(await store.seen(["seen1", "new1"]))]).toEqual(["seen1"]);
    await store.saveState(ESTATE, { height: 50, resume: null });
    await store.markProcessed([{ receipt_id: "new1", estate: ESTATE, tx_hash: "T", block_height: 50, events: 0 }]);
    const rows = [{ network: "testnet", estate: ESTATE, unit: null, standard: "plote", event: "qs_signed", data: {}, tx_hash: "T", receipt_id: "R", log_index: 0, data_index: 0, block_height: 50, block_time: "x", notified_at: null }];
    expect(await store.insertEvents(rows)).toEqual(rows);
    expect(writes).toEqual([]);
  });
});

describe("storage cleanup plan", () => {
  const now = Date.parse("2026-11-11T00:00:00Z");
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
  it("deletes old unreferenced playground files, late and wrong-size uploads; never referenced ones", () => {
    const plan = planCleanup({
      now,
      playground: true,
      referencedUrls: ["https://x.supabase.co/storage/v1/object/public/evidence/playground/kept.jpg"],
      objects: [
        { path: "playground/old.jpg", createdAt: iso(PLAYGROUND_RETENTION_MS + 1000), size: 10 },
        { path: "playground/kept.jpg", createdAt: iso(PLAYGROUND_RETENTION_MS + 1000), size: 10 },
        { path: "playground/new.jpg", createdAt: iso(1000), size: 10 },
        { path: "playground/late.jpg", createdAt: iso(1000), size: 10 },
        { path: "playground/big.jpg", createdAt: iso(1000), size: 99 },
      ],
      rows: [
        { path: "playground/new.jpg", size_bytes: 10, upload_expires_at: iso(-60_000) },
        { path: "playground/late.jpg", size_bytes: 10, upload_expires_at: iso(10 * 60_000) },
        { path: "playground/big.jpg", size_bytes: 10, upload_expires_at: iso(-60_000) },
      ],
    });
    expect(plan).toEqual([
      { path: "playground/old.jpg", reason: "playground_expired" },
      { path: "playground/late.jpg", reason: "uploaded_late" },
      { path: "playground/big.jpg", reason: "size_mismatch" },
    ]);
  });
  it("keeps old files of real estates", () => {
    expect(planCleanup({ now, playground: false, referencedUrls: [], rows: [], objects: [{ path: "harmattan-court/a.jpg", createdAt: iso(PLAYGROUND_RETENTION_MS * 3), size: 1 }] })).toEqual([]);
  });
});

describe("health: data-driven photo checks, public view", () => {
  const e = (status: "Pass" | "Fail" | "Error" | "Pending", reasons: string[] = [], warnings: string[] = [], at = 1) =>
    ({ status, submitted_at: String(at), verdict: status === "Error" || status === "Pending" ? null : ({ reasons, warnings } as never) }) as Parameters<typeof photoCheckStatus>[0][number];
  it("fails only when every one of the latest N verdicts is an infrastructure failure", () => {
    const bad = [e("Fail", ["ai_unavailable"], [], 5), e("Error", [], [], 4), e("Fail", ["challenge_unverified"], [], 3), e("Pass", [], ["ai_unavailable"], 2), e("Fail", ["worker_error"], [], 1)];
    const r = photoCheckStatus(bad, 5);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("ai_unavailable/challenge_unverified/worker_error");
    expect(photoCheckStatus([...bad.slice(0, 4), e("Pass", [], [], 6)], 5).ok).toBe(true);
    // Fewer than 5 decided (but at least 3): judged on what there is; fewer than 3: not enough data.
    expect(photoCheckStatus([e("Pending", [], [], 9), ...bad.slice(0, 3)], 5)).toMatchObject({ ok: false, sample: 3 });
    expect(photoCheckStatus(bad.slice(0, 2), 5)).toMatchObject({ ok: true, sample: 2 });
  });
  it("public view keeps flags only and says 'mainnet only' for 1Click on testnet", () => {
    const v = publicView({
      oneclick: { ok: true, configured: false, mainnet_only: true, detail: "mainnet only: x" },
      accounts: { ok: false, detail: "LOW: dev-harmattan.plote.testnet below 0.5 NEAR" },
      photo_checks: { ok: false, detail: "the last 5 photo checks all reported ai_unavailable" },
    });
    expect(v.oneclick).toEqual({ ok: true, configured: false, mainnet_only: true, detail: "mainnet only" });
    expect(JSON.stringify(v)).not.toContain("dev-harmattan");
    expect(v.accounts.ok).toBe(false);
    expect(v.photo_checks.detail).toBe("recent photo checks are failing (AI, challenge read or worker)");
  });
});

describe("notify: dedicated secret, required sender", () => {
  const keep = { ...process.env };
  afterEach(() => {
    process.env = { ...keep };
  });
  /** A link as the old code made it: [account, estate, unit] signed with CRON_SECRET. */
  const legacyUnsub = (key: string) => {
    const body = Buffer.from(JSON.stringify(["alice.testnet", ESTATE, "a-1"])).toString("base64url");
    return `${body}.${createHmac("sha256", key).update(body).digest("base64url")}`;
  };
  it("signs only with NOTIFY_SECRET; CRON_SECRET only verifies old unsubscribe links", () => {
    process.env.CRON_SECRET = "cron";
    delete process.env.NOTIFY_SECRET;
    expect(() => unsubscribeToken("alice.testnet", ESTATE, "a-1")).toThrow(/NOTIFY_SECRET/);
    expect(() => confirmToken("alice.testnet", ESTATE, "a-1", "a@example.com")).toThrow(/NOTIFY_SECRET/);
    const old = legacyUnsub("cron");
    expect(readUnsubscribeToken(old)).toEqual({ account: "alice.testnet", estate: ESTATE, unit: "a-1" }); // old links keep working
    process.env.NOTIFY_SECRET = "notify";
    const fresh = unsubscribeToken("alice.testnet", ESTATE, "a-1", 1_000);
    expect(readUnsubscribeToken(fresh, 2_000)).toEqual({ account: "alice.testnet", estate: ESTATE, unit: "a-1" });
    expect(readUnsubscribeToken(fresh, 1_000 + UNSUBSCRIBE_TTL_MS + 1)).toBe("expired");
    expect(readUnsubscribeToken(old)).toMatchObject({ unit: "a-1" });
    expect(readToken(old)).toBeNull(); // only unsubscribe links fall back to the legacy key
    const c = confirmToken("alice.testnet", ESTATE, "a-1", "a@example.com", 1);
    expect(readToken(c)).toHaveLength(6);
    expect(readUnsubscribeToken(c)).toBeNull(); // a confirm link is not an unsubscribe link
    delete process.env.CRON_SECRET;
    expect(readUnsubscribeToken(old)).toBeNull();
  });
  it("is off without NOTIFY_SECRET (CRON_SECRET no longer signs)", () => {
    Object.assign(process.env, { RESEND_API_KEY: "re_x", RESEND_FROM: "Plote <n@x.example>", CRON_SECRET: "c", NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k" });
    delete process.env.NOTIFY_SECRET;
    expect(notifyConfigured()).toBe(false);
  });
  it("is configured only with RESEND_API_KEY and RESEND_FROM (no default sender)", () => {
    Object.assign(process.env, { RESEND_API_KEY: "re_x", NOTIFY_SECRET: "n", NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k" });
    delete process.env.RESEND_FROM;
    expect(notifyConfigured()).toBe(false);
    process.env.RESEND_FROM = "Plote <notify@verified.example>";
    expect(notifyConfigured()).toBe(true);
  });
});

describe("gate pass: server-side, single use", () => {
  const kp = KeyPair.fromRandom("ed25519");
  const sk = kp.toString();
  const now = 1_800_000_000_000;
  function pass(opts: { estate?: string; ts?: number; recipient?: string } = {}) {
    const nonce = randomNonce();
    const message = gateMessage(opts.estate ?? "playground", "a-1", opts.ts ?? now);
    const s = signNep413WithSecret({ message, nonce, recipient: opts.recipient ?? ESTATE }, sk);
    return encodeGatePass({ accountId: "holder.testnet", publicKey: s.publicKey, signature: s.signature, nonce: bytesToBase64(nonce), message });
  }
  function deps(over: Partial<GateDeps> = {}): GateDeps {
    const claimed = new Set<string>();
    return {
      readKey: async () => ({ nonce: 1, permission: "FullAccess" }),
      token: async () => ({ owner_id: "holder.testnet" }),
      unit: async () => ({ status: "HandedOver", label: "A-1" }),
      claim: async (scope, key) => ({ ok: !claimed.has(scope + key) && !!claimed.add(scope + key), shared: true }),
      ...over,
    };
  }
  it("accepts a valid pass once, then rejects the replay", async () => {
    const d = deps();
    const p = pass();
    expect(await verifyGatePassServer(p, ESTATE, d, now + 1000)).toMatchObject({ ok: true, unit: "a-1", label: "A-1", replayCheck: "shared" });
    expect(await verifyGatePassServer(p, ESTATE, d, now + 2000)).toMatchObject({ ok: false, code: "NONCE_USED" });
  });
  it("rejects wrong estate, expired, forged, function-call keys and non-holders without burning the nonce", async () => {
    const claim = vi.fn(async () => ({ ok: true, shared: true }));
    const code = async (p: string, over: Partial<GateDeps> = {}) => {
      const r = await verifyGatePassServer(p, ESTATE, deps({ claim, ...over }), now + 1000);
      return r.ok ? "ok" : r.code;
    };
    expect(await code(pass({ estate: "harmattan-court" }))).toBe("GATE_WRONG_ESTATE");
    expect(await code(pass({ ts: now - 120_000 }))).toBe("GATE_EXPIRED");
    expect(await code(pass({ recipient: "other.testnet" }))).toBe("BAD_SIGNATURE");
    expect(await code(pass(), { readKey: async () => ({ nonce: 1, permission: { FunctionCall: { allowance: null, receiver_id: ESTATE, method_names: [] } } }) })).toBe("KEY_NOT_ALLOWED");
    expect(await code(pass(), { token: async () => ({ owner_id: "someone.testnet" }) })).toBe("E_NOT_HOLDER");
    expect(await code(pass(), { unit: async () => ({ status: "Allocated", label: "A-1" }) })).toBe("GATE_NOT_HANDED_OVER");
    expect(await code("not a pass")).toBe("GATE_BAD_PASS");
    expect(claim).not.toHaveBeenCalled();
  });
});

describe("playground caps", () => {
  it("adds hourly caps for playground uploads and relayed captures", () => {
    expect(uploadLimits("a.testnet", false)).toEqual([["upload:a.testnet", 20, 60_000]]);
    expect(uploadLimits("a.testnet", true, ESTATE)).toContainEqual([`upload-pg:${ESTATE}:a.testnet`, 5, 3600_000]);
    expect(uploadLimits("a.testnet", true, ESTATE)).toContainEqual([`upload-pg:${ESTATE}:all`, 300, 3600_000]);
    expect(relayLimits("a.testnet", "1.2.3.4", ESTATE, true, ["submit_evidence"])).toContainEqual([`relay-pg:${ESTATE}:a.testnet`, 10, 3600_000]);
    expect(relayLimits("a.testnet", "1.2.3.4", ESTATE, true, ["qs_sign"])).toHaveLength(7); // signing is capped on the playground too
    expect(relayLimits("a.testnet", "1.2.3.4", "real.plote.testnet", false, ["submit_evidence"])).toHaveLength(3);
  });
});

describe("fail-open protections are logged", () => {
  it("warns with a stable tag and the key's scope only, at most once a minute", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(warnFallback("plote:rate-limit-fallback", "upload:alice.testnet", "timeout", 1_000)).toBe(true);
    expect(warnFallback("plote:rate-limit-fallback", "upload:bob.testnet", "timeout", 2_000)).toBe(false);
    expect(spy).toHaveBeenCalledWith("plote:rate-limit-fallback", JSON.stringify({ scope: "upload", why: "timeout" }));
    expect(JSON.stringify(spy.mock.calls)).not.toContain("alice");
    expect(warnFallback("plote:rate-limit-fallback", "upload:bob.testnet", "timeout", 70_000)).toBe(true);
    spy.mockRestore();
  });
});

describe("1Click → family wall", () => {
  it("copies the payer's name and note with the delivered amount; nothing when both are empty", () => {
    expect(oneclickChipin({ estate: ESTATE, unit: "a-1", chip_name: " Mum ", chip_note: "for the roof" }, "dep", "2500000")).toEqual({
      estate: ESTATE, unit: "a-1", deposit_address: "dep", display_name: "Mum", note: "for the roof", amount: "2500000",
    });
    expect(oneclickChipin({ estate: ESTATE, unit: "a-1", chip_name: null, chip_note: " " }, "dep", "1")).toBeNull();
    expect(oneclickChipin({ estate: ESTATE, unit: "a-1", chip_name: "A", chip_note: null }, "dep", "1.5")?.amount).toBeNull();
  });
});
