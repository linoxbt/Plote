import type { NextConfig } from "next";
import { securityHeaders } from "./lib/csp";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: { unoptimized: true },
  serverExternalPackages: ["near-api-js"],
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
