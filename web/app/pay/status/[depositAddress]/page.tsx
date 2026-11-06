import type { Metadata } from "next";
import { PayStatusClient } from "./pay-status-client";

export const metadata: Metadata = { title: "Payment status", robots: { index: false } };

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v.slice(0, 64) : undefined);

export default async function PayStatusPage({ params, searchParams }: { params: Promise<{ depositAddress: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { depositAddress } = await params;
  const sp = await searchParams;
  return <PayStatusClient depositAddress={decodeURIComponent(depositAddress)} hint={{ send: one(sp.send), symbol: one(sp.sym), chain: one(sp.chain) }} />;
}
