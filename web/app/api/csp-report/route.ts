// POST /api/csp-report — CSP violation reports (report-uri in lib/csp.ts). Logged so a wallet or host the policy
// blocks shows up in the deployment logs instead of failing silently. Nothing is stored.

import { clientIp } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!rateLimit(`csp:${clientIp(req)}`, 30, 60_000).ok) return new Response(null, { status: 204 });
  const text = (await req.text().catch(() => "")).slice(0, 4000);
  try {
    const j = JSON.parse(text) as { "csp-report"?: Record<string, unknown> };
    const r = j["csp-report"] ?? {};
    console.warn("csp-violation", JSON.stringify({ directive: r["violated-directive"] ?? r["effective-directive"], blocked: r["blocked-uri"], page: r["document-uri"] }).slice(0, 500));
  } catch {
    /* not a report */
  }
  return new Response(null, { status: 204 });
}
