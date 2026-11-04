import type { Metadata } from "next";
import { Page, PageHeader } from "@/components/ui";
import { CheckClient } from "./check-client";

export const metadata: Metadata = {
  title: "Is unit X taken?",
  description: "Check any off-plan unit in seconds: owner, amount paid and status, read live from the chain. No login.",
};

export default async function CheckPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const u = typeof sp.u === "string" ? sp.u : "";
  return (
    <Page narrow>
      <PageHeader eyebrow="PUBLIC CHECK · NO LOGIN" title="Is this unit taken?">
        Type a unit name like <span className="mono text-text">a-4b</span>, a full account like{" "}
        <span className="mono text-text">a-4b.harmattan-court.plote.testnet</span>, or paste a Plote link.
      </PageHeader>
      <CheckClient initial={u} />
    </Page>
  );
}
