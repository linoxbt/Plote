"use client";

import { FlaskConical, Snowflake, Timer } from "lucide-react";
import type { EstateView } from "@/lib/types";
import { formatDuration, nsToMs } from "@/lib/format";

export function PlaygroundBanner() {
  return (
    <div className="corners corners-amber flex items-start gap-3 bg-amber/5 p-3 text-sm" role="note">
      <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-amber" strokeWidth={1.5} aria-hidden />
      <p>
        <span className="mono font-semibold text-amber">PLAYGROUND</span> — a judge sandbox. Any wallet can act as surveyor, there&apos;s no
        geofence, and an AI stage mismatch is a warning, not a fail. Hash, reuse, screen-photo and challenge checks still fail hard.
      </p>
    </div>
  );
}

export function DemoBanner({ estate }: { estate: EstateView }) {
  const p = estate.params;
  return (
    <div className="corners corners-amber flex items-start gap-3 bg-amber/5 p-3 text-sm" role="note">
      <Timer className="mt-0.5 h-4 w-4 shrink-0 text-amber" strokeWidth={1.5} aria-hidden />
      <p>
        <span className="mono font-semibold text-amber">DEMO MODE</span> — short timers for the demo: veto window {formatDuration(nsToMs(p.veto_window_ns))}, grace{" "}
        {formatDuration(nsToMs(p.grace_ns))}, votes {formatDuration(nsToMs(p.proposal_period_ns))}. A NEAR AI outage counts as a warning.
      </p>
    </div>
  );
}

export function FrozenBanner({ estate }: { estate: EstateView }) {
  if (!estate.frozen) return null;
  return (
    <div className="corners corners-red flex items-start gap-3 bg-red/10 p-3 text-sm" role="alert">
      <Snowflake className="mt-0.5 h-4 w-4 shrink-0 text-red" strokeWidth={1.5} aria-hidden />
      <p>
        <span className="mono font-semibold text-red">FREEZE ACTIVE</span> — holders voted to stop releases: “{estate.frozen.reason}”.
        {estate.frozen.refunds_open ? " Refunds are open." : " Refunds open only after a missed deadline."}
      </p>
    </div>
  );
}

export function EstateBanners({ estate }: { estate: EstateView | undefined | null }) {
  if (!estate) return null;
  const any = estate.params.playground || estate.params.demo_mode || estate.frozen;
  if (!any) return null;
  return (
    <div className="mb-6 space-y-2">
      <FrozenBanner estate={estate} />
      {estate.params.playground ? <PlaygroundBanner /> : null}
      {estate.params.demo_mode ? <DemoBanner estate={estate} /> : null}
    </div>
  );
}
