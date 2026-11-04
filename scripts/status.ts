// Prints a quick health check of the deployed estates (views only).
import { deployments, log, view } from "./lib.js";

const d = deployments();
for (const [k, id] of Object.entries(d).filter(([k]) => k.startsWith("estate:"))) {
  try {
    const e = await view<{ name: string; unit_count: number; allocated_count: number; refunds_open: boolean; verification_budget: string }>(id, "get_estate");
    log(`${k} ${id}: ${e.name}, ${e.unit_count} units, ${e.allocated_count} allocated, refunds_open=${e.refunds_open}, budget=${BigInt(e.verification_budget) / 10n ** 21n} mNEAR`);
  } catch (err) {
    log(`${k} ${id}: unreachable (${(err as Error).message.slice(0, 60)})`);
  }
}
