// Chain access: JSON-RPC views with failover between two RPCs and a 5 s cache,
// plus call/transaction helpers through the connected wallet (near-connect).

import { APP_URL, NETWORK, RPC_URLS } from "./config";
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

type CallFunctionResult = { result?: number[]; logs?: string[]; error?: string; block_height?: number };

export async function viewUncached<T>(contractId: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
  const r = await rpc<CallFunctionResult>("query", {
    request_type: "call_function",
    finality: "final",
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
  clearViewCache(spec.receiverId);
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
  specs.forEach((s) => clearViewCache(s.receiverId));
  return outs.map(parseOutcome);
}

// ---------------------------------------------------------------------------
// Login function-call key: lets non-payable calls (vote, propose, sync…) go without a popup.
// The key is created in the browser, added to the user's account by one wallet approval
// (AddKey, function-call permission for one contract, 0.25 NEAR allowance), and kept in localStorage.

const FCK_PREFIX = "plote:fck:";
export const LOGIN_KEY_ALLOWANCE = "250000000000000000000000"; // 0.25 NEAR

function fckKey(accountId: string, contractId: string) {
  return `${FCK_PREFIX}${NETWORK}:${accountId}:${contractId}`;
}

export function getLoginKey(accountId: string, contractId: string): string | null {
  try {
    return window.localStorage.getItem(fckKey(accountId, contractId));
  } catch {
    return null;
  }
}

export async function addLoginKey(accountId: string, contractId: string, methodNames: string[]): Promise<string> {
  const { KeyPair } = await import("near-api-js");
  const kp = KeyPair.fromRandom("ed25519");
  const publicKey = kp.getPublicKey().toString();
  const w = await getWallet();
  await w.signAndSendTransaction({
    receiverId: accountId,
    actions: [
      {
        type: "AddKey",
        params: {
          publicKey,
          accessKey: { permission: { receiverId: contractId, allowance: LOGIN_KEY_ALLOWANCE, methodNames } },
        },
      },
    ],
  });
  try {
    window.localStorage.setItem(fckKey(accountId, contractId), kp.toString());
  } catch {
    /* if storage is blocked the key just isn't remembered */
  }
  return publicKey;
}

export function forgetLoginKey(accountId: string, contractId: string) {
  try {
    window.localStorage.removeItem(fckKey(accountId, contractId));
  } catch {
    /* ignore */
  }
}

async function sendWithKey(accountId: string, secret: string, spec: TxSpec): Promise<TxResult> {
  const { Account, KeyPairSigner, JsonRpcProvider, actions } = await import("near-api-js");
  const provider = new JsonRpcProvider({ url: RPC_URLS[0] });
  const signer = KeyPairSigner.fromSecretKey(secret as `ed25519:${string}`);
  const account = new Account(accountId, provider, signer);
  const res = await account.signAndSendTransaction({
    receiverId: spec.receiverId,
    actions: spec.actions.map((a) => actions.functionCall(a.method, a.args, BigInt(a.gas), BigInt(a.deposit))),
    throwOnFailure: false,
  });
  clearViewCache(spec.receiverId);
  return parseOutcome(res);
}

/**
 * Non-payable call: uses the login function-call key when one exists for this contract,
 * otherwise falls back to the wallet (one popup).
 */
export async function callNoPopup(accountId: string, spec: TxSpec): Promise<TxResult> {
  if (isNonPayable(spec)) {
    const secret = getLoginKey(accountId, spec.receiverId);
    if (secret) {
      try {
        return await sendWithKey(accountId, secret, spec);
      } catch (e) {
        // A contract panic is a real answer; key problems fall back to the wallet.
        if (e instanceof PloteError && e.code.startsWith("E_")) throw e;
      }
    }
  }
  return sendTx(spec);
}

// ---------------------------------------------------------------------------
// tx status (used by the poller and status pages)

export async function txStatus(hash: string, senderId: string): Promise<TxResult & { raw: unknown }> {
  const raw = await rpc<unknown>("EXPERIMENTAL_tx_status", { tx_hash: hash, sender_account_id: senderId, wait_until: "NONE" });
  try {
    return { ...parseOutcome(raw), raw };
  } catch {
    const o = (raw ?? {}) as OutcomeLike;
    const logs = (o.receipts_outcome ?? []).flatMap((r) => r.outcome?.logs ?? []);
    return { hash, logs, events: parseEventLogs(logs), returnValue: undefined, raw };
  }
}
