import { ReleasesClient } from "./releases-client";

export default async function ReleasesPage({ params }: { params: Promise<{ estate: string }> }) {
  const { estate } = await params;
  return <ReleasesClient slug={estate} />;
}
