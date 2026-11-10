"use client";

import Link from "next/link";
import { AlertOctagon } from "lucide-react";
import { MonoAmount, StatusBadge } from "@/components/chain";
import { HouseNFT } from "@/components/house-nft";
import { DueChip } from "@/components/unit-bits";
import { RequireWallet, useWallet } from "@/components/wallet";
import { Bar, BracketCard, EmptyState, ErrorState, LinkButton, LoadingCard } from "@/components/ui";
import { estateSlug } from "@/lib/estates";
import { pct, toBig, unitDisplay } from "@/lib/format";
import { useMyUnits } from "@/lib/hooks";

export function MeClient() {
  const { accountId } = useWallet();
  const q = useMyUnits(accountId);
  return (
    <RequireWallet what="your units">
      {q.isLoading ? <LoadingCard lines={4} /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data?.units.length ? (
        <EmptyState title="No units yet." action={<LinkButton href="/check" variant="primary">[Check a unit]</LinkButton>}>
          Units you hold appear here as soon as your first payment mints the allocation token.
        </EmptyState>
      ) : (
        <div className="space-y-4">
          {q.data.errors.length ? <p className="text-xs text-amber">Couldn&apos;t read {q.data.errors.map((x) => estateSlug(x.estate)).join(", ")} — those units may be missing.</p> : null}
          <ul className="grid gap-4 md:grid-cols-2">
            {q.data.units.map(({ estate, token, unit: u }) => {
              const s = estateSlug(estate);
              const refundable = u ? toBig(u.refundable_now) : 0n;
              return (
                <li key={`${estate}-${token.token_id}`}>
                  <BracketCard className="grid gap-4 sm:grid-cols-[140px_1fr]">
                    <Link href={`/me/units/${s}/${token.token_id}`} aria-label={`Manage ${unitDisplay(token.token_id)}`}>
                      <HouseNFT media={token.metadata?.media} estateName={s} unitLabel={unitDisplay(token.token_id)} unitId={token.token_id} approvedCount={u ? Math.round(u.progress_bps / 2500) : 0} total={4} status={u?.status ?? "Allocated"} paid={u?.paid ?? "0"} price={u?.price ?? "0"} />
                    </Link>
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/me/units/${s}/${token.token_id}`} className="mono text-xl font-normal hover:text-orange">{unitDisplay(token.token_id)}</Link>
                        <StatusBadge status={u?.status} />
                        {refundable > 0n ? <span className="mono inline-flex items-center gap-1 bg-red/10 px-2 py-1 text-xs text-red"><AlertOctagon className="h-3.5 w-3.5" aria-hidden />REFUND OPEN</span> : null}
                      </div>
                      <p className="text-sm text-muted">{u?.label ?? token.metadata?.title ?? ""} · {s}</p>
                      {u ? (
                        <>
                          <p className="mono text-sm">{u.progress_bps / 100}% built</p>
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
