"use client";

// S5 · Default → auto-resale with a fixed penalty (SPEC §10). Explainer shown before a buyer signs, and the
// "Declare default" trigger: anyone may call `declare_default` once an instalment is overdue past `default_grace_ns`.

import { useQueryClient } from "@tanstack/react-query";
import { AlertOctagon } from "lucide-react";
import { CountdownChip } from "./chain";
import { useTx } from "./toast";
import { useWallet } from "./wallet";
import { BracketCard, Button } from "./ui";
import { canDeclareDefault, defaultOpensAt, defaultPayout } from "@/lib/default";
import { estate as E } from "@/lib/estate";
import { formatDuration, formatUsd, msToNs, nsToMs, toBig, unitDisplay } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import { callNoPopup } from "@/lib/near";
import type { EstateView, UnitView } from "@/lib/types";

/** One plain sentence (plus the numbers) on what happens if instalments are missed. */
export function DefaultExplainer({ e, u, className }: { e: EstateView; u?: UnitView; className?: string }) {
  const pct = e.params.penalty_bps / 100;
  const grace = formatDuration(nsToMs(e.params.default_grace_ns));
  return (
    <div className={className}>
      <p className="text-sm">
        <strong>If you miss an instalment:</strong> after a {grace} grace period, your unit is listed for resale at exactly what you&apos;ve
        paid. When someone buys it you get that back minus a fixed {pct}% (which goes to the developer). You never forfeit what you paid.
      </p>
      {u && u.plan.length ? <p className="mt-1 text-xs text-muted">This unit has {u.plan.length} instalment{u.plan.length === 1 ? "" : "s"}; the next buyer takes over the remaining ones.</p> : null}
    </div>
  );
}

/** Unit page / developer console: overdue warning, default countdown, and the declare_default button. */
export function DefaultCard({ estate, e, u }: { estate: string; e: EstateView; u: UnitView }) {
  const now = useNow(15_000);
  const at = defaultOpensAt(u, e.params);
  if (at === null) return null;
  const nowNs = BigInt(msToNs(now));
  const dueAt = at - toBig(e.params.default_grace_ns);
  if (nowNs <= dueAt) return null; // nothing overdue yet
  const open = canDeclareDefault(u, e.params, nowNs);
  const pay = defaultPayout(u.paid, e.params.penalty_bps);
  return (
    <BracketCard tone={open ? "red" : "amber"} className="space-y-3">
      <p className="flex items-center gap-2 font-display text-lg font-semibold">
        <AlertOctagon className="h-5 w-5" aria-hidden /> An instalment on {unitDisplay(u.id)} is overdue.
      </p>
      <p className="text-sm">
        {open ? "The grace period has passed, so anyone can declare a default." : "Once the grace period ends, anyone can declare a default."} The unit
        is then listed for resale at what the holder paid ({formatUsd(pay.ask)}). When it sells, the holder gets {formatUsd(pay.toHolder)} and the fixed{" "}
        {e.params.penalty_bps / 100}% ({formatUsd(pay.penalty)}) goes to the developer. Nothing is forfeited.
      </p>
      {open ? <DeclareDefaultButton estate={estate} e={e} u={u} /> : <CountdownChip until={at.toString()} label="default can be declared in" tone="amber" endedLabel="any moment now" />}
    </BracketCard>
  );
}

export function DeclareDefaultButton({ estate, e, u, size = "md" }: { estate: string; e: EstateView; u: UnitView; size?: "md" | "sm" }) {
  const { accountId, connect } = useWallet();
  const { run } = useTx();
  const qc = useQueryClient();
  const pay = defaultPayout(u.paid, e.params.penalty_bps);
  return (
    <Button
      variant="danger"
      size={size}
      onClick={async () => {
        if (!accountId) return connect();
        const ok = window.confirm(
          `Declare a default on ${unitDisplay(u.id)}?\n\nAn instalment is overdue past the grace period. The unit will be listed for resale at ${formatUsd(pay.ask)} (what the holder paid). ` +
            `When a buyer takes it over, the holder receives ${formatUsd(pay.toHolder)} and ${formatUsd(pay.penalty)} (${e.params.penalty_bps / 100}%) goes to the developer. This can't be undone.`,
        );
        if (!ok) return;
        const r = await run(`Declare default on ${unitDisplay(u.id)}`, () => callNoPopup(accountId, E.declareDefault(estate, u.id)), { success: "Declared. The unit is now listed for resale." });
        if (r) qc.invalidateQueries();
      }}
    >
      Declare default
    </Button>
  );
}
