// Marketing building blocks shared by the landing page and the standalone product pages.
// Design language inspired by coredao.org: light Lexend display type with one highlighted word, pill buttons,
// soft gold/slate glow panels, rounded dark cards, hairline stat grids, orbit diagrams and "+" FAQ rows.

import Link from "next/link";
import type { ReactNode } from "react";
import { clsx } from "clsx";
import { ArrowRight, Plus } from "lucide-react";

export function Container({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx("mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8", className)}>{children}</div>;
}

export function Section({ children, className, id, label }: { children: ReactNode; className?: string; id?: string; label: string }) {
  return (
    <section id={id} aria-label={label} className={clsx("relative py-20 sm:py-28", className)}>
      <Container>{children}</Container>
    </section>
  );
}

export function Eyebrow({ children, tone = "gold" }: { children: ReactNode; tone?: "gold" | "teal" | "red" }) {
  const dot = tone === "teal" ? "bg-teal" : tone === "red" ? "bg-red" : "bg-gold";
  return (
    <p className="inline-flex items-center gap-2 rounded-full bg-white/[0.05] px-3 py-1.5 text-xs text-muted ring-1 ring-white/10">
      <span className={clsx("h-1.5 w-1.5 rounded-full", dot)} aria-hidden />
      {children}
    </p>
  );
}

/** Section heading: optional eyebrow pill, a light display title (wrap the key word in <Hl>), optional lead. */
export function Heading({
  eyebrow, title, lead, align = "left", as = "h2", className, tone,
}: { eyebrow?: ReactNode; title: ReactNode; lead?: ReactNode; align?: "left" | "center"; as?: "h1" | "h2"; className?: string; tone?: "gold" | "teal" | "red" }) {
  const H = as;
  return (
    <div className={clsx("space-y-5", align === "center" && "mx-auto max-w-3xl text-center", className)}>
      {eyebrow ? <Eyebrow tone={tone}>{eyebrow}</Eyebrow> : null}
      <H className={clsx(as === "h1" ? "text-[40px] leading-[1.05] sm:text-[64px]" : "text-[32px] sm:text-[48px]", align === "left" && "max-w-3xl")}>{title}</H>
      {lead ? <p className={clsx("text-base text-muted sm:text-lg", align === "left" ? "max-w-2xl" : "mx-auto max-w-2xl")}>{lead}</p> : null}
    </div>
  );
}

export function Hl({ children, tone = "gold" }: { children: ReactNode; tone?: "gold" | "teal" }) {
  return <span className={tone === "teal" ? "text-teal" : "hl"}>{children}</span>;
}

/** Inline long rule used inside a hero headline ("Stake Bitcoin ——— Explore…"). */
export function Rule() {
  return <span aria-hidden className="mx-3 inline-block h-[2px] w-16 translate-y-[-0.3em] bg-text/80 align-middle sm:w-28" />;
}

export function PillLink({ href, children, variant = "primary", className }: { href: string; children: ReactNode; variant?: "primary" | "ghost" | "gold"; className?: string }) {
  const ext = href.startsWith("http");
  const cls = clsx("btn", `btn-${variant}`, className);
  return ext ? (
    <a href={href} target="_blank" rel="noreferrer" className={cls}>
      {children}
    </a>
  ) : (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}

export function TextLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  const ext = href.startsWith("http");
  const cls = clsx("group inline-flex min-h-11 items-center gap-2 text-sm text-text underline-offset-4 hover:underline", className);
  const inner = (
    <>
      {children}
      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" strokeWidth={1.5} aria-hidden />
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

/** Big rounded gradient panel (Core's "Satoshi Plus" / community cards). */
export function GlowPanel({ children, tone = "gold", className }: { children: ReactNode; tone?: "gold" | "slate" | "teal"; className?: string }) {
  return <div className={clsx("relative overflow-hidden rounded-[28px] ring-1 ring-white/10", `glow-${tone}`, className)}>{children}</div>;
}

/** Dark card with an icon tile, title, body and optional link. */
export function FeatureCard({ icon, title, children, href, cta, className }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; href?: string; cta?: string; className?: string }) {
  return (
    <div className={clsx("flex flex-col gap-4 rounded-3xl bg-surface p-6 ring-1 ring-white/[0.08] transition-colors hover:ring-white/20 sm:p-7", className)}>
      {icon ? <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.05] text-gold ring-1 ring-white/10">{icon}</div> : null}
      <h3 className="text-xl">{title}</h3>
      {children ? <div className="text-[15px] text-muted">{children}</div> : null}
      {href ? <TextLink href={href} className="mt-auto">{cta ?? "Learn more"}</TextLink> : null}
    </div>
  );
}

/** Numbered step card. */
export function StepCard({ n, title, children, art }: { n: number; title: ReactNode; children: ReactNode; art?: ReactNode }) {
  return (
    <li className="flex flex-col gap-4 rounded-3xl bg-surface p-6 ring-1 ring-white/[0.08] sm:p-7">
      <div className="flex items-center justify-between">
        <span className="mono text-sm text-gold">0{n}</span>
        {art}
      </div>
      <h3 className="text-xl">{title}</h3>
      <div className="text-[15px] text-muted">{children}</div>
    </li>
  );
}

/** "Plote in numbers"-style grid with hairline dividers. */
export function StatGrid({ items, className }: { items: { label: ReactNode; value: ReactNode; hint?: ReactNode }[]; className?: string }) {
  return (
    <dl className={clsx("grid grid-cols-2 lg:grid-cols-4", className)}>
      {items.map((it, i) => (
        <div key={i} className={clsx("border-white/10 px-1 py-6 sm:px-6", i % 2 === 1 && "border-l", i >= 2 && "border-t lg:border-t-0", i > 0 && "lg:border-l")}>
          <dd className="mono text-[30px] font-normal tabular-nums sm:text-[40px]">{it.value}</dd>
          <dt className="mt-1 text-sm text-muted">{it.label}</dt>
          {it.hint ? <div className="mt-1 text-xs text-muted">{it.hint}</div> : null}
        </div>
      ))}
    </dl>
  );
}

/** Concentric orbit diagram with labels placed around it (Core's ecosystem graphic). */
export function Orbit({ center, items, className }: { center: ReactNode; items: string[]; className?: string }) {
  const n = items.length;
  return (
    <div className={clsx("relative mx-auto aspect-square w-full max-w-[460px]", className)} aria-hidden>
      {[1, 0.72, 0.44].map((s) => (
        <div key={s} className="absolute rounded-full ring-1 ring-white/10" style={{ inset: `${((1 - s) / 2) * 100}%` }} />
      ))}
      <div className="absolute inset-[38%] flex items-center justify-center rounded-full bg-surface ring-1 ring-white/15">{center}</div>
      {items.map((label, i) => {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2;
        const r = i % 2 ? 33 : 44; // keep labels inside the box on narrow screens
        return (
          <span
            key={label}
            className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full bg-surface-2 px-3 py-1.5 text-xs text-text ring-1 ring-white/15"
            style={{ left: `${50 + Math.cos(a) * r}%`, top: `${50 + Math.sin(a) * r}%` }}
          >
            {label}
          </span>
        );
      })}
    </div>
  );
}

/** Scrolling strip of names (text only — no third-party logos). */
export function Marquee({ items }: { items: string[] }) {
  const row = [...items, ...items];
  return (
    <div className="relative overflow-hidden border-y border-white/[0.06] py-6 [mask-image:linear-gradient(90deg,transparent,black_10%,black_90%,transparent)]">
      <div className="marquee gap-12 pr-12">
        {row.map((t, i) => (
          <span key={i} className="whitespace-nowrap text-lg text-muted" aria-hidden={i >= items.length || undefined}>
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

/** FAQ list with "+" toggles and hairline dividers. */
export function Faq({ items }: { items: [string, ReactNode][] }) {
  return (
    <div className="divide-y divide-white/10 border-y border-white/10">
      {items.map(([q, a]) => (
        <details key={q} className="group">
          <summary className="flex min-h-16 cursor-pointer items-center justify-between gap-6 py-5 text-left text-[17px] sm:text-lg">
            <span>{q}</span>
            <Plus className="h-5 w-5 shrink-0 text-gold transition-transform group-open:rotate-45" strokeWidth={1.5} aria-hidden />
          </summary>
          <div className="pb-6 pr-10 text-[15px] text-muted">{a}</div>
        </details>
      ))}
    </div>
  );
}

/** Closing call-to-action band used at the bottom of every standalone page. */
export function CtaBand({ title, lead, primary, secondary }: { title: ReactNode; lead?: ReactNode; primary: { href: string; label: string }; secondary?: { href: string; label: string } }) {
  return (
    <Section label="Get started" className="!pt-0">
      <GlowPanel tone="gold" className="px-6 py-14 sm:px-14 sm:py-20">
        <div className="max-w-2xl space-y-5">
          <h2 className="text-[30px] sm:text-[44px]">{title}</h2>
          {lead ? <p className="text-base text-text/80 sm:text-lg">{lead}</p> : null}
          <div className="flex flex-wrap gap-3 pt-2">
            <PillLink href={primary.href}>{primary.label}</PillLink>
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
export function PageHero({ eyebrow, title, lead, actions, art, tone }: { eyebrow?: ReactNode; title: ReactNode; lead?: ReactNode; actions?: ReactNode; art?: ReactNode; tone?: "gold" | "teal" | "red" }) {
  return (
    <section aria-label="Introduction" className="hero-glow relative overflow-hidden">
      <Container className="grid items-center gap-12 py-20 sm:py-28 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-7">
          <Heading as="h1" eyebrow={eyebrow} title={title} lead={lead} tone={tone} />
          {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
        </div>
        {art ? <div className="flex justify-center lg:justify-end">{art}</div> : null}
      </Container>
    </section>
  );
}

/** Two-column feature block: copy on one side, a visual on the other. */
export function Split({ children, visual, reverse }: { children: ReactNode; visual: ReactNode; reverse?: boolean }) {
  return (
    <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-20">
      <div className={clsx("space-y-6", reverse && "lg:order-2")}>{children}</div>
      <div className={clsx("flex justify-center", reverse && "lg:order-1")}>{visual}</div>
    </div>
  );
}

/** Line-art dial used as a centred illustration (Core's timelock dial). */
export function Dial({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className="relative aspect-square w-full max-w-[360px]" aria-hidden>
      <div className="absolute inset-0 rounded-full [background:repeating-conic-gradient(rgba(255,255,255,0.18)_0deg_1deg,transparent_1deg_7.5deg)] [mask:radial-gradient(farthest-side,transparent_calc(100%-14px),black_calc(100%-13px))]" />
      <div className="absolute inset-[10%] rounded-full ring-1 ring-white/10" />
      <div className="absolute inset-[24%] flex items-center justify-center rounded-full bg-surface ring-1 ring-white/15">{children}</div>
      <div className="absolute left-1/2 top-0 h-3 w-16 -translate-x-1/2 rounded-full bg-gradient-to-r from-ember to-gold blur-[1px]" />
      {label ? <span className="absolute -right-2 top-1/2 rounded-full bg-surface-2 px-3 py-1.5 text-xs text-text ring-1 ring-white/15 sm:-right-10">{label}</span> : null}
    </div>
  );
}
