// The allocation NFT image (SPEC §5.11): a byte-for-byte port of `unit_svg` in contracts/estate/src/svg.rs, so the
// site draws exactly what the contract serves as `metadata.media`. An isometric house whose parts fill in brand
// orange as milestones are approved (slab → walls + roof → windows; windows gold when all are), a status badge, the
// mono unit id, progress n/total, the unit label and paid / price.
// tests/unit/svg-house.test.ts compares this with fixtures the Rust test `svg_fixtures_for_web` writes
// (tests/unit/fixtures/svg-house.json). Change both together.

import type { UnitStatus } from "./types";

export type HouseSvgInput = {
  estateName: string;
  /** The unit's label (`UnitView.label`, e.g. "Block A · Unit 4B · 3-bed"); the contract draws `unit.label` here. */
  unitLabel: string;
  unitId: string;
  /** Approved milestones as the contract counts them for the image (`nftApprovedCount` in lib/estate.ts). */
  approvedCount: number;
  total: number;
  status: UnitStatus | string;
  paid: string; // USDC base units
  price: string; // USDC base units
};

// Brand tokens, as in svg.rs.
const BG = "#090909";
const LINE = "#2a2a2e";
const TEXT = "#ffffff";
const MUTED = "#a3a3a8";
const ORANGE = "#FF9211";
const DIM = "#4A2A0C";
const GOLD = "#FFD27A";
const RED = "#f26b5b";
const SANS = "Lexend,sans-serif";
const U32_MAX = 4294967295;

/** svg.rs `status_text`. */
const STATUS_TEXT: Record<string, string> = {
  Available: "AVAILABLE",
  Reserved: "RESERVED",
  Allocated: "ALLOCATED",
  InDefault: "IN DEFAULT",
  HandedOver: "HANDED OVER",
};

const ENTITIES: Record<string, string> = { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" };

/** svg.rs `esc`: the first 40 characters (Unicode scalar values), HTML-escaped. */
function esc(s: string): string {
  return Array.from(String(s))
    .slice(0, 40)
    .map((c) => ENTITIES[c] ?? c)
    .join("");
}

/** A JS number as the contract's u32 (non-negative integer, saturating). */
function u32(n: number): number {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) ? Math.max(0, Math.min(U32_MAX, v)) : 0;
}

function big(s: string): bigint {
  try {
    const v = BigInt(String(s).trim() || "0");
    return v < 0n ? 0n : v;
  } catch {
    return 0n;
  }
}

/** svg.rs `dollars`: USDC base units → "$12,345" (whole dollars, rounded down). */
export function dollars(baseUnits: string): string {
  const d = (big(baseUnits) / 1_000_000n).toString();
  let out = "";
  for (let i = 0; i < d.length; i++) {
    if (i > 0 && (d.length - i) % 3 === 0) out += ",";
    out += d[i];
  }
  return `$${out}`;
}

/** How many of the 4 house parts are lit for `approved` of `total` milestones (svg.rs `stage`). The contract draws
 *  progress only, whatever the unit's status. */
export function litParts(approved: number, total: number): number {
  const a = u32(approved);
  const t = u32(total);
  if (t === 0) return 0;
  return Math.min(4, Math.ceil(Math.min(a * 4, U32_MAX) / t));
}

function part(filled: boolean): string {
  return filled ? `fill='${DIM}' stroke='${ORANGE}'` : `fill='none' stroke='${LINE}' stroke-dasharray='4 3'`;
}

function statusColor(status: string): string {
  if (status === "IN DEFAULT") return RED;
  if (status === "HANDED OVER") return GOLD;
  if (status === "AVAILABLE") return MUTED;
  return ORANGE;
}

export function houseSvg(i: HouseSvgInput): string {
  const approved = u32(i.approvedCount);
  const total = u32(i.total);
  const st = litParts(approved, total);
  const slab = part(st >= 1);
  const body = part(st >= 2);
  const roof = part(st >= 2);
  const win =
    st >= 4 ? `fill='${GOLD}' stroke='${GOLD}'` : st >= 3 ? `fill='${ORANGE}' stroke='${ORANGE}'` : `fill='none' stroke='${LINE}'`;
  let bar = "";
  const w = Math.floor(280 / Math.max(1, Math.min(8, total)));
  for (let k = 0; k < Math.min(8, total); k++) {
    const fill = k < approved ? ORANGE : LINE;
    bar += `<rect x='${60 + k * w}' y='338' width='${w - 4}' height='6' rx='3' fill='${fill}'/>`;
  }
  // Status comes from the chain; an unknown value is shown, but escaped and bounded like every other string here.
  const statusText = STATUS_TEXT[i.status] ?? String(i.status).toUpperCase();
  const status = esc(statusText);
  const sc = statusColor(statusText);
  const bw = Math.min(Array.from(statusText).length, 40) * 7 + 16;
  const bx = Math.max(0, 372 - bw);
  const tx = Math.max(0, 372 - Math.floor(bw / 2));
  return (
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 400'><rect width='400' height='400' fill='${BG}'/>` +
    `<rect x='12' y='12' width='376' height='376' rx='16' fill='none' stroke='${LINE}'/>` +
    `<path d='M12 28V12h16M372 12h16v16M388 372v16h-16M28 388H12v-16' fill='none' stroke='${ORANGE}' stroke-width='1.5'/>` +
    `<text x='28' y='46' fill='${TEXT}' font-family='${SANS}' font-size='16'>${esc(i.estateName)}</text>` +
    `<rect x='${bx}' y='30' width='${bw}' height='22' rx='11' fill='none' stroke='${sc}'/>` +
    `<text x='${tx}' y='45' fill='${sc}' font-family='monospace' font-size='11' text-anchor='middle'>${status}</text>` +
    `<g stroke-width='1.5'><path d='M80 250l120 60 120-60-120-60z' ${slab}/>` +
    `<path d='M110 245l90 45v-90l-90-45z' ${body}/><path d='M200 290l90-45v-90l-90 45z' ${body}/>` +
    `<path d='M105 158l95 47v-95z' ${roof}/><path d='M200 205l95-47-95-48z' ${roof}/>` +
    `<path d='M128 222l22 11v-22l-22-11zM162 239l22 11v-22l-22-11zM220 252l22-11v-22l-22 11zM254 235l22-11v-22l-22 11z' ${win}/></g>` +
    `<text x='60' y='326' fill='${TEXT}' font-family='monospace' font-size='18'>${esc(String(i.unitId).toUpperCase())}</text>` +
    `<text x='340' y='326' fill='${MUTED}' font-family='monospace' font-size='12' text-anchor='end'>${approved}/${total}</text>${bar}` +
    `<text x='60' y='366' fill='${MUTED}' font-family='${SANS}' font-size='11'>${esc(i.unitLabel)}</text>` +
    `<text x='340' y='366' fill='${TEXT}' font-family='monospace' font-size='11' text-anchor='end'>${dollars(i.paid)} / ${dollars(i.price)}</text></svg>`
  );
}

/** svg.rs `data_uri`: base64 of the UTF-8 bytes. */
export function houseSvgDataUri(i: HouseSvgInput): string {
  const svg = houseSvg(i);
  const bytes = new TextEncoder().encode(svg);
  let bin = "";
  for (let k = 0; k < bytes.length; k++) bin += String.fromCharCode(bytes[k]);
  const b64 = btoa(bin);
  return `data:image/svg+xml;base64,${b64}`;
}
