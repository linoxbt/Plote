// NEP-366 relayer: decode a SignedDelegate, check it against the allowlist, wrap it in a transaction
// from the relayer account and send it. Also lets the server call public methods (sync) itself.

import { deserialize } from "borsh";
import { Account, JsonRpcProvider, KeyPairSigner, SCHEMA, actions } from "near-api-js";
import { ESTATES, NETWORK, RPC_URLS } from "../config";
import { parseOutcome, type TxResult, type TxSpec } from "../near";
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

/** Receiver must be a configured estate (or one of its unit accounts, for sync_deposits). */
export function isAllowedReceiver(receiverId: string, estates: string[] = ESTATES): boolean {
  if (estates.includes(receiverId)) return true;
  const dot = receiverId.indexOf(".");
  return dot > 0 && estates.includes(receiverId.slice(dot + 1));
}

export function checkDelegate(
  sd: PlainDelegate,
  opts: { allowedMethods: string[]; maxGasTgas: number; estates?: string[] },
): DelegateCheck {
  const da = sd.delegateAction;
  if (!isAllowedReceiver(da.receiverId, opts.estates)) {
    return { ok: false, code: "RECEIVER_NOT_ALLOWED", message: `The relayer only pays for calls to Plote estates, not ${da.receiverId}.` };
  }
  if (!da.actions.length) return { ok: false, code: "E_BAD_ARGS", message: "No actions." };
  const methods: string[] = [];
  let totalGas = 0n;
  for (const a of da.actions) {
    const fc = a.functionCall as PlainFunctionCall | undefined;
    if (!fc || Object.keys(a).length !== 1) return { ok: false, code: "ACTION_NOT_ALLOWED", message: "Only function calls can be relayed." };
    if (!opts.allowedMethods.includes(fc.methodName)) {
      return { ok: false, code: "METHOD_NOT_ALLOWED", message: `Method ${fc.methodName} is not on the relayer allowlist.` };
    }
    const isUnit = !(opts.estates ?? ESTATES).includes(da.receiverId);
    if (isUnit && fc.methodName !== "sync_deposits") {
      return { ok: false, code: "METHOD_NOT_ALLOWED", message: "Only sync_deposits may be relayed to a unit account." };
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
