import type { Metadata } from "next";
import { Page, PageHeader } from "@/components/ui";
import { QsHomeClient } from "./qs-home-client";

export const metadata: Metadata = { title: "Surveyor", manifest: "/manifest.webmanifest" };

export default function QsPage() {
  return (
    <Page narrow>
      <PageHeader eyebrow="SURVEYOR APP" title="Your sign-off, on the record.">
        Snap the site photo on your phone. Plote checks it and you sign. Your key can only sign milestones — it can&apos;t move money.
      </PageHeader>
      <QsHomeClient />
    </Page>
  );
}
