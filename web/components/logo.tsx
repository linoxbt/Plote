import Link from "next/link";
import { useId } from "react";
import { clsx } from "clsx";

/**
 * Plote mark (64×64): an orange gradient tile holding a P. The stem ends in a map-pin point (a plot on the map) and the
 * bowl holds one white square: the unit, with its money in its own account. Same drawing as public/mark.svg,
 * public/logo.svg and the share card (app/api/og/unit): keep them in step.
 */
export const MARK_PATHS = {
  gradient: [["0", "#FFB054"], [".45", "#FF9211"], ["1", "#E55D08"]] as const,
  ink: "#121212",
  bowl: { cx: 35, cy: 27, r: 11, w: 7 },
  stem: "M20.5 16h7v26l-3.5 8-3.5-8z",
  unit: { x: 32, y: 24, s: 6 },
} as const;

export function Mark({ size = 28, className, title = "Plote" }: { size?: number; className?: string; title?: string }) {
  const m = MARK_PATHS;
  const id = `plote-mark-${useId().replace(/:/g, "")}`; // unique per instance: a shared id breaks if the first copy is hidden
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width={size} height={size} className={className} role={title ? "img" : undefined} aria-label={title || undefined} aria-hidden={title ? undefined : true}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          {m.gradient.map(([o, c]) => <stop key={o} offset={o} stopColor={c} />)}
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill={`url(#${id})`} />
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
    <Link href="/" prefetch={false} className={clsx("inline-flex min-h-11 items-center gap-2.5", className)} aria-label="Plote home">
      <Mark size={32} title="" />
      <Wordmark />
    </Link>
  );
}
