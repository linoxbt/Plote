import type { Metadata } from "next";
import { ManageClient } from "./manage-client";

export const metadata: Metadata = { title: "Manage my unit", robots: { index: false } };

export default async function ManagePage({ params }: { params: Promise<{ estate: string; unit: string }> }) {
  const { estate, unit } = await params;
  return <ManageClient slug={estate} unitId={decodeURIComponent(unit).toLowerCase()} />;
}
