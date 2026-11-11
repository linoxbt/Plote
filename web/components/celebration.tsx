"use client";

// C7 milestone celebration + the NFT reveal on purchase. The only big animation; respects reduced motion.

import { useMemo, type CSSProperties } from "react";
import { X } from "lucide-react";
import type { HouseSvgInput } from "@/lib/svg-house";
import { HouseNFT } from "./house-nft";
import { usePrefersReducedMotion } from "./motion";

// Brand tokens (globals.css): orange, highlight orange, sky, white.
const COLORS = ["var(--orange)", "var(--accent)", "var(--sky)", "var(--text)"];

/** CSS-only confetti (`.confetti-bit` in globals.css); not rendered at all under reduced motion. */
function Confetti() {
  const reduce = usePrefersReducedMotion();
  const bits = useMemo(
    () => Array.from({ length: 36 }, (_, i) => ({ i, x: (i * 37) % 100, d: 1.6 + ((i * 13) % 10) / 10, r: (i * 47) % 360, c: COLORS[i % COLORS.length] })),
    [],
  );
  if (reduce) return null;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {bits.map((b) => (
        <span
          key={b.i}
          className="confetti-bit absolute top-0 block h-2 w-1.5"
          style={{ left: `${b.x}%`, background: b.c, "--dur": `${b.d}s`, "--delay": `${(b.i % 6) * 0.08}s`, "--rot": `${b.r + 360}deg` } as CSSProperties}
        />
      ))}
    </div>
  );
}

/** The token flips in (`.nft-reveal`, motion only). */
export function NftReveal(props: HouseSvgInput) {
  return (
    <div className="nft-reveal corners corners-accent mx-auto max-w-xs p-2">
      <HouseNFT {...props} />
    </div>
  );
}

export function Celebration({ open, onClose, title, sub, house, share }: {
  open: boolean; onClose: () => void; title: string; sub: string; house: HouseSvgInput; share?: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fade-in fixed inset-0 z-[80] flex items-center justify-center bg-bg/95 p-4">
      <Confetti />
      <button type="button" onClick={onClose} className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center text-muted hover:text-text" aria-label="Close">
        <X className="h-6 w-6" aria-hidden />
      </button>
      <div className="relative max-w-md space-y-6 text-center">
        <NftReveal {...house} />
        <h2 className="font-display text-4xl font-normal text-accent">{title}</h2>
        <p className="text-lg text-muted">{sub}</p>
        <div className="flex flex-wrap justify-center gap-2">{share}</div>
      </div>
    </div>
  );
}
