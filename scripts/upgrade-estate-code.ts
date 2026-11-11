// Code-only upgrade of live estates: redeploys the plote_estate WASM without calling `new`, re-registering or
// re-funding anything. Only for changes that keep the stored state layout (e.g. the NFT drawing).
// Needs the estate's full-access key (it fails after delete-estate-keys.ts, by design).
//
// Usage: pnpm tsx scripts/upgrade-estate-code.ts --expected-hash <sha256-hex | base58 code_hash> <estate> [<estate> ...]
//                                                 [--wasm <path>] [--i-know]
//   --expected-hash  required: the hash of the reviewed build (e.g. from the reproducible-build workflow's hashes.txt,
//                    either the sha256 hex or the base58 code_hash). The script refuses a WASM whose hash differs.
//                    Also read from EXPECTED_SHA256 if the flag is absent.
//   --wasm           a specific file (default: the local build, target/near/plote_estate/plote_estate.wasm).
//   --i-know         required with NEAR_ENV=mainnet: real money; prefer the locked-key path in docs/LAUNCH.md §3.
// After each upgrade it prints the code_hash the chain reports, which must equal the expected hash.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NETWORK, account, base58, log, provider, usage, view, wasm } from "./lib.js";

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  if (i === -1) return undefined;
  const v = argv[i + 1];
  if (!v || v.startsWith("--")) usage(`${name} needs a value`);
  return v;
};
const iKnow = argv.includes("--i-know");
const expected = (flag("--expected-hash") ?? process.env.EXPECTED_SHA256 ?? "").trim();
const wasmPath = flag("--wasm");
const valued = new Set(["--expected-hash", "--wasm"]);
const ids = argv.filter((a, i) => !a.startsWith("--") && !valued.has(argv[i - 1] ?? ""));

const USAGE = "usage: upgrade-estate-code.ts --expected-hash <sha256-hex|code_hash> <estate-account> [...] [--wasm <file>] [--i-know]";
if (!ids.length) usage(USAGE);
if (NETWORK === "mainnet" && !iKnow) {
  usage("✗ NEAR_ENV=mainnet: refusing to redeploy estate code on mainnet. Mainnet estates should have their keys deleted (docs/LAUNCH.md §3). Pass --i-know only if you really mean it.");
}
if (!expected) usage(`✗ --expected-hash is required (the reviewed build's sha256 hex or base58 code_hash).\n${USAGE}`);

const code = wasmPath ? new Uint8Array(readFileSync(resolve(wasmPath))) : wasm("plote_estate");
const digest = createHash("sha256").update(code).digest();
const hex = digest.toString("hex");
const codeHash = base58(digest);
if (expected.toLowerCase() !== hex && expected !== codeHash) {
  usage(`✗ WASM hash mismatch: expected ${expected}, this file is sha256=${hex} (code_hash ${codeHash}). Rebuild the reviewed commit reproducibly or pass the right file with --wasm.`);
}
log(`wasm ok: sha256=${hex} code_hash=${codeHash} (${code.length} bytes) on ${NETWORK}`);

for (const id of ids) {
  const before = stable(await view(id, "get_estate", {}));
  if (!before || !Object.keys(before).length) usage(`${id}: get_estate returned nothing; not an estate?`);
  const current = (await provider.viewAccount({ accountId: id })).code_hash;
  if (current === codeHash) {
    log(`= ${id} already runs code_hash ${codeHash}; skipped`);
    continue;
  }
  await account(id).deployContract(code);
  const after = stable(await view(id, "get_estate", {}));
  if (JSON.stringify(after) !== JSON.stringify(before)) usage(`${id}: estate view changed after the upgrade; check state compatibility`);
  const deployed = (await provider.viewAccount({ accountId: id })).code_hash;
  if (deployed !== codeHash) usage(`✗ ${id}: chain reports code_hash ${deployed}, expected ${codeHash}`);
  log(`✓ ${id} upgraded, state intact. Deployed code_hash: ${deployed} (was ${current})`);
}

// get_estate includes `now` (block time), which differs on every read; compare everything else.
function stable(v: unknown) {
  const { now: _now, ...rest } = (v ?? {}) as Record<string, unknown>;
  return rest;
}
