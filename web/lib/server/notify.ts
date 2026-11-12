// Milestone email helpers (C7): signed confirm/unsubscribe tokens and Resend delivery.

import { createHmac, timingSafeEqual } from "node:crypto";
import { APP_URL } from "../config";
import { serverEnv } from "./env";

/**
 * HMAC key that signs new links: NOTIFY_SECRET only (kept apart from CRON_SECRET, which also authorises the poller).
 * Empty when unset: then no link can be made and emails are off (notifyConfigured() is false).
 */
export function notifySecret(): string {
  return serverEnv.notifySecret() ?? "";
}

/**
 * Keys a token may be verified with. Unsubscribe links in emails sent before NOTIFY_SECRET existed were signed with
 * CRON_SECRET; they still verify against it (read-only fallback, nothing new is signed with it). Confirm links (48 h)
 * only verify against NOTIFY_SECRET.
 */
function verifyKeys(kind: "any" | "unsubscribe"): string[] {
  const keys = [notifySecret()];
  const legacy = serverEnv.cronSecret();
  if (kind === "unsubscribe" && legacy && legacy !== keys[0]) keys.push(legacy);
  return keys.filter(Boolean);
}

function sign(body: string): string {
  const key = notifySecret();
  if (!key) throw new Error("NOTIFY_SECRET is not set");
  return createHmac("sha256", key).update(body).digest("base64url");
}

/**
 * True when emails can be sent (RESEND_API_KEY and RESEND_FROM set), links can be signed (NOTIFY_SECRET) and
 * subscriptions can be stored (Supabase service role).
 */
export function notifyConfigured(): boolean {
  return !!serverEnv.resendApiKey() && !!serverEnv.resendFrom() && !!notifySecret() && !!serverEnv.supabaseUrl() && !!serverEnv.supabaseServiceKey();
}

/** Unsubscribe links issued from now on stop working after a year (each email carries a fresh one). */
export const UNSUBSCRIBE_TTL_MS = 365 * 86_400_000;

export function unsubscribeToken(account: string, estate: string, unit: string, tsMs: number = Date.now()): string {
  const body = Buffer.from(JSON.stringify(["unsubscribe", account, estate, unit, tsMs])).toString("base64url");
  return `${body}.${sign(body)}`;
}

/**
 * The subscription an unsubscribe link names, "expired", or null when it isn't valid. Accepts the current format
 * (`["unsubscribe", account, estate, unit, issuedMs]`, valid UNSUBSCRIBE_TTL_MS) and links sent before it
 * (`[account, estate, unit]`, no expiry, so links already in inboxes keep working).
 */
export function readUnsubscribeToken(t: string, now: number = Date.now()): { account: string; estate: string; unit: string } | "expired" | null {
  const tok = readToken(t, "unsubscribe");
  if (!tok) return null;
  const strs = (xs: unknown[]) => xs.every((x) => typeof x === "string" && x.length > 0 && x.length <= 200);
  if (tok.length === 3 && strs(tok)) return { account: tok[0] as string, estate: tok[1] as string, unit: tok[2] as string };
  if (tok.length === 5 && tok[0] === "unsubscribe" && strs(tok.slice(1, 4)) && typeof tok[4] === "number") {
    if (now - tok[4] > UNSUBSCRIBE_TTL_MS) return "expired";
    return { account: tok[1] as string, estate: tok[2] as string, unit: tok[3] as string };
  }
  return null;
}

/** Read a token made by confirmToken/unsubscribeToken; null if the signature doesn't match. */
export function readToken(t: string, kind: "any" | "unsubscribe" = "any"): unknown[] | null {
  const [body, sig] = t.split(".");
  const keys = verifyKeys(kind);
  if (!body || !sig || !keys.length) return null;
  const got = Buffer.from(sig, "base64url");
  const match = keys.some((k) => {
    const want = createHmac("sha256", k).update(body).digest();
    return want.length === got.length && timingSafeEqual(want, got);
  });
  if (!match) return null;
  try {
    const j = JSON.parse(Buffer.from(body, "base64url").toString());
    return Array.isArray(j) ? j : null;
  } catch {
    return null;
  }
}

export const CONFIRM_TTL_MS = 48 * 3600_000;

/** Double opt-in: the subscription is written only when the address owner follows this link. */
export function confirmToken(account: string, estate: string, unit: string, email: string, tsMs: number = Date.now()): string {
  const body = Buffer.from(JSON.stringify(["confirm", account, estate, unit, email, tsMs])).toString("base64url");
  return `${body}.${sign(body)}`;
}

/** Throws when NOTIFY_SECRET is unset (callers check notifyConfigured() first). */
export function unsubscribeUrl(account: string, estate: string, unit: string): string {
  return `${APP_URL}/api/notify?u=${encodeURIComponent(unsubscribeToken(account, estate, unit))}`;
}

export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const key = serverEnv.resendApiKey();
  const from = serverEnv.resendFrom();
  if (!key || !from) return false;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, html }),
      signal: AbortSignal.timeout(8000),
    });
    return r.ok;
  } catch {
    return false;
  }
}
