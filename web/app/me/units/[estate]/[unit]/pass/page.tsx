import type { Metadata } from "next";
import { PassClient } from "./pass-client";

export const metadata: Metadata = { title: "Gate pass", robots: { index: false } };

export default async function PassPage({ params }: { params: Promise<{ estate: string; unit: string }> }) {
  const { estate, unit } = await params;
  return <PassClient slug={estate} unitId={decodeURIComponent(unit).toLowerCase()} />;
}
