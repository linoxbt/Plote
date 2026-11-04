import type { Metadata } from "next";
import { PayStatusClient } from "./pay-status-client";

export const metadata: Metadata = { title: "Payment status", robots: { index: false } };

export default async function PayStatusPage({ params }: { params: Promise<{ depositAddress: string }> }) {
  const { depositAddress } = await params;
  return <PayStatusClient depositAddress={decodeURIComponent(depositAddress)} />;
}
