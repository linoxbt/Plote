// Publishes the Plote verifier on OutLayer (testnet) and wires the estates to it — no wallet or dashboard needed.
// Mirrors what the official outlayer-cli does (upload.rs, deploy.rs, secrets.rs, crypto.rs):
//   1. upload   — the verifier WASM goes on-chain via FastFS (`__fastdata_fastfs`, borsh args, gas 1 on purpose:
//                 the receipt fails but the data is indexed at https://test.fastfs.io/<sender>/<receiver>/<sha256>.wasm)
//   2. project  — `create_project` (or `add_version` + set_active) on outlayer.testnet, source = WasmUrl{url, hash}
//   3. secrets  — for each deployed estate, NEAR_AI_API_KEY is encrypted to the OutLayer keystore (ECIES: X25519 →
//                 HKDF-SHA256 "outlayer-keystore-v1" → ChaCha20-Poly1305) and stored with `store_secrets`, signed by the
//                 estate account itself, profile "plote" (the estate's request_execution uses secrets_ref
//                 { profile: "plote", account_id: <estate> }). Only that estate may use it.
//   4. pin      — the version key (= SHA-256 of the WASM) is set as verifier.commit via `set_verifier` (developer, only
//                 allowed before the first unit is sold) and written into the estate configs.
//
// Usage: NEAR_AI_API_KEY=… pnpm -C scripts exec tsx outlayer-setup.ts [--skip-upload] [--skip-secrets] [--only=<estate>]
// The API key is read from the environment only; it is never written to disk or logged.
import { createHash, createCipheriv, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { actions } from "near-api-js";
import { NETWORK, ROOT, ROOT_ACCOUNT, TGAS, account, call, deployments, exists, log, near, record, usage, view } from "./lib.js";

if (NETWORK !== "testnet") usage("testnet only (mainnet uses outlayer.near / api.outlayer.ai — run deliberately)");
const argv = process.argv.slice(2);
const OUTLAYER = "outlayer.testnet";
const API = "https://testnet-api.outlayer.ai";
const FASTFS = "https://test.fastfs.io";
const PROJECT_NAME = "plote-verifier";
const PROJECT_ID = `${ROOT_ACCOUNT}/${PROJECT_NAME}`;
const PROFILE = "plote";
const WASM_PATH = join(ROOT, "verifier/target/wasm32-wasip2/release/plote-verifier.wasm");
const ONLY = argv.find((a) => a.startsWith("--only="))?.slice(7); // e.g. --only=harmattan-court
const CONFIGS = ["harmattan-court", "baobab-heights", "playground"]
  .filter((n) => !ONLY || n === ONLY)
  .map((n) => join(ROOT, `config/${n}.testnet.json`));

if (!existsSync(WASM_PATH)) usage(`build the verifier first: cd verifier && cargo build --release --target wasm32-wasip2`);
const code = new Uint8Array(readFileSync(WASM_PATH));
const hash = createHash("sha256").update(code).digest("hex");
const relPath = `${hash}.wasm`;
const url = `${FASTFS}/${ROOT_ACCOUNT}/${OUTLAYER}/${relPath}`;
const root = account(ROOT_ACCOUNT);
log(`verifier: ${code.length} bytes, version key ${hash}`);

// ---------- borsh helpers (FastFS payload) ----------
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const str = (s: string) => Buffer.concat([u32(Buffer.byteLength(s)), Buffer.from(s)]);
const bytes = (b: Uint8Array) => Buffer.concat([u32(b.length), Buffer.from(b)]);
const MIME = "application/wasm";
const CHUNK = 1 << 20;

async function fastfsSend(payload: Buffer) {
  try {
    await root.signAndSendTransaction({ receiverId: OUTLAYER, actions: [actions.functionCall("__fastdata_fastfs", payload, 1n, 0n)] });
  } catch {
    // Expected: with 1 gas the receipt fails; the data is still in the transaction and FastFS indexes it.
  }
}

async function upload() {
  const head = await fetch(url, { method: "HEAD" }).catch(() => null);
  if (head?.ok) return log(`= already on FastFS: ${url}`);
  if (code.length <= CHUNK) {
    // Simple { relative_path, content: Some({ mime_type, content }) }
    await fastfsSend(Buffer.concat([Buffer.from([0]), str(relPath), Buffer.from([1]), str(MIME), bytes(code)]));
  } else {
    const nonce = Math.floor(Math.random() * 2 ** 31);
    for (let off = 0; off < code.length; off += CHUNK) {
      // Partial { relative_path, offset, full_size, mime_type, content_chunk, nonce }
      const chunk = code.subarray(off, Math.min(off + CHUNK, code.length));
      await fastfsSend(Buffer.concat([Buffer.from([1]), str(relPath), u32(off), u32(code.length), str(MIME), bytes(chunk), u32(nonce)]));
      log(`  chunk @${off} (${chunk.length} B) sent`);
    }
  }
  for (let i = 0; i < 90; i++) { // large multi-part files can take a few minutes to assemble
    const r = await fetch(url).catch(() => null);
    if (r?.ok) {
      const got = createHash("sha256").update(new Uint8Array(await r.arrayBuffer())).digest("hex");
      if (got === hash) return log(`✓ uploaded and verified: ${url}`);
      log(`  FastFS served a different hash (${got.slice(0, 12)}…), waiting`);
    }
    await new Promise((res) => setTimeout(res, 4000));
  }
  usage(`FastFS didn't serve ${url} with the right hash after 6 minutes`);
}

async function project() {
  const source = { WasmUrl: { url, hash, build_target: "wasm32-wasip2" } };
  const mine = (await view<unknown[]>(OUTLAYER, "list_user_projects", { account_id: ROOT_ACCOUNT }).catch(() => [])) ?? [];
  const has = JSON.stringify(mine).includes(PROJECT_ID) || JSON.stringify(mine).includes(`"${PROJECT_NAME}"`);
  if (!has) {
    await call(root, OUTLAYER, "create_project", { name: PROJECT_NAME, source }, { deposit: near("0.1"), gas: 100n * TGAS });
    log(`✓ created project ${PROJECT_ID}`);
  } else {
    try {
      await call(root, OUTLAYER, "add_version", { project_name: PROJECT_NAME, source, set_active: true }, { deposit: near("0.1"), gas: 100n * TGAS });
      log(`✓ added version ${hash.slice(0, 12)}… to ${PROJECT_ID} (active)`);
    } catch (e) {
      const m = (e as Error).message;
      if (!/exist|already/i.test(m)) throw e;
      await call(root, OUTLAYER, "set_active_version", { project_name: PROJECT_NAME, version_key: hash }, { gas: 30n * TGAS });
      log(`= version ${hash.slice(0, 12)}… already there; set active`);
    }
  }
}

/** ECIES to the keystore: 0x01 || ephemeral X25519 pub (32) || nonce (12) || ciphertext||tag. */
function encrypt(pubHex: string, plaintext: string): string {
  const raw = Buffer.from(pubHex, "hex");
  if (raw.length !== 32) usage(`keystore pubkey is ${raw.length} bytes, expected 32`);
  const recipient = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b656e032100", "hex"), raw]), format: "der", type: "spki" });
  const eph = generateKeyPairSync("x25519");
  const shared = diffieHellman({ privateKey: eph.privateKey, publicKey: recipient });
  const key = Buffer.from(hkdfSync("sha256", shared, Buffer.alloc(0), Buffer.from("outlayer-keystore-v1"), 32));
  const nonce = randomBytes(12);
  const c = createCipheriv("chacha20-poly1305", key, nonce, { authTagLength: 16 });
  const ct = Buffer.concat([c.update(Buffer.from(plaintext, "utf8")), c.final(), c.getAuthTag()]);
  const ephRaw = eph.publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  return Buffer.concat([Buffer.from([1]), ephRaw, nonce, ct]).toString("base64");
}

async function secrets(estate: string) {
  const apiKey = process.env.NEAR_AI_API_KEY?.trim();
  if (!apiKey) return log(`! NEAR_AI_API_KEY not set — skipping secrets for ${estate}`);
  const secretsJson = JSON.stringify({ NEAR_AI_API_KEY: apiKey });
  const r = await fetch(`${API}/secrets/pubkey`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accessor: { type: "Project", project_id: PROJECT_ID }, owner: estate, profile: PROFILE, secrets_json: secretsJson }),
  });
  if (!r.ok) usage(`keystore pubkey request failed: ${r.status} ${(await r.text()).slice(0, 200)}`);
  const { pubkey } = (await r.json()) as { pubkey: string };
  const encrypted = encrypt(pubkey, secretsJson);
  await call(
    account(estate),
    OUTLAYER,
    "store_secrets",
    {
      accessor: { Project: { project_id: PROJECT_ID } },
      profile: PROFILE,
      encrypted_secrets_base64: encrypted,
      // Judged on the account that calls OutLayer (the estate contract), not the transaction's signer: captures are
      // signed by the surveyor or relayed by the app's relayer, so a plain Whitelist[estate] refuses every real run.
      access: { Predecessor: { condition: { Whitelist: { accounts: [estate] } } } },
      vault_id: null,
    },
    { deposit: near("0.1"), gas: 50n * TGAS },
  );
  log(`✓ ${estate}: NEAR_AI_API_KEY stored (profile "${PROFILE}", usable only in runs requested by the ${estate} contract)`);
}

async function pin(estate: string, developer: string) {
  const verifier = { repo: `project:${PROJECT_ID}`, commit: hash, build_target: "wasm32-wasip2" };
  try {
    await call(account(developer), estate, "set_verifier", { verifier }, { gas: 30n * TGAS });
    log(`✓ ${estate}: verifier pinned to ${hash.slice(0, 12)}…`);
  } catch (e) {
    log(`! ${estate}: couldn't pin (${(e as Error).message.slice(0, 120)})`);
  }
}

// ---------- run ----------
if (!argv.includes("--skip-upload")) await upload();
await project();
record("verifier_project", PROJECT_ID);
record("verifier_version", hash);

for (const path of CONFIGS) {
  const text = readFileSync(path, "utf8");
  const cfg = JSON.parse(text);
  // Pin in place (only the verifier.commit value changes; the file's layout is kept).
  const pinned = text.replace(/("verifier"\s*:\s*\{[^}]*"commit"\s*:\s*")[^"]*(")/, `$1${hash}$2`);
  if (pinned !== text) writeFileSync(path, pinned);
  const estate = `${cfg.account}.${ROOT_ACCOUNT}`;
  if (!(await exists(estate))) {
    log(`= ${estate} not deployed yet; config pinned for its deploy`);
    continue;
  }
  if (!argv.includes("--skip-secrets")) await secrets(estate);
  const dev = cfg.developer.includes(".") ? cfg.developer : `${cfg.developer}.${ROOT_ACCOUNT}`;
  await pin(estate, dev);
}
log(`done. Project ${PROJECT_ID}, version key ${hash}. Deployments: ${JSON.stringify(deployments().verifier_version ?? "")}`);
