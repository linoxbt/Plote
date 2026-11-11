import type { Metadata } from "next";
import { ArrowDownToLine, Gift, Globe2, Scale, Wallet } from "lucide-react";
import { ChainChips } from "@/components/landing";
import { CtaBand, FeatureCard, GlowPanel, Heading, Hl, Orbit, PageHero, PillLink, Section, Split } from "@/components/site";

export const metadata: Metadata = {
  title: "Pay from anywhere",
  description: "Pay for your unit from a NEAR wallet, or send USDC/USDT from Base, Solana, Ethereum and more — it lands in the unit's own account.",
};

export default function PaymentsPage() {
  return (
    <main id="main">
      <PageHero
        eyebrow="Pay from anywhere"
        title={<>In London, Houston or Toronto? Pay the way you <Hl>already do</Hl>.</>}
        lead="Send USDC or USDT from the chain you use. Plote swaps it and delivers USDC straight into your unit's account. No exchange account in Nigeria, no wire to a stranger."
        actions={
          <>
            <PillLink href="/estates">Choose a unit</PillLink>
            <PillLink href="/pay" variant="ghost">
              Pay from another chain
            </PillLink>
          </>
        }
        art={<Orbit center={<span className="mono text-xs text-accent">USDC</span>} items={["Base", "Solana", "Ethereum", "Arbitrum", "BNB", "Polygon", "NEAR"]} />}
      />

      <Section label="Three ways to pay">
        <Heading eyebrow="Three ways to pay" title={<>Every payment lands in <Hl>the unit</Hl>, never the developer.</>} />
        <div className="mt-12 grid gap-5 lg:grid-cols-3">
          <FeatureCard icon={<Wallet className="h-5 w-5" strokeWidth={1.5} />} title="From a NEAR wallet">
            Reserve and pay in one approval. USDC goes straight to the unit&apos;s account with <span className="mono text-text">ft_transfer_call</span>, and the estate records it at once. Works on testnet and mainnet.
          </FeatureCard>
          <FeatureCard icon={<Globe2 className="h-5 w-5" strokeWidth={1.5} />} title="From any chain">
            Pick your chain and token; NEAR Intents (1Click) quotes the exact amount and gives you a deposit address. Send it from your usual wallet and USDC arrives in the unit. Mainnet only.
          </FeatureCard>
          <FeatureCard icon={<Gift className="h-5 w-5" strokeWidth={1.5} />} title="From family">
            Siblings and parents can chip in toward the roof from the unit&apos;s public page, with their name and a short message on the family wall.
          </FeatureCard>
        </div>
        <div className="mt-10 space-y-3">
          <p className="text-sm text-muted">Chains supported for cross-chain payments</p>
          <ChainChips />
          <p className="text-xs text-muted">Cross-chain payments use NEAR Intents. They can take up to 15 minutes.</p>
        </div>
      </Section>

      <Section label="The balance is the truth" className="!pt-0">
        <GlowPanel tone="sky" className="p-6 sm:p-12">
          <Split
            visual={
              <div className="w-full max-w-sm space-y-3" aria-hidden>
                {[
                  ["Wallet payment", "+ 6,000"],
                  ["1Click delivery from Base", "+ 2,500"],
                  ["Chip-in from Tolu", "+ 300"],
                ].map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between rounded-2xl bg-black/30 px-5 py-4 ring-1 ring-white/10">
                    <span className="text-sm text-text/80">{k}</span>
                    <span className="mono text-sm text-orange">{v}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between rounded-2xl bg-white/[0.06] px-5 py-4 ring-1 ring-white/20">
                  <span className="text-sm">Unit balance</span>
                  <span className="mono text-sm">8,800 USDC</span>
                </div>
              </div>
            }
          >
            <Heading eyebrow="One rule" title={<>The unit&apos;s balance is <Hl>the truth</Hl>.</>} lead="However money arrives, the estate re-reads the unit's USDC balance and credits the difference. Wallet payments to a unit nobody reserved bounce straight back, and stray deposits are never credited to anyone — they can be swept back to whoever reserved the unit." />
          </Split>
        </GlowPanel>
      </Section>

      <Section label="Money out" className="!pt-0">
        <Heading eyebrow="Money out" title={<>Money leaves only by <Hl>the contract&apos;s rules</Hl>.</>} />
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          <FeatureCard icon={<ArrowDownToLine className="h-5 w-5" strokeWidth={1.5} />} title="Releases">
            Each proven stage releases its share to the developer&apos;s payout account — 20%, 30%, 30%, 20% — after the holders&apos; veto window.
          </FeatureCard>
          <FeatureCard icon={<Scale className="h-5 w-5" strokeWidth={1.5} />} title="Refunds">
            After a missed deadline plus grace, the holder pulls back everything not yet released, straight to their own account.
          </FeatureCard>
          <FeatureCard icon={<Gift className="h-5 w-5" strokeWidth={1.5} />} title="Resale">
            A buyer&apos;s USDC pays the seller and the token moves in one transaction; the escrow stays with the unit.
          </FeatureCard>
        </div>
      </Section>

      <CtaBand title={<>Make your first payment <Hl>on testnet</Hl>.</>} lead="Mint test USDC, reserve a Playground unit and pay 10% — the money appears in the unit's own account on NearBlocks." primary={{ href: "/estates/playground", label: "Open the Playground" }} secondary={{ href: "/faucet", label: "Get test USDC" }} />
    </main>
  );
}
