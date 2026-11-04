// Shared helpers for Plote's deploy and demo scripts (near-api-js v7).
// Keys: ~/.near-credentials/<network>/<account>.json (near-cli format) or env NEAR_KEY_<ACCOUNT_WITH_UNDERSCORES>.
import { Account, JsonRpcProvider, KeyPair, type KeyPairString } from "near-api-js";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const NETWORK = (process.env.NEAR_ENV ?? "testnet") as "testnet" | "mainnet";
export const RPC =
  process.env.NEAR_RPC_URL ?? (NETWORK === "mainnet" ? "https://rpc.mainnet.fastnear.com" : "https://test.rpc.fastnear.com");
export const ROOT_ACCOUNT = process.env.ROOT_ACCOUNT ?? (NETWORK === "mainnet" ? "" : "plote.testnet");

export const provider = new JsonRpcProvider({ url: RPC });

export const TGAS = 1_000_000_000_000n;
export const NEAR = 10n ** 24n;
export const USDC = 1_000_000n;
export const near = (n: number | string) => BigInt(Math.round(Number(n) * 1e6)) * 10n ** 18n;

const credDir = () => join(process.env.NEAR_CREDENTIALS_DIR ?? join(homedir(), ".near-credentials"), NETWORK);

export function loadKey(accountId: string): KeyPairString | undefined {
  const envKey = process.env[`NEAR_KEY_${accountId.replace(/[.-]/g, "_").toUpperCase()}`];
  if (envKey) return envKey as KeyPairString;
  const file = join(credDir(), `${accountId}.json`);
  if (!existsSync(file)) return undefined;
  const j = JSON.parse(readFileSync(file, "utf8"));
  return (j.private_key ?? j.secret_key) as KeyPairString;
}

export function saveKey(accountId: string, kp: KeyPair) {
  mkdirSync(credDir(), { recursive: true });
  const file = join(credDir(), `${accountId}.json`);
  writeFileSync(
    file,
    JSON.stringify({ account_id: accountId, public_key: kp.getPublicKey().toString(), private_key: kp.toString() }, null, 2),
    { mode: 0o600 },
  );
  return file;
}

export function account(accountId: string): Account {
  const key = loadKey(accountId);
  if (!key) throw new Error(`No key for ${accountId}. Put it in ${credDir()}/${accountId}.json or NEAR_KEY_* env.`);
  return new Account(accountId, provider, key);
}

export async function exists(accountId: string): Promise<boolean> {
  try {
    await provider.viewAccount({ accountId });
    return true;
  } catch {
    return false;
  }
}

/** Create `<prefix>.<parent>` funded with `nearAmount`, saving its new full-access key locally. */
export async function ensureSubAccount(parent: Account, prefix: string, nearAmount: string): Promise<string> {
  const id = prefix.includes(".") ? prefix : `${prefix}.${parent.accountId}`;
  if (await exists(id)) {
    log(`= ${id} exists`);
    return id;
  }
  const kp = KeyPair.fromRandom("ed25519");
  await parent.createSubAccount({ accountOrPrefix: id, publicKey: kp.getPublicKey(), nearToTransfer: near(nearAmount) });
  const file = saveKey(id, kp);
  log(`+ created ${id} (${nearAmount} NEAR), key → ${file}`);
  return id;
}

export async function view<T = unknown>(contractId: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
  return (await provider.callFunction({ contractId, method, args })) as T;
}

export async function call<T = unknown>(
  signer: Account,
  contractId: string,
  methodName: string,
  args: Record<string, unknown> = {},
  opts: { deposit?: bigint; gas?: bigint } = {},
): Promise<T> {
  return (await signer.callFunction({
    contractId,
    methodName,
    args,
    deposit: opts.deposit ?? 0n,
    gas: opts.gas ?? 100n * TGAS,
  })) as T;
}

export function wasm(name: string): Uint8Array {
  const candidates = [
    join(ROOT, "target/near", name, `${name}.wasm`),
    join(ROOT, "target/near", `${name}.wasm`),
    join(ROOT, "target/wasm32-unknown-unknown/release", `${name}.wasm`),
  ];
  const f = candidates.find(existsSync);
  if (!f) throw new Error(`Build first (just build). Looked for: ${candidates.join(", ")}`);
  return new Uint8Array(readFileSync(f));
}

/** Base58 of sha256(code): the id NEP-591 global contracts are addressed by. */
export function codeHash(code: Uint8Array): string {
  return base58(createHash("sha256").update(code).digest());
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function base58(bytes: Uint8Array): string {
  let n = BigInt("0x" + Buffer.from(bytes).toString("hex"));
  let out = "";
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out;
}

// ---------- estate config ----------

export type EstateConfig = {
  account: string; // "harmattan-court" (prefix) or full id
  name: string;
  location?: string;
  developer: string;
  payout: string;
  surveyor: string;
  recovery?: string;
  verdict_relayer?: string;
  verify_mode?: "outlayer" | "https";
  outlayer?: string;
  verifier: { repo: string; commit: string; build_target: string };
  geofence: { lat_e6: number; lon_e6: number; radius_m: number };
  milestones: { key: string; title: string; bps: number; deadline: string }[];
  params: Record<string, unknown>;
  units: { id: string; label: string; price: string; plan?: { due_at: string; cumulative: string }[] }[];
  generate_units?: { prefix: string; count: number; label: string; price: string };
  fund_verification_near?: string;
};

export function loadConfig(path: string): EstateConfig {
  const cfg = JSON.parse(readFileSync(resolve(path), "utf8")) as EstateConfig;
  if (cfg.generate_units) {
    const g = cfg.generate_units;
    for (let i = 1; i <= g.count; i++) {
      const n = String(i).padStart(2, "0");
      cfg.units.push({ id: `${g.prefix}-${n}`, label: g.label.replace("{n}", n), price: g.price });
    }
  }
  return cfg;
}

/** "2027-02-01T12:00:00Z" or relative "+30d" / "+90m" / "-10d" → nanoseconds as a string. */
export function toNs(when: string, now = Date.now()): string {
  const rel = /^([+-])(\d+)([mhd])$/.exec(when.trim());
  if (rel) {
    const mult = { m: 60_000, h: 3_600_000, d: 86_400_000 }[rel[3] as "m" | "h" | "d"];
    const ms = now + (rel[1] === "-" ? -1 : 1) * Number(rel[2]) * mult;
    return (BigInt(ms) * 1_000_000n).toString();
  }
  const ms = Date.parse(when);
  if (Number.isNaN(ms)) throw new Error(`Bad date ${when}`);
  return (BigInt(ms) * 1_000_000n).toString();
}

export function estateId(cfg: EstateConfig): string {
  return cfg.account.includes(".") ? cfg.account : `${cfg.account}.${ROOT_ACCOUNT}`;
}

export function resolveAccount(nameOrPrefix: string): string {
  return nameOrPrefix.includes(".") ? nameOrPrefix : `${nameOrPrefix}.${ROOT_ACCOUNT}`;
}

// ---------- deployments record ----------

const depFile = () => join(ROOT, "config", `deployments.${NETWORK}.json`);
export function deployments(): Record<string, string> {
  return existsSync(depFile()) ? JSON.parse(readFileSync(depFile(), "utf8")) : {};
}
export function record(key: string, value: string) {
  const d = deployments();
  d[key] = value;
  writeFileSync(depFile(), JSON.stringify(d, null, 2) + "\n");
}

export function log(...a: unknown[]) {
  console.log(...a);
}

export function usage(msg: string): never {
  console.error(msg);
  process.exit(1);
}
