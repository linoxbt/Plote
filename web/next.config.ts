import type { NextConfig } from "next";
import { securityHeaders } from "./lib/csp";
import { supabaseImagePattern } from "./lib/images";

const supabaseImages = supabaseImagePattern(process.env.NEXT_PUBLIC_SUPABASE_URL);

// One site, two networks (multi-zone). The mainnet project builds with NEXT_PUBLIC_BASE_PATH=/mainnet; the testnet
// project sets MAINNET_ZONE_ORIGIN (the mainnet project's own URL) and proxies /mainnet/* to it, so the submitted link
// serves both and the header switch moves between them.
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "") || undefined;
const mainnetZone = (process.env.MAINNET_ZONE_ORIGIN ?? "").replace(/\/$/, "") || undefined;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  basePath,
  poweredByHeader: false,
  // Evidence thumbnails are resized by the optimiser, only for this deployment's Supabase public bucket
  // (components/evidence-image.tsx shows any other URL as a plain lazy <img>).
  images: {
    remotePatterns: supabaseImages ? [supabaseImages] : [],
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 86_400,
  },
  serverExternalPackages: ["near-api-js"],
  // The share-card route reads its vendored fonts from disk at request time; make sure they ship with the function.
  outputFileTracingIncludes: { "/api/og/unit": ["./app/api/og/unit/fonts/*.ttf"] },
  async rewrites() {
    if (!mainnetZone) return { beforeFiles: [], afterFiles: [], fallback: [] };
    return {
      beforeFiles: [
        // Mainnet demo payments are quoted and tracked by this zone's 1Click quote/status routes (on a testnet build they
        // accept only the Mainnet Lite unit as recipient), so the quote store's key lives in one project. Token list and
        // deposit submit need no store and stay with the mainnet zone.
        { source: "/mainnet/api/oneclick/:route(quote|status)", destination: "/api/oneclick/:route" },
        { source: "/mainnet", destination: `${mainnetZone}/mainnet` },
        { source: "/mainnet/:path*", destination: `${mainnetZone}/mainnet/:path*` },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
  async redirects() {
    // The mainnet project's own root has nothing (everything lives under its base path).
    return basePath ? [{ source: "/", destination: basePath, basePath: false, permanent: false }] : [];
  },
  async headers() {
    return [
      {
        // The mainnet zone sends its own security headers (its CSP allows mainnet RPC); don't stack this zone's on it.
        source: mainnetZone ? "/((?!mainnet(?:/|$)).*)" : "/(.*)",
        headers: securityHeaders({
          rpcUrls: [process.env.NEXT_PUBLIC_RPC_URL, process.env.NEXT_PUBLIC_RPC_FALLBACK],
          supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
          fxUrl: process.env.NEXT_PUBLIC_FX_URL,
          dev: process.env.NODE_ENV !== "production",
        }),
      },
    ];
  },
};

export default nextConfig;
