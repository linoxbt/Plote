"use client";

import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";
import { clsx } from "clsx";
import { MonoAmount } from "@/components/chain";
import { useTx } from "@/components/toast";
import { useWallet } from "@/components/wallet";
import { BracketCard, Button, ErrorState, KV, LoadingCard, Page, PageHeader, explorerTxUrl } from "@/components/ui";
import { estate as E } from "@/lib/estate";
import { estateSlug } from "@/lib/estates";
import { shortHash, toBig, unitDisplay } from "@/lib/format";
import { sendTx } from "@/lib/near";
import { explorerUrl, oneclick, statusStep } from "@/lib/oneclick";
import { unit as U } from "@/lib/unit";

const STEPS = ["Waiting for deposit", "Deposit seen", "Swapping", "Delivered to unit"];

export function PayStatusClient({ depositAddress }: { depositAddress: string }) {
  const q = useQuery({
    queryKey: ["oneclick-status", depositAddress],
    queryFn: () => oneclick.status(depositAddress),
    refetchInterval: (query) => (["SUCCESS", "REFUNDED", "FAILED"].includes(query.state.data?.status ?? "") ? false : 5000),
    retry: 2,
  });
  const recipient = (q.data?.quoteResponse?.quoteRequest?.recipient as string | undefined) ?? null;
  const dot = recipient?.indexOf(".") ?? -1;
  const unitId = recipient && dot > 0 ? recipient.slice(0, dot) : null;
  const estate = recipient && dot > 0 ? recipient.slice(dot + 1) : null;
  const unit = useQuery({ queryKey: ["unit", estate, unitId], queryFn: () => E.getUnit(estate!, unitId!), enabled: !!estate && !!unitId, retry: 0, refetchInterval: 10_000 });
  const { accountId, connect } = useWallet();
  const { run } = useTx();
  const qc = useQueryClient();

  if (q.isLoading) return <Page narrow><LoadingCard lines={4} /></Page>;
  if (q.error) return <Page narrow><ErrorState error={q.error} title="Couldn't read this payment from 1Click" onRetry={() => q.refetch()} /></Page>;
  const st = q.data!;
  const step = statusStep(st.status);
  const failed = st.status === "REFUNDED" || st.status === "FAILED";
  const quote = st.quoteResponse?.quote;
  const unattributed = unit.data ? toBig(unit.data.unattributed) : 0n;

  return (
    <Page narrow>
      <PageHeader eyebrow="CROSS-CHAIN PAYMENT · NEAR INTENTS" title={failed ? (st.status === "REFUNDED" ? "Refunded" : "Payment failed") : st.status === "SUCCESS" ? "Delivered to the unit" : "Payment in progress"}>
        <span className="mono break-all text-xs">{depositAddress}</span>
      </PageHeader>
      <BracketCard tone={failed ? "red" : st.status === "SUCCESS" ? "teal" : "amber"} className="space-y-6">
        <ol className="grid gap-3 sm:grid-cols-4" aria-label="Progress">
          {STEPS.map((t, i) => {
            const done = !failed && (i < step || (i === step && st.status === "SUCCESS"));
            const active = !failed && i === step && st.status !== "SUCCESS";
            return (
              <li key={t} className={clsx("flex items-center gap-2 border-l-2 pl-3 text-sm sm:border-l-0 sm:border-t-2 sm:pl-0 sm:pt-2", done ? "border-teal text-teal" : active ? "border-amber text-amber" : "border-line text-muted")} aria-current={active ? "step" : undefined}>
                {done ? <Check className="h-4 w-4" aria-hidden /> : active ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <span className="mono">{i + 1}</span>}
                {t}
              </li>
            );
          })}
        </ol>
        {failed ? (
          <p className="text-sm">
            {st.status === "REFUNDED" ? "1Click couldn't complete the swap and sent your funds back to the refund address on the origin chain." : "The swap failed. If funds left your wallet they are refunded to your refund address."}
            {st.swapDetails?.refundedAmountFormatted ? ` Refunded: ${st.swapDetails.refundedAmountFormatted}.` : ""}
          </p>
        ) : null}
        <dl>
          <KV k="Status">{st.status}</KV>
          <KV k="You send">{quote ? `${quote.amountInFormatted}` : "—"}</KV>
          <KV k="Unit receives">{quote ? `${quote.amountOutFormatted} USDC` : "—"}</KV>
          <KV k="Recipient unit">{recipient ?? "—"}</KV>
          <KV k="Origin tx">{st.swapDetails?.originChainTxHashes?.[0] ? (st.swapDetails.originChainTxHashes[0].explorerUrl ? <a className="underline" href={st.swapDetails.originChainTxHashes[0].explorerUrl} target="_blank" rel="noreferrer">{shortHash(st.swapDetails.originChainTxHashes[0].hash)} ↗</a> : shortHash(st.swapDetails.originChainTxHashes[0].hash)) : "—"}</KV>
          <KV k="NEAR tx">{st.swapDetails?.nearTxHashes?.[0] ? <a className="underline" href={explorerTxUrl(st.swapDetails.nearTxHashes[0])} target="_blank" rel="noreferrer">{shortHash(st.swapDetails.nearTxHashes[0])} ↗</a> : "—"}</KV>
          <KV k="Synced to the estate">{st.synced ? "yes" : st.status === "SUCCESS" ? "pending" : "—"}</KV>
        </dl>
        <div className="flex flex-wrap gap-2">
          <a href={explorerUrl(depositAddress)} target="_blank" rel="noreferrer" className="btn btn-ghost corners">1Click explorer ↗</a>
          {estate && unitId ? (
            <Button onClick={async () => {
              if (!accountId) return connect();
              const r = await run("Sync now", () => sendTx(U.syncDeposits(recipient!)));
              if (r) qc.invalidateQueries();
            }}>Sync now</Button>
          ) : null}
          {estate && unitId ? <Link href={`/estates/${estateSlug(estate)}/units/${unitId}`} className="btn btn-ghost corners">View {unitDisplay(unitId)}</Link> : null}
        </div>
      </BracketCard>
      {unattributed > 0n && estate && unitId ? (
        <BracketCard tone="amber" className="mt-6 space-y-3">
          <p className="font-display text-lg font-semibold">Your payment landed after the reservation ended</p>
          <p className="text-sm text-muted">
            <MonoAmount value={unattributed.toString()} account={recipient} /> is waiting on the unit as unclaimed. If your reservation ended recently, claiming sends it back to your NEAR account ({unit.data?.last_reservation?.by ?? "the last reserver"}). After the late-claim window it goes to Plote&apos;s recovery account instead.
          </p>
          <Button variant="primary" onClick={async () => {
            if (!accountId) return connect();
            const r = await run("Claim my late payment", () => sendTx(E.sweepUnattributed(estate, unitId)), { success: "Sent back to the last reserver." });
            if (r) qc.invalidateQueries();
          }}>Claim my late payment</Button>
        </BracketCard>
      ) : null}
    </Page>
  );
}
