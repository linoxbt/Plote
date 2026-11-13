// SPEC §12.5: "Each step has a small animated illustration." Line drawings in the brand style
// (1.5 px orange strokes, square caps, muted grey for secondary lines; colours are the globals.css tokens).
// Motion is slow and small; the global prefers-reduced-motion rule in globals.css stops it.

const S = { stroke: "var(--orange)", strokeWidth: 1.5, fill: "none", strokeLinecap: "square" as const, strokeLinejoin: "miter" as const };
const MUTED = "var(--muted)";
const EMPTY = "rgba(11, 18, 32, 0.08)";

/** 1 · Reserve: a unit address tag; the lock closes on it. */
function Reserve() {
  return (
    <svg viewBox="0 0 96 64" className="h-16 w-24" aria-hidden>
      <path {...S} d="M8 22h46l10 10-10 10H8z" />
      <path {...S} d="M16 32h26" stroke={MUTED} />
      <g className="step-lock">
        <rect {...S} x="70" y="30" width="16" height="13" />
        <path {...S} className="step-shackle" d="M73 30v-5a5 5 0 0 1 10 0v5" />
      </g>
    </svg>
  );
}

/** 2 · Pay into the unit: a coin drops into the unit's own account. */
function Pay() {
  return (
    <svg viewBox="0 0 96 64" className="h-16 w-24" aria-hidden>
      <path {...S} d="M24 30h48v26H24z" />
      <path {...S} d="M40 30h16" stroke="var(--surface)" strokeWidth={3} />
      <text x="48" y="48" textAnchor="middle" fill={MUTED} fontSize="8" fontFamily="var(--font-geist-mono), monospace">
        a-4b
      </text>
      <circle className="step-coin" cx="48" cy="12" r="6" fill="var(--accent)" />
    </svg>
  );
}

/** 3 · Every stage is proven: a photo frame inside survey brackets, a check mark draws in. */
function Prove() {
  return (
    <svg viewBox="0 0 96 64" className="h-16 w-24" aria-hidden>
      <path {...S} d="M26 14v-6h8M62 8h8v6M70 50v6h-8M34 56h-8v-6" />
      <path {...S} d="M34 44l10-12 8 8 6-6 6 10H34z" stroke={MUTED} />
      <circle {...S} cx="58" cy="22" r="3" stroke={MUTED} />
      <path {...S} className="step-check" d="M74 34l6 6 12-14" pathLength={1} />
    </svg>
  );
}

/** 4 · Money moves only on proof: a stage bar fills, then the share moves out. */
function Release() {
  return (
    <svg viewBox="0 0 96 64" className="h-16 w-24" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x={8 + i * 20} y="40" width="16" height="6" fill={i === 0 ? "var(--orange)" : EMPTY} className={i === 1 ? "step-fill" : undefined} />
      ))}
      <path {...S} className="step-arrow" d="M36 26h22m-6-6 6 6-6 6" />
      <text x="20" y="30" textAnchor="middle" fill={MUTED} fontSize="8" fontFamily="var(--font-geist-mono), monospace">
        20%
      </text>
    </svg>
  );
}

export const STEP_ART = [Reserve, Pay, Prove, Release];
