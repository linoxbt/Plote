"use client";

// The "instrument" layer: hairline HUD frame, boxed tags, readouts, numbered section heads,
// the generative data-field hero and the estate ring. Data is the artwork; the frame is the gallery.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { clsx } from "clsx";
import { approvedCount } from "@/lib/estate";
import { estateSlug } from "@/lib/estates";
import { formatUsd, toBig } from "@/lib/format";
import { useAllEstates, useAllMilestones } from "@/lib/hooks";
import { houseSvgDataUri } from "@/lib/svg-house";
import { ESTATES } from "@/lib/config";

// ---------------- frame ----------------

/** Site-wide hairlines at the content edges and a scroll index on the right (pointer-events: none). */
export function HudFrame() {
  return usePathname() === "/" ? null : <HudFrameLines />;
}

function HudFrameLines() {
  const [pct, setPct] = useState(0);
  useEffect(() => {
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        setPct(max > 0 ? Math.round((window.scrollY / max) * 100) : 0);
      });
    };
    on();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => {
      window.removeEventListener("scroll", on);
      window.removeEventListener("resize", on);
      cancelAnimationFrame(raf);
    };
  }, []);
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0">
      <div className="absolute inset-y-0 left-[max(12px,calc(50%-36rem-24px))] w-px bg-[var(--line-soft)]" />
      <div className="absolute inset-y-0 right-[max(12px,calc(50%-36rem-24px))] w-px bg-[var(--line-soft)]" />
      <div className="absolute inset-x-0 top-[calc(4rem+0px)] h-px bg-[var(--line-soft)]" />
      <div className="absolute right-4 top-1/2 hidden -translate-y-1/2 flex-col items-center gap-3 xl:flex">
        <span className="tech text-[10px] text-faint tabular-nums">{String(pct).padStart(2, "0")}</span>
        <span className="relative block h-28 w-px bg-[var(--line)]">
          <span className="absolute left-0 w-px bg-text transition-[top] duration-150" style={{ top: `${pct}%`, height: "14px", marginTop: "-7px" }} />
        </span>
      </div>
    </div>
  );
}

// ---------------- small parts ----------------

type TagTone = "light" | "ghost" | "teal" | "gold" | "red" | "amber";

export function HudTag({ children, tone = "light", className }: { children: ReactNode; tone?: TagTone; className?: string }) {
  return <span className={clsx("hud-tag", tone !== "light" && `hud-tag-${tone}`, className)}>{children}</span>;
}

/** A boxed label over a big thin number, like a gallery's "TOTAL EDITIONS / 18.632". */
export function Readout({
  label, value, loading, align = "left", size = "lg", tone = "light", foot,
}: {
  label: string; value: ReactNode; loading?: boolean; align?: "left" | "right"; size?: "md" | "lg" | "xl"; tone?: TagTone; foot?: ReactNode;
}) {
  return (
    <div className={clsx("flex flex-col gap-2", align === "right" && "items-end text-right")}>
      <HudTag tone={tone}>{label}</HudTag>
      <div
        className={clsx(
          "readout text-text",
          size === "md" && "text-2xl sm:text-3xl",
          size === "lg" && "text-3xl sm:text-[40px]",
          size === "xl" && "text-4xl sm:text-[56px]",
        )}
        aria-busy={loading || undefined}
      >
        {loading ? <span className="skeleton inline-block h-8 w-20 align-middle" /> : value}
      </div>
      {foot ? <div className="text-xs text-muted">{foot}</div> : null}
    </div>
  );
}

/** Numbered section head: "01 ─── THE PROBLEM" then a thin display title. */
export function SectionHead({
  index, label, title, lead, id, className,
}: { index: string; label: string; title: ReactNode; lead?: ReactNode; id?: string; className?: string }) {
  return (
    <header className={clsx("space-y-5", className)}>
      <div className="flex items-center gap-4">
        <span className="tech text-[11px] text-teal tabular-nums">{index}</span>
        <span className="h-px w-10 bg-[var(--line)]" />
        <span className="tech text-[11px] text-muted">{label}</span>
      </div>
      <h2 id={id} className="max-w-3xl text-[30px] text-text sm:text-[44px]">
        {title}
      </h2>
      {lead ? <p className="max-w-2xl text-lg text-muted">{lead}</p> : null}
    </header>
  );
}

// ---------------- generative data field (hero) ----------------

const PALETTE = ["#2dd4bf", "#8b7cf6", "#e8b04b", "#f06a9a", "#4f7cff", "#e8eaf4"];

/** A flow-field "data painting" on a 2D canvas: thousands of short strokes following a slowly
 * shifting field. Cheap enough for phones; pauses off-screen and when the tab is hidden;
 * draws one still frame under prefers-reduced-motion. */
export function DataField({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    let w = 0;
    let h = 0;
    let t = Math.random() * 100;
    type P = { x: number; y: number; life: number; c: string; s: number };
    let ps: P[] = [];
    const spawn = (): P => ({
      x: Math.random() * w,
      y: Math.random() * h,
      life: 60 + Math.random() * 140,
      c: PALETTE[Math.floor(Math.random() * PALETTE.length)],
      s: 0.6 + Math.random() * 1.4,
    });
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      w = Math.max(1, Math.floor(r.width));
      h = Math.max(1, Math.floor(r.height));
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#03040c";
      ctx.fillRect(0, 0, w, h);
      const n = Math.round(Math.min(2200, (w * h) / 520));
      ps = Array.from({ length: n }, spawn);
    };
    const angle = (x: number, y: number) =>
      (Math.sin(x * 0.0031 + t * 0.55) + Math.cos(y * 0.0042 - t * 0.35) + Math.sin((x + y) * 0.0016 + t * 0.2)) * Math.PI * 0.9;
    const step = () => {
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "rgba(3,4,12,0.045)";
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";
      ctx.lineWidth = 1.15;
      for (const p of ps) {
        const a = angle(p.x, p.y);
        const nx = p.x + Math.cos(a) * p.s * 1.6;
        const ny = p.y + Math.sin(a) * p.s * 1.6;
        ctx.strokeStyle = p.c;
        ctx.globalAlpha = 0.42;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(nx, ny);
        ctx.stroke();
        p.x = nx;
        p.y = ny;
        p.life -= 1;
        if (p.life <= 0 || p.x < -5 || p.y < -5 || p.x > w + 5 || p.y > h + 5) Object.assign(p, spawn());
      }
      ctx.globalAlpha = 1;
      t += 0.0035;
    };
    resize();
    let raf = 0;
    let visible = true;
    const loop = () => {
      step();
      raf = requestAnimationFrame(loop);
    };
    if (reduce) {
      for (let i = 0; i < 260; i++) step();
    } else {
      raf = requestAnimationFrame(loop);
    }
    const io = new IntersectionObserver(([e]) => {
      const v = e.isIntersecting && document.visibilityState === "visible";
      if (reduce || v === visible) return;
      visible = v;
      cancelAnimationFrame(raf);
      if (v) raf = requestAnimationFrame(loop);
    });
    io.observe(canvas);
    const onVis = () => {
      if (reduce) return;
      cancelAnimationFrame(raf);
      if (document.visibilityState === "visible") raf = requestAnimationFrame(loop);
    };
    document.addEventListener("visibilitychange", onVis);
    let rt: ReturnType<typeof setTimeout> | undefined;
    const onResize = () => {
      clearTimeout(rt);
      rt = setTimeout(() => {
        resize();
        if (reduce) for (let i = 0; i < 260; i++) step();
      }, 150);
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("resize", onResize);
      clearTimeout(rt);
    };
  }, []);
  return <canvas ref={ref} className={clsx("block h-full w-full", className)} aria-hidden />;
}

// ---------------- estate ring ("collections") ----------------

export type RingItem = { account: string; slug: string; name: string; location: string; units: number | null; escrow: bigint | null; approved: number; total: number };

function titleFromSlug(slug: string) {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function useRingItems(): RingItem[] {
  const estates = useAllEstates();
  const ms = useAllMilestones();
  return ESTATES.map((account, i) => {
    const e = estates[i]?.q.data;
    const m = ms[i]?.q.data;
    const slug = estateSlug(account);
    return {
      account,
      slug,
      name: e?.name ?? (slug === "playground" ? "Plote Playground" : titleFromSlug(slug)),
      location: e?.location ?? "",
      units: e ? e.unit_count : null,
      escrow: e ? toBig(e.totals.in_escrow) : null,
      approved: approvedCount(m),
      total: m?.length ?? 4,
    };
  });
}

function RingCard({ it, tabIndex }: { it: RingItem; tabIndex?: number }) {
  const art = houseSvgDataUri({
    estateName: it.name,
    unitLabel: it.slug === "playground" ? "P-01" : "A-4B",
    unitId: it.slug === "playground" ? "p-01" : "a-4b",
    approvedCount: it.approved,
    total: it.total,
    status: "Allocated",
    paid: "0",
    price: "0",
  });
  return (
    <Link
      href={`/estates/${it.slug}`}
      tabIndex={tabIndex}
      className="group corners corners-hover panel block w-[240px] p-3 transition-colors"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[15px] uppercase leading-tight tracking-[0.08em] text-text [font-family:var(--font-tech)]">{it.name}</p>
        <span className="tech shrink-0 text-[9px] text-faint">{it.approved}/{it.total}</span>
      </div>
      <img src={art} alt="" width={300} height={330} className="mt-3 aspect-[300/330] w-full opacity-90 transition-opacity group-hover:opacity-100" />
      <div className="mt-3 flex flex-wrap gap-1.5">
        <HudTag tone="ghost">{it.units === null ? "— units" : `${it.units} units`}</HudTag>
        <HudTag tone="ghost">{it.escrow === null ? "— escrow" : `${formatUsd(it.escrow)}`}</HudTag>
      </div>
    </Link>
  );
}

const RM = "(prefers-reduced-motion: reduce)";
function useReducedMotionPref() {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(RM);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(RM).matches,
    () => false,
  );
}

/** Estates on a slowly orbiting ring (desktop), a swipeable row on small screens / reduced motion. */
export function EstateRing() {
  const items = useRingItems();
  const reduce = useReducedMotionPref();
  // Fill the ring with repeats so it reads as a ring; repeats are decorative and skipped by assistive tech.
  const slots = Math.max(8, items.length);
  const ring = Array.from({ length: slots }, (_, i) => ({ it: items[i % items.length] }));
  const r = 500;
  return (
    <div>
      {/* row: phones + reduced motion */}
      <ul className={clsx("-mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-2", !reduce && "lg:hidden")}>
        {items.map((it) => (
          <li key={it.account} className="snap-start">
            <RingCard it={it} />
          </li>
        ))}
      </ul>
      {/* ring: desktop */}
      {!reduce ? (
        <div className="relative hidden h-[580px] lg:block [perspective:1600px]" aria-hidden>
          <div
            className="absolute left-1/2 top-12 h-[470px] w-[240px] -translate-x-1/2 [transform-style:preserve-3d] hover:[animation-play-state:paused]"
            style={{ ["--r" as string]: `${r}px`, animation: "orbit 80s linear infinite" }}
          >
            {ring.map(({ it }, i) => (
              <div
                key={i}
                className="absolute inset-x-0 top-0 [backface-visibility:hidden]"
                style={{ transform: `rotateY(${(360 / slots) * i}deg) translateZ(${r}px)` }}
              >
                <RingCard it={it} tabIndex={-1} />
              </div>
            ))}
          </div>
          <div className="rings pointer-events-none absolute inset-x-0 bottom-0 h-56" />
        </div>
      ) : null}
      {/* accessible list for the ring */}
      {!reduce ? (
        <ul className="sr-only">
          {items.map((it) => (
            <li key={it.account}>
              <Link href={`/estates/${it.slug}`}>{it.name}</Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
