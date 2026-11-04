"use client";

// C7 milestone celebration + the NFT reveal on purchase. The only big animation; respects reduced motion.

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useMemo } from "react";
import { X } from "lucide-react";
import type { HouseSvgInput } from "@/lib/svg-house";
import { HouseNFT } from "./house-nft";

const COLORS = ["#2DD4BF", "#E8B04B", "#E9ECEF", "#134E48"];

function Confetti() {
  const reduce = useReducedMotion();
  const bits = useMemo(
    () => Array.from({ length: 36 }, (_, i) => ({ i, x: (i * 37) % 100, d: 1.6 + ((i * 13) % 10) / 10, r: (i * 47) % 360, c: COLORS[i % COLORS.length] })),
    [],
  );
  if (reduce) return null;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {bits.map((b) => (
        <motion.span
          key={b.i}
          className="absolute top-0 block h-2 w-1.5"
          style={{ left: `${b.x}%`, background: b.c }}
          initial={{ y: -20, rotate: 0, opacity: 1 }}
          animate={{ y: "100vh", rotate: b.r + 360, opacity: 0.2 }}
          transition={{ duration: b.d, ease: "easeIn", delay: (b.i % 6) * 0.08 }}
        />
      ))}
    </div>
  );
}

export function NftReveal(props: HouseSvgInput) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, scale: 0.9, rotateY: 40 }}
      animate={{ opacity: 1, scale: 1, rotateY: 0 }}
      transition={{ duration: 0.8, ease: "easeOut" }}
      className="corners corners-gold mx-auto max-w-xs p-2"
    >
      <HouseNFT {...props} />
    </motion.div>
  );
}

export function Celebration({ open, onClose, title, sub, house, share }: {
  open: boolean; onClose: () => void; title: string; sub: string; house: HouseSvgInput; share?: React.ReactNode;
}) {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className="fixed inset-0 z-[80] flex items-center justify-center bg-bg/95 p-4"
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <Confetti />
          <button type="button" onClick={onClose} className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center text-muted hover:text-text" aria-label="Close">
            <X className="h-6 w-6" aria-hidden />
          </button>
          <div className="relative max-w-md space-y-6 text-center">
            <NftReveal {...house} />
            <h2 className="font-display text-4xl font-semibold text-gold">{title}</h2>
            <p className="text-lg text-muted">{sub}</p>
            <div className="flex flex-wrap justify-center gap-2">{share}</div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
