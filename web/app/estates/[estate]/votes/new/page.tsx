import { NewProposalClient } from "./new-client";

export default async function NewProposalPage({ params }: { params: Promise<{ estate: string }> }) {
  const { estate } = await params;
  return <NewProposalClient slug={estate} />;
}
