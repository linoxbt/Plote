// 1Click (NEAR Intents) — Path B, mainnet only (SPEC §7.3).
// The browser only talks to our /api/oneclick/* proxies; the JWT stays server-side.

import { ONECLICK_EXPLORER } from "./config";

export type OneClickToken = {
  assetId: string;
  decimals: number;
  blockchain: string;
  symbol: string;
  price?: number;
  priceUpdatedAt?: string;
  contractAddress?: string;
};

export type QuoteInput = {
  dry: boolean;
  originAsset: string;
  amount: string; // USDC base units the unit must receive (EXACT_OUTPUT)
  refundTo: string;
  recipient: string; // unit account
  estate?: string;
  unit?: string;
  chipName?: string;
  chipNote?: string;
};

export type Quote = {
  depositAddress?: string;
  depositMemo?: string;
  amountIn: string;
  amountInFormatted: string;
  amountInUsd?: string;
  minAmountIn?: string;
  amountOut: string;
  amountOutFormatted: string;
  amountOutUsd?: string;
  minAmountOut?: string;
  deadline?: string;
  timeWhenInactive?: string;
  timeEstimate?: number;
};

export type QuoteResponse = { timestamp?: string; signature?: string; quoteRequest?: Record<string, unknown>; quote: Quote };

export type OneClickStatus =
  | "PENDING_DEPOSIT" | "KNOWN_DEPOSIT_TX" | "INCOMPLETE_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED";

export type StatusResponse = {
  status: OneClickStatus;
  updatedAt?: string;
  quoteResponse?: QuoteResponse;
  swapDetails?: {
    amountIn?: string; amountInFormatted?: string; amountOut?: string; amountOutFormatted?: string;
    refundedAmount?: string; refundedAmountFormatted?: string;
    nearTxHashes?: string[];
    originChainTxHashes?: { hash: string; explorerUrl?: string }[];
    destinationChainTxHashes?: { hash: string; explorerUrl?: string }[];
  };
  synced?: boolean;
};

export const STABLE_SYMBOLS = ["USDC", "USDT"];
export const PICKER_CHAINS = ["base", "arb", "eth", "sol", "bsc", "pol", "near"];
export const CHAIN_NAMES: Record<string, string> = {
  base: "Base", arb: "Arbitrum", eth: "Ethereum", sol: "Solana", bsc: "BNB", pol: "Polygon", near: "NEAR",
  op: "Optimism", avax: "Avalanche", ton: "TON", tron: "Tron", gnosis: "Gnosis",
};

export function chainName(b: string): string {
  return CHAIN_NAMES[b] ?? b.charAt(0).toUpperCase() + b.slice(1);
}

/** Tracker steps on /pay/status: Waiting for deposit → Deposit seen → Swapping → Delivered to unit. */
export function statusStep(s: OneClickStatus | undefined): number {
  switch (s) {
    case "KNOWN_DEPOSIT_TX":
    case "INCOMPLETE_DEPOSIT":
      return 1;
    case "PROCESSING":
      return 2;
    case "SUCCESS":
      return 3;
    default:
      return 0;
  }
}

export function explorerUrl(depositAddress: string): string {
  return `${ONECLICK_EXPLORER}/?depositAddress=${encodeURIComponent(depositAddress)}`;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const j = (await res.json().catch(() => ({}))) as T & { code?: string; message?: string };
  if (!res.ok) throw Object.assign(new Error(j.message ?? `HTTP ${res.status}`), { code: j.code ?? "UNKNOWN" });
  return j;
}

export const oneclick = {
  tokens: () => api<{ tokens: OneClickToken[] }>("/api/oneclick/tokens").then((r) => r.tokens),
  quote: (q: QuoteInput) => api<QuoteResponse>("/api/oneclick/quote", { method: "POST", body: JSON.stringify(q) }),
  submit: (depositAddress: string, txHash: string) =>
    api<{ ok: boolean }>("/api/oneclick/submit", { method: "POST", body: JSON.stringify({ depositAddress, txHash }) }),
  status: (depositAddress: string) => api<StatusResponse>(`/api/oneclick/status?depositAddress=${encodeURIComponent(depositAddress)}`),
};
