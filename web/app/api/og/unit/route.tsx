// GET /api/og/unit?estate=&unit= — 1200×630 card for WhatsApp/X (next/og). Without params: the default site card.
//
// next/og (Satori + resvg) ships no system fonts, so every glyph has to come from font data passed in here:
// Lexend 300/500 and JetBrains Mono 400/600 are vendored next to this route (OFL, see ./fonts). The NFT drawing is
// the same SVG the app and the contract draw (lib/svg-house), but its <text> elements are lifted out and laid back
// over the drawing as JSX, which Satori renders as glyph paths. An SVG passed as an <img> would be rasterised
// by resvg with no fonts, which is what turned every label into ☐ before.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { approvedCount, estate as E, nftApprovedCount } from "@/lib/estate";
import { estateAccount } from "@/lib/estates";
import { houseSvg } from "@/lib/svg-house";
import type { EstateView, MilestoneView, UnitView } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FontSpec = { name: string; data: ArrayBuffer; weight: 300 | 400 | 500 | 600; style: "normal" };

const FONT_DIR = join(process.cwd(), "app/api/og/unit/fonts");
const FONT_FILES: [string, string, FontSpec["weight"]][] = [
  ["Lexend", "Lexend-Light.ttf", 300],
  ["Lexend", "Lexend-Medium.ttf", 500],
  ["JetBrains Mono", "JetBrainsMono-Regular.ttf", 400],
  ["JetBrains Mono", "JetBrainsMono-SemiBold.ttf", 600],
];

let fontsP: Promise<FontSpec[]> | null = null;
function loadFonts(): Promise<FontSpec[]> {
  fontsP ??= Promise.all(
    FONT_FILES.map(async ([name, file, weight]) => {
      const b = await readFile(join(FONT_DIR, file));
      return { name, weight, style: "normal" as const, data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer };
    }),
  ).catch((e) => {
    fontsP = null; // retry on the next request rather than caching the failure
    throw e;
  });
  return fontsP;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

// The Plote mark, gradient tile (same as public/mark.svg and components/logo.tsx). No text, so resvg draws it exactly.
const MARK = `data:image/svg+xml;base64,${Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFB054"/><stop offset=".45" stop-color="#FF9211"/><stop offset="1" stop-color="#E55D08"/></linearGradient></defs><rect width="64" height="64" rx="16" fill="url(#g)"/><circle cx="35" cy="27" r="11" fill="none" stroke="#121212" stroke-width="7"/><path d="M20.5 16h7v26l-3.5 8-3.5-8z" fill="#121212"/><rect x="32" y="24" width="6" height="6" fill="#FFFFFF"/></svg>',
).toString("base64")}`;

// ---------------- SVG text → JSX ----------------

type SvgText = { x: number; y: number; size: number; weight: number; anchor: "start" | "middle" | "end"; fill: string; mono: boolean; content: string };

const ENTITIES: Record<string, string> = { "&lt;": "<", "&gt;": ">", "&amp;": "&", "&quot;": '"', "&#39;": "'", "&apos;": "'" };
const unescape = (s: string) => s.replace(/&(lt|gt|amp|quot|apos|#39);/g, (m) => ENTITIES[m] ?? m);
// Attribute values in either quote style (the contract's SVG uses single quotes, lib/svg-house double).
const attr = (attrs: string, name: string) => {
  const m = attrs.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`));
  return m ? (m[1] ?? m[2]) : undefined;
};

/** Split an SVG into the drawing without its <text> elements and the texts themselves (position, size, colour). */
function liftSvgText(svg: string): { drawing: string; texts: SvgText[]; width: number; height: number } {
  const open = svg.slice(svg.indexOf("<svg"));
  const vb = (attr(open.slice(0, open.indexOf(">") + 1), "viewBox") ?? "0 0 300 330").trim().split(/[\s,]+/).map(Number);
  const [width, height] = [vb[2] || 300, vb[3] || 330];
  // Default text fill from a `text{…fill:#xxx}` rule in the SVG's <style>, if any.
  const defFill = svg.match(/text\s*\{[^}]*fill:\s*([^;}]+)/)?.[1]?.trim() ?? "#FFFFFF";
  const defFamily = svg.match(/text\s*\{[^}]*font-family:\s*([^;}]+)/)?.[1]?.trim() ?? "monospace";
  const texts: SvgText[] = [];
  const drawing = svg.replace(/<text\b([^>]*)>([\s\S]*?)<\/text>/g, (_, attrs: string, inner: string) => {
    const style = attr(attrs, "style") ?? "";
    const anchor = (attr(attrs, "text-anchor") ?? style.match(/text-anchor:\s*(\w+)/)?.[1] ?? "start") as SvgText["anchor"];
    texts.push({
      x: Number(attr(attrs, "x") ?? 0),
      y: Number(attr(attrs, "y") ?? 0),
      size: Number(attr(attrs, "font-size") ?? style.match(/font-size:\s*([\d.]+)/)?.[1] ?? 12),
      weight: Number(attr(attrs, "font-weight") ?? style.match(/font-weight:\s*(\d+)/)?.[1] ?? 400),
      anchor: anchor === "middle" || anchor === "end" ? anchor : "start",
      fill: style.match(/fill:\s*([^;]+)/)?.[1]?.trim() ?? attr(attrs, "fill") ?? defFill,
      mono: /mono/i.test(attr(attrs, "font-family") ?? style.match(/font-family:\s*([^;]+)/)?.[1] ?? defFamily),
      content: unescape(inner.replace(/<[^>]+>/g, "")),
    });
    return "";
  });
  return { drawing, texts, width, height };
}

// With line-height 1 the baseline sits (1 - ascent - descent) / 2 + ascent below the box top:
// JetBrains Mono (1.02 / 0.30 em) → 0.86 em; Lexend (1.00 / 0.25 em) → 0.875 em.
const BASELINE = { mono: 0.86, sans: 0.875 };

function NftCard({ svg, width }: { svg: string; width: number }) {
  const { drawing, texts, width: vw, height: vh } = liftSvgText(svg);
  const k = width / vw;
  const src = `data:image/svg+xml;base64,${Buffer.from(drawing).toString("base64")}`;
  return (
    <div style={{ position: "relative", display: "flex", width: vw * k, height: vh * k }}>
      <img src={src} width={vw * k} height={vh * k} alt="" style={{ position: "absolute", left: 0, top: 0 }} />
      {texts.map((t, i) => {
        const size = t.size * k;
        const family = t.mono ? "JetBrains Mono" : "Lexend";
        const weight = t.mono ? (t.weight >= 600 ? 600 : 400) : t.weight >= 500 ? 500 : 300;
        const box = 1200; // wide enough for any label; the anchor decides which edge sits on x
        const left = t.anchor === "start" ? t.x * k : t.anchor === "middle" ? t.x * k - box / 2 : t.x * k - box;
        return (
          <div
            key={i}
            style={{
              position: "absolute", display: "flex", left, top: t.y * k - (t.mono ? BASELINE.mono : BASELINE.sans) * size, width: box,
              justifyContent: t.anchor === "start" ? "flex-start" : t.anchor === "middle" ? "center" : "flex-end",
              fontFamily: family, fontSize: size, lineHeight: 1, fontWeight: weight, color: t.fill, whiteSpace: "pre",
            }}
          >
            {t.content}
          </div>
        );
      })}
    </div>
  );
}

// ---------------- route ----------------

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const slug = sp.get("estate");
  const unitId = sp.get("unit")?.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 16) ?? null;
  let e: EstateView | null = null, u: UnitView | null = null, ms: MilestoneView[] | null = null;
  const fonts = loadFonts();
  if (slug && unitId) {
    const acc = estateAccount(slug);
    [e, u, ms] = await Promise.all([withTimeout(E.getEstate(acc), 3500), withTimeout(E.getUnit(acc, unitId), 3500), withTimeout(E.getMilestones(acc), 3500)]);
  }
  const done = approvedCount(ms);
  const total = ms?.length || 4;
  const estateName = e?.name ?? (slug ? slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "Plote");
  const label = unitId ? unitId.toUpperCase() : "A-4B";
  const svg = houseSvg({ estateName, unitLabel: u?.label ?? (unitId ? "" : "Every unit, its own account"), unitId: unitId ?? "a-4b", approvedCount: unitId ? nftApprovedCount(ms) : 3, total, status: u?.status ?? (unitId ? "—" : "Allocated"), paid: u?.paid ?? "0", price: u?.price ?? "0" });
  const headline = unitId ? (u ? `${label} at ${estateName} is ${Math.round(u.progress_bps / 100)}% built` : `${label} at ${estateName}`) : "Pay for the house you can see.";
  const sub = unitId ? (ms ? `${done} of ${total} stages proven · every payment checked on-chain` : "Every stage of this home, with the proof behind each payment.") : "Every off-plan home gets its own on-chain account.";
  return new ImageResponse(
    (
      <div style={{ width: 1200, height: 630, display: "flex", backgroundColor: "#090909", backgroundImage: "radial-gradient(circle at 100% 100%, rgba(233,113,34,0.85) 0%, rgba(208,104,63,0.35) 30%, rgba(9,9,9,0) 60%), radial-gradient(circle at 0% 0%, rgba(81,209,255,0.35) 0%, rgba(9,9,9,0) 35%)", color: "#FFFFFF", padding: 56, fontFamily: "Lexend", fontWeight: 300 }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: 640 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <img src={MARK} width={56} height={56} alt="" />
            <span style={{ fontSize: 42, fontWeight: 500, letterSpacing: -0.4 }}>plote</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <span style={{ fontSize: 22, color: "#FD8D37", letterSpacing: 2, fontWeight: 500 }}>{unitId ? "WATCH MY HOUSE" : "OFF-PLAN ESCROW · BUILT ON NEAR"}</span>
            <span style={{ fontSize: 62, lineHeight: 1.08, fontWeight: 300 }}>{headline}</span>
            <span style={{ fontSize: 26, color: "#C9C9CE" }}>{sub}</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {Array.from({ length: total }).map((_, i) => (
              <div key={i} style={{ width: Math.min(120, (560 - (total - 1) * 8) / total), height: 10, borderRadius: 50, background: i < (unitId ? done : 3) ? "#FF9211" : "rgba(255,255,255,0.15)" }} />
            ))}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 450 }}>
          <NftCard svg={svg} width={430} />
        </div>
      </div>
    ),
    { width: 1200, height: 630, fonts: await fonts, headers: { "cache-control": "public, max-age=60, s-maxage=60" } },
  );
}
