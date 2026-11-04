import { TimelapseClient } from "./timelapse-client";

export default async function TimelapsePage({ params }: { params: Promise<{ estate: string; unit: string }> }) {
  const { estate, unit } = await params;
  return <TimelapseClient slug={estate} unitId={decodeURIComponent(unit).toLowerCase()} />;
}
