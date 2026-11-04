// GET /api/cron/poll — pulls recent estate transactions (NearBlocks), parses EVENT_JSON logs from each tx's receipts
// (RPC EXPERIMENTAL_tx_status) into the `events` cache, then emails subscribers on qs_signed / released.
// Auth: header `x-cron-secret: $CRON_SECRET` (called by a GitHub Actions schedule every 5 minutes).

import { timingSafeEqual } from "node:crypto";
import { APP_URL, ESTATES, NETWORK, TABLES } from "@/lib/config";
import { eventRows, type EventRow } from "@/lib/events";
import { estateSlug } from "@/lib/estates";
import { txStatus } from "@/lib/near";
import { serverEnv } from "@/lib/server/env";
import { jsonError, notConfigured, ok } from "@/lib/server/http";
import { sendEmail, unsubscribeUrl } from "@/lib/server/notify";
import { supabaseAdmin } from "@/lib/server/supabase-admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type NbTxn = { transaction_hash: string; predecessor_account_id?: string; signer_account_id?: string; block?: { block_height: number }; block_timestamp?: string };

function nearblocksBase() {
  return NETWORK === "mainnet" ? "https://api.nearblocks.io/v1" : "https://api-testnet.nearblocks.io/v1";
}

async function recentTxns(account: string): Promise<NbTxn[]> {
  const key = serverEnv.nearblocksApiKey();
  const r = await fetch(`${nearblocksBase()}/account/${account}/txns-only?per_page=25&order=desc`, {
    headers: key ? { authorization: `Bearer ${key}` } : {},
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`NearBlocks HTTP ${r.status}`);
  const j = (await r.json()) as { txns?: NbTxn[] };
  return j.txns ?? [];
}

function secretOk(req: Request): boolean {
  const want = serverEnv.cronSecret() ?? "";
  const got = req.headers.get("x-cron-secret") ?? "";
  const a = Buffer.from(want);
  const b = Buffer.from(got);
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: Request) {
  if (!serverEnv.cronSecret()) return notConfigured("The poller", ["CRON_SECRET"]);
  if (!secretOk(req)) return jsonError("UNAUTHORIZED", "Missing or wrong x-cron-secret header.", 401);
  const sb = supabaseAdmin();
  if (!sb) return notConfigured("The event cache", ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);

  const report: Record<string, { txns: number; newTxns: number; events: number; emails: number; error?: string }> = {};
  for (const estate of ESTATES) {
    const rep = { txns: 0, newTxns: 0, events: 0, emails: 0 } as (typeof report)[string];
    report[estate] = rep;
    try {
      const txns = await recentTxns(estate);
      rep.txns = txns.length;
      const hashes = txns.map((t) => t.transaction_hash);
      const { data: seen } = await sb.from(TABLES.events).select("tx_hash").in("tx_hash", hashes.length ? hashes : ["-"]);
      const seenSet = new Set((seen ?? []).map((r: { tx_hash: string }) => r.tx_hash));
      const fresh = txns.filter((t) => !seenSet.has(t.transaction_hash));
      rep.newTxns = fresh.length;
      const notifyRows: EventRow[] = [];
      for (const t of fresh.reverse()) {
        const sender = t.signer_account_id ?? t.predecessor_account_id;
        if (!sender) continue;
        let rows: EventRow[];
        try {
          rows = eventRows((await txStatus(t.transaction_hash, sender)).events);
        } catch {
          continue;
        }
        if (!rows.length) continue;
        const blockTime = t.block_timestamp ? new Date(Number(BigInt(t.block_timestamp) / 1_000_000n)).toISOString() : new Date().toISOString();
        const insert = rows.map((r) => ({
          network: NETWORK, estate, unit: r.unit, standard: r.standard, event: r.event, data: r.data,
          tx_hash: t.transaction_hash, block_height: t.block?.block_height ?? 0, block_time: blockTime,
        }));
        const { error } = await sb.from(TABLES.events).upsert(insert, { onConflict: "tx_hash,event,unit", ignoreDuplicates: true });
        if (!error) {
          rep.events += insert.length;
          notifyRows.push(...rows.filter((r) => r.event === "qs_signed" || r.event === "released"));
        }
      }
      // C7 notifications
      for (const r of notifyRows) {
        let q = sb.from(TABLES.notifySubscriptions).select("account,unit,email").eq("estate", estate);
        if (r.event === "released" && r.unit) q = q.eq("unit", r.unit);
        const { data: subs } = await q;
        for (const s of (subs ?? []) as { account: string; unit: string; email: string }[]) {
          const slug = estateSlug(estate);
          const watch = `${APP_URL}/w/${slug}/${s.unit}`;
          const subject = r.event === "qs_signed" ? `A stage was signed at ${slug} — ${s.unit.toUpperCase()}` : `Money was released on proof — ${s.unit.toUpperCase()}`;
          const html = `<p>${subject}.</p><p><a href="${watch}">Watch your house</a> · <a href="${APP_URL}/estates/${slug}/milestones">See the proof</a></p><p style="color:#888">Opted in at Plote. <a href="${unsubscribeUrl(s.account, estate, s.unit)}">Unsubscribe</a></p>`;
          if (await sendEmail(s.email, subject, html)) rep.emails++;
        }
      }
    } catch (e) {
      rep.error = e instanceof Error ? e.message : String(e);
    }
  }
  return ok({ network: NETWORK, report });
}
