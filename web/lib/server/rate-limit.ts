// Rate limits. `rateLimitShared` counts in Postgres (supabase/migrations/0002_rate_limits.sql), so a limit holds across
// every serverless instance; if the database can't answer within 1.5 s it falls back to the per-instance counter below
// rather than failing the request (and logs `plote:rate-limit-fallback`).
import { supabaseAdmin } from "./supabase-admin";

export async function rateLimitShared(key: string, limit: number, windowMs: number): Promise<{ ok: boolean; retryAfterS: number; shared: boolean }> {
  const sb = supabaseAdmin();
  let why = "no_database";
  if (sb) {
    try {
      const call = sb.rpc("rate_limit_hit", { p_key: key, p_limit: limit, p_window_seconds: Math.max(1, Math.round(windowMs / 1000)) });
      const res = await Promise.race([call, new Promise<null>((r) => setTimeout(() => r(null), 1500))]);
      const row = res && !res.error ? (Array.isArray(res.data) ? res.data[0] : res.data) : null;
      if (row && typeof row.allowed === "boolean") return { ok: row.allowed, retryAfterS: Number(row.retry_after) || 0, shared: true };
      why = !res ? "timeout" : res.error ? "error" : "bad_row";
    } catch {
      why = "error"; // fall through to the local counter
    }
  }
  warnFallback("plote:rate-limit-fallback", key, why);
  return { ...rateLimit(key, limit, windowMs), shared: false };
}

const lastWarn = new Map<string, number>();

/**
 * One log line when a shared (Postgres) protection falls back to this instance's memory: the limit or single-use
 * check then only holds per serverless instance. Logs the tag, the key's scope (the part before the first ":", so
 * no account, IP or nonce) and the reason; at most once a minute per tag and scope.
 */
export function warnFallback(tag: string, key: string, why: string, now: number = Date.now()): boolean {
  const scope = key.split(":")[0].slice(0, 40);
  const k = `${tag}|${scope}|${why}`;
  const last = lastWarn.get(k);
  if (last !== undefined && now - last < 60_000) return false;
  lastWarn.set(k, now);
  if (lastWarn.size > 500) lastWarn.clear();
  console.warn(tag, JSON.stringify({ scope, why }));
  return true;
}

// In-memory sliding-window rate limit, per serverless instance (the fallback).

const buckets = new Map<string, number[]>();

export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterS: number } {
  const now = Date.now();
  const arr = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) {
    buckets.set(key, arr);
    return { ok: false, retryAfterS: Math.ceil((windowMs - (now - arr[0])) / 1000) };
  }
  arr.push(now);
  buckets.set(key, arr);
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (!v.some((t) => now - t < windowMs)) buckets.delete(k);
  }
  return { ok: true, retryAfterS: 0 };
}

/** Single-use values (gate nonces, synced deposit addresses) with a TTL. */
const seen = new Map<string, number>();
export function markOnce(key: string, ttlMs: number): boolean {
  const now = Date.now();
  for (const [k, exp] of seen) if (exp < now) seen.delete(k);
  if (seen.has(key)) return false;
  seen.set(key, now + ttlMs);
  return true;
}
