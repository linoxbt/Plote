import type { Metadata } from "next";
import { Page, PageHeader } from "@/components/ui";
import { SetupClient } from "./setup-client";

export const metadata: Metadata = { title: "Install phone key" };

export default async function SetupPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  return (
    <Page narrow>
      <PageHeader eyebrow="SURVEYOR · PHONE KEY" title="Install your phone key">
        Your phone should never hold a key that can move NEAR. This key can only call <span className="mono">open_capture</span>, <span className="mono">submit_evidence</span> and <span className="mono">qs_sign</span> on one estate, with a 0.25 NEAR gas allowance. The relayer pays gas.
      </PageHeader>
      <SetupClient account={typeof sp.account === "string" ? sp.account : ""} pk={typeof sp.pk === "string" ? sp.pk : ""} estate={typeof sp.estate === "string" ? sp.estate : ""} />
    </Page>
  );
}
