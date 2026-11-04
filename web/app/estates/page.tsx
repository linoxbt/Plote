import type { Metadata } from "next";
import { Page, PageHeader } from "@/components/ui";
import { EstatesClient } from "./estates-client";

export const metadata: Metadata = { title: "Estates", description: "Every estate on Plote, with live escrow totals and milestone progress." };

export default function EstatesPage() {
  return (
    <Page>
      <PageHeader eyebrow="DIRECTORY" title="Estates on Plote">
        Each estate is a NEAR contract; each unit inside it is its own account. Numbers below are read live from the chain.
      </PageHeader>
      <EstatesClient />
    </Page>
  );
}
