import { EmptyState, LinkButton } from "@/components/ui";
import { TESTNET_APP_URL } from "@/lib/config";

/**
 * Shown on the mainnet demo build where a page needs estate contracts. Mainnet Lite deploys none: the escrow runs on
 * testnet, and mainnet only proves the cross-chain payment rail (one real unit account paid through 1Click).
 */
export function TestnetOnlyNotice({ what }: { what: string }) {
  const testnet = (TESTNET_APP_URL ?? "https://plote-vert.vercel.app").replace(/\/$/, "");
  return (
    <EmptyState
      title={`${what} live on testnet`}
      action={
        <div className="mt-2 flex flex-wrap justify-center gap-3">
          <a className="btn btn-primary" href={`${testnet}/estates`}>Open the testnet estates</a>
          <LinkButton href="/pay">Pay the mainnet unit</LinkButton>
        </div>
      }
    >
      This is the mainnet demo. During the hackathon the escrow contracts (releases on proof, refunds, votes) run on NEAR
      testnet. Mainnet shows the cross-chain payment: real USDC sent from another chain into one unit&apos;s own account.
    </EmptyState>
  );
}
