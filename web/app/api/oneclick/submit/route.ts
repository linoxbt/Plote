// POST /api/oneclick/submit — proxy of 1Click POST /v0/deposit/submit (optional; speeds up detection). Mainnet builds only.

import { z } from "zod";
import { clientIp, jsonError, ok, parseJson } from "@/lib/server/http";
import { rateLimitShared } from "@/lib/server/rate-limit";
import { IS_MAINNET } from "@/lib/config";
import { oneclickFetch, oneclickMainnetOnly } from "@/lib/server/oneclick-server";

export const dynamic = "force-dynamic";

const Body = z.object({ depositAddress: z.string().min(10).max(120), txHash: z.string().min(10).max(200) });

export async function POST(req: Request) {
  if (!IS_MAINNET) return oneclickMainnetOnly();
  const rl = await rateLimitShared(`oneclick-submit:${clientIp(req)}`, 10, 60_000);
  if (!rl.ok) return jsonError("RATE_LIMITED", `Too many requests. Try again in ${rl.retryAfterS}s.`, 429, { "retry-after": String(rl.retryAfterS) });
  const p = await parseJson(req, Body);
  if (!p.ok) return p.res;
  try {
    const r = await oneclickFetch("/deposit/submit", { method: "POST", body: JSON.stringify(p.data) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return jsonError("ONECLICK_SUBMIT_FAILED", (j as { message?: string }).message ?? `HTTP ${r.status}`, 502);
    return ok({ ok: true, ...j });
  } catch (e) {
    return jsonError("ONECLICK_UNAVAILABLE", e instanceof Error ? e.message : "1Click unreachable", 503);
  }
}
