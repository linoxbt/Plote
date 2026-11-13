"use client";

import { AlertOctagon, FlaskConical, Snowflake, Timer } from "lucide-react";
import type { EstateView } from "@/lib/types";
import { formatDuration, nsToMs } from "@/lib/format";
import { useGenuineEstate } from "@/lib/hooks";

/** One slim line for the testnet demo settings (both are fixed in the estate contract); details on tap. */
export function DemoNotice({ estate }: { estate: EstateView }) {
  const p = estate.params;
  const tags = [p.playground ? "Judge sandbox" : null, p.demo_mode ? "Short demo timers" : null].filter(Boolean).join(" · ");
  return (
    <details className="group rounded-full border border-line bg-white/70 px-4 py-1.5 text-xs text-muted open:rounded-2xl open:py-3">
      <summary className="flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
        <FlaskConical className="h-3.5 w-3.5 shrink-0 text-orange-ink" strokeWidth={1.75} aria-hidden />
        <span>
          <span className="mono uppercase tracking-wider text-ink">Testnet</span> · {tags}
        </span>
        <span className="ml-auto text-orange-ink underline-offset-2 group-open:hidden hover:underline">Details</span>
      </summary>
      <div className="mt-2 space-y-1.5 pl-5.5 text-[13px] leading-relaxed">
        {p.playground ? (
          <p>
            Judge sandbox: any wallet can act as surveyor and there&apos;s no location fence, so you can try the photo check from anywhere. A stage
            mismatch is a warning here; hash, reuse, screen-photo and code checks still fail hard.
          </p>
        ) : null}
        {p.demo_mode ? (
          <p>
            <Timer className="mr-1 inline h-3.5 w-3.5 align-[-2px] text-info" strokeWidth={1.75} aria-hidden />
            Short timers so you can watch it happen: veto window {formatDuration(nsToMs(p.veto_window_ns))}, grace {formatDuration(nsToMs(p.grace_ns))}, votes{" "}
            {formatDuration(nsToMs(p.proposal_period_ns))}. Real estates use days. The code in the photo must still be read, so a check can fail.
          </p>
        ) : null}
      </div>
    </details>
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
      {estate.params.playground || estate.params.demo_mode ? <DemoNotice estate={estate} /> : null}
    </div>
  );
}
