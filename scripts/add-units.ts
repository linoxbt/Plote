// Calls add_units in batches of 8 from the developer account. Skips units that already exist.
import { TGAS, account, call, estateId, loadConfig, log, near, resolveAccount, toNs, usage, view } from "./lib.js";

const path = process.argv[2] ?? usage("usage: add-units.ts <config.json>");
const cfg = loadConfig(path);
const id = estateId(cfg);
const dev = account(resolveAccount(cfg.developer));
const todo = [];
for (const u of cfg.units) {
  const existing = await view(id, "get_unit", { unit_id: u.id });
  if (!existing) todo.push({ ...u, plan: (u.plan ?? []).map((p) => ({ due_at: toNs(p.due_at), cumulative: p.cumulative })) });
}
log(`${todo.length} units to add to ${id}`);
for (let i = 0; i < todo.length; i += 8) {
  const batch = todo.slice(i, i + 8);
  await call(dev, id, "add_units", { units: batch }, { deposit: near(0.035 * batch.length), gas: 300n * TGAS });
  log(`+ ${batch.map((b) => b.id).join(", ")}`);
}
const units = (await view<unknown[]>(id, "list_units", { limit: 200 })) ?? [];
log(`✓ ${id} now has ${units.length} units`);
