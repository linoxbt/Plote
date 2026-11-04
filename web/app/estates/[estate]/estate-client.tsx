"use client";

import { EstateBanners } from "@/components/banners";
import { Activity, EscrowSummary, EstateHeader, UnitGrid, useEstateData } from "@/components/estate-bits";
import { MilestoneTrack } from "@/components/milestones";
import { BracketCard, ErrorState, LoadingCard, Page } from "@/components/ui";
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
          <h2 className="mb-4 text-xl font-semibold">Milestones</h2>
          {ms.data ? <MilestoneTrack milestones={ms.data} detailed mobilisationBps={e.params.mobilisation_bps} /> : ms.error ? <ErrorState error={ms.error} /> : <LoadingCard lines={2} />}
        </BracketCard>
        <EscrowSummary e={e} units={units.data} />
        <BracketCard>
          <h2 className="mb-4 text-xl font-semibold">Units</h2>
          {units.data ? <UnitGrid estate={account} units={units.data} /> : units.error ? <ErrorState error={units.error} onRetry={() => units.refetch()} /> : <LoadingCard lines={3} />}
        </BracketCard>
        <BracketCard>
          <h2 className="mb-4 text-xl font-semibold">Recent activity</h2>
          <Activity estate={account} />
        </BracketCard>
      </div>
    </Page>
  );
}
