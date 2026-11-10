"use client";

// Site-wide motion, Core-style: sections and cards rise in as they scroll into view (staggered),
// numbers count up when first seen. Everything is off under prefers-reduced-motion, and content is
// never hidden without JavaScript (the `motion` class on <html> is set by an inline script in the layout).

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

const SEL = "[data-reveal]:not(.is-in)";

export function MotionRoot() {
  const path = usePathname();
  useEffect(() => {
    const root = document.documentElement;
    if (!root.classList.contains("motion") || typeof IntersectionObserver === "undefined") {
      document.querySelectorAll<HTMLElement>(SEL).forEach((el) => el.classList.add("is-in"));
      return;
    }
    root.classList.add("motion-ready");
    const io = new IntersectionObserver(
      (entries) => {
        let i = 0;
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const el = e.target as HTMLElement;
          el.style.transitionDelay = `${Math.min(i++, 6) * 90}ms`;
          el.classList.add("is-in");
          io.unobserve(el);
          setTimeout(() => (el.style.transitionDelay = ""), 1400); // don't delay later hover transitions
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );
    const scan = () => document.querySelectorAll<HTMLElement>(SEL).forEach((el) => io.observe(el));
    scan();
    // Client-rendered content (live data, route changes) appears after mount.
    const mo = new MutationObserver(scan);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      io.disconnect();
      mo.disconnect();
    };
  }, [path]);
  return null;
}

/** Inline, pre-paint: opt into motion unless the visitor prefers less; if the app never boots, show everything after 4 s. */
export const MOTION_BOOT = `(function(){try{if(!matchMedia('(prefers-reduced-motion: reduce)').matches){var d=document.documentElement;d.classList.add('motion');setTimeout(function(){if(!d.classList.contains('motion-ready'))d.classList.add('motion-failsafe')},4000)}}catch(e){}})();`;

const RM = "(prefers-reduced-motion: reduce)";
function subscribeRM(cb: () => void) {
  const m = matchMedia(RM);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
}

export function usePrefersReducedMotion() {
  return useSyncExternalStore(subscribeRM, () => matchMedia(RM).matches, () => false);
}

/** Counts the first number in `value` up from zero the first time it scrolls into view ("$85,000", "≤ 10%", "66"). */
export function CountUp({ value, duration = 1200 }: { value: string; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduce = usePrefersReducedMotion();
  const m = value.match(/^(\D*?)(\d[\d,]*(?:\.\d+)?)(.*)$/);
  const [anim, setAnim] = useState<{ for: string; text: string } | null>(null);
  const shown = anim && anim.for === value ? anim.text : value;
  useEffect(() => {
    if (!m || reduce || !ref.current || typeof IntersectionObserver === "undefined") return;
    const [, pre, num, post] = m;
    const target = Number(num.replace(/,/g, ""));
    if (!Number.isFinite(target) || target === 0) return;
    const decimals = num.includes(".") ? num.split(".")[1].length : 0;
    const fmt = (n: number) => pre + n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + post;
    let raf = 0;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      const t0 = performance.now();
      const tick = (t: number) => {
        const k = Math.min(1, (t - t0) / duration);
        const eased = 1 - Math.pow(1 - k, 3);
        setAnim({ for: value, text: k < 1 ? fmt(target * eased) : value });
        if (k < 1) raf = requestAnimationFrame(tick);
      };
      setAnim({ for: value, text: fmt(0) });
      raf = requestAnimationFrame(tick);
    });
    io.observe(ref.current);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, reduce]);
  return (
    <span ref={ref} aria-label={value}>
      <span aria-hidden>{shown}</span>
    </span>
  );
}
