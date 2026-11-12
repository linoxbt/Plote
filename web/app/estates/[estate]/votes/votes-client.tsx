"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { EstateBanners } from "@/components/banners";
import { AccountChip, CountdownChip, StatusBadge } from "@/components/chain";
import { EstateHeader } from "@/components/estate-bits";
import { useTx } from "@/components/toast";
import { useWallet } from "@/components/wallet";
import { Bar, BracketCard, Button, EmptyState, ErrorState, LinkButton, LoadingCard, Page } from "@/components/ui";
import { describeProposal, estate as E } from "@/lib/estate";
import { estateAccount, estateSlug } from "@/lib/estates";
import { formatDateTime, nsToMs } from "@/lib/format";
import { useEstate, useMilestones, useNow, useProposals } from "@/lib/hooks";
import { callNoPopup } from "@/lib/near";
import type { MilestoneView, ProposalView } from "@/lib/types";
import { LoginKeyToggle } from "./login-key";

export function VotesClient({ slug }: { slug: string }) {
  const account = estateAccount(slug);
  const est = useEstate(account);
  const props = useProposals(account, { poll: 10_000 });
  const ms = useMilestones(account);
  const { accountId } = useWallet();
  const supply = useQuery({
    queryKey: ["nft-supply", account, accountId],
    queryFn: () => E.nftSupplyForOwner(account, accountId!),
    enabled: !!accountId,
    retry: 0,
  });
  const isHolder = Number(supply.data ?? 0) > 0;
  const isDev = !!accountId && est.data?.developer_id === accountId;

  if (est.isLoading) return <Page><LoadingCard lines={6} /></Page>;
  if (!est.data) return <Page><ErrorState error={est.error} onRetry={() => est.refetch()} /></Page>;
  const e = est.data;
  const list = props.data ?? [];
  const open = list.filter((p) => p.status === "Open");
  const past = list.filter((p) => p.status !== "Open");
  return (
    <Page>
      <EstateBanners estate={e} account={account} />
      <EstateHeader
        e={e}
        slug={estateSlug(account)}
        right={isHolder || isDev ? <LinkButton href={`/estates/${estateSlug(account)}/votes/new`} variant="primary" size="sm">New proposal</LinkButton> : null}
      />
      <div className="mb-6 space-y-2">
        <h2 className="text-2xl font-normal">Holder votes</h2>
        <p className="max-w-2xl text-sm text-muted">
          Each allocation token allocated before a proposal opened votes once, cast by whoever holds it, weighted by the USDC paid into its unit (net of
          refunds, in whole USDC, up to the price), and the total weight is fixed when the proposal opens. A veto passes when yes is more than half of
          that weight. Every other kind also needs a majority of the distinct holders, and enough units sold to reach the quorum (at least 3 tokens and
          a quarter of the units). Opening a proposal costs a 0.05 NEAR deposit, kept by the estate.
        </p>
        {isHolder ? <LoginKeyToggle contractId={account} /> : accountId ? <p className="text-sm text-muted">You don&apos;t hold a token in this estate, so you can&apos;t vote here.</p> : null}
      </div>
      {props.error ? <ErrorState error={props.error} onRetry={() => props.refetch()} /> : !props.data ? <LoadingCard lines={4} /> : (
        <div className="space-y-8">
          <section>
            <h3 className="label mb-3">Open</h3>
            {open.length ? (
              <ul className="space-y-3">{open.map((p) => <ProposalCard key={p.id} estate={account} p={p} ms={ms.data} />)}</ul>
            ) : (
              <EmptyState title="No open proposals">Holders can propose to replace the surveyor, veto a sign-off, freeze releases or extend a deadline.</EmptyState>
            )}
          </section>
          {past.length ? (
            <section>
              <h3 className="label mb-3">Past</h3>
              <ul className="space-y-3">{past.map((p) => <ProposalCard key={p.id} estate={account} p={p} ms={ms.data} />)}</ul>
            </section>
          ) : null}
        </div>
      )}
    </Page>
  );
}

function ProposalCard({ estate, p, ms }: { estate: string; p: ProposalView; ms?: MilestoneView[] }) {
  const { accountId, connect } = useWallet();
  const { run } = useTx();
  const qc = useQueryClient();
  const now = useNow(5000);
  const avail = useQuery({
    queryKey: ["votes-available", estate, p.id, accountId],
    queryFn: () => E.votesAvailable(estate, p.id, accountId!),
    enabled: !!accountId && p.status === "Open",
    retry: 0,
  });
  const weight = useQuery({
    queryKey: ["vote-weight", estate, p.id, accountId],
    queryFn: () => E.voteWeightAvailable(estate, p.id, accountId!),
    enabled: !!accountId && p.status === "Open" && !!p.weighted,
    retry: 0,
  });
  const unitWord = p.weighted ? "USDC weight" : "votes";
  const fmt = (n: number) => n.toLocaleString("en-US");
  const expired = p.status === "Open" && nsToMs(p.expires_at) < now;
  const need = Math.floor(p.electorate / 2) + 1;
  const isVeto = !!p.kind && typeof p.kind === "object" && "Veto" in (p.kind as Record<string, unknown>);
  const holdersRule = !isVeto && p.weighted && p.holders_eligible > 0;
  const refreshProposal = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["proposals", estate] }),
      qc.invalidateQueries({ queryKey: ["votes-available", estate, p.id] }),
      qc.invalidateQueries({ queryKey: ["vote-weight", estate, p.id] }),
      qc.invalidateQueries({ queryKey: ["estate", estate] }),
    ]);
  const vote = async (approve: boolean) => {
    if (!accountId) return connect();
    const r = await run(`Vote ${approve ? "yes" : "no"} on #${p.id}`, () => callNoPopup(accountId, E.vote(estate, p.id, approve)), {
      success: p.weighted && weight.data !== undefined ? `Your vote is recorded with a weight of ${fmt(weight.data)} USDC.` : `Your ${avail.data ?? ""} token vote(s) are recorded.`,
    });
    if (r) await refreshProposal();
  };
  return (
    <li>
      <BracketCard tone={p.status === "Executed" ? "orange" : p.status === "Rejected" ? "red" : p.status === "Open" ? "amber" : "default"} className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="mono text-xs text-muted">#{p.id} · opened {formatDateTime(p.created_at)}</p>
            <p className="font-display text-lg font-normal">{describeProposal(p.kind, ms)}</p>
            <p className="flex flex-wrap items-center gap-1 text-sm text-muted">by <AccountChip account={p.proposer} /></p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge kind="proposal" status={p.status} />
            {p.status === "Open" ? <CountdownChip until={p.expires_at} /> : null}
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <p className="mono text-sm">Yes {fmt(p.yes)} / {fmt(p.electorate)} <span className="text-muted">(needs {fmt(need)})</span></p>
            <Bar value={p.electorate ? (p.yes / p.electorate) * 100 : 0} label={`${p.yes} yes of ${p.electorate} ${unitWord}`} />
          </div>
          <div>
            <p className="mono text-sm">No {fmt(p.no)} / {fmt(p.electorate)}</p>
            <Bar value={p.electorate ? (p.no / p.electorate) * 100 : 0} tone="red" label={`${p.no} no of ${p.electorate} ${unitWord}`} />
          </div>
        </div>
        {holdersRule ? (
          <p className="mono text-sm">
            Holders yes {fmt(p.holders_yes)} / {fmt(p.holders_eligible)} <span className="text-muted">(needs {fmt(Math.floor(p.holders_eligible / 2) + 1)} distinct holders)</span>
          </p>
        ) : null}
        <p className="mono text-xs text-muted">
          {p.weighted ? "USDC-weighted: each token counts the whole USDC paid into its unit, net of refunds, up to the price." : "One vote per token (opened before weighted votes)."}
          {holdersRule ? " It also needs a majority of distinct holders, so one large holder can't pass it alone." : ""}
        </p>
        <details className="text-xs text-muted">
          <summary className="min-h-9 cursor-pointer">Exact proposal</summary>
          <pre className="mono overflow-auto bg-bg p-2">{JSON.stringify(p.kind, null, 2)}</pre>
          <p>Voted units: {p.voted.length ? p.voted.join(", ") : "none yet"}</p>
        </details>
        {p.status === "Open" && !expired ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" onClick={() => vote(true)} disabled={!!accountId && avail.data === 0}><ThumbsUp className="h-4 w-4" aria-hidden /> Vote yes</Button>
            <Button onClick={() => vote(false)} disabled={!!accountId && avail.data === 0}><ThumbsDown className="h-4 w-4" aria-hidden /> Vote no</Button>
            {accountId ? (
              <span className="mono text-xs text-muted">
                {avail.data === undefined ? "…" : `${avail.data} eligible token(s)`}
                {p.weighted && weight.data !== undefined ? ` · weight ${fmt(weight.data)} USDC` : ""}
              </span>
            ) : null}
          </div>
        ) : null}
        {expired ? (
          <Button size="sm" onClick={async () => {
            if (!accountId) return connect();
            const r = await run(`Expire #${p.id}`, () => callNoPopup(accountId, E.expireProposal(estate, p.id)));
            if (r) await refreshProposal();
          }}>Mark as expired</Button>
        ) : null}
      </BracketCard>
    </li>
  );
}
