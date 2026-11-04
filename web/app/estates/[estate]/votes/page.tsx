import { VotesClient } from "./votes-client";

export default async function VotesPage({ params }: { params: Promise<{ estate: string }> }) {
  const { estate } = await params;
  return <VotesClient slug={estate} />;
}
