import type { Metadata } from "next";
import { BadgeCheck, Building2, Coins, Gauge, Globe2, LineChart } from "lucide-react";
import { CtaBand, FeatureCard, GlowPanel, Heading, Hl, PageHero, PillLink, Section, StatGrid, StepCard } from "@/components/site";

export const metadata: Metadata = {
  title: "For developers",
  description: "Public escrow is a sales tool. Get paid per stage, automatically, the moment it's proven — and let diaspora buyers pay you from any chain.",
};

export default function BuildersPage() {
  return (
    <main id="main">
      <PageHero
        eyebrow="For developers"
        title={<>Honest developers finally have a way to <Hl>prove it</Hl>.</>}
        lead="Put your estate on Plote and every buyer can check, in seconds, that their money is safe and your building is real. You get paid per stage, automatically, the moment it's proven."
        actions={
          <>
            <PillLink href="/dev/estates/new">Put your estate on Plote</PillLink>
            <PillLink href="/dev" variant="ghost">
              Developer console
            </PillLink>
          </>
        }
        art={
          <div className="glass w-full max-w-sm space-y-4 rounded-3xl p-6" aria-hidden>
            <p className="text-sm text-muted">Release schedule</p>
            {[
              ["Foundation", "20%", true],
              ["Roofing", "30%", true],
              ["Finishing", "30%", false],
              ["Handover", "20%", false],
            ].map(([k, v, done]) => (
              <div key={k as string} className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>{k as string}</span>
                  <span className="mono text-muted">{v as string}</span>
                </div>
                <div className="h-1.5 rounded-full bg-white/10">
                  <div className={`h-1.5 rounded-full ${done ? "bg-teal" : "bg-white/0"}`} style={{ width: done ? "100%" : "0%" }} />
                </div>
              </div>
            ))}
          </div>
        }
      />

      <Section label="Why list on Plote">
        <Heading eyebrow="Why list on Plote" title={<>Turn trust into <Hl>sales</Hl>.</>} />
        <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          <FeatureCard icon={<BadgeCheck className="h-5 w-5" strokeWidth={1.5} />} title="Public escrow sells">
            Buyers can check you in seconds — escrow, stages, proofs. &ldquo;Our escrow is public&rdquo; is a line no competitor can match.
          </FeatureCard>
          <FeatureCard icon={<Coins className="h-5 w-5" strokeWidth={1.5} />} title="Paid per stage">
            Each verified stage releases its share to your payout account. Claim up to six units per transaction.
          </FeatureCard>
          <FeatureCard icon={<LineChart className="h-5 w-5" strokeWidth={1.5} />} title="A public track record">
            Your on-time record becomes a score anyone can see, computed from on-chain history and linked to each source.
          </FeatureCard>
          <FeatureCard icon={<Globe2 className="h-5 w-5" strokeWidth={1.5} />} title="Diaspora buyers">
            Buyers in the UK, US and Canada pay in USDC from the chain they already use.
          </FeatureCard>
        </div>
      </Section>

      <Section label="Getting started" className="!pt-0">
        <Heading eyebrow="Getting started" title={<>From blueprint to <Hl>live estate</Hl>.</>} />
        <ol className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          <StepCard n={1} title="Describe the estate">
            Name, location and the geofence the photos must fall inside — pick it on the map.
          </StepCard>
          <StepCard n={2} title="Set four milestones">
            Foundation, roofing, finishing, handover: their shares and deadlines. An optional mobilisation tranche (up to 10%) releases at allocation.
          </StepCard>
          <StepCard n={3} title="Add your units">
            Each unit becomes its own NEAR account, created by the estate with no keys.
          </StepCard>
          <StepCard n={4} title="Appoint a surveyor">
            A quantity surveyor signs milestones with a key that can&apos;t move money. Holders can vote to replace them.
          </StepCard>
        </ol>
      </Section>

      <Section label="Cash flow" className="!pt-0">
        <GlowPanel tone="gold" className="px-6 py-12 sm:px-12 sm:py-16">
          <Heading title={<>Built for real <Hl>cash flow</Hl>.</>} lead="Developers need money to start building. An estate can release a fixed mobilisation share when a unit is allocated; everything else waits for a proven stage." />
          <div className="mt-8">
            <StatGrid
              items={[
                { value: "≤ 10%", label: "Mobilisation at allocation" },
                { value: "4", label: "Proven stages, paid in turn" },
                { value: "5%", label: "Fixed default penalty, to you" },
                { value: "≤ 6", label: "Units per claim transaction" },
              ]}
            />
          </div>
        </GlowPanel>
      </Section>

      <Section label="Tools" className="!pt-0">
        <div className="grid gap-5 md:grid-cols-2">
          <FeatureCard icon={<Building2 className="h-5 w-5" strokeWidth={1.5} />} title="Developer console" href="/dev" cta="Open the console">
            Create estates, add units in batches, see every payment and claim releases — with a one-time claim key so claims don&apos;t need a wallet popup each time.
          </FeatureCard>
          <FeatureCard icon={<Gauge className="h-5 w-5" strokeWidth={1.5} />} title="Read the contract" href="https://github.com/linoxbt/Plote" cta="View on GitHub">
            Every rule that touches money is in the open-source estate contract. Your buyers can read it too.
          </FeatureCard>
        </div>
      </Section>

      <CtaBand title={<>Ready to show buyers <Hl>everything</Hl>?</>} lead="Set up a demo estate on testnet in minutes." primary={{ href: "/dev/estates/new", label: "Put your estate on Plote" }} secondary={{ href: "/estates/harmattan-court", label: "See a live estate" }} />
    </main>
  );
}
