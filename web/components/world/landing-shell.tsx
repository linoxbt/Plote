"use client";

// Client shell for the immersive landing: fixed WebGL world, Lenis smooth (inertial) scrolling,
// the gallery-style vertical nav on the left and the scroll index on the right.

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Lenis from "lenis";
import { clsx } from "clsx";
import { formatUsd } from "@/lib/format";
import { houseSvgDataUri } from "@/lib/svg-house";
import { useRingItems } from "../hud";
import type { HelixCard, World } from "./world";
import { collectReveal, collectStages, measure } from "./stages";
import { Cursor, Preloader, useMagnetic } from "./fx";

type WorldState = "loading" | "ready" | "failed";
const Ctx = createContext<WorldState>("loading");
export const useWorldState = () => useContext(Ctx);

const UNIT_LABELS = ["A-4B", "B-2C", "C-1A", "A-7D"];

function useHelixCards(): HelixCard[] {
  const items = useRingItems();
  return useMemo(() => {
    if (!items.length) return [];
    const out: HelixCard[] = [];
    const rounds = Math.max(1, Math.ceil(12 / items.length));
    for (let r = 0; r < rounds; r++) {
      items.forEach((it, i) => {
        const unit = it.slug === "playground" ? `P-0${r + 1}` : UNIT_LABELS[(r + i) % UNIT_LABELS.length];
        out.push({
          title: it.name,
          sub: it.pending ? "Awaiting deployment" : `${it.approved}/${it.total} stages proven`,
          meta: it.pending ? "Fills in from the chain once live" : `${it.units === null ? "—" : it.units} units · ${it.escrow === null ? "—" : formatUsd(it.escrow)} in escrow`,
          tag: unit,
          href: `/estates/${it.slug}`,
          art: houseSvgDataUri({
            estateName: it.name,
            unitLabel: unit,
            unitId: unit.toLowerCase(),
            approvedCount: it.approved,
            total: it.total,
            status: "Allocated",
            paid: "0",
            price: "0",
          }),
        });
      });
    }
    return out.slice(0, 12);
  }, [items]);
}

const SECTIONS = [
  { id: "top", label: "Home" },
  { id: "how", label: "How it works" },
  { id: "estates", label: "Estates" },
  { id: "proof", label: "Data points" },
  { id: "faq", label: "F.A.Q" },
];

function SideNav({ lenis }: { lenis: React.RefObject<Lenis | null> }) {
  const [active, setActive] = useState("top");
  const [pct, setPct] = useState(0);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const mid = window.innerHeight * 0.4;
      let cur = "top";
      for (const s of SECTIONS) {
        const el = document.getElementById(s.id);
        if (el && el.getBoundingClientRect().top <= mid) cur = s.id;
      }
      setActive((a) => (a === cur ? a : cur));
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const v = max > 0 ? Math.round((window.scrollY / max) * 100) : 0;
      setPct((p) => (p === v ? p : v));
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, []);
  const go = (id: string) => (e: React.MouseEvent) => {
    const el = document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    if (lenis.current) lenis.current.scrollTo(el, { duration: 2.2 });
    else el.scrollIntoView({ behavior: "smooth" });
  };
  return (
    <>
      <nav aria-label="Sections" className="fixed left-5 top-1/2 z-40 hidden -translate-y-1/2 lg:block">
        <ul className="space-y-3">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                onClick={go(s.id)}
                aria-current={active === s.id ? "true" : undefined}
                className={clsx("tech inline-flex items-center gap-2 text-[9.5px] transition-colors hover:text-text", active === s.id ? "text-text" : "text-muted/80")}
              >
                {s.label}
                {active === s.id ? <span className="inline-block h-2.5 w-px bg-text" aria-hidden /> : null}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div aria-hidden className="pointer-events-none fixed right-5 top-1/2 z-40 hidden -translate-y-1/2 items-center gap-3 lg:flex">
        <span className="tech text-[8.5px] text-faint tabular-nums">{pct}</span>
        <span className="relative block h-24 w-px bg-[var(--line)]">
          <span className="absolute left-0 h-4 w-px bg-text" style={{ top: `calc(${pct}% - 8px)` }} />
        </span>
      </div>
    </>
  );
}

/** Hairline grid with tick marks, fixed over the field (gallery "guide lines"). */
function GuideGrid() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[2]">
      {["8%", "92%"].map((x) => (
        <div key={x} className="absolute inset-y-0 w-px bg-[rgba(140,160,255,0.07)]" style={{ left: x }} />
      ))}
      {["16%", "84%"].map((y) => (
        <div key={y} className="absolute inset-x-0 h-px bg-[rgba(140,160,255,0.07)]" style={{ top: y }} />
      ))}
      {["8%", "92%"].flatMap((x) =>
        ["16%", "84%"].map((y) => (
          <span key={x + y} className="absolute block h-[9px] w-[9px] -translate-x-1/2 -translate-y-1/2" style={{ left: x, top: y }}>
            <span className="absolute left-1/2 top-0 h-full w-px bg-[rgba(200,210,255,0.35)]" />
            <span className="absolute left-0 top-1/2 h-px w-full bg-[rgba(200,210,255,0.35)]" />
          </span>
        )),
      )}
    </div>
  );
}

export function LandingShell({ children }: { children: ReactNode }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const world = useRef<World | null>(null);
  const lenis = useRef<Lenis | null>(null);
  const [state, setState] = useState<WorldState>("loading");
  const router = useRouter();
  const cards = useHelixCards();
  useMagnetic();
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  // smooth, inertial scroll for the whole landing
  useEffect(() => {
    const l = new Lenis({ lerp: 0.07, wheelMultiplier: 0.85, smoothWheel: true, anchors: true });
    lenis.current = l;
    let raf = 0;
    const tick = (t: number) => {
      l.raf(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    document.documentElement.classList.add("lenis-on");
    return () => {
      cancelAnimationFrame(raf);
      l.destroy();
      lenis.current = null;
      document.documentElement.classList.remove("lenis-on");
    };
  }, []);

  // the WebGL world (three.js is loaded on demand)
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const probe = document.createElement("canvas");
        if (!probe.getContext("webgl2") && !probe.getContext("webgl")) throw new Error("no webgl");
        const { World } = await import("./world");
        if (dead || !canvas.current) return;
        const w = new World(canvas.current, { onNavigate: (href) => routerRef.current.push(href) });
        world.current = w;
        w.attach(collectStages(), collectReveal());
        setState("ready");
      } catch {
        if (!dead) setState("failed");
      }
    })();
    return () => {
      dead = true;
      world.current?.dispose();
      world.current = null;
    };
  }, []);

  useEffect(() => {
    if (state === "ready") void world.current?.setCards(cards);
  }, [cards, state]);

  // without WebGL the HTML overlays still follow the scroll
  useEffect(() => {
    if (state !== "failed") return;
    const stages = collectStages();
    const reveal = collectReveal();
    let raf = 0;
    const tick = () => {
      measure(stages, reveal);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [state]);

  return (
    <Ctx.Provider value={state}>
      <div className="landing relative">
        <canvas ref={canvas} aria-hidden className={clsx("pointer-events-none fixed inset-0 z-0 h-full w-full transition-opacity duration-1000", state === "ready" ? "opacity-100" : "opacity-0")} />
        <Preloader ready={state !== "loading"} />
        <Cursor />
        <GuideGrid />
        <SideNav lenis={lenis} />
        <div className="relative z-[3]">{children}</div>
      </div>
    </Ctx.Provider>
  );
}

/** Renders its children only when the WebGL world could not start (old GPUs, blocked WebGL). */
export function WorldFallback({ children }: { children: ReactNode }) {
  return useWorldState() === "failed" ? <>{children}</> : null;
}

/** Real links for the estate plates drawn in WebGL (keyboard and screen readers). */
export function EstateLinks() {
  const items = useRingItems();
  return (
    <ul className="sr-only">
      {items.map((it) => (
        <li key={it.account}>
          <a href={`/estates/${it.slug}`}>{it.name}</a>
        </li>
      ))}
    </ul>
  );
}
