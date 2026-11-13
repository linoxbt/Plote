"use client";

import Link from "next/link";
import { AccountChip, StatusBadge } from "@/components/chain";
import { Bar, BracketCard, ChainLink, Collapsible, EmptyState, LoadingCard, Page, PageHeader } from "@/components/ui";
import { estateSlug } from "@/lib/estates";
import { formatDate } from "@/lib/format";
import { useAllEstates, useAllMilestones } from "@/lib/hooks";
import { devScore, sumStats, type ScoreComponent } from "@/lib/score";
import type { DevStats } from "@/lib/types";
import { ScoreSources } from "./score-sources";

/** dev_stats keys behind each score component, so the raw counts can point at their per-estate sources. */
const INPUTS: Record<ScoreComponent["key"], (keyof DevStats)[]> = {
  on_time: ["milestones_on_time", "milestones_due"],
  refund_free: ["units_refunded", "units_sold"],
  clean_evidence: ["evidence_passed", "evidence_submitted"],
  no_vetoes: ["vetoes", "signoffs"],
  track_length: ["units_handed_over"],
};

function Dial({ score, isNew }: { score: number; isNew: boolean }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const v = isNew ? 0 : score / 100;
  return (
    <svg viewBox="0 0 128 128" className="h-40 w-40" role="img" aria-label={isNew ? "New on Plote, no score yet" : `Score ${score} out of 100`}>
      <circle cx="64" cy="64" r={r} stroke="rgba(255, 255, 255, 0.12)" strokeWidth="10" fill="none" />
      <circle cx="64" cy="64" r={r} stroke="var(--orange)" strokeWidth="10" fill="none" strokeDasharray={`${c * v} ${c}`} transform="rotate(-90 64 64)" />
      <text x="64" y={isNew ? 62 : 70} textAnchor="middle" fill="var(--text)" fontFamily="var(--font-geist-mono), monospace" fontSize={isNew ? 13 : 30}>{isNew ? "New on" : score}</text>
      {isNew ? <text x="64" y="80" textAnchor="middle" fill="var(--text)" fontFamily="var(--font-geist-mono), monospace" fontSize="13">Plote</text> : <text x="64" y="88" textAnchor="middle" fill="var(--muted)" fontFamily="var(--font-geist-mono), monospace" fontSize="10">/ 100</text>}
    </svg>
  );
}

export function DeveloperClient({ account }: { account: string }) {
  const all = useAllEstates();
  const ms = useAllMilestones();
  const loading = all.some((x) => x.q.isLoading);
  const mine = all.filter((x) => x.q.data?.developer_id === account);
  const stats = sumStats(mine.map((x) => x.q.data!.stats));
  const s = devScore(stats);
  return (
    <Page>
      <PageHeader eyebrow="DEVELOPER TRACK RECORD" title={<span className="mono break-all text-2xl sm:text-3xl">{account}</span>}>
        Computed in your browser from each estate&apos;s on-chain <span className="mono">dev_stats</span>, summed across every Plote estate this account develops. <ChainLink account={account} />
      </PageHeader>
      {loading ? <LoadingCard lines={5} /> : !mine.length ? (
        <EmptyState title="No Plote estates for this account">This account isn&apos;t the developer of any estate this deployment knows about.</EmptyState>
      ) : (
        <div className="space-y-6">
          <BracketCard className="grid items-center gap-6 sm:grid-cols-[auto_1fr]">
            <Dial score={s.score} isNew={s.isNew} />
            <div className="space-y-4">
              {s.isNew ? <p className="text-sm text-amber">Fewer than 4 milestones have come due, so there&apos;s no score yet. The components below are shown for transparency.</p> : null}
              {s.components.map((c) => (
                <div key={c.key} className="space-y-1">
                  <div className="flex justify-between text-sm"><span>{c.label} <span className="mono text-xs text-muted">({c.weight})</span></span><span className="mono">{c.points}</span></div>
                  <Bar value={c.ratio * 100} label={`${c.label}: ${Math.round(c.ratio * 100)}%`} />
                  <p className="mono text-xs text-muted">
                    {c.raw} · from{" "}
                    {mine.map(({ account: e, q }, i) => (
                      <span key={e}>
                        {i ? ", " : ""}
                        <a className="underline hover:text-orange-ink" href={`#sources-${estateSlug(e)}`}>{q.data!.name}</a>{" "}
                        <span className="text-muted/70">({INPUTS[c.key].map((k) => `${k} ${q.data!.stats[k]}`).join(" / ")})</span>
                      </span>
                    ))}
                  </p>
                </div>
              ))}
            </div>
          </BracketCard>
          <section className="space-y-3">
            <h2 className="text-2xl font-normal">Estates</h2>
            {mine.map(({ account: e, q }) => {
              const list = ms.find((m) => m.account === e)?.q.data ?? [];
              return (
                <BracketCard key={e} className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link href={`/estates/${estateSlug(e)}`} className="text-xl font-normal hover:text-orange-ink">{q.data!.name}</Link>
                    <AccountChip account={e} />
                  </div>
                  <ul className="grid gap-2 sm:grid-cols-4">
                    {list.map((m) => (
                      <li key={m.index} className="text-sm"><p>{m.title}</p><p className="mono text-xs text-muted">due {formatDate(m.deadline)}</p><StatusBadge kind="milestone" status={m.status} /></li>
                    ))}
                  </ul>
                  <ScoreSources estate={e} e={q.data!} milestones={list} />
                </BracketCard>
              );
            })}
          </section>
          <Collapsible title="How this score works">
            <table className="w-full text-left text-sm">
              <thead><tr><th className="label">Component</th><th className="label">Weight</th><th className="label">Formula</th></tr></thead>
              <tbody className="mono text-xs">
                <tr><td>On-time delivery</td><td>40</td><td>milestones approved by deadline ÷ milestones due</td></tr>
                <tr><td>Refund-free</td><td>25</td><td>1 − units refunded ÷ units sold</td></tr>
                <tr><td>Clean evidence</td><td>15</td><td>evidence passed ÷ evidence submitted</td></tr>
                <tr><td>No vetoes</td><td>10</td><td>1 − vetoed sign-offs ÷ sign-offs</td></tr>
                <tr><td>Track length</td><td>10</td><td>min(1, units handed over ÷ 20)</td></tr>
              </tbody>
            </table>
            <p className="mt-2">Fewer than 4 milestones due shows “New on Plote” instead of a score. Every input is the estate contract&apos;s <span className="mono">dev_stats</span> view; each estate card lists the proofs, milestones, units and transactions behind every number.</p>
          </Collapsible>
        </div>
      )}
    </Page>
  );
}
