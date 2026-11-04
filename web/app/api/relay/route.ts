// POST /api/relay — NEP-366 meta-transaction relay (SPEC §9.4).
// Body: { signedDelegate: base64(borsh(SignedDelegate)) }. Allowlisted methods only, 0 deposit, gas cap, 10/min/account.

import { z } from "zod";
import { PloteError } from "@/lib/errors";
import { jsonError, notConfigured, ok, parseJson } from "@/lib/server/http";
import { serverEnv } from "@/lib/server/env";
import { rateLimit } from "@/lib/server/rate-limit";
import { checkDelegate, decodeSignedDelegate, relayerCredentials, relaySignedDelegate } from "@/lib/server/relayer";

export const dynamic = "force-dynamic";

const Body = z.object({ signedDelegate: z.string().min(16).max(20_000).regex(/^[A-Za-z0-9+/=]+$/, "must be base64") });

export async function POST(req: Request) {
  if (!relayerCredentials()) return notConfigured("The relayer", ["RELAYER_ACCOUNT_ID", "RELAYER_PRIVATE_KEY"]);
  const p = await parseJson(req, Body);
  if (!p.ok) return p.res;
  let sd;
  try {
    sd = decodeSignedDelegate(p.data.signedDelegate);
  } catch {
    return jsonError("E_BAD_ARGS", "signedDelegate isn't a valid borsh SignedDelegate.");
  }
  const check = checkDelegate(sd, { allowedMethods: serverEnv.relayerAllowedMethods(), maxGasTgas: serverEnv.relayerMaxGasTgas() });
  if (!check.ok) return jsonError(check.code, check.message, 403);
  const rl = rateLimit(`relay:${sd.delegateAction.senderId}`, 10, 60_000);
  if (!rl.ok) return jsonError("RATE_LIMITED", `Too many relayed calls. Try again in ${rl.retryAfterS}s.`, 429, { "retry-after": String(rl.retryAfterS) });
  try {
    const r = await relaySignedDelegate(sd);
    return ok({ hash: r.hash, logs: r.logs, returnValue: r.returnValue ?? null, methods: check.methods });
  } catch (e) {
    if (e instanceof PloteError) return jsonError(e.code, e.code.startsWith("E_") ? e.message : e.raw.slice(0, 500), 400);
    return jsonError("RELAY_FAILED", e instanceof Error ? e.message.slice(0, 500) : "relay failed", 502);
  }
}
