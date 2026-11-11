// GET /api/cron/poll — the event indexer (lib/server/poller.ts): every receipt each estate executes, from NearBlocks'
// receipt listing (newest first, down to the cursor in poll_cursor), with logs read over RPC. EVENT_JSON rows go to the
// `events` cache; processed receipt ids go to poll_receipts (with or without events) so they're never refetched.
// Newly inserted qs_signed / released events email their subscribers. Also: fills evidence_files.evidence_id from
// list_evidence (SPEC §14.2), checks evidence storage (lib/server/storage-cleanup.ts), alerts on low balances.
// Auth: header `x-cron-secret: $CRON_SECRET` (GitHub Actions every 5 minutes, .github/workflows/poll.yml).
//  ?dry_run=1   reads everything, writes nothing (no events, receipts, cursor, emails, evidence links or deletions).
//  ?test_alert=1 sends a test message to ALERT_WEBHOOK_URL.
// Status: 200, or 502 when every estate failed (so the scheduled job fails); partial failures post to the alert hook.

import { timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { APP_URL, ESTATES, NETWORK, TABLES } from "@/lib/config";
import { estate as E } from "@/lib/estate";
import { estateSlug } from "@/lib/estates";
import { viewUncached } from "@/lib/near";
import type { EstateView, EvidenceView } from "@/lib/types";
import { serverEnv } from "@/lib/server/env";
import { jsonError, notConfigured, ok } from "@/lib/server/http";
import { sendEmail, unsubscribeUrl } from "@/lib/server/notify";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import { balances } from "@/lib/server/balances";
import { accountBalances } from "@/lib/server/health";
import { relayerCredentials } from "@/lib/server/relayer";
import { memoryStore, nearblocksLister, pollEstate, rpcTxReceipts, supabaseStore, type EstatePollReport, type EventInsert, type PollDeps } from "@/lib/server/poller";
import { cleanupEstateStorage, type CleanupReport } from "@/lib/server/storage-cleanup";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function secretOk(req: Request): boolean {
  const want = serverEnv.cronSecret() ?? "";
  const got = req.headers.get("x-cron-secret") ?? "";
  const a = Buffer.from(want);
  const b = Buffer.from(got);
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

type EstateReport = Partial<EstatePollReport> & { emails: number; evidenceLinked: number; storage?: CleanupReport | { error: string }; error?: string };

export async function GET(req: Request) {
  if (!serverEnv.cronSecret()) return notConfigured("The poller", ["CRON_SECRET"]);
  if (!secretOk(req)) return jsonError("UNAUTHORIZED", "Missing or wrong x-cron-secret header.", 401);
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

  const deps: PollDeps = {
    listReceipts: nearblocksLister(serverEnv.nearblocksApiKey()),
    txReceipts: rpcTxReceipts,
    store: sb ? supabaseStore(sb, { dryRun }) : memoryStore().store,
  };
  const deleteFiles = serverEnv.storageCleanupDelete() && !dryRun;
  const report: Record<string, EstateReport> = {};
  for (const estate of ESTATES) {
    const rep: EstateReport = { emails: 0, evidenceLinked: 0 };
    report[estate] = rep;
    try {
      const { report: r, inserted } = await pollEstate(estate, deps);
      Object.assign(rep, r);
      if (sb && !dryRun) {
        rep.emails = await notifySubscribers(sb, estate, inserted.filter((e) => e.event === "qs_signed" || e.event === "released"));
        rep.evidenceLinked = await linkEvidenceIds(sb, estate).catch(() => 0); // §14.2
      }
    } catch (e) {
      rep.error = e instanceof Error ? e.message : String(e);
    }
    if (sb) rep.storage = await storageCheck(sb, estate, deleteFiles);
  }

  // Operational alerts: low gas / verification / account balances, estates or transactions the poller couldn't read.
  const [funds, accounts] = await Promise.all([balances(relayerCredentials()?.accountId ?? null), accountBalances()]);
  const entries = Object.entries(report);
  const failed = entries.filter(([, r]) => r.error);
  const problems = [
    ...funds.low,
    ...accounts.low,
    ...failed.map(([e, r]) => `${e}: ${r.error}`),
    ...entries.flatMap(([e, r]) => (r.errors ?? []).map((x) => `${e}: couldn't read ${x}`)),
    ...entries.filter(([, r]) => r.gap).map(([e]) => `${e}: more new receipts than one run reads; older ones in this window may be skipped`),
    ...entries.flatMap(([e, r]) => (r.storage && "error" in r.storage && r.storage.error ? [`${e}: storage check: ${r.storage.error}`] : [])),
  ];
  const alerted = problems.length && !dryRun ? await alert(`Plote (${NETWORK}) needs attention:\n- ${problems.join("\n- ")}`) : false;
  if (sb && !dryRun) {
    await sb.rpc("rate_limits_prune").then(() => undefined, () => undefined);
    await sb.rpc("security_prune").then(() => undefined, () => undefined); // 0003: expired nonces, old verify claims
    await sb.rpc("poll_prune").then(() => undefined, () => undefined); // 0004: old receipt ids, submitted verify results
  }
  const allFailed = entries.length > 0 && failed.length === entries.length;
  return ok(
    { network: NETWORK, dryRun, report, balances: funds.detail, accounts: accounts.ok ? "ok" : "low", alerted, ...(allFailed ? { code: "POLL_FAILED" } : {}) },
    { status: allFailed ? 502 : 200 },
  );
}

/** Emails for newly inserted qs_signed / released events (each row is returned by the insert once, so once per event). */
async function notifySubscribers(sb: SupabaseClient, estate: string, rows: EventInsert[]): Promise<number> {
  let sent = 0;
  const slug = estateSlug(estate);
  for (const r of rows) {
    let q = sb.from(TABLES.notifySubscriptions).select("account,unit,email").eq("estate", estate);
    if (r.event === "released" && r.unit) q = q.eq("unit", r.unit);
    const { data: subs } = await q;
    for (const s of (subs ?? []) as { account: string; unit: string; email: string }[]) {
      const watch = `${APP_URL}/w/${slug}/${s.unit}`;
      const subject = r.event === "qs_signed" ? `A stage was signed at ${slug} — ${s.unit.toUpperCase()}` : `Money was released on proof — ${s.unit.toUpperCase()}`;
      const html = `<p>${subject}.</p><p><a href="${watch}">Watch your house</a> · <a href="${APP_URL}/estates/${slug}/milestones">See the proof</a></p><p style="color:#888">Opted in at Plote. <a href="${unsubscribeUrl(s.account, estate, s.unit)}">Unsubscribe</a></p>`;
      if (await sendEmail(s.email, subject, html)) sent++;
    }
  }
  return sent;
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

/** Posts to ALERT_WEBHOOK_URL (Slack reads `text`, Discord reads `content`). Never throws. */
async function alert(message: string): Promise<boolean> {
  const url = serverEnv.alertWebhookUrl();
  if (!url) return false;
  try {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: message, content: message.slice(0, 1900) }), signal: AbortSignal.timeout(5000) });
    return r.ok;
  } catch {
    return false;
  }
}
