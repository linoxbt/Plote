import type { MetadataRoute } from "next";
import { APP_URL } from "@/lib/config";

/** Public pages are indexable; wallet-only, surveyor and payment-tracker pages and the API are not. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/me", "/dev", "/qs", "/pay/status/", "/gate/"] }],
    sitemap: `${APP_URL}/sitemap.xml`,
  };
}
