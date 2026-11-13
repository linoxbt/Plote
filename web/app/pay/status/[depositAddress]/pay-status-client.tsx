"use client";

import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Loader2 } from "lucide-react";
import { clsx } from "clsx";
import { CountdownChip, MonoAmount } from "@/components/chain";
import { QrImage } from "@/components/oneclick-pay";
import { useTx } from "@/components/toast";
import { useWallet } from "@/components/wallet";
import { BracketCard, Button, ErrorState, KV, LoadingCard, Page, PageHeader, explorerTxUrl } from "@/components/ui";
import { estate as E } from "@/lib/estate";
import { estateSlug } from "@/lib/estates";
import { shortHash, toBig, unitDisplay } from "@/lib/format";
import { sendTx } from "@/lib/near";
import { chainName, explorerUrl, oneclick, statusStep } from "@/lib/oneclick";

const STEPS = ["Waiting for deposit", "Deposit seen", "Swapping", "Delivered to unit"];

export function PayStatusClient({ depositAddress, hint }: { depositAddress: string; hint?: { send?: string; symbol?: string; chain?: string } }) {
  const q = useQuery({
    queryKey: ["oneclick-status", depositAddress],
    queryFn: () => oneclick.status(depositAddress),
    // Keep polling past SUCCESS until our server has reported the delivery to the estate (each poll retries that report).
    refetchInterval: (query) => {
      const d = query.state.data;
      if (!d) return 5000;
      if (d.status === "REFUNDED" || d.status === "FAILED") return false;
      if (d.status === "SUCCESS") return d.synced || d.sync === "skipped" || d.sync === "not_needed" || query.state.dataUpdateCount > 60 ? false : 10_000;
      return 5000;
    },
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
      {st.status === "PENDING_DEPOSIT" ? (
        <BracketCard tone="orange" className="mb-6 space-y-4">
          <p className="font-display text-xl font-normal">
            Send exactly {quote?.amountInFormatted ?? hint?.send ?? "the quoted amount"}{hint?.symbol ? ` ${hint.symbol}` : ""}{hint?.chain ? ` on ${chainName(hint.chain)}` : ""}
          </p>
          <div className="flex flex-col items-start gap-4 sm:flex-row">
            <QrImage text={depositAddress} label="QR code of the deposit address" />
            <div className="min-w-0 space-y-2">
              <p className="label">Deposit address</p>
              <p className="mono break-all text-sm">{depositAddress}</p>
              <Button size="sm" onClick={() => navigator.clipboard?.writeText(depositAddress).catch(() => {})}><Copy className="h-4 w-4" aria-hidden /> Copy</Button>
              {quote?.deadline ? <div><CountdownChip until={String(Date.parse(quote.deadline) * 1e6)} label="quote valid" /></div> : null}
              <p className="text-sm text-muted">Send it from your own wallet. This page updates by itself; cross-chain payments can take up to 15 minutes.</p>
            </div>
          </div>
        </BracketCard>
      ) : null}
      <BracketCard tone={failed ? "red" : st.status === "SUCCESS" ? "orange" : "amber"} className="space-y-6">
        <ol className="grid gap-3 sm:grid-cols-4" aria-label="Progress">
          {STEPS.map((t, i) => {
            const done = !failed && (i < step || (i === step && st.status === "SUCCESS"));
            const active = !failed && i === step && st.status !== "SUCCESS";
            return (
              <li key={t} className={clsx("flex items-center gap-2 border-l-2 pl-3 text-sm sm:border-l-0 sm:border-t-2 sm:pl-0 sm:pt-2", done ? "border-orange text-orange-ink" : active ? "border-amber text-amber" : "border-line text-muted")} aria-current={active ? "step" : undefined}>
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
          <KV k="Credited to the unit">{st.synced ? "yes" : st.status !== "SUCCESS" ? "—" : st.sync === "failed" ? "retrying…" : st.sync === "skipped" ? "not recorded by this deployment" : "reporting…"}</KV>
        </dl>
        {st.status === "SUCCESS" && !st.synced ? (
          <p className="text-sm text-muted" aria-live="polite">
            The USDC is in the unit&apos;s account. Plote is now telling the estate contract about it, so it counts towards the unit; this page keeps checking.
            {st.sync_note ? <span className="mono mt-1 block break-words text-xs">{st.sync_note}</span> : null}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <a href={explorerUrl(depositAddress)} target="_blank" rel="noreferrer" className="btn btn-ghost corners">1Click explorer ↗</a>
          <Button onClick={() => { void q.refetch(); void unit.refetch(); }} loading={q.isFetching}>Check again</Button>
          {estate && unitId ? <Link href={`/estates/${estateSlug(estate)}/units/${unitId}`} className="btn btn-ghost corners">View {unitDisplay(unitId)}</Link> : null}
        </div>
      </BracketCard>
      {unattributed > 0n && estate && unitId ? (
        <BracketCard tone="amber" className="mt-6 space-y-3">
          <p className="font-display text-lg font-normal">Your payment landed after the reservation ended</p>
          <p className="text-sm text-muted">
            <MonoAmount value={unattributed.toString()} account={recipient} /> is waiting on the unit as unclaimed. If your reservation ended recently, claiming sends it back to your NEAR account ({unit.data?.last_reservation?.by ?? "the last reserver"}). After the late-claim window it goes to Plote&apos;s recovery account instead.
          </p>
          <Button variant="primary" onClick={async () => {
            if (!accountId) return connect();
            const r = await run("Claim my late payment", () => sendTx(E.sweepUnattributed(estate, unitId)), { success: "Sent back to the last reserver." });
            if (r) await Promise.all([qc.invalidateQueries({ queryKey: ["unit", estate, unitId] }), qc.invalidateQueries({ queryKey: ["units", estate] })]);
          }}>Claim my late payment</Button>
        </BracketCard>
      ) : null}
    </Page>
  );
}
