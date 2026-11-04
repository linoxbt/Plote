// Fallback for demos when the real OutLayer path isn't wired yet: deploys outlayer-mock to
// outlayer-mock.<root>. Point an estate at it with "outlayer": "outlayer-mock.plote.testnet" in its config.
// Proof pages show the "mock_verifier" warning, so nobody mistakes it for a TEE verdict.
import { NETWORK, ROOT_ACCOUNT, TGAS, account, call, ensureSubAccount, log, record, usage, wasm } from "./lib.js";

if (NETWORK !== "testnet") usage("the mock verifier is testnet-only");
const id = await ensureSubAccount(account(ROOT_ACCOUNT), "outlayer-mock", "3");
const acc = account(id);
await acc.deployContract(wasm("outlayer_mock"));
try {
  await call(acc, id, "new", {}, { gas: 10n * TGAS });
} catch {
  /* already initialised */
}
record("outlayer_mock", id);
log(`✓ ${id} deployed. Set "outlayer": "${id}" in an estate config to use it.`);
