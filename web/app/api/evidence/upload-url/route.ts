// POST /api/evidence/upload-url — Supabase signed upload URL for one evidence photo (SPEC §6.5, §14.1).
// Caller proves with a NEP-413 signature that they are the estate's surveyor (any account on a playground estate).

import { z } from "zod";
import { ESTATES, NETWORK, SUPABASE_BUCKET, TABLES } from "@/lib/config";
import { estate as E } from "@/lib/estate";
import { estateSlug } from "@/lib/estates";
import { parseUploadMessage } from "@/lib/nep413";
import { verifySignedRequest } from "@/lib/server/auth";
import { jsonError, notConfigured, ok, parseJson } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rate-limit";
import { supabaseAdmin } from "@/lib/server/supabase-admin";

export const dynamic = "force-dynamic";

const MAX_BYTES = 12 * 1024 * 1024;
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
  exif: z.record(z.string(), z.unknown()).nullable().optional(),
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
  const rl = rateLimit(`upload:${b.accountId}`, 20, 60_000);
  if (!rl.ok) return jsonError("RATE_LIMITED", "Too many uploads. Wait a minute.", 429);

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

  const path = `${estateSlug(b.estate)}/${crypto.randomUUID()}.${TYPES[b.contentType]}`;
  const { data, error } = await sb.storage.from(SUPABASE_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return jsonError("STORAGE_ERROR", error?.message ?? "Couldn't create an upload URL.", 502);
  const publicUrl = sb.storage.from(SUPABASE_BUCKET).getPublicUrl(path).data.publicUrl;
  const ins = await sb.from(TABLES.evidenceFiles).insert({ estate: b.estate, path, sha256: b.sha256, uploaded_by: b.accountId, exif: b.exif ?? null });
  return ok({ signedUrl: data.signedUrl, token: data.token, path, publicUrl, network: NETWORK, recorded: !ins.error });
}
