// GET /api/notify/status — whether milestone emails can be sent from this deployment: { configured: boolean }.
// True only when RESEND_API_KEY and RESEND_FROM (a sender on a domain verified in Resend) are set, and a link-signing
// key (NOTIFY_SECRET, or CRON_SECRET) exists. The UI can hide the email opt-in when it's false.

import { notifyConfigured } from "@/lib/server/notify";
import { ok } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export function GET() {
  return ok({ configured: notifyConfigured() }, { headers: { "cache-control": "public, max-age=60" } });
}
