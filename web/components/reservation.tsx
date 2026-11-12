"use client";

// Reservation housekeeping on a unit (INTERFACE §1.2, SPEC 5.x): each action shows only when the contract would accept it.
//  - cancel_reservation: the reserver, any time while reserved. USDC paid so far + the 0.05 NEAR go back to them.
//  - expire_reservation: anyone, once expires_at has passed. Same refunds, to the reserver; frees the unit.
//  - sweep_unattributed: anyone, when USDC above dust_threshold sits on the unit credited to nobody. It goes to the
//    last reserver if their reservation ended less than late_claim_ns ago (a late cross-chain delivery), else to recovery_id.

import { useQueryClient } from "@tanstack/react-query";
import { Clock, RotateCcw, Undo2 } from "lucide-react";
import { estate as E } from "@/lib/estate";
import { formatDuration, formatUsd, nsToMs, toBig, unitDisplay } from "@/lib/format";
import { reservationActions } from "@/lib/reservation";
import { useNow } from "@/lib/hooks";
import { callNoPopup, sendTx, type TxSpec } from "@/lib/near";
import type { EstateView, UnitView } from "@/lib/types";
import { AccountChip, MonoAmount } from "./chain";
import { useTx } from "./toast";
import { BracketCard, Button } from "./ui";
import { useWallet } from "./wallet";

export function ReservationActions({ estate, e, u, className }: { estate: string; e: EstateView; u: UnitView; className?: string }) {
  const { accountId, connect } = useWallet();
  const { run } = useTx();
  const qc = useQueryClient();
  const now = useNow(1000);
  const a = reservationActions(u, e, accountId, now);
  if (!a.cancel && !a.expire && !a.sweep) return null;

  const paid = toBig(u.paid);
  const go = async (title: string, spec: TxSpec, success: string, viaKey: boolean) => {
    if (!accountId) return connect();
    // expire/sweep are on the login key's method list (no popup when it's set up); cancel always asks the wallet.
    const r = await run(title, () => (viaKey ? callNoPopup(accountId, spec) : sendTx(spec)), { success });
    if (r) {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["unit", estate, u.id] }),
        qc.invalidateQueries({ queryKey: ["units", estate] }),
        qc.invalidateQueries({ queryKey: ["estate", estate] }),
        qc.invalidateQueries({ queryKey: ["usdc-bal"] }),
        qc.invalidateQueries({ queryKey: ["my-positions"] }),
      ]);
    }
  };

  return (
    <BracketCard tone="amber" className={className ?? "space-y-4"} aria-label="Reservation actions">
      {a.cancel ? (
        <div className="space-y-2">
          <h2 className="text-lg font-normal">Changed your mind?</h2>
          <p className="text-sm text-muted">
            Cancelling frees {unitDisplay(u.id)} for someone else. The 0.05 NEAR storage deposit comes back to you
            {paid > 0n ? <>, and so does the <MonoAmount value={u.paid} naira={false} /> you&apos;ve paid into the unit</> : null}.
          </p>
          <Button
            onClick={() => {
              const msg = `Cancel your reservation of ${unitDisplay(u.id)}?${paid > 0n ? `\n\n${formatUsd(u.paid)} goes back to ${accountId}.` : ""}\nThe unit goes back on sale.`;
              if (!window.confirm(msg)) return;
              return go(`Cancel reservation of ${unitDisplay(u.id)}`, E.cancelReservation(estate, u.id), paid > 0n ? `Cancelled. ${formatUsd(u.paid)} and 0.05 NEAR are on their way back to you.` : "Cancelled. Your 0.05 NEAR is on its way back.", false);
            }}
          >
            <Undo2 className="h-4 w-4" aria-hidden /> Cancel reservation
          </Button>
        </div>
      ) : null}

      {a.expire ? (
        <div className="space-y-2">
          <h2 className="flex items-center gap-2 text-lg font-normal"><Clock className="h-4 w-4 text-amber" aria-hidden /> This reservation has run out</h2>
          <p className="text-sm text-muted">
            {a.reserver === accountId ? "Your" : "The"} reservation by <AccountChip account={a.reserver} /> ended
            {paid > 0n ? <> before the first payment reached the minimum</> : null}. Anyone can release it: the unit goes back on sale and
            {paid > 0n ? <> the <MonoAmount value={u.paid} naira={false} /> paid so far plus</> : null} the 0.05 NEAR deposit go back to the reserver. Nobody else receives anything.
          </p>
          <Button variant="primary" onClick={() => go(`Release expired reservation of ${unitDisplay(u.id)}`, E.expireReservation(estate, u.id), `Released. ${unitDisplay(u.id)} is available again.`, true)}>
            <RotateCcw className="h-4 w-4" aria-hidden /> {accountId ? "Release the reservation" : "Connect wallet to release it"}
          </Button>
        </div>
      ) : null}

      {a.sweep ? (
        <div className="space-y-2">
          <h2 className="text-lg font-normal">Money here that nobody owns yet</h2>
          <p className="text-sm text-muted">
            <MonoAmount value={u.unattributed} naira={false} account={u.account} /> reached this unit while nobody held or reserved it, so it&apos;s credited to
            no one{u.status === "Available" ? " and the unit can't be reserved until it's cleared" : ""}. Anyone can send it back: to the last reserver
            {u.last_reservation ? <> (<AccountChip account={u.last_reservation.by} />)</> : null} if their reservation ended less than{" "}
            {formatDuration(nsToMs(e.params.late_claim_ns))} ago — a late cross-chain payment — otherwise to Plote&apos;s recovery account, which returns it on request.
          </p>
          <Button onClick={() => go(`Return unattributed USDC on ${unitDisplay(u.id)}`, E.sweepUnattributed(estate, u.id), `Sent ${formatUsd(u.unattributed)} back.`, true)}>
            {accountId ? `Send ${formatUsd(u.unattributed)} back` : "Connect wallet to send it back"}
          </Button>
        </div>
      ) : null}
    </BracketCard>
  );
}
