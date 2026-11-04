"use client";

import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
import { clsx } from "clsx";
import { EstateBanners } from "@/components/banners";
import { CountdownChip, MonoAmount, StatusBadge } from "@/components/chain";
import { EstateHeader } from "@/components/estate-bits";
import { BracketCard, ErrorState, LoadingCard, Page } from "@/components/ui";
import { estateAccount, estateSlug } from "@/lib/estates";
import { bpsToPct, formatDate, formatDateTime, shareOf, toBig } from "@/lib/format";
import { useEstate, useEvidenceList, useMilestones, useUnits } from "@/lib/hooks";

export function MilestonesClient({ slug }: { slug: string }) {
  const account = estateAccount(slug);
  const est = useEstate(account);
  const ms = useMilestones(account, { poll: 15_000 });
  const evs = useEvidenceList(account, undefined, { poll: 15_000 });
  const units = useUnits(account);
  if (est.isLoading) return <Page><LoadingCard lines={6} /></Page>;
  if (!est.data) return <Page><ErrorState error={est.error} onRetry={() => est.refetch()} /></Page>;
  const e = est.data;
  const base = (units.data ?? []).reduce((n, u) => n + (toBig(u.paid) < toBig(u.price) ? toBig(u.paid) : toBig(u.price)), 0n);
  return (
    <Page>
      <EstateBanners estate={e} />
      <EstateHeader e={e} slug={estateSlug(account)} />
      <h2 className="mb-4 text-2xl font-semibold">Milestone timeline</h2>
      {ms.error ? <ErrorState error={ms.error} onRetry={() => ms.refetch()} /> : !ms.data ? <LoadingCard lines={5} /> : (
        <ol className="relative space-y-4 border-l border-line pl-6">
          {ms.data.map((m) => {
            const list = (evs.data ?? []).filter((x) => x.milestone === m.index);
            const done = m.status === "Approved" && m.veto_passed;
            return (
              <li key={m.index} className="relative">
                <span className="absolute -left-[33px] top-5 bg-bg" aria-hidden>
                  {done ? <CheckCircle2 className="h-4 w-4 text-teal" /> : <Circle className={clsx("h-4 w-4", m.status === "Missed" ? "text-red" : "text-muted")} />}
                </span>
                <BracketCard tone={done ? "teal" : m.status === "Missed" || m.status === "Vetoed" ? "red" : "default"} className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-xl font-semibold">{m.index + 1}. {m.title} <span className="mono text-sm text-muted">{bpsToPct(m.bps)}</span></h3>
                    <StatusBadge kind="milestone" status={m.status} />
                  </div>
                  <dl className="mono grid gap-2 text-sm sm:grid-cols-3">
                    <div><dt className="label">Deadline</dt><dd>{formatDate(m.deadline)}</dd></div>
                    <div><dt className="label">Refunds open</dt><dd>{formatDateTime(m.refunds_open_at)}</dd></div>
                    <div><dt className="label">QS sign-off</dt><dd>{m.signed_at ? formatDateTime(m.signed_at) : "—"}</dd></div>
                    <div><dt className="label">Verified</dt><dd>{m.verified_at ? formatDateTime(m.verified_at) : "—"}</dd></div>
                    <div>
                      <dt className="label">Veto window</dt>
                      <dd>{m.veto_until ? <CountdownChip until={m.veto_until} endedLabel="closed" /> : "—"}</dd>
                    </div>
                    <div>
                      <dt className="label">{done ? "Released share" : "Share when approved"}</dt>
                      <dd>{units.data ? <MonoAmount value={shareOf(base, m.bps).toString()} naira={false} account={account} /> : "—"}</dd>
                    </div>
                  </dl>
                  {list.length ? (
                    <ul className="flex flex-wrap gap-2">
                      {list.map((ev) => (
                        <li key={ev.id}>
                          <Link href={`/proof/${estateSlug(account)}/${ev.id}`} className="corners corners-hover flex items-center gap-2 bg-surface-2 p-1 pr-2">
                            <img src={ev.url} alt={`Evidence #${ev.id}`} className="h-12 w-16 object-cover" loading="lazy" />
                            <StatusBadge kind="evidence" status={ev.status} />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="text-sm text-muted">No photos submitted for this milestone yet.</p>}
                </BracketCard>
              </li>
            );
          })}
        </ol>
      )}
    </Page>
  );
}
