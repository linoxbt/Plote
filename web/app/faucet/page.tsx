import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { IS_MAINNET } from "@/lib/config";
import { Page, PageHeader } from "@/components/ui";
import { FaucetClient } from "./faucet-client";

export const metadata: Metadata = { title: "Test USDC faucet" };

export default function FaucetPage() {
  if (IS_MAINNET) notFound();
  return (
    <Page narrow>
      <PageHeader eyebrow="TESTNET ONLY" title="Get test USDC">
        Plote&apos;s mock USDC on testnet has an open mint so you can buy a unit in two clicks. It has no value.
      </PageHeader>
      <FaucetClient />
    </Page>
  );
}
