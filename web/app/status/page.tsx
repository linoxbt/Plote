import type { Metadata } from "next";
import { Page, PageHeader } from "@/components/ui";
import { StatusClient } from "./status-client";

export const metadata: Metadata = { title: "Status", description: "Live health of NEAR RPC, the estate contracts, OutLayer, NEAR AI, 1Click and Supabase." };

export default function StatusPage() {
  return (
    <Page narrow>
      <PageHeader eyebrow="SYSTEM STATUS" title="Is everything up?">
        If every service below went down, money would still be safe and every rule would still hold; only convenience would be lost.
      </PageHeader>
      <StatusClient />
    </Page>
  );
}
