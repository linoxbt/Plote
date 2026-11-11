// POST /api/gate/verify — server-side gate pass check (SPEC §9.5). Body: { estate, pass } where `pass` is the QR text.
// Verifies the NEP-413 signature, that the key is a full-access key of the holder, that the holder owns the unit's
// token and the unit is handed over, then claims the pass nonce once in Postgres (claim_once, 2-minute TTL), so the
// same pass is accepted at most once across every guard device. Public (no login), rate limited per IP.

import { z } from "zod";
import { ESTATES } from "@/lib/config";
import { estateAccount } from "@/lib/estates";
import { verifyGatePassServer } from "@/lib/server/gate";
import { clientIp, jsonError, ok, parseJson } from "@/lib/server/http";
import { rateLimitShared } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

const Body = z.object({ estate: z.string().min(2).max(64), pass: z.string().min(20).max(2000) });

export async function POST(req: Request) {
  const rl = await rateLimitShared(`gate:${clientIp(req)}`, 30, 60_000);
  if (!rl.ok) return jsonError("RATE_LIMITED", `Too many scans. Try again in ${rl.retryAfterS}s.`, 429, { "retry-after": String(rl.retryAfterS) });
  const p = await parseJson(req, Body);
  if (!p.ok) return p.res;
  const estate = estateAccount(p.data.estate);
  if (!ESTATES.includes(estate)) return jsonError("E_BAD_ARGS", "Unknown estate.");
  try {
    const r = await verifyGatePassServer(p.data.pass, estate);
    // 200 either way: a rejected pass is a normal answer for the guard screen, not a server error.
    return ok(r, { headers: { "cache-control": "no-store" } });
  } catch {
    return jsonError("RPC_UNAVAILABLE", "Couldn't reach NEAR to check the pass.", 503);
  }
}
