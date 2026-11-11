// Which reservation housekeeping calls the estate would accept right now (INTERFACE §1.2, SPEC §5 reserve / sweep).

import { nsToMs, toBig } from "./format";
import type { EstateView, UnitView } from "./types";

export type ReservationActionSet = { cancel: boolean; expire: boolean; sweep: boolean; reserver: string | null };

/**
 * - cancel: the reserver, while the reservation is live (cancel_reservation).
 * - expire: anyone, once expires_at has passed (expire_reservation).
 * - sweep: anyone, when unattributed USDC is above dust_threshold (sweep_unattributed fails E_NOTHING_TO_SWEEP at or below it).
 */
export function reservationActions(u: UnitView, e: EstateView, accountId: string | null, nowMs: number): ReservationActionSet {
  const r = u.status === "Reserved" ? u.reservation : null;
  const expired = !!r && nsToMs(r.expires_at) <= nowMs;
  return {
    cancel: !!r && !!accountId && r.by === accountId && !expired,
    expire: expired,
    sweep: toBig(u.unattributed) > toBig(e.params.dust_threshold),
    reserver: r?.by ?? null,
  };
}
