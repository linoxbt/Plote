// GET /api/meta/[estate]/[unit] — NEP-177 `reference` JSON (latest milestone photo, stage, links).
// Only estates configured on this deployment (NEXT_PUBLIC_ESTATES): the route reads the chain, so it mustn't proxy
// views of arbitrary accounts. Cached at the edge for a minute (stale for five while it refreshes).

import { APP_URL, ESTATES } from "@/lib/config";
import { approvedCount, estate as E } from "@/lib/estate";
import { estateAccount, estateSlug, UNIT_ID_RE } from "@/lib/estates";
import { explainError } from "@/lib/errors";
import { jsonError, ok } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const CACHE_OK = "public, max-age=60, s-maxage=60, stale-while-revalidate=300";
const CACHE_MISS = "public, max-age=300, s-maxage=300";

export async function GET(_req: Request, ctx: { params: Promise<{ estate: string; unit: string }> }) {
  const { estate, unit } = await ctx.params;
  const unitId = unit.toLowerCase();
  if (!UNIT_ID_RE.test(unitId)) return jsonError("E_BAD_UNIT_ID", "Bad unit id.", 400, { "cache-control": CACHE_MISS });
  const acc = estateAccount(estate);
  if (!ESTATES.includes(acc)) return jsonError("E_BAD_ARGS", "Unknown estate: it isn't on this deployment.", 404, { "cache-control": CACHE_MISS });
  const s = estateSlug(acc);
  try {
    const [e, u, ms, evs] = await Promise.all([E.getEstate(acc), E.getUnit(acc, unitId), E.getMilestones(acc), E.listEvidence(acc, { limit: 20 }).catch(() => [])]);
    if (!u) return jsonError("E_UNIT_NOT_FOUND", "No such unit.", 404, { "cache-control": "public, max-age=60, s-maxage=60" });
    const latest = evs.find((x) => x.status === "Pass");
    const done = approvedCount(ms);
    return ok(
      {
        name: `${e.name} · ${unitId.toUpperCase()}`,
        description: `${u.label}. Allocation token for ${u.account}: holds the unit's escrow, refunds, resale, vote and gate pass.`,
        image: `${APP_URL}/api/og/unit?estate=${s}&unit=${unitId}`,
        external_url: `${APP_URL}/w/${s}/${unitId}`,
        estate: acc,
        unit_account: u.account,
        status: u.status,
        price: u.price,
        paid: u.paid,
        released: u.released,
        progress_bps: u.progress_bps,
        milestones: ms.map((m) => ({ key: m.key, title: m.title, bps: m.bps, status: m.status, deadline: m.deadline })),
        latest_photo: latest ? { evidence_id: latest.id, url: latest.url, sha256: latest.sha256, stage: latest.verdict?.ai_stage ?? null, proof: `${APP_URL}/proof/${s}/${latest.id}` } : null,
        attributes: [
          { trait_type: "Estate", value: e.name },
          { trait_type: "Status", value: u.status },
          { trait_type: "Stages approved", value: `${done}/${ms.length}` },
        ],
      },
      { headers: { "cache-control": CACHE_OK } },
    );
  } catch (e) {
    const x = explainError(e);
    if (x.code === "CONTRACT_NOT_DEPLOYED") return jsonError(x.code, `${acc} isn't deployed on this network.`, 404, { "cache-control": "public, max-age=60, s-maxage=60" });
    return jsonError(x.code === "UNKNOWN" ? "RPC_UNAVAILABLE" : x.code, x.message, 503, { "cache-control": "no-store" });
  }
}
