// GET /api/oneclick/tokens — proxy + 10-min cache of 1Click GET /v0/tokens, filtered to stablecoins. Mainnet builds only.

import { jsonError, ok } from "@/lib/server/http";
import { IS_MAINNET } from "@/lib/config";
import { oneclickFetch, oneclickMainnetOnly } from "@/lib/server/oneclick-server";
import { STABLE_SYMBOLS, type OneClickToken } from "@/lib/oneclick";

export const dynamic = "force-dynamic";

let cache: { at: number; tokens: OneClickToken[] } | null = null;
const TTL = 10 * 60_000;

export async function GET() {
  if (!IS_MAINNET) return oneclickMainnetOnly();
  if (cache && Date.now() - cache.at < TTL) return ok({ tokens: cache.tokens, cached: true }, { headers: { "cache-control": "public, max-age=600" } });
  try {
    const r = await oneclickFetch("/tokens", {}, 8000);
    if (!r.ok) return jsonError("ONECLICK_ERROR", `1Click returned HTTP ${r.status}.`, 502);
    const all = (await r.json()) as OneClickToken[];
    const tokens = (Array.isArray(all) ? all : []).filter((t) => STABLE_SYMBOLS.includes(String(t.symbol).toUpperCase()));
    cache = { at: Date.now(), tokens };
    return ok({ tokens, cached: false }, { headers: { "cache-control": "public, max-age=600" } });
  } catch (e) {
    if (cache) return ok({ tokens: cache.tokens, cached: true, stale: true });
    return jsonError("ONECLICK_UNAVAILABLE", e instanceof Error ? e.message : "1Click unreachable", 503);
  }
}
