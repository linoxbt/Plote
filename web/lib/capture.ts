// Which milestone a surveyor can capture evidence for, and whether an existing capture can be reused
// (contract rules: open_capture / submit_evidence / qs_sign for milestone i need milestone i-1 Approved; captures
// open only for Open or Vetoed milestones, a Missed one is still Open on-chain; a capture belongs to whoever opened it).

import type { CaptureView, MilestoneView } from "./types";

/** A stuck check can be reopened this long after its latest evidence was submitted (reopen_stale_check). */
export const STALE_CHECK_MS = 3_600_000;
/** Stop polling for a verdict after this long and offer the stale-check path instead. */
export const VERDICT_POLL_TIMEOUT_MS = 10 * 60_000;

export type CaptureEligibility = { ok: true } | { ok: false; why: string };

export function captureEligibility(ms: MilestoneView[], index: number): CaptureEligibility {
  const m = ms.find((x) => x.index === index);
  if (!m) return { ok: false, why: "No such milestone." };
  if (m.status === "Checking") return { ok: false, why: "A photo for this milestone is being checked." };
  if (m.status === "Verified") return { ok: false, why: "Already verified: it's waiting for the surveyor's signature." };
  if (m.status === "Approved") return { ok: false, why: "Already approved." };
  if (!(m.status === "Open" || m.status === "Vetoed" || m.status === "Missed")) return { ok: false, why: `This milestone is ${m.status}.` };
  const prev = ms.find((x) => x.index === index - 1);
  if (prev && prev.status !== "Approved") return { ok: false, why: `${prev.title} must be approved first: milestones are proven in order.` };
  return { ok: true };
}

/** The milestone a surveyor should capture next, or null when none can be captured. */
export function nextCapturable(ms: MilestoneView[]): MilestoneView | null {
  return ms.find((m) => captureEligibility(ms, m.index).ok) ?? null;
}

export type CaptureReuse =
  | { action: "reuse" }
  | { action: "open" }
  | { action: "blocked"; by: string; until: string };

/**
 * What to do with the capture already stored for a milestone: reuse it only if `me` opened it and it has at least
 * `minLeftMs` to run; open a new one if there's none, it expired, or it's mine but nearly over; when another account's
 * capture is live, only the estate surveyor may replace it (on the playground), so anyone else is blocked until it ends.
 */
export function captureReuse(existing: CaptureView | null, me: string | null, nowMs: number, opts: { surveyorId: string; minLeftMs?: number }): CaptureReuse {
  if (!existing) return { action: "open" };
  const left = Number(BigInt(existing.expires_at) / 1_000_000n) - nowMs;
  if (left <= 0) return { action: "open" };
  if (existing.by === me) return left > (opts.minLeftMs ?? 5 * 60_000) ? { action: "reuse" } : { action: "open" };
  if (me && me === opts.surveyorId) return { action: "open" };
  return { action: "blocked", by: existing.by, until: existing.expires_at };
}
