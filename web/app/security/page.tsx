import type { Metadata } from "next";
import { Ban, Eye, KeyRound, Lock, Server, ShieldCheck, UserX, Vote } from "lucide-react";
import { CtaBand, FeatureCard, GlowPanel, Heading, Hl, PageHero, PillLink, Section, StatGrid, TextLink } from "@/components/site";

export const metadata: Metadata = {
  title: "Security",
  description: "Who can move money on Plote, and how: keyless unit accounts, pinned verification code, scoped keys, holder votes — and Plote's honest limits.",
};

export default function SecurityPage() {
  return (
    <main id="main">
      <PageHero
        eyebrow="Security"
        title={<>Nobody can take your money. <Hl>Not even us.</Hl></>}
        lead="Plote's servers don't hold any key that can move a buyer's money out of a unit. Only the estate contract's public rules can — and every rule is open source and on-chain. Where Plote is still trusted, this page says so."
        actions={
          <>
            <PillLink href="/status">System status</PillLink>
            <PillLink href="https://github.com/linoxbt/Plote" variant="ghost">
              Read the code
            </PillLink>
          </>
        }
        art={
          <div className="relative flex aspect-square w-full max-w-[320px] items-center justify-center" aria-hidden>
            <div className="absolute inset-0 rounded-full ring-1 ring-line" />
            <div className="absolute inset-[14%] rounded-full ring-1 ring-line" />
            <div className="flex h-28 w-28 items-center justify-center rounded-full bg-surface ring-1 ring-line">
              <Lock className="h-10 w-10 text-accent" strokeWidth={1.1} />
            </div>
          </div>
        }
      />

      <Section label="Who can move money">
        <Heading eyebrow="Trust boundaries" title={<>Who can do <Hl>what</Hl>.</>} />
        <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          <FeatureCard icon={<Lock className="h-5 w-5" strokeWidth={1.5} />} title="Unit accounts have no keys">
            Each unit account is created by the estate with no access keys. USDC leaves only through <span className="mono text-text">transfer_out</span>, which the estate alone may call.
          </FeatureCard>
          <FeatureCard icon={<ShieldCheck className="h-5 w-5" strokeWidth={1.5} />} title="Verdicts from attested code only">
            Estates accept verdicts only from the secure-hardware worker they&apos;re pinned to. A verdict from any other path or build is rejected.
          </FeatureCard>
          <FeatureCard icon={<KeyRound className="h-5 w-5" strokeWidth={1.5} />} title="Scoped keys">
            The surveyor&apos;s key can only sign milestones. The developer&apos;s claim key can only claim releases and propose extensions.
          </FeatureCard>
          <FeatureCard icon={<Server className="h-5 w-5" strokeWidth={1.5} />} title="What the relayer is trusted with">
            Plote&apos;s relayer pays network fees for surveyor calls (a fixed list of methods, no deposit, a gas cap). It also reports cross-chain (1Click)
            deposits, which the estate credits only up to the surplus it sees on the unit in two balance reads, and on HTTPS-mode estates it submits photo
            verdicts. It can&apos;t move funds out of a unit, but those two roles are residual trust in Plote.
          </FeatureCard>
          <FeatureCard icon={<Vote className="h-5 w-5" strokeWidth={1.5} />} title="Holders have the last word">
            Votes weighted by each token&apos;s net equity (paid minus refunded, up to the price, never more than when the vote opened) can veto a sign-off, freeze releases, replace the surveyor or
            redirect releases to a replacement contractor. Everything but a veto also needs a majority of distinct holders and a quorum.
          </FeatureCard>
          <FeatureCard icon={<Eye className="h-5 w-5" strokeWidth={1.5} />} title="Everything is public">
            Payments, releases, refunds, proofs and votes are on-chain. Anyone can check any unit without logging in.
          </FeatureCard>
        </div>
      </Section>

      <Section label="Tested" className="!pt-0">
        <GlowPanel tone="sky" className="px-6 py-12 sm:px-12 sm:py-16">
          <Heading title={<>Tested like it holds <Hl>someone&apos;s home</Hl>.</>} lead="The contract's invariants — no double sale, money conserved, releases capped by proven stages, exits only to allowed accounts — are checked by tests, including a randomised 200-step walk." />
          <div className="mt-8">
            <StatGrid
              items={[
                { value: "60", label: "Estate contract tests" },
                { value: "5/5", label: "Integration flows on real WASM" },
                { value: "78", label: "Verifier tests" },
                { value: "91", label: "Web unit + end-to-end tests" },
              ]}
            />
          </div>
        </GlowPanel>
      </Section>

      <Section label="Honest limits" className="!pt-0">
        <Heading eyebrow="Honest limits" tone="red" title={<>What Plote <Hl>doesn&apos;t</Hl> do.</>} />
        <div className="mt-12 grid gap-5 md:grid-cols-2">
          <FeatureCard icon={<Ban className="h-5 w-5" strokeWidth={1.5} />} title="Not your land title">
            Plote proves allocation and payment, not legal ownership. Always check the C of O or governor&apos;s consent with a lawyer.
          </FeatureCard>
          <FeatureCard icon={<UserX className="h-5 w-5" strokeWidth={1.5} />} title="Can't force a developer to join">
            A fraudulent developer simply won&apos;t opt in. Ask your developer why they don&apos;t use public escrow.
          </FeatureCard>
          <FeatureCard icon={<Eye className="h-5 w-5" strokeWidth={1.5} />} title="Photos can be staged">
            Secure hardware proves the checks ran on the committed photo, not that the scene is honest. The challenge code and a replaceable surveyor limit the damage.
          </FeatureCard>
          <FeatureCard icon={<KeyRound className="h-5 w-5" strokeWidth={1.5} />} title="Testnet estates can still be upgraded">
            The testnet estate contracts still have full-access keys, so Plote can upgrade their code (it has, to fix audit findings). Those keys will be
            deleted before any estate holds real money; <TextLink href="/status">the status page</TextLink> shows whether each estate&apos;s keys are gone.
          </FeatureCard>
          <FeatureCard icon={<ShieldCheck className="h-5 w-5" strokeWidth={1.5} />} title="USDC today">
            Plote works in USDC. Naira payments are on the roadmap.
          </FeatureCard>
        </div>
        <div className="mt-8">
          <TextLink href="/verification">How verification works</TextLink>
        </div>
      </Section>

      <CtaBand title={<>Check before you <Hl>trust</Hl>.</>} lead="Look up any unit — holder, payments, releases and proofs — in seconds, without logging in." primary={{ href: "/check", label: "Check a unit" }} secondary={{ href: "/faq", label: "Read the FAQ" }} />
    </main>
  );
}
