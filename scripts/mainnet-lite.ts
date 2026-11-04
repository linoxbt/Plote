// Mainnet Lite (SPEC 17.4): plote.<you>.near → harmattan-court.plote.<you>.near → a-4b.harmattan-court.plote.<you>.near,
// registered on Circle native USDC so a 1Click payment can land on it. No estate contract on mainnet:
// this shows the payment rail only; the escrow logic runs on testnet. Usage:
//   NEAR_ENV=mainnet MAINNET_PARENT=you.near pnpm tsx scripts/mainnet-lite.ts
import { NETWORK, TGAS, account, call, ensureSubAccount, log, near, record, usage, view } from "./lib.js";

const CIRCLE_USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
if (NETWORK !== "mainnet") usage("run with NEAR_ENV=mainnet");
const parent = process.env.MAINNET_PARENT ?? usage("set MAINNET_PARENT=<your-account>.near");
const p = account(parent);
const plote = await ensureSubAccount(p, "plote", "0.1");
const estate = await ensureSubAccount(account(plote), "harmattan-court", "0.05");
const unit = await ensureSubAccount(account(estate), "a-4b", "0.02");
const reg = await view(CIRCLE_USDC, "storage_balance_of", { account_id: unit });
if (!reg) {
  await call(p, CIRCLE_USDC, "storage_deposit", { account_id: unit, registration_only: true }, { deposit: near("0.00125"), gas: 30n * TGAS });
  log(`+ registered ${unit} on Circle USDC`);
}
record("mainnet_unit", unit);
log(`✓ mainnet unit ready: ${unit}\nSet MAINNET_UNIT_ACCOUNT=${unit} in Vercel and pay ≈$2 from Base or Solana via /buy (mainnet build).`);
