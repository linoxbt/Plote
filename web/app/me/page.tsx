import type { Metadata } from "next";
import { Page, PageHeader } from "@/components/ui";
import { MeClient } from "./me-client";

export const metadata: Metadata = { title: "My units" };

export default function MePage() {
  return (
    <Page>
      <PageHeader eyebrow="BUYER" title="My units" />
      <MeClient />
    </Page>
  );
}
