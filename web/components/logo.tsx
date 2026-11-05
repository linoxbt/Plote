import Link from "next/link";
import { clsx } from "clsx";

/** SPEC §11.3 hand-built mark (64×64): survey-beacon corners, geometric P, one gold unit. */
export function Mark({ size = 28, className, title = "Plote" }: { size?: number; className?: string; title?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width={size} height={size} fill="none" className={className} role="img" aria-label={title}>
      <path d="M6 18V6h12M46 6h12v12M58 46v12H46M18 58H6V46" stroke="#2DD4BF" strokeWidth="4" strokeLinecap="square" />
      <rect x="20" y="18" width="6" height="28" fill="#E9ECEF" />
      <rect x="26" y="18" width="18" height="16" fill="#E9ECEF" />
      <rect x="32" y="24" width="6" height="4" fill="#0A0B0D" />
      <rect x="40" y="40" width="6" height="6" fill="#E8B04B" />
    </svg>
  );
}

/** "PLOTE" in thin, widely tracked technical caps; the "O" is a square drawn with four corner brackets. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={clsx("inline-flex items-center text-[15px] font-light uppercase tracking-[0.42em] text-text [font-family:var(--font-tech)]", className)}
      aria-label="Plote"
    >
      <span aria-hidden>PL</span>
      <svg viewBox="0 0 20 20" width="0.86em" height="0.86em" className="mr-[0.42em]" aria-hidden>
        <path d="M1.5 7V1.5H7M13 1.5h5.5V7M18.5 13v5.5H13M7 18.5H1.5V13" stroke="#2DD4BF" strokeWidth="1.8" fill="none" strokeLinecap="square" />
      </svg>
      <span aria-hidden>TE</span>
    </span>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <Link href="/" className={clsx("inline-flex min-h-11 items-center gap-2", className)} aria-label="Plote home">
      <Mark size={24} title="" />
      <Wordmark />
    </Link>
  );
}
