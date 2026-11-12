// Follow-ups for indexed events (run by /api/cron/poll after polling). The poller inserts qs_signed / released /
// sold / nft_transfer rows with `events.notified_at` null (migration 0006); this handles them oldest first, a bounded
// batch per run, and stamps notified_at when done. A run that dies after inserting events (or before finishing this)
// leaves them pending, and the next run picks them up.
//  qs_signed / released → one email per subscribed address (an address subscribed to several units of the estate
//                          gets one email per event, not one per unit). Left pending while emails aren't configured,
//                          or when every send for the event failed (retried next run).
//  sold / nft_transfer  → the unit changed hands: its subscriptions of anyone but the new holder are deleted.
//  deposit_deferred     → an ft_transfer_call the estate accepted but didn't book (it landed within 5 minutes of a
//                          report_deposit, INTERFACE §1.2.1): booked with report_deposit({unit_id, amount}) signed by
//                          the reporter key. Idempotent on-chain (two balance reads; a repeat finds no surplus and
//                          credits "0"), so any failure is simply retried next run, at most DEFERRED_PER_RUN per run.
//                          Never closed as stale: the money is on the unit until it is booked.
//  Older than STALE_MS   → emails and transfers are stamped without action (no stale emails after an outage).

import type { SupabaseClient } from "@supabase/supabase-js";
import { APP_URL, ESTATES, NETWORK, TABLES } from "../config";
import { estateSlug } from "../estates";
import { logError } from "./alert";
import { estate as E } from "../estate";
import { PloteError } from "../errors";
import { notifyConfigured, sendEmail, unsubscribeUrl } from "./notify";
import { callAsReporter, reporterCredentials } from "./relayer";

export const FOLLOW_UP_BATCH = 50;
export const STALE_MS = 3 * 86_400_000;
const EMAIL_EVENTS = ["qs_signed", "released"];
const TRANSFER_EVENTS = ["sold", "nft_transfer"];
const DEFERRED_EVENTS = ["deposit_deferred"];
export const DEFERRED_PER_RUN = 5; // each is a transaction of a few seconds

/** report_deposit as the reporter; resolves when the transaction succeeded, throws otherwise. */
export type ReportDeposit = (estate: string, unitId: string, amount: string) => Promise<void>;
const reportWithReporter: ReportDeposit = async (estate, unitId, amount) => {
  await callAsReporter(E.reportDeposit(estate, unitId, amount));
};

/** The unit and amount a deposit_deferred event asks to book, or null when the event is malformed. */
export function deferredDeposit(ev: Pick<PendingEvent, "unit" | "data">): { unit: string; amount: string } | null {
  const unit = typeof ev.data.unit_id === "string" ? ev.data.unit_id : ev.unit;
  const amount = typeof ev.data.amount === "string" || typeof ev.data.amount === "number" ? String(ev.data.amount) : "";
  return unit && /^[1-9][0-9]{0,38}$/.test(amount) ? { unit, amount } : null;
}

export type PendingEvent = { id: number; estate: string; unit: string | null; event: string; data: Record<string, unknown>; block_time: string };
export type Subscription = { account: string; unit: string; email: string };
export type FollowUpReport = {
  pending: number; done: number; emails: number; emailFailures: number; unsubscribed: number; stale: number; emailsConfigured: boolean;
  /** deposit_deferred rows booked with report_deposit this run, and the ones that failed (retried next run). */
  depositsReported: number; depositErrors: string[];
};

/** One subscription per address (lower-cased), the first unit wins: the email names that unit. */
export function dedupeByEmail(subs: Subscription[]): Subscription[] {
  const seen = new Set<string>();
  const out: Subscription[] = [];
  for (const s of subs) {
    const k = s.email.trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

/** The account that holds the unit after a sold / nft_transfer event, if the event names one. */
export function newHolder(ev: Pick<PendingEvent, "event" | "data">): string | null {
  const v = ev.event === "sold" ? ev.data.to : ev.event === "nft_transfer" ? ev.data.new_owner_id : null;
  return typeof v === "string" && v ? v : null;
}

export function emailFor(ev: Pick<PendingEvent, "estate" | "event">, s: Subscription, unsubscribe: string): { subject: string; html: string } {
  const slug = estateSlug(ev.estate);
  const unit = s.unit.toUpperCase();
  const watch = `${APP_URL}/w/${slug}/${encodeURIComponent(s.unit)}`;
  const subject = ev.event === "qs_signed" ? `A stage was signed at ${slug} — ${unit}` : `Money was released on proof — ${unit}`;
  const html = `<p>${esc(subject)}.</p><p><a href="${esc(watch)}">Watch your house</a> · <a href="${esc(`${APP_URL}/estates/${slug}/milestones`)}">See the proof</a></p><p style="color:#888">Opted in at Plote. <a href="${esc(unsubscribe)}">Unsubscribe</a></p>`;
  return { subject, html };
}

function esc(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export async function runFollowUps(
  sb: SupabaseClient,
  opts: { shouldStop?: () => boolean; now?: number; send?: typeof sendEmail; batch?: number; report?: ReportDeposit; reporterReady?: boolean } = {},
): Promise<FollowUpReport> {
  const now = opts.now ?? Date.now();
  const stamp = new Date(now).toISOString();
  const send = opts.send ?? sendEmail;
  const emailsConfigured = notifyConfigured();
  const reportDeposit = opts.report ?? reportWithReporter;
  const reporterReady = opts.reporterReady ?? !!reporterCredentials();
  const report: FollowUpReport = { pending: 0, done: 0, emails: 0, emailFailures: 0, unsubscribed: 0, stale: 0, emailsConfigured, depositsReported: 0, depositErrors: [] };

  // Emails and transfers older than STALE_MS are closed without action (deferred deposits never are).
  const stale = await sb
    .from(TABLES.events)
    .update({ notified_at: stamp })
    .is("notified_at", null)
    .eq("network", NETWORK)
    .in("event", [...EMAIL_EVENTS, ...TRANSFER_EVENTS])
    .lt("block_time", new Date(now - STALE_MS).toISOString())
    .select("id");
  if (stale.error) throw new Error(`events (apply migration 0006): ${stale.error.message}`);
  report.stale = stale.data?.length ?? 0;

  const kinds = [...(emailsConfigured ? EMAIL_EVENTS : []), ...TRANSFER_EVENTS, ...DEFERRED_EVENTS];
  const r = await sb
    .from(TABLES.events)
    .select("id,estate,unit,event,data,block_time")
    .is("notified_at", null)
    .eq("network", NETWORK)
    .in("estate", ESTATES)
    .in("event", kinds)
    .order("id", { ascending: true })
    .limit(opts.batch ?? FOLLOW_UP_BATCH);
  if (r.error) throw new Error(`events: ${r.error.message}`);
  const rows = (r.data ?? []) as PendingEvent[];
  report.pending = rows.length;

  let deferredTried = 0;
  for (const ev of rows) {
    if (opts.shouldStop?.()) break;
    let done = true;
    if (DEFERRED_EVENTS.includes(ev.event)) {
      const dep = deferredDeposit(ev);
      if (!dep) {
        report.depositErrors.push(`${ev.estate} event ${ev.id}: deposit_deferred without a unit or amount; book it by hand`);
      } else if (!reporterReady) {
        done = false;
        report.depositErrors.push(`${ev.estate}/${dep.unit}: deposit of ${dep.amount} waits for report_deposit, but the reporter key isn't configured`);
      } else if (deferredTried >= DEFERRED_PER_RUN) {
        continue; // next run
      } else {
        deferredTried++;
        try {
          await reportDeposit(ev.estate, dep.unit, dep.amount);
          report.depositsReported++;
        } catch (e) {
          done = false; // safe to repeat: the estate books at most the surplus it sees, never twice
          logError("plote:deferred-deposit-failed", e, { estate: ev.estate, unit: dep.unit });
          const code = e instanceof PloteError ? e.code : null;
          report.depositErrors.push(`${ev.estate}/${dep.unit}: report_deposit for a deferred deposit of ${dep.amount} failed${code ? ` (${code})` : ""}; retried next run`);
        }
      }
    } else if (TRANSFER_EVENTS.includes(ev.event)) {
      if (ev.unit) {
        let del = sb.from(TABLES.notifySubscriptions).delete().eq("estate", ev.estate).eq("unit", ev.unit);
        const holder = newHolder(ev);
        if (holder) del = del.neq("account", holder);
        const d = await del.select("account");
        if (d.error) throw new Error(`notify_subscriptions: ${d.error.message}`);
        report.unsubscribed += d.data?.length ?? 0;
      }
    } else {
      let q = sb.from(TABLES.notifySubscriptions).select("account,unit,email").eq("estate", ev.estate);
      if (ev.event === "released" && ev.unit) q = q.eq("unit", ev.unit);
      const subs = await q;
      if (subs.error) throw new Error(`notify_subscriptions: ${subs.error.message}`);
      const targets = dedupeByEmail((subs.data ?? []) as Subscription[]);
      let sent = 0;
      for (const s of targets) {
        try {
          const { subject, html } = emailFor(ev, s, unsubscribeUrl(s.account, ev.estate, s.unit));
          if (await send(s.email, subject, html)) sent++;
          else report.emailFailures++;
        } catch (e) {
          report.emailFailures++;
          logError("plote:email-failed", e, { event: ev.id });
        }
      }
      report.emails += sent;
      done = targets.length === 0 || sent > 0; // every send failed: leave it pending, retried next run
    }
    if (!done) continue;
    const m = await sb.from(TABLES.events).update({ notified_at: stamp }).eq("id", ev.id).is("notified_at", null);
    if (m.error) throw new Error(`events: ${m.error.message}`);
    report.done++;
  }
  return report;
}
