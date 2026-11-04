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
import { useEstate, useMilestones, useProposals } from "@/lib/hooks";
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
      <EstateBanners estate={e} />
      <EstateHeader
        e={e}
        slug={estateSlug(account)}
        right={isHolder || isDev ? <LinkButton href={`/estates/${estateSlug(account)}/votes/new`} variant="primary" size="sm">New proposal</LinkButton> : null}
      />
      <div className="mb-6 space-y-2">
        <h2 className="text-2xl font-semibold">Holder votes</h2>
        <p className="max-w-2xl text-sm text-muted">
          One vote per allocation token, cast by whoever holds it. A proposal passes the moment more than half of the electorate votes yes. Tokens allocated after a proposal opened can&apos;t vote on it.
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
  const avail = useQuery({
    queryKey: ["votes-available", estate, p.id, accountId],
    queryFn: () => E.votesAvailable(estate, p.id, accountId!),
    enabled: !!accountId && p.status === "Open",
    retry: 0,
  });
  const expired = p.status === "Open" && nsToMs(p.expires_at) < Date.now();
  const need = Math.floor(p.electorate / 2) + 1;
  const vote = async (approve: boolean) => {
    if (!accountId) return connect();
    const r = await run(`Vote ${approve ? "yes" : "no"} on #${p.id}`, () => callNoPopup(accountId, E.vote(estate, p.id, approve)), {
      success: `Your ${avail.data ?? ""} token vote(s) are recorded.`,
    });
    if (r) qc.invalidateQueries({ queryKey: ["proposals", estate] });
  };
  return (
    <li>
      <BracketCard tone={p.status === "Executed" ? "teal" : p.status === "Rejected" ? "red" : p.status === "Open" ? "amber" : "default"} className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="mono text-xs text-muted">#{p.id} · opened {formatDateTime(p.created_at)}</p>
            <p className="font-display text-lg font-semibold">{describeProposal(p.kind, ms)}</p>
            <p className="flex flex-wrap items-center gap-1 text-sm text-muted">by <AccountChip account={p.proposer} /></p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge kind="proposal" status={p.status} />
            {p.status === "Open" ? <CountdownChip until={p.expires_at} /> : null}
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <p className="mono text-sm">Yes {p.yes} / {p.electorate} <span className="text-muted">(needs {need})</span></p>
            <Bar value={p.electorate ? (p.yes / p.electorate) * 100 : 0} label={`${p.yes} yes of ${p.electorate}`} />
          </div>
          <div>
            <p className="mono text-sm">No {p.no} / {p.electorate}</p>
            <Bar value={p.electorate ? (p.no / p.electorate) * 100 : 0} tone="red" label={`${p.no} no of ${p.electorate}`} />
          </div>
        </div>
        <details className="text-xs text-muted">
          <summary className="min-h-9 cursor-pointer">Exact proposal</summary>
          <pre className="mono overflow-auto bg-bg p-2">{JSON.stringify(p.kind, null, 2)}</pre>
          <p>Voted units: {p.voted.length ? p.voted.join(", ") : "none yet"}</p>
        </details>
        {p.status === "Open" && !expired ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" onClick={() => vote(true)} disabled={!!accountId && avail.data === 0}><ThumbsUp className="h-4 w-4" aria-hidden /> Vote yes</Button>
            <Button onClick={() => vote(false)} disabled={!!accountId && avail.data === 0}><ThumbsDown className="h-4 w-4" aria-hidden /> Vote no</Button>
            {accountId ? <span className="mono text-xs text-muted">{avail.data === undefined ? "…" : `${avail.data} eligible token(s)`}</span> : null}
          </div>
        ) : null}
        {expired ? (
          <Button size="sm" onClick={async () => {
            if (!accountId) return connect();
            const r = await run(`Expire #${p.id}`, () => callNoPopup(accountId, E.expireProposal(estate, p.id)));
            if (r) qc.invalidateQueries({ queryKey: ["proposals", estate] });
          }}>Mark as expired</Button>
        ) : null}
      </BracketCard>
    </li>
  );
}
