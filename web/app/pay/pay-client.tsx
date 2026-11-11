"use client";

// S2 · Mainnet payment (SPEC §17.4 "Mainnet Lite"): one real unit account on NEAR mainnet receives a real 1Click
// payment from another chain. Only the mainnet build can do it (NEAR Intents has no testnet); the testnet build
// explains that and links across when the mainnet build's URL is known.

import { useState } from "react";
import { ArrowUpRight, Globe } from "lucide-react";
import { MonoAmount } from "@/components/chain";
import { OneClickPay } from "@/components/oneclick-pay";
import { BracketCard, Field, LinkButton, Page, PageHeader } from "@/components/ui";
import { IS_MAINNET, MAINNET_APP_URL, MAINNET_UNIT_ACCOUNT, ONECLICK_ENABLED } from "@/lib/config";
import { estateSlug } from "@/lib/estates";
import { parseUsdc } from "@/lib/format";
import { useUsdcBalance } from "@/lib/hooks";

const PRESETS = ["2", "5", "10"];

export function PayClient() {
  return (
    <Page narrow>
      <PageHeader eyebrow="Mainnet demo · NEAR Intents" title="Pay from another chain">
        Send USDC or USDT from Base, Solana, Ethereum, Arbitrum and more. 1Click swaps it and delivers native USDC straight into the unit&apos;s own NEAR
        account — not the developer&apos;s, not Plote&apos;s.
      </PageHeader>
      {IS_MAINNET && ONECLICK_ENABLED ? (MAINNET_UNIT_ACCOUNT ? <MainnetPay unitAccount={MAINNET_UNIT_ACCOUNT} /> : <NotConfigured />) : <TestnetNotice />}
    </Page>
  );
}

function MainnetPay({ unitAccount }: { unitAccount: string }) {
  const [amountStr, setAmountStr] = useState("2");
  const bal = useUsdcBalance(unitAccount, { poll: 15_000 });
  const dot = unitAccount.indexOf(".");
  const unitId = dot > 0 ? unitAccount.slice(0, dot) : unitAccount;
  const estate = dot > 0 ? estateSlug(unitAccount.slice(dot + 1)) : "";
  let amount: string | null = null;
  let err: string | null = null;
  try {
    amount = parseUsdc(amountStr || "0");
    if (BigInt(amount) <= 0n) err = "Enter an amount above 0";
  } catch {
    err = "Enter an amount like 2 or 2.50";
  }
  return (
    <div className="space-y-6">
      <BracketCard className="space-y-3">
        <h2 className="text-lg font-normal">The unit</h2>
        <p className="mono break-all text-sm">{unitAccount}</p>
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">USDC in its account now</span>
          <MonoAmount value={bal.data ?? null} account={unitAccount} naira={false} />
        </p>
        <p className="text-xs text-muted">
          Mainnet Lite: this unit account is real and holds real USDC, but it has no estate contract, so mainnet shows the payment rail only. The escrow
          rules (releases on proof, refunds) run on testnet.
        </p>
      </BracketCard>
      <BracketCard className="space-y-4">
        <Field label="Amount to deliver (USDC)" htmlFor="pay-amount" error={err ?? undefined} hint="1Click quotes what to send on your chain to land exactly this much.">
          <input id="pay-amount" className="input" inputMode="decimal" value={amountStr} onChange={(e) => setAmountStr(e.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button key={p} type="button" className="btn btn-ghost btn-sm" aria-pressed={amountStr === p} onClick={() => setAmountStr(p)}>${p}</button>
          ))}
        </div>
      </BracketCard>
      {amount && !err ? <OneClickPay estate={estate} unit={unitId} recipient={unitAccount} amount={amount} /> : null}
    </div>
  );
}

function NotConfigured() {
  return (
    <BracketCard tone="amber" className="space-y-2">
      <p className="font-medium">No mainnet unit is set up on this deployment.</p>
      <p className="text-sm text-muted">
        The mainnet build pays one Mainnet Lite unit account. Set <span className="mono">NEXT_PUBLIC_MAINNET_UNIT_ACCOUNT</span> (and the server&apos;s{" "}
        <span className="mono">MAINNET_UNIT_ACCOUNT</span>) to that account and redeploy.
      </p>
    </BracketCard>
  );
}

function TestnetNotice() {
  return (
    <BracketCard tone="info" className="space-y-4">
      <p className="flex items-center gap-2 font-medium"><Globe className="h-4 w-4 text-info" aria-hidden /> Cross-chain payments run on mainnet.</p>
      <p className="text-sm text-muted">
        They use NEAR Intents (1Click), which has no testnet. This is the testnet build, where you pay from a NEAR wallet with test USDC instead — every
        escrow rule works the same.
      </p>
      <div className="flex flex-wrap gap-2">
        {MAINNET_APP_URL ? (
          <a className="btn btn-primary" href={`${MAINNET_APP_URL.replace(/\/$/, "")}/pay`}>
            Open the mainnet demo <ArrowUpRight className="h-4 w-4" aria-hidden />
          </a>
        ) : null}
        <LinkButton href="/estates/playground" variant={MAINNET_APP_URL ? "ghost" : "primary"}>Pay a Playground unit on testnet</LinkButton>
        <LinkButton href="/payments">How payments work</LinkButton>
      </div>
      {!MAINNET_APP_URL ? <p className="text-xs text-muted">This deployment doesn&apos;t link a mainnet build.</p> : null}
    </BracketCard>
  );
}
