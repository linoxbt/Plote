import type { MetadataRoute } from "next";
import { APP_URL, ESTATES, IS_MAINNET } from "@/lib/config";
import { estateSlug } from "@/lib/estates";

const PAGES = [
  "", "/check", "/estates", "/market", "/how-it-works", "/nft", "/verification", "/payments", "/pay", "/security",
  "/builders", "/surveyors", "/faq", "/status", "/terms", "/privacy",
  ...(IS_MAINNET ? [] : ["/faucet"]),
];

/** Static marketing pages plus each configured estate and its milestones/votes pages (units are linked from those). */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    ...PAGES.map((p) => ({ url: `${APP_URL}${p}`, lastModified: now, changeFrequency: "weekly" as const, priority: p === "" ? 1 : 0.6 })),
    ...ESTATES.flatMap((e) => {
      const s = estateSlug(e);
      return [
        { url: `${APP_URL}/estates/${s}`, lastModified: now, changeFrequency: "daily" as const, priority: 0.8 },
        { url: `${APP_URL}/estates/${s}/milestones`, lastModified: now, changeFrequency: "daily" as const, priority: 0.5 },
        { url: `${APP_URL}/estates/${s}/votes`, lastModified: now, changeFrequency: "daily" as const, priority: 0.4 },
      ];
    }),
  ];
}
