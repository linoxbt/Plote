import { MilestonesClient } from "./milestones-client";

export default async function MilestonesPage({ params }: { params: Promise<{ estate: string }> }) {
  const { estate } = await params;
  return <MilestonesClient slug={estate} />;
}
