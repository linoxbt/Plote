"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { Activity as ActivityIcon, MapPin, Vote } from "lucide-react";
import { estateSlug } from "@/lib/estates";
import { googleMapsLinks } from "@/lib/satellite";
import { describeEvent } from "@/lib/events";
import { formatUsdc, pct, timeAgo, toBig, unitDisplay } from "@/lib/format";
import { useEstate, useUnits } from "@/lib/hooks";
import { devScore } from "@/lib/score";
import { recentEvents, supabaseConfigured } from "@/lib/supabase";
import type { EstateView, UnitView } from "@/lib/types";
import { AccountChip, MonoAmount, StatusBadge } from "./chain";
import { BracketCard, ChainLink, EmptyState, ErrorState, LinkButton, LoadingCard, explorerTxUrl } from "./ui";

export function EstateHeader({ e, slug, right }: { e: EstateView; slug: string; right?: React.ReactNode }) {
  return (
    <header className="mb-6 space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="mono mb-2 text-xs tracking-[0.12em] text-orange-ink">ESTATE · {e.account}</p>
          <h1 className="text-3xl font-normal sm:text-[40px]">
            {e.name} <ChainLink account={e.account} label="Estate contract on NearBlocks" />
          </h1>
          <p className="mt-1 flex items-center gap-1 text-muted">
            <MapPin className="h-4 w-4" strokeWidth={1.5} aria-hidden />
            {e.location}
            {e.geofence.radius_m > 0 ? (
              <a
                className="mono ml-2 text-xs underline hover:text-orange-ink"
                href={googleMapsLinks([e.geofence.lat_e6 / 1e6, e.geofence.lon_e6 / 1e6], e.geofence.radius_m * 4).satellite}
                target="_blank"
                rel="noreferrer"
              >
                map ↗
              </a>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {right}
          <LinkButton href={`/estates/${slug}/votes`} size="sm">
            <Vote className="h-4 w-4" aria-hidden /> Votes
          </LinkButton>
          <LinkButton href={`/estates/${slug}/milestones`} size="sm">
            Milestones
          </LinkButton>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <span className="flex items-center gap-2">
          <span className="text-muted">Developer</span>
          <Link href={`/developers/${e.developer_id}`} className="mono underline hover:text-orange-ink">
            {e.developer_id}
          </Link>
          <ChainLink account={e.developer_id} />
        </span>
        <span className="flex items-center gap-2">
          <span className="text-muted">Surveyor</span>
          {e.params.playground ? <span className="mono text-amber">anyone (Playground)</span> : <AccountChip account={e.surveyor_id} />}
        </span>
        {e.payout_redirect ? (
          <span className="flex items-center gap-2">
            <span className="text-muted">Releases redirected to</span>
            <AccountChip account={e.payout_redirect} />
          </span>
        ) : null}
      </div>
    </header>
  );
}

export function EscrowSummary({ e, units }: { e: EstateView; units?: UnitView[] }) {
  const refundable = units ? units.reduce((n, u) => n + toBig(u.refundable_now), 0n) : null;
  return (
    <BracketCard>
      <h2 className="mb-4 text-xl font-normal">Escrow</h2>
      <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div>
          <dt className="label">Total paid</dt>
          <dd>
            <MonoAmount value={e.totals.paid} account={e.account} />
          </dd>
        </div>
        <div>
          <dt className="label">In escrow</dt>
          <dd>
            <MonoAmount value={e.totals.in_escrow} account={e.account} />
          </dd>
        </div>
        <div>
          <dt className="label">Released</dt>
          <dd>
            <MonoAmount value={e.totals.released} account={e.payout_id} />
          </dd>
        </div>
        <div>
          <dt className="label">Refundable now</dt>
          <dd>
            <MonoAmount value={refundable === null ? null : refundable.toString()} account={e.account} className={refundable && refundable > 0n ? "text-red" : ""} />
          </dd>
        </div>
      </dl>
      <p className="mono mt-4 text-xs text-muted">
        {e.allocated_count} of {e.unit_count} units allocated · {e.available_count} available · refunded {formatUsdc(e.totals.refunded)} USDC
      </p>
    </BracketCard>
  );
}

const CELL = {
  Available: "bg-surface-2 text-text",
  Reserved: "bg-amber/15 text-amber",
  Allocated: "bg-orange-dim text-orange-ink",
  InDefault: "bg-red/15 text-red",
  HandedOver: "bg-accent/15 text-accent",
} as const;

const CELL_WORD = { Available: "free", Reserved: "held", Allocated: "taken", InDefault: "default", HandedOver: "home" } as const;

function blockOf(id: string): string {
  const m = /^([a-z]+)-/.exec(id);
  return m ? m[1].toUpperCase() : "Units";
}

/** Floor-plan style grid: blocks as columns, units as cells coloured by status (with a text label). A list on mobile. */
export function UnitGrid({ estate, units }: { estate: string; units: UnitView[] }) {
  const slug = estateSlug(estate);
  if (!units.length) return <EmptyState title="No units yet">The developer hasn&apos;t added units to this estate.</EmptyState>;
  const blocks = new Map<string, UnitView[]>();
  for (const u of units) {
    const b = blockOf(u.id);
    blocks.set(b, [...(blocks.get(b) ?? []), u]);
  }
  return (
    <div>
      <ul className="divide-y divide-line md:hidden">
        {units.map((u) => (
          <li key={u.id}>
            <Link href={`/estates/${slug}/units/${u.id}`} className="flex min-h-14 items-center justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="mono font-normal">{unitDisplay(u.id)}</span> <span className="truncate text-sm text-muted">{u.label}</span>
              </span>
              <StatusBadge status={u.status} />
            </Link>
          </li>
        ))}
      </ul>
      <div className="hidden gap-4 md:flex md:flex-wrap">
        {[...blocks.entries()].map(([b, list]) => (
          <div key={b} className="min-w-[160px] flex-1">
            <p className="label">Block {b}</p>
            <div className="grid grid-cols-2 gap-1 lg:grid-cols-3">
              {list.map((u) => (
                <Link
                  key={u.id}
                  href={`/estates/${slug}/units/${u.id}`}
                  className={clsx("corners corners-hover flex min-h-16 flex-col justify-between p-2", CELL[u.status])}
                  title={`${u.label} — ${u.status}`}
                >
                  <span className="mono text-sm font-normal">{unitDisplay(u.id)}</span>
                  <span className="mono text-[10px] uppercase">
                    {CELL_WORD[u.status]} {u.status === "Allocated" ? `· ${pct(u.paid, u.price)}%` : ""}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Activity({ estate, unit, limit = 15 }: { estate: string; unit?: string; limit?: number }) {
  const q = useQuery({ queryKey: ["events", estate, unit ?? ""], queryFn: () => recentEvents(estate, { unit, limit }), enabled: supabaseConfigured(), retry: 0 });
  if (!supabaseConfigured()) {
    return (
      <EmptyState title="Activity feed offline" icon={<ActivityIcon className="h-7 w-7" strokeWidth={1.5} />}>
        The event cache isn&apos;t connected on this deployment. Every number on this page is still read live from the contract, and the full history is on
        NearBlocks. <ChainLink account={estate} />
      </EmptyState>
    );
  }
  if (q.isLoading) return <LoadingCard lines={4} />;
  if (q.error) return <ErrorState error={q.error} title="Couldn't load activity" onRetry={() => q.refetch()} />;
  if (!q.data?.length) return <EmptyState title="No activity yet">Events appear here a few minutes after they happen on-chain.</EmptyState>;
  return (
    <ul className="divide-y divide-line">
      {q.data.map((r) => (
        <li key={r.id} className="flex items-start justify-between gap-3 py-2 text-sm">
          <span className="min-w-0">{describeEvent(r)}</span>
          <a className="mono shrink-0 text-xs text-muted hover:text-orange-ink" href={explorerTxUrl(r.tx_hash)} target="_blank" rel="noreferrer">
            {timeAgo(String(new Date(r.block_time).getTime() * 1e6))} ↗
          </a>
        </li>
      ))}
    </ul>
  );
}

export function DevScoreChip({ e }: { e: EstateView }) {
  const s = devScore(e.stats);
  return (
    <Link href={`/developers/${e.developer_id}`} className="mono inline-flex min-h-8 items-center gap-1 bg-surface-2 px-2 text-xs hover:text-orange-ink">
      {s.isNew ? "New on Plote" : `Score ${s.score}/100`}
    </Link>
  );
}

/** Loads the estate + units for a slug and renders loading / error states. */
export function useEstateData(account: string) {
  const est = useEstate(account);
  const units = useUnits(account, { enabled: !!est.data });
  return { est, units };
}
