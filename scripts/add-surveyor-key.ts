// Adds a function-call key to the surveyor's account, limited to the estate's capture/evidence/sign
// methods, with an allowance (0 would mean unlimited). Prints the private key for the phone, once.
// Usage: pnpm tsx scripts/add-surveyor-key.ts <surveyor-account> <estate-account> [allowance NEAR]
import { KeyPair } from "near-api-js";
import { account, log, near, usage } from "./lib.js";

const [surveyor, estate, allowance = "0.25"] = process.argv.slice(2);
if (!surveyor || !estate) usage("usage: add-surveyor-key.ts <surveyor> <estate> [allowance]");
const kp = KeyPair.fromRandom("ed25519");
await account(surveyor).addFunctionCallAccessKey({
  publicKey: kp.getPublicKey(),
  contractId: estate,
  methodNames: ["open_capture", "submit_evidence", "qs_sign"],
  allowance: near(allowance),
});
log(`✓ added ${kp.getPublicKey().toString()} to ${surveyor} (receiver ${estate}, allowance ${allowance} NEAR)`);
log(`Phone key (store it in the /qs/setup page, then forget it):\n${kp.toString()}`);
