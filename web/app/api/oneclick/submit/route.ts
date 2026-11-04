// POST /api/oneclick/submit — proxy of 1Click POST /v0/deposit/submit (optional; speeds up detection).

import { z } from "zod";
import { jsonError, ok, parseJson } from "@/lib/server/http";
import { oneclickFetch } from "@/lib/server/oneclick-server";

export const dynamic = "force-dynamic";

const Body = z.object({ depositAddress: z.string().min(10).max(120), txHash: z.string().min(10).max(200) });

export async function POST(req: Request) {
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
