import Link from "next/link";
import {
  Banknote, Building2, Camera, DoorOpen, Eye, KeyRound, ListChecks, LifeBuoy, RefreshCcw, Repeat, ShieldCheck, Vote, Wallet,
} from "lucide-react";
import { BracketCard, LinkButton } from "@/components/ui";
import {
  ChainChips, FinalCta, HeroBlock, HeroCheck, LANDING_ESTATE_SLUG, LiveProofCard, LiveStrip, NftShowcase, PhoneMockup, SourceLinks, WatchExampleLink,
} from "@/components/landing";
import { GITHUB_URL } from "@/lib/config";
import { FAQ } from "@/components/faq-data";

// SPEC §12 — copy is final.

function H2({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <h2 id={id} className="text-[28px] font-semibold sm:text-[40px]">
      {children}
    </h2>
  );
}

function Section({ children, className, label }: { children: React.ReactNode; className?: string; label: string }) {
  return (
    <section aria-label={label} className={`mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20 ${className ?? ""}`}>
      {children}
    </section>
  );
}



export default function Landing() {
  return (
    <main id="main">
      {/* 2 · Hero */}
      <section aria-label="Introduction" className="survey-grid border-b border-line/60">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.15fr_1fr] md:py-24">
          <div className="space-y-6">
            <p className="mono text-xs tracking-[0.14em] text-teal">OFF-PLAN ESCROW · BUILT ON NEAR</p>
            <h1 className="text-[40px] font-semibold leading-[1.05] sm:text-[56px]">Pay for the house you can see.</h1>
            <p className="max-w-xl text-lg text-muted">
              Plote gives every off-plan unit its own account. Your money waits there and moves to the developer only when a photo of the next stage
              passes an independent check. If the build stalls, you take it back.
            </p>
            <div className="flex flex-wrap gap-3">
              <LinkButton href="/check" variant="primary">
                Check a unit →
              </LinkButton>
              <LinkButton href={`/estates/${LANDING_ESTATE_SLUG}`}>See a live estate</LinkButton>
            </div>
            <HeroCheck />
            <p className="mono text-xs text-muted">Escrow per unit · One owner per unit · Refunds you trigger yourself</p>
          </div>
          <div className="flex justify-center">
            <HeroBlock />
          </div>
        </div>
      </section>

      {/* 3 · Live strip */}
      <Section label="Live numbers" className="!py-10">
        <LiveStrip />
      </Section>

      {/* 4 · The problem */}
      <Section label="The problem">
        <H2>Off-plan is a promise. Plote makes it a receipt.</H2>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {[
            [Repeat, "Sold twice.", "Some developers sell the same unit to more than one buyer. You find out at handover."],
            [Banknote, "Paid upfront, built never.", "Instalments go straight to the developer. When a project stalls, the money's already spent."],
            [Camera, "Photos from far away.", "If you live abroad, you judge progress from WhatsApp pictures that could be from anywhere, or from last year."],
          ].map(([Icon, t, b]) => {
            const I = Icon as typeof Repeat;
            return (
              <BracketCard key={t as string} className="space-y-3">
                <I className="h-6 w-6 text-red" strokeWidth={1.5} aria-hidden />
                <h3 className="text-xl font-semibold">{t as string}</h3>
                <p className="text-muted">{b as string}</p>
              </BracketCard>
            );
          })}
        </div>
        <div className="mt-4">
          <SourceLinks />
        </div>
      </Section>

      {/* 5 · How it works */}
      <Section label="How it works">
        <H2>Four steps. No middleman holding your money.</H2>
        <ol className="mt-8 grid gap-4 md:grid-cols-4">
          {[
            [KeyRound, "Reserve your unit.", <>Each unit has its own address, like <span className="mono text-text">a-4b.harmattan-court</span>. Reserve it and it&apos;s locked for you.</>],
            [Wallet, "Pay into the unit, not the developer.", "Pay from a NEAR wallet, or send USDC from Base, Solana, Ethereum and more. The money sits in the unit's own account. You get the allocation token — the only one that unit will ever have."],
            [ShieldCheck, "Every stage is proven.", "The surveyor uploads a site photo. It's checked inside secure hardware: taken on site, taken this week, never used before, and showing the right stage. Then the surveyor signs."],
            [RefreshCcw, "Money moves only on proof.", "Each verified stage releases its share — 20%, 30%, 30%, 20%. Miss a deadline and you can take back everything not yet released. One tap."],
          ].map(([Icon, t, b], i) => {
            const I = Icon as typeof KeyRound;
            return (
              <li key={i} className="corners relative bg-surface p-5">
                <p className="mono text-xs text-teal">0{i + 1}</p>
                <I className="mt-3 h-6 w-6 text-teal" strokeWidth={1.5} aria-hidden />
                <h3 className="mt-3 text-lg font-semibold">{t as string}</h3>
                <p className="mt-2 text-sm text-muted">{b as React.ReactNode}</p>
              </li>
            );
          })}
        </ol>
      </Section>

      {/* 6 · The token that does something */}
      <Section label="The token">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr]">
          <div>
            <H2>Your token isn&apos;t a picture. It&apos;s the unit.</H2>
            <p className="mt-3 text-lg text-muted">Hold it and you hold the money, the vote and the keys.</p>
            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              {[
                [Wallet, "Holds the money", "your payments sit in the unit's account until a stage is proven."],
                [LifeBuoy, "Gets you refunds", "if a deadline passes, the token is what lets you pull your money back."],
                [Repeat, "Sells in one step", "list it; a buyer pays, you're paid and the token moves in a single transaction."],
                [ListChecks, "Protects you if you fall behind", "miss instalments and it's resold for what you paid, minus a fixed 5%. Not forfeited."],
                [Vote, "Gives you a vote", "one per unit: replace the surveyor, veto a sign-off or freeze payments."],
                [DoorOpen, "Opens the gate", "after handover, it's your gate pass and service-charge account."],
              ].map(([Icon, t, b]) => {
                const I = Icon as typeof Wallet;
                return (
                  <BracketCard key={t as string} className="space-y-2">
                    <I className="h-5 w-5 text-teal" strokeWidth={1.5} aria-hidden />
                    <p>
                      <span className="font-semibold">{t as string}</span> <span className="text-muted">— {b as string}</span>
                    </p>
                  </BracketCard>
                );
              })}
            </div>
          </div>
          <NftShowcase />
        </div>
      </Section>

      {/* 7 · Proof, not promises */}
      <Section label="Proof">
        <H2>See exactly why money moved.</H2>
        <div className="mt-8">
          <LiveProofCard />
        </div>
      </Section>

      {/* 8 · Pay from wherever you are */}
      <Section label="Payments">
        <H2>In London, Houston or Toronto? Pay the way you already do.</H2>
        <p className="mt-3 max-w-2xl text-lg text-muted">
          Send USDC or USDT from the chain you use. Plote swaps it and delivers USDC straight into your unit&apos;s account. No exchange account in Nigeria, no
          wire to a stranger.
        </p>
        <div className="mt-6">
          <ChainChips />
        </div>
        <p className="mt-4 text-xs text-muted">Cross-chain payments use NEAR Intents. They can take up to 15 minutes.</p>
      </Section>

      {/* 9 · Watch your house */}
      <Section label="Watch your house">
        <div className="grid items-center gap-10 md:grid-cols-2">
          <div className="space-y-4">
            <H2>Share the build with the whole family.</H2>
            <p className="text-lg text-muted">
              Every unit has a public page with each stage&apos;s photo and proof. Send it to your mum on WhatsApp. Let your siblings chip in toward the roof.
            </p>
            <WatchExampleLink />
          </div>
          <PhoneMockup />
        </div>
      </Section>

      {/* 10 · For developers */}
      <Section label="For developers">
        <div className="grid gap-8 md:grid-cols-2">
          <div className="space-y-4">
            <Building2 className="h-7 w-7 text-teal" strokeWidth={1.5} aria-hidden />
            <H2>Honest developers finally have a way to prove it.</H2>
          </div>
          <div className="space-y-5">
            <ul className="space-y-3">
              {[
                "Public escrow is a sales tool — buyers can check you in seconds.",
                "Get paid per stage, automatically, the moment it's proven.",
                "Your on-time record becomes a public score.",
                "Diaspora buyers can pay you from any chain.",
              ].map((b) => (
                <li key={b} className="flex gap-3">
                  <span className="mono text-teal" aria-hidden>
                    ▪
                  </span>
                  {b}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center gap-4">
              <LinkButton href="/dev" variant="primary">
                Open the developer console
              </LinkButton>
              <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center text-sm underline hover:text-teal">
                Read the contract →
              </a>
            </div>
          </div>
        </div>
      </Section>

      {/* 11 · For surveyors */}
      <Section label="For surveyors">
        <BracketCard className="grid gap-6 p-6 md:grid-cols-[auto_1fr] md:p-10">
          <Eye className="h-8 w-8 text-teal" strokeWidth={1.5} aria-hidden />
          <div className="space-y-3">
            <H2>Your sign-off, on the record.</H2>
            <p className="text-lg text-muted">Snap the site photo on your phone. Plote checks it and you sign. Your key can only sign milestones — it can&apos;t move money.</p>
            <Link href="/qs" className="inline-flex min-h-11 items-center text-sm underline hover:text-teal">
              Open the surveyor app →
            </Link>
          </div>
        </BracketCard>
      </Section>

      {/* 12 · Built on NEAR */}
      <Section label="Built on NEAR">
        <H2>Built on NEAR</H2>
        <dl className="mt-8 grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-5">
          {[
            ["Accounts per unit", "each home is a named NEAR account."],
            ["NEAR Intents", "pay from other chains."],
            ["OutLayer", "photo checks run in secure hardware, attested on-chain."],
            ["NEAR AI Cloud", "private, verifiable stage recognition."],
            ["Holder votes", "one vote per unit, cast with the NFT."],
          ].map(([k, v]) => (
            <div key={k} className="bg-bg p-5">
              <dt className="mono text-sm font-semibold text-teal">{k}</dt>
              <dd className="mt-1 text-sm text-muted">— {v}</dd>
            </div>
          ))}
        </dl>
        <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="mt-4 inline-flex min-h-11 items-center text-sm underline hover:text-teal">
          Read the build spec and code on GitHub →
        </a>
      </Section>

      {/* 13 · What Plote is not */}
      <Section label="What Plote doesn't do">
        <div className="border border-line p-6 sm:p-10">
          <H2>What Plote doesn&apos;t do.</H2>
          <ul className="mt-6 space-y-3 text-muted">
            <li>Plote is not your land title. Always check the C of O or governor&apos;s consent with a lawyer.</li>
            <li>Plote can&apos;t stop a developer who refuses to use it. Ask your developer why they don&apos;t.</li>
            <li>The surveyor is a real person. Plote checks their photos and lets holders replace them, but it doesn&apos;t remove the need for one.</li>
            <li>Today Plote works in USDC. Naira payments are on the roadmap.</li>
          </ul>
        </div>
      </Section>

      {/* 14 · FAQ */}
      <Section label="FAQ">
        <H2 id="faq">FAQ</H2>
        <div className="mt-8 grid gap-3 md:grid-cols-2">
          {FAQ.map(([q, a]) => (
            <details key={q} className="corners corners-hover bg-surface p-4 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex min-h-11 cursor-pointer items-center font-medium">{q}</summary>
              <p className="mt-2 text-muted">{a}</p>
            </details>
          ))}
        </div>
      </Section>

      {/* 15 · Final CTA */}
      <Section label="Check a unit" className="text-center">
        <div className="flex flex-col items-center gap-6">
          <H2>Check a unit before you pay for it.</H2>
          <FinalCta />
        </div>
      </Section>
    </main>
  );
}
