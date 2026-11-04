// GET /api/og/unit?estate=&unit= — 1200×630 card for WhatsApp/X (next/og). Without params: the default site card.

import { ImageResponse } from "next/og";
import { approvedCount, estate as E } from "@/lib/estate";
import { estateAccount } from "@/lib/estates";
import { houseSvgDataUri } from "@/lib/svg-house";
import type { EstateView, MilestoneView, UnitView } from "@/lib/types";

export const dynamic = "force-dynamic";

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

const MARK = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none"><path d="M6 18V6h12M46 6h12v12M58 46v12H46M18 58H6V46" stroke="#2DD4BF" stroke-width="4"/><rect x="20" y="18" width="6" height="28" fill="#E9ECEF"/><rect x="26" y="18" width="18" height="16" fill="#E9ECEF"/><rect x="32" y="24" width="6" height="4" fill="#0A0B0D"/><rect x="40" y="40" width="6" height="6" fill="#E8B04B"/></svg>')}`;

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const slug = sp.get("estate");
  const unitId = sp.get("unit")?.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 16) ?? null;
  let e: EstateView | null = null, u: UnitView | null = null, ms: MilestoneView[] | null = null;
  if (slug && unitId) {
    const acc = estateAccount(slug);
    [e, u, ms] = await Promise.all([withTimeout(E.getEstate(acc), 3500), withTimeout(E.getUnit(acc, unitId), 3500), withTimeout(E.getMilestones(acc), 3500)]);
  }
  const done = approvedCount(ms);
  const total = ms?.length || 4;
  const estateName = e?.name ?? (slug ? slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "Plote");
  const label = unitId ? unitId.toUpperCase() : "A-4B";
  const house = houseSvgDataUri({ estateName, unitLabel: label, unitId: unitId ?? "a-4b", approvedCount: unitId ? done : 3, total, status: u?.status ?? (unitId ? "—" : "Allocated"), paid: u?.paid ?? "0", price: u?.price ?? "0" });
  const headline = unitId ? (u ? `${label} at ${estateName} is ${Math.round(u.progress_bps / 100)}% built` : `${label} at ${estateName}`) : "Pay for the house you can see.";
  const sub = unitId ? (ms ? `${done} of ${total} stages proven · every payment checked on-chain` : "Every stage of this home, with the proof behind each payment.") : "Every off-plan home gets its own on-chain account.";
  return new ImageResponse(
    (
      <div style={{ width: 1200, height: 630, display: "flex", background: "#0A0B0D", color: "#E9ECEF", padding: 56, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: 640 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <img src={MARK} width={56} height={56} alt="" />
            <span style={{ fontSize: 40, letterSpacing: -1 }}>plote</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <span style={{ fontSize: 22, color: "#2DD4BF", letterSpacing: 3 }}>{unitId ? "WATCH MY HOUSE" : "OFF-PLAN ESCROW · BUILT ON NEAR"}</span>
            <span style={{ fontSize: 60, lineHeight: 1.1, fontWeight: 700 }}>{headline}</span>
            <span style={{ fontSize: 26, color: "#8B939D" }}>{sub}</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {Array.from({ length: total }).map((_, i) => (
              <div key={i} style={{ width: 120, height: 10, background: i < (unitId ? done : 3) ? "#2DD4BF" : "#252A31" }} />
            ))}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 450 }}>
          <img src={house} width={430} height={473} alt="" />
        </div>
      </div>
    ),
    { width: 1200, height: 630, headers: { "cache-control": "public, max-age=60, s-maxage=60" } },
  );
}
