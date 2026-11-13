"use client";

import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { AlertOctagon, Clock, Wallet } from "lucide-react";
import { CountdownChip, MonoAmount, StatusBadge } from "@/components/chain";
import { useTx } from "@/components/toast";
import { HouseNFT } from "@/components/house-nft";
import { DueChip } from "@/components/unit-bits";
import { RequireWallet, useWallet } from "@/components/wallet";
import { Bar, BracketCard, Button, EmptyState, ErrorState, LinkButton, LoadingCard } from "@/components/ui";
import { ESTATES } from "@/lib/config";
import { approvedCount, estate as E, nftApprovedCount } from "@/lib/estate";
import { estateSlug } from "@/lib/estates";
import { pct, toBig, unitDisplay } from "@/lib/format";
import { useAllEstates, useAllMilestones, useMyPositions, useMyUnits } from "@/lib/hooks";
import { sendTx } from "@/lib/near";

export function MeClient() {
  const { accountId } = useWallet();
  const q = useMyUnits(accountId);
  // Stage counts come from each estate's real milestone list (shared, cached queries), not a fixed 4.
  const milestones = new Map(useAllMilestones(ESTATES).map((x) => [x.account, x.q.data]));
  const names = new Map(useAllEstates(ESTATES).map((x) => [x.account, x.q.data?.name]));
  return (
    <RequireWallet what="your units">
      <Positions account={accountId} />
      {q.isLoading ? <LoadingCard lines={4} /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data?.units.length ? (
        <EmptyState title="No units yet." action={<LinkButton href="/check" variant="primary">Check a unit</LinkButton>}>
          Units you hold appear here as soon as your first payment mints the allocation token.
        </EmptyState>
      ) : (
        <div className="space-y-4">
          {q.data.errors.length ? <p className="text-xs text-amber">Couldn&apos;t read {q.data.errors.map((x) => estateSlug(x.estate)).join(", ")} — those units may be missing.</p> : null}
          <ul className="grid gap-4 md:grid-cols-2">
            {q.data.units.map(({ estate, token, unit: u }) => {
              const s = estateSlug(estate);
              const refundable = u ? toBig(u.refundable_now) : 0n;
              const ms = milestones.get(estate);
              return (
                <li key={`${estate}-${token.token_id}`}>
                  <BracketCard className="grid gap-4 sm:grid-cols-[160px_1fr]">
                    <Link href={`/me/units/${s}/${token.token_id}`} aria-label={`Manage ${unitDisplay(token.token_id)}`} className="block self-start">
                      <HouseNFT media={token.metadata?.media} estateName={names.get(estate) ?? s} unitLabel={u?.label ?? token.metadata?.title ?? ""} unitId={token.token_id} approvedCount={nftApprovedCount(ms)} total={ms?.length || 4} status={u?.status ?? "Allocated"} paid={u?.paid ?? "0"} price={u?.price ?? "0"} showMoney={!!u} className="aspect-square w-full max-w-[200px] sm:max-w-none" />
                    </Link>
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/me/units/${s}/${token.token_id}`} className="mono text-xl font-normal hover:text-orange-ink">{unitDisplay(token.token_id)}</Link>
                        <StatusBadge status={u?.status} />
                        {refundable > 0n ? <span className="mono inline-flex items-center gap-1 bg-red/10 px-2 py-1 text-xs text-red"><AlertOctagon className="h-3.5 w-3.5" aria-hidden />REFUND OPEN</span> : null}
                      </div>
                      <p className="text-sm text-muted">{u?.label ?? token.metadata?.title ?? ""} · {s}</p>
                      {u ? (
                        <>
                          <p className="mono text-sm">{u.progress_bps / 100}% built{ms ? ` · ${approvedCount(ms)} of ${ms.length} stages approved` : ""}</p>
                          <Bar value={pct(u.paid, u.price)} label="Paid of price" />
                          <p className="text-sm"><MonoAmount value={u.paid} naira={false} account={u.account} /> <span className="text-muted">of</span> <MonoAmount value={u.price} naira={false} /></p>
                          {u.next_due ? <div className="flex flex-wrap items-center gap-2 text-sm"><span className="text-muted">Next due</span><MonoAmount value={u.next_due.shortfall} naira={false} /><DueChip dueAt={u.next_due.due_at} /></div> : null}
                          {refundable > 0n ? <p className="text-sm text-red">Refundable now: <MonoAmount value={u.refundable_now} naira={false} /></p> : null}
                        </>
                      ) : <p className="text-sm text-muted">Unit details unavailable.</p>}
                      <div className="flex flex-wrap gap-2 pt-1">
                        <LinkButton size="sm" href={`/me/units/${s}/${token.token_id}#pay`} variant="primary">Pay</LinkButton>
                        <LinkButton size="sm" href={`/w/${s}/${token.token_id}`}>Watch page</LinkButton>
                        <LinkButton size="sm" href={`/me/units/${s}/${token.token_id}#sell`}>Sell</LinkButton>
                        {refundable > 0n ? <LinkButton size="sm" variant="danger" href={`/me/units/${s}/${token.token_id}#refund`}>Refund</LinkButton> : null}
                      </div>
                    </div>
                  </BracketCard>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </RequireWallet>
  );
}

/** Reservations still waiting for a first payment, and money the estates owe this account (withdraw_owed). */
function Positions({ account }: { account: string | null }) {
  const p = useMyPositions(account);
  const { run } = useTx();
  const qc = useQueryClient();
  if (!account || !p.data || (!p.data.reservations.length && !p.data.owed.length)) return null;
  return (
    <div className="mb-6 space-y-4">
      {p.data.reservations.length ? (
        <BracketCard tone="amber" className="space-y-3">
          <h2 className="flex items-center gap-2 text-lg font-normal"><Clock className="h-4 w-4 text-amber" aria-hidden /> Your reservations</h2>
          <ul className="space-y-2">
            {p.data.reservations.map(({ estate, unit: u }) => (
              <li key={`${estate}-${u.id}`} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span><span className="mono">{unitDisplay(u.id)}</span> · {estateSlug(estate)} · paid <MonoAmount value={u.paid} naira={false} /></span>
                <span className="flex flex-wrap items-center gap-2">
                  <CountdownChip until={u.reservation?.expires_at} label="reserved" />
                  <LinkButton size="sm" variant="primary" href={`/buy/${estateSlug(estate)}/${u.id}`}>Pay</LinkButton>
                </span>
              </li>
            ))}
          </ul>
        </BracketCard>
      ) : null}
      {p.data.owed.length ? (
        <BracketCard tone="accent" className="space-y-3">
          <h2 className="flex items-center gap-2 text-lg font-normal"><Wallet className="h-4 w-4 text-accent" aria-hidden /> Money waiting for you</h2>
          <p className="text-sm text-muted">A resale payout or reservation refund couldn&apos;t be delivered (for example your account wasn&apos;t registered on USDC), so the estate holds it for you.</p>
          <ul className="space-y-2">
            {p.data.owed.map(({ estate, amount }) => (
              <li key={estate} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>{estateSlug(estate)} owes you <MonoAmount value={amount} naira={false} /></span>
                <Button size="sm" onClick={async () => {
                  const r = await run(`Withdraw from ${estateSlug(estate)}`, () => sendTx(E.withdrawOwed(estate)), { success: "Sent to your account." });
                  if (r) await Promise.all([qc.invalidateQueries({ queryKey: ["my-positions"] }), qc.invalidateQueries({ queryKey: ["usdc-bal"] })]);
                }}>Withdraw</Button>
              </li>
            ))}
          </ul>
        </BracketCard>
      ) : null}
    </div>
  );
}
