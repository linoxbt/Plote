import type { Metadata } from "next";
import { Page, PageHeader } from "@/components/ui";
import { MarketClient } from "./market-client";

export const metadata: Metadata = { title: "Resale market", description: "Units listed for resale on Plote: pay, get the token and the escrow in one transaction." };

export default function MarketPage() {
  return (
    <Page>
      <PageHeader eyebrow="RESALE · ONE TRANSACTION" title="Units for sale">
        A buyer pays, the seller is paid and the allocation token moves in a single transaction. The escrow never leaves the unit&apos;s account.
      </PageHeader>
      <MarketClient />
    </Page>
  );
}
