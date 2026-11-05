import Link from "next/link";
import { clsx } from "clsx";

// Plote identity.
//
// The mark is a P built on a 48-unit grid. Its bowl is a camera viewfinder: four corner brackets
// framing a gold tile, the unit you own, seen through a proof photo. The stem runs down past the
// bowl and ends in a point, like a surveyor's stake driven into the plot.
//
// The wordmark is drawn, not typeset: monoline geometric caps on a 20-unit cap height, with the O
// as the same viewfinder. Gold lives only in the mark's tile.

export const INK = "#E8EAF4";
export const GOLD = "#E8B04B";

/** Stem + top-left and bottom-left arms (one shape), top-right bracket, bottom-right bracket. */
export const MARK_PATHS = {
  stem: "M10 4h12v6h-6v16h6v6h-6v6l-3 6-3-6z",
  tr: "M26 4h12v12h-6v-6h-6z",
  br: "M32 20h6v12H26v-6h6z",
  tile: { x: 20, y: 14, w: 8, h: 8 },
} as const;

export function Mark({
  size = 28, className, title = "Plote", ink = INK, gold = GOLD, animated = false,
}: { size?: number; className?: string; title?: string; ink?: string; gold?: string; animated?: boolean }) {
  // Tight crop of the 48-grid (x 9..39, y 3..45) so the mark sits on text baselines.
  const h = size;
  const w = (size * 30) / 42;
  const t = MARK_PATHS.tile;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="9 3 30 42"
      width={w}
      height={h}
      className={clsx(animated && "mark-animated", className)}
      role={title ? "img" : undefined}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
    >
      <path className="mk-stem" d={MARK_PATHS.stem} fill={ink} />
      <path className="mk-tr" d={MARK_PATHS.tr} fill={ink} />
      <path className="mk-br" d={MARK_PATHS.br} fill={ink} />
      <rect className="mk-tile" x={t.x} y={t.y} width={t.w} height={t.h} fill={gold} />
    </svg>
  );
}

/** Monoline wordmark. Height follows the font-size (≈0.78em of cap height); colour follows `color`. */
export function Wordmark({ className, title = "Plote" }: { className?: string; title?: string }) {
  return (
    <span className={clsx("inline-flex items-center text-[15px] text-text", className)}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 117 20"
        height="0.78em"
        width={`${(0.78 * 117) / 20}em`}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="square"
        role={title ? "img" : undefined}
        aria-label={title || undefined}
        aria-hidden={title ? undefined : true}
      >
        {/* P */}
        <path d="M1 19V1h13v12H1" />
        {/* L */}
        <path d="M26 1v18h11" />
        {/* O — the viewfinder */}
        <path d="M49 7V1h6M61 1h6v6M67 13v6h-6M55 19h-6v-6" />
        {/* T */}
        <path d="M78 1h15M85.5 1v18" />
        {/* E */}
        <path d="M116 1h-11v18h11M105 10h9" />
      </svg>
    </span>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <Link href="/" className={clsx("group inline-flex min-h-11 items-center gap-2.5", className)} aria-label="Plote home">
      <Mark size={24} title="" className="transition-transform duration-500 group-hover:-translate-y-0.5" />
      <Wordmark title="" className="text-[14px]" />
    </Link>
  );
}
