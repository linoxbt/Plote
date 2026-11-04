import { DevEstateClient } from "./dev-estate-client";

export default async function DevEstatePage({ params }: { params: Promise<{ estate: string }> }) {
  const { estate } = await params;
  return <DevEstateClient slug={estate} />;
}
