// The dynamic NFT image (SPEC §5.11 / S3), drawn the same way the contract draws it:
// an isometric house whose parts fill in teal per approved milestone
// (slab → walls → roof → windows lit gold at handover), status badge, mono unit label, progress n/total.
// Kept under 2 KB.

import { formatUsd } from "./format";
import type { UnitStatus } from "./types";

export type HouseSvgInput = {
  estateName: string;
  unitLabel: string; // shown in mono, e.g. "A-4B"
  unitId: string;
  approvedCount: number;
  total: number;
  status: UnitStatus | string;
  paid: string; // USDC base units
  price: string; // USDC base units
};

const BADGE: Record<string, [string, string]> = {
  Available: ["AVAILABLE", "#8B939D"],
  Reserved: ["RESERVED", "#8DD8FE"],
  Allocated: ["TAKEN", "#FF9211"],
  InDefault: ["IN DEFAULT", "#F06A6A"],
  HandedOver: ["HANDED OVER", "#FFD27A"],
};

function esc(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** How many of the 4 house parts are lit for `approved` of `total` milestones. */
export function litParts(approved: number, total: number, status?: string): number {
  if (status === "HandedOver") return 4;
  if (total <= 0) return 0;
  const a = Math.max(0, Math.min(approved, total));
  return Math.floor((a * 4) / total);
}

export function houseSvg(i: HouseSvgInput): string {
  const total = Math.max(1, Math.min(8, Math.floor(i.total) || 1));
  const done = Math.max(0, Math.min(total, Math.floor(i.approvedCount) || 0));
  const lit = litParts(done, total, i.status);
  // Status comes from the chain; an unknown value is shown, but escaped and bounded like every other string here.
  const [badge, bc] = BADGE[i.status] ?? [String(i.status).toUpperCase().slice(0, 16), "#8B939D"];
  const p = (n: number) => (lit > n ? "f" : "o");
  const win = lit >= 4 ? "g" : "o";
  const segW = (240 - (total - 1) * 4) / total;
  let segs = "";
  for (let k = 0; k < total; k++) {
    segs += `<rect class="${k < done ? "sf" : "se"}" x="${(30 + k * (segW + 4)).toFixed(1)}" y="262" width="${segW.toFixed(1)}" height="6"/>`;
  }
  const label = esc(i.unitLabel || i.unitId.toUpperCase());
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 330">` +
    `<style>.o{fill:none;stroke:#3A414B;stroke-width:1.5}.f{fill:#4A2A0C;stroke:#FF9211;stroke-width:1.5}.g{fill:#FFD27A}.sf{fill:#FF9211}.se{fill:#252A31}text{font-family:monospace;fill:#E9ECEF}</style>` +
    `<rect width="300" height="330" fill="#090909"/>` +
    `<path d="M10 26V10h16M274 10h16v16M290 304v16h-16M26 320H10v-16" stroke="#FF9211" stroke-width="2" fill="none"/>` +
    `<text x="24" y="36" font-size="13">${esc(i.estateName)}</text>` +
    `<rect x="${276 - badge.length * 7.4}" y="22" width="${badge.length * 7.4 + 8}" height="20" fill="none" stroke="${bc}"/>` +
    `<text x="${280 - badge.length * 7.4}" y="36" font-size="11" style="fill:${bc}">${esc(badge)}</text>` +
    `<path class="${p(0)}" d="M70 210l80 40 80-40v8l-80 40-80-40z"/>` +
    `<path class="${p(1)}" d="M70 140l80 40v70l-80-40zM150 180l80-40v70l-80 40z"/>` +
    `<path class="${p(2)}" d="M110 110l80-40 40 70-80 40zM70 140l40-30 40 70z"/>` +
    `<path class="${win}" d="M170 196l18-9v-18l-18 9zM202 180l18-9v-18l-18 9zM95 205l18 9v-24l-18-9z"/>` +
    segs +
    `<text x="30" y="294" font-size="26" font-weight="600">${label}</text>` +
    `<text x="270" y="294" font-size="16" text-anchor="end">${done}/${total}</text>` +
    `<text x="30" y="314" font-size="11" style="fill:#8B939D">${!i.price || i.price === "0" ? "—" : `${formatUsd(i.paid)} / ${formatUsd(i.price)}`}</text>` +
    `</svg>`
  );
}

export function houseSvgDataUri(i: HouseSvgInput): string {
  const svg = houseSvg(i);
  const bytes = new TextEncoder().encode(svg);
  let bin = "";
  for (let k = 0; k < bytes.length; k++) bin += String.fromCharCode(bytes[k]);
  const b64 = btoa(bin);
  return `data:image/svg+xml;base64,${b64}`;
}
