// POST /api/evidence/upload-url — Supabase signed upload URL for one evidence photo (SPEC §6.5, §14.1).
// Caller proves with a NEP-413 signature that they are the estate's surveyor (any account on a playground estate).
// Playground estates (anyone may act as surveyor) get much lower caps. Supabase signed upload URLs live 2 h and can't
// be shortened or bound to a size/hash, so the declared size and a 5-minute deadline (SPEC §17.2) are recorded with
// the row; the poller's storage check deletes uploads that arrive late or with another size (see storage-cleanup.ts).
// The bytes' sha256 is checked by the verifier against the hash signed on-chain. JPEG and PNG only (the bucket allows
// the same two types, migration 0006). If the row can't be recorded the route fails (no URL without its row: the
// storage check couldn't enforce the deadline or size otherwise).

import { z } from "zod";
import { ESTATES, NETWORK, SUPABASE_BUCKET, TABLES } from "@/lib/config";
import { estate as E } from "@/lib/estate";
import { estateSlug } from "@/lib/estates";
import { parseUploadMessage } from "@/lib/nep413";
import { verifySignedRequest } from "@/lib/server/auth";
import { clientIp, jsonError, notConfigured, ok, parseJson } from "@/lib/server/http";
import { rateLimitShared } from "@/lib/server/rate-limit";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import { logError } from "@/lib/server/alert";
import { HOUR_MS, uploadLimits } from "@/lib/server/limits";
import { UPLOAD_URL_TTL_MS } from "@/lib/server/storage-cleanup";

export const dynamic = "force-dynamic";

const MAX_BYTES = 12 * 1024 * 1024;
const MAX_EXIF_CHARS = 4096;
const TYPES = { "image/jpeg": "jpg", "image/png": "png" } as const;

const Body = z.object({
  estate: z.string().min(2).max(64),
  contentType: z.enum(["image/jpeg", "image/png"]),
  size: z.number().int().positive().max(MAX_BYTES),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  accountId: z.string().min(2).max(64),
  publicKey: z.string().startsWith("ed25519:"),
  signature: z.string().min(40),
  nonce: z.string().min(40),
  message: z.string().max(300),
  recipient: z.string(),
  // Display-only snapshot; capped so the public table can't be used as free storage.
  exif: z.record(z.string(), z.unknown()).nullable().optional().refine((x) => x == null || JSON.stringify(x).length <= MAX_EXIF_CHARS, `must be at most ${MAX_EXIF_CHARS} characters of JSON`),
});

export async function POST(req: Request) {
  const sb = supabaseAdmin();
  if (!sb) return notConfigured("Photo upload", ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);
  const p = await parseJson(req, Body);
  if (!p.ok) return p.res;
  const b = p.data;
  if (!ESTATES.includes(b.estate)) return jsonError("E_BAD_ARGS", "Unknown estate.");
  const msg = parseUploadMessage(b.message);
  if (!msg || msg.estate !== b.estate || msg.sha256 !== b.sha256 || b.recipient !== b.estate) return jsonError("BAD_SIGNATURE", "The signed message doesn't match this upload.");
  // Per IP before auth (bounds the NEAR reads); per account only after the signature and surveyor checks, so nobody
  // can use up a surveyor's quota by sending requests in their name.
  const pre = await rateLimitShared(`upload-ip:${clientIp(req)}`, 30, 60_000);
  if (!pre.ok) return jsonError("RATE_LIMITED", "Too many uploads. Wait a minute.", 429);

  let auth;
  try {
    auth = await verifySignedRequest(b, { allowFunctionCallFor: b.estate });
  } catch {
    return jsonError("RPC_UNAVAILABLE", "Couldn't reach NEAR to check your key.", 503);
  }
  if (!auth.ok) return jsonError(auth.code, auth.message, 401);
  let est;
  try {
    est = await E.getEstate(b.estate);
  } catch {
    return jsonError("RPC_UNAVAILABLE", "Couldn't read the estate contract.", 503);
  }
  if (!est.params.playground && est.surveyor_id !== b.accountId) return jsonError("E_NOT_SURVEYOR", "Only the estate's surveyor can upload evidence.", 403);
  for (const [key, limit, windowMs] of uploadLimits(b.accountId, est.params.playground, b.estate)) {
    const rl = await rateLimitShared(key, limit, windowMs);
    if (!rl.ok) {
      const msg = windowMs >= HOUR_MS ? `The playground allows a few uploads per hour. Try again in ${Math.ceil(rl.retryAfterS / 60)} min.` : "Too many uploads. Wait a minute.";
      return jsonError("RATE_LIMITED", msg, 429, { "retry-after": String(rl.retryAfterS) });
    }
  }

  const path = `${estateSlug(b.estate)}/${crypto.randomUUID()}.${TYPES[b.contentType]}`;
  const expiresAt = new Date(Date.now() + UPLOAD_URL_TTL_MS).toISOString();
  // The row first: an upload URL is only handed out once its deadline and declared size are on record.
  const ins = await sb.from(TABLES.evidenceFiles).insert({
    estate: b.estate, path, sha256: b.sha256, uploaded_by: b.accountId, exif: b.exif ?? null, size_bytes: b.size, upload_expires_at: expiresAt,
  });
  if (ins.error) {
    logError("plote:upload-row-failed", ins.error.message, { estate: b.estate });
    return jsonError("STORAGE_ERROR", "Couldn't record the upload. Try again in a minute.", 502);
  }
  const { data, error } = await sb.storage.from(SUPABASE_BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    logError("plote:upload-url-failed", error?.message ?? "no data", { estate: b.estate });
    await sb.from(TABLES.evidenceFiles).delete().eq("path", path).is("evidence_id", null);
    return jsonError("STORAGE_ERROR", "Couldn't create an upload URL. Try again in a minute.", 502);
  }
  const publicUrl = sb.storage.from(SUPABASE_BUCKET).getPublicUrl(path).data.publicUrl;
  return ok({ signedUrl: data.signedUrl, token: data.token, path, publicUrl, network: NETWORK, recorded: true, expiresAt });
}
