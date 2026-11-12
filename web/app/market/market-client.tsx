"use client";

import Link from "next/link";
import { useQueries } from "@tanstack/react-query";
import { Info } from "lucide-react";
import { MonoAmount } from "@/components/chain";
import { BuyListingButton } from "@/components/unit-bits";
import { BracketCard, EmptyState, ErrorState, LoadingCard } from "@/components/ui";
import { ESTATES } from "@/lib/config";
import { listAllUnits, useAllEstates } from "@/lib/hooks";
import { explainError } from "@/lib/errors";
import { estateSlug } from "@/lib/estates";
import { formatDate, toBig, unitDisplay } from "@/lib/format";

export function MarketClient() {
  const qs = useQueries({ queries: ESTATES.map((e) => ({ queryKey: ["units", e], queryFn: () => listAllUnits(e), retry: 1, staleTime: 5000 })) });
  const estates = new Map(useAllEstates(ESTATES).map((x) => [x.account, x.q.data]));
  const loading = qs.some((q) => q.isLoading);
  const failed = qs.map((q, i) => ({ estate: ESTATES[i], q })).filter((x) => x.q.error);
  const listings = qs.flatMap((q, i) => (q.data ?? []).filter((u) => u.listing).map((u) => ({ estate: ESTATES[i], u })));
  if (loading) return <LoadingCard lines={4} />;
  return (
    <div className="space-y-4">
      {failed.length === ESTATES.length && ESTATES.length ? <ErrorState error={failed[0].q.error} title="Couldn't read any estate" onRetry={() => failed.forEach((x) => x.q.refetch())} /> : failed.length ? (
        <ul className="space-y-2" aria-label="Estates that failed to load">
          {failed.map(({ estate, q }) => (
            <li key={estate} role="alert" className="corners corners-red flex flex-wrap items-center justify-between gap-2 bg-red/5 p-3 text-sm">
              <span>Couldn&apos;t load listings from <span className="mono">{estateSlug(estate)}</span>: {explainError(q.error).message} Its listings aren&apos;t shown.</span>
              <button type="button" className="mono min-h-9 text-xs underline" onClick={() => q.refetch()}>Try again</button>
            </li>
          ))}
        </ul>
      ) : null}
      {!listings.length ? (
        <EmptyState title="Nothing listed right now">Holders can list a unit from “My units”. Units whose holder misses an instalment are listed here automatically.</EmptyState>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {listings.map(({ estate, u }) => {
            const remaining = toBig(u.price) - toBig(u.paid);
            const isDefault = u.listing!.kind === "Default";
            return (
              <li key={`${estate}-${u.id}`}>
                <BracketCard tone={isDefault ? "red" : "default"} className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <Link href={`/estates/${estateSlug(estate)}/units/${u.id}`} className="mono text-xl font-normal hover:text-orange">{unitDisplay(u.id)}</Link>
                      <p className="text-sm text-muted">{u.label} · {estateSlug(estate)}</p>
                    </div>
                    <span className={`mono inline-flex items-center gap-1 px-2 py-1 text-xs ${isDefault ? "bg-red/10 text-red" : "bg-accent/10 text-accent"}`} title={isDefault ? "The holder missed an instalment. They get the ask back minus a fixed penalty; the penalty goes to the developer." : "Listed by the holder."}>
                      <Info className="h-3.5 w-3.5" aria-hidden />{isDefault ? "DEFAULT" : "VOLUNTARY"}
                    </span>
                  </div>
                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    <div><dt className="label">Ask</dt><dd><MonoAmount value={u.listing!.ask} account={u.account} /></dd></div>
                    <div><dt className="label">Paid so far</dt><dd><MonoAmount value={u.paid} account={u.account} /></dd></div>
                    <div className="col-span-2"><dt className="label">You inherit</dt><dd className="text-sm">credit of <MonoAmount value={u.paid} naira={false} /> · remaining <MonoAmount value={(remaining > 0n ? remaining : 0n).toString()} naira={false} />{u.next_due ? ` · next due ${formatDate(u.next_due.due_at)}` : ""}</dd></div>
                  </dl>
                  <BuyListingButton estate={estate} u={u} frozen={!!estates.get(estate)?.frozen} />
                </BracketCard>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
