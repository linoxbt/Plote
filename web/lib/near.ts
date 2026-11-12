// Chain access: JSON-RPC views with failover between two RPCs and a 5 s cache,
// plus call/transaction helpers through the connected wallet (near-connect).

import type { ZodType } from "zod";
import { APP_URL, NETWORK, RPC_URLS, USDC_ID } from "./config";
import { PloteError, parseErrorCode } from "./errors";
import { parseEventLogs, type PloteEventLog } from "./events";

// ---------------------------------------------------------------------------
// bytes helpers (work in the browser, on the edge and in Node)

export function utf8ToBase64(s: string): string {
  return bytesToBase64(new TextEncoder().encode(s));
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------------------------------------------------------------------------
// JSON-RPC with failover

type RpcErrorBody = {
  name?: string;
  code?: number;
  message?: string;
  data?: unknown;
  cause?: { name?: string; info?: Record<string, unknown> };
};

export class RpcError extends PloteError {
  rpcName: string | undefined;
  constructor(body: RpcErrorBody | string) {
    const raw = typeof body === "string" ? body : JSON.stringify(body);
    const code =
      parseErrorCode(raw) ??
      (typeof body !== "string" && ["UNKNOWN_ACCOUNT", "NO_CONTRACT_CODE"].includes(body.cause?.name ?? "")
        ? "CONTRACT_NOT_DEPLOYED"
        : /CodeDoesNotExist|does not exist|UNKNOWN_ACCOUNT|NO_CONTRACT_CODE/i.test(raw)
          ? "CONTRACT_NOT_DEPLOYED"
          : "VIEW_FAILED");
    super(code, raw);
    this.rpcName = typeof body === "string" ? undefined : body.cause?.name ?? body.name;
  }
}

const RETRYABLE = new Set(["INTERNAL_ERROR", "TIMEOUT_ERROR", "UNAVAILABLE_SHARD", "NO_SYNCED_BLOCKS", "NOT_SYNCED_YET"]);

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, cache: "no-store" });
  } finally {
    clearTimeout(t);
  }
}

export async function rpc<T>(method: string, params: unknown, opts: { timeoutMs?: number; urls?: string[] } = {}): Promise<T> {
  const urls = opts.urls ?? RPC_URLS;
  let lastErr: unknown = new PloteError("RPC_UNAVAILABLE", "no RPC configured");
  for (const url of urls) {
    try {
      const res = await fetchWithTimeout(
        url,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: "plote", method, params }),
        },
        opts.timeoutMs ?? 8000,
      );
      if (!res.ok) {
        lastErr = new PloteError("RPC_UNAVAILABLE", `HTTP ${res.status} from ${url}`);
        continue;
      }
      const j = (await res.json()) as { result?: T; error?: RpcErrorBody };
      if (j.error) {
        const name = j.error.cause?.name ?? j.error.name ?? "";
        if (RETRYABLE.has(name)) {
          lastErr = new RpcError(j.error);
          continue;
        }
        throw new RpcError(j.error);
      }
      return j.result as T;
    } catch (e) {
      if (e instanceof RpcError) throw e;
      lastErr = e instanceof PloteError ? e : new PloteError("RPC_UNAVAILABLE", e instanceof Error ? `${url}: ${e.message}` : String(e));
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------------------
// views (5 s cache, in-flight dedupe)

const VIEW_TTL_MS = 5000;
const viewCache = new Map<string, { at: number; p: Promise<unknown> }>();

/**
 * Right after the user's own transaction, read at "optimistic" finality so the page shows what they just did instead
 * of the state 1–2 blocks earlier. Everyone else (and the same user later) reads "final".
 */
const OPTIMISTIC_AFTER_TX_MS = 30_000;
let optimisticUntil = 0;

export function viewFinality(now = Date.now()): "final" | "optimistic" {
  return now < optimisticUntil ? "optimistic" : "final";
}

type CallFunctionResult = { result?: number[]; logs?: string[]; error?: string; block_height?: number };

export async function viewUncached<T>(contractId: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
  const r = await rpc<CallFunctionResult>("query", {
    request_type: "call_function",
    finality: viewFinality(),
    account_id: contractId,
    method_name: method,
    args_base64: utf8ToBase64(JSON.stringify(args)),
  });
  if (r.error) throw new RpcError(r.error);
  const bytes = r.result ?? [];
  if (bytes.length === 0) return null as T;
  const text = new TextDecoder().decode(new Uint8Array(bytes));
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

export function view<T>(contractId: string, method: string, args: Record<string, unknown> = {}, opts: { fresh?: boolean } = {}): Promise<T> {
  const key = `${contractId}|${method}|${JSON.stringify(args)}`;
  const now = Date.now();
  const hit = viewCache.get(key);
  if (!opts.fresh && hit && now - hit.at < VIEW_TTL_MS) return hit.p as Promise<T>;
  const p = viewUncached<T>(contractId, method, args);
  viewCache.set(key, { at: now, p });
  p.catch(() => {
    if (viewCache.get(key)?.p === p) viewCache.delete(key);
  });
  if (viewCache.size > 500) {
    for (const [k, v] of viewCache) if (now - v.at > VIEW_TTL_MS) viewCache.delete(k);
  }
  return p;
}

export function clearViewCache(contractId?: string) {
  if (!contractId) return viewCache.clear();
  for (const k of viewCache.keys()) if (k.startsWith(contractId + "|")) viewCache.delete(k);
}

/** `a-4b.harmattan-court.plote.testnet` → `harmattan-court.plote.testnet` (null for a top-level account). */
function parentAccount(account: string): string | null {
  const i = account.indexOf(".");
  return i > 0 && account.indexOf(".", i + 1) > 0 ? account.slice(i + 1) : null;
}

/**
 * Contracts whose cached views a transaction can change: its receiver; for USDC calls the token receiver
 * (`ft_transfer_call` to a unit books the payment on the unit's estate, to an estate it buys a listing); for a call
 * on a unit account its estate; and USDC itself whenever an estate or unit moves money out.
 */
export function accountsTouchedBy(spec: TxSpec): string[] {
  const out = new Set<string>([spec.receiverId]);
  const parent = parentAccount(spec.receiverId);
  if (parent) out.add(parent);
  for (const a of spec.actions) {
    for (const k of ["receiver_id", "account_id"] as const) {
      const v = a.args?.[k];
      if (typeof v === "string" && v) {
        out.add(v);
        const p = parentAccount(v);
        if (p) out.add(p);
      }
    }
  }
  if (spec.receiverId !== USDC_ID) out.add(USDC_ID);
  return [...out];
}

/** After the user's own transaction: drop cached views it may have changed and read optimistic state for a while. */
export function afterOwnTx(specs: TxSpec | TxSpec[]) {
  for (const s of Array.isArray(specs) ? specs : [specs]) for (const a of accountsTouchedBy(s)) clearViewCache(a);
  optimisticUntil = Date.now() + OPTIMISTIC_AFTER_TX_MS;
}

/**
 * Check a view's JSON against a schema (lib/schemas.ts). A shape the app doesn't understand fails with code
 * BAD_VIEW and a message naming the field, never as a silent `undefined` later.
 */
export function parseView<T>(data: unknown, schema: ZodType<unknown>, where: string): T {
  const r = schema.safeParse(data);
  if (r.success) return r.data as T;
  const issue = r.error.issues[0];
  const path = issue?.path?.length ? issue.path.join(".") : "(root)";
  const detail = `${path}: ${issue?.message ?? "invalid"}`;
  throw new PloteError("BAD_VIEW", `${where} returned an unexpected shape at ${detail}`, `${where} returned data this site doesn't understand (${detail}). The contract may be a different version than this site expects.`);
}

/** `view` plus a runtime shape check. */
export function viewChecked<T>(contractId: string, method: string, args: Record<string, unknown>, schema: ZodType<unknown>, opts: { fresh?: boolean } = {}): Promise<T> {
  return view<unknown>(contractId, method, args, opts).then((d) => parseView<T>(d, schema, `${contractId} ${method}`));
}

export type AccessKeyView = {
  nonce: number;
  permission: "FullAccess" | { FunctionCall: { allowance: string | null; receiver_id: string; method_names: string[] } };
  block_hash?: string;
};

export async function viewAccessKey(accountId: string, publicKey: string): Promise<AccessKeyView | null> {
  try {
    return await rpc<AccessKeyView>("query", {
      request_type: "view_access_key",
      finality: "final",
      account_id: accountId,
      public_key: publicKey,
    });
  } catch (e) {
    if (e instanceof RpcError && e.code !== "RPC_UNAVAILABLE") return null;
    throw e;
  }
}

export type AccountView = { amount: string; locked: string; code_hash: string; storage_usage: number };

export async function viewAccount(accountId: string): Promise<AccountView | null> {
  try {
    return await rpc<AccountView>("query", { request_type: "view_account", finality: "final", account_id: accountId });
  } catch (e) {
    if (e instanceof RpcError) return null;
    throw e;
  }
}

/** Full-access keys on an account. For an estate, none means nobody (not even its deployer) can change its code. */
export async function fullAccessKeyCount(accountId: string): Promise<number> {
  const r = await rpc<{ keys: { access_key: { permission: unknown } }[] }>("query", { request_type: "view_access_key_list", finality: "final", account_id: accountId });
  return r.keys.filter((k) => k.access_key.permission === "FullAccess").length;
}

export async function nodeStatus(url: string): Promise<{ ok: boolean; height?: number; ms: number; error?: string }> {
  const t0 = Date.now();
  try {
    const r = await rpc<{ sync_info: { latest_block_height: number } }>("status", [], { urls: [url], timeoutMs: 5000 });
    return { ok: true, height: r.sync_info.latest_block_height, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// transaction specs and outcomes

export const TGAS = 1_000_000_000_000n;
export const gas = (tgas: number) => (BigInt(tgas) * TGAS).toString();
export const ONE_YOCTO = "1";
export const ZERO = "0";

export type FunctionCallSpec = { method: string; args: Record<string, unknown>; gas: string; deposit: string };
export type TxSpec = { receiverId: string; actions: FunctionCallSpec[] };

export function fnCall(receiverId: string, method: string, args: Record<string, unknown>, tgas: number, deposit: string = ZERO): TxSpec {
  return { receiverId, actions: [{ method, args, gas: gas(tgas), deposit }] };
}

export function isNonPayable(spec: TxSpec): boolean {
  return spec.actions.every((a) => a.deposit === "0");
}

export type TxResult = {
  hash: string;
  logs: string[];
  events: PloteEventLog[];
  returnValue: unknown;
};

type OutcomeLike = {
  transaction?: { hash?: string };
  transaction_outcome?: { id?: string; outcome?: { logs?: string[] } };
  receipts_outcome?: { id?: string; outcome?: { logs?: string[]; status?: unknown } }[];
  status?: unknown;
};

function failureMessage(status: unknown): string | null {
  if (!status || typeof status !== "object") return null;
  const s = status as Record<string, unknown>;
  if (!("Failure" in s)) return null;
  return JSON.stringify(s.Failure);
}

export function parseOutcome(raw: unknown): TxResult {
  const o = (raw ?? {}) as OutcomeLike;
  const hash = o.transaction?.hash ?? o.transaction_outcome?.id ?? "";
  const logs: string[] = [...(o.transaction_outcome?.outcome?.logs ?? [])];
  let receiptFailure: string | null = null;
  for (const r of o.receipts_outcome ?? []) {
    logs.push(...(r.outcome?.logs ?? []));
    receiptFailure ??= failureMessage(r.outcome?.status);
  }
  const fail = failureMessage(o.status) ?? null;
  if (fail) {
    const code = parseErrorCode(fail) ?? parseErrorCode(receiptFailure) ?? "UNKNOWN";
    const err = new PloteError(code, fail);
    (err as PloteError & { txHash?: string }).txHash = hash;
    throw err;
  }
  let returnValue: unknown = undefined;
  const st = o.status as { SuccessValue?: string } | undefined;
  if (st && typeof st === "object" && typeof st.SuccessValue === "string" && st.SuccessValue.length > 0) {
    try {
      returnValue = JSON.parse(new TextDecoder().decode(base64ToBytes(st.SuccessValue)));
    } catch {
      returnValue = st.SuccessValue;
    }
  }
  return { hash, logs, events: parseEventLogs(logs), returnValue };
}

// ---------------------------------------------------------------------------
// wallet (near-connect). Browser only: imported lazily.

import type { NearConnector, NearWalletBase, ConnectorAction } from "@hot-labs/near-connect";

let connectorPromise: Promise<NearConnector> | null = null;

export function getConnector(): Promise<NearConnector> {
  if (typeof window === "undefined") return Promise.reject(new PloteError("WALLET_NOT_CONNECTED", "wallet is browser-only"));
  if (!connectorPromise) {
    connectorPromise = import("@hot-labs/near-connect").then(async ({ NearConnector }) => {
      const c = new NearConnector({
        network: NETWORK,
        providers: { [NETWORK]: RPC_URLS },
        features: NETWORK === "testnet" ? { testnet: true } : { mainnet: true },
        footerBranding: { heading: "Plote", link: APP_URL, linkText: "Pay for the house you can see" },
        autoConnect: true,
      });
      try {
        await c.whenManifestLoaded;
      } catch {
        /* manifest fetch failed; connect() will surface it */
      }
      return c;
    });
    connectorPromise.catch(() => {
      connectorPromise = null;
    });
  }
  return connectorPromise;
}

export async function getWallet(): Promise<NearWalletBase> {
  const c = await getConnector();
  try {
    return await c.wallet();
  } catch (e) {
    throw new PloteError("WALLET_NOT_CONNECTED", e instanceof Error ? e.message : String(e));
  }
}

function toConnectorActions(spec: TxSpec): ConnectorAction[] {
  return spec.actions.map((a) => ({
    type: "FunctionCall",
    params: { methodName: a.method, args: a.args, gas: a.gas, deposit: a.deposit },
  }));
}

/** Sign and send one transaction through the connected wallet. */
export async function sendTx(spec: TxSpec): Promise<TxResult> {
  const w = await getWallet();
  const out = await w.signAndSendTransaction({ receiverId: spec.receiverId, actions: toConnectorActions(spec) });
  afterOwnTx(spec);
  return parseOutcome(out);
}

/**
 * Several transactions in one wallet approval when the wallet supports `signAndSendTransactions`
 * (e.g. reserve + ft_transfer_call); otherwise one approval each, in order.
 */
export async function sendTxs(specs: TxSpec[]): Promise<TxResult[]> {
  const w = await getWallet();
  let outs: unknown[];
  if (w.manifest?.features?.signAndSendTransactions !== false) {
    outs = await w.signAndSendTransactions({
      transactions: specs.map((s) => ({ receiverId: s.receiverId, actions: toConnectorActions(s) })),
    });
  } else {
    outs = [];
    for (const s of specs) outs.push(await w.signAndSendTransaction({ receiverId: s.receiverId, actions: toConnectorActions(s) }));
  }
  afterOwnTx(specs);
  return outs.map(parseOutcome);
}

// ---------------------------------------------------------------------------
// Function-call keys the app holds in this browser (SPEC §4 "Keys on each account", §9.1).
//  - "login": added during sign-in (near-connect `addFunctionCallKey`) or later from the votes page, for the
//    frequent non-payable estate calls (vote, sync, qs_sign, submit_evidence, declare_default…).
//  - "dev": the developer's day-to-day key for claim_release, added from /dev.
// Each key is created in the browser and added to the user's account by one wallet approval (function-call
// permission for one contract, 0.25 NEAR allowance).
//
// The private key is always generated NON-extractable with WebCrypto Ed25519 and kept in IndexedDB as a CryptoKey
// (like lib/phone-key.ts): page scripts can sign with it but can never read it. Browsers without WebCrypto Ed25519
// get no app key at all (every call opens the wallet); there is no plaintext fallback. Keys an older build left in
// localStorage are moved into IndexedDB the first time they're seen (imported non-extractable and checked to sign for
// the same public key) and the plaintext copy is deleted either way.

const FCK_PREFIX = "plote:fck:";
export const LOGIN_KEY_ALLOWANCE = "250000000000000000000000"; // 0.25 NEAR

export type AppKeyRole = "login" | "dev";
/** localStorage record written by older builds (read once, then deleted). */
type LegacySecret = { sk: string; methods: string[] | null; pk?: string };
/** IndexedDB record: the private key is a non-extractable CryptoKey. */
type StoredCryptoKey = { kind: "webcrypto"; publicKey: string; privateKey: CryptoKey; methods: string[] | null; createdAt: number };
type AppKey = { publicKey: string; privateKey: CryptoKey; methods: string[] | null };

function fckKey(accountId: string, contractId: string, role: AppKeyRole = "login") {
  return `${FCK_PREFIX}${NETWORK}:${accountId}:${contractId}${role === "login" ? "" : `:${role}`}`;
}

/** Every slot of this account on this network starts with this (any contract, any role). */
export function appKeySlotPrefix(accountId: string) {
  return `${FCK_PREFIX}${NETWORK}:${accountId}:`;
}

// IndexedDB: same database and store as lib/phone-key.ts ("plote" / "keys"), different slot names.
function openKeyDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("plote", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("keys");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function keyDb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openKeyDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction("keys", mode);
      const req = fn(tx.objectStore("keys"));
      tx.oncomplete = () => resolve(req.result as T);
      tx.onerror = () => reject(tx.error ?? req.error);
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
    });
  } finally {
    db.close();
  }
}

async function readCryptoKey(slot: string): Promise<StoredCryptoKey | null> {
  if (typeof indexedDB === "undefined") return null;
  try {
    const r = await keyDb<StoredCryptoKey | undefined>("readonly", (s) => s.get(slot));
    return r && r.kind === "webcrypto" && r.privateKey instanceof CryptoKey ? r : null;
  } catch {
    return null;
  }
}

function readLegacySecret(slot: string): LegacySecret | null {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(slot);
  } catch {
    return null;
  }
  if (!raw) return null;
  if (raw.startsWith("ed25519:")) return { sk: raw, methods: null }; // legacy: bare secret, methods unknown
  try {
    const j = JSON.parse(raw) as Partial<LegacySecret>;
    return typeof j.sk === "string" ? { sk: j.sk, methods: Array.isArray(j.methods) ? j.methods : null, pk: j.pk } : null;
  } catch {
    return null;
  }
}

function removeLegacySecret(slot: string) {
  try {
    window.localStorage.removeItem(slot);
  } catch {
    /* ignore */
  }
}

async function secretPublicKey(secret: string): Promise<string | null> {
  try {
    const { KeyPair } = await import("near-api-js");
    return KeyPair.fromString(secret as `ed25519:${string}`).getPublicKey().toString();
  } catch {
    return null;
  }
}

/** Move a legacy localStorage secret into IndexedDB as a non-extractable key. Returns the new record, or null. */
async function migrateSecret(slot: string, k: LegacySecret): Promise<StoredCryptoKey | null> {
  const { ed25519WebCryptoSupported, importSecretNonExtractable } = await import("./webcrypto-ed25519");
  if (typeof indexedDB === "undefined" || !(await ed25519WebCryptoSupported())) return null;
  const publicKey = k.pk ?? (await secretPublicKey(k.sk));
  if (!publicKey) return null;
  const privateKey = await importSecretNonExtractable(k.sk, publicKey);
  if (!privateKey) return null;
  const rec: StoredCryptoKey = { kind: "webcrypto", publicKey, privateKey, methods: k.methods, createdAt: Date.now() };
  try {
    await keyDb("readwrite", (s) => s.put(rec, slot));
  } catch {
    return null;
  }
  const back = await readCryptoKey(slot);
  return back && back.publicKey === publicKey ? back : null;
}

/** The app key for (account, contract, role) on this device. A legacy plaintext key is migrated or dropped, never used. */
async function loadAppKey(accountId: string, contractId: string, role: AppKeyRole): Promise<AppKey | null> {
  if (typeof window === "undefined") return null;
  const slot = fckKey(accountId, contractId, role);
  const ck = await readCryptoKey(slot);
  if (ck) {
    removeLegacySecret(slot);
    return { publicKey: ck.publicKey, privateKey: ck.privateKey, methods: ck.methods };
  }
  const legacy = readLegacySecret(slot);
  if (!legacy) return null;
  const moved = await migrateSecret(slot, legacy).catch(() => null);
  // Either way the plaintext copy goes: a key this browser can't hold non-extractably isn't kept.
  removeLegacySecret(slot);
  return moved ? { publicKey: moved.publicKey, privateKey: moved.privateKey, methods: moved.methods } : null;
}

/** Thrown when this browser can't keep a non-extractable key; callers fall back to wallet approvals. */
export const APP_KEY_UNSUPPORTED = "APP_KEY_UNSUPPORTED";

/** A new non-extractable key pair for an app key. Call `save` only after the AddKey was approved. */
async function createAppKey(): Promise<{ publicKey: string; save: (accountId: string, contractId: string, role: AppKeyRole, methods: string[]) => Promise<void> }> {
  const { ed25519WebCryptoSupported, generateNonExtractable } = await import("./webcrypto-ed25519");
  if (typeof indexedDB === "undefined" || !(await ed25519WebCryptoSupported())) {
    throw new PloteError(
      APP_KEY_UNSUPPORTED,
      "WebCrypto Ed25519 or IndexedDB unavailable",
      "This browser can't keep a key that scripts can't read (it lacks WebCrypto Ed25519), so Plote won't store one here. Your wallet will ask you to approve each action instead. A current Chrome, Edge, Safari or Firefox supports it.",
    );
  }
  const { privateKey, publicKey } = await generateNonExtractable();
  return {
    publicKey,
    save: async (accountId, contractId, role, methods) => {
      const slot = fckKey(accountId, contractId, role);
      try {
        await keyDb("readwrite", (s) => s.put({ kind: "webcrypto", publicKey, privateKey, methods, createdAt: Date.now() } satisfies StoredCryptoKey, slot));
        removeLegacySecret(slot); // a key this one replaces
      } catch {
        /* if storage is blocked the key just isn't remembered; calls fall back to the wallet */
      }
    },
  };
}

/** Public key of a stored app key ("ed25519:…"), for checking it on-chain with `viewAccessKey`. */
export async function appKeyPublic(accountId: string, contractId: string, role: AppKeyRole = "login"): Promise<string | null> {
  const k = await loadAppKey(accountId, contractId, role);
  return k?.publicKey ?? null;
}

export async function addLoginKey(accountId: string, contractId: string, methodNames: string[], role: AppKeyRole = "login"): Promise<string> {
  const key = await createAppKey();
  const w = await getWallet();
  await w.signAndSendTransaction({
    receiverId: accountId,
    actions: [
      {
        type: "AddKey",
        params: {
          publicKey: key.publicKey,
          accessKey: { permission: { receiverId: contractId, allowance: LOGIN_KEY_ALLOWANCE, methodNames } },
        },
      },
    ],
  });
  await key.save(accountId, contractId, role, methodNames);
  return key.publicKey;
}

/** Forget an app key on this device (both stores). The key stays on the account until removed with the wallet. */
export async function forgetLoginKey(accountId: string, contractId: string, role: AppKeyRole = "login"): Promise<void> {
  if (typeof window === "undefined") return;
  const slot = fckKey(accountId, contractId, role);
  removeLegacySecret(slot);
  if (typeof indexedDB === "undefined") return;
  try {
    await keyDb("readwrite", (s) => s.delete(slot));
  } catch {
    /* ignore */
  }
}

/**
 * Forget every app key of `accountId` on this device (every contract and role, both stores): run on wallet
 * disconnect, so the next person on this browser can't sign with the previous user's keys. The keys stay on the
 * account (0.25 NEAR allowance each, scoped to one contract) until removed with the wallet.
 */
export async function forgetAllAppKeys(accountId: string): Promise<number> {
  if (typeof window === "undefined") return 0;
  const prefix = appKeySlotPrefix(accountId);
  let n = 0;
  try {
    const ls = window.localStorage;
    const doomed: string[] = [];
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (k && k.startsWith(prefix)) doomed.push(k);
    }
    doomed.forEach((k) => ls.removeItem(k));
    n += doomed.length;
  } catch {
    /* storage blocked */
  }
  if (typeof indexedDB === "undefined") return n;
  try {
    const keys = await keyDb<IDBValidKey[]>("readonly", (s) => s.getAllKeys());
    const mine = (keys ?? []).filter((k): k is string => typeof k === "string" && k.startsWith(prefix));
    for (const k of mine) await keyDb("readwrite", (s) => s.delete(k));
    n += mine.length;
  } catch {
    /* ignore */
  }
  return n;
}

/** Delete an app key from the account (one wallet approval) and forget it locally. */
export async function removeAppKey(accountId: string, contractId: string, role: AppKeyRole): Promise<void> {
  const publicKey = await appKeyPublic(accountId, contractId, role);
  if (publicKey) {
    const w = await getWallet();
    await w.signAndSendTransaction({ receiverId: accountId, actions: [{ type: "DeleteKey", params: { publicKey } }] });
  }
  await forgetLoginKey(accountId, contractId, role);
}

/**
 * Sign in through near-connect and, when the chosen wallet supports it, ask for the login function-call key
 * for `contractId` in the same step (SPEC §9.1). Wallets without `signInWithFunctionCallKey`, and browsers that
 * can't keep a non-extractable key, sign in normally. Returns the signed-in account and whether a key was asked for.
 */
export async function signInWithLoginKey(contractId: string | null, methodNames: string[]): Promise<{ wallet: NearWalletBase; accountId: string | null; keyRequested: boolean }> {
  const c = await getConnector();
  const walletId = await c.selectWallet();
  const manifest = c.availableWallets.find((w) => w.manifest.id === walletId)?.manifest;
  const supportsKey = !!contractId && !!manifest?.features?.signInWithFunctionCallKey;
  const key = supportsKey ? await createAppKey().catch(() => null) : null;
  if (key) {
    try {
      const wallet = await c.connect({
        walletId,
        addFunctionCallKey: {
          contractId: contractId!,
          publicKey: key.publicKey,
          allowMethods: { anyMethod: false, methodNames },
          gasAllowance: { kind: "limited", amount: LOGIN_KEY_ALLOWANCE },
        },
      });
      const accounts = await wallet.getAccounts();
      const accountId = accounts[0]?.accountId ?? null;
      // Kept locally; `callNoPopup` checks it's on the account before using it and otherwise asks the wallet.
      if (accountId) await key.save(accountId, contractId!, "login", methodNames);
      return { wallet, accountId, keyRequested: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/reject|cancel|closed|denied/i.test(msg)) throw e;
      // The wallet advertised the feature but failed: sign in without the key rather than not at all.
    }
  }
  const wallet = await c.connect({ walletId });
  const accounts = await wallet.getAccounts();
  return { wallet, accountId: accounts[0]?.accountId ?? null, keyRequested: false };
}

async function signerFor(k: AppKey) {
  const { PublicKey, Signer } = await import("near-api-js");
  const { signWith } = await import("./webcrypto-ed25519");
  const { publicKey, privateKey } = k;
  class DeviceKeySigner extends Signer {
    async getPublicKey() {
      return PublicKey.fromString(publicKey);
    }
    protected async signBytes(bytes: Uint8Array) {
      return signWith(privateKey, bytes);
    }
  }
  return new DeviceKeySigner();
}

/** The app key can't be used for this call; nothing was broadcast, so the wallet may be asked instead. */
export class KeyUnusableError extends PloteError {
  constructor(reason: string) {
    super("APP_KEY_UNUSABLE", reason, `This browser's app key can't send this call (${reason}).`);
  }
}

/**
 * Errors from broadcasting with an app key that prove the transaction was rejected before it ran (an invalid
 * transaction: the key isn't on the account, its allowance is spent, or its permission doesn't cover the call).
 * Only these may fall back to the wallet: anything else (a timeout, a dropped connection, an RPC error after the
 * transaction was sent) may mean it is already on its way, and asking the wallet would send it twice.
 */
const KEY_ERROR_RE =
  /InvalidAccessKey|AccessKeyNotFound|AccessKeyDoesNotExist|access key .{0,80}does not exist|NotEnoughAllowance|MethodNameMismatch|ReceiverMismatch|RequiresFullAccess|DepositWithFunctionCall|key not found/i;

export function isKeyError(e: unknown): boolean {
  if (e instanceof KeyUnusableError) return true;
  if (e instanceof PloteError && e.code.startsWith("E_")) return false; // the contract answered
  const parts: string[] = [];
  if (e instanceof Error) parts.push(e.name, e.message);
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>;
    for (const k of ["type", "code", "raw"]) if (typeof o[k] === "string") parts.push(o[k] as string);
    try {
      parts.push(JSON.stringify(e));
    } catch {
      /* circular */
    }
  } else parts.push(String(e));
  return KEY_ERROR_RE.test(parts.join(" "));
}

/** Rough upper bound of what a call costs the key's allowance: attached gas × 0.1 Ggas price ceiling (yocto). */
function gasCostCeiling(spec: TxSpec): bigint {
  return spec.actions.reduce((n, a) => n + BigInt(a.gas), 0n) * 1_000_000_000n;
}

/** Phase 1 (nothing broadcast yet): the stored key must be on the account and allowed to make this call. */
async function preflightKey(accountId: string, key: AppKey, spec: TxSpec): Promise<void> {
  const ak = await viewAccessKey(accountId, key.publicKey).catch(() => {
    throw new KeyUnusableError("couldn't read the key from the chain");
  });
  if (!ak) throw new KeyUnusableError("key not found on the account");
  if (ak.permission === "FullAccess") return;
  const fc = ak.permission.FunctionCall;
  if (fc.receiver_id !== spec.receiverId) throw new KeyUnusableError("key is for another contract");
  if (fc.method_names.length && !spec.actions.every((a) => fc.method_names.includes(a.method))) throw new KeyUnusableError("method not covered by the key");
  if (fc.allowance !== null && BigInt(fc.allowance) < gasCostCeiling(spec)) throw new KeyUnusableError("NotEnoughAllowance");
}

async function sendWithKey(accountId: string, key: AppKey, spec: TxSpec): Promise<TxResult> {
  await preflightKey(accountId, key, spec);
  const { Account, JsonRpcProvider, actions } = await import("near-api-js");
  const provider = new JsonRpcProvider({ url: RPC_URLS[0] });
  let signed: Awaited<ReturnType<InstanceType<typeof Account>["createSignedTransaction"]>>;
  try {
    const account = new Account(accountId, provider, await signerFor(key));
    signed = await account.createSignedTransaction({
      receiverId: spec.receiverId,
      actions: spec.actions.map((a) => actions.functionCall(a.method, a.args, BigInt(a.gas), BigInt(a.deposit))),
    });
  } catch (e) {
    // Building or signing failed locally: nothing left this browser.
    throw new KeyUnusableError(e instanceof Error ? e.message : String(e));
  }
  // Phase 2: broadcast. From here on only a proven invalid-transaction rejection may fall back (see isKeyError).
  const res = await provider.sendTransaction(signed);
  afterOwnTx(spec);
  return parseOutcome(res);
}

/**
 * Non-payable call: uses an app function-call key for this contract when one is stored (the developer key first
 * for the methods it covers, then the login key), otherwise the wallet (one popup). It falls back to the wallet only
 * when the key couldn't be used and nothing was sent, or the network rejected the transaction as invalid for the
 * key; never after a timeout or any error that may come after a broadcast.
 */
export async function callNoPopup(accountId: string, spec: TxSpec, deps: { load?: typeof loadAppKey; send?: typeof sendWithKey; wallet?: typeof sendTx } = {}): Promise<TxResult> {
  const load = deps.load ?? loadAppKey;
  const send = deps.send ?? sendWithKey;
  const wallet = deps.wallet ?? sendTx;
  if (isNonPayable(spec)) {
    const methods = spec.actions.map((a) => a.method);
    for (const role of ["dev", "login"] as const) {
      const k = await load(accountId, spec.receiverId, role).catch(() => null);
      if (!k) continue;
      if (k.methods && !methods.every((m) => k.methods!.includes(m))) continue;
      try {
        return await send(accountId, k, spec);
      } catch (e) {
        if (isKeyError(e)) continue;
        throw e;
      }
    }
  }
  return wallet(spec);
}
