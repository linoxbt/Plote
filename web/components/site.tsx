// Marketing building blocks shared by the landing page and the standalone product pages.
// Design language: "plain numbers" — a light, calm fintech look. Pale grey page, white hairline cards with large radii,
// tight grotesk headlines (the h1's key phrase sits on a solid orange block), small uppercase mono eyebrows with a dot,
// compact pill buttons, one dark band per page at most.

import Link from "next/link";
import type { ReactNode } from "react";
import { clsx } from "clsx";
import { ArrowRight, Plus } from "lucide-react";
import { CountUp } from "./motion";

export function Container({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx("mx-auto w-full max-w-[1200px] px-4 sm:px-6 lg:px-8", className)}>{children}</div>;
}

export function Section({ children, className, id, label }: { children: ReactNode; className?: string; id?: string; label: string }) {
  return (
    <section id={id} aria-label={label} className={clsx("relative py-16 sm:py-24", className)}>
      <Container>{children}</Container>
    </section>
  );
}

/** Small uppercase mono label with a square dot: "■ HOW IT WORKS". */
export function Eyebrow({ children, tone = "accent", className }: { children: ReactNode; tone?: "accent" | "orange" | "red"; className?: string }) {
  return <p className={clsx("eyebrow", tone === "red" && "eyebrow-red", className)}>{children}</p>;
}

/** Section heading: optional eyebrow, a tight display title (wrap the key phrase in <Hl>), optional lead. */
export function Heading({
  eyebrow, title, lead, align = "left", as = "h2", className, tone,
}: { eyebrow?: ReactNode; title: ReactNode; lead?: ReactNode; align?: "left" | "center"; as?: "h1" | "h2"; className?: string; tone?: "accent" | "orange" | "red" }) {
  const H = as;
  return (
    <div data-reveal className={clsx("space-y-4", align === "center" && "mx-auto max-w-3xl text-center", className)}>
      {eyebrow ? <Eyebrow tone={tone}>{eyebrow}</Eyebrow> : null}
      <H
        className={clsx(
          as === "h1" ? "text-[42px] leading-[1.04] sm:text-[60px] lg:text-[72px] lg:leading-[1.02]" : "text-[32px] leading-[1.08] sm:text-[44px] sm:leading-[1.05]",
          align === "left" && "max-w-3xl",
        )}
      >
        {title}
      </H>
      {lead ? <p className={clsx("text-base leading-relaxed text-muted sm:text-[17px]", align === "left" ? "max-w-2xl" : "mx-auto max-w-2xl")}>{lead}</p> : null}
    </div>
  );
}

/** The key phrase of a headline: a solid orange block in an h1, orange ink elsewhere (globals.css `.hl`). */
export function Hl({ children, tone = "accent" }: { children: ReactNode; tone?: "accent" | "orange" }) {
  return <span className={tone === "orange" ? "text-orange-ink" : "hl"}>{children}</span>;
}

/** Inline long rule used inside a headline. */
export function Rule() {
  return <span aria-hidden className="mx-3 inline-block h-[2px] w-16 translate-y-[-0.3em] bg-text/80 align-middle sm:w-28" />;
}

/** A pill link. `arrow` adds the round white arrow the primary CTA carries. */
export function PillLink({
  href, children, variant = "primary", className, arrow,
}: { href: string; children: ReactNode; variant?: "primary" | "ghost" | "accent" | "ink"; className?: string; arrow?: boolean }) {
  const ext = href.startsWith("http");
  const cls = clsx("btn", `btn-${variant}`, className);
  const inner = (
    <>
      {children}
      {arrow ? (
        <span className="btn-arrow" aria-hidden>
          <ArrowRight className="h-4 w-4" strokeWidth={2} />
        </span>
      ) : null}
    </>
  );
  return ext ? (
    <a href={href} target="_blank" rel="noreferrer" className={cls}>
      {inner}
    </a>
  ) : (
    <Link href={href} className={cls}>
      {inner}
    </Link>
  );
}

export function TextLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  const ext = href.startsWith("http");
  const cls = clsx("group inline-flex min-h-11 items-center gap-2 text-sm font-medium text-text underline-offset-4 hover:text-orange-ink hover:underline", className);
  const inner = (
    <>
      {children}
      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" strokeWidth={1.75} aria-hidden />
    </>
  );
  return ext ? (
    <a href={href} target="_blank" rel="noreferrer" className={cls}>
      {inner}
    </a>
  ) : (
    <Link href={href} className={cls}>
      {inner}
    </Link>
  );
}

/** Round ink arrow button used at the foot of cards (decorative when the whole card is the link). */
export function ArrowDot({ className }: { className?: string }) {
  return (
    <span aria-hidden className={clsx("inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink text-white transition-transform group-hover:translate-x-0.5", className)}>
      <ArrowRight className="h-4 w-4" strokeWidth={2} />
    </span>
  );
}

/** Big rounded panel. accent = white card, sky = cool tint, orange = warm tint, dark = the ink band. */
export function GlowPanel({ children, tone = "accent", className }: { children: ReactNode; tone?: "accent" | "sky" | "orange" | "dark"; className?: string }) {
  return (
    <div
      data-reveal
      className={clsx(
        "relative overflow-hidden rounded-[24px]",
        tone === "dark" ? "theme-dark" : clsx("ring-1 ring-line", `glow-${tone}`),
        className,
      )}
    >
      {children}
    </div>
  );
}

/** White card with an icon tile, title, body and optional link. */
export function FeatureCard({ icon, title, children, href, cta, className }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; href?: string; cta?: string; className?: string }) {
  return (
    <div data-reveal className={clsx("group/card flex flex-col gap-4 rounded-[20px] bg-surface p-6 ring-1 ring-line transition-[box-shadow] duration-300 hover:shadow-[0_12px_32px_-16px_rgba(11,18,32,0.25)] sm:p-7", className)}>
      {icon ? <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-orange-soft text-orange-ink ring-1 ring-orange/20">{icon}</div> : null}
      <h3 className="text-xl font-medium leading-snug">{title}</h3>
      {children ? <div className="text-[15px] leading-relaxed text-muted">{children}</div> : null}
      {href ? <TextLink href={href} className="mt-auto">{cta ?? "Learn more"}</TextLink> : null}
    </div>
  );
}

/** Numbered step card. */
export function StepCard({ n, title, children, art }: { n: number; title: ReactNode; children: ReactNode; art?: ReactNode }) {
  return (
    <li data-reveal className="flex flex-col gap-4 rounded-[20px] bg-surface p-6 ring-1 ring-line sm:p-7">
      <div className="flex items-center justify-between">
        <span className="mono text-sm font-medium text-orange-ink">0{n}</span>
        {art}
      </div>
      <h3 className="text-xl font-medium leading-snug">{title}</h3>
      <div className="text-[15px] leading-relaxed text-muted">{children}</div>
    </li>
  );
}

/** Number grid with hairline dividers. */
export function StatGrid({ items, className }: { items: { label: ReactNode; value: ReactNode; hint?: ReactNode }[]; className?: string }) {
  return (
    <dl className={clsx("grid grid-cols-2 lg:grid-cols-4", className)}>
      {items.map((it, i) => (
        <div key={i} data-reveal className={clsx("flex flex-col-reverse border-line px-1 py-6 sm:px-6", i % 2 === 1 && "border-l", i >= 2 && "border-t lg:border-t-0", i > 0 && "lg:border-l")}>
          {it.hint ? <div className="mt-1 text-xs text-muted">{it.hint}</div> : null}
          <dt className="eyebrow mt-2 !text-[11px] before:hidden">{it.label}</dt>
          <dd className="text-[32px] font-medium tracking-[-0.03em] tabular-nums sm:text-[44px] sm:leading-[1.05]">{typeof it.value === "string" ? <CountUp value={it.value} /> : it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Concentric orbit diagram with labels placed around it. */
export function Orbit({ center, items, className }: { center: ReactNode; items: string[]; className?: string }) {
  const n = items.length;
  return (
    <div className={clsx("relative mx-auto aspect-square w-full max-w-[440px]", className)} aria-hidden>
      {[1, 0.72, 0.44].map((s) => (
        <div key={s} className="absolute rounded-full ring-1 ring-line-strong/70" style={{ inset: `${((1 - s) / 2) * 100}%` }} />
      ))}
      <div className="absolute inset-[38%] flex items-center justify-center rounded-full bg-surface shadow-[var(--shadow-float)] ring-1 ring-line">{center}</div>
      <div className="absolute inset-0 overflow-hidden rounded-full">
        <div className="spin-slow absolute inset-0">
          {items.map((label, i) => {
            const a = (i / n) * Math.PI * 2 - Math.PI / 2;
            const r = i % 2 ? 27 : 37;
            return (
              <span key={label} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${50 + Math.cos(a) * r}%`, top: `${50 + Math.sin(a) * r}%` }}>
                <span className="spin-slow-reverse block whitespace-nowrap rounded-full bg-surface px-3 py-1.5 text-xs font-medium text-text ring-1 ring-line">{label}</span>
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Scrolling strip of names (text only — no third-party logos). */
export function Marquee({ items }: { items: string[] }) {
  const row = [...items, ...items];
  return (
    <div className="relative overflow-hidden border-y border-line bg-surface py-4 [mask-image:linear-gradient(90deg,transparent,black_6%,black_94%,transparent)]">
      <div className="marquee gap-10 pr-10">
        {row.map((t, i) => (
          <span key={i} className="whitespace-nowrap text-[15px] text-muted" aria-hidden={i >= items.length || undefined}>
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

/** FAQ: white rounded rows with a "+" toggle. */
export function Faq({ items }: { items: [string, ReactNode][] }) {
  return (
    <div className="space-y-2.5">
      {items.map(([q, a]) => (
        <details key={q} data-reveal className="group rounded-2xl bg-surface ring-1 ring-line open:ring-line-strong">
          <summary className="flex min-h-14 cursor-pointer items-center justify-between gap-6 px-5 py-4 text-left text-[15px] font-medium sm:text-base">
            <span>{q}</span>
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-2 ring-1 ring-line">
              <Plus className="h-4 w-4 transition-transform group-open:rotate-45" strokeWidth={1.75} aria-hidden />
            </span>
          </summary>
          <div className="px-5 pb-5 pr-12 text-[15px] leading-relaxed text-muted">{a}</div>
        </details>
      ))}
    </div>
  );
}

/** Closing call-to-action band used at the bottom of every standalone page: the dark band. */
export function CtaBand({ title, lead, primary, secondary }: { title: ReactNode; lead?: ReactNode; primary: { href: string; label: string }; secondary?: { href: string; label: string } }) {
  return (
    <Section label="Get started" className="!pt-0">
      <GlowPanel tone="dark" className="px-6 py-14 sm:px-14 sm:py-20">
        <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr] lg:items-end">
          <div className="max-w-2xl space-y-4">
            <Eyebrow>Get started</Eyebrow>
            <h2 className="text-[32px] leading-[1.08] sm:text-[44px] sm:leading-[1.05]">{title}</h2>
            {lead ? <p className="text-base leading-relaxed text-muted">{lead}</p> : null}
          </div>
          <div className="flex flex-wrap gap-3 lg:justify-end">
            <PillLink href={primary.href} arrow>
              {primary.label}
            </PillLink>
            {secondary ? (
              <PillLink href={secondary.href} variant="ghost">
                {secondary.label}
              </PillLink>
            ) : null}
          </div>
        </div>
      </GlowPanel>
    </Section>
  );
}

/** Hero for standalone product pages. */
export function PageHero({ eyebrow, title, lead, actions, art, tone }: { eyebrow?: ReactNode; title: ReactNode; lead?: ReactNode; actions?: ReactNode; art?: ReactNode; tone?: "accent" | "orange" | "red" }) {
  return (
    <section aria-label="Introduction" className="relative">
      <Container className="relative grid items-center gap-12 py-14 sm:py-20 lg:grid-cols-[1.25fr_1fr]">
        <div className="space-y-7">
          <Heading as="h1" eyebrow={eyebrow} title={title} lead={lead} tone={tone} />
          {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
        </div>
        {art ? <div data-reveal className="flex justify-center lg:justify-end">{art}</div> : null}
      </Container>
    </section>
  );
}

/** Two-column feature block: copy on one side, a visual on the other. */
export function Split({ children, visual, reverse }: { children: ReactNode; visual: ReactNode; reverse?: boolean }) {
  return (
    <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-20">
      <div className={clsx("space-y-6", reverse && "lg:order-2")}>{children}</div>
      <div data-reveal className={clsx("flex justify-center", reverse && "lg:order-1")}>{visual}</div>
    </div>
  );
}

/** Line-art dial used as a centred illustration. */
export function Dial({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className="relative aspect-square w-full max-w-[340px]" aria-hidden>
      <div className="absolute inset-0 overflow-hidden rounded-full">
        <div className="spin-slow absolute inset-0 rounded-full [background:repeating-conic-gradient(rgba(11,18,32,0.16)_0deg_1deg,transparent_1deg_7.5deg)] [mask:radial-gradient(farthest-side,transparent_calc(100%-14px),black_calc(100%-13px))]" />
        <div className="absolute inset-[10%] rounded-full ring-1 ring-line-strong/70" />
        <div className="spin-slow-reverse absolute inset-[10%] rounded-full [background:conic-gradient(from_0deg,rgba(255,122,0,0.7),rgba(255,122,0,0)_22%,transparent)] [mask:radial-gradient(farthest-side,transparent_calc(100%-2px),black_calc(100%-1px))]" />
      </div>
      <div className="absolute inset-[24%] flex items-center justify-center rounded-full bg-surface shadow-[var(--shadow-float)] ring-1 ring-line">{children}</div>
      {label ? <span className="mono absolute -right-2 top-1/2 rounded-full bg-surface px-3 py-1.5 text-xs text-text ring-1 ring-line sm:-right-10">{label}</span> : null}
    </div>
  );
}

/** Kept for API compatibility: the calm theme has no floating orbs. */
export function HeroOrbs() {
  return null;
}
