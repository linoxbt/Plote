// GET /api/cron/poll — the event indexer (lib/server/poller.ts): every receipt each estate executes, from NearBlocks'
// receipt listing (newest first, down to the cursor in poll_cursor, continuing a saved listing first), with logs read
// over RPC. EVENT_JSON rows go to the `events` cache; processed receipt ids go to poll_receipts (with or without
// events) so they're never refetched. Then the follow-ups (lib/server/follow-ups.ts): events still marked
// notified_at null (qs_signed / released emails; sold / nft_transfer removes the old holder's subscriptions), a bounded
// batch per run, so a run that dies after inserting loses no email. Also: fills evidence_files.evidence_id from
// list_evidence (SPEC §14.2), checks evidence storage (lib/server/storage-cleanup.ts), alerts on low balances.
// Auth: header `x-cron-secret: $CRON_SECRET` or `$POLL_SECRET`. Scheduled by Supabase pg_cron every 5 minutes
// (migrations 0005 + 0007); .github/workflows/poll.yml is manual only.
// One run at a time: a lease row in Postgres (poll_lock_acquire, migration 0006); an overlapping call answers
// `{ skipped: true }`. Each run stops starting new estates / transactions / emails after RUN_BUDGET_MS (maxDuration 60 s).
//  ?dry_run=1   reads everything, writes nothing (no events, receipts, cursor, emails, evidence links or deletions).
//  ?test_alert=1 sends a test message to ALERT_WEBHOOK_URL.
// Status: 200, or 502 when every estate failed (so the scheduled job fails); partial failures post to the alert hook.

import { randomUUID, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ESTATES, NETWORK, TABLES } from "@/lib/config";
import { estate as E } from "@/lib/estate";
import { viewUncached } from "@/lib/near";
import type { EstateView, EvidenceView } from "@/lib/types";
import { serverEnv } from "@/lib/server/env";
import { jsonError, notConfigured, ok } from "@/lib/server/http";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import { balances } from "@/lib/server/balances";
import { accountBalances } from "@/lib/server/health";
import { alert, logError } from "@/lib/server/alert";
import { runFollowUps, type FollowUpReport } from "@/lib/server/follow-ups";
import { relayerCredentials, reporterCredentials } from "@/lib/server/relayer";
import { memoryStore, nearblocksLister, pollEstate, rpcTxReceipts, supabaseStore, type EstatePollReport, type PollDeps } from "@/lib/server/poller";
import { cleanupEstateStorage, type CleanupReport } from "@/lib/server/storage-cleanup";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Stop starting new work after this; the rest is picked up by the next run. */
export const RUN_BUDGET_MS = 45_000;
/** The run lock outlives maxDuration, so a run killed at 60 s frees it on its own. */
const LOCK_TTL_S = 75;

/** CRON_SECRET (manual runs) or POLL_SECRET (the Supabase pg_cron scheduler) — compared in constant time. */
function secretOk(req: Request): boolean {
  const got = Buffer.from(req.headers.get("x-cron-secret") ?? "");
  return [serverEnv.cronSecret(), serverEnv.pollSecret()].some((w) => {
    const want = Buffer.from(w ?? "");
    return want.length > 0 && want.length === got.length && timingSafeEqual(want, got);
  });
}

type EstateReport = Partial<EstatePollReport> & { evidenceLinked: number; storage?: CleanupReport | { error: string }; error?: string; skipped?: string };

/** true = this run holds the lock, false = another run does, null = the database couldn't answer. */
async function acquireLock(sb: SupabaseClient, holder: string): Promise<boolean | null> {
  try {
    const r = await sb.rpc("poll_lock_acquire", { p_holder: holder, p_ttl_seconds: LOCK_TTL_S });
    if (r.error) return null;
    return r.data === true;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  if (!serverEnv.cronSecret() && !serverEnv.pollSecret()) return notConfigured("The poller", ["CRON_SECRET or POLL_SECRET"]);
  if (!secretOk(req)) return jsonError("UNAUTHORIZED", "Missing or wrong x-cron-secret header.", 401);
  const started = Date.now();
  const overBudget = () => Date.now() - started > RUN_BUDGET_MS;
  const q = new URL(req.url).searchParams;
  // ?test_alert=1 checks the alert channel end to end without waiting for a real problem.
  if (q.get("test_alert") === "1") {
    const configured = !!serverEnv.alertWebhookUrl();
    const alerted = configured ? await alert(`Plote (${NETWORK}) test alert: this channel will get low-balance and poller warnings.`) : false;
    return ok({ test: true, configured, alerted });
  }
  const dryRun = q.get("dry_run") === "1";
  const sb = supabaseAdmin();
  if (!sb && !dryRun) return notConfigured("The event cache", ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);

  const holder = randomUUID();
  if (sb && !dryRun) {
    const got = await acquireLock(sb, holder);
    if (got === null) return jsonError("POLL_LOCK_UNAVAILABLE", "Couldn't take the poller lock (is migration 0006 applied?).", 503);
    if (!got) return ok({ network: NETWORK, skipped: true, reason: "another poll run is in progress" });
  }
  try {
    return await run(sb, dryRun, overBudget);
  } finally {
    if (sb && !dryRun) await sb.rpc("poll_lock_release", { p_holder: holder }).then(() => undefined, () => undefined);
  }
}

async function run(sb: SupabaseClient | null, dryRun: boolean, overBudget: () => boolean) {
  const deps: PollDeps = {
    listReceipts: nearblocksLister(serverEnv.nearblocksApiKey()),
    txReceipts: rpcTxReceipts,
    store: sb ? supabaseStore(sb, { dryRun }) : memoryStore().store,
  };
  const deleteFiles = serverEnv.storageCleanupDelete() && !dryRun;
  const report: Record<string, EstateReport> = {};
  for (const estate of ESTATES) {
    const rep: EstateReport = { evidenceLinked: 0 };
    report[estate] = rep;
    if (overBudget()) {
      rep.skipped = "time budget used up; next run";
      continue;
    }
    try {
      const { report: r } = await pollEstate(estate, deps, { shouldStop: overBudget });
      Object.assign(rep, r);
    } catch (e) {
      rep.error = e instanceof Error ? e.message : String(e);
    }
    // Housekeeping never marks the estate failed: its events are already stored.
    if (sb && !dryRun && !overBudget()) rep.evidenceLinked = await linkEvidenceIds(sb, estate).catch(() => 0); // §14.2
    if (sb && !overBudget()) rep.storage = await storageCheck(sb, estate, deleteFiles);
  }

  // Emails and subscription clean-up for events still marked pending (this run's and any a dead run left behind).
  let followUps: FollowUpReport | { error: string } | null = null;
  if (sb && !dryRun) {
    try {
      followUps = await runFollowUps(sb, { shouldStop: overBudget });
    } catch (e) {
      logError("plote:follow-ups-failed", e);
      followUps = { error: e instanceof Error ? e.message.slice(0, 200) : String(e) };
    }
  }

  // Operational alerts: low gas / verification / account balances, estates or transactions the poller couldn't read.
  const reporter = reporterCredentials()?.accountId;
  const [funds, accounts] = await Promise.all([
    balances(relayerCredentials()?.accountId ?? null),
    accountBalances(ESTATES, [...serverEnv.monitorAccounts(), ...(reporter ? [reporter] : [])]),
  ]);
  const entries = Object.entries(report);
  const failed = entries.filter(([, r]) => r.error);
  const problems = [
    ...funds.low,
    ...accounts.low,
    ...failed.map(([e, r]) => `${e}: ${r.error}`),
    ...entries.flatMap(([e, r]) => (r.errors ?? []).map((x) => `${e}: couldn't read ${x}`)),
    ...entries.filter(([, r]) => r.gap).map(([e]) => `${e}: more new receipts than one run lists; the cursor holds and the next run continues the listing`),
    ...entries.filter(([, r]) => r.skipped).map(([e]) => `${e}: skipped this run (time budget)`),
    ...entries.flatMap(([e, r]) => (r.storage && "error" in r.storage && r.storage.error ? [`${e}: storage check: ${r.storage.error}`] : [])),
    ...(followUps && "error" in followUps ? [`follow-ups (emails): ${followUps.error}`] : []),
  ];
  const alerted = problems.length && !dryRun ? await alert(`Plote (${NETWORK}) needs attention:\n- ${problems.join("\n- ")}`) : false;
  if (sb && !dryRun) {
    await sb.rpc("rate_limits_prune").then(() => undefined, () => undefined);
    await sb.rpc("security_prune").then(() => undefined, () => undefined); // 0003: expired nonces, old verify claims
    await sb.rpc("poll_prune").then(() => undefined, () => undefined); // 0004: old receipt ids, submitted verify results
  }
  const allFailed = entries.length > 0 && failed.length === entries.length;
  return ok(
    { network: NETWORK, dryRun, report, followUps, balances: funds.detail, accounts: accounts.ok ? "ok" : "low", alerted, ...(allFailed ? { code: "POLL_FAILED" } : {}) },
    { status: allFailed ? 502 : 200 },
  );
}

/**
 * Fill `evidence_files.evidence_id` for this estate's rows that don't have one yet. The contract's `list_evidence`
 * (newest first, ≤ 100) gives id + sha256 + url; a row matches when the hash is equal and the url ends with its path
 * (the same photo re-uploaded gets a new path, so retries don't steal another row's id). Returns rows updated.
 */
async function linkEvidenceIds(sb: SupabaseClient, estate: string): Promise<number> {
  const { data: rows } = await sb.from(TABLES.evidenceFiles).select("id,path,sha256").eq("estate", estate).is("evidence_id", null).limit(100);
  const pending = (rows ?? []) as { id: string; path: string; sha256: string }[];
  if (!pending.length) return 0;
  const onChain = await E.listEvidence(estate, { limit: 100 });
  let n = 0;
  for (const r of pending) {
    const ev = onChain.find((x) => x.sha256 === r.sha256 && x.url.endsWith(r.path));
    if (!ev) continue;
    const { error } = await sb.from(TABLES.evidenceFiles).update({ evidence_id: Number(ev.id) }).eq("id", r.id).is("evidence_id", null);
    if (!error) n++;
  }
  return n;
}

/** Every on-chain evidence url of an estate (list_evidence pages, newest first, up to 1000). */
async function evidenceUrls(estate: string): Promise<string[]> {
  const urls: string[] = [];
  for (let from = 0; from < 1000; from += 100) {
    const page = await viewUncached<EvidenceView[]>(estate, "list_evidence", { from_index: from, limit: 100 });
    urls.push(...(page ?? []).map((e) => e.url));
    if (!page || page.length < 100) break;
  }
  return urls;
}

async function storageCheck(sb: SupabaseClient, estate: string, deleteFiles: boolean): Promise<CleanupReport | { error: string }> {
  try {
    const est = await viewUncached<Pick<EstateView, "params">>(estate, "get_estate");
    return await cleanupEstateStorage(sb, estate, { playground: !!est.params?.playground, referencedUrls: () => evidenceUrls(estate), deleteFiles });
  } catch (e) {
    return { error: e instanceof Error ? e.message.slice(0, 200) : String(e) };
  }
}
