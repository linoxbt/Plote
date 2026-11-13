import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Building2, Camera, Check, Coins, Eye, FileText, Globe2, HelpCircle, Lock, Repeat, ShieldCheck, Store, Activity } from "lucide-react";
import { CheckBand, EstateCards, HeroUnit, LiveReadPill, LiveTicker, OnRecord, RealProofs, SourceLinks, WatchItComeTogether } from "@/components/landing";
import { Container, Eyebrow, Faq, PillLink, Section, TextLink } from "@/components/site";
import { DEMO_ESTATE_SLUG } from "@/lib/estates";
import { FAQ } from "@/components/faq-data";

// Landing page, "plain numbers": a calm light layout, every figure read live from the estate contracts on NEAR.
// Copy from SPEC §12. Every section leads to its own full page.

const PROBLEMS: [ReactNode, string, string, string][] = [
  [<Repeat key="a" className="h-5 w-5" strokeWidth={1.75} />, "Sold twice.", "Some developers sell the same unit to more than one buyer. You find out at handover.", "One allocation token per unit. Anyone can look up who holds it."],
  [<Building2 key="b" className="h-5 w-5" strokeWidth={1.75} />, "Paid upfront, built never.", "Instalments go straight to the developer. When a project stalls, the money's already spent.", "Money waits in the unit's own account and moves stage by stage."],
  [<Camera key="c" className="h-5 w-5" strokeWidth={1.75} />, "Photos from far away.", "If you live abroad, you judge progress from pictures that could be from anywhere, or from last year.", "Each stage photo is checked in secure hardware before anything moves."],
];

const EXPLORE: [ReactNode, string, string, string][] = [
  [<FileText key="n" className="h-5 w-5" strokeWidth={1.75} />, "/nft", "The NFT", "Hold it and you hold the money, the vote and the keys."],
  [<ShieldCheck key="v" className="h-5 w-5" strokeWidth={1.75} />, "/verification", "Proof & verification", "What the enclave checks, and how a surveyor signs."],
  [<Globe2 key="p" className="h-5 w-5" strokeWidth={1.75} />, "/payments", "Pay from any chain", "USDC from Base, Solana, Ethereum and more, via NEAR Intents."],
  [<Lock key="s" className="h-5 w-5" strokeWidth={1.75} />, "/security", "Security", "Who can move money, and how. Plainly."],
  [<Store key="m" className="h-5 w-5" strokeWidth={1.75} />, "/market", "Resale market", "Sell your unit in one step: the buyer pays, the token moves."],
  [<Coins key="b" className="h-5 w-5" strokeWidth={1.75} />, "/builders", "For developers", "Public escrow as a sales tool. Paid per proven stage."],
  [<Eye key="q" className="h-5 w-5" strokeWidth={1.75} />, "/surveyors", "For surveyors", "Snap, check, sign. Your key can't move money."],
  [<Activity key="st" className="h-5 w-5" strokeWidth={1.75} />, "/status", "System status", "Contracts, verifier and RPC, checked live."],
];

export default function Landing() {
  return (
    <main id="main">
      {/* ── Hero ── */}
      <section aria-label="Introduction" className="relative">
        <Container className="grid items-center gap-12 pb-14 pt-10 sm:pt-16 lg:grid-cols-[1.08fr_1fr] lg:gap-10 lg:pb-20 lg:pt-20">
          <div className="space-y-7">
            <div className="rise">
              <LiveReadPill />
            </div>
            <h1 className="rise text-[44px] leading-[1.1] [animation-delay:80ms] sm:text-[64px] lg:text-[58px] xl:text-[68px]">
              Pay for the house{" "}
              <br />
              <span className="hl">you can see.</span>
            </h1>
            <p className="rise max-w-xl text-[17px] leading-relaxed text-muted [animation-delay:160ms] sm:text-lg">
              Plote gives every off-plan unit its own account. Your money waits there and moves to the developer only when a photo of the next stage passes an
              independent check. If the build stalls, you take it back.
            </p>
            <div className="rise flex flex-wrap gap-3 [animation-delay:220ms]">
              <PillLink href="/check" arrow>
                Check a unit
              </PillLink>
              <PillLink href={`/estates/${DEMO_ESTATE_SLUG}`} variant="ghost">
                See a live estate
              </PillLink>
            </div>
            <ul className="rise flex max-w-xl flex-wrap gap-x-6 gap-y-2 [animation-delay:280ms]">
              {["Escrow per unit", "Refunds you trigger", "Proof checked in a TEE"].map((t) => (
                <li key={t} className="mono inline-flex items-center gap-2 text-[12px] uppercase tracking-[0.1em] text-muted">
                  <Check className="h-3.5 w-3.5 text-orange-ink" strokeWidth={2.25} aria-hidden /> {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="rise [animation-delay:200ms]">
            <HeroUnit />
          </div>
        </Container>
      </section>

      <LiveTicker />

      {/* ── Why Plote ── */}
      <Section label="Why Plote">
        <div className="grid gap-10">
          <div data-reveal className="grid gap-6 lg:grid-cols-[1.1fr_1fr] lg:items-end">
            <div className="space-y-4">
              <Eyebrow>Why Plote</Eyebrow>
              <h2 className="text-[32px] leading-[1.08] sm:text-[44px] sm:leading-[1.05]">
                Off-plan is a promise.
                <br />
                Plote makes it a receipt.
              </h2>
            </div>
            <div className="space-y-2">
              <p className="max-w-md text-base leading-relaxed text-muted">
                Each unit is a named NEAR account with no keys. It holds the buyer&apos;s USDC and obeys only the estate contract&apos;s public rules — not the
                developer, not Plote.
              </p>
              <TextLink href="/how-it-works">See how it works</TextLink>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {PROBLEMS.map(([icon, t, b, fix]) => (
              <div key={t} data-reveal className="flex flex-col rounded-[20px] bg-surface p-6 ring-1 ring-line">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-2 text-text ring-1 ring-line">{icon}</div>
                <h3 className="mt-5 text-lg font-medium">{t}</h3>
                <p className="mb-5 mt-2 text-[15px] leading-relaxed text-muted">{b}</p>
                <p className="mt-auto flex items-start gap-2 border-t border-line pt-4 text-[14px] text-text">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" strokeWidth={2.25} aria-hidden /> {fix}
                </p>
              </div>
            ))}
            <div className="md:col-span-3">
              <SourceLinks />
            </div>
            <div data-reveal className="rounded-[20px] bg-surface p-6 ring-1 ring-line md:col-span-3">
              <p className="text-[15px] font-medium">What Plote doesn&apos;t do</p>
              <ul className="mt-3 grid gap-x-8 gap-y-2 text-sm leading-relaxed text-muted md:grid-cols-2">
                <li>Plote is not your land title. Always check the C of O or governor&apos;s consent with a lawyer.</li>
                <li>Plote can&apos;t stop a developer who refuses to use it. Ask your developer why they don&apos;t.</li>
                <li>The surveyor is a real person. Plote checks their photos and lets holders replace them, but it doesn&apos;t remove the need for one.</li>
                <li>Today Plote works in USDC. Naira payments are on the roadmap.</li>
              </ul>
              <TextLink href="/security" className="mt-2">
                Security and limits
              </TextLink>
            </div>
          </div>
        </div>
      </Section>

      {/* ── Estates ── */}
      <Section label="Estates" className="!pt-0">
        <div className="mb-10 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div data-reveal className="space-y-4">
            <Eyebrow>Live estates</Eyebrow>
            <h2 className="text-[32px] leading-[1.08] sm:text-[44px] sm:leading-[1.05]">
              Three estates.
              <br />
              Every number up front.
            </h2>
          </div>
          <TextLink href="/estates">All estates</TextLink>
        </div>
        <EstateCards />
      </Section>

      {/* ── Watch your house come together ── */}
      <Section label="How it works" className="!pt-4">
        <WatchItComeTogether />
      </Section>

      {/* ── Dark band: check a unit ── */}
      <section aria-label="Check a unit" className="theme-dark">
        <Container className="py-20 sm:py-28">
          <CheckBand />
        </Container>
      </section>

      {/* ── Real proofs ── */}
      <Section label="Real proofs">
        <div className="mb-10 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div data-reveal className="space-y-4">
            <Eyebrow>From the chain</Eyebrow>
            <h2 className="text-[32px] leading-[1.08] sm:text-[44px] sm:leading-[1.05]">
              Real proofs.
              <br />
              Real numbers.
            </h2>
          </div>
          <p className="max-w-sm text-sm text-muted sm:text-right">No testimonials, no stock photos. Every card below is a proof, a release or a refund, read straight from the chain.</p>
        </div>
        <RealProofs />
      </Section>

      {/* ── On record ── */}
      <Section label="On record" className="!pt-0">
        <div className="mb-10 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div data-reveal className="space-y-4">
            <Eyebrow>Surveyors on record</Eyebrow>
            <h2 className="text-[32px] leading-[1.08] sm:text-[44px] sm:leading-[1.05]">
              Everyone who signs,
              <br />
              on the record.
            </h2>
          </div>
          <p className="max-w-sm text-sm text-muted sm:text-right">The accounts behind each live estate and what they&apos;ve done on-chain. Holders can vote to replace a surveyor.</p>
        </div>
        <OnRecord />
      </Section>

      {/* ── Explore ── */}
      <Section label="Explore Plote" className="!pt-0">
        <div className="mb-8 space-y-4" data-reveal>
          <Eyebrow>More</Eyebrow>
          <h2 className="text-[28px] leading-[1.1] sm:text-[36px]">Everything else, in plain words.</h2>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {EXPLORE.map(([icon, href, t, b]) => (
            <li key={href}>
              <Link href={href} className="group flex h-full flex-col gap-3 rounded-[20px] bg-surface p-5 ring-1 ring-line transition-shadow hover:shadow-[0_12px_32px_-18px_rgba(11,18,32,0.3)]">
                <span className="flex items-center justify-between">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-soft text-orange-ink">{icon}</span>
                  <ArrowRight className="h-4 w-4 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-text" aria-hidden />
                </span>
                <span className="text-[15px] font-medium">{t}</span>
                <span className="text-sm leading-relaxed text-muted">{b}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Section>

      {/* ── FAQ ── */}
      <Section label="FAQ" className="!pt-0">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.4fr] lg:gap-16">
          <div data-reveal className="space-y-4">
            <Eyebrow>FAQ</Eyebrow>
            <h2 className="text-[32px] leading-[1.08] sm:text-[44px] sm:leading-[1.05]">
              Plain answers
              <br />
              to fair questions.
            </h2>
            <p className="max-w-sm text-base leading-relaxed text-muted">Where your money is, who can move it and what Plote doesn&apos;t do. Not sure? Check a unit yourself — no login.</p>
            <div className="flex flex-wrap gap-3 pt-2">
              <PillLink href="/faq" variant="ghost">
                <HelpCircle className="h-4 w-4" aria-hidden /> All questions
              </PillLink>
              <PillLink href="/estates/playground" variant="ink">
                Try the playground
              </PillLink>
            </div>
          </div>
          <Faq items={FAQ.slice(0, 6)} />
        </div>
      </Section>
    </main>
  );
}
