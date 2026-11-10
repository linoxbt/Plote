import type { Metadata } from "next";
import type { ReactNode } from "react";
import { DoorOpen, KeyRound, LifeBuoy, ListChecks, Repeat, Vote, Wallet } from "lucide-react";
import { NftShowcase } from "@/components/landing";
import { HouseNFT } from "@/components/house-nft";
import { CtaBand, Faq, FeatureCard, GlowPanel, Heading, Hl, PageHero, PillLink, Section, Split, StatGrid } from "@/components/site";

export const metadata: Metadata = {
  title: "The NFT",
  description: "Plote's allocation NFT is the unit: it holds the escrow, pulls refunds, sells atomically, votes and opens the gate.",
};

const ABILITIES: [ReactNode, string, string, string][] = [
  [<Wallet key="w" className="h-5 w-5" strokeWidth={1.5} />, "Holds the money", "Payments sit in the unit's own NEAR account — not the developer's — until a stage is proven.", "unit account · on_unit_deposit"],
  [<LifeBuoy key="l" className="h-5 w-5" strokeWidth={1.5} />, "Pulls a refund", "After a deadline plus grace with no approved stage, the holder takes back everything not yet released. Nobody has to approve it.", "refund(unit_id) · holder only"],
  [<Repeat key="r" className="h-5 w-5" strokeWidth={1.5} />, "Sells in one step", "List the unit; a buyer's USDC and the token swap in a single transaction. The escrow stays with the unit.", "list_for_sale → ft_transfer_call"],
  [<ListChecks key="c" className="h-5 w-5" strokeWidth={1.5} />, "Protects you if you fall behind", "Miss instalments and the unit is listed for what you paid, minus a fixed 5%. You're paid when it sells — nothing is forfeited.", "declare_default"],
  [<Vote key="v" className="h-5 w-5" strokeWidth={1.5} />, "Gives you a vote", "One vote per unit: replace the surveyor, veto a sign-off, freeze releases or extend a deadline. Units bought after a vote opens can't swing it.", "propose · vote"],
  [<DoorOpen key="d" className="h-5 w-5" strokeWidth={1.5} />, "Opens the gate", "After handover the holder shows a gate pass — a signed message the guard's phone checks against the chain.", "NEP-413 signed message"],
];

export default function NftPage() {
  return (
    <main id="main">
      <PageHero
        eyebrow="NFTs that do something"
        title={<>Your token isn&apos;t a picture. It&apos;s <Hl>the unit</Hl>.</>}
        lead="Every Plote unit has exactly one allocation NFT. Hold it and you hold the unit's money, its refund right, its resale price, its vote and, at handover, its keys."
        actions={
          <>
            <PillLink href="/estates/playground">Get one in the Playground</PillLink>
            <PillLink href="/check" variant="ghost">
              Inspect a unit
            </PillLink>
          </>
        }
        art={<div className="w-full max-w-sm overflow-hidden rounded-3xl ring-1 ring-white/15"><HouseNFT estateName="Harmattan Court" unitLabel="A-4B" unitId="a-4b" approvedCount={2} total={4} status="Allocated" paid="0" price="0" /></div>}
      />

      <Section label="What the token does">
        <Heading eyebrow="Six rights, enforced by the contract" title={<>Everything is checked against <Hl>whoever holds it</Hl>.</>} lead="No admin can grant or take these away. Each one is a rule in the estate contract that looks at the token's current owner." />
        <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {ABILITIES.map(([icon, t, b, call]) => (
            <FeatureCard key={t} icon={icon} title={t}>
              <p>{b}</p>
              <code className="mono mt-4 inline-block rounded-full bg-white/[0.05] px-3 py-1 text-xs text-teal ring-1 ring-white/10">{call}</code>
            </FeatureCard>
          ))}
        </div>
      </Section>

      <Section label="The image" className="!pt-0">
        <GlowPanel tone="slate" className="p-6 sm:p-12">
          <Split visual={<div className="w-full max-w-sm"><NftShowcase /></div>}>
            <Heading eyebrow="Dynamic NFT" title={<>The picture is <Hl>drawn by the contract</Hl>.</>} lead="The token's image isn't a file someone uploaded. The estate contract draws it from the unit's live state every time a wallet asks: each proven stage fills in, and the windows turn gold at handover. Any wallet that shows NFTs shows the build's real progress." />
          </Split>
        </GlowPanel>
      </Section>

      <Section label="Standards" className="!pt-0">
        <Heading eyebrow="Standards" title={<>Built on NEAR&apos;s <Hl>NFT standards</Hl>.</>} />
        <div className="mt-10 rounded-3xl bg-surface px-2 ring-1 ring-white/[0.08] sm:px-4">
          <StatGrid
            items={[
              { value: "NEP-171", label: "Core: ownership and transfers" },
              { value: "NEP-177", label: "Metadata, drawn on-chain" },
              { value: "NEP-178", label: "Approvals, for atomic resale" },
              { value: "NEP-181", label: "Enumeration: list holders and units" },
            ]}
          />
        </div>
        <div className="mt-10 grid gap-5 md:grid-cols-2">
          <FeatureCard icon={<KeyRound className="h-5 w-5" strokeWidth={1.5} />} title="One unit, one token">
            The token ID is the unit ID (for example <span className="mono text-text">a-4b</span>). Minting a second token for the same unit fails with{" "}
            <span className="mono text-text">E_UNIT_TAKEN</span>, so a unit can never be sold twice.
          </FeatureCard>
          <FeatureCard icon={<Repeat className="h-5 w-5" strokeWidth={1.5} />} title="Transfers carry everything">
            Selling or gifting the token moves the escrow, the refund right and the vote with it. Liens, default listings and in-flight payments block a transfer until they clear.
          </FeatureCard>
        </div>
      </Section>

      <Section label="Questions" className="!pt-0">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.6fr]">
          <h2 className="text-[32px] sm:text-[44px]">Token questions</h2>
          <Faq
            items={[
              ["What if I can't keep paying?", "Your unit is listed for what you've paid. When it sells, you get that back minus a fixed 5%."],
              ["Can I sell my unit before it's built?", "Yes. List it from your unit page. A buyer pays in USDC and the token moves to them in the same transaction; you receive the sale price."],
              ["Why one vote per unit and not per account?", "Each unit is one stake. Splitting units across accounts can't add votes, and units bought after a vote opens can't swing it."],
              ["Where does the token show up?", "In any NEAR wallet's NFT tab, and on your Plote page under My units."],
            ]}
          />
        </div>
      </Section>

      <CtaBand title={<>Hold a unit in <Hl>two minutes</Hl>.</>} lead="Get test USDC, reserve a Playground unit, pay 10% and the token mints to you." primary={{ href: "/estates/playground", label: "Open the Playground" }} secondary={{ href: "/faucet", label: "Get test USDC" }} />
    </main>
  );
}
