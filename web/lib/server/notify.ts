// Milestone email helpers (C7): signed confirm/unsubscribe tokens and Resend delivery.

import { createHmac, timingSafeEqual } from "node:crypto";
import { APP_URL } from "../config";
import { serverEnv } from "./env";

export function notifySecret(): string {
  return serverEnv.cronSecret() ?? serverEnv.supabaseServiceKey() ?? "";
}

export function unsubscribeToken(account: string, estate: string, unit: string): string {
  const body = Buffer.from(JSON.stringify([account, estate, unit])).toString("base64url");
  const sig = createHmac("sha256", notifySecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

/** Read a token made by signToken/unsubscribeToken; null if the signature doesn't match. */
export function readToken(t: string): unknown[] | null {
  const [body, sig] = t.split(".");
  if (!body || !sig || !notifySecret()) return null;
  const want = createHmac("sha256", notifySecret()).update(body).digest();
  const got = Buffer.from(sig, "base64url");
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
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
  const sig = createHmac("sha256", notifySecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function unsubscribeUrl(account: string, estate: string, unit: string): string {
  return `${APP_URL}/api/notify?u=${encodeURIComponent(unsubscribeToken(account, estate, unit))}`;
}

export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const key = serverEnv.resendApiKey();
  if (!key) return false;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from: serverEnv.resendFrom(), to: [to], subject, html }),
      signal: AbortSignal.timeout(8000),
    });
    return r.ok;
  } catch {
    return false;
  }
}
