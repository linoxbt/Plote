import { afterEach, describe, expect, it, vi } from "vitest";
import { collectWindow, memoryStore, pollEstate, receiptEvents, type NbReceipt, type OutcomeReceipt, type PollDeps, type ReceiptRef } from "@/lib/server/poller";
import { quoteTarget } from "@/lib/server/oneclick-server";
import { RELAY_ESTATE_PER_MIN, RELAY_PLAYGROUND_PER_MIN, relayLimits, uploadLimits } from "@/lib/server/limits";
import { resolveAppUrl } from "@/lib/config";
import { cleanupDeletes, parseMaxGasTgas } from "@/lib/server/env";
import { pollerFreshness, publicView } from "@/lib/server/health";
import { relayerCredentials, reporterCredentials } from "@/lib/server/relayer";
import { DEFERRED_PER_RUN, dedupeByEmail, deferredDeposit, newHolder, runFollowUps } from "@/lib/server/follow-ups";
import { verifyGatePassServer, ReplayCheckUnavailable, type GateDeps } from "@/lib/server/gate";
import { redact } from "@/lib/server/alert";
import { KeyPair } from "near-api-js";
import { bytesToBase64 } from "@/lib/near";
import { encodeGatePass, gateMessage, randomNonce, signNep413WithSecret } from "@/lib/nep413";

const ESTATE = "harmattan-court.plote.testnet";
const PG = "playground.plote.testnet";
const ev = (event: string, data: Record<string, unknown> | Record<string, unknown>[] = {}, standard = "plote") =>
  `EVENT_JSON:${JSON.stringify({ standard, version: "1.0.0", event, data: Array.isArray(data) ? data : [data] })}`;

function rec(id: string, height: number, tx = `T${id}`): NbReceipt {
  return { receipt_id: id, transaction_hash: tx, predecessor_account_id: "bob.testnet", receiver_account_id: ESTATE, block: { block_height: String(height), block_timestamp: `${height}000000000` } };
}

/** NearBlocks-like listing with stable cursors: newest first; `next` = the height of the last receipt returned. */
function stableLister(all: () => NbReceipt[], size = 3) {
  const calls: (string | null)[] = [];
  const f: PollDeps["listReceipts"] = async (_e, next) => {
    calls.push(next);
    const sorted = [...all()].sort((a, b) => Number(b.block!.block_height) - Number(a.block!.block_height));
    const rest = next ? sorted.filter((r) => Number(r.block!.block_height) < Number(next)) : sorted;
    const page = rest.slice(0, size);
    return { receipts: page, next: rest.length > size ? String(page[page.length - 1].block!.block_height) : null };
  };
  return { f, calls };
}

const okOutcome = (ids: string[]): OutcomeReceipt[] => ids.map((id) => ({ id, executor: ESTATE, logs: [ev("qs_signed", { milestone: 0 })], success: true }));
const txByReceipt = (tx: string) => okOutcome([tx.slice(1)]);

describe("poller: a backlog larger than one run is continued, never skipped", () => {
  it("keeps the cursor and resumes the listing until it reaches the cursor, then moves to the first pass's newest", async () => {
    let receipts = Array.from({ length: 20 }, (_, i) => rec(`r${i}`, 1000 + i));
    const l = stableLister(() => receipts, 3);
    const mem = memoryStore({ cursor: { [ESTATE]: 900 } }); // floor 800: everything listed is new
    const deps = { listReceipts: l.f, txReceipts: async (tx: string) => txByReceipt(tx), store: mem.store };

    const r1 = await pollEstate(ESTATE, deps, { maxPages: 2 });
    expect(r1.report.gap).toBe(true);
    expect(mem.cursor.get(ESTATE)).toBe(900); // not moved past the unlisted part
    expect(mem.resume.get(ESTATE)).toMatchObject({ next: "1014", newest: 1019 });
    expect(mem.seen.size).toBe(6);

    receipts = [...receipts, rec("late", 1030)]; // arrives meanwhile; the continued listing doesn't need it
    let runs = 1;
    while (mem.resume.get(ESTATE) && runs < 10) {
      const r = await pollEstate(ESTATE, deps, { maxPages: 2 });
      expect(r.report.resumed).toBe(true);
      runs++;
    }
    expect(mem.cursor.get(ESTATE)).toBe(1019); // the first pass's newest, not 1030
    expect([...mem.seen].filter((x) => x.startsWith("r"))).toHaveLength(20); // every receipt in the backlog read
    await pollEstate(ESTATE, deps, { maxPages: 2 }); // a fresh pass from the top picks up the late one
    expect(mem.seen.has("late")).toBe(true);
    expect(mem.cursor.get(ESTATE)).toBe(1030);
    expect(mem.events.filter((e) => e.event === "qs_signed")).toHaveLength(21);
  });

  it("holds the cursor below a receipt an earlier continued run couldn't read", async () => {
    const receipts = Array.from({ length: 9 }, (_, i) => rec(`r${i}`, 1000 + i));
    const l = stableLister(() => receipts, 3);
    const mem = memoryStore({ cursor: { [ESTATE]: 900 } });
    let fail = true;
    const txReceipts = async (tx: string) => {
      if (tx === "Tr7" && fail) throw new Error("rpc down");
      return txByReceipt(tx);
    };
    await pollEstate(ESTATE, { listReceipts: l.f, txReceipts, store: mem.store }, { maxPages: 1 }); // r8 r7(fails) r6
    expect(mem.resume.get(ESTATE)?.pendingMin).toBe(1007);
    while (mem.resume.get(ESTATE)) await pollEstate(ESTATE, { listReceipts: l.f, txReceipts, store: mem.store }, { maxPages: 1 });
    expect(mem.cursor.get(ESTATE)).toBe(1006); // below r7, so the next pass reads it
    fail = false;
    await pollEstate(ESTATE, { listReceipts: l.f, txReceipts, store: mem.store }, { maxPages: 4 });
    expect(mem.seen.has("r7")).toBe(true);
    expect(mem.cursor.get(ESTATE)).toBe(1008);
  });

  it("drops a continuation token the indexer rejects (the cursor stays, so nothing is skipped)", async () => {
    const mem = memoryStore({ cursor: { [ESTATE]: 900 } });
    mem.resume.set(ESTATE, { next: "stale", newest: 1500, pendingMin: null });
    const list: PollDeps["listReceipts"] = async (_e, next) => {
      if (next === "stale") throw new Error("NearBlocks HTTP 400");
      return { receipts: [], next: null };
    };
    await expect(pollEstate(ESTATE, { listReceipts: list, txReceipts: async () => [], store: mem.store })).rejects.toThrow("400");
    expect(mem.resume.has(ESTATE)).toBe(false);
    expect(mem.cursor.get(ESTATE)).toBe(900);
  });

  it("stops starting transactions when the run's time budget is used up, and defers them", async () => {
    const receipts = [rec("a", 1001), rec("b", 1002), rec("c", 1003)];
    const mem = memoryStore({ cursor: { [ESTATE]: 1000 } });
    let n = 0;
    const r = await pollEstate(ESTATE, { listReceipts: stableLister(() => receipts).f, txReceipts: async (tx) => txByReceipt(tx), store: mem.store }, { shouldStop: () => n++ >= 1 });
    expect(r.report.processed).toBe(1);
    expect(r.report.deferred).toBe(2);
    expect(mem.cursor.get(ESTATE)).toBe(1001);
  });

  it("never moves the cursor backwards", async () => {
    const mem = memoryStore({ cursor: { [ESTATE]: 500 } });
    await mem.store.saveState(ESTATE, { height: 400, resume: null });
    expect(mem.cursor.get(ESTATE)).toBe(500);
  });

  it("collectWindow returns the token to continue from", async () => {
    const receipts = Array.from({ length: 10 }, (_, i) => rec(`r${i}`, 1000 + i));
    const w = await collectWindow(ESTATE, 900, stableLister(() => receipts, 3).f, 2);
    expect(w).toMatchObject({ reachedFloor: false, next: "1004", newest: 1009 });
    const w2 = await collectWindow(ESTATE, 900, stableLister(() => receipts, 3).f, 4, w.next);
    expect(w2.reachedFloor).toBe(true);
    expect(w2.refs.map((r) => r.height).sort()).toEqual([1000, 1001, 1002, 1003]);
  });
});

describe("poller: one row per real event", () => {
  const ref: ReceiptRef = { receiptId: "R1", txHash: "TX", height: 10, timeNs: "10000000000", predecessor: null };
  it("keys rows by receipt, log line and data item; repeated identical events in one transaction are all kept", () => {
    const out: OutcomeReceipt = {
      id: "R1", executor: ESTATE, success: true,
      logs: [ev("released", { unit_id: "a-1", amount: "5" }), "not an event", ev("released", { unit_id: "a-1", amount: "5" }), ev("deposit_synced", [{ unit_id: "a-1" }, { unit_id: "a-2" }])],
    };
    const rows = receiptEvents(ESTATE, ref, out, "2026-01-01T00:00:00.000Z");
    expect(rows.map((r) => [r.event, r.unit, r.log_index, r.data_index])).toEqual([
      ["released", "a-1", 0, 0], ["released", "a-1", 2, 0], ["deposit_synced", "a-1", 3, 0], ["deposit_synced", "a-2", 3, 1],
    ]);
    expect(rows[0]).toMatchObject({ receipt_id: "R1", tx_hash: "TX", notified_at: null }); // released: emailed by the route
    expect(rows[2].notified_at).toBe("2026-01-01T00:00:00.000Z"); // nothing to follow up
  });
  it("expands a multi-token NEP-171 event to one row per token", () => {
    const out: OutcomeReceipt = { id: "R1", executor: ESTATE, success: true, logs: [ev("nft_transfer", { old_owner_id: "a.testnet", new_owner_id: "b.testnet", token_ids: ["a-1", "a-2"] }, "nep171")] };
    const rows = receiptEvents(ESTATE, ref, out);
    expect(rows.map((r) => [r.unit, r.data_index, r.data.token_ids])).toEqual([["a-1", 0, ["a-1"]], ["a-2", 1, ["a-2"]]]);
    expect(rows.every((r) => r.notified_at === null)).toBe(true); // transfers clean up subscriptions
    const deferred = receiptEvents(ESTATE, ref, { id: "R1", executor: ESTATE, success: true, logs: [ev("deposit_deferred", { unit_id: "a-1", sender_id: "x", amount: "5" })] });
    expect(deferred[0]).toMatchObject({ unit: "a-1", notified_at: null }); // booked by the follow-ups
  });
  it("the in-memory store dedupes on (tx, receipt, log, data index) only", async () => {
    const mem = memoryStore();
    const out: OutcomeReceipt = { id: "R1", executor: ESTATE, success: true, logs: [ev("released", { unit_id: "a-1" }), ev("released", { unit_id: "a-1" })] };
    const rows = receiptEvents(ESTATE, ref, out);
    expect(await mem.store.insertEvents(rows)).toHaveLength(2);
    expect(await mem.store.insertEvents(rows)).toHaveLength(0);
  });
});

describe("follow-ups: emails and subscription clean-up from pending rows", () => {
  type Row = Record<string, unknown>;
  /** A tiny PostgREST-ish fake over two tables. */
  function fakeDb(events: Row[], subs: Row[]) {
    const from = (table: string) => {
      const filters: ((r: Row) => boolean)[] = [];
      let op: "select" | "update" | "delete" = "select";
      let patch: Row = {};
      let lim = Infinity;
      const rows = () => (table === "events" ? events : subs);
      const exec = () => {
        const hit = rows().filter((r) => filters.every((f) => f(r)));
        if (op === "update") hit.forEach((r) => Object.assign(r, patch));
        if (op === "delete") for (const r of hit) rows().splice(rows().indexOf(r), 1);
        return { data: hit.slice(0, lim), error: null };
      };
      const q: Record<string, unknown> = {
        select: () => q,
        update: (p: Row) => ((op = "update"), (patch = p), q),
        delete: () => ((op = "delete"), q),
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
        neq: (c: string, v: unknown) => (filters.push((r) => r[c] !== v), q),
        is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), q),
        in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), q),
        lt: (c: string, v: string) => (filters.push((r) => String(r[c]) < v), q),
        order: () => q,
        limit: (n: number) => ((lim = n), q),
        then: (res: (x: unknown) => unknown) => Promise.resolve(exec()).then(res),
      };
      return q;
    };
    return { from } as never;
  }
  const keep = { ...process.env };
  afterEach(() => {
    process.env = { ...keep };
  });
  const now = Date.parse("2026-11-12T12:00:00Z");
  const recent = new Date(now - 60_000).toISOString();

  it("emails each address once per event, removes the old holder on a transfer, closes stale rows", async () => {
    Object.assign(process.env, { RESEND_API_KEY: "re", RESEND_FROM: "P <p@x.example>", NOTIFY_SECRET: "n", NEXT_PUBLIC_SUPABASE_URL: "https://x", SUPABASE_SERVICE_ROLE_KEY: "k" });
    const events: Row[] = [
      { id: 1, network: "testnet", estate: ESTATE, unit: null, event: "qs_signed", data: {}, block_time: recent, notified_at: null },
      { id: 2, network: "testnet", estate: ESTATE, unit: "a-1", event: "nft_transfer", data: { new_owner_id: "bob.testnet" }, block_time: recent, notified_at: null },
      { id: 3, network: "testnet", estate: ESTATE, unit: "a-2", event: "released", data: {}, block_time: new Date(now - 5 * 86_400_000).toISOString(), notified_at: null },
      { id: 4, network: "testnet", estate: ESTATE, unit: "a-3", event: "verdict", data: {}, block_time: recent, notified_at: "x" },
    ];
    const subs: Row[] = [
      { account: "alice.testnet", estate: ESTATE, unit: "a-1", email: "A@x.example" },
      { account: "alice.testnet", estate: ESTATE, unit: "a-2", email: "a@x.example" },
      { account: "carol.testnet", estate: ESTATE, unit: "a-3", email: "c@x.example" },
    ];
    const send = vi.fn(async () => true);
    const r = await runFollowUps(fakeDb(events, subs), { now, send });
    expect(send).toHaveBeenCalledTimes(2); // alice once (two units, one address) + carol; the stale release is not emailed
    expect(r).toMatchObject({ stale: 1, done: 2, emails: 2, unsubscribed: 1 });
    expect(subs.map((s) => s.unit)).toEqual(["a-2", "a-3"]); // alice's a-1 subscription went with the token
    expect(events.every((e) => e.notified_at !== null)).toBe(true);
    // A re-run (or an overlapping one) finds nothing pending: no second email.
    await runFollowUps(fakeDb(events, subs), { now, send });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("leaves email events pending while emails aren't configured or every send failed", async () => {
    delete process.env.NOTIFY_SECRET;
    const events: Row[] = [{ id: 1, network: "testnet", estate: ESTATE, unit: null, event: "qs_signed", data: {}, block_time: recent, notified_at: null }];
    const subs: Row[] = [{ account: "alice.testnet", estate: ESTATE, unit: "a-1", email: "a@x.example" }];
    const send = vi.fn(async () => false);
    await runFollowUps(fakeDb(events, subs), { now, send });
    expect(send).not.toHaveBeenCalled();
    expect(events[0].notified_at).toBeNull();
    Object.assign(process.env, { RESEND_API_KEY: "re", RESEND_FROM: "P <p@x.example>", NOTIFY_SECRET: "n", NEXT_PUBLIC_SUPABASE_URL: "https://x", SUPABASE_SERVICE_ROLE_KEY: "k" });
    await runFollowUps(fakeDb(events, subs), { now, send });
    expect(send).toHaveBeenCalledTimes(1);
    expect(events[0].notified_at).toBeNull(); // retried next run
  });

  it("books a deferred deposit with report_deposit, retries a failure, and never closes it as stale", async () => {
    const old = new Date(now - 10 * 86_400_000).toISOString();
    const events: Row[] = [
      { id: 1, network: "testnet", estate: ESTATE, unit: "a-1", event: "deposit_deferred", data: { unit_id: "a-1", sender_id: "x.testnet", amount: "2500000" }, block_time: old, notified_at: null },
      { id: 2, network: "testnet", estate: ESTATE, unit: "a-2", event: "deposit_deferred", data: { unit_id: "a-2", sender_id: "x.testnet", amount: "100" }, block_time: recent, notified_at: null },
    ];
    let failA2 = true;
    const report = vi.fn(async (_e: string, unit: string) => {
      if (unit === "a-2" && failA2) throw new Error("E_BALANCE_PENDING: books changed");
    });
    const r1 = await runFollowUps(fakeDb(events, []), { now, report, reporterReady: true });
    expect(report).toHaveBeenCalledWith(ESTATE, "a-1", "2500000");
    expect(r1).toMatchObject({ stale: 0, depositsReported: 1 });
    expect(r1.depositErrors).toHaveLength(1);
    expect(events[0].notified_at).not.toBeNull(); // booked, done
    expect(events[1].notified_at).toBeNull(); // failed: still pending
    failA2 = false;
    const r2 = await runFollowUps(fakeDb(events, []), { now, report, reporterReady: true });
    expect(r2.depositsReported).toBe(1);
    expect(report).toHaveBeenCalledTimes(3); // a-1 once, a-2 twice; nothing reported again once done
    await runFollowUps(fakeDb(events, []), { now, report, reporterReady: true });
    expect(report).toHaveBeenCalledTimes(3);
  });

  it("leaves deferred deposits pending (and says so) without a reporter key", async () => {
    const events: Row[] = [{ id: 1, network: "testnet", estate: ESTATE, unit: "a-1", event: "deposit_deferred", data: { unit_id: "a-1", amount: "5" }, block_time: recent, notified_at: null }];
    const report = vi.fn(async () => undefined);
    const r = await runFollowUps(fakeDb(events, []), { now, report, reporterReady: false });
    expect(report).not.toHaveBeenCalled();
    expect(events[0].notified_at).toBeNull();
    expect(r.depositErrors[0]).toContain("reporter key");
  });

  it("caps report_deposit transactions per run", async () => {
    const events: Row[] = Array.from({ length: DEFERRED_PER_RUN + 2 }, (_, i) => ({ id: i + 1, network: "testnet", estate: ESTATE, unit: `a-${i}`, event: "deposit_deferred", data: { unit_id: `a-${i}`, amount: "1" }, block_time: recent, notified_at: null }));
    const report = vi.fn(async () => undefined);
    await runFollowUps(fakeDb(events, []), { now, report, reporterReady: true });
    expect(report).toHaveBeenCalledTimes(DEFERRED_PER_RUN);
    expect(events.filter((e) => e.notified_at === null)).toHaveLength(2);
  });

  it("helpers", () => {
    expect(deferredDeposit({ unit: null, data: { unit_id: "a-1", amount: "10" } })).toEqual({ unit: "a-1", amount: "10" });
    expect(deferredDeposit({ unit: "a-1", data: { amount: "0" } })).toBeNull();
    expect(deferredDeposit({ unit: "a-1", data: { amount: "1e6" } })).toBeNull();
    expect(dedupeByEmail([{ account: "a", unit: "1", email: "X@y" }, { account: "a", unit: "2", email: "x@y " }]).map((s) => s.unit)).toEqual(["1"]);
    expect(newHolder({ event: "sold", data: { to: "b" } })).toBe("b");
    expect(newHolder({ event: "nft_transfer", data: { new_owner_id: "c" } })).toBe("c");
    expect(newHolder({ event: "released", data: { to: "d" } })).toBeNull();
  });
});

describe("1Click: estate and unit come from the recipient only", () => {
  it("derives them from <unit>.<estate>", () => {
    expect(quoteTarget(`a-4b.${ESTATE}`)).toEqual({ ok: true, estate: ESTATE, unit: "a-4b" });
    expect(quoteTarget(`a-4b.${ESTATE}`, { estate: "harmattan-court", unit: "a-4b" })).toMatchObject({ ok: true, estate: ESTATE }); // slug accepted
    expect(quoteTarget(`a-4b.${ESTATE}`, { estate: ESTATE })).toMatchObject({ ok: true });
  });
  it("refuses a body that names another unit or estate", () => {
    expect(quoteTarget(`a-4b.${ESTATE}`, { unit: "b-1" }).ok).toBe(false);
    expect(quoteTarget(`a-4b.${ESTATE}`, { estate: "baobab-heights" }).ok).toBe(false);
    expect(quoteTarget("bare-account").ok).toBe(false);
    expect(quoteTarget("a-4b.").ok).toBe(false);
  });
});

describe("rate limits are per estate", () => {
  it("relay: a separate per-estate bucket; playground smaller; qs_sign capped on the playground", () => {
    const real = relayLimits("s.testnet", "1.1.1.1", ESTATE, false, ["submit_evidence"]);
    const pg = relayLimits("s.testnet", "1.1.1.1", PG, true, ["qs_sign"]);
    expect(real).toContainEqual([`relay-estate:${ESTATE}`, RELAY_ESTATE_PER_MIN, 60_000]);
    expect(pg).toContainEqual([`relay-estate:${PG}`, RELAY_PLAYGROUND_PER_MIN, 60_000]);
    expect(pg).toContainEqual([`relay-pg:${PG}:all`, 100, 3600_000]);
    const realKeys = new Set(real.map((l) => l[0]));
    expect(pg.filter(([k]) => !k.startsWith("relay:") && !k.startsWith("relay-ip:")).some(([k]) => realKeys.has(k))).toBe(false); // no shared bucket
    expect(real.some(([k]) => k === "relay:all")).toBe(false);
  });
  it("uploads: playground caps per estate", () => {
    expect(uploadLimits("a", true, PG)).toContainEqual([`upload-pg:${PG}:all`, 50, 3600_000]);
    expect(uploadLimits("a", false, ESTATE)).toHaveLength(1);
  });
});

describe("app URL", () => {
  it("prefers NEXT_PUBLIC_APP_URL", () => {
    expect(resolveAppUrl({ NEXT_PUBLIC_APP_URL: "https://plote-vert.vercel.app/", NODE_ENV: "production", VERCEL_ENV: "production" })).toBe("https://plote-vert.vercel.app");
  });
  it("falls back to the Vercel production URL in production, never localhost", () => {
    expect(resolveAppUrl({ NODE_ENV: "production", VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "plote-vert.vercel.app", VERCEL_URL: "plote-abc.vercel.app" })).toBe("https://plote-vert.vercel.app");
    expect(resolveAppUrl({ NODE_ENV: "production", VERCEL_ENV: "preview", VERCEL_PROJECT_PRODUCTION_URL: "plote-vert.vercel.app", VERCEL_URL: "plote-abc.vercel.app" })).toBe("https://plote-abc.vercel.app");
    expect(resolveAppUrl({ NODE_ENV: "production", VERCEL_ENV: "production", browserOrigin: "https://plote.example" })).toBe("https://plote.example");
    expect(() => resolveAppUrl({ NODE_ENV: "production", VERCEL_ENV: "production" })).toThrow(/NEXT_PUBLIC_APP_URL/);
  });
  it("uses localhost only for local dev / a local next start", () => {
    expect(resolveAppUrl({ NODE_ENV: "development" })).toBe("http://localhost:3000");
    expect(resolveAppUrl({ NODE_ENV: "production" })).toBe("http://localhost:3000");
  });
});

describe("server env parsing", () => {
  const keep = { ...process.env };
  afterEach(() => {
    process.env = { ...keep };
  });
  it("RELAYER_MAX_GAS_TGAS is numeric and clamped to 1..300", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(parseMaxGasTgas(undefined)).toBe(300);
    expect(parseMaxGasTgas("100")).toBe(100);
    expect(parseMaxGasTgas("9000")).toBe(300);
    expect(parseMaxGasTgas("0")).toBe(1);
    expect(parseMaxGasTgas("abc")).toBe(300);
    expect(parseMaxGasTgas("-5")).toBe(300);
    vi.restoreAllMocks();
  });
  it("storage cleanup deletes by default in production only, with an opt-out", () => {
    expect(cleanupDeletes({ NODE_ENV: "production", VERCEL_ENV: "production" })).toBe(true);
    expect(cleanupDeletes({ NODE_ENV: "production", VERCEL_ENV: "production", STORAGE_CLEANUP_DELETE: "0" })).toBe(false);
    expect(cleanupDeletes({ NODE_ENV: "production", VERCEL_ENV: "preview" })).toBe(false);
    expect(cleanupDeletes({ NODE_ENV: "development", STORAGE_CLEANUP_DELETE: "1" })).toBe(true);
    expect(cleanupDeletes({ NODE_ENV: "test" })).toBe(false);
  });
  it("reporter key: REPORTER_* first; relayer fallback on testnet only; no mainnet → testnet fallbacks", () => {
    Object.assign(process.env, { RELAYER_ACCOUNT_ID: "relayer.plote.testnet", RELAYER_PRIVATE_KEY: "ed25519:r" });
    delete process.env.REPORTER_ACCOUNT_ID;
    delete process.env.REPORTER_PRIVATE_KEY;
    delete process.env.MAINNET_RELAYER_ACCOUNT_ID;
    delete process.env.MAINNET_RELAYER_PRIVATE_KEY;
    expect(reporterCredentials("testnet")?.accountId).toBe("relayer.plote.testnet");
    expect(reporterCredentials("mainnet")).toBeNull();
    expect(relayerCredentials("mainnet")).toBeNull(); // RELAYER_* never used on mainnet
    process.env.MAINNET_RELAYER_PRIVATE_KEY = "ed25519:m";
    expect(relayerCredentials("mainnet")).toBeNull(); // account id required too
    Object.assign(process.env, { REPORTER_ACCOUNT_ID: "reporter.plote.testnet", REPORTER_PRIVATE_KEY: "ed25519:p" });
    expect(reporterCredentials("testnet")).toEqual({ accountId: "reporter.plote.testnet", key: "ed25519:p" });
    expect(reporterCredentials("mainnet")?.accountId).toBe("reporter.plote.testnet");
    delete process.env.REPORTER_PRIVATE_KEY;
    expect(reporterCredentials("testnet")).toBeNull(); // half-configured fails closed, no silent fallback
  });
  it("redacts keys and bearer tokens from logs", () => {
    expect(redact(`bad key ed25519:${"3".repeat(80)} and Bearer abc.def`)).toBe("bad key ed25519:[redacted] and Bearer [redacted]");
  });
});

describe("health: poller freshness", () => {
  const now = Date.parse("2026-11-12T12:00:00Z");
  it("is not ok when an estate wasn't polled in 20 minutes, and the public view names no estate", () => {
    const fresh = pollerFreshness([{ estate: ESTATE, updated_at: new Date(now - 5 * 60_000).toISOString() }], [ESTATE], now);
    expect(fresh.ok).toBe(true);
    const stale = pollerFreshness([{ estate: ESTATE, updated_at: new Date(now - 25 * 60_000).toISOString() }], [ESTATE, PG], now);
    expect(stale.ok).toBe(false);
    expect(stale.detail).toContain(PG); // never polled
    const pub = publicView({ poller: stale });
    expect(pub.poller.ok).toBe(false);
    expect(pub.poller.detail).not.toContain("harmattan");
  });
});

describe("gate pass: fails closed without the shared replay check", () => {
  it("throws ReplayCheckUnavailable instead of accepting on a local check", async () => {
    const kp = KeyPair.fromRandom("ed25519");
    const now = 1_800_000_000_000;
    const nonce = randomNonce();
    const message = gateMessage("playground", "a-1", now);
    const s = signNep413WithSecret({ message, nonce, recipient: PG }, kp.toString());
    const pass = encodeGatePass({ accountId: "holder.testnet", publicKey: s.publicKey, signature: s.signature, nonce: bytesToBase64(nonce), message });
    const d: GateDeps = {
      readKey: async () => ({ nonce: 1, permission: "FullAccess" }),
      token: async () => ({ owner_id: "holder.testnet" }),
      unit: async () => ({ status: "HandedOver", label: "A-1" }),
      claim: async () => ({ ok: true, shared: false }),
    };
    await expect(verifyGatePassServer(pass, PG, d, now + 1000)).rejects.toBeInstanceOf(ReplayCheckUnavailable);
  });
});
