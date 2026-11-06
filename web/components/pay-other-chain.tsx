"use client";

// S2 · "Pay from another chain" on every unit page (SPEC §7.3, §10): supported chains as chips (from 1Click
// /v0/tokens, stablecoins only), and the entry into the 1Click flow. Disabled with a one-line reason when the
// build can't use 1Click (NEAR Intents has no testnet).

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { Globe } from "lucide-react";
import { OneClickPay } from "./oneclick-pay";
import { useWallet } from "./wallet";
import { BracketCard, Button, Field, LinkButton } from "./ui";
import { ONECLICK_ENABLED } from "@/lib/config";
import { parseUsdc, unitDisplay } from "@/lib/format";
import { chainName, oneclick, PICKER_CHAINS, STABLE_SYMBOLS } from "@/lib/oneclick";
import type { UnitView } from "@/lib/types";

export const ONECLICK_DISABLED_REASON = "Paying from other chains uses NEAR Intents, which has no testnet — the mainnet demo build shows it.";

/** Chains offered in the picker: PICKER_CHAINS that /v0/tokens actually lists a stablecoin for (all of them until it loads). */
export function ChainChipList({ enabled = ONECLICK_ENABLED, className }: { enabled?: boolean; className?: string }) {
  const q = useQuery({ queryKey: ["oneclick-tokens"], queryFn: oneclick.tokens, retry: 0, staleTime: 600_000, enabled });
  const fromApi = q.data
    ? Array.from(new Set(q.data.filter((t) => STABLE_SYMBOLS.includes(t.symbol.toUpperCase()) && PICKER_CHAINS.includes(t.blockchain)).map((t) => t.blockchain)))
    : [];
  const chains = fromApi.length ? PICKER_CHAINS.filter((c) => fromApi.includes(c) || c === "near") : PICKER_CHAINS;
  return (
    <ul className={clsx("flex flex-wrap gap-2", className)} aria-label="Supported chains">
      {chains.map((c) => (
        <li key={c} className={clsx("mono corners bg-surface-2 px-3 py-1.5 text-sm", !enabled && "text-muted")}>{chainName(c)}</li>
      ))}
    </ul>
  );
}

export function PayFromOtherChain({ slug, u }: { slug: string; u: UnitView }) {
  const { accountId } = useWallet();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const reservedByMe = u.status === "Reserved" && !!accountId && u.reservation?.by === accountId;

  // What the entry does for this unit's state. Money must reach a unit that's reserved or held, or it bounces / sits unattributed.
  let action: React.ReactNode = null;
  let note: string | null = null;
  if (!ONECLICK_ENABLED) {
    note = ONECLICK_DISABLED_REASON;
    action = <Button disabled title={ONECLICK_DISABLED_REASON}><Globe className="h-4 w-4" aria-hidden /> Pay from another chain</Button>;
  } else if (u.status === "Available") {
    note = "Reserve the unit first (NEAR wallet, 0.05 NEAR storage), then pay the deposit from any of these chains.";
    action = <LinkButton href={`/buy/${slug}/${u.id}?method=oneclick`}><Globe className="h-4 w-4" aria-hidden /> Reserve, then pay from another chain</LinkButton>;
  } else if (u.status === "Reserved") {
    if (reservedByMe) action = <LinkButton href={`/buy/${slug}/${u.id}?step=pay&method=oneclick`} variant="primary"><Globe className="h-4 w-4" aria-hidden /> Pay from another chain</LinkButton>;
    else {
      note = "Someone else holds the reservation, so only they can pay into it right now.";
      action = <Button disabled><Globe className="h-4 w-4" aria-hidden /> Pay from another chain</Button>;
    }
  } else if (u.status === "InDefault") {
    note = "This unit is listed after a default; take it over from the listing instead.";
    action = <Button disabled><Globe className="h-4 w-4" aria-hidden /> Pay from another chain</Button>;
  } else {
    note = `Anyone can pay toward ${unitDisplay(u.id)} — the USDC lands on the unit's own account and counts for the holder.`;
    action = open ? null : <Button onClick={() => setOpen(true)}><Globe className="h-4 w-4" aria-hidden /> Pay from another chain</Button>;
  }

  let base: string | null = null;
  try {
    base = amount ? parseUsdc(amount) : null;
  } catch {
    base = null;
  }

  return (
    <BracketCard className="space-y-3" aria-labelledby={`poc-${u.id}`}>
      <h2 id={`poc-${u.id}`} className="text-lg font-semibold">Pay from another chain</h2>
      <ChainChipList />
      {note ? <p className="text-sm text-muted">{note}</p> : null}
      {action}
      {open && ONECLICK_ENABLED ? (
        <div className="space-y-3 border-t border-line pt-3">
          <Field label="Amount the unit should receive (USDC)" htmlFor={`poc-amt-${u.id}`} hint={u.next_due ? `Next instalment: ${Number(u.next_due.shortfall) / 1e6} USDC` : undefined}>
            <input id={`poc-amt-${u.id}`} className="input" inputMode="decimal" value={amount} onChange={(x) => setAmount(x.target.value)} placeholder={u.next_due ? String(Number(u.next_due.shortfall) / 1e6) : "100"} />
          </Field>
          {base ? <OneClickPay estate={slug} unit={u.id} recipient={u.account} amount={base} /> : <p className="text-xs text-muted">Enter an amount to get a live quote.</p>}
        </div>
      ) : null}
    </BracketCard>
  );
}
