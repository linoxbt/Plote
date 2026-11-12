"use client";

import Link from "next/link";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Coins, Globe, Wallet } from "lucide-react";
import { clsx } from "clsx";
import { EstateBanners } from "@/components/banners";
import { NftReveal } from "@/components/celebration";
import { DefaultExplainer } from "@/components/default-resale";
import { CountdownChip, MonoAmount } from "@/components/chain";
import { OneClickPay } from "@/components/oneclick-pay";
import { ReservationActions } from "@/components/reservation";
import { useTx } from "@/components/toast";
import { RequireWallet, useWallet } from "@/components/wallet";
import { BracketCard, Button, ErrorState, Field, LinkButton, LoadingCard, Page } from "@/components/ui";
import { IS_TESTNET, ONECLICK_ENABLED } from "@/lib/config";
import { estate as E, nftApprovedCount } from "@/lib/estate";
import { estateAccount, estateSlug } from "@/lib/estates";
import { formatDuration, formatUsd, nsToMs, parseUsdc, shareOf, toBig, unitDisplay } from "@/lib/format";
import { assertPayable } from "@/lib/genuine";
import { useEstate, useGenuineEstate, useMilestones, useUnit, useUsdcBalance, useUsdcRegistered } from "@/lib/hooks";
import { sendTx, sendTxs, type TxResult, type TxSpec } from "@/lib/near";
import { assertFtCallAccepted } from "@/lib/tx-outcome";
import { FAUCET_AMOUNT, usdc } from "@/lib/usdc";

const STEPS = ["Reserve", "Pay", "Done"];

export function BuyClient({ slug, unitId, method: initialMethod }: { slug: string; unitId: string; method: "wallet" | "oneclick" }) {
  const account = estateAccount(slug);
  const s = estateSlug(account);
  const est = useEstate(account);
  const unit = useUnit(account, unitId, { poll: 5000 });
  const ms = useMilestones(account);
  const { accountId } = useWallet();
  const bal = useUsdcBalance(accountId, { poll: 10_000 });
  const reg = useUsdcRegistered(accountId);
  const genuine = useGenuineEstate(account);
  const { run } = useTx();
  const qc = useQueryClient();
  const [method, setMethod] = useState<"wallet" | "oneclick">(ONECLICK_ENABLED ? initialMethod : "wallet");
  const [amountStr, setAmountStr] = useState("");
  const [amountErr, setAmountErr] = useState<string | null>(null);

  if (est.isLoading || unit.isLoading) return <Page narrow><LoadingCard lines={5} /></Page>;
  if (!est.data) return <Page narrow><ErrorState error={est.error} onRetry={() => est.refetch()} /></Page>;
  if (!unit.data) return <Page narrow><ErrorState error={unit.error ?? { message: "E_UNIT_NOT_FOUND" }} onRetry={() => unit.refetch()} /></Page>;
  const e = est.data;
  const u = unit.data;
  const minBase = shareOf(u.price, e.params.min_initial_bps);
  const mine = !!accountId && (u.reservation?.by === accountId || u.holder === accountId);
  const step = u.holder === accountId && accountId ? 2 : u.status === "Reserved" && u.reservation?.by === accountId ? 1 : 0;
  const takenByOther = !mine && u.status !== "Available";
  const notGenuine = genuine.data && !genuine.data.genuine ? genuine.data.why : null;
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["unit", account, u.id] }),
      qc.invalidateQueries({ queryKey: ["units", account] }),
      qc.invalidateQueries({ queryKey: ["usdc-bal"] }),
      qc.invalidateQueries({ queryKey: ["usdc-reg"] }),
      qc.invalidateQueries({ queryKey: ["my-units"] }),
      qc.invalidateQueries({ queryKey: ["my-positions"] }),
    ]);

  const amountBase = (() => {
    try { return amountStr ? parseUsdc(amountStr) : minBase.toString(); } catch { return null; }
  })();

  /** Same checks for "Reserve and pay" and "Pay": > 0, the first payment reaches the minimum, enough USDC. */
  const amountProblem = (base: string | null, reserving: boolean): string | null => {
    if (!base) return "Enter an amount like 8500";
    if (toBig(base) <= 0n) return "Amount must be more than 0";
    const paidBefore = reserving ? 0n : toBig(u.paid);
    const firstPayment = reserving || u.status === "Reserved";
    if (firstPayment && paidBefore + toBig(base) < minBase) return `The first payment must reach at least ${formatUsd(minBase)} (${e.params.min_initial_bps / 100}% of the price) to mint the token.`;
    if (bal.data && toBig(bal.data) < toBig(base)) return `You have ${formatUsd(bal.data)} USDC.`;
    return null;
  };

  const payTxs = (base: string): TxSpec[] => [...(reg.data === false ? [usdc.storageDeposit(accountId!)] : []), usdc.ftTransferCall(u.account, base, "")];

  /** The ft_transfer_call is the last transaction; a refused deposit (USDC returned) is a failure. */
  const checkPaid = (res: TxResult[], base: string) => {
    const last = res[res.length - 1];
    if (last) assertFtCallAccepted(last, base, "deposit");
    return res;
  };

  const reserve = async (andPay: boolean) => {
    if (andPay) {
      const problem = amountProblem(amountBase, true);
      if (problem) return setAmountErr(problem);
      setAmountErr(null);
      const base = amountBase!;
      const r = await run(`Reserve ${unitDisplay(u.id)} and pay ${formatUsd(base)}`, async () => {
        await assertPayable(account, u);
        return checkPaid(await sendTxs([E.reserve(account, u.id), ...payTxs(base)]), base);
      }, { success: "Reserved and paid. Wallet payments count straight away; the token mints once they reach the minimum." });
      if (r) await refresh();
    } else {
      setAmountErr(null);
      const r = await run(`Reserve ${unitDisplay(u.id)}`, async () => {
        await assertPayable(account, u);
        return sendTx(E.reserve(account, u.id));
      }, { success: `Reserved for ${formatDuration(nsToMs(e.params.reserve_ttl_ns))}.` });
      if (r) await refresh();
    }
  };

  const pay = async () => {
    const problem = amountProblem(amountBase, false);
    if (problem) return setAmountErr(problem);
    setAmountErr(null);
    const base = amountBase!;
    const r = await run(`Pay ${formatUsd(base)} into ${unitDisplay(u.id)}`, async () => {
      await assertPayable(account, u);
      return checkPaid(await sendTxs(payTxs(base)), base);
    }, { success: "Payment accepted by the unit's own account." });
    if (r) await refresh();
  };

  const presets: [string, bigint][] = [["10%", shareOf(u.price, 1000)], ["25%", shareOf(u.price, 2500)], ["Full", toBig(u.price) - toBig(u.paid)]];

  return (
    <Page narrow>
      <EstateBanners estate={e} account={account} />
      <p className="mono mb-2 text-xs tracking-[0.12em] text-orange">{e.name.toUpperCase()} · {unitDisplay(u.id)}</p>
      <h1 className="mb-1 text-3xl font-normal">{u.label}</h1>
      <p className="mb-6"><MonoAmount value={u.price} account={u.account} size="lg" /></p>
      <ol className="mb-6 flex gap-2" aria-label="Steps">
        {STEPS.map((t, i) => (
          <li key={t} className={clsx("mono flex flex-1 items-center gap-2 border-b-2 pb-2 text-sm", i < step ? "border-orange text-orange" : i === step ? "border-text text-text" : "border-line text-muted")} aria-current={i === step ? "step" : undefined}>
            {i < step ? <Check className="h-4 w-4" aria-hidden /> : <span>{i + 1}.</span>} {t}
          </li>
        ))}
      </ol>
      <RequireWallet what="reserving a unit">
        {notGenuine ? (
          <BracketCard tone="red" className="space-y-2">
            <p className="font-display text-xl font-normal">This isn&apos;t a Plote estate.</p>
            <p className="text-sm">{notGenuine} Plote won&apos;t reserve or pay here.</p>
          </BracketCard>
        ) : !u.ready ? (
          <BracketCard tone="amber" className="space-y-2">
            <p className="font-display text-xl font-normal">This unit is still being set up.</p>
            <p className="text-sm text-muted">Its account isn&apos;t registered on USDC yet, so it can&apos;t take a reservation or a payment. The developer can finish the setup from the developer console.</p>
            <LinkButton href={`/estates/${s}`}>See other units</LinkButton>
          </BracketCard>
        ) : takenByOther ? (
          <BracketCard tone="amber" className="space-y-3">
            <p className="font-display text-xl font-normal">{u.status === "Reserved" ? "Someone else has reserved this unit." : "This unit is taken."}</p>
            {u.status === "Reserved" ? <CountdownChip until={u.reservation?.expires_at} label="reservation" /> : null}
            <LinkButton href={`/estates/${s}`}>See other units</LinkButton>
          </BracketCard>
        ) : step === 0 ? (
          <BracketCard className="space-y-4">
            <h2 className="text-xl font-normal">1. Reserve</h2>
            <p className="text-muted">Reserving locks {unitDisplay(u.id)} for you for <strong className="text-text">{formatDuration(nsToMs(e.params.reserve_ttl_ns))}</strong>. It needs a <strong className="text-text">0.05 NEAR storage deposit</strong> — storage, not price — which you get back if the reservation ends or the unit is refunded.</p>
            <p className="text-sm text-muted">Then pay at least {formatUsd(minBase)} ({e.params.min_initial_bps / 100}% of the price) into the unit&apos;s own account, <span className="mono">{u.account}</span>, to receive the allocation token.</p>
            <AmountPicker value={amountStr} onChange={(v) => { setAmountStr(v); setAmountErr(null); }} presets={presets} err={amountErr} min={minBase} />
            <BracketCard tone="amber" className="bg-surface-2"><DefaultExplainer e={e} u={u} /></BracketCard>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => reserve(true)}><Wallet className="h-4 w-4" aria-hidden /> Reserve and pay (one approval)</Button>
              <Button onClick={() => reserve(false)}>Reserve only</Button>
            </div>
            <p className="text-xs text-muted">Wallets that support batched signing approve both in one step; others ask twice.</p>
            {IS_TESTNET ? <FaucetInline /> : null}
          </BracketCard>
        ) : step === 1 ? (
          <BracketCard className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xl font-normal">2. Pay</h2>
              <CountdownChip until={u.reservation?.expires_at} label="reserved" />
            </div>
            {toBig(u.paid) > 0n ? <p className="text-sm">Paid so far: <MonoAmount value={u.paid} account={u.account} /> — the token mints once it reaches {formatUsd(minBase)}.</p> : null}
            <div className="flex gap-2" role="radiogroup" aria-label="Payment method">
              <button type="button" role="radio" aria-checked={method === "wallet"} onClick={() => setMethod("wallet")} className={clsx("btn corners flex-1", method === "wallet" ? "corners-orange text-orange" : "btn-ghost")}><Wallet className="h-4 w-4" aria-hidden /> NEAR wallet</button>
              <button type="button" role="radio" aria-checked={method === "oneclick"} onClick={() => ONECLICK_ENABLED && setMethod("oneclick")} disabled={!ONECLICK_ENABLED} className={clsx("btn corners flex-1", method === "oneclick" ? "corners-orange text-orange" : "btn-ghost")} title={ONECLICK_ENABLED ? undefined : "Other chains use NEAR Intents, which only runs on mainnet"}><Globe className="h-4 w-4" aria-hidden /> Another chain</button>
            </div>
            {!ONECLICK_ENABLED ? <p className="text-xs text-muted">Paying from Base, Solana or Ethereum uses NEAR Intents, which has no testnet. The mainnet demo build shows it.</p> : null}
            <AmountPicker value={amountStr} onChange={(v) => { setAmountStr(v); setAmountErr(null); }} presets={presets} err={amountErr} min={minBase} />
            <DefaultExplainer e={e} u={u} className="border-l-2 border-amber pl-3" />
            {method === "wallet" ? (
              <div className="space-y-3">
                <p className="mono text-sm text-muted">Your USDC: {bal.data ? formatUsd(bal.data) : "—"} {reg.data === false ? "· not registered yet (adds a 0.00125 NEAR registration)" : ""}</p>
                <Button variant="primary" onClick={pay}>Pay {amountBase ? formatUsd(amountBase) : ""} into {unitDisplay(u.id)}</Button>
                {IS_TESTNET ? <FaucetInline /> : null}
              </div>
            ) : amountBase && genuine.data?.genuine && u.account === `${u.id}.${account}` ? (
              <OneClickPay estate={s} unit={u.id} recipient={u.account} amount={amountBase} />
            ) : null}
          </BracketCard>
        ) : (
          <BracketCard tone="accent" className="space-y-5 text-center">
            <h2 className="text-2xl font-normal">3. Done — {unitDisplay(u.id)} is yours.</h2>
            <NftReveal estateName={e.name} unitLabel={u.label} unitId={u.id} approvedCount={nftApprovedCount(ms.data)} total={ms.data?.length || 4} status={u.status} paid={u.paid} price={u.price} />
            <p className="text-muted">You hold the only allocation token this unit will ever have. Your money sits in <span className="mono">{u.account}</span> until each stage is proven.</p>
            <div className="flex flex-wrap justify-center gap-2">
              <LinkButton href={`/w/${s}/${u.id}`} variant="primary">Share your house</LinkButton>
              <LinkButton href={`/me/units/${s}/${u.id}#beneficiary`}>Set a beneficiary</LinkButton>
              <LinkButton href="/me">My units</LinkButton>
            </div>
          </BracketCard>
        )}
        <ReservationActions estate={account} e={e} u={u} className="mt-4 space-y-4" />
      </RequireWallet>
      <p className="mt-6 text-sm text-muted"><Link href={`/estates/${s}/units/${u.id}`} className="underline">← Unit details</Link></p>
    </Page>
  );
}

function AmountPicker({ value, onChange, presets, err, min }: { value: string; onChange: (v: string) => void; presets: [string, bigint][]; err: string | null; min: bigint }) {
  return (
    <div className="space-y-2">
      <Field label="Amount (USDC)" htmlFor="amount" error={err ?? undefined} hint={`Minimum first payment ${formatUsd(min)}`}>
        <input id="amount" className="input" inputMode="decimal" placeholder={(Number(min) / 1e6).toString()} value={value} onChange={(e) => onChange(e.target.value)} />
      </Field>
      <div className="flex flex-wrap gap-2">
        {presets.map(([k, v]) => (
          <button key={k} type="button" className="btn btn-ghost corners btn-sm" onClick={() => onChange((Number(v) / 1e6).toString())}>{k} · {formatUsd(v)}</button>
        ))}
      </div>
    </div>
  );
}

function FaucetInline() {
  const { accountId } = useWallet();
  const { run } = useTx();
  const qc = useQueryClient();
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
      <Coins className="h-4 w-4" aria-hidden /> Need test USDC?
      <Button size="sm" onClick={async () => { if (!accountId) return; const r = await run("Get 5,000 test USDC", () => sendTx(usdc.mint(FAUCET_AMOUNT, accountId))); if (r) await Promise.all([qc.invalidateQueries({ queryKey: ["usdc-bal", accountId] }), qc.invalidateQueries({ queryKey: ["usdc-reg", accountId] })]); }}>Get 5,000</Button>
    </p>
  );
}
