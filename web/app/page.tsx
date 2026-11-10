import type { ReactNode } from "react";
import { Building2, Camera, DoorOpen, Eye, KeyRound, LifeBuoy, ListChecks, Repeat, ShieldCheck, Users, Vote, Wallet } from "lucide-react";
import {
  ChainChips, EstateCards, FinalCta, HeroBlock, HeroCheck, LANDING_ESTATE_SLUG, LiveEscrowCard, LiveStrip, NftShowcase, PhoneMockup, SourceLinks,
} from "@/components/landing";
import {
  Container, Dial, Eyebrow, Faq, FeatureCard, GlowPanel, Heading, Hl, Marquee, Orbit, PillLink, Rule, Section, Split, StepCard, TextLink,
} from "@/components/site";
import { STEP_ART } from "@/components/step-art";
import { FAQ } from "@/components/faq-data";

// Landing page. Layout inspired by coredao.org; copy from SPEC §12. Every section leads to its own full page.

const PARTNERS = ["Built on NEAR", "NEAR Intents", "OutLayer · Intel TDX", "NEAR AI Cloud", "NEP-171 allocation NFTs", "NEP-591 global contracts", "Base", "Solana", "Ethereum", "Arbitrum", "Supabase"];

const ABILITIES: [ReactNode, string, string][] = [
  [<Wallet key="w" className="h-5 w-5" strokeWidth={1.5} />, "Holds the money", "Your payments sit in the unit's account until a stage is proven."],
  [<LifeBuoy key="l" className="h-5 w-5" strokeWidth={1.5} />, "Gets you refunds", "If a deadline passes, the token is what lets you pull your money back."],
  [<Repeat key="r" className="h-5 w-5" strokeWidth={1.5} />, "Sells in one step", "List it; a buyer pays, you're paid and the token moves in a single transaction."],
  [<ListChecks key="c" className="h-5 w-5" strokeWidth={1.5} />, "Protects you if you fall behind", "Miss instalments and it's resold for what you paid, minus a fixed 5%. Not forfeited."],
  [<Vote key="v" className="h-5 w-5" strokeWidth={1.5} />, "Gives you a vote", "One per unit: replace the surveyor, veto a sign-off or freeze payments."],
  [<DoorOpen key="d" className="h-5 w-5" strokeWidth={1.5} />, "Opens the gate", "After handover, it's your gate pass and service-charge account."],
];

const STEPS: [string, ReactNode][] = [
  ["Reserve your unit.", <>Each unit has its own address, like <span className="mono text-text">a-4b.harmattan-court</span>. Reserve it and it&apos;s locked for you.</>],
  ["Pay into the unit, not the developer.", "Pay from a NEAR wallet, or send USDC from Base, Solana, Ethereum and more. You get the allocation token — the only one that unit will ever have."],
  ["Every stage is proven.", "The surveyor uploads a site photo. It's checked inside secure hardware: taken on site, this week, never used before, showing the right stage. Then the surveyor signs."],
  ["Money moves only on proof.", "Each verified stage releases its share — 20%, 30%, 30%, 20%. Miss a deadline and you can take back everything not yet released."],
];

export default function Landing() {
  return (
    <main id="main">
      {/* ── Hero ── */}
      <section aria-label="Introduction" className="hero-glow relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute right-[-6%] top-10 hidden w-[44%] max-w-[620px] opacity-60 lg:block">
          <HeroBlock />
        </div>
        <Container className="relative pb-16 pt-16 sm:pb-24 sm:pt-24">
          <div className="max-w-4xl space-y-7">
            <Eyebrow>Off-plan escrow · Built on NEAR</Eyebrow>
            <h1 className="text-[44px] leading-[1.04] sm:text-[76px]">
              Pay for the house <Rule /> you can <Hl>see</Hl>.
            </h1>
            <p className="max-w-2xl text-base text-muted sm:text-lg">
              Plote gives every off-plan unit its own account. Your money waits there and moves to the developer only when a photo of the next stage passes an
              independent check. If the build stalls, you take it back.
            </p>
          </div>
          <div className="mt-12 grid gap-4 lg:grid-cols-3">
            <div className="glass flex flex-col justify-between gap-6 rounded-3xl p-6">
              <p className="text-[15px] text-text/85">Escrow per unit · One owner per unit · Refunds you trigger yourself.</p>
              <div className="flex flex-wrap gap-2">
                <PillLink href="/check">Check a unit →</PillLink>
                <PillLink href={`/estates/${LANDING_ESTATE_SLUG}`} variant="ghost">
                  See a live estate
                </PillLink>
              </div>
            </div>
            <LiveEscrowCard />
            <div className="glass rounded-3xl p-6">
              <p className="mb-3 text-sm text-muted">Is this unit taken? Try it now.</p>
              <HeroCheck />
            </div>
          </div>
        </Container>
      </section>

      <Marquee items={PARTNERS} />

      {/* ── Escrow per unit ── */}
      <Section label="Escrow per unit">
        <Split
          visual={
            <Dial label="a-4b.harmattan-court">
              <div className="flex flex-col items-center gap-2 text-center">
                <KeyRound className="h-8 w-8 text-gold" strokeWidth={1.25} aria-hidden />
                <span className="mono text-xs text-muted">unit account</span>
              </div>
            </Dial>
          }
        >
          <Heading eyebrow="Escrow per unit" title={<>Your deposit, in its <Hl>own account</Hl>.</>} lead="Each unit is a named NEAR account with no keys. It holds the buyer's USDC and obeys only the estate contract's public rules — not the developer, not Plote." />
          <TextLink href="/how-it-works">See how it works</TextLink>
        </Split>
      </Section>

      {/* ── The problem ── */}
      <Section label="The problem" className="!pt-0">
        <GlowPanel tone="slate" className="px-6 py-14 sm:px-14 sm:py-20">
          <Heading align="center" title={<>Off-plan is a promise. Plote makes it a <Hl>receipt</Hl>.</>} />
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {[
              [<Repeat key="a" className="h-5 w-5" strokeWidth={1.5} />, "Sold twice.", "Some developers sell the same unit to more than one buyer. You find out at handover."],
              [<Building2 key="b" className="h-5 w-5" strokeWidth={1.5} />, "Paid upfront, built never.", "Instalments go straight to the developer. When a project stalls, the money's already spent."],
              [<Camera key="c" className="h-5 w-5" strokeWidth={1.5} />, "Photos from far away.", "If you live abroad, you judge progress from WhatsApp pictures that could be from anywhere, or from last year."],
            ].map(([icon, t, b]) => (
              <div key={t as string} className="rounded-3xl bg-black/25 p-6 ring-1 ring-white/10 backdrop-blur">
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-red/10 text-red ring-1 ring-red/25">{icon}</div>
                <h3 className="text-lg">{t as string}</h3>
                <p className="mt-2 text-[15px] text-text/75">{b as string}</p>
              </div>
            ))}
          </div>
          <div className="mt-8 text-center text-xs">
            <SourceLinks />
          </div>
        </GlowPanel>
      </Section>

      {/* ── How it works ── */}
      <Section label="How it works">
        <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <Heading eyebrow="How it works" title={<>Four steps. <Hl>No middleman</Hl> holding your money.</>} />
          <TextLink href="/how-it-works">The full walkthrough</TextLink>
        </div>
        <ol className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(([t, b], i) => {
            const Art = STEP_ART[i];
            return (
              <StepCard key={t} n={i + 1} title={t} art={<Art />}>
                {b}
              </StepCard>
            );
          })}
        </ol>
      </Section>

      {/* ── Proof before payment ── */}
      <Section label="Proof before payment" className="!pt-0">
        <GlowPanel tone="gold" className="grid gap-10 p-6 sm:p-12 lg:grid-cols-2 lg:items-center">
          <div className="flex justify-center">
            <svg viewBox="0 0 240 240" className="w-full max-w-[300px]" aria-hidden>
              <path d="M40 76V40h36M164 40h36v36M200 164v36h-36M76 200H40v-36" stroke="#F4F4F5" strokeWidth="3" fill="none" />
              <path d="M70 160l34-42 26 26 18-18 22 34z" stroke="#F4F4F5" strokeOpacity=".55" strokeWidth="2" fill="none" />
              <circle cx="150" cy="92" r="9" stroke="#F4F4F5" strokeOpacity=".55" strokeWidth="2" fill="none" />
              <rect x="86" y="176" width="68" height="18" rx="4" fill="#0A0A0B" stroke="#E8B04B" />
              <text x="120" y="189" textAnchor="middle" fill="#E8B04B" fontSize="11" fontFamily="var(--font-jet), monospace">K7RQ4M</text>
            </svg>
          </div>
          <div className="space-y-6">
            <Heading eyebrow="Proof before payment" title={<>See exactly <Hl>why</Hl> money moved.</>} lead="Every release needs a site photo with a one-time code written on paper in the frame. It's checked inside an Intel TDX enclave on OutLayer, with stage recognition by NEAR AI Cloud — then a surveyor signs." />
            <ul className="grid gap-2 text-[15px] text-text/85 sm:grid-cols-2">
              {["Taken on site, this week", "Never used before", "Shows the right stage", "Code written in the frame"].map((c) => (
                <li key={c} className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-teal" strokeWidth={1.5} aria-hidden /> {c}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-3">
              <PillLink href="/verification">How verification works</PillLink>
              <PillLink href="/estates/harmattan-court/milestones" variant="ghost">
                See the proofs
              </PillLink>
            </div>
          </div>
        </GlowPanel>
      </Section>

      {/* ── The token ── */}
      <Section label="The token">
        <div className="grid gap-12 lg:grid-cols-[1.25fr_1fr] lg:items-start">
          <div className="space-y-10">
            <Heading eyebrow="NFTs that do something" title={<>Your token isn&apos;t a picture. It&apos;s <Hl>the unit</Hl>.</>} lead="Hold it and you hold the money, the vote and the keys." />
            <div className="grid gap-4 sm:grid-cols-2">
              {ABILITIES.map(([icon, t, b]) => (
                <div key={t} className="flex gap-4 rounded-3xl bg-surface p-5 ring-1 ring-white/[0.08]">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/[0.05] text-gold ring-1 ring-white/10">{icon}</div>
                  <div>
                    <p className="text-[15px] text-text">{t}</p>
                    <p className="mt-1 text-sm text-muted">{b}</p>
                  </div>
                </div>
              ))}
            </div>
            <TextLink href="/nft">Everything the token does</TextLink>
          </div>
          <NftShowcase />
        </div>
      </Section>

      {/* ── Plote in numbers ── */}
      <Section label="Live numbers" className="!pt-0">
        <GlowPanel tone="slate" className="px-6 py-12 sm:px-12 sm:py-16">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <h2 className="text-[32px] sm:text-[48px]">
              Plote in <Hl>numbers</Hl>
            </h2>
            <p className="text-sm text-text/70">No invented stats. Read from the chain.</p>
          </div>
          <div className="mt-8">
            <LiveStrip />
          </div>
        </GlowPanel>
      </Section>

      {/* ── Pay from anywhere ── */}
      <Section label="Payments">
        <Split
          reverse
          visual={<Orbit center={<span className="mono text-xs text-gold">USDC</span>} items={["Base", "Solana", "Ethereum", "Arbitrum", "BNB", "Polygon", "NEAR"]} />}
        >
          <Heading eyebrow="Pay from anywhere" title={<>In London, Houston or Toronto? Pay the way you <Hl>already do</Hl>.</>} lead="Send USDC or USDT from the chain you use. Plote swaps it and delivers USDC straight into your unit's account. No exchange account in Nigeria, no wire to a stranger." />
          <ChainChips />
          <p className="text-xs text-muted">Cross-chain payments use NEAR Intents. They can take up to 15 minutes.</p>
          <TextLink href="/payments">How payments work</TextLink>
        </Split>
      </Section>

      {/* ── For everyone involved ── */}
      <Section label="For everyone involved" className="!pt-0">
        <Heading eyebrow="Built for everyone in the deal" title={<>One record that <Hl>everyone</Hl> can trust.</>} />
        <div className="mt-12 grid items-start gap-5 lg:grid-cols-3">
          <FeatureCard icon={<Building2 className="h-5 w-5" strokeWidth={1.5} />} title="Honest developers finally have a way to prove it." href="/builders" cta="For developers">
            Public escrow is a sales tool — buyers can check you in seconds. Get paid per stage, automatically, the moment it&apos;s proven.
          </FeatureCard>
          <FeatureCard icon={<Eye className="h-5 w-5" strokeWidth={1.5} />} title="Your sign-off, on the record." href="/surveyors" cta="For surveyors">
            Snap the site photo on your phone. Plote checks it and you sign. Your key can only sign milestones — it can&apos;t move money.
          </FeatureCard>
          <div className="flex flex-col gap-5 rounded-3xl bg-surface p-6 ring-1 ring-white/[0.08] sm:p-7">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.05] text-gold ring-1 ring-white/10">
              <Users className="h-5 w-5" strokeWidth={1.5} aria-hidden />
            </div>
            <h3 className="text-xl">Share the build with the whole family.</h3>
            <p className="text-[15px] text-muted">Every unit has a public page with each stage&apos;s photo and proof. Send it to your mum on WhatsApp.</p>
            <div className="-mb-2 scale-[0.82] self-center">
              <PhoneMockup />
            </div>
          </div>
        </div>
      </Section>

      {/* ── Estates ── */}
      <Section label="Estates" className="!pt-0">
        <div className="mb-10 flex items-end justify-between gap-6">
          <h2 className="text-[32px] sm:text-[48px]">
            Live <Hl>estates</Hl>
          </h2>
          <TextLink href="/estates">All estates</TextLink>
        </div>
        <EstateCards />
      </Section>

      {/* ── Check first + limits ── */}
      <Section label="Check a unit" className="!pt-0">
        <GlowPanel tone="gold" className="grid gap-10 p-6 sm:p-12 lg:grid-cols-2">
          <div className="space-y-6">
            <h2 className="text-[32px] sm:text-[44px]">Check a unit before you pay for it.</h2>
            <FinalCta />
          </div>
          <div className="rounded-3xl bg-black/30 p-6 ring-1 ring-white/10 backdrop-blur sm:p-8">
            <p className="mb-4 text-lg">What Plote doesn&apos;t do</p>
            <ul className="space-y-3 text-[15px] text-text/80">
              <li>Plote is not your land title. Always check the C of O or governor&apos;s consent with a lawyer.</li>
              <li>Plote can&apos;t stop a developer who refuses to use it. Ask your developer why they don&apos;t.</li>
              <li>The surveyor is a real person. Plote checks their photos and lets holders replace them, but it doesn&apos;t remove the need for one.</li>
              <li>Today Plote works in USDC. Naira payments are on the roadmap.</li>
            </ul>
            <TextLink href="/security" className="mt-4">
              Security and limits
            </TextLink>
          </div>
        </GlowPanel>
      </Section>

      {/* ── FAQ ── */}
      <Section label="FAQ" className="!pt-0">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.6fr]">
          <div className="space-y-5">
            <h2 className="text-[32px] sm:text-[48px]">Frequently asked questions</h2>
            <TextLink href="/faq">All questions</TextLink>
          </div>
          <Faq items={FAQ.slice(0, 6)} />
        </div>
      </Section>
    </main>
  );
}
