// Balances the app needs to keep working, shared by /api/health and the scheduled poller (which alerts on them).
import { ESTATES } from "@/lib/config";
import { viewAccount, viewUncached } from "@/lib/near";

const YOCTO = 10n ** 24n;
const nearStr = (y: bigint) => (Number(y / 10n ** 21n) / 1000).toFixed(2);
// Below these the app stops working: the relayer can't pay gas, and an estate can't pay OutLayer for a photo check.
const RELAYER_MIN = YOCTO; // 1 NEAR
const BUDGET_MIN = (3n * YOCTO) / 10n; // 0.3 NEAR

/** Low-balance check: an uptime monitor pointed at /api/health alerts when `balances.ok` turns false. */
export async function balances(relayerId: string | null): Promise<{ ok: boolean; detail: string; low: string[] }> {
  const low: string[] = [];
  const parts: string[] = [];
  try {
    if (relayerId) {
      const a = await viewAccount(relayerId);
      const bal = a ? BigInt(a.amount) : 0n;
      parts.push(`relayer ${nearStr(bal)} NEAR`);
      if (bal < RELAYER_MIN) low.push(`relayer ${relayerId} below 1 NEAR`);
    }
    const budgets = await Promise.all(
      ESTATES.map(async (e) => {
        const v = await viewUncached<{ verification_budget?: string }>(e, "get_estate").catch(() => null);
        return [e, v?.verification_budget ? BigInt(v.verification_budget) : null] as const;
      }),
    );
    for (const [e, b] of budgets) {
      if (b === null) continue;
      parts.push(`${e.split(".")[0]} ${nearStr(b)} NEAR`);
      if (b < BUDGET_MIN) low.push(`${e} verification budget below 0.3 NEAR (fund_verification)`);
    }
    return { ok: low.length === 0, detail: (low.length ? `LOW: ${low.join("; ")} · ` : "") + parts.join(" · "), low };
  } catch (e) {
    return { ok: false, detail: `couldn't read balances: ${e instanceof Error ? e.message : String(e)}`, low };
  }
}

