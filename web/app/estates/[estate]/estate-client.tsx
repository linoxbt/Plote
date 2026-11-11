"use client";

import { EstateBanners } from "@/components/banners";
import { Activity, EscrowSummary, EstateHeader, UnitGrid, useEstateData } from "@/components/estate-bits";
import { MilestoneTrack } from "@/components/milestones";
import Link from "next/link";
import { DoorOpen } from "lucide-react";
import { BracketCard, ErrorState, LinkButton, LoadingCard, Page } from "@/components/ui";
import { estateAccount, estateSlug } from "@/lib/estates";
import { useMilestones } from "@/lib/hooks";

export function EstateClient({ slug }: { slug: string }) {
  const account = estateAccount(slug);
  const { est, units } = useEstateData(account);
  const ms = useMilestones(account, { enabled: !!est.data });
  if (est.isLoading) return <Page><LoadingCard lines={6} /></Page>;
  if (!est.data) return <Page><ErrorState error={est.error} title={`Couldn't load the estate ${account}`} onRetry={() => est.refetch()} /></Page>;
  const e = est.data;
  return (
    <Page>
      <EstateBanners estate={e} />
      <EstateHeader e={e} slug={estateSlug(account)} />
      <div className="space-y-6">
        <BracketCard>
          <h2 className="mb-4 text-xl font-normal">Milestones</h2>
          {ms.data ? <MilestoneTrack milestones={ms.data} detailed mobilisationBps={e.params.mobilisation_bps} /> : ms.error ? <ErrorState error={ms.error} /> : <LoadingCard lines={2} />}
        </BracketCard>
        <EscrowSummary e={e} units={units.data} />
        <BracketCard>
          <h2 className="mb-4 text-xl font-normal">Units</h2>
          {units.data ? <UnitGrid estate={account} units={units.data} /> : units.error ? <ErrorState error={units.error} onRetry={() => units.refetch()} /> : <LoadingCard lines={3} />}
        </BracketCard>
        <BracketCard>
          <h2 className="mb-4 text-xl font-normal">Recent activity</h2>
          <Activity estate={account} />
        </BracketCard>
        <BracketCard className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <h2 className="text-lg font-normal">At the gate</h2>
            <p className="text-sm text-muted">
              After handover, holders show a gate pass from their phone. Guards check it here against the chain — no login, nothing to install.
              {" "}Developer? <Link href={`/dev/estates/${estateSlug(account)}`} prefetch={false} className="underline hover:text-orange">Open the console</Link>.
            </p>
          </div>
          <LinkButton href={`/gate/${estateSlug(account)}`} size="sm" prefetch={false}><DoorOpen className="h-4 w-4" aria-hidden /> Gate scanner</LinkButton>
        </BracketCard>
      </div>
    </Page>
  );
}
