import type { Metadata } from "next";
import { UnitClient } from "./unit-client";

export async function generateMetadata({ params }: { params: Promise<{ estate: string; unit: string }> }): Promise<Metadata> {
  const { estate, unit } = await params;
  return {
    title: `${unit.toUpperCase()} · ${estate}`,
    openGraph: { images: [{ url: `/api/og/unit?estate=${estate}&unit=${unit}`, width: 1200, height: 630 }] },
  };
}

export default async function UnitPage({ params }: { params: Promise<{ estate: string; unit: string }> }) {
  const { estate, unit } = await params;
  return <UnitClient slug={estate} unitId={decodeURIComponent(unit).toLowerCase()} />;
}
