// /api/notify — opt-in milestone emails (C7), double opt-in.
//  POST (JSON, NEP-413 signed by the holder) emails a confirmation link to the address; nothing is stored yet.
//  GET ?c=<token> / ?u=<token> show a confirm / unsubscribe button (so mail scanners that follow links change nothing);
//  POST ?c=<token> stores the subscription, POST ?u=<token> deletes it.
// Links are signed with NOTIFY_SECRET (required); unsubscribe links sent before it existed (signed with CRON_SECRET,
// no expiry) still work, and new ones are valid for a year. When a unit changes hands, the poller deletes the old
// holder's subscriptions (lib/server/follow-ups.ts).

import { CONFIRM_TTL_MS, confirmToken, notifyConfigured, readToken, readUnsubscribeToken, sendEmail } from "@/lib/server/notify";
import { z } from "zod";
import { APP_URL, ESTATES, TABLES } from "@/lib/config";
import { estate as E } from "@/lib/estate";
import { estateSlug } from "@/lib/estates";
import { verifySignedRequest } from "@/lib/server/auth";
import { jsonError, notConfigured, ok, parseJson } from "@/lib/server/http";
import { rateLimitShared } from "@/lib/server/rate-limit";
import { supabaseAdmin } from "@/lib/server/supabase-admin";

export const dynamic = "force-dynamic";

const Body = z.object({
  accountId: z.string().min(2).max(64),
  publicKey: z.string().startsWith("ed25519:"),
  signature: z.string().min(40),
  nonce: z.string().min(40),
  message: z.string().max(400),
  recipient: z.string(),
  estate: z.string().min(2).max(64),
  unit: z.string().regex(/^[a-z0-9-]{1,16}$/),
  email: z.string().email().max(200),
});

export async function POST(req: Request) {
  const sb = supabaseAdmin();
  if (!sb) return notConfigured("Notifications", ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);
  const q = new URL(req.url).searchParams;
  if (q.has("c")) return confirm(sb, q.get("c") ?? "");
  if (q.has("u")) return unsubscribe(sb, q.get("u") ?? "");
  if (!notifyConfigured()) return notConfigured("Notification emails", ["RESEND_API_KEY", "RESEND_FROM", "NOTIFY_SECRET"]);
  const p = await parseJson(req, Body);
  if (!p.ok) return p.res;
  const b = p.data;
  if (!ESTATES.includes(b.estate) || b.recipient !== b.estate) return jsonError("E_BAD_ARGS", "Unknown estate.");
  const parts = b.message.split(":");
  if (parts[0] !== "plote-notify" || parts[1] !== estateSlug(b.estate) || parts[2] !== b.unit || parts.slice(3, -1).join(":") !== b.email) {
    return jsonError("BAD_SIGNATURE", "The signed message doesn't match this subscription.");
  }
  try {
    const auth = await verifySignedRequest(b, { maxAgeMs: 10 * 60_000 });
    if (!auth.ok) return jsonError(auth.code, auth.message, 401);
    const u = await E.getUnit(b.estate, b.unit);
    if (!u || u.holder !== b.accountId) return jsonError("E_NOT_HOLDER", "Only the unit's holder can subscribe.", 403);
  } catch {
    return jsonError("RPC_UNAVAILABLE", "Couldn't reach NEAR.", 503);
  }
  // Confirmation emails go to an address the holder typed: a few per hour per account, and per address (so many
  // holder accounts can't be used to flood one inbox).
  for (const [key, limit] of [[`notify:${b.accountId}`, 5], [`notify-to:${b.email.trim().toLowerCase()}`, 3]] as const) {
    const rl = await rateLimitShared(key, limit, 3600_000);
    if (!rl.ok) return jsonError("RATE_LIMITED", "Too many confirmation emails. Try again later.", 429);
  }
  const link = `${APP_URL}/api/notify?c=${encodeURIComponent(confirmToken(b.accountId, b.estate, b.unit, b.email))}`;
  const unitLabel = b.unit.toUpperCase();
  const sent = await sendEmail(
    b.email,
    `Confirm Plote emails for ${unitLabel}`,
    `<p>${esc(b.accountId)} asked Plote to email this address when a stage of ${esc(unitLabel)} at ${esc(estateSlug(b.estate))} is signed or money is released.</p><p><a href="${esc(link)}">Confirm</a> (valid for 48 hours). If this wasn't you, ignore this email and nothing is stored.</p>`,
  );
  if (!sent) return jsonError("EMAIL_FAILED", "Couldn't send the confirmation email. Try again later.", 502);
  return ok({ ok: true, pending: true });
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const kind = q.has("c") ? "c" : q.has("u") ? "u" : null;
  const t = kind ? (q.get(kind) ?? "") : "";
  const tok = kind === "c" ? readToken(t) : kind === "u" ? readUnsubscribeToken(t) : null;
  if (!kind || !tok) return page("That link isn't valid.", null, 400);
  if (tok === "expired") return page("That unsubscribe link has expired. Use the link in a newer email, or turn emails off on your unit page.", null, 410);
  return kind === "c"
    ? page("Confirm milestone emails for this address?", { action: `/api/notify?c=${encodeURIComponent(t)}`, label: "Confirm" })
    : page("Stop milestone emails and delete this address?", { action: `/api/notify?u=${encodeURIComponent(t)}`, label: "Unsubscribe" });
}

type Admin = NonNullable<ReturnType<typeof supabaseAdmin>>;

async function confirm(sb: Admin, t: string) {
  const tok = readToken(t);
  if (!tok || tok[0] !== "confirm" || tok.length !== 6) return page("That confirmation link isn't valid.", null, 400);
  const [, account, estate, unit, email, ts] = tok as [string, string, string, string, string, number];
  if (typeof ts !== "number" || Date.now() - ts > CONFIRM_TTL_MS) return page("That confirmation link has expired. Subscribe again from your unit page.", null, 410);
  const { error } = await sb.from(TABLES.notifySubscriptions).upsert({ account, estate, unit, email });
  if (error) return page("Couldn't save that right now. Try the link again later.", null, 502);
  return page("Confirmed. You'll get an email when a stage is signed or money is released.", null);
}

async function unsubscribe(sb: Admin, t: string) {
  const tok = readUnsubscribeToken(t);
  if (!tok) return page("That unsubscribe link isn't valid.", null, 400);
  if (tok === "expired") return page("That unsubscribe link has expired. Use the link in a newer email, or turn emails off on your unit page.", null, 410);
  const { error } = await sb.from(TABLES.notifySubscriptions).delete().match({ account: tok.account, estate: tok.estate, unit: tok.unit });
  if (error) return page("Couldn't unsubscribe right now. Try the link again later.", null, 502);
  return page("You're unsubscribed. Your email address was deleted.", null);
}

function esc(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function page(text: string, form: { action: string; label: string } | null, status = 200) {
  const body = form ? `<form method="post" action="${esc(form.action)}"><button type="submit">${esc(form.label)}</button></form>` : "";
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Plote</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem"><p>${esc(text)}</p>${body}</body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );
}
