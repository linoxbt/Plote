// Creates the estate account, deploys the estate contract, initialises it from a config, registers it
// (and the payout account) on USDC, and funds the verification budget.
// Usage: pnpm tsx scripts/deploy-estate.ts config/harmattan-court.testnet.json
import {
  NEAR, ROOT_ACCOUNT, TGAS, account, call, deployments, ensureSubAccount, estateId, loadConfig, log, near, record,
  resolveAccount, toNs, usage, view, wasm,
} from "./lib.js";

const path = process.argv[2] ?? usage("usage: deploy-estate.ts <config.json>");
const cfg = loadConfig(path);
const dep = deployments();
const usdc = dep.usdc ?? usage("deploy mock USDC first (deployments.usdc missing)");
const hash = dep.unit_code_hash ?? usage("publish the global unit code first (deployments.unit_code_hash missing)");
const root = account(ROOT_ACCOUNT);
const id = estateId(cfg);
await ensureSubAccount(root, id, "10");
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
