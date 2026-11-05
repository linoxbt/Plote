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

const MARK = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="9 3 30 42"><path d="M10 4h12v6h-6v16h6v6h-6v6l-3 6-3-6z" fill="#E8EAF4"/><path d="M26 4h12v12h-6v-6h-6z" fill="#E8EAF4"/><path d="M32 20h6v12H26v-6h6z" fill="#E8EAF4"/><rect x="20" y="14" width="8" height="8" fill="#E8B04B"/></svg>')}`;

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
      <div style={{ width: 1200, height: 630, display: "flex", background: "linear-gradient(180deg, #0b1050 0%, #03051f 55%, #01020f 100%)", color: "#E8EAF4", padding: 56, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: 640 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <img src={MARK} width={40} height={56} alt="" />
            <span style={{ fontSize: 40, letterSpacing: -1 }}>plote</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <span style={{ fontSize: 22, color: "#2DD4BF", letterSpacing: 3 }}>{unitId ? "WATCH MY HOUSE" : "OFF-PLAN ESCROW · BUILT ON NEAR"}</span>
            <span style={{ fontSize: 60, lineHeight: 1.1, fontWeight: 700 }}>{headline}</span>
            <span style={{ fontSize: 26, color: "#8B939D" }}>{sub}</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {Array.from({ length: total }).map((_, i) => (
              <div key={i} style={{ width: 120, height: 10, background: i < (unitId ? done : 3) ? "#2DD4BF" : "#1d2550" }} />
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
