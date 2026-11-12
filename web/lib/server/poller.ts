// Event indexer for /api/cron/poll. Indexes every receipt an estate executes, not the transactions it signs or
// receives, so it sees relayed meta-transactions (outer receiver = the surveyor), USDC ft_transfer_call deposits
// (outer receiver = USDC, inner ft_on_transfer → estate), OutLayer yield/resume callbacks (a later receipt of an older
// transaction) and the estate's own callbacks.
//
//  1. List the estate's receipts newest first (NearBlocks v3 /accounts/{id}/receipts), keeping those whose receiver is
//     the estate (only the estate contract emits EVENT_JSON), down to the cursor (poll_cursor.block_height) minus a
//     small lookback, at most MAX_PAGES pages.
//     If that doesn't reach the cursor (more new receipts than one run lists), the cursor stays where it is and the
//     listing's continuation token is saved (poll_cursor.resume_next): the next run continues the listing from there,
//     down to the cursor, before it lists from the top again. Only when the whole range has been listed does the
//     cursor move, to the newest height of that pass. Nothing between the cursor and the newest receipt is skipped.
//  2. Drop receipt ids already in poll_receipts (recorded whether or not they had events, so never refetched).
//  3. For each new receipt's transaction, read the outcome over RPC (EXPERIMENTAL_tx_status) and parse the logs of
//     exactly those receipts (successful ones only: a failed receipt's state was rolled back).
//  4. Insert events, one row per (receipt, log line, data item / token id), keyed (tx_hash, receipt_id, log_index,
//     data_index) with ON CONFLICT DO NOTHING; then record the receipt ids, then save the cursor (never backwards).
//     Rows that need follow-up (emails, subscription clean-up) are inserted with notified_at null; the route handles
//     them from the table, so a run that dies after the insert loses nothing.
// Idempotent: any step can be repeated. A transaction whose outcome can't be read is left for the next run and the
// cursor stays below it.

import { NETWORK } from "../config";
import { parseEventLog } from "../events";
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
  tx_hash: string; receipt_id: string; log_index: number; data_index: number; block_height: number; block_time: string;
  /** null = needs follow-up by the route (email or subscription clean-up); a timestamp = nothing to do. */
  notified_at: string | null;
};
export type ProcessedReceipt = { receipt_id: string; estate: string; tx_hash: string; block_height: number; events: number };

/** A listing that didn't reach the cursor: where to continue, the newest height of that pass, the lowest unread one. */
export type Resume = { next: string; newest: number; pendingMin: number | null };
export type CursorState = { height: number; resume: Resume | null };

export type PollStore = {
  getState(estate: string): Promise<CursorState>;
  /** Saves the cursor (never lower than the stored one) and the continuation; also marks the estate as polled now. */
  saveState(estate: string, state: CursorState): Promise<void>;
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
  cursor: { from: number; to: number }; gap: boolean; resumed: boolean; deferred: number; errors: string[];
};

export const MAX_PAGES = 4; // × 25 receipts; each page is one NearBlocks credit
export const MAX_TXS = 40; // outcome reads per estate per run
export const LOOKBACK_BLOCKS = 100; // re-list a little below the cursor (indexer lag); seen receipts cost nothing

/** Events the route follows up on (notified_at null): emails for qs_signed / released, subscription clean-up on a transfer. */
export const FOLLOW_UP_EVENTS = ["qs_signed", "released", "sold", "nft_transfer"] as const;

const height = (r: NbReceipt) => Number(r.block?.block_height ?? 0);

export function toRef(r: NbReceipt): ReceiptRef {
  const ts = r.block?.block_timestamp ?? r.included_in_block_timestamp ?? r.block_timestamp ?? null;
  return { receiptId: r.receipt_id, txHash: r.transaction_hash, height: height(r), timeNs: ts, predecessor: r.predecessor_account_id ?? null };
}

/**
 * Walk the newest-first listing (from the top, or from `start` when continuing) down to `floor` (exclusive) or
 * `maxPages`. Returns the estate-executed receipts above the floor, the newest height seen, whether the floor was
 * reached, and the token to continue from when it wasn't.
 */
export async function collectWindow(
  estate: string,
  floor: number,
  list: PollDeps["listReceipts"],
  maxPages = MAX_PAGES,
  start: string | null = null,
): Promise<{ refs: ReceiptRef[]; newest: number; lowest: number; reachedFloor: boolean; listed: number; next: string | null }> {
  const refs = new Map<string, ReceiptRef>();
  let next: string | null = start;
  let newest = 0;
  let lowest = Infinity;
  let listed = 0;
  for (let page = 0; page < maxPages; page++) {
    const p = await list(estate, next);
    listed += p.receipts.length;
    let below = false;
    for (const r of p.receipts) {
      const h = height(r);
      newest = Math.max(newest, h);
      lowest = Math.min(lowest, h);
      if (h <= floor) {
        below = true;
        continue;
      }
      if (r.receiver_account_id === estate && r.receipt_id && r.transaction_hash) refs.set(r.receipt_id, toRef(r));
    }
    if (below || !p.next || !p.receipts.length) return { refs: [...refs.values()], newest, lowest, reachedFloor: true, listed, next: null };
    next = p.next;
  }
  return { refs: [...refs.values()], newest, lowest, reachedFloor: false, listed, next };
}

export function blockTime(ns: string | null): string {
  if (ns && /^\d{10,20}$/.test(ns)) return new Date(Number(BigInt(ns) / 1_000_000n)).toISOString();
  return new Date().toISOString();
}

/**
 * Event rows for one receipt (none if it failed): one per data item of each EVENT_JSON log line, and one per token id
 * for NEP-171 events that carry several (`token_ids`), each with its own data_index, so no real event is dropped.
 */
export function receiptEvents(estate: string, ref: ReceiptRef, out: OutcomeReceipt, now: string = new Date().toISOString()): EventInsert[] {
  if (!out.success || out.executor !== estate) return [];
  const rows: EventInsert[] = [];
  out.logs.forEach((line, logIndex) => {
    const e = parseEventLog(line);
    if (!e) return;
    let dataIndex = 0;
    for (const d of e.data.length ? e.data : [{}]) {
      const tokens = Array.isArray(d.token_ids) ? d.token_ids.filter((t): t is string => typeof t === "string") : [];
      const items: [string | null, Record<string, unknown>][] =
        typeof d.unit_id === "string" ? [[d.unit_id, d]]
        : tokens.length > 1 ? tokens.map((t) => [t, { ...d, token_ids: [t] }])
        : [[tokens[0] ?? null, d]];
      for (const [unit, data] of items) {
        rows.push({
          network: NETWORK, estate, unit, standard: e.standard, event: e.event, data,
          tx_hash: ref.txHash, receipt_id: ref.receiptId, log_index: logIndex, data_index: dataIndex++,
          block_height: ref.height, block_time: blockTime(ref.timeNs),
          notified_at: (FOLLOW_UP_EVENTS as readonly string[]).includes(e.event) ? null : now,
        });
      }
    }
  });
  return rows;
}

/**
 * Index one estate. Never throws for a single bad transaction; throws if the listing or the store fails.
 * `shouldStop` (the route's time budget) is checked before each transaction: the rest is deferred to the next run.
 */
export async function pollEstate(
  estate: string,
  deps: PollDeps,
  opts: { maxTxs?: number; maxPages?: number; shouldStop?: () => boolean } = {},
): Promise<{ report: EstatePollReport; inserted: EventInsert[] }> {
  const state = await deps.store.getState(estate);
  const cursor = state.height;
  const floor = Math.max(0, cursor - LOOKBACK_BLOCKS);
  const resume = cursor > 0 ? state.resume : null;
  let win: Awaited<ReturnType<typeof collectWindow>>;
  try {
    // First run (no cursor): start from the newest page instead of back-filling history (the old poller cached it).
    win = await collectWindow(estate, cursor > 0 ? floor : 0, deps.listReceipts, cursor > 0 ? (opts.maxPages ?? MAX_PAGES) : 1, resume?.next ?? null);
  } catch (e) {
    // A continuation token the indexer no longer accepts: drop it and list from the top next run. The cursor hasn't
    // moved past anything unread, so a fresh pass down to it misses nothing.
    if (resume) await deps.store.saveState(estate, { height: cursor, resume: null });
    throw e;
  }
  const seen = await deps.store.seen(win.refs.map((r) => r.receiptId));
  const fresh = win.refs.filter((r) => !seen.has(r.receiptId)).sort((a, b) => a.height - b.height);
  // A gap only when the listing stopped above the cursor itself: the lookback below it was read in an earlier pass.
  const gap = cursor > 0 && !win.reachedFloor && win.lowest > cursor;
  const report: EstatePollReport = {
    listed: win.listed, fresh: fresh.length, processed: 0, events: 0, inserted: 0,
    cursor: { from: cursor, to: cursor }, gap, resumed: !!resume, deferred: 0, errors: [],
  };

  const byTx = new Map<string, ReceiptRef[]>();
  for (const r of fresh) byTx.set(r.txHash, [...(byTx.get(r.txHash) ?? []), r]);
  const maxTxs = opts.maxTxs ?? MAX_TXS;
  let unprocessedMin = Infinity;
  const inserted: EventInsert[] = [];
  let txCount = 0;
  for (const [tx, refs] of byTx) {
    const lowest = Math.min(...refs.map((r) => r.height));
    if (txCount++ >= maxTxs || opts.shouldStop?.()) {
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

  // The lowest receipt this pass couldn't process, across every run of a continued listing.
  const pendingMin = Math.min(resume?.pendingMin ?? Infinity, unprocessedMin);
  let next: CursorState;
  if (gap) {
    // Not down to the cursor yet: keep it, and continue the listing from where this run stopped.
    next = { height: cursor, resume: { next: win.next!, newest: resume?.newest ?? win.newest, pendingMin: Number.isFinite(pendingMin) ? pendingMin : null } };
  } else {
    const newest = resume?.newest ?? win.newest;
    const target = Number.isFinite(pendingMin) ? pendingMin - 1 : newest;
    next = { height: Math.max(cursor, target), resume: null };
  }
  await deps.store.saveState(estate, next);
  report.cursor.to = next.height;
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
  const call = (s: string, urls?: string[]) =>
    rpc<RpcOutcome>("EXPERIMENTAL_tx_status", { tx_hash: txHash, sender_account_id: s, wait_until: "NONE" }, urls ? { urls } : {});
  try {
    return parseTxReceipts(await call(sender));
  } catch (e) {
    if (altSender && altSender !== sender) {
      try {
        return parseTxReceipts(await call(altSender));
      } catch {
        /* fall through to the archival node */
      }
    }
    // Regular RPC nodes keep only recent epochs; older transactions are served by the archival node.
    try {
      return parseTxReceipts(await call(sender, [ARCHIVAL_RPC_URL]));
    } catch {
      throw e;
    }
  }
}

const ARCHIVAL_RPC_URL = NETWORK === "mainnet" ? "https://archival-rpc.mainnet.near.org" : "https://archival-rpc.testnet.near.org";

// ---------------------------------------------------------------------------------------------------------------
// Supabase store (tables `events`, `poll_receipts`, `poll_cursor`; migrations 0001 + 0004 + 0006).

export const EVENT_CONFLICT = "tx_hash,receipt_id,log_index,data_index"; // unique index events_receipt_log_key (0006)

export function supabaseStore(sb: SupabaseClient, opts: { dryRun?: boolean } = {}): PollStore {
  const dry = !!opts.dryRun;
  const must = <T extends { error?: { message?: string } | null }>(r: T, what: string): T => {
    if (r.error) throw new Error(`${what}: ${r.error.message ?? "database error"}`);
    return r;
  };
  return {
    async getState(estate) {
      const r = must(
        await sb.from("poll_cursor").select("block_height,resume_next,resume_newest,resume_pending_min").eq("estate", estate).maybeSingle(),
        "poll_cursor (apply migration 0006)",
      );
      const d = (r.data ?? null) as { block_height?: number | string; resume_next?: string | null; resume_newest?: number | string | null; resume_pending_min?: number | string | null } | null;
      const resume = d?.resume_next
        ? { next: d.resume_next, newest: Number(d.resume_newest ?? 0), pendingMin: d.resume_pending_min == null ? null : Number(d.resume_pending_min) }
        : null;
      return { height: Number(d?.block_height ?? 0), resume };
    },
    async saveState(estate, st) {
      if (dry) return;
      // poll_cursor_save (0006): block_height = greatest(stored, given), so an overlapping or late run never moves it back.
      must(
        await sb.rpc("poll_cursor_save", {
          p_estate: estate,
          p_height: st.height,
          p_resume_next: st.resume?.next ?? null,
          p_resume_newest: st.resume?.newest ?? null,
          p_resume_pending_min: st.resume?.pendingMin ?? null,
        }),
        "poll_cursor_save (apply migration 0006)",
      );
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
        await sb
          .from("events")
          .upsert(rows, { onConflict: EVENT_CONFLICT, ignoreDuplicates: true })
          .select("network,estate,unit,standard,event,data,tx_hash,receipt_id,log_index,data_index,block_height,block_time,notified_at"),
        "events (apply migration 0006)",
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
  const resume = new Map<string, Resume>();
  const seen = new Set(init.seen ?? []);
  const events: EventInsert[] = [];
  const key = (e: EventInsert) => `${e.tx_hash}|${e.receipt_id}|${e.log_index}|${e.data_index}`;
  const store: PollStore = {
    getState: async (e) => ({ height: cursor.get(e) ?? 0, resume: resume.get(e) ?? null }),
    saveState: async (e, st) => {
      cursor.set(e, Math.max(cursor.get(e) ?? 0, st.height));
      if (st.resume) resume.set(e, st.resume);
      else resume.delete(e);
    },
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
  return { store, cursor, resume, seen, events };
}
