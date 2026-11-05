import Link from "next/link";
import type { ReactNode } from "react";
import { LinkButton } from "@/components/ui";
import {
  ChainChips, FinalCta, HeroCheck, HeroStats, LANDING_ESTATE_SLUG, LiveProofCard, NftShowcase, PhoneMockup, SourceLinks, WatchExampleLink,
} from "@/components/landing";
import { DataField, EstateRing, HudTag, SectionHead } from "@/components/hud";
import { GITHUB_URL, IS_MAINNET } from "@/lib/config";
import { FAQ } from "@/components/faq-data";

// SPEC §12 — copy is final. Layout: the "instrument" system (data as the artwork, HUD hairlines,
// boxed labels over thin readouts, numbered sections).

function Section({ children, className, label }: { children: ReactNode; className?: string; label: string }) {
  return (
    <section aria-label={label} className={`relative border-t border-[var(--line-soft)] ${className ?? ""}`}>
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">{children}</div>
    </section>
  );
}

/** Hairline table row used for numbered lists: index · title · body. */
function Row({ index, title, children, tone = "teal" }: { index: string; title: ReactNode; children: ReactNode; tone?: "teal" | "red" | "gold" }) {
  const c = tone === "red" ? "text-red" : tone === "gold" ? "text-gold" : "text-teal";
  return (
    <li className="grid gap-2 border-t border-[var(--line)] py-6 sm:grid-cols-[72px_minmax(0,0.9fr)_minmax(0,1.4fr)] sm:gap-8">
      <span className={`tech text-[11px] tabular-nums ${c}`}>{index}</span>
      <h3 className="text-xl text-text sm:text-2xl">{title}</h3>
      <p className="text-muted">{children}</p>
    </li>
  );
}

const STEPS: [string, ReactNode, string][] = [
  [
    "Reserve your unit.",
    <>
      Each unit has its own address, like <span className="mono text-text">a-4b.harmattan-court</span>. Reserve it and it&apos;s locked for you.
    </>,
    "RESERVE",
  ],
  [
    "Pay into the unit, not the developer.",
    "Pay from a NEAR wallet, or send USDC from Base, Solana, Ethereum and more. The money sits in the unit's own account. You get the allocation token — the only one that unit will ever have.",
    "ESCROW",
  ],
  [
    "Every stage is proven.",
    "The surveyor uploads a site photo. It's checked inside secure hardware: taken on site, taken this week, never used before, and showing the right stage. Then the surveyor signs.",
    "PROOF",
  ],
  [
    "Money moves only on proof.",
    "Each verified stage releases its share — 20%, 30%, 30%, 20%. Miss a deadline and you can take back everything not yet released. One tap.",
    "RELEASE",
  ],
];

const TOKEN: [string, string][] = [
  ["Holds the money", "your payments sit in the unit's account until a stage is proven."],
  ["Gets you refunds", "if a deadline passes, the token is what lets you pull your money back."],
  ["Sells in one step", "list it; a buyer pays, you're paid and the token moves in a single transaction."],
  ["Protects you if you fall behind", "miss instalments and it's resold for what you paid, minus a fixed 5%. Not forfeited."],
  ["Gives you a vote", "one per unit: replace the surveyor, veto a sign-off or freeze payments."],
  ["Opens the gate", "after handover, it's your gate pass and service-charge account."],
];

export default function Landing() {
  const net = IS_MAINNET ? "mainnet" : "testnet";
  return (
    <main id="main">
      {/* ───────── Hero: the data painting, a glass band, readouts at the corners ───────── */}
      <section aria-label="Introduction" className="relative isolate overflow-hidden">
        <div className="absolute inset-0 -z-10">
          <DataField />
          <div className="absolute inset-0 bg-[radial-gradient(80%_70%_at_50%_45%,rgba(3,4,12,0)_0%,rgba(3,4,12,0.25)_70%,#03040c_100%)]" />
        </div>
        <div className="relative mx-auto flex min-h-[calc(100dvh-4rem)] max-w-7xl flex-col justify-center gap-8 px-4 py-10 sm:px-6 lg:py-6">
          <div className="relative lg:py-24">
            <div className="glass corners relative mx-auto max-w-[920px] px-5 py-8 sm:px-12 sm:py-10">
              <p className="tech-wide text-center text-[10px] text-muted sm:text-[11px]">Off-plan escrow · Built on NEAR</p>
              <h1 className="mt-4 text-center text-[38px] text-text sm:text-[56px]">Pay for the house you can see.</h1>
              <p className="mx-auto mt-4 max-w-2xl text-center text-[17px] text-muted">
                Plote gives every off-plan unit its own account. Your money waits there and moves to the developer only when a photo of the next stage
                passes an independent check. If the build stalls, you take it back.
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <LinkButton href="/check" variant="primary">
                  Check a unit →
                </LinkButton>
                <LinkButton href={`/estates/${LANDING_ESTATE_SLUG}`}>See a live estate</LinkButton>
              </div>
              <div className="mx-auto mt-6 max-w-lg">
                <HeroCheck />
              </div>
              <p className="tech mt-1 text-center text-[10px] text-faint">Escrow per unit · One owner per unit · Refunds you trigger yourself</p>
            </div>
            <HeroStats className="mt-10 lg:mt-0" />
          </div>
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-between">
            <p className="text-sm text-muted">
              Live from NEAR {net}. Every number links to the chain.
            </p>
            <a href="#problem" className="tech hidden items-center gap-3 text-[10px] text-faint hover:text-text sm:inline-flex">
              Scroll <span className="block h-px w-10 bg-[var(--line)]" aria-hidden />
            </a>
          </div>
        </div>
      </section>

      {/* ───────── 01 · The problem ───────── */}
      <Section label="The problem">
        <SectionHead index="01" label="The problem" id="problem" title="Off-plan is a promise. Plote makes it a receipt." />
        <ol className="mt-12 border-b border-[var(--line)]">
          <Row index="R-01" tone="red" title="Sold twice.">
            Some developers sell the same unit to more than one buyer. You find out at handover.
          </Row>
          <Row index="R-02" tone="red" title="Paid upfront, built never.">
            Instalments go straight to the developer. When a project stalls, the money&apos;s already spent.
          </Row>
          <Row index="R-03" tone="red" title="Photos from far away.">
            If you live abroad, you judge progress from WhatsApp pictures that could be from anywhere, or from last year.
          </Row>
        </ol>
        <div className="mt-5">
          <SourceLinks />
        </div>
      </Section>

      {/* ───────── 02 · How it works ───────── */}
      <Section label="How it works" className="rings">
        <SectionHead index="02" label="How it works" title="Four steps. No middleman holding your money." />
        <ol className="mt-12 grid gap-px bg-[var(--line-soft)] md:grid-cols-4">
          {STEPS.map(([t, b, tag], i) => (
            <li key={t} className="flex flex-col gap-4 bg-bg/80 p-5 sm:p-6">
              <div className="flex items-center justify-between">
                <span className="readout text-[44px] text-text/90">0{i + 1}</span>
                <HudTag tone={i === 3 ? "teal" : "ghost"}>{tag}</HudTag>
              </div>
              <div className="h-px w-full bg-[var(--line)]">
                <div className="h-px bg-teal" style={{ width: `${(i + 1) * 25}%` }} />
              </div>
              <h3 className="text-lg text-text">{t}</h3>
              <p className="text-sm text-muted">{b}</p>
            </li>
          ))}
        </ol>
      </Section>

      {/* ───────── 03 · Estates (the collections ring) ───────── */}
      <Section label="Estates">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <SectionHead index="03" label="Estates" title="Every estate, every unit, in the open." lead="Each card is a live estate on NEAR. Open one to see its units, its escrow and every proven stage." />
          <Link href="/estates" className="tech inline-flex min-h-11 shrink-0 items-center gap-3 text-[11px] text-muted hover:text-teal">
            All estates <span className="block h-px w-8 bg-current" aria-hidden />
          </Link>
        </div>
        <div className="mt-12">
          <EstateRing />
        </div>
      </Section>

      {/* ───────── 04 · The token that does something ───────── */}
      <Section label="The token">
        <div className="grid gap-12 lg:grid-cols-[1.35fr_1fr]">
          <div>
            <SectionHead index="04" label="The token" title={<>Your token isn&apos;t a picture. It&apos;s the unit.</>} lead="Hold it and you hold the money, the vote and the keys." />
            <dl className="mt-10 grid gap-px bg-[var(--line-soft)] sm:grid-cols-2">
              {TOKEN.map(([t, b], i) => (
                <div key={t} className="bg-bg/85 p-5">
                  <dt className="flex items-center gap-3">
                    <span className="tech text-[10px] text-teal tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                    <span className="text-text">{t}</span>
                  </dt>
                  <dd className="mt-2 text-sm text-muted">— {b}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="lg:pt-16">
            <NftShowcase />
          </div>
        </div>
      </Section>

      {/* ───────── 05 · Proof, not promises ───────── */}
      <Section label="Proof">
        <SectionHead index="05" label="Data points" title="See exactly why money moved." />
        <div className="mt-12">
          <LiveProofCard />
        </div>
      </Section>

      {/* ───────── 06 · Pay from wherever you are ───────── */}
      <Section label="Payments">
        <div className="grid gap-10 lg:grid-cols-[1.2fr_1fr] lg:items-end">
          <SectionHead
            index="06"
            label="Payments"
            title="In London, Houston or Toronto? Pay the way you already do."
            lead={<>Send USDC or USDT from the chain you use. Plote swaps it and delivers USDC straight into your unit&apos;s account. No exchange account in Nigeria, no wire to a stranger.</>}
          />
          <div className="space-y-4">
            <ChainChips />
            <p className="text-xs text-muted">Cross-chain payments use NEAR Intents. They can take up to 15 minutes.</p>
          </div>
        </div>
      </Section>

      {/* ───────── 07 · Watch your house ───────── */}
      <Section label="Watch your house">
        <div className="grid items-center gap-12 md:grid-cols-2">
          <div className="space-y-8">
            <SectionHead
              index="07"
              label="Watch"
              title="Share the build with the whole family."
              lead={<>Every unit has a public page with each stage&apos;s photo and proof. Send it to your mum on WhatsApp. Let your siblings chip in toward the roof.</>}
            />
            <WatchExampleLink />
          </div>
          <PhoneMockup />
        </div>
      </Section>

      {/* ───────── 08 · Developers & surveyors ───────── */}
      <Section label="For developers and surveyors">
        <div className="grid gap-px bg-[var(--line-soft)] lg:grid-cols-2">
          <div className="space-y-8 bg-bg/85 p-6 sm:p-10">
            <SectionHead index="08" label="For developers" title="Honest developers finally have a way to prove it." />
            <ul className="space-y-3">
              {[
                "Public escrow is a sales tool — buyers can check you in seconds.",
                "Get paid per stage, automatically, the moment it's proven.",
                "Your on-time record becomes a public score.",
                "Diaspora buyers can pay you from any chain.",
              ].map((b) => (
                <li key={b} className="flex gap-3">
                  <span className="mt-[9px] block h-px w-4 shrink-0 bg-teal" aria-hidden />
                  {b}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center gap-4">
              <LinkButton href="/dev" variant="primary">
                Open the developer console
              </LinkButton>
              <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="tech inline-flex min-h-11 items-center text-[11px] text-muted hover:text-teal">
                Read the contract →
              </a>
            </div>
          </div>
          <div className="flex flex-col justify-between gap-8 bg-bg/85 p-6 sm:p-10">
            <SectionHead index="09" label="For surveyors" title="Your sign-off, on the record." />
            <p className="text-lg text-muted">Snap the site photo on your phone. Plote checks it and you sign. Your key can only sign milestones — it can&apos;t move money.</p>
            <div className="flex flex-wrap gap-2">
              <HudTag tone="gold">Sign milestones</HudTag>
              <HudTag tone="ghost">Can&apos;t move money</HudTag>
            </div>
            <Link href="/qs" className="tech inline-flex min-h-11 items-center text-[11px] text-muted hover:text-teal">
              Open the surveyor app →
            </Link>
          </div>
        </div>
      </Section>

      {/* ───────── 10 · Built on NEAR ───────── */}
      <Section label="Built on NEAR">
        <SectionHead index="10" label="Stack" title="Built on NEAR" />
        <dl className="mt-12 grid gap-px bg-[var(--line-soft)] sm:grid-cols-2 lg:grid-cols-5">
          {[
            ["Accounts per unit", "each home is a named NEAR account."],
            ["NEAR Intents", "pay from other chains."],
            ["OutLayer", "photo checks run in secure hardware, attested on-chain."],
            ["NEAR AI Cloud", "private, verifiable stage recognition."],
            ["Holder votes", "one vote per unit, cast with the NFT."],
          ].map(([k, v], i) => (
            <div key={k} className="bg-bg/85 p-5">
              <span className="tech text-[10px] text-faint tabular-nums">{String(i + 1).padStart(2, "0")}</span>
              <dt className="tech mt-3 text-[12px] text-teal">{k}</dt>
              <dd className="mt-2 text-sm text-muted">— {v}</dd>
            </div>
          ))}
        </dl>
        <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="tech mt-6 inline-flex min-h-11 items-center text-[11px] text-muted hover:text-teal">
          Read the build spec and code on GitHub →
        </a>
      </Section>

      {/* ───────── 11 · What Plote is not ───────── */}
      <Section label="What Plote doesn't do">
        <div className="corners corners-red panel p-6 sm:p-10">
          <SectionHead index="11" label="Limits" title="What Plote doesn't do." />
          <ul className="mt-8 space-y-4 text-muted">
            {[
              "Plote is not your land title. Always check the C of O or governor's consent with a lawyer.",
              "Plote can't stop a developer who refuses to use it. Ask your developer why they don't.",
              "The surveyor is a real person. Plote checks their photos and lets holders replace them, but it doesn't remove the need for one.",
              "Today Plote works in USDC. Naira payments are on the roadmap.",
            ].map((t) => (
              <li key={t} className="flex gap-3">
                <span className="mt-[11px] block h-px w-4 shrink-0 bg-red" aria-hidden />
                {t}
              </li>
            ))}
          </ul>
        </div>
      </Section>

      {/* ───────── 12 · FAQ ───────── */}
      <Section label="FAQ">
        <SectionHead index="12" label="Questions" id="faq" title="FAQ" />
        <div className="mt-12 border-b border-[var(--line)]">
          {FAQ.map(([q, a], i) => (
            <details key={q} className="group border-t border-[var(--line)]">
              <summary className="flex min-h-14 cursor-pointer items-center gap-5 py-3 hover:text-teal">
                <span className="tech w-8 shrink-0 text-[10px] text-faint tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                <span className="flex-1 text-[17px]">{q}</span>
                <span className="tech text-[14px] text-muted transition-transform group-open:rotate-45" aria-hidden>
                  +
                </span>
              </summary>
              <p className="pb-5 pl-[52px] text-muted">{a}</p>
            </details>
          ))}
        </div>
      </Section>

      {/* ───────── Final CTA ───────── */}
      <Section label="Check a unit" className="survey-grid">
        <div className="mx-auto flex max-w-2xl flex-col items-center gap-8 text-center">
          <HudTag tone="teal">Before you pay</HudTag>
          <h2 className="text-[32px] text-text sm:text-[48px]">Check a unit before you pay for it.</h2>
          <div className="w-full text-left">
            <FinalCta />
          </div>
        </div>
      </Section>
    </main>
  );
}
