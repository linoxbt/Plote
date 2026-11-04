// Creates the demo role accounts under the root (testnet): developer, surveyor, relayer, buyers, judge.
import { NETWORK, ROOT_ACCOUNT, account, ensureSubAccount, log, record, usage } from "./lib.js";

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
log("✓ role accounts ready. Keys are in ~/.near-credentials/testnet/ — never commit them.");
