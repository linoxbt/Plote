// Milestone email helpers (C7): signed confirm/unsubscribe tokens and Resend delivery.

import { createHmac, timingSafeEqual } from "node:crypto";
import { APP_URL } from "../config";
import { serverEnv } from "./env";

/**
 * HMAC key for the links: NOTIFY_SECRET, or CRON_SECRET while NOTIFY_SECRET is unset (links sent before NOTIFY_SECRET
 * existed were signed with CRON_SECRET). Empty when neither is set: then no token can be made or read.
 */
export function notifySecret(): string {
  return serverEnv.notifySecret() ?? serverEnv.cronSecret() ?? "";
}

/**
 * Keys a token may be signed with. Unsubscribe links in emails already sent never expire, so after NOTIFY_SECRET is
 * set they still verify against the old CRON_SECRET; confirm links (48 h) only against the current key.
 */
function verifyKeys(kind: "any" | "unsubscribe"): string[] {
  const keys = [notifySecret()];
  const legacy = serverEnv.cronSecret();
  if (kind === "unsubscribe" && serverEnv.notifySecret() && legacy) keys.push(legacy);
  return keys.filter(Boolean);
}

function sign(body: string): string {
  const key = notifySecret();
  if (!key) throw new Error("NOTIFY_SECRET (or CRON_SECRET) is not set");
  return createHmac("sha256", key).update(body).digest("base64url");
}

/**
 * True when emails can be sent (RESEND_API_KEY and RESEND_FROM set), links can be signed (NOTIFY_SECRET or CRON_SECRET)
 * and subscriptions can be stored (Supabase service role).
 */
export function notifyConfigured(): boolean {
  return !!serverEnv.resendApiKey() && !!serverEnv.resendFrom() && !!notifySecret() && !!serverEnv.supabaseUrl() && !!serverEnv.supabaseServiceKey();
}

export function unsubscribeToken(account: string, estate: string, unit: string): string {
  const body = Buffer.from(JSON.stringify([account, estate, unit])).toString("base64url");
  return `${body}.${sign(body)}`;
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
