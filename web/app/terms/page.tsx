import type { Metadata } from "next";
import Link from "next/link";
import { Page, PageHeader } from "@/components/ui";
import { IS_MAINNET } from "@/lib/config";

export const metadata: Metadata = { title: "Terms", description: "The terms for using Plote: what it is, what it isn't, and who is responsible for what." };

const UPDATED = "10 November 2026";

export default function TermsPage() {
  return (
    <Page narrow>
      <PageHeader eyebrow="Legal" title="Terms of use">
        Last updated {UPDATED}. Plain language on purpose. If anything here is unclear, ask before you pay for a unit.
      </PageHeader>
      <article className="space-y-8 text-base leading-[1.6] text-text-2/90 [&_h2]:mb-3 [&_h2]:text-2xl [&_h2]:text-text">
        <section>
          <h2>1. What Plote is</h2>
          <p>
            Plote is open-source software: a web app and a set of smart contracts on the NEAR blockchain. An estate contract gives each off-plan unit its own
            on-chain account, holds payments there, and releases them to the developer only when the contract&apos;s published rules are met. Plote&apos;s
            operators run the website, a relayer (it pays gas for surveyor calls, reports cross-chain deposits to the estate and, on HTTPS-mode estates, relays photo verdicts) and a database of photo uploads. They do not hold buyers&apos; money and cannot move it out of a unit. On testnet they can still upgrade the estate contracts.
          </p>
        </section>
        <section>
          <h2>2. {IS_MAINNET ? "Mainnet demo" : "This is a testnet demo"}</h2>
          <p>
            {IS_MAINNET
              ? "The mainnet build demonstrates cross-chain payment. The escrow logic it demonstrates runs on testnet. Don't send amounts you can't afford to lose."
              : "This deployment runs on NEAR testnet with test USDC that has no value. Estates such as Harmattan Court, Baobab Heights and the Playground are fictional. Nothing here is an offer to sell real property."}
          </p>
        </section>
        <section>
          <h2>3. What Plote is not</h2>
          <ul className="list-disc space-y-2 pl-5">
            <li>Not a land title, deed, Certificate of Occupancy or governor&apos;s consent. Holding a unit&apos;s token proves allocation and payment, not legal ownership. Check title with a lawyer.</li>
            <li>Not a bank, escrow agent, broker or adviser. Nothing on this site is financial, legal or investment advice.</li>
            <li>Not a guarantee that a building will be finished. Plote limits what a developer can receive before work is proven; it can&apos;t force anyone to build.</li>
          </ul>
        </section>
        <section>
          <h2>4. Who is responsible for what</h2>
          <ul className="list-disc space-y-2 pl-5">
            <li><strong>Developers</strong> are responsible for their estates, prices, deadlines, construction and legal compliance in their jurisdiction.</li>
            <li><strong>Surveyors</strong> are responsible for inspecting in person before they sign a milestone. A photo check proves the checks ran on the photo; it can&apos;t prove the scene is honest.</li>
            <li><strong>Buyers</strong> are responsible for their wallets and keys, for checking a unit before paying, and for their own due diligence on the developer and the land.</li>
          </ul>
        </section>
        <section>
          <h2>5. The contracts decide</h2>
          <p>
            Payments, releases, refunds, resales, votes and penalties follow the estate contract&apos;s code exactly. Where this page and the contract disagree,
            the contract is what runs. The code is public on{" "}
            <a className="underline underline-offset-4" href="https://github.com/linoxbt/Plote" target="_blank" rel="noreferrer">GitHub</a>, and{" "}
            <Link className="underline underline-offset-4" href="/security">Security</Link> explains who can move money and how.
          </p>
        </section>
        <section>
          <h2>6. Risks</h2>
          <p>
            Smart contracts, the NEAR network, NEAR Intents, OutLayer, NEAR AI and wallets can all fail or have bugs. Transactions on a blockchain are final.
            The contracts haven&apos;t had an independent security audit yet. Use them at your own risk.
          </p>
        </section>
        <section>
          <h2>7. Acceptable use</h2>
          <p>Don&apos;t upload photos you don&apos;t have the right to share, photos of people who haven&apos;t agreed to it, or anything unlawful. Don&apos;t try to abuse the relayer or the APIs; they&apos;re rate limited and logged.</p>
        </section>
        <section>
          <h2>8. Licence and liability</h2>
          <p>
            The software is MIT licensed and provided &ldquo;as is&rdquo;, without warranty of any kind. To the extent the law allows, Plote&apos;s contributors aren&apos;t
            liable for losses from using it. See also the <Link className="underline underline-offset-4" href="/privacy">Privacy notice</Link>.
          </p>
        </section>
      </article>
    </Page>
  );
}
