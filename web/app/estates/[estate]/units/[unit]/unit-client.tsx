"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { EstateBanners } from "@/components/banners";
import { AccountChip, CountdownChip, MonoAmount, StatusBadge } from "@/components/chain";
import { Activity } from "@/components/estate-bits";
import { MilestoneTrack } from "@/components/milestones";
import { DefaultCard, DefaultExplainer } from "@/components/default-resale";
import { PayFromOtherChain } from "@/components/pay-other-chain";
import { ReservationActions } from "@/components/reservation";
import { useTx } from "@/components/toast";
import { EvidenceThumbs, ListingCard, PlanTable, PositionCard, UnitImage } from "@/components/unit-bits";
import { BracketCard, Button, ChainLink, ErrorState, KV, LinkButton, LoadingCard, Page, Tabs, tabPanelProps } from "@/components/ui";
import { useWallet } from "@/components/wallet";
import { nextRefundOpensAt } from "@/lib/default";
import { estate as E } from "@/lib/estate";
import { estateAccount, estateSlug } from "@/lib/estates";
import { formatDate, formatDateTime, formatNear, formatUsd, toBig, unitDisplay } from "@/lib/format";
import { useEstate, useEvidenceList, useGenuineEstate, useMilestones, useNftToken, usePendingLien, useUnit, useUsdcBalance } from "@/lib/hooks";
import { sendTx, viewAccount } from "@/lib/near";
import type { EstateView, MilestoneView, UnitView } from "@/lib/types";

type Tab = "timeline" | "payments" | "proofs" | "contract";

export function UnitClient({ slug, unitId }: { slug: string; unitId: string }) {
  const account = estateAccount(slug);
  const est = useEstate(account);
  const unit = useUnit(account, unitId, { poll: 10_000 });
  const ms = useMilestones(account);
  const token = useNftToken(account, unitId, { enabled: !!unit.data && unit.data.status !== "Available" && unit.data.status !== "Reserved" });
  const evs = useEvidenceList(account);
  const genuine = useGenuineEstate(account);
  const pendingLien = usePendingLien(account, unitId);
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
  const holderIsMe = !!accountId && (u.holder === accountId || token.data?.owner_id === accountId);
  const taken = u.status === "Allocated" || u.status === "InDefault" || u.status === "HandedOver";

  return (
    <Page>
      <EstateBanners estate={e} account={account} />
      <nav className="mono mb-4 text-xs text-muted" aria-label="Breadcrumb">
        <Link href="/estates" className="hover:text-text">Estates</Link> / <Link href={`/estates/${s}`} className="hover:text-text">{e.name}</Link> / {unitDisplay(u.id)}
      </nav>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_1fr]">
        <div className="space-y-4">
          <BracketCard className="p-2">
            <UnitImage e={e} u={u} ms={ms.data} token={token.data} />
          </BracketCard>
          <div>
            <h1 className="text-3xl font-normal"><span className="mono">{unitDisplay(u.id)}</span></h1>
            <p className="text-muted">{u.label}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusBadge status={u.status} />
              {holderIsMe ? <span className="mono text-xs text-orange-ink">You hold this unit</span> : null}
            </div>
            <div className="mt-3"><span className="label">Price</span><MonoAmount value={u.price} account={u.account} size="lg" /></div>
          </div>
        </div>

        <div className="space-y-6">
          {pendingLien.data && accountId && pendingLien.data.lender === accountId ? (
            <BracketCard tone="accent" className="space-y-2">
              <p className="font-display text-lg font-normal">You&apos;re named as lender on {unitDisplay(u.id)}.</p>
              <p className="text-sm text-muted">The holder proposed a lien up to {formatUsd(pendingLien.data.cap)}. It only takes effect when you accept it.</p>
              <LinkButton href={`/me/units/${s}/${u.id}#accept-lien`} variant="primary">Review and accept</LinkButton>
            </BracketCard>
          ) : null}
          {genuine.data && !genuine.data.genuine ? null : u.status === "Available" && !u.ready ? (
            <BracketCard tone="amber" className="space-y-2">
              <p className="font-display text-xl font-normal">Being set up.</p>
              <p className="text-sm text-muted">This unit&apos;s account isn&apos;t registered on USDC yet, so it can&apos;t be reserved or paid. The developer can retry the setup from the developer console.</p>
            </BracketCard>
          ) : u.status === "Available" ? (
            <BracketCard tone="orange" className="space-y-3">
              <p className="font-display text-xl font-normal">This unit is available.</p>
              <p className="text-sm text-muted">Reserve it for {Math.round(Number(e.params.reserve_ttl_ns) / 6e10)} minutes with a 0.05 NEAR storage deposit (refundable — storage, not price), then pay at least {e.params.min_initial_bps / 100}% of the price to get the allocation token.</p>
              <DefaultExplainer e={e} u={u} className="text-muted" />
              <LinkButton href={`/buy/${s}/${u.id}`} variant="primary">Reserve →</LinkButton>
            </BracketCard>
          ) : null}
          {u.status === "Reserved" ? (
            <BracketCard tone="amber" className="space-y-3">
              <p className="font-display text-xl font-normal">{reservedByMe ? "Reserved by you." : "Reserved."}</p>
              <p className="flex flex-wrap items-center gap-2 text-sm">by <AccountChip account={u.reservation?.by} /> <CountdownChip until={u.reservation?.expires_at} label="until" /></p>
              {reservedByMe ? (
                <div className="flex flex-wrap gap-2">
                  <LinkButton href={`/buy/${s}/${u.id}?step=pay`} variant="primary">Pay from NEAR wallet</LinkButton>
                </div>
              ) : null}
            </BracketCard>
          ) : null}
          <ReservationActions estate={account} e={e} u={u} />
          {u.status !== "Available" && u.status !== "Reserved" ? (
            <BracketCard>
              <PositionCard e={e} u={u} />
              {holderIsMe ? <div className="mt-4"><LinkButton href={`/me/units/${s}/${u.id}`} variant="primary">Manage my unit</LinkButton></div> : null}
            </BracketCard>
          ) : null}
          {taken && u.status !== "HandedOver" ? <RefundCard account={account} e={e} u={u} ms={ms.data} isHolder={holderIsMe} accountId={accountId} /> : null}
          {u.status === "Allocated" ? <DefaultCard estate={account} e={e} u={u} /> : null}
          <ListingCard estate={account} e={e} u={u} />
          {genuine.data?.genuine && u.ready ? <PayFromOtherChain slug={s} u={u} /> : null}
          <BracketCard>
            <h2 className="mb-3 text-lg font-normal">Build progress</h2>
            {ms.data ? <MilestoneTrack milestones={ms.data} detailed mobilisationBps={e.params.mobilisation_bps} /> : ms.error ? <ErrorState error={ms.error} /> : <LoadingCard lines={2} />}
          </BracketCard>
          <div>
            <Tabs<Tab> idBase="unit" value={tab} onChange={setTab} tabs={[{ id: "timeline", label: "Timeline" }, { id: "payments", label: "Payments" }, { id: "proofs", label: "Proofs" }, { id: "contract", label: "Contract" }]} />
            <div className="pt-4" {...tabPanelProps("unit", tab)}>
              {tab === "timeline" ? (
                <BracketCard className="space-y-4">
                  <PlanTable u={u} />
                  <p className="text-sm text-muted">
                    Public watch page: <Link className="underline hover:text-orange-ink" href={`/w/${s}/${u.id}`}>/w/{s}/{u.id}</Link>
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

/** M8 · Refund, on the public unit page: countdown to "refunds open" (deadline + grace) for everyone; the red button for the holder. */
function RefundCard({ account, e, u, ms, isHolder, accountId }: { account: string; e: EstateView; u: UnitView; ms: MilestoneView[] | undefined; isHolder: boolean; accountId: string | null }) {
  const { run } = useTx();
  const qc = useQueryClient();
  const refundable = toBig(u.refundable_now);
  const opensAt = nextRefundOpensAt(ms);
  const toLender = u.lien && toBig(u.lien.cap) > 0n;
  if (u.refunds_open && refundable > 0n) {
    return (
      <BracketCard tone="red" className="space-y-3">
        <h2 className="text-lg font-normal">Refunds are open</h2>
        <p className="text-sm">
          A deadline passed without a verified stage{e.frozen?.refunds_open ? " (or holders opened refunds with a freeze vote)" : ""}. The holder can take back everything not yet
          released: <MonoAmount value={u.refundable_now} account={u.account} size="lg" />. No vote or permission needed.
        </p>
        {isHolder ? (
          <>
            <p className="text-sm text-muted">Your allocation token will be burned once everything is refunded, and the unit goes back on sale. This can&apos;t be undone.</p>
            {toLender ? <p className="text-sm text-amber">A lender&apos;s lien is set: the refund goes to the lender <span className="mono">{u.lien!.lender}</span> first, up to its cap of {formatUsd(u.lien!.cap)}, not to you.</p> : null}
            <Button variant="danger" onClick={async () => {
              const msg = toLender
                ? `Refund ${formatUsd(u.refundable_now)}?\n\nA lien is set, so up to ${formatUsd(u.lien!.cap)} goes to the lender ${u.lien!.lender} first, not to you. Anything above the cap stays refundable to you afterwards.`
                : `Refund ${formatUsd(u.refundable_now)} to ${accountId}?\n\nYour token for ${unitDisplay(u.id)} will be burned and the unit goes back on sale. This can't be undone.`;
              if (!window.confirm(msg)) return;
              const r = await run("Get my money back", () => sendTx(E.refund(account, u.id)), { success: toLender ? `Refund sent to the lender ${u.lien!.lender} (up to its cap).` : "Refund sent to your account." });
              if (r) await Promise.all([qc.invalidateQueries({ queryKey: ["unit", account, u.id] }), qc.invalidateQueries({ queryKey: ["units", account] }), qc.invalidateQueries({ queryKey: ["estate", account] }), qc.invalidateQueries({ queryKey: ["my-units"] })]);
            }}>Get my money back</Button>
          </>
        ) : <p className="text-xs text-muted">Only the holder of {unitDisplay(u.id)} can ask for this refund.</p>}
      </BracketCard>
    );
  }
  return (
    <BracketCard className="space-y-2">
      <h2 className="text-lg font-normal">Refund rule</h2>
      <p className="text-sm text-muted">If a stage isn&apos;t verified by its deadline plus the grace period, refunds open automatically: the holder gets back everything not yet released and the token is burned. No vote needed.</p>
      {opensAt ? (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <CountdownChip until={opensAt} label="refunds would open in" tone="orange" endedLabel="any moment now" />
          <span className="mono text-xs text-muted">{formatDateTime(opensAt)}</span>
        </p>
      ) : <p className="text-sm text-muted">Every stage is approved, so refunds won&apos;t open.</p>}
    </BracketCard>
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
