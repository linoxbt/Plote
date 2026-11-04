// Reopens the playground's milestones and tops it up to at least 10 available units.
import { TGAS, account, call, estateId, loadConfig, log, near, resolveAccount, usage, view } from "./lib.js";

const cfg = loadConfig(process.argv[2] ?? "config/playground.testnet.json");
if (!cfg.params.playground) usage("not a playground config");
const id = estateId(cfg);
const dev = account(resolveAccount(cfg.developer));
await call(dev, id, "playground_reset", {}, { gas: 30n * TGAS });
log("✓ milestones reopened");
const units = (await view<{ id: string; status: string }[]>(id, "list_units", { limit: 200 })) ?? [];
const available = units.filter((u) => u.status === "Available").length;
if (available >= 10) {
  log(`✓ ${available} units available`);
} else {
  const start = units.length + 1;
  const batch = Array.from({ length: 8 }, (_, k) => {
    const n = String(start + k).padStart(2, "0");
    return { id: `p-${n}`, label: `Playground · Unit ${n} · studio`, price: "1000000000", plan: [] };
  });
  await call(dev, id, "add_units", { units: batch }, { deposit: near(0.035 * 8), gas: 300n * TGAS });
  log(`+ added ${batch.map((b) => b.id).join(", ")}`);
}
