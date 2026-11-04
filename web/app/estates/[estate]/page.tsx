import { EstateClient } from "./estate-client";

export default async function EstatePage({ params }: { params: Promise<{ estate: string }> }) {
  const { estate } = await params;
  return <EstateClient slug={estate} />;
}
