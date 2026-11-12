"use client";

import { AlertOctagon, FlaskConical, Snowflake, Timer } from "lucide-react";
import type { EstateView } from "@/lib/types";
import { formatDuration, nsToMs } from "@/lib/format";
import { useGenuineEstate } from "@/lib/hooks";

export function PlaygroundBanner() {
  return (
    <div className="corners corners-amber flex items-start gap-3 bg-amber/5 p-3 text-sm" role="note">
      <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-amber" strokeWidth={1.5} aria-hidden />
      <p>
        <span className="mono font-normal text-amber">PLAYGROUND</span> — a judge sandbox. Any wallet can act as surveyor, there&apos;s no
        geofence, and an AI stage mismatch is a warning, not a fail. Hash, reuse, screen-photo and challenge checks still fail hard.
      </p>
    </div>
  );
}

export function DemoBanner({ estate }: { estate: EstateView }) {
  const p = estate.params;
  return (
    <div className="corners corners-info flex items-start gap-3 bg-info/5 p-3 text-sm" role="note">
      <Timer className="mt-0.5 h-4 w-4 shrink-0 text-info" strokeWidth={1.5} aria-hidden />
      <p>
        <span className="mono font-normal text-info">DEMO MODE</span> — short timers for the demo: veto window {formatDuration(nsToMs(p.veto_window_ns))}, grace{" "}
        {formatDuration(nsToMs(p.grace_ns))}, votes {formatDuration(nsToMs(p.proposal_period_ns))}. A NEAR AI outage is only a warning, but the challenge code must still be read from the photo, so it can fail the check.
      </p>
    </div>
  );
}

/** The refund sentence for a frozen estate: `refunds_open` is the estate-wide truth (freeze with refunds, or a miss). */
export function frozenRefundText(estate: Pick<EstateView, "frozen" | "refunds_open">): string {
  if (estate.frozen?.refunds_open) return " Holders also opened refunds: every holder can take back what hasn't been released.";
  if (estate.refunds_open) return " Refunds are open anyway, because a milestone deadline passed without a timely sign-off.";
  return " Refunds aren't open: they open if a milestone deadline plus its grace period passes, or if holders vote a freeze with refunds.";
}

export function FrozenBanner({ estate }: { estate: EstateView }) {
  if (!estate.frozen) return null;
  return (
    <div className="corners corners-red flex items-start gap-3 bg-red/10 p-3 text-sm" role="alert">
      <Snowflake className="mt-0.5 h-4 w-4 shrink-0 text-red" strokeWidth={1.5} aria-hidden />
      <p>
        <span className="mono font-normal text-red">FREEZE ACTIVE</span> — holders voted to stop releases: “{estate.frozen.reason}”.
        {frozenRefundText(estate)}
      </p>
    </div>
  );
}

/** Red warning when the account in the URL isn't a genuine Plote estate (see lib/genuine.ts). */
export function NotGenuineBanner({ account }: { account: string }) {
  const g = useGenuineEstate(account);
  if (!g.data || g.data.genuine) return null;
  return (
    <div className="corners corners-red flex items-start gap-3 bg-red/10 p-3 text-sm" role="alert">
      <AlertOctagon className="mt-0.5 h-4 w-4 shrink-0 text-red" strokeWidth={1.5} aria-hidden />
      <p>
        <span className="mono font-normal text-red">NOT A PLOTE ESTATE</span> — {g.data.why} Whatever this contract reports is not checked by Plote, and
        this site won&apos;t send it money.
      </p>
    </div>
  );
}

export function EstateBanners({ estate, account }: { estate: EstateView | undefined | null; account?: string }) {
  if (!estate) return account ? <div className="mb-6 empty:hidden"><NotGenuineBanner account={account} /></div> : null;
  const any = estate.params.playground || estate.params.demo_mode || estate.frozen || account;
  if (!any) return null;
  return (
    <div className="mb-6 space-y-2 empty:hidden">
      {account ? <NotGenuineBanner account={account} /> : null}
      <FrozenBanner estate={estate} />
      {estate.params.playground ? <PlaygroundBanner /> : null}
      {estate.params.demo_mode ? <DemoBanner estate={estate} /> : null}
    </div>
  );
}
