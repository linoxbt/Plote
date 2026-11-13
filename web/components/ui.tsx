"use client";

import Link from "next/link";
import { clsx } from "clsx";
import { AlertTriangle, ChevronDown, Clock, Inbox } from "lucide-react";
import { useRef, useState, type ComponentProps, type MouseEvent, type ReactNode } from "react";
import { EXPLORER, IS_MAINNET } from "@/lib/config";
import { explainError } from "@/lib/errors";

export { clsx as cx };

// ---------------- BracketCard ----------------

type Tone = "default" | "orange" | "red" | "amber" | "accent" | "info";

export function BracketCard({
  children, className, tone = "default", hover = false, as = "div", ...rest
}: {
  children: ReactNode; className?: string; tone?: Tone; hover?: boolean; as?: "div" | "section" | "article" | "li";
} & Omit<ComponentProps<"div">, "children" | "className">) {
  const Tag = as as "div";
  return (
    <Tag
      className={clsx(
        "corners relative bg-surface p-5 sm:p-6",
        tone !== "default" && `corners-${tone}`,
        hover && "corners-hover",
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}

// ---------------- buttons / links ----------------

type BtnVariant = "primary" | "ghost" | "danger" | "accent" | "ink";

export function btnClass(variant: BtnVariant = "ghost", size: "md" | "sm" = "md", extra?: string) {
  return clsx("btn", `btn-${variant}`, size === "sm" && "btn-sm", extra);
}

/**
 * A button that can't be double-submitted: while `loading` is set, or while the promise its `onClick` returned is
 * pending (every transaction button returns one), it is disabled and shows a spinner, and further clicks are dropped
 * even before React re-renders.
 */
export function Button({
  variant = "ghost", size = "md", className, loading, children, disabled, onClick, type, ...rest
}: Omit<ComponentProps<"button">, "onClick"> & {
  variant?: BtnVariant; size?: "md" | "sm"; loading?: boolean;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => unknown;
}) {
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const isLoading = !!loading || pending;
  const handle = (e: MouseEvent<HTMLButtonElement>) => {
    if (busy.current || isLoading) {
      e.preventDefault();
      return;
    }
    const r = onClick?.(e);
    if (r && typeof (r as Promise<unknown>).then === "function") {
      busy.current = true;
      setPending(true);
      (r as Promise<unknown>).then(
        () => undefined,
        () => undefined,
      ).finally(() => {
        busy.current = false;
        setPending(false);
      });
    }
  };
  return (
    <button {...rest} type={type ?? "button"} className={btnClass(variant, size, className)} disabled={!!disabled || isLoading} aria-busy={isLoading || undefined} onClick={handle}>
      {isLoading ? <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden /> : null}
      {children}
    </button>
  );
}

export function LinkButton({
  href, variant = "ghost", size = "md", className, children, ...rest
}: { href: string; variant?: BtnVariant; size?: "md" | "sm"; className?: string; children: ReactNode } & Omit<ComponentProps<typeof Link>, "href" | "className">) {
  return (
    <Link href={href} className={btnClass(variant, size, className)} {...rest}>
      {children}
    </Link>
  );
}

// ---------------- explorer ↗ ----------------

export function explorerAccountUrl(account: string) {
  return `${EXPLORER}/address/${account}`;
}
export function explorerTxUrl(hash: string) {
  return `${EXPLORER}/txns/${hash}`;
}

/** The tiny ↗ next to every on-chain number. */
export function ChainLink({ account, tx, className, label }: { account?: string | null; tx?: string | null; className?: string; label?: string }) {
  if (!account && !tx) return null;
  const href = tx ? explorerTxUrl(tx) : explorerAccountUrl(account!);
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={clsx(
        "mono relative inline-flex h-6 w-6 items-center justify-center text-xs text-muted before:absolute before:-inset-2.5 before:content-[''] hover:text-orange-ink",
        className,
      )}
      aria-label={label ?? `View ${tx ? "transaction" : account} on NearBlocks`}
      title="View on NearBlocks"
    >
      ↗
    </a>
  );
}

// ---------------- loading / error / empty ----------------

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("skeleton", className)} aria-hidden />;
}

export function LoadingCard({ lines = 3, className, label = "Loading" }: { lines?: number; className?: string; label?: string }) {
  return (
    <BracketCard className={clsx("space-y-3", className)} aria-busy="true" aria-label={label}>
      <Skeleton className="h-5 w-1/3" />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={clsx("h-4", i % 2 ? "w-2/3" : "w-full")} />
      ))}
    </BracketCard>
  );
}

export function ErrorState({ error, title, onRetry, className }: { error: unknown; title?: string; onRetry?: () => void; className?: string }) {
  const e = explainError(error);
  const [open, setOpen] = useState(false);
  if (e.code === "CONTRACT_NOT_DEPLOYED") return <AwaitingDeployment raw={e.raw} code={e.code} className={className} />;
  return (
    <BracketCard tone="red" className={clsx("space-y-3", className)} role="alert">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red" strokeWidth={1.5} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-medium">{title ?? "Couldn't load this"}</p>
          <p className="text-sm text-muted">{e.message}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {onRetry ? (
          <Button size="sm" onClick={onRetry}>
            Try again
          </Button>
        ) : null}
        <button
          type="button"
          className="mono inline-flex min-h-11 items-center gap-1 text-xs text-muted hover:text-text"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <ChevronDown className={clsx("h-3.5 w-3.5 transition-transform", open && "rotate-180")} aria-hidden /> {e.code}
        </button>
      </div>
      {open ? <pre className="mono max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-surface-2 p-3 text-xs text-muted">{e.raw}</pre> : null}
    </BracketCard>
  );
}

/** A contract that isn't on this network yet is a state, not a failure: say so plainly (§13.1 states). */
export function AwaitingDeployment({ raw, code, className }: { raw?: string; code?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const account = raw?.match(/([a-z0-9_-]+(?:\.[a-z0-9_-]+)*\.(?:testnet|near))/)?.[1];
  return (
    <BracketCard className={clsx("space-y-3", className)} aria-live="polite">
      <div className="flex items-start gap-3">
        <Clock className="mt-0.5 h-5 w-5 shrink-0 text-info" strokeWidth={1.5} aria-hidden />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-medium">Awaiting deployment</p>
          <p className="text-sm text-muted">
            This contract isn&apos;t on NEAR {IS_MAINNET ? "mainnet" : "testnet"} yet. Nothing is broken and no money is involved. This page reads straight from
            the chain, so it fills in by itself once the contract is deployed.
          </p>
          {account ? (
            <p className="mono inline-flex items-center gap-1 text-xs text-muted">
              {account} <ChainLink account={account} />
            </p>
          ) : null}
        </div>
      </div>
      {code ? (
        <button type="button" className="mono inline-flex min-h-11 items-center gap-1 text-xs text-muted hover:text-text" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <ChevronDown className={clsx("h-3.5 w-3.5 transition-transform", open && "rotate-180")} aria-hidden /> {code}
        </button>
      ) : null}
      {open && raw ? <pre className="mono max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-surface-2 p-3 text-xs text-muted">{raw}</pre> : null}
    </BracketCard>
  );
}

export function EmptyState({ title, children, action, icon, className }: { title: string; children?: ReactNode; action?: ReactNode; icon?: ReactNode; className?: string }) {
  return (
    <BracketCard className={clsx("flex flex-col items-center gap-3 py-10 text-center", className)}>
      <div className="text-muted" aria-hidden>
        {icon ?? <Inbox className="h-7 w-7" strokeWidth={1.5} />}
      </div>
      <p className="font-display text-lg font-medium">{title}</p>
      {children ? <div className="max-w-md text-sm text-muted">{children}</div> : null}
      {action}
    </BracketCard>
  );
}

// ---------------- layout bits ----------------

export function PageHeader({ eyebrow, title, children, actions }: { eyebrow?: ReactNode; title: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="relative mb-8 flex flex-col gap-5 border-b border-line pb-8 sm:mb-10 sm:flex-row sm:items-end sm:justify-between sm:pb-10">
      <div className="min-w-0">
        {eyebrow ? <p className="eyebrow mb-4">{eyebrow}</p> : null}
        <h1 className="text-[36px] leading-[1.06] sm:text-[52px] sm:leading-[1.04]">{title}</h1>
        {children ? <div className="mt-4 max-w-2xl text-base leading-relaxed text-muted">{children}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

export function Page({ children, className, narrow }: { children: ReactNode; className?: string; narrow?: boolean }) {
  return <main id="main" className={clsx("relative mx-auto w-full px-4 py-10 sm:px-6 sm:py-16 lg:px-8", narrow ? "max-w-3xl" : "max-w-[1200px]", className)}>{children}</main>;
}

export function KV({ k, children }: { k: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line/60 py-2 text-sm last:border-0">
      <dt className="text-muted">{k}</dt>
      <dd className="mono min-w-0 break-all text-right">{children}</dd>
    </div>
  );
}

export function Collapsible({ title, children, defaultOpen = false }: { title: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="corners bg-surface p-4 [&_summary::-webkit-details-marker]:hidden" open={defaultOpen}>
      <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2 font-medium">
        {title}
        <ChevronDown className="h-4 w-4 text-muted" aria-hidden />
      </summary>
      <div className="mt-3 text-sm text-muted">{children}</div>
    </details>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, idBase = "tabs" }: { tabs: { id: T; label: string }[]; value: T; onChange: (v: T) => void; idBase?: string }) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <button
          key={t.id}
          id={`${idBase}-tab-${t.id}`}
          role="tab"
          type="button"
          aria-selected={value === t.id}
          aria-controls={`${idBase}-panel-${t.id}`}
          tabIndex={value === t.id ? 0 : -1}
          onClick={() => onChange(t.id)}
          onKeyDown={(e) => {
            if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
            const i = tabs.findIndex((x) => x.id === value);
            const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
            onChange(next.id);
            document.getElementById(`${idBase}-tab-${next.id}`)?.focus();
          }}
          className={clsx(
            "mono min-h-11 shrink-0 border-b-2 px-3 text-sm",
            value === t.id ? "border-orange text-orange-ink" : "border-transparent text-muted hover:text-text",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Props for the panel that a <Tabs idBase=…> controls: `<div {...tabPanelProps("unit", tab)}>`. */
export function tabPanelProps(idBase: string, id: string) {
  return { id: `${idBase}-panel-${id}`, role: "tabpanel" as const, "aria-labelledby": `${idBase}-tab-${id}`, tabIndex: 0 };
}

export function Bar({ value, tone = "orange", label }: { value: number; tone?: "orange" | "accent" | "amber" | "red" | "muted"; label: string }) {
  const v = Math.max(0, Math.min(100, value));
  const color = { orange: "bg-orange", accent: "bg-accent", amber: "bg-amber", red: "bg-red", muted: "bg-muted" }[tone];
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2 ring-1 ring-inset ring-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v)} aria-label={label}>
      <div className={clsx("h-full rounded-full", color)} style={{ width: `${v}%` }} />
    </div>
  );
}

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: ReactNode; error?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? <p className="mt-1 text-xs text-red">{error}</p> : hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}
