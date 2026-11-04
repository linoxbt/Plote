// Seeds the demo estates so every page has something real to show (SPEC 13.9).
//   Harmattan Court: a-4b taken (10%), b-3b taken (30%), a-2a reserved; the rest available.
//   Baobab Heights: the judge wallet holds b-2a, b-2b, b-2c with refunds already open (missed foundation).
//   Playground: left empty for judges.
// Flags: --refund-only (re-create the Baobab refund units after judges used them)
import {
  TGAS, USDC, account, call, deployments, estateId, loadConfig, log, near, resolveAccount, view,
} from "./lib.js";

const refundOnly = process.argv.includes("--refund-only");
const usdc = deployments().usdc;
if (!usdc) throw new Error("deploy mock USDC first");

async function buy(buyerId: string, estate: string, unitId: string, amount: bigint) {
  const buyer = account(buyerId);
  const unit = await view<{ status: string; account: string; price: string } | null>(estate, "get_unit", { unit_id: unitId });
  if (!unit) throw new Error(`no unit ${unitId} on ${estate}`);
  if (unit.status !== "Available") {
    log(`= ${estate}/${unitId} is ${unit.status}; skipping`);
    return;
  }
  await call(buyer, usdc!, "mint", { amount: amount.toString() }, { deposit: near("0.00125"), gas: 30n * TGAS });
  await call(buyer, estate, "reserve", { unit_id: unitId }, { deposit: near("0.05"), gas: 30n * TGAS });
  if (amount > 0n) {
    await call(buyer, usdc!, "ft_transfer_call", { receiver_id: unit.account, amount: amount.toString(), msg: "" }, {
      deposit: 1n,
      gas: 200n * TGAS,
    });
  }
  const after = await view<{ status: string; paid: string }>(estate, "get_unit", { unit_id: unitId });
  log(`+ ${buyerId} → ${estate}/${unitId}: ${after.status}, paid ${Number(BigInt(after.paid) / USDC)} USDC`);
}

const hc = estateId(loadConfig("config/harmattan-court.testnet.json"));
const bh = estateId(loadConfig("config/baobab-heights.testnet.json"));
const judge = resolveAccount("judge");

if (!refundOnly) {
  await buy(resolveAccount("buyer-1"), hc, "a-4b", 8_500n * USDC);
  await buy(resolveAccount("buyer-2"), hc, "b-3b", 25_500n * USDC);
  await buy(resolveAccount("buyer-3"), hc, "a-2a", 0n);
}
for (const u of ["b-2a", "b-2b", "b-2c"]) {
  await buy(judge, bh, u, 100n * USDC);
}
log("✓ seeded. Milestone photos are taken with the surveyor app (/qs) so their verdicts are real.");
