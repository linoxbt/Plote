// S5 default → resale and M8 refund timing, computed from a UnitView the same way the contract does
// (contracts/estate/src/resale.rs `overdue`, payments.rs `refund`). The contract is still the judge: these only
// decide which buttons to show and what the countdowns say.

import { shareOf, toBig } from "./format";
import type { MilestoneView, Params, UnitView } from "./types";

/**
 * When `declare_default` becomes callable for this unit (ns as bigint), or null if no unpaid instalment exists.
 * Rule: some instalment with `paid < cumulative` and `now > due_at + default_grace_ns`. Only Allocated units can default.
 */
export function defaultOpensAt(u: Pick<UnitView, "plan" | "paid" | "status">, params: Pick<Params, "default_grace_ns">): bigint | null {
  if (u.status !== "Allocated") return null;
  const paid = toBig(u.paid);
  const grace = toBig(params.default_grace_ns);
  let first: bigint | null = null;
  for (const i of u.plan) {
    if (paid >= toBig(i.cumulative)) continue;
    const at = toBig(i.due_at) + grace;
    if (first === null || at < first) first = at;
  }
  return first;
}

/** True when anyone may call `declare_default` now (`nowNs` strictly after due + grace, like the contract). */
export function canDeclareDefault(u: Pick<UnitView, "plan" | "paid" | "status">, params: Pick<Params, "default_grace_ns">, nowNs: bigint): boolean {
  const at = defaultOpensAt(u, params);
  return at !== null && nowNs > at;
}

/** What a defaulted holder gets back when the Default listing sells: ask = paid, minus a fixed penalty (to the developer). */
export function defaultPayout(paid: string | bigint, penaltyBps: number): { ask: bigint; penalty: bigint; toHolder: bigint } {
  const ask = toBig(paid);
  const p = shareOf(ask, penaltyBps);
  const penalty = p < ask ? p : ask;
  return { ask, penalty, toHolder: ask - penalty };
}

/** The next time refunds would open (deadline + grace of the earliest milestone not yet approved), ns string or null. */
export function nextRefundOpensAt(ms: MilestoneView[] | null | undefined): string | null {
  const open = (ms ?? []).filter((m) => !(m.status === "Approved" && m.veto_passed)).map((m) => toBig(m.refunds_open_at));
  if (!open.length) return null;
  return open.reduce((a, b) => (b < a ? b : a)).toString();
}
