import type { Metadata } from "next";
import { ProofClient } from "./proof-client";

export async function generateMetadata({ params }: { params: Promise<{ estate: string; evidenceId: string }> }): Promise<Metadata> {
  const { estate, evidenceId } = await params;
  return { title: `Proof #${evidenceId} · ${estate}`, description: "A construction photo checked inside secure hardware, with every check and its source." };
}

export default async function ProofPage({ params }: { params: Promise<{ estate: string; evidenceId: string }> }) {
  const { estate, evidenceId } = await params;
  return <ProofClient slug={estate} id={evidenceId} />;
}
