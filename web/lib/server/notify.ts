// Milestone email helpers (C7): unsubscribe tokens and Resend delivery.

import { createHmac } from "node:crypto";
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
