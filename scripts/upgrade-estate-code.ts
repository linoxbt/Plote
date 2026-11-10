// Code-only upgrade of live estates: redeploys the current plote_estate WASM without calling `new`,
// re-registering or re-funding anything. Only for changes that keep the stored state layout (e.g. the NFT drawing).
// Needs the estate's full-access key (it fails after delete-estate-keys.ts, by design).
// Usage: pnpm tsx scripts/upgrade-estate-code.ts <estate-account> [<estate-account> ...]
import { account, log, usage, view, wasm } from "./lib.js";

const ids = process.argv.slice(2);
if (!ids.length) usage("usage: upgrade-estate-code.ts <estate-account> [...]");
const code = wasm("plote_estate");
for (const id of ids) {
  const before = stable(await view(id, "get_estate", {}));
  if (!before) usage(`${id}: get_estate returned nothing; not an estate?`);
  await account(id).deployContract(code);
  const after = stable(await view(id, "get_estate", {}));
  if (JSON.stringify(after) !== JSON.stringify(before)) usage(`${id}: estate view changed after the upgrade; check state compatibility`);
  log(`✓ ${id} upgraded (${code.length} bytes), state intact`);
}

// get_estate includes `now` (block time), which differs on every read; compare everything else.
function stable(v: unknown) {
  const { now: _now, ...rest } = (v ?? {}) as Record<string, unknown>;
  return rest;
}
