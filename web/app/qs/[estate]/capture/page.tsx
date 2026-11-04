import type { Metadata } from "next";
import { CaptureClient } from "./capture-client";

export const metadata: Metadata = { title: "Capture evidence" };

export default async function CapturePage({ params }: { params: Promise<{ estate: string }> }) {
  const { estate } = await params;
  return <CaptureClient slug={estate} />;
}
