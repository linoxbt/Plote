import type { Metadata } from "next";
import { Page, PageHeader } from "@/components/ui";
import { DevHomeClient } from "./dev-home-client";

export const metadata: Metadata = { title: "Developer console" };

export default function DevPage() {
  return (
    <Page>
      <PageHeader eyebrow="DEVELOPER CONSOLE" title="Your estates">
        Public escrow is a sales tool. Get paid per stage, automatically, the moment it&apos;s proven.
      </PageHeader>
      <DevHomeClient />
    </Page>
  );
}
