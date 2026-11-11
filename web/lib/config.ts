// Public runtime config. Every value has a testnet default so the app builds and renders with no env.
// NEXT_PUBLIC_* must be read with literal `process.env.NEXT_PUBLIC_X` so Next can inline them.

export type Network = "testnet" | "mainnet";

export const NETWORK: Network = process.env.NEXT_PUBLIC_NETWORK === "mainnet" ? "mainnet" : "testnet";
export const IS_MAINNET = NETWORK === "mainnet";
export const IS_TESTNET = !IS_MAINNET;

const DEFAULTS = {
  testnet: {
    rpc: "https://test.rpc.fastnear.com",
    rpcFallback: "https://rpc.testnet.near.org",
    estates: "harmattan-court.plote.testnet,baobab-heights.plote.testnet,playground.plote.testnet",
    usdc: "musdc.plote.testnet",
    explorer: "https://testnet.nearblocks.io",
    root: "plote.testnet",
  },
  mainnet: {
    rpc: "https://rpc.mainnet.fastnear.com",
    rpcFallback: "https://rpc.mainnet.near.org",
    estates: "",
    usdc: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
    explorer: "https://nearblocks.io",
    root: "",
  },
} as const;

const d = DEFAULTS[NETWORK];

function clean(v: string | undefined): string | undefined {
  const t = v?.trim();
  return t ? t : undefined;
}

export const RPC_URL = clean(process.env.NEXT_PUBLIC_RPC_URL) ?? d.rpc;
export const RPC_FALLBACK = clean(process.env.NEXT_PUBLIC_RPC_FALLBACK) ?? d.rpcFallback;
export const RPC_URLS = Array.from(new Set([RPC_URL, RPC_FALLBACK]));

export const ESTATES: string[] = (clean(process.env.NEXT_PUBLIC_ESTATES) ?? d.estates)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export const USDC_ID = clean(process.env.NEXT_PUBLIC_USDC_ID) ?? d.usdc;
export const EXPLORER = (clean(process.env.NEXT_PUBLIC_EXPLORER) ?? d.explorer).replace(/\/$/, "");
export const APP_URL = (clean(process.env.NEXT_PUBLIC_APP_URL) ?? "http://localhost:3000").replace(/\/$/, "");
export const SUPABASE_URL = clean(process.env.NEXT_PUBLIC_SUPABASE_URL);
export const SUPABASE_ANON_KEY = clean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
/** Parent account of estates that aren't listed in NEXT_PUBLIC_ESTATES (e.g. `plote.testnet`). */
export const ROOT_ACCOUNT = clean(process.env.NEXT_PUBLIC_ROOT_ACCOUNT) ?? d.root;
/** Optional public link to the repo, used in footer/landing. */
export const GITHUB_URL = clean(process.env.NEXT_PUBLIC_GITHUB_URL) ?? "https://github.com/";
/** The mainnet-demo build URL (footer network switch). */
export const MAINNET_APP_URL = clean(process.env.NEXT_PUBLIC_MAINNET_APP_URL);
export const TESTNET_APP_URL = clean(process.env.NEXT_PUBLIC_TESTNET_APP_URL);

/**
 * Mainnet Lite (SPEC §17.4): the one mainnet unit account that takes a real 1Click payment, e.g.
 * `a-4b.harmattan-court.plote.<you>.near`. Public (it's an account id), shown on /pay. Must match the server's
 * MAINNET_UNIT_ACCOUNT, which the quote route accepts as a recipient.
 */
export const MAINNET_UNIT_ACCOUNT = clean(process.env.NEXT_PUBLIC_MAINNET_UNIT_ACCOUNT);

/** Path B (1Click) only runs on the mainnet build: NEAR Intents has no testnet. */
export const ONECLICK_ENABLED = IS_MAINNET;
export const ONECLICK_EXPLORER = "https://explorer.near-intents.org";

/** Mainnet USDC asset id used to force 1Click's destination. */
export const MAINNET_USDC_ASSET = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

export const SUPABASE_BUCKET = "evidence";

/** Supabase table names (SPEC §14.2). The lead owns the migrations. */
export const TABLES = {
  evidenceFiles: "evidence_files",
  events: "events",
  oneclickQuotes: "oneclick_quotes",
  chipins: "chipins",
  notifySubscriptions: "notify_subscriptions",
  gateNonces: "gate_nonces",
} as const;

export const FX_URL = clean(process.env.NEXT_PUBLIC_FX_URL) ?? "https://open.er-api.com/v6/latest/USD";

export const NEAR_AI_URL = "https://cloud-api.near.ai/v1";
