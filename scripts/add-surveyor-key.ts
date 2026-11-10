// Adds a function-call key to the surveyor's account, limited to the estate's capture/evidence/sign
// methods, with an allowance (0 would mean unlimited). Prints the private key for the phone, once.
// With --public-key=ed25519:… it authorises a key the /qs/setup page created on the phone instead (nothing secret
// is printed: the private key never leaves the phone).
// Usage: pnpm tsx scripts/add-surveyor-key.ts <surveyor-account> <estate-account> [allowance NEAR] [--public-key=ed25519:…]
import { KeyPair, PublicKey } from "near-api-js";
import { account, log, near, usage } from "./lib.js";

const args = process.argv.slice(2);
const pkArg = args.find((a) => a.startsWith("--public-key="))?.slice("--public-key=".length);
const [surveyor, estate, allowance = "0.25"] = args.filter((a) => !a.startsWith("--"));
if (!surveyor || !estate) usage("usage: add-surveyor-key.ts <surveyor> <estate> [allowance] [--public-key=ed25519:…]");
const kp = pkArg ? null : KeyPair.fromRandom("ed25519");
const publicKey = kp ? kp.getPublicKey() : PublicKey.fromString(pkArg!);
await account(surveyor).addFunctionCallAccessKey({
  publicKey,
  contractId: estate,
  methodNames: ["open_capture", "submit_evidence", "qs_sign"],
  allowance: near(allowance),
});
log(`✓ added ${publicKey.toString()} to ${surveyor} (receiver ${estate}, allowance ${allowance} NEAR)`);
if (kp) log(`Phone key (store it in the /qs/setup page, then forget it):\n${kp.toString()}`);
