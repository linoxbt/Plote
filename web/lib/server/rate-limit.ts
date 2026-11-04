// In-memory sliding-window rate limit. Per serverless instance — enough for a hackathon relayer.

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
