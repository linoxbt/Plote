import type { Metadata } from "next";
import { APP_URL } from "@/lib/config";
import { WatchClient } from "./watch-client";

type P = { params: Promise<{ estate: string; unit: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { estate, unit } = await params;
  const title = `Watch ${unit.toUpperCase()} at ${estate.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}`;
  const og = `${APP_URL}/api/og/unit?estate=${encodeURIComponent(estate)}&unit=${encodeURIComponent(unit)}`;
  return {
    title,
    description: "Every construction stage of this home, with the photo and proof behind each payment. Live from the chain.",
    openGraph: { title, type: "website", url: `${APP_URL}/w/${estate}/${unit}`, images: [{ url: og, width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title, images: [og] },
  };
}

export default async function WatchPage({ params, searchParams }: P) {
  const { estate, unit } = await params;
  const sp = await searchParams;
  return <WatchClient slug={estate} unitId={decodeURIComponent(unit).toLowerCase()} chip={sp.chip === "1"} />;
}
