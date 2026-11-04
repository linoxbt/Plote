// Developer track-record score (SPEC §10 S7), computed from on-chain `dev_stats` summed across estates.

import type { DevStats } from "./types";

export type ScoreComponent = {
  key: "on_time" | "refund_free" | "clean_evidence" | "no_vetoes" | "track_length";
  label: string;
  weight: number;
  ratio: number; // 0..1
  points: number; // ratio × weight
  raw: string; // "3 of 4 milestones on time"
};

export type DevScore = {
  isNew: boolean; // fewer than 4 milestones due → "New on Plote"
  score: number; // 0..100
  components: ScoreComponent[];
  stats: DevStats;
};

export const EMPTY_STATS: DevStats = {
  milestones_due: 0, milestones_on_time: 0, units_sold: 0, units_refunded: 0,
  evidence_submitted: 0, evidence_passed: 0, signoffs: 0, vetoes: 0, units_handed_over: 0,
};

export function sumStats(list: DevStats[]): DevStats {
  const out = { ...EMPTY_STATS };
  for (const s of list) for (const k of Object.keys(out) as (keyof DevStats)[]) out[k] += Number(s?.[k] ?? 0);
  return out;
}

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);

export function devScore(stats: DevStats): DevScore {
  const s = stats;
  const comps: ScoreComponent[] = [
    {
      key: "on_time", label: "On-time delivery", weight: 40,
      ratio: s.milestones_due > 0 ? clamp01(s.milestones_on_time / s.milestones_due) : 0,
      points: 0, raw: `${s.milestones_on_time} of ${s.milestones_due} milestones approved by deadline`,
    },
    {
      key: "refund_free", label: "Refund-free", weight: 25,
      ratio: s.units_sold > 0 ? clamp01(1 - s.units_refunded / s.units_sold) : 1,
      points: 0, raw: `${s.units_refunded} of ${s.units_sold} units refunded`,
    },
    {
      key: "clean_evidence", label: "Clean evidence", weight: 15,
      ratio: s.evidence_submitted > 0 ? clamp01(s.evidence_passed / s.evidence_submitted) : 0,
      points: 0, raw: `${s.evidence_passed} of ${s.evidence_submitted} photos passed`,
    },
    {
      key: "no_vetoes", label: "No vetoes", weight: 10,
      ratio: s.signoffs > 0 ? clamp01(1 - s.vetoes / s.signoffs) : 1,
      points: 0, raw: `${s.vetoes} of ${s.signoffs} sign-offs vetoed`,
    },
    {
      key: "track_length", label: "Track length", weight: 10,
      ratio: clamp01(s.units_handed_over / 20),
      points: 0, raw: `${s.units_handed_over} units handed over (20 = full marks)`,
    },
  ];
  for (const c of comps) c.points = Math.round(c.ratio * c.weight * 10) / 10;
  const score = Math.round(comps.reduce((n, c) => n + c.ratio * c.weight, 0));
  return { isNew: s.milestones_due < 4, score, components: comps, stats: s };
}
