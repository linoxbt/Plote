// /api/notify — opt-in milestone emails (C7). POST subscribes (NEP-413 signed by the holder); GET ?u=<token> unsubscribes.

import { createHmac, timingSafeEqual } from "node:crypto";
import { notifySecret as secret } from "@/lib/server/notify";
import { z } from "zod";
import { ESTATES, TABLES } from "@/lib/config";
import { estate as E } from "@/lib/estate";
import { estateSlug } from "@/lib/estates";
import { verifySignedRequest } from "@/lib/server/auth";
import { jsonError, notConfigured, ok, parseJson } from "@/lib/server/http";
import { supabaseAdmin } from "@/lib/server/supabase-admin";

export const dynamic = "force-dynamic";

const Body = z.object({
  accountId: z.string().min(2).max(64),
  publicKey: z.string().startsWith("ed25519:"),
  signature: z.string().min(40),
  nonce: z.string().min(40),
  message: z.string().max(400),
  recipient: z.string(),
  estate: z.string().min(2).max(64),
  unit: z.string().regex(/^[a-z0-9-]{1,16}$/),
  email: z.string().email().max(200),
});

export async function POST(req: Request) {
  const sb = supabaseAdmin();
  if (!sb) return notConfigured("Notifications", ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);
  const p = await parseJson(req, Body);
  if (!p.ok) return p.res;
  const b = p.data;
  if (!ESTATES.includes(b.estate) || b.recipient !== b.estate) return jsonError("E_BAD_ARGS", "Unknown estate.");
  const parts = b.message.split(":");
  if (parts[0] !== "plote-notify" || parts[1] !== estateSlug(b.estate) || parts[2] !== b.unit || parts.slice(3, -1).join(":") !== b.email) {
    return jsonError("BAD_SIGNATURE", "The signed message doesn't match this subscription.");
  }
  try {
    const auth = await verifySignedRequest(b, { maxAgeMs: 10 * 60_000 });
    if (!auth.ok) return jsonError(auth.code, auth.message, 401);
    const u = await E.getUnit(b.estate, b.unit);
    if (!u || u.holder !== b.accountId) return jsonError("E_NOT_HOLDER", "Only the unit's holder can subscribe.", 403);
  } catch {
    return jsonError("RPC_UNAVAILABLE", "Couldn't reach NEAR.", 503);
  }
  const { error } = await sb.from(TABLES.notifySubscriptions).upsert({ account: b.accountId, estate: b.estate, unit: b.unit, email: b.email });
  if (error) return jsonError("STORAGE_ERROR", error.message, 502);
  return ok({ ok: true });
}

export async function GET(req: Request) {
  const sb = supabaseAdmin();
  if (!sb) return notConfigured("Notifications", ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);
  const t = new URL(req.url).searchParams.get("u") ?? "";
  const [body, sig] = t.split(".");
  if (!body || !sig || !secret()) return jsonError("E_BAD_ARGS", "Bad unsubscribe link.");
  const want = createHmac("sha256", secret()).update(body).digest();
  const got = Buffer.from(sig, "base64url");
  if (want.length !== got.length || !timingSafeEqual(want, got)) return jsonError("BAD_SIGNATURE", "Bad unsubscribe link.", 401);
  const [account, estate, unit] = JSON.parse(Buffer.from(body, "base64url").toString()) as string[];
  await sb.from(TABLES.notifySubscriptions).delete().match({ account, estate, unit });
  return new Response("You're unsubscribed. Your email address was deleted.", { headers: { "content-type": "text/plain; charset=utf-8" } });
}
