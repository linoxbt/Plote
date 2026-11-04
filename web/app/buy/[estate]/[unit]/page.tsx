import type { Metadata } from "next";
import { BuyClient } from "./buy-client";

export const metadata: Metadata = { title: "Reserve and pay" };

export default async function BuyPage({ params, searchParams }: { params: Promise<{ estate: string; unit: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { estate, unit } = await params;
  const sp = await searchParams;
  return <BuyClient slug={estate} unitId={decodeURIComponent(unit).toLowerCase()} method={sp.method === "oneclick" ? "oneclick" : "wallet"} />;
}
