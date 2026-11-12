// Operational alerts to ALERT_WEBHOOK_URL (Slack reads `text`, Discord reads `content`). Never throws.
// Also logs server-side errors without leaking them to clients (logError).

import { serverEnv } from "./env";

export async function alert(message: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const url = serverEnv.alertWebhookUrl();
  if (!url) return false;
  try {
    const r = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: message, content: message.slice(0, 1900) }),
      signal: AbortSignal.timeout(5000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/** One server log line for an internal error: a stable tag and a short message (never request bodies or keys). */
export function logError(tag: string, err: unknown, extra: Record<string, unknown> = {}): void {
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : JSON.stringify(err ?? null);
  console.error(tag, JSON.stringify({ ...extra, error: redact(message).slice(0, 500) }));
}

/** Strip anything that looks like a NEAR secret key or a bearer token from a log message. */
export function redact(s: string): string {
  return s.replace(/ed25519:[1-9A-HJ-NP-Za-km-z]{60,}/g, "ed25519:[redacted]").replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]");
}
