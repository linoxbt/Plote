import type { NextConfig } from "next";
import { securityHeaders } from "./lib/csp";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: { unoptimized: true },
  serverExternalPackages: ["near-api-js"],
  // The share-card route reads its vendored fonts from disk at request time; make sure they ship with the function.
  outputFileTracingIncludes: { "/api/og/unit": ["./app/api/og/unit/fonts/*.ttf"] },
  async headers() {
    return [
      {
        source: "/(.*)",
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
