// Creates the estate account, deploys the estate contract, initialises it from a config, registers it
// (and the payout account) on USDC, and funds the verification budget.
// Usage: pnpm tsx scripts/deploy-estate.ts config/harmattan-court.testnet.json [--allow-unpinned]
//
// Verifier pinning (SPEC 5.6, "the code that checks it is public, and its fingerprint is on-chain"): the config's
// `verifier.commit` must be filled before deploying. The checked-in configs leave it "" because the value only exists
// once the worker is published:
//   - `"repo": "project:<owner>/<name>"` (an OutLayer project): `commit` is the project's version key. Publish the
//     verifier build on OutLayer (app.outlayer.ai → your project → Versions), run it once to warm the cache, and copy
//     that version's key. Empty would mean "whatever version is active", which can change after deploy.
//   - `"repo": "https://github.com/<you>/plote-verifier"`: `commit` is the full git SHA OutLayer builds. The worker
//     bakes the same SHA into every verdict (`worker_commit`) and the estate rejects verdicts from any other build.
// The script refuses an empty commit unless you pass --allow-unpinned (or PLOTE_ALLOW_UNPINNED=1), e.g. for a
// throwaway estate wired to outlayer-mock.
import {
  NEAR, NETWORK, ROOT_ACCOUNT, TGAS, account, call, deployments, ensureSubAccount, estateId, loadConfig, log, near, record,
  resolveAccount, toNs, usage, view, wasm,
} from "./lib.js";

const argv = process.argv.slice(2);
const path = argv.find((a) => !a.startsWith("--")) ?? usage("usage: deploy-estate.ts <config.json> [--allow-unpinned]");
const allowUnpinned = argv.includes("--allow-unpinned") || process.env.PLOTE_ALLOW_UNPINNED === "1";
const cfg = loadConfig(path);
assertPinned(cfg.verifier, allowUnpinned);
if (NETWORK === "mainnet") assertMainnetSafe();
const dep = deployments();
const usdc = dep.usdc ?? usage("deploy mock USDC first (deployments.usdc missing)");
const hash = dep.unit_code_hash ?? usage("publish the global unit code first (deployments.unit_code_hash missing)");
const root = account(ROOT_ACCOUNT);
const id = estateId(cfg);
await ensureSubAccount(root, id, "7"); // ~5.7 NEAR of contract storage + state headroom
const estate = account(id);
await estate.deployContract(wasm("plote_estate"));

const args = {
  developer_id: resolveAccount(cfg.developer),
  payout_id: resolveAccount(cfg.payout),
  surveyor_id: resolveAccount(cfg.surveyor),
  recovery_id: resolveAccount(cfg.recovery ?? ROOT_ACCOUNT),
  usdc_id: usdc,
  outlayer_id: cfg.outlayer ?? dep.outlayer ?? "outlayer.testnet",
  verdict_relayer: cfg.verdict_relayer ? resolveAccount(cfg.verdict_relayer) : null,
  verify_mode: cfg.verify_mode ?? "outlayer",
  verifier: cfg.verifier,
  unit_code_hash: hash,
  name: cfg.name,
  location: cfg.location ?? "",
  geofence: cfg.geofence,
  milestones: cfg.milestones.map((m) => ({ ...m, deadline: toNs(m.deadline) })),
  params: cfg.params,
  nft_metadata: {
    spec: "nft-1.0.0",
    name: `${cfg.name} allocations`,
    symbol: "PLOTE",
    icon: null, base_uri: null, reference: null, reference_hash: null,
  },
  app_url: process.env.NEXT_PUBLIC_APP_URL ?? "https://plote.vercel.app",
};
try {
  await call(estate, id, "new", { args }, { gas: 50n * TGAS });
  log(`✓ ${id} initialised`);
} catch (e) {
  const msg = (e as Error).message;
  if (!/already initialized|AlreadyInitialized/i.test(msg)) throw e;
  log(`= ${id} already initialised`);
}

// USDC registration for the estate (resale escrow) and the payout account.
for (const who of [id, args.payout_id, args.recovery_id]) {
  const reg = await view(usdc, "storage_balance_of", { account_id: who });
  if (!reg) {
    await call(root, usdc, "storage_deposit", { account_id: who, registration_only: true }, { deposit: near("0.00125"), gas: 30n * TGAS });
    log(`+ registered ${who} on ${usdc}`);
  }
}
const fund = cfg.fund_verification_near ?? "5";
await call(root, id, "fund_verification", {}, { deposit: near(fund), gas: 10n * TGAS });
log(`✓ verification budget +${fund} NEAR`);
record(`estate:${cfg.account}`, id);
log(`next: pnpm tsx scripts/add-units.ts ${path}`);
void NEAR;

/** Real money: refuse every configuration that only makes sense for a demo (docs/LAUNCH.md §3). */
function assertMainnetSafe() {
  const CIRCLE_USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
  const problems: string[] = [];
  if (allowUnpinned) problems.push("--allow-unpinned is not allowed on mainnet");
  if ((deployments().usdc ?? "") !== CIRCLE_USDC) problems.push(`deployments.mainnet.json "usdc" must be Circle USDC (${CIRCLE_USDC})`);
  if ((cfg.verify_mode ?? "outlayer") !== "outlayer") problems.push(`verify_mode must be "outlayer" on mainnet`);
  const p = cfg.params as Record<string, unknown>;
  if (p.demo_mode) problems.push("params.demo_mode must be false (demo timers are minutes, not weeks)");
  if (p.playground) problems.push("params.playground must be false (anyone could act as surveyor)");
  if (Number(p.veto_window_ns ?? 0) < 24 * 3600 * 1e9) problems.push("params.veto_window_ns should be at least 24 h on mainnet");
  if (problems.length) usage(`✗ ${path} is not safe for mainnet:\n  - ${problems.join("\n  - ")}`);
}

function assertPinned(v: { repo: string; commit: string }, allow: boolean) {
  const commit = (v.commit ?? "").trim();
  const project = v.repo.startsWith("project:");
  if (!commit) {
    const how = project
      ? `Set "verifier.commit" to the OutLayer version key of ${v.repo.slice("project:".length)}: publish the verifier ` +
        `build on OutLayer (app.outlayer.ai → the project → Versions), run it once with verifier/fixtures/example-input.json ` +
        `to warm the build cache, and copy that version's key into ${path}.`
      : `Set "verifier.commit" to the full git SHA of the plote-verifier commit OutLayer builds ` +
        `(git rev-parse HEAD in that repo, after pushing). Verdicts must carry the same worker_commit.`;
    if (!allow) {
      usage(
        `✗ ${path}: verifier.commit is empty, so this estate wouldn't pin the code that checks its photos (SPEC 5.6).
` +
          `  ${how}
  To deploy unpinned anyway (throwaway/mock estates only), pass --allow-unpinned or PLOTE_ALLOW_UNPINNED=1.`,
      );
    }
    log(`! deploying ${path} with an UNPINNED verifier (--allow-unpinned). ${how}`);
    return;
  }
  if (!project && !/^[0-9a-f]{40}$/i.test(commit)) {
    log(`! verifier.commit "${commit}" isn't a full 40-character git SHA; the worker reports the full SHA as worker_commit, so verdicts would be rejected.`);
  }
}
