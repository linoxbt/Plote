"use client";

// Signature interactions for the landing: intro loader, kinetic headline, contextual cursor,
// scroll-linked marquee and magnetic buttons. All degrade to plain, readable HTML without JS.

import { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";

// ---------------- kinetic headline ----------------

/** Characters rise out of blur, one after another (fast: the headline is readable within ~0.8s).
 * The accessible name is the plain sentence. */
export function KineticTitle({ text, className }: { text: string; className?: string }) {
  let i = 0;
  return (
    <h1 className={clsx("kinetic", className)} aria-label={text}>
      {text.split(" ").map((w, wi) => (
        <span key={wi} className="inline-block whitespace-nowrap" aria-hidden>
          {Array.from(w).map((c) => (
            <span key={i} className="ch inline-block" style={{ ["--i" as string]: i++ }}>
              {c}
            </span>
          ))}
          {wi < text.split(" ").length - 1 ? <span className="inline-block">&nbsp;</span> : null}
        </span>
      ))}
    </h1>
  );
}

// ---------------- cursor ----------------

/** A dot that tracks the pointer and a ring that follows with lag; the ring grows on links and
 * shows a label over the estate plates. Fine pointers only. */
export function Cursor() {
  const dot = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const [label, setLabel] = useState<string | null>(null);
  const [hot, setHot] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(pointer: fine)");
    if (!mq.matches) return;
    document.documentElement.classList.add("cursor-on");
    let x = innerWidth / 2, y = innerHeight / 2, rx = x, ry = y;
    let raf = 0;
    const move = (e: PointerEvent) => {
      x = e.clientX;
      y = e.clientY;
      const t = e.target as Element | null;
      setHot(!!t?.closest?.("a,button,summary,[role=button],input,label"));
    };
    const onLabel = (e: Event) => setLabel((e as CustomEvent<string | null>).detail);
    const tick = () => {
      rx += (x - rx) * 0.16;
      ry += (y - ry) * 0.16;
      if (dot.current) dot.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      if (ring.current) ring.current.style.transform = `translate3d(${rx}px, ${ry}px, 0)`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("plote:cursor", onLabel);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("plote:cursor", onLabel);
      document.documentElement.classList.remove("cursor-on");
    };
  }, []);
  return (
    <div aria-hidden className="pointer-events-none fixed left-0 top-0 z-[90] hidden [@media(pointer:fine)]:block">
      <div ref={dot} className="absolute -left-[3px] -top-[3px] h-1.5 w-1.5 rounded-full bg-text mix-blend-difference" />
      <div ref={ring} className="absolute left-0 top-0">
        <div
          className={clsx(
            "flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border transition-[width,height,background-color,border-color] duration-300",
            label ? "h-20 w-20 border-teal bg-teal/10" : hot ? "h-12 w-12 border-text/70 bg-text/5" : "h-8 w-8 border-text/35",
          )}
        >
          {label ? <span className="tech text-[8.5px] text-teal">{label}</span> : null}
        </div>
      </div>
    </div>
  );
}

// ---------------- marquee ----------------

/** Giant outline type sliding with the scroll (and skewing with its speed), two rows opposed. */
export function Marquee({ rows }: { rows: string[] }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    let last = window.scrollY;
    let skew = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const el = root.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.bottom < -200 || r.top > innerHeight + 200) return;
      const y = window.scrollY;
      skew += (Math.max(-12, Math.min(12, (y - last) * 0.25)) - skew) * 0.12;
      last = y;
      const p = (innerHeight - r.top) / (innerHeight + r.height);
      el.querySelectorAll<HTMLElement>("[data-row]").forEach((row, i) => {
        const dir = i % 2 ? 1 : -1;
        row.style.transform = `translate3d(${dir * (p * 38 - 19) - (i % 2 ? 30 : 0)}%, 0, 0) skewX(${(-skew * dir).toFixed(2)}deg)`;
      });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div ref={root} aria-hidden className="relative overflow-hidden py-10 sm:py-16">
      {rows.map((t, i) => (
        <div key={i} data-row className="marquee-row whitespace-nowrap will-change-transform">
          {`${t} · `.repeat(4)}
        </div>
      ))}
    </div>
  );
}

// ---------------- magnetic ----------------

/** Elements marked [data-magnetic] lean toward the pointer when it comes near. */
export function useMagnetic() {
  useEffect(() => {
    if (!window.matchMedia("(pointer: fine)").matches) return;
    const els = Array.from(document.querySelectorAll<HTMLElement>("[data-magnetic]"));
    const offs = els.map((el) => {
      const move = (e: PointerEvent) => {
        const r = el.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        el.style.transform = `translate3d(${dx * 0.28}px, ${dy * 0.38}px, 0)`;
      };
      const leave = () => {
        el.style.transform = "";
      };
      el.style.transition = "transform 450ms cubic-bezier(.2,.7,0,1)";
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerleave", leave);
      return () => {
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerleave", leave);
      };
    });
    return () => offs.forEach((f) => f());
  }, []);
}
