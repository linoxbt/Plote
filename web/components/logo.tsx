import Link from "next/link";
import { clsx } from "clsx";

/**
 * Plote mark (64×64): an orange tile holding a P. The stem ends in a map-pin point (a plot on the map) and the bowl
 * holds one white square: the unit, with its money in its own account.
 */
export const MARK_PATHS = {
  tile: "#FF9211",
  ink: "#121212",
  bowl: { cx: 35, cy: 27, r: 11, w: 7 },
  stem: "M20.5 16h7v26l-3.5 8-3.5-8z",
  unit: { x: 32, y: 24, s: 6 },
} as const;

export function Mark({ size = 28, className, title = "Plote" }: { size?: number; className?: string; title?: string }) {
  const m = MARK_PATHS;
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width={size} height={size} className={className} role={title ? "img" : undefined} aria-label={title || undefined} aria-hidden={title ? undefined : true}>
      <rect width="64" height="64" rx="16" fill={m.tile} />
      <circle cx={m.bowl.cx} cy={m.bowl.cy} r={m.bowl.r} fill="none" stroke={m.ink} strokeWidth={m.bowl.w} />
      <path d={m.stem} fill={m.ink} />
      <rect x={m.unit.x} y={m.unit.y} width={m.unit.s} height={m.unit.s} fill="#FFFFFF" />
    </svg>
  );
}

/** "plote" set in Lexend Medium, lowercase. */
export function Wordmark({ className }: { className?: string }) {
  return <span className={clsx("font-display text-[24px] font-medium leading-none tracking-[-0.01em] text-text", className)}>plote</span>;
}

export function Logo({ className }: { className?: string }) {
  return (
    <Link href="/" className={clsx("inline-flex min-h-11 items-center gap-2.5", className)} aria-label="Plote home">
      <Mark size={32} title="" />
      <Wordmark />
    </Link>
  );
}
