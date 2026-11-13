"use client";

import { clsx } from "clsx";
import { useState } from "react";
import {
  AlertOctagon, BadgeCheck, CircleDashed, Clock, Copy, Home, Loader2, Lock, ShieldCheck, ShieldX, XCircle, type LucideIcon,
} from "lucide-react";
import { NETWORK } from "@/lib/config";
import { countdown, formatNaira, formatUsdc, truncateAccount, usdcAriaLabel } from "@/lib/format";
import { useFx, useNow } from "@/lib/hooks";
import type { EvidenceStatus, MilestoneStatus, ProposalStatus, UnitStatus } from "@/lib/types";
import { ChainLink } from "./ui";

// ---------------- MonoAmount: USDC + approx ₦ ----------------

export function MonoAmount({
  value, account, tx, naira = true, size = "md", className, unit = "USDC", dollar = true,
}: {
  value: string | bigint | null | undefined;
  account?: string | null; // NearBlocks ↗ target
  tx?: string | null;
  naira?: boolean;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
  unit?: string | null;
  dollar?: boolean;
}) {
  const rate = useFx();
  if (value === null || value === undefined) {
    return (
      <span className={clsx("mono tabular-nums", className)}>
        —{account || tx ? <ChainLink account={account} tx={tx} /> : null}
      </span>
    );
  }
  const sz = { sm: "text-sm", md: "text-base", lg: "text-xl", xl: "text-3xl sm:text-4xl" }[size];
  return (
    <span className={clsx("inline-flex flex-wrap items-baseline gap-x-1.5", className)}>
      <span className={clsx("mono tabular-nums", sz)} aria-label={usdcAriaLabel(value)}>
        {dollar ? "$" : ""}
        {formatUsdc(value)}
        {unit && !dollar ? ` ${unit}` : ""}
      </span>
      {naira && rate ? (
        <span className="mono text-xs text-muted tabular-nums" title="Approximate naira value, display only">
          ≈{formatNaira(value, rate)} <span className="sr-only">approximately</span>
        </span>
      ) : null}
      {account || tx ? <ChainLink account={account} tx={tx} /> : null}
    </span>
  );
}

// ---------------- AccountChip: truncate middle, copy, NearBlocks ↗ ----------------

export function AccountChip({ account, max = 22, className, label }: { account: string | null | undefined; max?: number; className?: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  if (!account) return <span className="mono text-muted">—</span>;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(account);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };
  return (
    <span className={clsx("mono inline-flex max-w-full items-center gap-1 bg-surface-2 py-0.5 pl-2 text-sm", className)} title={account}>
      {label ? <span className="text-muted">{label}</span> : null}
      <span className="min-w-0 truncate">{truncateAccount(account, max)}</span>
      <button type="button" onClick={copy} className="relative inline-flex h-7 w-7 items-center justify-center text-muted before:absolute before:-inset-2 before:content-[''] hover:text-orange-ink" aria-label={`Copy ${account}`}>
        {copied ? <BadgeCheck className="h-3.5 w-3.5 text-orange-ink" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
      </button>
      <ChainLink account={account} />
      <span className="sr-only" aria-live="polite">{copied ? "Copied" : ""}</span>
    </span>
  );
}

// ---------------- StatusBadge (text + icon, never colour alone) ----------------

type BadgeDef = { label: string; tone: "orange" | "amber" | "red" | "accent" | "muted"; Icon: LucideIcon };

const UNIT_BADGE: Record<UnitStatus, BadgeDef> = {
  Available: { label: "Available", tone: "muted", Icon: CircleDashed },
  Reserved: { label: "Reserved", tone: "amber", Icon: Clock },
  Allocated: { label: "Taken", tone: "orange", Icon: Lock },
  InDefault: { label: "In default", tone: "red", Icon: AlertOctagon },
  HandedOver: { label: "Handed over", tone: "accent", Icon: Home },
};

const MILESTONE_BADGE: Record<MilestoneStatus, BadgeDef> = {
  Open: { label: "Open", tone: "muted", Icon: CircleDashed },
  Checking: { label: "Checking", tone: "amber", Icon: Loader2 },
  Verified: { label: "Verified", tone: "orange", Icon: ShieldCheck },
  Approved: { label: "Approved", tone: "orange", Icon: BadgeCheck },
  Vetoed: { label: "Vetoed", tone: "red", Icon: ShieldX },
  Missed: { label: "Missed", tone: "red", Icon: AlertOctagon },
};

const EVIDENCE_BADGE: Record<EvidenceStatus, BadgeDef> = {
  Pending: { label: "Checking", tone: "amber", Icon: Loader2 },
  Pass: { label: "Pass", tone: "orange", Icon: ShieldCheck },
  Fail: { label: "Fail", tone: "red", Icon: XCircle },
  Error: { label: "Error", tone: "red", Icon: AlertOctagon },
};

const PROPOSAL_BADGE: Record<ProposalStatus, BadgeDef> = {
  Open: { label: "Open", tone: "amber", Icon: Clock },
  Executed: { label: "Passed", tone: "orange", Icon: BadgeCheck },
  Rejected: { label: "Rejected", tone: "red", Icon: XCircle },
  Expired: { label: "Expired", tone: "muted", Icon: CircleDashed },
};

const TONE = {
  orange: "text-orange-ink bg-orange/10 ring-1 ring-orange/25",
  amber: "text-amber bg-amber/10 ring-1 ring-amber/25",
  red: "text-red bg-red/10 ring-1 ring-red/25",
  accent: "text-accent bg-accent/10 ring-1 ring-accent/25",
  muted: "text-muted bg-surface-2 ring-1 ring-line",
};

function Badge({ def, className, suffix }: { def: BadgeDef; className?: string; suffix?: string }) {
  const { Icon } = def;
  return (
    <span className={clsx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-normal", TONE[def.tone], className)}>
      <Icon className={clsx("h-3.5 w-3.5", def.Icon === Loader2 && "animate-spin")} strokeWidth={1.75} aria-hidden />
      {def.label}
      {suffix ? <span className="font-normal normal-case">{suffix}</span> : null}
    </span>
  );
}

export function StatusBadge({ status, kind = "unit", className, suffix }: {
  status: string | null | undefined; kind?: "unit" | "milestone" | "evidence" | "proposal"; className?: string; suffix?: string;
}) {
  if (!status) return <Badge def={{ label: "Unknown", tone: "muted", Icon: CircleDashed }} className={className} />;
  const map = (kind === "unit" ? UNIT_BADGE : kind === "milestone" ? MILESTONE_BADGE : kind === "evidence" ? EVIDENCE_BADGE : PROPOSAL_BADGE) as Record<string, BadgeDef>;
  return <Badge def={map[status] ?? { label: status, tone: "muted", Icon: CircleDashed }} className={className} suffix={suffix} />;
}

// ---------------- NetworkPill ----------------

export function NetworkPill({ className }: { className?: string }) {
  const main = NETWORK === "mainnet";
  return (
    <span
      className={clsx("inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-normal", main ? "bg-accent/10 text-accent ring-1 ring-accent/30" : "bg-orange/10 text-orange-ink ring-1 ring-orange/30", className)}
      title={main ? "Mainnet demo build" : "NEAR testnet — no real money"}
    >
      <span className={clsx("h-1.5 w-1.5 rounded-full", main ? "bg-accent" : "bg-orange")} aria-hidden />
      {main ? "Mainnet" : "Testnet"}
    </span>
  );
}

// ---------------- CountdownChip ----------------

export function CountdownChip({ until, label, endedLabel = "ended", tone = "amber", className }: {
  until: string | null | undefined; label?: string; endedLabel?: string; tone?: "amber" | "red" | "orange"; className?: string;
}) {
  const now = useNow(1000);
  const c = countdown(until, now);
  return (
    <span
      className={clsx(
        "mono inline-flex items-center gap-1.5 px-2 py-1 text-xs tabular-nums",
        c.ended ? "bg-surface-2 text-muted" : tone === "red" ? "bg-red/10 text-red" : tone === "orange" ? "bg-orange-dim/40 text-orange-ink" : "bg-amber/10 text-amber",
        className,
      )}
      suppressHydrationWarning
    >
      <Clock className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
      {label ? <span>{label}</span> : null}
      <span>{c.ended ? endedLabel : c.label}</span>
    </span>
  );
}
