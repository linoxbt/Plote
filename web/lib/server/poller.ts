// Event indexer for /api/cron/poll. Indexes every receipt an estate executes, not the transactions it signs or
// receives, so it sees relayed meta-transactions (outer receiver = the surveyor), USDC ft_transfer_call deposits
// (outer receiver = USDC, inner ft_on_transfer → estate), OutLayer yield/resume callbacks (a later receipt of an older
// transaction) and the estate's own callbacks.
//
//  1. List the estate's receipts newest first (NearBlocks v3 /accounts/{id}/receipts), keeping those whose receiver is
//     the estate (only the estate contract emits EVENT_JSON), down to the cursor (poll_cursor.block_height) minus a
//     small lookback, at most MAX_PAGES pages.
//  2. Drop receipt ids already in poll_receipts (recorded whether or not they had events, so never refetched).
//  3. For each new receipt's transaction, read the outcome over RPC (EXPERIMENTAL_tx_status) and parse the logs of
//     exactly those receipts (successful ones only: a failed receipt's state was rolled back).
//  4. Insert events (ON CONFLICT DO NOTHING; only rows actually inserted are returned and emailed, so a re-run or a
//     concurrent run never emails twice), then record the receipt ids, then move the cursor.
// Idempotent: any step can be repeated. A transaction whose outcome can't be read is left for the next run and the
// cursor stays below it.

import { NETWORK } from "../config";
import { eventRows, parseEventLogs, type EventRow } from "../events";
import type { SupabaseClient } from "@supabase/supabase-js";
import { rpc } from "../near";

export type NbReceipt = {
  receipt_id: string;
  transaction_hash: string;
  predecessor_account_id?: string;
  receiver_account_id?: string;
  block?: { block_height?: number | string; block_timestamp?: string };
  block_timestamp?: string;
  included_in_block_timestamp?: string;
};

export type ReceiptRef = { receiptId: string; txHash: string; height: number; timeNs: string | null; predecessor: string | null };
export type ReceiptPage = { receipts: NbReceipt[]; next: string | null };
export type OutcomeReceipt = { id: string; executor: string; logs: string[]; success: boolean };

export type EventInsert = {
  network: string; estate: string; unit: string | null; standard: string; event: string; data: Record<string, unknown>;
  tx_hash: string; block_height: number; block_time: string;
};
export type ProcessedReceipt = { receipt_id: string; estate: string; tx_hash: string; block_height: number; events: number };

export type PollStore = {
  getCursor(estate: string): Promise<number>;
  setCursor(estate: string, height: number): Promise<void>;
  seen(ids: string[]): Promise<Set<string>>;
  /** Inserts rows that aren't there yet; returns only the rows it inserted. */
  insertEvents(rows: EventInsert[]): Promise<EventInsert[]>;
  markProcessed(rows: ProcessedReceipt[]): Promise<void>;
};

export type PollDeps = {
  listReceipts(estate: string, next: string | null): Promise<ReceiptPage>;
  /** Outcomes of every receipt of `txHash`; `sender` routes the lookup, `altSender` is tried if the node refuses it. */
  txReceipts(txHash: string, sender: string, altSender?: string): Promise<OutcomeReceipt[]>;
  store: PollStore;
};

export type EstatePollReport = {
  listed: number; fresh: number; processed: number; events: number; inserted: number;
  cursor: { from: number; to: number }; gap: boolean; deferred: number; errors: string[];
};

export const MAX_PAGES = 4; // × 25 receipts; each page is one NearBlocks credit
export const MAX_TXS = 40; // outcome reads per estate per run
export const LOOKBACK_BLOCKS = 100; // re-list a little below the cursor (indexer lag); seen receipts cost nothing

const height = (r: NbReceipt) => Number(r.block?.block_height ?? 0);

export function toRef(r: NbReceipt): ReceiptRef {
  const ts = r.block?.block_timestamp ?? r.included_in_block_timestamp ?? r.block_timestamp ?? null;
  return { receiptId: r.receipt_id, txHash: r.transaction_hash, height: height(r), timeNs: ts, predecessor: r.predecessor_account_id ?? null };
}

/**
 * Walk the newest-first listing down to `floor` (exclusive) or MAX_PAGES. Returns the estate-executed receipts above
 * the floor, the newest height seen, and whether the floor was reached (false = there may be a gap below).
 */
export async function collectWindow(
  estate: string,
  floor: number,
  list: PollDeps["listReceipts"],
  maxPages = MAX_PAGES,
): Promise<{ refs: ReceiptRef[]; newest: number; reachedFloor: boolean; listed: number }> {
  const refs = new Map<string, ReceiptRef>();
  let next: string | null = null;
  let newest = 0;
  let listed = 0;
  for (let page = 0; page < maxPages; page++) {
    const p = await list(estate, next);
    listed += p.receipts.length;
    let below = false;
    for (const r of p.receipts) {
      const h = height(r);
      newest = Math.max(newest, h);
      if (h <= floor) {
        below = true;
        continue;
      }
      if (r.receiver_account_id === estate && r.receipt_id && r.transaction_hash) refs.set(r.receipt_id, toRef(r));
    }
    if (below || !p.next || !p.receipts.length) return { refs: [...refs.values()], newest, reachedFloor: true, listed };
    next = p.next;
  }
  return { refs: [...refs.values()], newest, reachedFloor: false, listed };
}

export function blockTime(ns: string | null): string {
  if (ns && /^\d{10,20}$/.test(ns)) return new Date(Number(BigInt(ns) / 1_000_000n)).toISOString();
  return new Date().toISOString();
}

/** Event rows for one receipt (none if it failed). */
export function receiptEvents(estate: string, ref: ReceiptRef, out: OutcomeReceipt): EventInsert[] {
  if (!out.success || out.executor !== estate) return [];
  return eventRows(parseEventLogs(out.logs)).map((r: EventRow) => ({
    network: NETWORK, estate, unit: r.unit, standard: r.standard, event: r.event, data: r.data,
    tx_hash: ref.txHash, block_height: ref.height, block_time: blockTime(ref.timeNs),
  }));
}

/** Index one estate. Never throws for a single bad transaction; throws if the listing or the store fails. */
export async function pollEstate(estate: string, deps: PollDeps, opts: { maxTxs?: number; maxPages?: number } = {}): Promise<{ report: EstatePollReport; inserted: EventInsert[] }> {
  const cursor = await deps.store.getCursor(estate);
  const floor = Math.max(0, cursor - LOOKBACK_BLOCKS);
  // First run (no cursor): start from the newest page instead of back-filling history (the old poller cached it).
  const win = await collectWindow(estate, cursor > 0 ? floor : 0, deps.listReceipts, cursor > 0 ? (opts.maxPages ?? MAX_PAGES) : 1);
  const seen = await deps.store.seen(win.refs.map((r) => r.receiptId));
  const fresh = win.refs.filter((r) => !seen.has(r.receiptId)).sort((a, b) => a.height - b.height);
  const report: EstatePollReport = {
    listed: win.listed, fresh: fresh.length, processed: 0, events: 0, inserted: 0,
    cursor: { from: cursor, to: cursor }, gap: cursor > 0 && !win.reachedFloor, deferred: 0, errors: [],
  };

  const byTx = new Map<string, ReceiptRef[]>();
  for (const r of fresh) byTx.set(r.txHash, [...(byTx.get(r.txHash) ?? []), r]);
  const maxTxs = opts.maxTxs ?? MAX_TXS;
  let unprocessedMin = Infinity;
  const inserted: EventInsert[] = [];
  let txCount = 0;
  for (const [tx, refs] of byTx) {
    const lowest = Math.min(...refs.map((r) => r.height));
    if (txCount++ >= maxTxs) {
      report.deferred += refs.length;
      unprocessedMin = Math.min(unprocessedMin, lowest);
      continue;
    }
    let outs: OutcomeReceipt[];
    try {
      outs = await deps.txReceipts(tx, estate, refs[0].predecessor ?? undefined);
    } catch (e) {
      report.errors.push(`${tx}: ${e instanceof Error ? e.message.slice(0, 120) : String(e)}`);
      unprocessedMin = Math.min(unprocessedMin, lowest);
      continue;
    }
    const done: ProcessedReceipt[] = [];
    const rows: EventInsert[] = [];
    for (const ref of refs) {
      const out = outs.find((o) => o.id === ref.receiptId);
      if (!out) {
        // Listed by the indexer but not in the outcome yet: try again next run.
        report.deferred++;
        unprocessedMin = Math.min(unprocessedMin, ref.height);
        continue;
      }
      const ev = receiptEvents(estate, ref, out);
      rows.push(...ev);
      done.push({ receipt_id: ref.receiptId, estate, tx_hash: tx, block_height: ref.height, events: ev.length });
    }
    if (rows.length) {
      const ins = await deps.store.insertEvents(rows);
      inserted.push(...ins);
      report.inserted += ins.length;
      report.events += rows.length;
    }
    if (done.length) await deps.store.markProcessed(done);
    report.processed += done.length;
  }

  const target = Number.isFinite(unprocessedMin) ? unprocessedMin - 1 : win.newest;
  const to = Math.max(cursor, target);
  if (to !== cursor) await deps.store.setCursor(estate, to);
  report.cursor.to = to;
  return { report, inserted };
}

// ---------------------------------------------------------------------------------------------------------------
// Real dependencies: NearBlocks for the listing, NEAR RPC for outcomes.

export function nearblocksBase(network: string = NETWORK): string {
  return network === "mainnet" ? "https://api.nearblocks.io/v3" : "https://api-testnet.nearblocks.io/v3";
}

export function nearblocksLister(apiKey: string | undefined, fetchImpl: typeof fetch = fetch): PollDeps["listReceipts"] {
  return async (estate, next) => {
    // No `receiver=` filter: on this endpoint it means "receipts this account sent to X", which drops calls *to* it.
    const q = new URLSearchParams({ limit: "25" });
    if (next) q.set("next", next);
    const r = await fetchImpl(`${nearblocksBase()}/accounts/${encodeURIComponent(estate)}/receipts?${q}`, {
      headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!r.ok) throw new Error(`NearBlocks HTTP ${r.status}${r.status === 429 ? " (rate limited; set NEARBLOCKS_API_KEY)" : ""}`);
    const j = (await r.json()) as { data?: NbReceipt[]; meta?: { next_page?: string | null } };
    return { receipts: Array.isArray(j.data) ? j.data : [], next: j.meta?.next_page ?? null };
  };
}

type RpcOutcome = {
  receipts_outcome?: { id: string; outcome?: { logs?: string[]; executor_id?: string; status?: Record<string, unknown> | string } }[];
};

export function parseTxReceipts(raw: RpcOutcome): OutcomeReceipt[] {
  return (raw.receipts_outcome ?? []).map((r) => {
    const st = r.outcome?.status;
    const success = !!st && typeof st === "object" && ("SuccessValue" in st || "SuccessReceiptId" in st);
    return { id: r.id, executor: r.outcome?.executor_id ?? "", logs: r.outcome?.logs ?? [], success };
  });
}

/**
 * Outcome of every receipt of a transaction. The poller doesn't know the signer (a receipt listing doesn't carry it);
 * `sender_account_id` only routes the lookup, and nodes that track every shard accept any account (checked on
 * fastnear and rpc.testnet.near.org), so the estate is passed, with the receipt's predecessor as a retry.
 */
export async function rpcTxReceipts(txHash: string, sender: string, altSender?: string): Promise<OutcomeReceipt[]> {
  const call = (s: string) => rpc<RpcOutcome>("EXPERIMENTAL_tx_status", { tx_hash: txHash, sender_account_id: s, wait_until: "NONE" });
  try {
    return parseTxReceipts(await call(sender));
  } catch (e) {
    if (!altSender || altSender === sender) throw e;
    return parseTxReceipts(await call(altSender));
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Supabase store (tables `events`, `poll_receipts`, `poll_cursor`; migrations 0001 + 0004).

export function supabaseStore(sb: SupabaseClient, opts: { dryRun?: boolean } = {}): PollStore {
  const dry = !!opts.dryRun;
  const must = <T extends { error?: { message?: string } | null }>(r: T, what: string): T => {
    if (r.error) throw new Error(`${what}: ${r.error.message ?? "database error"}`);
    return r;
  };
  return {
    async getCursor(estate) {
      const r = must(await sb.from("poll_cursor").select("block_height").eq("estate", estate).maybeSingle(), "poll_cursor");
      return Number(r.data?.block_height ?? 0);
    },
    async setCursor(estate, h) {
      if (dry) return;
      must(await sb.from("poll_cursor").upsert({ estate, block_height: h, updated_at: new Date().toISOString() }), "poll_cursor");
    },
    async seen(ids) {
      const out = new Set<string>();
      for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100);
        const r = must(await sb.from("poll_receipts").select("receipt_id").in("receipt_id", chunk), "poll_receipts (apply migration 0004)");
        for (const row of (r.data ?? []) as { receipt_id: string }[]) out.add(row.receipt_id);
      }
      return out;
    },
    async insertEvents(rows) {
      if (dry) return rows;
      const r = must(
        await sb.from("events").upsert(rows, { onConflict: "tx_hash,event,unit", ignoreDuplicates: true }).select("network,estate,unit,standard,event,data,tx_hash,block_height,block_time"),
        "events",
      );
      return (r.data ?? []) as EventInsert[];
    },
    async markProcessed(rows) {
      if (dry) return;
      must(await sb.from("poll_receipts").upsert(rows, { onConflict: "receipt_id", ignoreDuplicates: true }), "poll_receipts");
    },
  };
}

/** In-memory store (tests and `?dry_run=1` without a database). */
export function memoryStore(init: { cursor?: Record<string, number>; seen?: string[] } = {}) {
  const cursor = new Map(Object.entries(init.cursor ?? {}));
  const seen = new Set(init.seen ?? []);
  const events: EventInsert[] = [];
  const key = (e: EventInsert) => `${e.tx_hash}|${e.event}|${e.unit ?? ""}`;
  const store: PollStore = {
    getCursor: async (e) => cursor.get(e) ?? 0,
    setCursor: async (e, h) => void cursor.set(e, h),
    seen: async (ids) => new Set(ids.filter((i) => seen.has(i))),
    insertEvents: async (rows) => {
      const have = new Set(events.map(key));
      const ins: EventInsert[] = [];
      for (const r of rows) {
        if (have.has(key(r))) continue;
        have.add(key(r));
        ins.push(r);
      }
      events.push(...ins);
      return ins;
    },
    markProcessed: async (rows) => rows.forEach((r) => seen.add(r.receipt_id)),
  };
  return { store, cursor, seen, events };
}
