// Creates the demo role accounts under the root (testnet): developer, surveyor, relayer, buyers, judge.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { NETWORK, ROOT, ROOT_ACCOUNT, account, ensureSubAccount, loadKey, log, record, usage } from "./lib.js";

if (NETWORK !== "testnet") usage("testnet only");
const root = account(ROOT_ACCOUNT);
const plan: [string, string][] = [
  ["dev-harmattan", "5"],
  ["qs-adaeze", "2"],
  ["relayer", "5"],
  ["buyer-1", "2"],
  ["buyer-2", "2"],
  ["buyer-3", "2"],
  ["buyer-4", "2"],
  ["judge", "3"],
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
