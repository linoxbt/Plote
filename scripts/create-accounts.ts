// Creates the demo role accounts under the root (testnet): developer, surveyor, relayer, buyers, judge.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { NETWORK, ROOT, ROOT_ACCOUNT, account, ensureSubAccount, loadKey, log, record, usage } from "./lib.js";

if (NETWORK !== "testnet") usage("testnet only");
const root = account(ROOT_ACCOUNT);
const plan: [string, string][] = [
  // Right-sized for testnet faucet budgets: enough for each role's gas, storage and add_units deposits.
  ["dev-harmattan", "4"], // pays add_units (0.035 NEAR/unit) for all three estates
  ["qs-adaeze", "1.5"],
  ["relayer", "3"], // pays gas for gasless surveyor/buyer calls (fractions of a cent each)
  ["buyer-1", "1.5"],
  ["buyer-2", "1.5"],
  ["buyer-3", "1.5"],
  ["buyer-4", "1.5"],
  ["judge", "2"],
];
for (const [prefix, amount] of plan) {
  const id = await ensureSubAccount(root, prefix, amount);
  record(`account:${prefix}`, id);
}
// The shared judge wallet (testnet only) is published on purpose so judges can try the refund flow.
const judge = `judge.${ROOT_ACCOUNT}`;
const key = loadKey(judge);
if (key) {
  writeFileSync(
    join(ROOT, "docs/judge-wallet.md"),
    `# Shared judge wallet (TESTNET ONLY)\n\nAccount: \`${judge}\`\n\nPrivate key (import into MyNearWallet / Meteor testnet → "Import account" → private key):\n\n\`\`\`\n${key}\n\`\`\`\n\nIt holds Baobab Heights units whose refunds are open. It has no mainnet value. Please don't drain its NEAR.\n`,
  );
  log(`✓ wrote docs/judge-wallet.md for ${judge}`);
}
log("✓ role accounts ready. Keys are in ~/.near-credentials/testnet/ — never commit them.");
