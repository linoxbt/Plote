import type { Metadata } from "next";
import { SignClient } from "./sign-client";

export const metadata: Metadata = { title: "Review and sign" };

export default async function SignPage({ params }: { params: Promise<{ estate: string }> }) {
  const { estate } = await params;
  return <SignClient slug={estate} />;
}
