// Creates musdc.<root>, deploys the mock USDC and initialises it. Testnet only.
import { NETWORK, ROOT_ACCOUNT, TGAS, account, call, ensureSubAccount, log, record, usage, wasm } from "./lib.js";

if (NETWORK !== "testnet") usage("mock USDC is testnet-only; mainnet uses Circle USDC");
const root = account(ROOT_ACCOUNT);
const id = await ensureSubAccount(root, "musdc", "2.5"); // ~1.5 NEAR of contract storage + headroom
const musdc = account(id);
await musdc.deployContract(wasm("plote_musdc"));
try {
  await call(musdc, id, "new", {}, { gas: 30n * TGAS });
  log(`✓ ${id} initialised`);
} catch (e) {
  log(`(new skipped: ${(e as Error).message.slice(0, 80)})`);
}
record("usdc", id);
