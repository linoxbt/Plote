import Link from "next/link";
import type { ReactNode } from "react";
import { LinkButton } from "@/components/ui";
import {
  ChainChips, FinalCta, HeroCheck, HeroStats, LANDING_ESTATE_SLUG, LiveProofCard, NftShowcase, PhoneMockup, SourceLinks, WatchExampleLink,
} from "@/components/landing";
import { DataField, EstateRing, HudTag, SectionHead } from "@/components/hud";
import { EstateLinks, LandingShell, WorldFallback } from "@/components/world/landing-shell";
import { KineticTitle, Marquee } from "@/components/world/fx";
import { GITHUB_URL, IS_MAINNET } from "@/lib/config";
import { FAQ } from "@/components/faq-data";

// SPEC §12 — copy is final. Layout: an immersive, scroll-driven WebGL world (components/world)
// with three pinned stages — the painting (hero), the house that builds itself (how it works) and
// the estate helix — and the remaining sections revealed in 3D as they scroll in.

function Section({ children, className, label, id }: { children: ReactNode; className?: string; label: string; id?: string }) {
  return (
    <section id={id} aria-label={label} className={`relative ${className ?? ""}`}>
      <div data-reveal className="mx-auto w-full max-w-6xl px-5 py-20 sm:px-8 sm:py-28 lg:w-[80%] lg:px-0">
        {children}
      </div>
    </section>
  );
}

function Row({ index, title, children }: { index: string; title: ReactNode; children: ReactNode }) {
  return (
    <li className="grid gap-2 border-t border-[var(--line)] py-5 sm:grid-cols-[72px_minmax(0,0.9fr)_minmax(0,1.4fr)] sm:gap-8">
      <span className="tech text-[9px] text-red tabular-nums">{index}</span>
      <h3 className="uppercase tracking-[0.06em] text-text [font-family:var(--font-tech)]">{title}</h3>
      <p className="text-[12.5px] text-muted">{children}</p>
    </li>
  );
}

const STEPS: [string, ReactNode, string, string][] = [
  ["Reserve your unit.", <>Each unit has its own address, like <span className="mono text-text">a-4b.harmattan-court</span>. Reserve it and it&apos;s locked for you.</>, "Foundation", "20%"],
  ["Pay into the unit, not the developer.", "Pay from a NEAR wallet, or send USDC from Base, Solana, Ethereum and more. The money sits in the unit's own account. You get the allocation token — the only one that unit will ever have.", "Roofing", "30%"],
  ["Every stage is proven.", "The surveyor uploads a site photo. It's checked inside secure hardware: taken on site, taken this week, never used before, and showing the right stage. Then the surveyor signs.", "Finishing", "30%"],
  ["Money moves only on proof.", "Each verified stage releases its share — 20%, 30%, 30%, 20%. Miss a deadline and you can take back everything not yet released. One tap.", "Handover", "20%"],
];

const STEP_ON = ["group-data-[step=0]:opacity-100", "group-data-[step=1]:opacity-100", "group-data-[step=2]:opacity-100", "group-data-[step=3]:opacity-100"];
const STEP_TXT = ["group-data-[step=0]:text-text", "group-data-[step=1]:text-text", "group-data-[step=2]:text-text", "group-data-[step=3]:text-text"];

const TOKEN: [string, string][] = [
  ["Holds the money", "your payments sit in the unit's account until a stage is proven."],
  ["Gets you refunds", "if a deadline passes, the token is what lets you pull your money back."],
  ["Sells in one step", "list it; a buyer pays, you're paid and the token moves in a single transaction."],
  ["Protects you if you fall behind", "miss instalments and it's resold for what you paid, minus a fixed 5%. Not forfeited."],
  ["Gives you a vote", "one per unit: replace the surveyor, veto a sign-off or freeze payments."],
  ["Opens the gate", "after handover, it's your gate pass and service-charge account."],
];

const PANEL = "bg-[rgba(2,3,20,0.7)]";

export default function Landing() {
  const net = IS_MAINNET ? "mainnet" : "testnet";
  return (
    <main id="main">
      <LandingShell>
        {/* ═════════ Stage 1 · the painting ═════════ */}
        <section id="top" data-world="hero" aria-label="Introduction" className="relative h-[230vh]">
          <div className="sticky top-0 flex h-[100dvh] flex-col justify-center overflow-hidden">
            <WorldFallback>
              <div className="absolute inset-0 -z-10">
                <DataField />
              </div>
            </WorldFallback>
            <div
              className="relative"
              style={{
                opacity: "calc(1 - var(--p, 0) * 2.4)",
                transform: "translate3d(0, calc(var(--p, 0) * -140px), 0) scale(calc(1 - var(--p, 0) * 0.12))",
              }}
            >
              <div className="glass border-y border-[var(--line-soft)] px-5 py-9 text-center sm:py-12">
                <KineticTitle text="Pay for the house you can see." className="mx-auto max-w-5xl text-[24px] uppercase tracking-[0.08em] text-text sm:text-[36px] lg:text-[42px]" />
                <p className="tech-wide mt-4 text-[8.5px] text-text/70 sm:text-[9.5px]">Plote · Off-plan escrow on NEAR</p>
              </div>
              <div className="mx-auto mt-5 w-[86%] sm:w-[70%]">
                <HeroStats />
                <p className="mt-6 text-center text-[10px] text-faint">Live from NEAR {net}. Every number links to the chain.</p>
              </div>
            </div>
          </div>
        </section>

        {/* ═════════ The promise ═════════ */}
        <Section label="The promise" className="-mt-[40vh]">
          <div className="glass corners mx-auto max-w-3xl px-6 py-10 text-center sm:px-12">
            <HudTag tone="ghost" className="text-[7.5px]">
              00 · The promise
            </HudTag>
            <p className="mx-auto mt-6 max-w-xl text-[13.5px] text-muted">
              Plote gives every off-plan unit its own account. Your money waits there and moves to the developer only when a photo of the next stage
              passes an independent check. If the build stalls, you take it back.
            </p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <span data-magnetic className="inline-block">
                <LinkButton href="/check" variant="primary" size="sm">
                  Check a unit →
                </LinkButton>
              </span>
              <span data-magnetic className="inline-block">
                <LinkButton href={`/estates/${LANDING_ESTATE_SLUG}`} size="sm">
                  See a live estate
                </LinkButton>
              </span>
            </div>
            <div className="mx-auto mt-7 max-w-md text-left">
              <HeroCheck />
            </div>
            <p className="tech mt-1 text-[8.5px] text-faint">Escrow per unit · One owner per unit · Refunds you trigger yourself</p>
          </div>
        </Section>

        {/* ═════════ 01 · The problem ═════════ */}
        <Section label="The problem">
          <SectionHead index="01" label="The problem" title="Off-plan is a promise. Plote makes it a receipt." />
          <ol className="mt-10 border-b border-[var(--line)]">
            <Row index="R-01" title="Sold twice.">
              Some developers sell the same unit to more than one buyer. You find out at handover.
            </Row>
            <Row index="R-02" title="Paid upfront, built never.">
              Instalments go straight to the developer. When a project stalls, the money&apos;s already spent.
            </Row>
            <Row index="R-03" title="Photos from far away.">
              If you live abroad, you judge progress from WhatsApp pictures that could be from anywhere, or from last year.
            </Row>
          </ol>
          <div className="mt-5 text-[10px]">
            <SourceLinks />
          </div>
        </Section>

        <Marquee rows={["Pay for the house you can see", "Proof before payment · Escrow per unit"]} />

        {/* ═════════ Stage 2 · the house builds itself ═════════ */}
        <section id="how" data-world="house" data-step="0" aria-label="How it works" className="group relative h-[420vh]">
          <div className="sticky top-0 h-[100dvh] overflow-hidden">
            <div className="mx-auto flex h-full w-full max-w-6xl flex-col justify-end gap-8 px-5 pb-16 pt-24 sm:px-8 lg:w-[80%] lg:justify-center lg:px-0 lg:pb-0">
              <div className="max-w-md space-y-8" style={{ opacity: "calc(var(--enter, 1) * 1.6 - 0.4 - var(--exit, 0) * 3.2)" }}>
                <SectionHead index="02" label="How it works" title="Four steps. No middleman holding your money." />
                <div className="grid [grid-template-areas:'s']">
                  {STEPS.map(([t, b], i) => (
                    <div key={t} className={`space-y-3 opacity-0 transition-opacity duration-500 [grid-area:s] ${STEP_ON[i]}`}>
                      <div className="flex items-center gap-4">
                        <span className="readout text-[40px] text-text/90">0{i + 1}</span>
                        <HudTag tone={i === 3 ? "teal" : "ghost"} className="text-[7.5px]">
                          Step {i + 1} of 4
                        </HudTag>
                      </div>
                      <h3 className="uppercase tracking-[0.06em] text-text [font-family:var(--font-tech)]">{t}</h3>
                      <p className="text-[12.5px] text-muted">{b}</p>
                    </div>
                  ))}
                </div>
                <ol className="grid grid-cols-4 gap-3" aria-label="Milestones">
                  {STEPS.map(([, , stage, pct], i) => (
                    <li key={stage} className="space-y-2">
                      <div className="h-px w-full bg-[var(--line)]">
                        <div className="h-px bg-teal" style={{ width: `calc(clamp(0, var(--p, 0) * 4 - ${i}, 1) * 100%)` }} />
                      </div>
                      <p className={`tech text-[8px] text-faint transition-colors ${STEP_TXT[i]}`}>{stage}</p>
                      <p className="readout text-[15px] text-muted">{pct}</p>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </div>
        </section>

        {/* ═════════ Stage 3 · the estate helix ═════════ */}
        <section id="estates" data-world="helix" aria-label="Estates" className="relative h-[380vh]">
          <div className="sticky top-0 h-[100dvh] overflow-hidden">
            <div
              className="pointer-events-none relative z-[1] mx-auto flex h-full w-full max-w-6xl flex-col justify-between px-5 pb-12 pt-24 sm:px-8 lg:w-[80%] lg:px-0"
              style={{ opacity: "calc(var(--enter, 1) * 1.6 - 0.4 - var(--exit, 0) * 3.2)" }}
            >
              <div className="max-w-sm">
                <SectionHead index="03" label="Estates" title="Every estate, every unit, in the open." lead="Each plate is a live estate on NEAR. Open one to see its units, its escrow and every proven stage." />
              </div>
              <div className="flex items-end justify-between gap-6">
                <p className="tech text-[8.5px] text-faint">Scroll to turn · Click a plate to open</p>
                <Link href="/estates" className="tech pointer-events-auto inline-flex min-h-11 items-center gap-3 text-[9.5px] text-muted hover:text-teal">
                  All estates <span className="block h-px w-8 bg-current" aria-hidden />
                </Link>
              </div>
            </div>
            <WorldFallback>
              <div className="absolute inset-x-0 top-1/2 z-[2] mx-auto w-full max-w-6xl -translate-y-1/2 px-5">
                <EstateRing />
              </div>
            </WorldFallback>
            <EstateLinks />
          </div>
        </section>

        {/* ═════════ 04 · The token ═════════ */}
        <Section label="The token">
          <div className="grid gap-12 lg:grid-cols-[1.35fr_1fr]">
            <div>
              <SectionHead index="04" label="The token" title={<>Your token isn&apos;t a picture. It&apos;s the unit.</>} lead="Hold it and you hold the money, the vote and the keys." />
              <dl className="mt-10 grid gap-px bg-[var(--line-soft)] sm:grid-cols-2">
                {TOKEN.map(([t, b], i) => (
                  <div key={t} className={`${PANEL} p-5`}>
                    <dt className="flex items-center gap-3">
                      <span className="tech text-[8.5px] text-teal tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                      <span className="tech text-[10px] text-text">{t}</span>
                    </dt>
                    <dd className="mt-2 text-[12px] text-muted">— {b}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="lg:pt-16">
              <NftShowcase />
            </div>
          </div>
        </Section>

        {/* ═════════ 05 · Data points ═════════ */}
        <Section label="Proof" id="proof">
          <SectionHead index="05" label="Data points" title="See exactly why money moved." />
          <div className="mt-10">
            <LiveProofCard />
          </div>
        </Section>

        {/* ═════════ 06 · Payments ═════════ */}
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
              <p className="text-[10.5px] text-faint">Cross-chain payments use NEAR Intents. They can take up to 15 minutes.</p>
            </div>
          </div>
        </Section>

        {/* ═════════ 07 · Watch ═════════ */}
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

        {/* ═════════ 08–09 · Developers & surveyors ═════════ */}
        <Section label="For developers and surveyors">
          <div className="grid gap-px bg-[var(--line-soft)] lg:grid-cols-2">
            <div className={`space-y-8 ${PANEL} p-6 sm:p-10`}>
              <SectionHead index="08" label="For developers" title="Honest developers finally have a way to prove it." />
              <ul className="space-y-3 text-[12.5px] text-muted">
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
                <LinkButton href="/dev" variant="primary" size="sm">
                  Open the developer console
                </LinkButton>
                <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="tech inline-flex min-h-11 items-center text-[9.5px] text-muted hover:text-teal">
                  Read the contract →
                </a>
              </div>
            </div>
            <div className={`flex flex-col justify-between gap-8 ${PANEL} p-6 sm:p-10`}>
              <SectionHead index="09" label="For surveyors" title="Your sign-off, on the record." />
              <p className="text-[12.5px] text-muted">Snap the site photo on your phone. Plote checks it and you sign. Your key can only sign milestones — it can&apos;t move money.</p>
              <div className="flex flex-wrap gap-2">
                <HudTag tone="gold" className="text-[7.5px]">
                  Sign milestones
                </HudTag>
                <HudTag tone="ghost" className="text-[7.5px]">
                  Can&apos;t move money
                </HudTag>
              </div>
              <Link href="/qs" className="tech inline-flex min-h-11 items-center text-[9.5px] text-muted hover:text-teal">
                Open the surveyor app →
              </Link>
            </div>
          </div>
        </Section>

        {/* ═════════ 10 · Built on NEAR ═════════ */}
        <Section label="Built on NEAR">
          <SectionHead index="10" label="Stack" title="Built on NEAR" />
          <dl className="mt-10 grid gap-px bg-[var(--line-soft)] sm:grid-cols-2 lg:grid-cols-5">
            {[
              ["Accounts per unit", "each home is a named NEAR account."],
              ["NEAR Intents", "pay from other chains."],
              ["OutLayer", "photo checks run in secure hardware, attested on-chain."],
              ["NEAR AI Cloud", "private, verifiable stage recognition."],
              ["Holder votes", "one vote per unit, cast with the NFT."],
            ].map(([k, v], i) => (
              <div key={k} className={`${PANEL} p-5`}>
                <span className="tech text-[8.5px] text-faint tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                <dt className="tech mt-3 text-[10px] text-teal">{k}</dt>
                <dd className="mt-2 text-[12px] text-muted">— {v}</dd>
              </div>
            ))}
          </dl>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="tech mt-6 inline-flex min-h-11 items-center text-[9.5px] text-muted hover:text-teal">
            Read the build spec and code on GitHub →
          </a>
        </Section>

        {/* ═════════ 11 · Limits ═════════ */}
        <Section label="What Plote doesn't do">
          <div className="corners corners-red panel p-6 sm:p-10">
            <SectionHead index="11" label="Limits" title="What Plote doesn't do." />
            <ul className="mt-8 space-y-4 text-[12.5px] text-muted">
              {[
                "Plote is not your land title. Always check the C of O or governor's consent with a lawyer.",
                "Plote can't stop a developer who refuses to use it. Ask your developer why they don't.",
                "The surveyor is a real person. Plote checks their photos and lets holders replace them, but it doesn't remove the need for one.",
                "Today Plote works in USDC. Naira payments are on the roadmap.",
              ].map((t) => (
                <li key={t} className="flex gap-3">
                  <span className="mt-[10px] block h-px w-4 shrink-0 bg-red" aria-hidden />
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </Section>

        {/* ═════════ 12 · FAQ ═════════ */}
        <Section label="FAQ" id="faq">
          <SectionHead index="12" label="Questions" title="F.A.Q" />
          <div className="mt-10 border-b border-[var(--line)]">
            {FAQ.map(([q, a], i) => (
              <details key={q} className="group border-t border-[var(--line)]">
                <summary className="flex min-h-12 cursor-pointer items-center gap-5 py-3 hover:text-teal">
                  <span className="tech w-8 shrink-0 text-[8.5px] text-faint tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                  <span className="tech flex-1 text-[10.5px]">{q}</span>
                  <span className="tech text-[12px] text-muted transition-transform group-open:rotate-45" aria-hidden>
                    +
                  </span>
                </summary>
                <p className="pb-5 pl-[52px] text-[12.5px] text-muted">{a}</p>
              </details>
            ))}
          </div>
        </Section>

        {/* ═════════ Final CTA ═════════ */}
        <Section label="Check a unit">
          <div className="mx-auto flex max-w-2xl flex-col items-center gap-8 text-center">
            <HudTag tone="teal" className="text-[7.5px]">
              Before you pay
            </HudTag>
            <h2 className="text-text">Check a unit before you pay for it.</h2>
            <div className="w-full text-left">
              <FinalCta />
            </div>
          </div>
        </Section>
      </LandingShell>
    </main>
  );
}
