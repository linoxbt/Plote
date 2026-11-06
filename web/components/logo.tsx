import Link from "next/link";
import { clsx } from "clsx";

/** SPEC §11.3 hand-built mark (64×64): survey-beacon corners, geometric P, one gold unit. */
export function Mark({ size = 28, className, title = "Plote" }: { size?: number; className?: string; title?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width={size} height={size} fill="none" className={className} role={title ? "img" : undefined} aria-label={title || undefined} aria-hidden={title ? undefined : true}>
      <path d="M6 18V6h12M46 6h12v12M58 46v12H46M18 58H6V46" stroke="#2DD4BF" strokeWidth="4" strokeLinecap="square" />
      <rect x="20" y="18" width="6" height="28" fill="#E9ECEF" />
      <rect x="26" y="18" width="18" height="16" fill="#E9ECEF" />
      <rect x="32" y="24" width="6" height="4" fill="#0A0B0D" />
      <rect x="40" y="40" width="6" height="6" fill="#E8B04B" />
    </svg>
  );
}

/** "plote" in Space Grotesk Medium, the "o" replaced by a square drawn with four corner brackets. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={clsx("font-display inline-flex items-baseline text-[22px] font-medium tracking-[-0.02em] text-text", className)} aria-label="plote">
      <span aria-hidden>pl</span>
      <svg viewBox="0 0 20 20" width="0.62em" height="0.62em" className="mx-[0.04em] self-center translate-y-[0.06em]" aria-hidden>
        <path d="M1.5 7V1.5H7M13 1.5h5.5V7M18.5 13v5.5H13M7 18.5H1.5V13" stroke="#2DD4BF" strokeWidth="2.6" fill="none" strokeLinecap="square" />
      </svg>
      <span aria-hidden>te</span>
    </span>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <Link href="/" className={clsx("inline-flex min-h-11 items-center gap-2", className)} aria-label="Plote home">
      <Mark size={28} title="" />
      <Wordmark />
    </Link>
  );
}
