"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { MapPin } from "lucide-react";
import { DevScoreChip } from "@/components/estate-bits";
import { HouseNFT } from "@/components/house-nft";
import { MonoAmount, StatusBadge } from "@/components/chain";
import { BracketCard, EmptyState, ErrorState, LoadingCard } from "@/components/ui";
import { ESTATES } from "@/lib/config";
import { approvedCount, currentMilestone } from "@/lib/estate";
import { estateSlug } from "@/lib/estates";
import { useAllEstates, useAllMilestones } from "@/lib/hooks";

export function EstatesClient() {
  const estates = useAllEstates();
  const ms = useAllMilestones();
  const [city, setCity] = useState("all");
  const [stage, setStage] = useState("all");
  const cities = useMemo(
    () => Array.from(new Set(estates.map((x) => x.q.data?.location.split(",").pop()?.trim()).filter(Boolean) as string[])),
    [estates],
  );
  if (!ESTATES.length) return <EmptyState title="No estates configured">Set NEXT_PUBLIC_ESTATES to the estate accounts this deployment shows.</EmptyState>;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3">
        <label className="min-w-40">
          <span className="label">City</span>
          <select className="input" value={city} onChange={(e) => setCity(e.target.value)}>
            <option value="all">All cities</option>
            {cities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-40">
          <span className="label">Stage</span>
          <select className="input" value={stage} onChange={(e) => setStage(e.target.value)}>
            <option value="all">Any stage</option>
            {["foundation", "roofing", "finishing", "handover", "complete"].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {estates.map(({ account, q }, i) => {
          const m = ms[i]?.q.data;
          const cur = currentMilestone(m);
          const e = q.data;
          if (e && city !== "all" && !e.location.includes(city)) return null;
          if (stage !== "all" && m && (cur?.key ?? "complete") !== stage) return null;
          if (q.isLoading) return <li key={account}><LoadingCard lines={4} /></li>;
          if (!e) return <li key={account}><ErrorState error={q.error} title={`Couldn't load ${estateSlug(account)}`} onRetry={() => q.refetch()} /></li>;
          return (
            <li key={account}>
              <Link href={`/estates/${estateSlug(account)}`} className="block h-full">
                <BracketCard hover className="h-full space-y-3">
                  <div className="relative">
                    <HouseNFT estateName={e.name} unitLabel={estateSlug(account)} unitId={estateSlug(account)} approvedCount={approvedCount(m)} total={m?.length || 4} status="Allocated" paid={e.totals.paid} price="0" className="aspect-[300/200] w-full object-cover object-top" />
                    <span className="mono absolute bottom-1 right-1 bg-bg/80 px-1 text-[10px] text-muted">illustrative</span>
                  </div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h2 className="truncate text-xl font-normal">{e.name}</h2>
                      <p className="flex items-center gap-1 text-sm text-muted"><MapPin className="h-3.5 w-3.5" aria-hidden />{e.location}</p>
                    </div>
                    <DevScoreChip e={e} />
                  </div>
                  <dl className="grid grid-cols-2 gap-2 text-sm">
                    <div><dt className="label">Units sold</dt><dd className="mono">{e.allocated_count}/{e.unit_count}</dd></div>
                    <div><dt className="label">In escrow</dt><dd><MonoAmount value={e.totals.in_escrow} naira={false} /></dd></div>
                    <div className="col-span-2"><dt className="label">Current milestone</dt><dd className="flex items-center gap-2">{cur ? <><span>{cur.title}</span><StatusBadge kind="milestone" status={cur.status} /></> : m ? <span className="text-accent">All stages approved</span> : <span>—</span>}</dd></div>
                  </dl>
                  {e.params.playground ? <p className="mono text-xs text-amber">PLAYGROUND · open to every wallet</p> : null}
                </BracketCard>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
