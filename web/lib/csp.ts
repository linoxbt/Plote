// Content-Security-Policy and other response headers (next.config.ts). Plain module, no path aliases: next.config
// imports it at build time.
//
// script-src keeps 'unsafe-inline' and 'unsafe-eval' on purpose:
//  - Next's App Router streams inline bootstrap scripts on every page; a per-request nonce would make every page
//    dynamic (no static HTML), and the layout has one more inline script (motion boot).
//  - near-connect runs each wallet's executor inside a sandboxed `srcdoc` iframe, and srcdoc iframes inherit this
//    page's CSP. The executors (HOT, Meteor, MyNearWallet, WalletConnect, …) use `Function(…)` and WebAssembly.
// So the CSP's value here is framing (clickjacking), object/base/form restrictions and the connect-src allowlist,
// not blocking injected script.

export type CspEnv = {
  rpcUrls: (string | undefined)[];
  supabaseUrl?: string;
  fxUrl?: string;
  dev?: boolean;
};

/** Hosts the wallet executors and their manifests talk to (from the near-connect manifest, Nov 2026). */
export const WALLET_CONNECT_SRC = [
  // manifests and executor code
  "https://raw.githubusercontent.com",
  "https://cdn.jsdelivr.net",
  "https://wallet.intear.tech",
  "https://near-mobile-production.aws.peersyst.tech",
  "https://trezu.app",
  "https://evm-on-near.dev",
  // what the executors call
  "https://*.near.org",
  "https://*.fastnear.com",
  "https://*.herewallet.app",
  "wss://*.herewallet.app",
  "https://*.hot-labs.org",
  "wss://*.hot-labs.org",
  "https://h4n.app",
  "https://*.meteorwallet.app",
  "wss://*.meteorwallet.app",
  "https://*.meteorwallet.workers.dev",
  "https://*.mynearwallet.com",
  "https://*.aurora.dev",
  "https://*.intear.tech",
  "wss://*.intear.tech",
  "https://api.trezu.app",
  "https://*.walletconnect.com",
  "https://*.walletconnect.org",
  "wss://*.walletconnect.com",
  "wss://*.walletconnect.org",
];

function origin(u: string | undefined): string | null {
  if (!u) return null;
  try {
    return new URL(u.trim()).origin;
  } catch {
    return null;
  }
}

export function contentSecurityPolicy(env: CspEnv): string {
  const supabase = origin(env.supabaseUrl);
  const connect = new Set<string>([
    "'self'",
    ...env.rpcUrls.map(origin).filter((x): x is string => !!x),
    // testnet + mainnet defaults (lib/config.ts), so a network switch never needs a header change
    "https://test.rpc.fastnear.com",
    "https://rpc.testnet.near.org",
    "https://rpc.mainnet.fastnear.com",
    "https://rpc.mainnet.near.org",
    origin(env.fxUrl) ?? "https://open.er-api.com",
    "https://cloud-api.near.ai",
    ...(supabase ? [supabase, supabase.replace(/^https:/, "wss:")] : []),
    ...WALLET_CONNECT_SRC,
    ...(env.dev ? ["ws://localhost:*", "ws://127.0.0.1:*"] : []),
  ]);
  const directives: [string, string[]][] = [
    ["default-src", ["'self'"]],
    ["script-src", ["'self'", "'unsafe-inline'", "'unsafe-eval'", "'wasm-unsafe-eval'", "https://cdn.jsdelivr.net"]],
    ["style-src", ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://fonts.cdnfonts.com", "https://rsms.me"]],
    ["font-src", ["'self'", "data:", "https://fonts.gstatic.com", "https://fonts.cdnfonts.com", "https://rsms.me"]],
    ["img-src", ["'self'", "data:", "blob:", "https:"]],
    ["media-src", ["'self'", "blob:", "mediastream:"]],
    ["connect-src", [...connect]],
    ["worker-src", ["'self'", "blob:"]],
    // wallet deep links open through hidden iframes (hotwallet://, intent://, …); Google satellite embeds
    // (components/satellite-map.tsx) are listed explicitly so they keep working if `https:` is ever narrowed.
    ["frame-src", ["'self'", "https:", "https://www.google.com", "https://maps.google.com", "https://*.google.com", "https://*.gstatic.com", "hotwallet:", "intent:", "meteorwallet:", "intear:", "near-mobile-wallet:"]],
    ["manifest-src", ["'self'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
    ["report-uri", ["/api/csp-report"]],
  ];
  return directives.map(([k, v]) => `${k} ${v.join(" ")}`).join("; ");
}

export function securityHeaders(env: CspEnv): { key: string; value: string }[] {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(env) },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(self), geolocation=(self), microphone=()" },
    { key: "Strict-Transport-Security", value: "max-age=63072000" },
  ];
}
