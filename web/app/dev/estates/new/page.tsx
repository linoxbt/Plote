import type { Metadata } from "next";
import { Page, PageHeader } from "@/components/ui";
import { RequireWallet } from "@/components/wallet";
import { NewEstateWizard } from "./wizard";

export const metadata: Metadata = { title: "Create an estate" };

export default function NewEstatePage() {
  return (
    <Page narrow>
      <PageHeader eyebrow="DEVELOPER · NEW ESTATE" title="Put your estate on Plote">
        Fill this in to generate the estate config. For the hackathon the estate is deployed with <span className="mono">scripts/deploy-estate.ts</span>; a one-click factory is on the roadmap.
      </PageHeader>
      {/* The developer's account fills the form's developer and payout fields, so the wizard starts once a wallet is connected. */}
      <RequireWallet what="the new-estate wizard">
        <NewEstateWizard />
      </RequireWallet>
    </Page>
  );
}
