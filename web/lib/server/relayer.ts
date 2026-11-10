// NEP-366 relayer: decode a SignedDelegate, check it against the allowlist, wrap it in a transaction
// from the relayer account and send it. Also lets the server call public methods (sync) itself.

import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { deserialize } from "borsh";
import bs58 from "bs58";
import { Account, JsonRpcProvider, KeyPairSigner, SCHEMA, actions, encodeDelegateAction } from "near-api-js";
import { ESTATES, NETWORK, RPC_URLS } from "../config";
import { parseOutcome, rpc, viewAccessKey, viewUncached, type AccessKeyView, type TxResult, type TxSpec } from "../near";
import type { EstateView } from "../types";
import { serverEnv } from "./env";

export type PlainFunctionCall = { methodName: string; args: Uint8Array | number[]; gas: bigint; deposit: bigint };
export type PlainDelegate = {
  delegateAction: {
    senderId: string;
    receiverId: string;
    actions: Record<string, unknown>[];
    nonce: bigint;
    maxBlockHeight: bigint;
    publicKey: unknown;
  };
  signature: unknown;
};

export function decodeSignedDelegate(b64: string): PlainDelegate {
  const bytes = Uint8Array.from(Buffer.from(b64, "base64"));
  return deserialize(SCHEMA.SignedDelegate, bytes) as PlainDelegate;
}

export type DelegateCheck = { ok: true; methods: string[] } | { ok: false; code: string; message: string };

/**
 * Methods the relayer will ever pay for, whatever RELAYER_ALLOWED_METHODS says: the surveyor's on-site calls
 * (the phone key has no NEAR). Public methods (sync, sync_deposits, sweep_unattributed) are not relayed — anyone
 * can call them with their own gas, and the server calls sync_deposits itself after a 1Click payment.
 */
export const RELAYABLE_METHODS = ["open_capture", "submit_evidence", "qs_sign"] as const;

/** Receiver must be a configured estate (or one of its unit accounts, for the server's own sync_deposits). */
export function isAllowedReceiver(receiverId: string, estates: string[] = ESTATES): boolean {
  if (estates.includes(receiverId)) return true;
  const dot = receiverId.indexOf(".");
  return dot > 0 && estates.includes(receiverId.slice(dot + 1));
}

/** Shape checks only (no I/O): receiver is an estate, actions are allowlisted zero-deposit calls under the gas cap. */
export function checkDelegate(
  sd: PlainDelegate,
  opts: { allowedMethods: string[]; maxGasTgas: number; estates?: string[] },
): DelegateCheck {
  const da = sd.delegateAction;
  if (!(opts.estates ?? ESTATES).includes(da.receiverId)) {
    return { ok: false, code: "RECEIVER_NOT_ALLOWED", message: `The relayer only pays for calls to Plote estates, not ${da.receiverId}.` };
  }
  if (!da.actions.length) return { ok: false, code: "E_BAD_ARGS", message: "No actions." };
  const allowed = opts.allowedMethods.filter((m) => (RELAYABLE_METHODS as readonly string[]).includes(m));
  const methods: string[] = [];
  let totalGas = 0n;
  for (const a of da.actions) {
    const fc = a.functionCall as PlainFunctionCall | undefined;
    if (!fc || Object.keys(a).length !== 1) return { ok: false, code: "ACTION_NOT_ALLOWED", message: "Only function calls can be relayed." };
    if (!allowed.includes(fc.methodName)) {
      return { ok: false, code: "METHOD_NOT_ALLOWED", message: `Method ${fc.methodName} is not on the relayer allowlist.` };
    }
    if (BigInt(fc.deposit) !== 0n) return { ok: false, code: "DEPOSIT_NOT_ALLOWED", message: "Relayed calls must attach 0 deposit." };
    totalGas += BigInt(fc.gas);
    methods.push(fc.methodName);
  }
  if (totalGas > BigInt(opts.maxGasTgas) * 1_000_000_000_000n) {
    return { ok: false, code: "GAS_TOO_HIGH", message: `Relayed calls are capped at ${opts.maxGasTgas} Tgas.` };
  }
  return { ok: true, methods };
}

type BytesLike = ArrayLike<number>;

/** The delegate's ed25519 public key as "ed25519:<base58>", or null for any other key type. */
export function delegatePublicKey(sd: PlainDelegate): string | null {
  const data = (sd.delegateAction.publicKey as { ed25519Key?: { data?: BytesLike } } | null)?.ed25519Key?.data;
  return data && data.length === 32 ? "ed25519:" + bs58.encode(Uint8Array.from(data)) : null;
}

/** NEP-366 hash: sha256(borsh(u32 2^30 + 366) ‖ borsh(DelegateAction)), via near-api-js' own encoder. */
export function delegateHash(sd: PlainDelegate): Uint8Array {
  return sha256(encodeDelegateAction(sd.delegateAction as unknown as Parameters<typeof encodeDelegateAction>[0]));
}

/** ed25519 signature check of a SignedDelegate (no I/O). */
export function verifyDelegateSignature(sd: PlainDelegate): boolean {
  const pk = sd.delegateAction.publicKey as { ed25519Key?: { data?: BytesLike } } | null;
  const sig = (sd.signature as { ed25519Signature?: { data?: BytesLike } } | null)?.ed25519Signature?.data;
  if (!pk?.ed25519Key?.data || pk.ed25519Key.data.length !== 32 || !sig || sig.length !== 64) return false;
  try {
    return ed25519.verify(Uint8Array.from(sig), delegateHash(sd), Uint8Array.from(pk.ed25519Key.data));
  } catch {
    return false;
  }
}

export type ChainReader = {
  accessKey: (accountId: string, publicKey: string) => Promise<AccessKeyView | null>;
  blockHeight: () => Promise<bigint>;
  estate: (estateId: string) => Promise<Pick<EstateView, "surveyor_id"> & { params: Pick<EstateView["params"], "playground"> }>;
};

const estateCache = new Map<string, { at: number; v: EstateView }>();
const ESTATE_TTL_MS = 30_000;

export const chainReader: ChainReader = {
  accessKey: (a, pk) => viewAccessKey(a, pk),
  blockHeight: async () => BigInt((await rpc<{ header: { height: number } }>("block", { finality: "final" })).header.height),
  estate: async (id) => {
    const hit = estateCache.get(id);
    if (hit && Date.now() - hit.at < ESTATE_TTL_MS) return hit.v;
    const v = await viewUncached<EstateView>(id, "get_estate");
    estateCache.set(id, { at: Date.now(), v });
    return v;
  },
};

/**
 * Everything that can be checked before the relayer spends gas (SPEC §9.4): the signature, that the key is on the
 * sender (and, for a function-call key, scoped to this estate and these methods), that the nonce is fresh and the
 * delegate hasn't expired, and that the sender is the estate's surveyor (any account on a playground estate).
 * Throws only when NEAR can't be reached.
 */
export async function verifyDelegate(sd: PlainDelegate, methods: string[], chain: ChainReader = chainReader): Promise<DelegateCheck> {
  const da = sd.delegateAction;
  const pk = delegatePublicKey(sd);
  if (!pk || !verifyDelegateSignature(sd)) return { ok: false, code: "BAD_SIGNATURE", message: "The delegate action's signature doesn't verify." };
  const [key, height, est] = await Promise.all([chain.accessKey(da.senderId, pk), chain.blockHeight(), chain.estate(da.receiverId)]);
  if (!key) return { ok: false, code: "KEY_NOT_ON_ACCOUNT", message: `That key isn't on ${da.senderId}.` };
  if (key.permission !== "FullAccess") {
    const fc = key.permission.FunctionCall;
    if (fc.receiver_id !== da.receiverId || (fc.method_names.length > 0 && !methods.every((m) => fc.method_names.includes(m)))) {
      return { ok: false, code: "KEY_NOT_ALLOWED", message: "That key can't call these methods on this estate." };
    }
  }
  if (BigInt(da.nonce) <= BigInt(key.nonce)) return { ok: false, code: "NONCE_USED", message: "This signed action was already used. Sign again." };
  if (BigInt(da.maxBlockHeight) <= height) return { ok: false, code: "SIGNATURE_EXPIRED", message: "This signed action has expired. Sign again." };
  if (!est.params.playground && est.surveyor_id !== da.senderId) {
    return { ok: false, code: "E_NOT_SURVEYOR", message: "The relayer only pays for the estate's surveyor." };
  }
  return { ok: true, methods };
}

export function relayerCredentials(network: string = NETWORK): { accountId: string; key: string } | null {
  if (network === "mainnet") {
    const accountId = serverEnv.mainnetRelayerAccountId();
    const key = serverEnv.mainnetRelayerPrivateKey() ?? serverEnv.relayerPrivateKey();
    return accountId && key ? { accountId, key } : null;
  }
  const accountId = serverEnv.relayerAccountId();
  const key = serverEnv.relayerPrivateKey();
  return accountId && key ? { accountId, key } : null;
}

function relayerAccount(): Account | null {
  const c = relayerCredentials();
  if (!c) return null;
  const provider = new JsonRpcProvider({ url: RPC_URLS[0] });
  return new Account(c.accountId, provider, KeyPairSigner.fromSecretKey(c.key as `ed25519:${string}`));
}

export async function relaySignedDelegate(sd: PlainDelegate): Promise<TxResult> {
  const acct = relayerAccount();
  if (!acct) throw new Error("relayer not configured");
  // The plain borsh object serialises identically to near-api-js' SignedDelegate class.
  const res = await acct.relayMetaTransaction(sd as unknown as Parameters<Account["relayMetaTransaction"]>[0]);
  return parseOutcome(res);
}

/** The relayer itself calls a public, zero-deposit method (e.g. unit.sync_deposits after a 1Click SUCCESS). */
export async function callAsRelayer(spec: TxSpec): Promise<TxResult> {
  const acct = relayerAccount();
  if (!acct) throw new Error("relayer not configured");
  const res = await acct.signAndSendTransaction({
    receiverId: spec.receiverId,
    actions: spec.actions.map((a) => actions.functionCall(a.method, a.args, BigInt(a.gas), 0n)),
    throwOnFailure: false,
  });
  return parseOutcome(res);
}
