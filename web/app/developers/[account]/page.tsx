import { DeveloperClient } from "./developer-client";

export default async function DeveloperPage({ params }: { params: Promise<{ account: string }> }) {
  const { account } = await params;
  return <DeveloperClient account={decodeURIComponent(account)} />;
}
