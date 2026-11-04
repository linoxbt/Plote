import type { Metadata } from "next";
import { GateClient } from "./gate-client";

export const metadata: Metadata = { title: "Gate scanner", robots: { index: false } };

export default async function GatePage({ params }: { params: Promise<{ estate: string }> }) {
  const { estate } = await params;
  return <GateClient slug={estate} />;
}
