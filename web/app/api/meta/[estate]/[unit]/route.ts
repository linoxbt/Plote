// GET /api/meta/[estate]/[unit] — NEP-177 `reference` JSON (latest milestone photo, stage, links).

import { APP_URL } from "@/lib/config";
import { approvedCount, estate as E } from "@/lib/estate";
import { estateAccount, estateSlug, UNIT_ID_RE } from "@/lib/estates";
import { jsonError, ok } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ estate: string; unit: string }> }) {
  const { estate, unit } = await ctx.params;
  const unitId = unit.toLowerCase();
  if (!UNIT_ID_RE.test(unitId)) return jsonError("E_BAD_UNIT_ID", "Bad unit id.");
  const acc = estateAccount(estate);
  const s = estateSlug(acc);
  try {
    const [e, u, ms, evs] = await Promise.all([E.getEstate(acc), E.getUnit(acc, unitId), E.getMilestones(acc), E.listEvidence(acc, { limit: 20 }).catch(() => [])]);
    if (!u) return jsonError("E_UNIT_NOT_FOUND", "No such unit.", 404);
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
      { headers: { "cache-control": "public, max-age=60" } },
    );
  } catch {
    return jsonError("RPC_UNAVAILABLE", "Couldn't read the estate contract.", 503);
  }
}
