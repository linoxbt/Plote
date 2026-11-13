"use client";

// Landing page sections ("plain numbers"). Every figure here is read live from the estate contracts on NEAR through the
// existing typed views and TanStack Query caches (same keys as lib/hooks.ts, so inner pages reuse them). Nothing is
// invented: when the chain hasn't answered a value shows "—", and when there's no data yet a section says so.

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { ArrowRight, BadgeCheck, Check, CheckCircle2, Clock, Lock, RotateCcw, ShieldCheck } from "lucide-react";
import { APP_URL, ESTATES, IS_MAINNET, ONECLICK_ENABLED } from "@/lib/config";
import { approvedCount, checkedViews as V, estate as E, nftApprovedCount } from "@/lib/estate";
import { DEMO_ESTATE, estateSlug, unitAccount } from "@/lib/estates";
import { bpsToPct, countdown, formatDuration, formatUsd, nsToMs, pct, timeAgo, toBig, truncateAccount, unitDisplay } from "@/lib/format";
import { listAllUnits, useAllEstates, useAllMilestones, useEstate, useMilestones, useNow, useUnit } from "@/lib/hooks";
import { chainName, oneclick, PICKER_CHAINS, STABLE_SYMBOLS } from "@/lib/oneclick";
import type { EstateView, EvidenceView, MilestoneView, UnitView } from "@/lib/types";
import { StatusBadge } from "./chain";
import { CheckChip, CheckInput, type CheckOutcome } from "./check";
import { EvidenceThumb } from "./evidence-image";
import { HouseNFT } from "./house-nft";
import { CountUp, usePrefersReducedMotion } from "./motion";
import { ArrowDot } from "./site";
import { BracketCard, ChainLink, LinkButton } from "./ui";

const NET = IS_MAINNET ? "mainnet" : "testnet";

// ---------------- shared live data ----------------

type EstateData = {
  account: string;
  slug: string;
  e: EstateView | undefined;
  ms: MilestoneView[] | undefined;
  units: UnitView[] | undefined;
  evidence: EvidenceView[] | undefined;
  loading: boolean;
  failed: boolean;
};

/** Estate, milestones, units and evidence for every configured estate (cached; shared with the inner pages' hooks). */
export function useLandingData(): EstateData[] {
  const estates = useAllEstates();
  const ms = useAllMilestones();
  const units = useQueries({
    queries: ESTATES.map((e) => ({ queryKey: ["units", e], queryFn: () => listAllUnits(e), retry: 1, staleTime: 30_000 })),
  });
  const evidence = useQueries({
    queries: ESTATES.map((e) => ({ queryKey: ["evidence-list", e, "all"], queryFn: () => V.listEvidence(e, { limit: 50 }), retry: 1, staleTime: 30_000 })),
  });
  return ESTATES.map((account, i) => ({
    account,
    slug: estateSlug(account),
    e: estates[i]?.q.data,
    ms: ms[i]?.q.data,
    units: units[i]?.data,
    evidence: evidence[i]?.data,
    loading: !!estates[i]?.q.isLoading,
    failed: !!estates[i]?.q.error,
  }));
}

const cmpBig = (a: bigint, b: bigint) => (a > b ? 1 : a < b ? -1 : 0);

/** The unit an estate is shown by: the sold unit with the most paid in (else the first unit). */
function featuredUnit(units: UnitView[] | undefined): UnitView | null {
  if (!units?.length) return null;
  const sold = units.filter((u) => u.status === "Allocated" || u.status === "HandedOver" || u.status === "InDefault");
  const pool = sold.length ? sold : units;
  return [...pool].sort((a, b) => cmpBig(toBig(b.paid), toBig(a.paid)))[0] ?? null;
}

/** USDC still sitting in a unit's account for the holder: paid in, minus released and refunded out. */
function heldIn(u: UnitView): bigint {
  const v = toBig(u.paid) - toBig(u.released) - toBig(u.refunded_out);
  return v > 0n ? v : 0n;
}

function estateTag(slug: string): string {
  if (slug === "playground") return "Judge sandbox";
  if (slug === "baobab-heights") return "Refund demo";
  return "Demo estate";
}

function prettyName(d: EstateData): string {
  return d.e?.name ?? d.slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function Dash() {
  return (
    <span>
      <span aria-hidden>—</span>
      <span className="sr-only">not available</span>
    </span>
  );
}

function LiveValue({ v, loading, className }: { v: string | null; loading: boolean; className?: string }) {
  if (loading && v === null) return <span className={clsx("skeleton inline-block h-[0.9em] w-16 align-middle", className)} />;
  return v === null ? <Dash /> : <CountUp value={v} />;
}

/** Totals across the configured estates; null = not known yet. */
export function useLiveTotals() {
  const estates = useAllEstates();
  const ms = useAllMilestones();
  const okE = estates.filter((x) => x.q.data);
  const okM = ms.filter((x) => x.q.data);
  const sum = (f: (e: EstateView) => bigint) => (okE.length ? okE.reduce((n, x) => n + f(x.q.data!), 0n) : null);
  const lastVerified = okM
    .flatMap((x) => (x.q.data ?? []).map((m) => m.verified_at))
    .filter((t): t is string => !!t)
    .sort((a, b) => cmpBig(toBig(b), toBig(a)))[0];
  return {
    loading: estates.some((x) => x.q.isLoading),
    link: okE[0]?.account ?? DEMO_ESTATE,
    units: okE.length ? okE.reduce((n, x) => n + (x.q.data?.unit_count ?? 0), 0) : null,
    allocated: okE.length ? okE.reduce((n, x) => n + (x.q.data?.allocated_count ?? 0), 0) : null,
    escrow: sum((e) => toBig(e.totals.in_escrow)),
    released: sum((e) => toBig(e.totals.released)),
    refunded: sum((e) => toBig(e.totals.refunded)),
    verified: okM.length ? okM.reduce((n, x) => n + (x.q.data ?? []).filter((m) => m.status === "Verified" || m.status === "Approved").length, 0) : null,
    proofsPassed: okE.length ? okE.reduce((n, x) => n + (x.q.data?.stats.evidence_passed ?? 0), 0) : null,
    proofsSubmitted: okE.length ? okE.reduce((n, x) => n + (x.q.data?.stats.evidence_submitted ?? 0), 0) : null,
    refunds: okE.length ? okE.reduce((n, x) => n + (x.q.data?.stats.units_refunded ?? 0), 0) : null,
    lastVerified: lastVerified ?? null,
    readAt: okE[0]?.q.data?.now ?? null,
  };
}

// ---------------- stage bar ----------------

function stageTone(m: MilestoneView): string {
  if (m.status === "Approved" && m.veto_passed) return "bg-accent";
  if (m.status === "Approved" || m.status === "Verified" || m.status === "Checking") return "bg-orange";
  if (m.status === "Missed" || m.status === "Vetoed") return "bg-red/70";
  return "bg-surface-2";
}

/** One segment per milestone, sized by its share: green = released, orange = proven (veto window / checking), red = missed. */
export function StageBar({ ms, className }: { ms: MilestoneView[] | undefined; className?: string }) {
  if (!ms?.length) return <div className={clsx("skeleton h-2 w-full rounded-full", className)} aria-hidden />;
  const done = approvedCount(ms);
  return (
    <div className={clsx("flex h-2 w-full gap-1", className)} role="img" aria-label={`${done} of ${ms.length} stages proven and released`}>
      {ms.map((m) => (
        <span key={m.index} className={clsx("h-full rounded-full ring-1 ring-inset ring-line", stageTone(m))} style={{ flexGrow: m.bps, flexBasis: 0 }} title={`${m.title} · ${bpsToPct(m.bps)} · ${m.status}`} />
      ))}
    </div>
  );
}

function stageLine(ms: MilestoneView[] | undefined): string {
  if (!ms?.length) return "Stages loading";
  const done = approvedCount(ms);
  const inVeto = ms.filter((m) => m.status === "Approved" && !m.veto_passed).length;
  return `Stage ${done} of ${ms.length} proven${inVeto ? ` · ${inVeto} in veto window` : ""}`;
}

// ---------------- hero ----------------

/** Hero status pill: when the numbers on this page were read from the chain. */
export function LiveReadPill() {
  const t = useLiveTotals();
  const at = t.readAt ? new Date(nsToMs(t.readAt)) : null;
  return (
    <p className="inline-flex items-center gap-2 rounded-full bg-surface px-3.5 py-1.5 text-[13px] text-text ring-1 ring-line" aria-live="polite">
      <span className="live-dot h-2 w-2 rounded-full bg-accent" aria-hidden />
      {at ? (
        <span suppressHydrationWarning>
          Read from NEAR {NET} at {at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
        </span>
      ) : (
        <span>Live from NEAR {NET}</span>
      )}
    </p>
  );
}

/** The hero's right side: estate tabs, the unit's live token image on a calm panel, and the floating unit card. */
export function HeroUnit() {
  const data = useLandingData();
  const [picked, setPicked] = useState<string | null>(null);
  const current = data.find((d) => d.account === picked) ?? data.find((d) => d.account === DEMO_ESTATE) ?? data[0];
  if (!current) return null;
  const u = featuredUnit(current.units);
  const ms = current.ms;
  const lastVerified = (ms ?? []).filter((m) => m.verified_at).sort((a, b) => cmpBig(toBig(b.verified_at), toBig(a.verified_at)))[0];
  const missed = (ms ?? []).find((m) => m.late || m.status === "Missed");
  const chip = current.e?.refunds_open && missed
    ? { icon: <RotateCcw className="h-3.5 w-3.5 text-red" aria-hidden />, text: `${missed.title} missed · refunds open` }
    : lastVerified
      ? { icon: <CheckCircle2 className="h-3.5 w-3.5 text-accent" aria-hidden />, text: `${lastVerified.title} verified ${timeAgo(lastVerified.verified_at)}` }
      : ms
        ? { icon: <Clock className="h-3.5 w-3.5 text-muted" aria-hidden />, text: `Next: ${ms.find((m) => m.status === "Open")?.title ?? "—"}` }
        : null;

  return (
    <div className="relative lg:h-[600px]">
      {/* calm panel with the token */}
      <div className="survey-grid relative overflow-hidden rounded-[28px] bg-gradient-to-br from-[#e7edf5] to-[#f6f8fb] ring-1 ring-line max-lg:aspect-[5/4] lg:absolute lg:inset-y-0 lg:left-14 lg:right-0">
        <div className="absolute inset-x-3 top-3 flex flex-wrap items-start justify-between gap-2 sm:inset-x-4 sm:top-4">
          <div className="flex flex-wrap gap-1 rounded-full bg-surface/80 p-1 ring-1 ring-line backdrop-blur" role="group" aria-label="Show an estate">
            {data.map((d) => (
              <button
                key={d.account}
                type="button"
                aria-pressed={d.account === current.account}
                onClick={() => setPicked(d.account)}
                className={clsx(
                  "min-h-9 rounded-full px-3 text-[13px] transition-colors",
                  d.account === current.account ? "bg-surface font-medium text-text shadow-sm ring-1 ring-line" : "text-muted hover:text-text",
                )}
              >
                {prettyName(d).replace(/^Plote /, "")}
              </button>
            ))}
          </div>
          {chip ? (
            <span className="hidden items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-[13px] text-text ring-1 ring-line sm:inline-flex">
              {chip.icon} {chip.text}
            </span>
          ) : null}
        </div>
        <div className="absolute bottom-0 right-4 top-16 flex w-[52%] items-center justify-center sm:right-8 lg:right-10 lg:top-20 lg:w-[58%]">
          {u && current.e ? (
            <HouseNFT
              className="w-full max-w-[300px] rounded-2xl shadow-[var(--shadow-float)]"
              estateName={current.e.name}
              unitLabel={u.label}
              unitId={u.id}
              approvedCount={nftApprovedCount(ms)}
              total={ms?.length || 4}
              status={u.status}
              paid={u.paid}
              price={u.price}
            />
          ) : (
            <div className="skeleton aspect-[10/11] w-full max-w-[300px] rounded-2xl" aria-hidden />
          )}
        </div>
      </div>

      {/* floating unit card */}
      <div className="float-card relative z-10 mx-3 -mt-24 p-5 sm:mx-auto sm:max-w-[380px] sm:p-6 lg:absolute lg:bottom-8 lg:left-0 lg:mx-0 lg:mt-0 lg:w-[360px]">
        <UnitCardBody d={current} u={u} />
      </div>
    </div>
  );
}

function UnitCardBody({ d, u }: { d: EstateData; u: UnitView | null }) {
  if (!u) {
    return (
      <div className="space-y-3" aria-busy={d.loading}>
        <p className="eyebrow">Unit card</p>
        {d.failed ? (
          <p className="text-sm text-muted">Couldn&apos;t read {d.slug} from NEAR just now. Nothing on this card is made up, so it stays empty.</p>
        ) : (
          <>
            <div className="skeleton h-10 w-2/3" />
            <div className="skeleton h-4 w-full" />
            <div className="skeleton h-4 w-5/6" />
          </>
        )}
      </div>
    );
  }
  const href = `/estates/${d.slug}/units/${u.id}`;
  const rows: [string, string, string?][] = [
    ["Held in the unit's account", formatUsd(heldIn(u))],
    ["Released to developer", formatUsd(u.released), `${pct(u.released, u.price)}% of price`],
    ["Refundable right now", formatUsd(u.refundable_now)],
  ];
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted">
            Unit {unitDisplay(u.id)} · {d.slug}
          </p>
          <p className="mt-0.5 truncate text-[13px] text-muted">{u.label}</p>
        </div>
        <StatusBadge status={u.status} />
      </div>
      <div>
        <p className="flex items-baseline gap-2">
          <span className="text-[40px] font-medium leading-none tracking-[-0.04em] tabular-nums sm:text-[44px]">{formatUsd(u.paid)}</span>
          <span className="text-sm text-muted">paid in</span>
        </p>
        <p className="mt-1 text-[13px] text-muted">of {formatUsd(u.price)} · {pct(u.paid, u.price)}% of the price</p>
      </div>
      <dl className="space-y-2 border-t border-line pt-3 text-sm">
        {rows.map(([k, v, hint]) => (
          <div key={k} className="flex items-baseline justify-between gap-3">
            <dt className="text-muted">{k}</dt>
            <dd className="font-medium tabular-nums">
              {v}
              {hint ? <span className="sr-only"> ({hint})</span> : null}
            </dd>
          </div>
        ))}
      </dl>
      <div className="space-y-2">
        <StageBar ms={d.ms} />
        <div className="flex items-center justify-between gap-2 text-[13px]">
          <span className="text-text">{stageLine(d.ms)}</span>
          <Link href={href} className="inline-flex min-h-8 items-center gap-1 font-medium text-orange-ink hover:underline">
            Open <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            <span className="sr-only">unit {unitDisplay(u.id)}</span>
          </Link>
        </div>
      </div>
    </div>
  );
}

export function HeroCheck() {
  const [o, setO] = useState<CheckOutcome | null>(null);
  return (
    <div className="space-y-3">
      <CheckInput onResult={setO} id="hero-check" />
      <div aria-live="polite" className="min-h-11">
        {o ? <CheckChip o={o} /> : null}
      </div>
    </div>
  );
}

// ---------------- ticker ----------------

/** The thin live strip under the hero: escrow totals across the configured estates, scrolling (static under reduced motion). */
export function LiveTicker() {
  const t = useLiveTotals();
  const now = useNow(60_000);
  const items: [string, string | null][] = [
    ["USDC in escrow", t.escrow === null ? null : formatUsd(t.escrow)],
    ["Released to developers", t.released === null ? null : formatUsd(t.released)],
    ["Refunded to holders", t.refunded === null ? null : formatUsd(t.refunded)],
    ["Units on Plote", t.units === null ? null : String(t.units)],
    ["Units allocated", t.allocated === null ? null : String(t.allocated)],
    ["Proofs verified", t.proofsPassed === null ? null : String(t.proofsPassed)],
    ["Last stage verified", t.loading ? null : t.lastVerified ? timeAgo(t.lastVerified, now) : "none yet"],
  ];
  const row = (dup: boolean) => (
    <ul className="flex shrink-0 items-center" aria-hidden={dup || undefined}>
      {items.map(([k, v]) => (
        <li key={k} className="flex items-center gap-2.5 whitespace-nowrap px-6 text-[15px]">
          <span className="text-muted">{k}</span>
          <span className="font-medium tabular-nums text-text">{v === null ? (t.loading ? "…" : "—") : v}</span>
          <span className="ml-6 h-1 w-1 rounded-full bg-line-strong" aria-hidden />
        </li>
      ))}
      <li className="whitespace-nowrap px-6 text-[15px] text-muted">
        Live from NEAR {NET} · every number links to the chain
      </li>
    </ul>
  );
  return (
    <section aria-label="Live escrow numbers" className="border-y border-line bg-surface">
      <div className="relative overflow-hidden py-4 motion-reduce:overflow-x-auto [mask-image:linear-gradient(90deg,transparent,black_4%,black_96%,transparent)]">
        <div className="marquee">
          {row(false)}
          {row(true)}
        </div>
      </div>
    </section>
  );
}

/** "Plote in numbers": live counters with hairline dividers, each linking to the chain. */
export function LiveStrip() {
  const t = useLiveTotals();
  const items: [string, string | null][] = [
    ["Units on Plote", t.units === null ? null : String(t.units)],
    ["USDC in escrow", t.escrow === null ? null : formatUsd(t.escrow)],
    ["Milestones verified", t.verified === null ? null : String(t.verified)],
    ["Refunds paid", t.refunds === null ? null : String(t.refunds)],
  ];
  return (
    <div>
      <dl className="grid grid-cols-2 lg:grid-cols-4">
        {items.map(([k, v], i) => (
          <div key={k} className={clsx("flex flex-col-reverse border-line px-1 py-6 sm:px-6", i % 2 === 1 && "border-l", i >= 2 && "border-t lg:border-t-0", i > 0 && "lg:border-l")}>
            <dt className="mono mt-1 text-[11px] uppercase tracking-[0.12em] text-muted">{k}</dt>
            <dd className="flex items-baseline gap-2 text-[30px] font-medium tracking-[-0.03em] tabular-nums sm:text-[40px]" aria-busy={t.loading}>
              <LiveValue v={v} loading={t.loading} />
              <ChainLink account={t.link} />
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-sm text-muted">Live from NEAR {NET}. Every number links to the chain.</p>
    </div>
  );
}

/** Kept for other pages: the live escrow figure as a small card. */
export function LiveEscrowCard() {
  const t = useLiveTotals();
  return (
    <div className="flex h-full flex-col justify-between gap-4 rounded-[20px] bg-surface p-6 ring-1 ring-line">
      <p className="eyebrow">USDC held in unit escrow</p>
      <p className="text-[40px] font-medium leading-none tracking-[-0.03em] tabular-nums sm:text-[48px]">
        <LiveValue v={t.escrow === null ? null : formatUsd(t.escrow)} loading={t.loading} />
      </p>
      <p className="flex items-center gap-2 text-xs text-muted">
        across {t.units === null ? "—" : t.units} units on NEAR {NET}
        <ChainLink account={t.link} />
      </p>
    </div>
  );
}

// ---------------- estate cards ----------------

function nextDeadline(d: EstateData, now: number): { text: string; tone: "muted" | "red" } {
  if (!d.ms) return { text: d.loading ? "Loading…" : "—", tone: "muted" };
  if (d.e?.frozen) return { text: "Frozen by holder vote", tone: "red" };
  if (d.e?.refunds_open) return { text: "Deadline missed · refunds open", tone: "red" };
  const next = d.ms.find((m) => m.status === "Open" || m.status === "Checking" || m.status === "Verified");
  if (!next) return { text: "Every stage proven", tone: "muted" };
  const c = countdown(next.deadline, now);
  return { text: c.ended ? `${next.title} deadline passed` : `${next.title} due in ${formatDuration(c.msLeft).split(" ")[0]}`, tone: "muted" };
}

/** Estate cards: the featured unit's live token, then two plain numbers and the next deadline. */
export function EstateCards() {
  const data = useLandingData();
  const now = useNow(60_000);
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {data.map((d) => {
        const u = featuredUnit(d.units);
        const e = d.e;
        const dl = nextDeadline(d, now);
        return (
          <Link
            key={d.account}
            href={`/estates/${d.slug}`}
            data-reveal
            className="group flex flex-col overflow-hidden rounded-[20px] bg-surface ring-1 ring-line transition-shadow duration-300 hover:shadow-[0_16px_40px_-20px_rgba(11,18,32,0.35)]"
          >
            <div className="survey-grid relative flex h-56 items-end justify-center overflow-hidden bg-gradient-to-br from-[#e7edf5] to-[#f6f8fb]">
              <span className="absolute left-4 top-4 rounded-full bg-surface px-3 py-1 text-xs font-medium ring-1 ring-line">{estateTag(d.slug)}</span>
              {u && e ? (
                <HouseNFT
                  className="w-44 translate-y-6 rounded-t-xl shadow-[var(--shadow-float)] transition-transform duration-300 group-hover:translate-y-4"
                  estateName={e.name}
                  unitLabel={u.label}
                  unitId={u.id}
                  approvedCount={nftApprovedCount(d.ms)}
                  total={d.ms?.length || 4}
                  status={u.status}
                  paid={u.paid}
                  price={u.price}
                />
              ) : (
                <div className={clsx("h-44 w-44 translate-y-6 rounded-t-xl", !d.failed && "skeleton")} aria-hidden />
              )}
            </div>
            <div className="flex flex-1 flex-col p-5 sm:p-6">
              <p className="text-lg font-medium">{prettyName(d)}</p>
              <p className="mt-1 text-sm text-muted">{e?.location || (d.loading ? "Loading…" : d.failed ? "Awaiting deployment" : "")}</p>
              <dl className="mt-5 grid grid-cols-2 gap-4 border-y border-line py-4">
                <div>
                  <dt className="mono text-[11px] uppercase tracking-[0.12em] text-muted">In escrow</dt>
                  <dd className="mt-1 text-[26px] font-medium leading-none tracking-[-0.03em] tabular-nums">{e ? formatUsd(e.totals.in_escrow) : <Dash />}</dd>
                </div>
                <div>
                  <dt className="mono text-[11px] uppercase tracking-[0.12em] text-muted">Released</dt>
                  <dd className="mt-1 text-[26px] font-medium leading-none tracking-[-0.03em] tabular-nums">{e ? `${pct(e.totals.released, e.totals.paid)}%` : <Dash />}</dd>
                </div>
              </dl>
              <div className="mt-4 flex items-center justify-between gap-3">
                <span className={clsx("text-sm", dl.tone === "red" ? "text-red" : "text-muted")}>
                  {e ? `${e.allocated_count} of ${e.unit_count} units sold · ` : ""}
                  {dl.text}
                </span>
                <ArrowDot />
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

// ---------------- watch your house come together ----------------

const STEPS: [string, string][] = [
  ["Reserve & pay into the unit", "Your USDC goes to the unit's own account, never to the developer."],
  ["Surveyor captures with a one-time code", "The site photo must show a fresh code, written on paper in the frame."],
  ["Checked in secure hardware", "An Intel TDX enclave checks place, time, reuse and code; NEAR AI judges the stage."],
  ["Signed, then a veto window", "The surveyor signs. Holders can still veto before anything moves."],
  ["Stage share released", "Only that stage's share goes to the developer. The rest stays put."],
];

const CYCLE_MS = 2600;

/** Picks the estate with a passed proof (else the demo estate) so the statement shows a real release. */
function useStatementSource() {
  const data = useLandingData();
  const withProof = data.find((d) => d.evidence?.some((ev) => ev.status === "Pass" && ev.verdict));
  const d = withProof ?? data.find((x) => x.account === DEMO_ESTATE) ?? data[0];
  const ev = d?.evidence?.find((x) => x.status === "Pass" && x.verdict) ?? null;
  const units = d?.units?.filter((u) => u.status !== "Available" && u.status !== "Reserved") ?? [];
  const u = [...units].sort((a, b) => cmpBig(toBig(b.released), toBig(a.released)) || cmpBig(toBig(b.paid), toBig(a.paid)))[0] ?? featuredUnit(d?.units);
  return { d, ev, u };
}

export function WatchItComeTogether() {
  const { d, ev, u } = useStatementSource();
  const reduce = usePrefersReducedMotion();
  const [active, setActive] = useState(0);
  const [held, setHeld] = useState(false);
  const [visible, setVisible] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const playing = !reduce && !held && visible;

  useEffect(() => {
    if (!box.current || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.3 });
    io.observe(box.current);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => setActive((s) => (s + 1) % (STEPS.length + 1)), active === STEPS.length ? CYCLE_MS * 1.6 : CYCLE_MS);
    return () => clearTimeout(t);
  }, [playing, active]);

  // Under reduced motion everything is shown at once.
  const filled = reduce ? STEPS.length : active;
  const m = ev && d?.ms ? d.ms[ev.milestone] : undefined;
  const v = ev?.verdict;
  const veto = d?.e ? formatDuration(nsToMs(d.e.params.veto_window_ns)) : null;
  const lines: [string, ReactNode][] = [
    [u ? `Paid into ${truncateAccount(u.account, 30)}` : "Paid into the unit's account", u ? formatUsd(u.paid) : <Dash />],
    ["One-time code in the frame", ev ? <span className="mono">{ev.challenge}</span> : <Dash />],
    ["Verdict in the enclave · NEAR AI", v ? `Pass · ${v.ai_stage ?? "stage"}${v.ai_confidence != null ? ` ${v.ai_confidence}%` : ""}` : <Dash />],
    ["Surveyor signature · veto window", m?.signed_at ? `Signed · ${veto ?? "—"}` : ev ? "Awaiting signature" : <Dash />],
    [m ? `${m.title} share released (${bpsToPct(m.bps)})` : "Stage share released", u && ev ? formatUsd(u.released) : <Dash />],
  ];

  return (
    <div ref={box} className="grid gap-10 lg:grid-cols-[1fr_1.05fr] lg:items-center lg:gap-16">
      <div className="space-y-8">
        <div data-reveal className="space-y-4">
          <p className="eyebrow">How it works</p>
          <h2 className="text-[32px] leading-[1.08] sm:text-[44px] sm:leading-[1.05]">
            Watch your house
            <br />
            come together.
          </h2>
          <p className="max-w-lg text-base leading-relaxed text-muted sm:text-[17px]">
            Every release follows the same five lines. The statement here is a real one, read from {d ? <span className="mono text-[15px] text-text">{d.slug}</span> : "the chain"}.
          </p>
        </div>
        <ol className="space-y-1">
          {STEPS.map(([title, body], i) => {
            const on = !reduce && active === i;
            const done = filled > i;
            return (
              <li key={title}>
                <button
                  type="button"
                  onClick={() => {
                    setHeld(true);
                    setActive(i + 1);
                  }}
                  aria-current={on ? "step" : undefined}
                  className={clsx("flex w-full items-start gap-4 rounded-2xl px-4 py-3 text-left transition-colors", on ? "bg-surface ring-1 ring-line" : "hover:bg-surface/60")}
                >
                  <span className={clsx("mono pt-0.5 text-[13px]", on || done ? "text-orange-ink" : "text-muted")}>0{i + 1}</span>
                  <span className="min-w-0">
                    <span className={clsx("block text-[16px]", on || done ? "text-text" : "text-muted")}>{title}</span>
                    {on || reduce ? <span className="mt-1 block text-sm text-muted">{body}</span> : null}
                  </span>
                  {done ? <Check className="ml-auto mt-1 h-4 w-4 shrink-0 text-accent" aria-label="done" /> : null}
                </button>
              </li>
            );
          })}
        </ol>
        <div className="flex flex-wrap gap-3">
          <Link href="/how-it-works" className="btn btn-ghost">
            The full walkthrough
          </Link>
          {held && !reduce ? (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setHeld(false);
                setActive(0);
              }}
            >
              Play again
            </button>
          ) : null}
        </div>
      </div>

      <div data-reveal className="float-card p-5 sm:p-8">
        <div className="flex items-center justify-between gap-3 border-b border-line pb-4">
          <p className="mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted">Escrow statement</p>
          <p className="mono text-[11px] uppercase tracking-[0.12em] text-muted">{u ? `Unit ${unitDisplay(u.id)} · ${d?.slug}` : "—"}</p>
        </div>
        <dl className="divide-y divide-line">
          {lines.map(([k, val], i) => (
            <div key={i} className={clsx("stmt-line flex items-baseline justify-between gap-4 py-4", filled > i ? "opacity-100" : "opacity-30")}>
              <dt className="min-w-0 text-[14px] text-muted">{k}</dt>
              <dd className="shrink-0 text-right text-[17px] font-medium tabular-nums">{val}</dd>
            </div>
          ))}
        </dl>
        <div className={clsx("stmt-line mt-2 flex flex-wrap items-end justify-between gap-4 border-t border-line pt-6", filled >= STEPS.length ? "opacity-100" : "opacity-30")}>
          <p className="text-[14px] text-muted">Still held in escrow</p>
          <p className="text-[44px] font-medium leading-none tracking-[-0.04em] tabular-nums sm:text-[56px]">{u ? formatUsd(heldIn(u)) : "—"}</p>
        </div>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-accent-soft px-4 py-3 text-[13px] text-accent">
          <span className="inline-flex items-center gap-2">
            <Lock className="h-4 w-4" aria-hidden /> Refundable to the holder if a deadline is missed
          </span>
          {ev && d ? (
            <Link href={`/proof/${d.slug}/${ev.id}`} className="inline-flex min-h-8 items-center gap-1 font-medium underline-offset-4 hover:underline">
              See proof #{ev.id} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ---------------- dark band: check any unit ----------------

const SAMPLE_UNITS = ["a-4b.harmattan-court", "b-2a.baobab-heights", "p-55.playground"];

export function CheckBand() {
  const [o, setO] = useState<CheckOutcome | null>(null);
  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:items-center">
      <div className="space-y-5">
        <p className="eyebrow">Check a unit</p>
        <h2 className="text-[34px] leading-[1.06] sm:text-[48px] sm:leading-[1.04]">
          Check any unit
          <br />
          before you pay anyone.
        </h2>
        <p className="max-w-md text-base leading-relaxed text-muted">
          Type a unit&apos;s name. Plote checks that the estate is a genuine Plote contract, then shows who holds the unit, what&apos;s been paid in and what&apos;s been
          released. No login.
        </p>
      </div>
      <div className="min-w-0 space-y-5">
        <ul className="flex flex-wrap gap-2" aria-label="What the check shows">
          {["Genuine estate?", "Taken or free", "Who holds it", "Paid in", "Released"].map((t) => (
            <li key={t} className="inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-[13px] text-text-2 ring-1 ring-line">
              <ShieldCheck className="h-3.5 w-3.5 text-orange-ink" aria-hidden /> {t}
            </li>
          ))}
        </ul>
        <CheckInput onResult={setO} id="band-check" />
        <div aria-live="polite" className="min-h-11">
          {o ? (
            <CheckChip o={o} />
          ) : (
            <p className="text-sm text-muted">
              Try{" "}
              {SAMPLE_UNITS.map((s, i) => (
                <span key={s}>
                  <Link href={`/check?u=${encodeURIComponent(s)}`} className="mono break-all text-text underline decoration-line-strong underline-offset-4 hover:decoration-orange">
                    {s}
                  </Link>
                  {i < SAMPLE_UNITS.length - 1 ? ", " : ""}
                </span>
              ))}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------- real proofs, real numbers ----------------

/** Cards built only from the chain: passed proofs, releases and refunds. No people, no quotes. */
export function RealProofs() {
  const data = useLandingData();
  const t = useLiveTotals();
  const loading = data.some((d) => d.loading || (!d.failed && d.evidence === undefined));
  const proofs = data
    .flatMap((d) => (d.evidence ?? []).filter((ev) => ev.status === "Pass" && ev.verdict).map((ev) => ({ d, ev })))
    .sort((a, b) => cmpBig(toBig(b.ev.submitted_at), toBig(a.ev.submitted_at)))
    .slice(0, 2);
  const refunds = data.filter((d) => d.e && toBig(d.e.totals.refunded) > 0n).slice(0, 1);
  const cards = proofs.length + refunds.length;

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <div data-reveal className="flex min-h-[300px] flex-col justify-between rounded-[20px] bg-orange p-6 text-ink">
        <p className="mono text-[11px] font-medium uppercase tracking-[0.14em]">Proofs on record</p>
        <div>
          <p className="text-[72px] font-medium leading-none tracking-[-0.05em] tabular-nums">{t.proofsPassed ?? "—"}</p>
          <p className="mt-3 text-[15px] leading-snug">
            {t.proofsSubmitted !== null ? `photo${t.proofsPassed === 1 ? "" : "s"} passed, out of ${t.proofsSubmitted} submitted.` : "photos passed."} A photo that fails a
            check releases nothing.
          </p>
        </div>
      </div>

      {proofs.map(({ d, ev }) => {
        const v = ev.verdict!;
        const m = d.ms?.[ev.milestone];
        return (
          <Link
            key={`${d.account}-${ev.id}`}
            href={`/proof/${d.slug}/${ev.id}`}
            data-reveal
            className="group flex flex-col overflow-hidden rounded-[20px] bg-surface ring-1 ring-line transition-shadow hover:shadow-[0_16px_40px_-20px_rgba(11,18,32,0.35)]"
          >
            <div className="relative aspect-[16/10] overflow-hidden bg-surface-2">
              <EvidenceThumb src={ev.url} alt={`Site photo for ${m?.title ?? "a milestone"} on ${prettyName(d)}`} className="h-full w-full object-cover" sizes="(max-width: 768px) 100vw, 300px" />
              <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-surface px-2.5 py-1 text-xs font-medium ring-1 ring-line">
                <BadgeCheck className="h-3.5 w-3.5 text-accent" aria-hidden /> Pass
              </span>
            </div>
            <div className="flex flex-1 flex-col p-5">
              <p className="mono text-[11px] uppercase tracking-[0.12em] text-muted">
                Proof #{ev.id} · {d.slug}
              </p>
              <p className="mt-1 text-[15px] font-medium">
                {m?.title ?? "Milestone"} verified {timeAgo(m?.verified_at ?? ev.submitted_at)}
              </p>
              <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4">
                <div>
                  <dt className="mono text-[11px] uppercase tracking-[0.12em] text-muted">AI stage</dt>
                  <dd className="mt-1 text-[22px] font-medium leading-none tracking-[-0.03em] tabular-nums">{v.ai_confidence != null ? `${v.ai_confidence}%` : "—"}</dd>
                </div>
                <div>
                  <dt className="mono text-[11px] uppercase tracking-[0.12em] text-muted">Stage share</dt>
                  <dd className="mt-1 text-[22px] font-medium leading-none tracking-[-0.03em] tabular-nums">{m ? bpsToPct(m.bps) : "—"}</dd>
                </div>
              </dl>
              <p className="mt-3 text-[13px] text-muted">
                Code <span className="mono text-text">{ev.challenge}</span> in frame
                {v.distance_m != null ? ` · ${v.distance_m} m from site` : ""}. {d.e ? `${formatUsd(d.e.totals.released)} released on this estate so far.` : ""}
              </p>
              <span className="mt-auto flex items-center justify-between pt-4 text-sm font-medium">
                Open the full proof <ArrowDot />
              </span>
            </div>
          </Link>
        );
      })}

      {refunds.map((d) => {
        const e = d.e!;
        const missed = d.ms?.find((m) => m.late || m.status === "Missed");
        return (
          <Link
            key={`refund-${d.account}`}
            href={`/estates/${d.slug}`}
            data-reveal
            className="group flex flex-col rounded-[20px] bg-surface p-6 ring-1 ring-line transition-shadow hover:shadow-[0_16px_40px_-20px_rgba(11,18,32,0.35)]"
          >
            <p className="inline-flex items-center gap-2 text-sm font-medium text-red">
              <RotateCcw className="h-4 w-4" aria-hidden /> Refund, triggered by holders
            </p>
            <p className="mt-4 text-[15px] leading-relaxed text-text-2">
              {missed ? `${missed.title} on ${prettyName(d)} missed its deadline.` : `${prettyName(d)} opened refunds.`} Holders took back money that hadn&apos;t been
              released, straight from their units&apos; accounts.
            </p>
            <dl className="mt-auto grid grid-cols-2 gap-3 border-t border-line pt-4">
              <div>
                <dt className="mono text-[11px] uppercase tracking-[0.12em] text-muted">Refunded</dt>
                <dd className="mt-1 text-[26px] font-medium leading-none tracking-[-0.03em] tabular-nums">{formatUsd(e.totals.refunded)}</dd>
              </div>
              <div>
                <dt className="mono text-[11px] uppercase tracking-[0.12em] text-muted">Units</dt>
                <dd className="mt-1 text-[26px] font-medium leading-none tracking-[-0.03em] tabular-nums">{e.stats.units_refunded}</dd>
              </div>
            </dl>
            <span className="mt-4 flex items-center justify-between text-sm font-medium">
              {prettyName(d)} <ArrowDot />
            </span>
          </Link>
        );
      })}

      {cards === 0 ? (
        <div className="flex flex-col justify-center rounded-[20px] bg-surface p-6 text-sm text-muted ring-1 ring-line md:col-span-1 lg:col-span-3">
          {loading
            ? "Reading proofs from the chain…"
            : "No photo has passed the check yet and no refunds have been paid. The first ones appear here, read straight from the chain — nothing on this page is made up."}
        </div>
      ) : null}
    </div>
  );
}

// ---------------- people on record ----------------

const AVATAR = [
  ["#FFE8D4", "#B54700"],
  ["#E8F5EF", "#0E7A52"],
  ["#E6F1F8", "#0B6FA4"],
  ["#EEE9FB", "#5B3FB0"],
] as const;

function Avatar({ account }: { account: string }) {
  const first = account.split(".")[0] ?? account;
  const parts = first.split(/[-_]/).filter(Boolean);
  const initials = ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? parts[0]?.[1] ?? "")).toUpperCase();
  let h = 0;
  for (const c of account) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const [bg, fg] = AVATAR[h % AVATAR.length];
  return (
    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-base font-semibold" style={{ background: bg, color: fg }} aria-hidden>
      {initials}
    </span>
  );
}

type Person = { account: string; role: "Surveyor" | "Developer"; estates: string[]; stats: [string, string][] };

/** The surveyor and developer accounts behind the live estates, with their on-chain record. Initials, not faces. */
export function OnRecord() {
  const data = useLandingData();
  const people = useMemo(() => {
    const out = new Map<string, Person>();
    const add = (account: string, role: Person["role"], d: EstateData) => {
      const key = `${role}:${account}`;
      const p = out.get(key) ?? { account, role, estates: [], stats: [] };
      p.estates.push(d.slug);
      out.set(key, p);
    };
    for (const d of data) {
      if (!d.e) continue;
      add(d.e.surveyor_id, "Surveyor", d);
      add(d.e.developer_id, "Developer", d);
    }
    for (const p of out.values()) {
      const es = data.filter((d) => d.e && p.estates.includes(d.slug)).map((d) => d.e!);
      const s = (f: (e: EstateView) => number) => String(es.reduce((n, e) => n + f(e), 0));
      p.stats =
        p.role === "Surveyor"
          ? [
              ["Photos submitted", s((e) => e.stats.evidence_submitted)],
              ["Passed", s((e) => e.stats.evidence_passed)],
              ["Sign-offs", s((e) => e.stats.signoffs)],
              ["Vetoed by holders", s((e) => e.stats.vetoes)],
            ]
          : [
              ["Units sold", s((e) => e.stats.units_sold)],
              ["Stages due", s((e) => e.stats.milestones_due)],
              ["On time", s((e) => e.stats.milestones_on_time)],
              ["Units refunded", s((e) => e.stats.units_refunded)],
            ];
    }
    return [...out.values()].sort((a, b) => (a.role === b.role ? a.account.localeCompare(b.account) : a.role === "Surveyor" ? -1 : 1));
  }, [data]);

  if (!people.length) {
    return <div className="rounded-[20px] bg-surface p-6 text-sm text-muted ring-1 ring-line">{data.some((d) => d.loading) ? "Reading the estates…" : "No estate answered just now."}</div>;
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {people.map((p) => (
        <div key={`${p.role}-${p.account}`} data-reveal className="flex flex-col rounded-[20px] bg-surface p-5 ring-1 ring-line">
          <div className="flex items-center gap-3">
            <Avatar account={p.account} />
            <div className="min-w-0">
              <p className="truncate text-[15px] font-medium" title={p.account}>
                {p.account.split(".")[0]}
              </p>
              <p className="text-[13px] text-muted">
                {p.role} on {p.estates.length} estate{p.estates.length === 1 ? "" : "s"}
              </p>
            </div>
          </div>
          <p className="mono mt-3 flex items-center gap-1 rounded-lg bg-surface-2 py-0.5 pl-2 text-[11px] text-muted">
            <span className="min-w-0 truncate">{p.account}</span>
            <ChainLink account={p.account} className="ml-auto shrink-0" />
          </p>
          <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-3">
            {p.stats.map(([k, v]) => (
              <div key={k}>
                <dt className="text-[12px] text-muted">{k}</dt>
                <dd className="text-[20px] font-medium leading-tight tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-5 flex flex-wrap gap-2">
            {p.role === "Developer" ? (
              <Link href={`/developers/${p.account}`} className="btn btn-ink btn-sm">
                Track record
              </Link>
            ) : (
              <Link href="/surveyors" className="btn btn-ink btn-sm">
                How surveyors sign
              </Link>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------- the token that does something: live NFT with stage toggle ----------------

const STAGES = ["Foundation", "Roofing", "Finishing", "Handover"];

const STAGE_MS = 2200;

/**
 * The token drawn at each stage. It plays through the stages on its own (before → Foundation → Roofing → Finishing →
 * Handover, then again); tap a stage to hold it, tap it again to resume. Paused off-screen and under reduced motion.
 */
export function NftShowcase() {
  const unitQ = useQuery({ queryKey: ["unit", DEMO_ESTATE, "a-4b"], queryFn: () => E.getUnit(DEMO_ESTATE, "a-4b"), retry: 0 });
  const msQ = useQuery({ queryKey: ["milestones", DEMO_ESTATE], queryFn: () => E.getMilestones(DEMO_ESTATE), retry: 0 });
  const estQ = useQuery({ queryKey: ["estate", DEMO_ESTATE], queryFn: () => E.getEstate(DEMO_ESTATE), retry: 0 });
  const live = approvedCount(msQ.data);
  const reduce = usePrefersReducedMotion();
  const [held, setHeld] = useState<number | null>(null);
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const playing = !reduce && held === null && visible;

  useEffect(() => {
    if (!box.current || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.25 });
    io.observe(box.current);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => setStep((s) => (s + 1) % 5), step === 4 ? STAGE_MS * 1.6 : STAGE_MS);
    return () => clearTimeout(t);
  }, [playing, step]);

  const shown = held !== null ? held + 1 : reduce ? live : step;
  const active = held !== null ? held : reduce ? null : step - 1;
  const u = unitQ.data;
  return (
    <BracketCard className="space-y-4">
      <div ref={box} className="overflow-hidden rounded-xl">
        <HouseNFT
          animated
          estateName={estQ.data?.name ?? "Harmattan Court"}
          unitLabel={u?.label ?? ""}
          unitId="a-4b"
          approvedCount={shown}
          total={msQ.data?.length || 4}
          status={shown >= 4 ? "HandedOver" : shown > 0 && !reduce ? "Allocated" : (u?.status ?? "—")}
          paid={u?.paid ?? "0"}
          price={u?.price ?? "0"}
          showMoney={!!u}
        />
      </div>
      <div>
        <p className="label">{held !== null ? "Holding at" : reduce ? "Show at" : "Playing through each stage"}</p>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Show the token at a stage">
          {STAGES.map((s, i) => (
            <button
              key={s}
              type="button"
              aria-pressed={held === i}
              onClick={() => setHeld(held === i ? null : i)}
              className={clsx("btn btn-sm relative overflow-hidden", active === i ? "border-orange/60 bg-orange-soft text-orange-ink" : "btn-ghost")}
            >
              {s}
              {playing && active === i ? (
                <span key={step} aria-hidden className="chip-progress absolute inset-x-0 bottom-0 h-[2px] bg-orange" style={{ animationDuration: `${step === 4 ? STAGE_MS * 1.6 : STAGE_MS}ms` }} />
              ) : null}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">
          {held !== null
            ? "Holding this stage. Tap it again to keep playing."
            : reduce
              ? u
                ? `Live: ${live} of ${msQ.data?.length ?? 4} milestones approved.`
                : "Live state unavailable — showing the drawing."
              : `A preview of how the token changes. Live: ${live} of ${msQ.data?.length ?? 4} approved.`}
          <ChainLink account={unitAccount(DEMO_ESTATE, "a-4b")} />
        </p>
      </div>
    </BracketCard>
  );
}

/** The demo unit's token as the chain has it right now: the on-chain image when minted, else drawn from live state. */
export function LiveDemoNft() {
  const unitQ = useUnit(DEMO_ESTATE, "a-4b");
  const msQ = useMilestones(DEMO_ESTATE);
  const estQ = useEstate(DEMO_ESTATE);
  const u = unitQ.data;
  const loading = unitQ.isLoading || msQ.isLoading;
  const caption = loading
    ? "Reading the token from the chain…"
    : u
      ? `Live: ${approvedCount(msQ.data)} of ${msQ.data?.length ?? "—"} stages approved · ${u.status}`
      : "Live state unavailable right now, so this is the drawing with nothing filled in.";
  return (
    <figure className="w-full max-w-sm space-y-2">
      <div className="overflow-hidden rounded-[20px] shadow-[var(--shadow-float)] ring-1 ring-line">
        {loading ? (
          <div className="skeleton aspect-square w-full" aria-hidden />
        ) : (
          <HouseNFT
            estateName={estQ.data?.name ?? "Harmattan Court"}
            unitLabel={u?.label ?? ""}
            unitId="a-4b"
            approvedCount={nftApprovedCount(msQ.data)}
            total={msQ.data?.length || 4}
            status={u?.status ?? "—"}
            paid={u?.paid ?? "0"}
            price={u?.price ?? "0"}
            showMoney={!!u}
          />
        )}
      </div>
      <figcaption className="mono flex items-center gap-1 text-xs text-muted" aria-live="polite">
        {caption} <ChainLink account={unitAccount(DEMO_ESTATE, "a-4b")} />
      </figcaption>
    </figure>
  );
}

// ---------------- proof, not promises: one real proof card ----------------

export function LiveProofCard() {
  const q = useQuery({
    queryKey: ["evidence-list", DEMO_ESTATE, "landing"],
    queryFn: () => E.listEvidence(DEMO_ESTATE, { limit: 20 }),
    retry: 0,
  });
  const est = useQuery({ queryKey: ["estate", DEMO_ESTATE], queryFn: () => E.getEstate(DEMO_ESTATE), retry: 0 });
  const ms = useQuery({ queryKey: ["milestones", DEMO_ESTATE], queryFn: () => E.getMilestones(DEMO_ESTATE), retry: 0 });
  const ev = q.data?.find((e) => e.status === "Pass" && e.verdict);
  const v = ev?.verdict;
  const signed = !!ev && !!ms.data?.[ev.milestone]?.signed_at;
  const age = v?.exif_time && ev ? nsToMs(ev.submitted_at) - nsToMs(v.exif_time) : null;
  const rows: string[] =
    ev && v
      ? [
          v.distance_m != null ? `Taken ${v.distance_m} m from site` : "Taken on site",
          age !== null ? `Taken ${formatDuration(age)} before upload` : "Fresh capture",
          `Never used before (nearest match ${v.nearest_distance}/64)`,
          v.ai_stage ? `Shows ${v.ai_stage} — ${v.ai_confidence ?? "?"}% confidence` : "Stage checked",
          `Challenge code ${ev.challenge} in frame`,
          ...(signed ? [`Signed by QS ${est.data?.surveyor_id ?? "—"}`] : []),
        ]
      : [];
  return (
    <BracketCard className="grid gap-5 md:grid-cols-[1fr_1.2fr]">
      <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-surface-2">
        {ev ? (
          <EvidenceThumb src={ev.url} alt="Milestone photo from the demo estate" className="h-full w-full object-cover" width={800} height={600} sizes="(max-width: 768px) 100vw, 480px" />
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted">
            {q.isLoading
              ? "Loading the latest proof…"
              : q.error
                ? "Couldn't read proofs from the chain just now, so there's nothing to show. Nothing here is made up: try again in a moment."
                : "No photo has passed the check on this estate yet. The first one that does appears here, with every check it passed."}
          </div>
        )}
      </div>
      <div className="space-y-3">
        {ev ? (
          <ul className="space-y-2">
            {rows.map((t) => (
              <li key={t} className="flex items-start gap-2 text-sm">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden /> <span className="sr-only">Passed:</span> {t}
              </li>
            ))}
          </ul>
        ) : (
          <div className="space-y-2">
            <p className="text-sm">Every photo that releases money must pass these checks:</p>
            <ul className="space-y-2 text-sm text-muted">
              {["Taken on site (GPS inside the geofence)", "Taken this week (EXIF time)", "Never used before (perceptual hash)", "Shows the claimed stage (AI check)", "Challenge code written in the frame", "Signed by the surveyor"].map((t) => (
                <li key={t}>
                  <span aria-hidden>○</span> {t}
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-xs text-muted">
          {v?.source === "https"
            ? "This verdict came through the HTTPS fallback worker rather than the OutLayer enclave; the proof page says so and shows what was checked."
            : "Checked inside an Intel TDX enclave on OutLayer, with stage recognition by NEAR AI Cloud. The code that checks it is public, and its fingerprint is on-chain."}
          {ev && !signed ? " The surveyor hasn't signed this stage yet." : ""}
        </p>
        <LinkButton href={ev ? `/proof/${estateSlug(DEMO_ESTATE)}/${ev.id}` : `/estates/${estateSlug(DEMO_ESTATE)}/milestones`} variant="primary">
          {ev ? "Open the full proof →" : "See the milestones →"}
        </LinkButton>
      </div>
    </BracketCard>
  );
}

// ---------------- chain chips (from /v0/tokens, filtered) ----------------

/** Chains 1Click can pay from. Only the mainnet build asks /v0/tokens (NEAR Intents has no testnet); elsewhere a static list. */
export function ChainChips() {
  const q = useQuery({ queryKey: ["oneclick-tokens"], queryFn: oneclick.tokens, retry: 0, staleTime: 600_000, enabled: ONECLICK_ENABLED });
  const fromApi = q.data
    ? Array.from(new Set(q.data.filter((t) => STABLE_SYMBOLS.includes(t.symbol.toUpperCase()) && PICKER_CHAINS.includes(t.blockchain)).map((t) => t.blockchain)))
    : [];
  const chains = fromApi.length ? PICKER_CHAINS.filter((c) => fromApi.includes(c) || c === "near") : PICKER_CHAINS;
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Supported chains">
      {chains.map((c) => (
        <li key={c} className="rounded-full bg-surface px-4 py-2 text-sm ring-1 ring-line">
          {chainName(c)}
        </li>
      ))}
    </ul>
  );
}

// ---------------- phone mockup: messaging preview + watch timeline ----------------

const APP_HOST = (() => {
  try {
    return new URL(APP_URL).host;
  } catch {
    return "plote";
  }
})();

/** A messaging-app preview of the demo unit's watch page: live progress when the chain answers, neutral copy otherwise. */
export function PhoneMockup() {
  const u = useUnit(DEMO_ESTATE, "a-4b").data;
  const ms = useMilestones(DEMO_ESTATE).data;
  const est = useEstate(DEMO_ESTATE).data;
  const name = est?.name ?? "Harmattan Court";
  const done = approvedCount(ms);
  const stages = ms?.length ? ms.map((m) => m.title) : STAGES;
  return (
    <div className="mx-auto w-[260px] rounded-[32px] bg-surface p-2.5 shadow-[var(--shadow-float)] ring-1 ring-line" aria-hidden>
      <div className="rounded-[24px] bg-[#eef1f5] p-3">
        <div className="ml-auto max-w-[85%] rounded-2xl rounded-tr-md bg-[#dcf4e6] p-2 text-[11px] text-ink">
          <div className="overflow-hidden rounded-xl bg-surface">
            <HouseNFT estateName={name} unitLabel={u?.label ?? ""} unitId="a-4b" approvedCount={nftApprovedCount(ms)} total={ms?.length || 4} status={u?.status ?? "Allocated"} paid={u?.paid ?? "0"} price={u?.price ?? "0"} showMoney={!!u} className="aspect-square w-full" />
            <div className="p-2">
              <p className="font-medium">{u ? `A-4B at ${name} is ${Math.round(u.progress_bps / 100)}% built` : `Watch A-4B at ${name} being built`}</p>
              <p className="text-muted">{APP_HOST}</p>
            </div>
          </div>
          <p className="mt-1">Mum, this is the flat. You can watch every stage here.</p>
        </div>
        <div className="mt-3 space-y-2 rounded-xl bg-surface p-2.5">
          {stages.map((s, i) => (
            <div key={`${i}-${s}`} className="flex items-center gap-2 text-[11px]">
              <span className={clsx("h-2 w-2 rounded-full", i < done ? "bg-accent" : "bg-line-strong")} />
              <span className={i < done ? "text-text" : "text-muted"}>{s}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function SourceLinks() {
  const s = [
    ["TechEconomy", "https://techeconomy.ng/?p=164669"],
    ["Nigeria Housing Market", "https://www.nigeriahousingmarket.com/news/20-real-estate-scams-nigerian-property-buyers-must-avoid"],
    ["allAfrica", "https://allafrica.com/stories/202601290263.html"],
    ["Guardian Nigeria", "https://guardian.ng/property/diasporan-investors-drive-growth-expose-fault-lines-in-real-estate-sector/"],
    ["Nation (Kenya)", "https://nation.africa/kenya/news/off-plan-scams-from-dream-homes-to-dust--5347430"],
  ];
  return (
    <p className="text-xs text-muted">
      Sources:{" "}
      {s.map(([n, u], i) => (
        <span key={n}>
          <a href={u} target="_blank" rel="noreferrer" className="underline decoration-line-strong underline-offset-2 hover:text-text">
            {n}
          </a>
          {i < s.length - 1 ? " · " : ""}
        </span>
      ))}
    </p>
  );
}

export function FinalCta() {
  return (
    <div className="space-y-4">
      <CheckInput navigate id="final-check" />
      <p className="text-sm text-muted">
        Developer?{" "}
        <Link href="/dev/estates/new" className="font-medium text-text underline underline-offset-4 hover:text-orange-ink">
          Put your estate on Plote →
        </Link>
      </p>
    </div>
  );
}
