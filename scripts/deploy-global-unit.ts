// Publishes the unit WASM once as a NEP-591 global contract addressed by its code hash (immutable).
import { ROOT_ACCOUNT, account, codeHash, log, record, wasm } from "./lib.js";

const code = wasm("plote_unit");
const hash = codeHash(code);
const root = account(ROOT_ACCOUNT);
log(`unit code: ${code.length} bytes, hash ${hash}`);
await root.deployGlobalContract(code, "codeHash");
record("unit_code_hash", hash);
log(`✓ global unit code published; put "${hash}" in your estate deploy (recorded in config/deployments.*.json)`);
