// Deletes every full-access key on the estate account, so nobody — including us — can change its code.
// Irreversible. Run last, on video. Usage: pnpm tsx scripts/delete-estate-keys.ts <estate> --yes
import { account, log, usage } from "./lib.js";

const [estate, flag] = process.argv.slice(2);
if (!estate) usage("usage: delete-estate-keys.ts <estate-account> --yes");
if (flag !== "--yes") usage(`This permanently locks ${estate}. Re-run with --yes to confirm.`);
const acc = account(estate);
const { keys } = await acc.getAccessKeyList();
for (const k of keys) {
  await acc.deleteKey(k.public_key);
  log(`- deleted ${k.public_key}`);
}
log(`✓ ${estate} has no access keys. Its code can't change.`);
