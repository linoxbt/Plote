"use client";

import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { ShoppingCart } from "lucide-react";
import { nftApprovedCount } from "@/lib/estate";
import { estateSlug } from "@/lib/estates";
import { formatDate, pct, shareOf, toBig, unitDisplay } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import { sendTx } from "@/lib/near";
import { usdc } from "@/lib/usdc";
import type { EstateView, EvidenceView, MilestoneView, NftToken, UnitView } from "@/lib/types";
import { AccountChip, CountdownChip, MonoAmount, StatusBadge } from "./chain";
import { HouseNFT } from "./house-nft";
import { useTx } from "./toast";
import { useWallet } from "./wallet";
import { Bar, BracketCard, Button, EmptyState } from "./ui";

export function UnitImage({ e, u, ms, token, className }: { e: EstateView; u: UnitView; ms?: MilestoneView[]; token?: NftToken | null; className?: string }) {
  return (
    <HouseNFT
      media={token?.metadata?.media ?? null}
      estateName={e.name}
      unitLabel={u.label}
      unitId={u.id}
      approvedCount={nftApprovedCount(ms)}
      total={ms?.length || 4}
      status={u.status}
      paid={u.paid}
      price={u.price}
      className={className}
    />
  );
}

export function PositionCard({ e, u }: { e: EstateView; u: UnitView }) {
  const releasedCap = shareOf(toBig(u.paid) < toBig(u.price) ? u.paid : u.price, 10000);
  return (
    <div className="space-y-4">
      <dl className="grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="label">Holder</dt>
          <dd><AccountChip account={u.holder} /></dd>
        </div>
        <div>
          <dt className="label">Unit account</dt>
          <dd><AccountChip account={u.account} max={30} /></dd>
        </div>
      </dl>
      <div className="space-y-1">
        <div className="flex justify-between text-sm"><span className="text-muted">Paid</span><MonoAmount value={u.paid} account={u.account} /></div>
        <Bar value={pct(u.paid, u.price)} label={`${pct(u.paid, u.price)}% of price paid`} />
        <p className="mono text-xs text-muted">{pct(u.paid, u.price)}% of the price</p>
      </div>
      <div className="space-y-1">
        <div className="flex justify-between text-sm"><span className="text-muted">Released to developer</span><MonoAmount value={u.released} account={e.payout_id} /></div>
        <Bar value={pct(u.released, releasedCap || 1n)} tone="accent" label="Share of paid released" />
        <p className="mono text-xs text-muted">{u.progress_bps / 100}% of the build is approved</p>
      </div>
      <dl className="grid gap-3 sm:grid-cols-2">
        <div>
          <dt className="label">Refundable now</dt>
          <dd><MonoAmount value={u.refundable_now} account={u.account} className={toBig(u.refundable_now) > 0n ? "text-red" : ""} /></dd>
        </div>
        <div>
          <dt className="label">Next instalment</dt>
          <dd>
            {u.next_due ? (
              <span className="flex flex-wrap items-center gap-2">
                <MonoAmount value={u.next_due.shortfall} naira={false} />
                <span className="mono text-xs text-muted">by {formatDate(u.next_due.due_at)}</span>
                <DueChip dueAt={u.next_due.due_at} />
              </span>
            ) : (
              <span className="mono text-muted">none due</span>
            )}
          </dd>
        </div>
        {toBig(u.unattributed) > 0n ? (
          <div>
            <dt className="label">Unclaimed deposit</dt>
            <dd><MonoAmount value={u.unattributed} account={u.account} className="text-amber" /></dd>
          </div>
        ) : null}
        {u.lien ? (
          <div>
            <dt className="label">Lender lien</dt>
            <dd className="text-sm"><AccountChip account={u.lien.lender} /> up to <MonoAmount value={u.lien.cap} naira={false} /></dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

export function DueChip({ dueAt }: { dueAt: string }) {
  const now = useNow(30_000);
  const ms = Number(toBig(dueAt) / 1_000_000n) - now;
  if (ms < 0) return <StatusBadge kind="unit" status="InDefault" suffix="overdue" />;
  return <CountdownChip until={dueAt} tone={ms < 7 * 86400_000 ? "amber" : "orange"} label="due" />;
}

export function PlanTable({ u }: { u: UnitView }) {
  if (!u.plan.length) return <p className="text-sm text-muted">No instalment plan — pay any time.</p>;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-muted">
          <th className="label py-1 font-normal">Due</th>
          <th className="label py-1 text-right font-normal">Total paid by then</th>
          <th className="label py-1 text-right font-normal">Status</th>
        </tr>
      </thead>
      <tbody>
        {u.plan.map((p) => {
          const met = toBig(u.paid) >= toBig(p.cumulative);
          return (
            <tr key={p.due_at} className="border-t border-line">
              <td className="mono py-2">{formatDate(p.due_at)}</td>
              <td className="py-2 text-right"><MonoAmount value={p.cumulative} naira={false} /></td>
              <td className="mono py-2 text-right text-xs">{met ? <span className="text-orange">✓ met</span> : <span className="text-muted">open</span>}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Atomic resale buy: usdc.ft_transfer_call(estate, ask, {"buy": id}) — S4. */
export function BuyListingButton({ estate, u }: { estate: string; u: UnitView }) {
  const { accountId, connect } = useWallet();
  const { run } = useTx();
  const qc = useQueryClient();
  if (!u.listing) return null;
  const mine = accountId && accountId === u.holder;
  return (
    <Button
      variant="primary"
      disabled={!!mine}
      onClick={async () => {
        if (!accountId) return connect();
        const r = await run(`Buy ${unitDisplay(u.id)} for $${(Number(u.listing!.ask) / 1e6).toLocaleString()}`, () =>
          sendTx(usdc.ftTransferCall(estate, u.listing!.ask, JSON.stringify({ buy: u.id }))),
          { success: "Paid, and the token moved to you in the same transaction." },
        );
        if (r) qc.invalidateQueries();
      }}
    >
      <ShoppingCart className="h-4 w-4" aria-hidden /> {mine ? "Your listing" : "Buy this unit"}
    </Button>
  );
}

export function ListingCard({ estate, e, u }: { estate: string; e: EstateView; u: UnitView }) {
  if (!u.listing) return null;
  const remaining = toBig(u.price) - toBig(u.paid);
  const isDefault = u.listing.kind === "Default";
  return (
    <BracketCard tone={isDefault ? "red" : "accent"} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-display text-lg font-normal">{isDefault ? "Default listing" : "For sale"}</p>
        <span className={`mono px-2 py-1 text-xs ${isDefault ? "bg-red/10 text-red" : "bg-accent/10 text-accent"}`}>{u.listing.kind.toUpperCase()}</span>
      </div>
      {isDefault ? (
        <p className="text-sm text-muted">
          The holder missed an instalment. The unit is listed for what they paid; when it sells they get that back minus a fixed {e.params.penalty_bps / 100}%, which goes to the developer.
        </p>
      ) : null}
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div><dt className="label">Ask</dt><dd><MonoAmount value={u.listing.ask} account={u.account} /></dd></div>
        <div><dt className="label">Paid so far</dt><dd><MonoAmount value={u.paid} account={u.account} /></dd></div>
        <div className="col-span-2">
          <dt className="label">What you inherit</dt>
          <dd className="text-sm">
            <MonoAmount value={u.paid} naira={false} /> of credit in escrow · remaining balance <MonoAmount value={(remaining > 0n ? remaining : 0n).toString()} />
            {u.next_due ? <> · next instalment due {formatDate(u.next_due.due_at)}</> : null}
          </dd>
        </div>
      </dl>
      <BuyListingButton estate={estate} u={u} />
    </BracketCard>
  );
}

export function EvidenceThumbs({ estate, list }: { estate: string; list: EvidenceView[] }) {
  if (!list.length) return <EmptyState title="No photos yet">Proofs appear here when the surveyor submits a site photo.</EmptyState>;
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {list.map((ev) => (
        <li key={ev.id}>
          <Link href={`/proof/${estateSlug(estate)}/${ev.id}`} className="corners corners-hover block bg-surface p-2">
            <div className="aspect-[4/3] overflow-hidden bg-surface-2">
              <img src={ev.url} alt={`Evidence #${ev.id}`} className="h-full w-full object-cover" loading="lazy" />
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="mono text-xs text-muted">#{ev.id}</span>
              <StatusBadge kind="evidence" status={ev.status} />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

