// POST /api/relay — NEP-366 meta-transaction relay (SPEC §9.4).
// Body: { signedDelegate: base64(borsh(SignedDelegate)) }. Surveyor calls only (allowlisted methods, 0 deposit, gas cap),
// verified off-chain before any gas is spent: signature, key on the sender, fresh nonce, not expired, sender = surveyor.

import { z } from "zod";
import { PloteError } from "@/lib/errors";
import { clientIp, jsonError, notConfigured, ok, parseJson } from "@/lib/server/http";
import { serverEnv } from "@/lib/server/env";
import { claimOnceStrict } from "@/lib/server/once";
import { logError } from "@/lib/server/alert";
import { rateLimitShared } from "@/lib/server/rate-limit";
import { bytesToBase64 } from "@/lib/near";
import { relayLimits } from "@/lib/server/limits";
import { chainReader, checkDelegate, decodeSignedDelegate, delegateHash, relayerCredentials, relayerEnvNames, relaySignedDelegate, verifyDelegate } from "@/lib/server/relayer";

export const dynamic = "force-dynamic";

const Body = z.object({ signedDelegate: z.string().min(16).max(20_000).regex(/^[A-Za-z0-9+/=]+$/, "must be base64") });

export async function POST(req: Request) {
  if (!relayerCredentials()) return notConfigured("The relayer", relayerEnvNames());
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
  const ip = clientIp(req);
  // Loose per-IP cap before verification: it reads NEAR three times, so unauthenticated junk mustn't amplify.
  const pre = await rateLimitShared(`relay-pre:${ip}`, 60, 60_000);
  if (!pre.ok) return jsonError("RATE_LIMITED", `Too many requests. Try again in ${pre.retryAfterS}s.`, 429, { "retry-after": String(pre.retryAfterS) });
  let v;
  try {
    v = await verifyDelegate(sd, check.methods);
  } catch {
    return jsonError("RPC_UNAVAILABLE", "Couldn't reach NEAR to check the signed action.", 503);
  }
  if (!v.ok) return jsonError(v.code, v.message, v.code === "E_NOT_SURVEYOR" || v.code === "KEY_NOT_ALLOWED" ? 403 : 401);
  // Counted only for verified surveyor calls, so nobody can spend someone else's (or everyone's) quota. The per-estate
  // bucket keeps playground traffic (where anyone is a surveyor, with hourly caps too) from using up a real estate's.
  let playground = false;
  try {
    playground = (await chainReader.estate(sd.delegateAction.receiverId)).params.playground; // cached by verifyDelegate
  } catch {
    return jsonError("RPC_UNAVAILABLE", "Couldn't reach NEAR to check the estate.", 503);
  }
  for (const [key, limit, windowMs] of relayLimits(sd.delegateAction.senderId, ip, sd.delegateAction.receiverId, playground, check.methods)) {
    const rl = await rateLimitShared(key, limit, windowMs);
    if (!rl.ok) return jsonError("RATE_LIMITED", `Too many relayed calls. Try again in ${rl.retryAfterS}s.`, 429, { "retry-after": String(rl.retryAfterS) });
  }
  // The chain rejects a replay, but the relayer would still pay for the failed receipt. Fails closed: without the
  // shared claim the same delegate could be paid for once per serverless instance.
  const claim = await claimOnceStrict("delegate", bytesToBase64(delegateHash(sd)), 10 * 60_000);
  if (claim.unavailable) return jsonError("REPLAY_CHECK_UNAVAILABLE", "Couldn't check this signed action for replays right now. Try again in a minute.", 503);
  if (!claim.ok) return jsonError("NONCE_USED", "This signed action was already submitted.", 409);
  try {
    const r = await relaySignedDelegate(sd);
    return ok({ hash: r.hash, logs: r.logs, returnValue: r.returnValue ?? null, methods: check.methods });
  } catch (e) {
    // Contract panics carry a stable E_ code and a message meant for users; anything else (RPC, signer, gas) is
    // logged here and answered with a generic message.
    if (e instanceof PloteError && e.code.startsWith("E_")) return jsonError(e.code, e.message, 400);
    logError("plote:relay-failed", e, { receiver: sd.delegateAction.receiverId, methods: check.methods });
    if (e instanceof PloteError) return jsonError(e.code, e.message, 400); // the app's own message for the code, not the raw error
    return jsonError("RELAY_FAILED", "The relayer couldn't send this call. Try again in a minute.", 502);
  }
}
