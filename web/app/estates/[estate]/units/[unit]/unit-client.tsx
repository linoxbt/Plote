"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { EstateBanners } from "@/components/banners";
import { AccountChip, CountdownChip, MonoAmount, StatusBadge } from "@/components/chain";
import { Activity } from "@/components/estate-bits";
import { MilestoneTrack } from "@/components/milestones";
import { EvidenceThumbs, ListingCard, PlanTable, PositionCard, UnitImage } from "@/components/unit-bits";
import { BracketCard, ChainLink, ErrorState, KV, LinkButton, LoadingCard, Page, Tabs } from "@/components/ui";
import { useWallet } from "@/components/wallet";
import { ONECLICK_ENABLED } from "@/lib/config";
import { estateAccount, estateSlug } from "@/lib/estates";
import { formatDate, formatNear, unitDisplay } from "@/lib/format";
import { useEstate, useEvidenceList, useMilestones, useNftToken, useUnit, useUsdcBalance } from "@/lib/hooks";
import { viewAccount } from "@/lib/near";

type Tab = "timeline" | "payments" | "proofs" | "contract";

export function UnitClient({ slug, unitId }: { slug: string; unitId: string }) {
  const account = estateAccount(slug);
  const est = useEstate(account);
  const unit = useUnit(account, unitId, { poll: 10_000 });
  const ms = useMilestones(account);
  const token = useNftToken(account, unitId, { enabled: !!unit.data && unit.data.status !== "Available" && unit.data.status !== "Reserved" });
  const evs = useEvidenceList(account);
  const { accountId } = useWallet();
  const [tab, setTab] = useState<Tab>("timeline");
  const s = estateSlug(account);

  if (est.isLoading || unit.isLoading) return <Page><LoadingCard lines={6} /></Page>;
  if (!est.data) return <Page><ErrorState error={est.error} title={`Couldn't load ${account}`} onRetry={() => est.refetch()} /></Page>;
  if (unit.error) return <Page><ErrorState error={unit.error} title={`Couldn't load unit ${unitDisplay(unitId)}`} onRetry={() => unit.refetch()} /></Page>;
  const e = est.data;
  const u = unit.data;
  if (!u) {
    return (
      <Page narrow>
        <ErrorState error={{ message: "E_UNIT_NOT_FOUND" }} title={`${unitDisplay(unitId)} isn't a unit of ${e.name}`} />
      </Page>
    );
  }
  const reservedByMe = u.status === "Reserved" && u.reservation?.by === accountId;
  const holderIsMe = !!accountId && u.holder === accountId;

  return (
    <Page>
      <EstateBanners estate={e} />
      <nav className="mono mb-4 text-xs text-muted" aria-label="Breadcrumb">
        <Link href="/estates" className="hover:text-text">Estates</Link> / <Link href={`/estates/${s}`} className="hover:text-text">{e.name}</Link> / {unitDisplay(u.id)}
      </nav>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_1fr]">
        <div className="space-y-4">
          <BracketCard className="p-2">
            <UnitImage e={e} u={u} ms={ms.data} token={token.data} />
          </BracketCard>
          <div>
            <h1 className="text-3xl font-semibold"><span className="mono">{unitDisplay(u.id)}</span></h1>
            <p className="text-muted">{u.label}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusBadge status={u.status} />
              {holderIsMe ? <span className="mono text-xs text-teal">You hold this unit</span> : null}
            </div>
            <div className="mt-3"><span className="label">Price</span><MonoAmount value={u.price} account={u.account} size="lg" /></div>
          </div>
        </div>

        <div className="space-y-6">
          {u.status === "Available" ? (
            <BracketCard tone="teal" className="space-y-3">
              <p className="font-display text-xl font-semibold">This unit is available.</p>
              <p className="text-sm text-muted">Reserve it for {Math.round(Number(e.params.reserve_ttl_ns) / 6e10)} minutes with a 0.05 NEAR storage deposit (refundable — storage, not price), then pay at least {e.params.min_initial_bps / 100}% of the price to get the allocation token.</p>
              <LinkButton href={`/buy/${s}/${u.id}`} variant="primary">Reserve →</LinkButton>
            </BracketCard>
          ) : null}
          {u.status === "Reserved" ? (
            <BracketCard tone="amber" className="space-y-3">
              <p className="font-display text-xl font-semibold">{reservedByMe ? "Reserved by you." : "Reserved."}</p>
              <p className="flex flex-wrap items-center gap-2 text-sm">by <AccountChip account={u.reservation?.by} /> <CountdownChip until={u.reservation?.expires_at} label="until" /></p>
              {reservedByMe ? (
                <div className="flex flex-wrap gap-2">
                  <LinkButton href={`/buy/${s}/${u.id}?step=pay`} variant="primary">Pay from NEAR wallet</LinkButton>
                  {ONECLICK_ENABLED ? <LinkButton href={`/buy/${s}/${u.id}?step=pay&method=oneclick`}>Pay from another chain</LinkButton> : null}
                </div>
              ) : null}
            </BracketCard>
          ) : null}
          {u.status !== "Available" && u.status !== "Reserved" ? (
            <BracketCard>
              <PositionCard e={e} u={u} />
              {holderIsMe ? <div className="mt-4"><LinkButton href={`/me/units/${s}/${u.id}`} variant="primary">Manage my unit</LinkButton></div> : null}
            </BracketCard>
          ) : null}
          <ListingCard estate={account} e={e} u={u} />
          <BracketCard>
            <h2 className="mb-3 text-lg font-semibold">Build progress</h2>
            {ms.data ? <MilestoneTrack milestones={ms.data} detailed mobilisationBps={e.params.mobilisation_bps} /> : ms.error ? <ErrorState error={ms.error} /> : <LoadingCard lines={2} />}
          </BracketCard>
          <div>
            <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ id: "timeline", label: "Timeline" }, { id: "payments", label: "Payments" }, { id: "proofs", label: "Proofs" }, { id: "contract", label: "Contract" }]} />
            <div className="pt-4" role="tabpanel">
              {tab === "timeline" ? (
                <BracketCard className="space-y-4">
                  <PlanTable u={u} />
                  <p className="text-sm text-muted">
                    Public watch page: <Link className="underline hover:text-teal" href={`/w/${s}/${u.id}`}>/w/{s}/{u.id}</Link>
                  </p>
                </BracketCard>
              ) : null}
              {tab === "payments" ? <BracketCard><Activity estate={account} unit={u.id} /></BracketCard> : null}
              {tab === "proofs" ? (evs.data ? <EvidenceThumbs estate={account} list={evs.data} /> : evs.error ? <ErrorState error={evs.error} /> : <LoadingCard />) : null}
              {tab === "contract" ? <ContractTab account={account} unitAccount={u.account} codeHash={e.unit_code_hash} allocatedAt={u.allocated_at} /> : null}
            </div>
          </div>
        </div>
      </div>
    </Page>
  );
}

function ContractTab({ account, unitAccount, codeHash, allocatedAt }: { account: string; unitAccount: string; codeHash: string | null; allocatedAt: string | null }) {
  const acct = useQuery({ queryKey: ["view-account", unitAccount], queryFn: () => viewAccount(unitAccount), retry: 0 });
  const bal = useUsdcBalance(unitAccount);
  return (
    <BracketCard>
      <dl>
        <KV k="Unit account"><span>{unitAccount} <ChainLink account={unitAccount} /></span></KV>
        <KV k="Estate contract"><span>{account} <ChainLink account={account} /></span></KV>
        <KV k="Unit code hash (global)">{acct.data?.code_hash ?? codeHash ?? "—"}</KV>
        <KV k="USDC on the unit account"><MonoAmount value={bal.data ?? null} account={unitAccount} naira={false} /></KV>
        <KV k="NEAR for storage">{acct.data ? `${formatNear(acct.data.amount)} NEAR` : "—"}</KV>
        <KV k="Allocated">{formatDate(allocatedAt)}</KV>
      </dl>
      <p className="mt-3 text-xs text-muted">The unit account has no access keys: only the estate contract&apos;s code can move its USDC.</p>
    </BracketCard>
  );
}
