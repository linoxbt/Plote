"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { clsx } from "clsx";
import { GITHUB_URL, IS_MAINNET, MAINNET_APP_URL, TESTNET_APP_URL } from "@/lib/config";
import { Logo, Mark, Wordmark } from "./logo";
import { NetworkPill } from "./chain";
import { ConnectButton } from "./wallet";

const LINKS = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/check", label: "Check a unit" },
  { href: "/estates", label: "Estates" },
  { href: "/dev", label: "For developers" },
  { href: "/faq", label: "FAQ" },
];

export function Nav() {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  return (
    <header className="sticky top-0 z-50 h-16 bg-bg/55 backdrop-blur-xl">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[70] focus:bg-teal focus:px-3 focus:py-2 focus:text-bg">
        Skip to content
      </a>
      <div className="mx-auto flex h-full max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Logo />
        <nav className="ml-6 hidden items-center lg:flex" aria-label="Main">
          {LINKS.map((l) => {
            const active = path?.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={clsx("tech relative inline-flex min-h-11 items-center px-3 text-[10.5px] transition-colors hover:text-text", active ? "text-text" : "text-muted")}
              >
                {l.label}
                {active ? <span className="absolute inset-x-3 bottom-1.5 h-px bg-teal" aria-hidden /> : null}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <div className="hidden sm:block">
            <ConnectButton />
          </div>
          <NetworkPill />
          <button
            type="button"
            className="inline-flex h-11 w-11 items-center justify-center text-muted hover:text-text lg:hidden"
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <X className="h-5 w-5" strokeWidth={1.25} aria-hidden /> : <Menu className="h-5 w-5" strokeWidth={1.25} aria-hidden />}
          </button>
        </div>
      </div>
      {open ? (
        <div id="mobile-nav" className="glass fixed inset-x-0 top-16 bottom-0 overflow-y-auto px-6 pb-10 pt-6 lg:hidden">
          <nav className="flex flex-col" aria-label="Mobile" onClick={() => setOpen(false)}>
            {[...LINKS, { href: "/me", label: "My units" }, { href: "/qs", label: "Surveyor app" }].map((l, i) => (
              <Link key={l.href} href={l.href} className="flex min-h-14 items-center gap-5 border-b border-[var(--line-soft)]">
                <span className="tech text-[10px] text-teal tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                <span className="text-xl font-light uppercase tracking-[0.14em] [font-family:var(--font-tech)]">{l.label}</span>
              </Link>
            ))}
          </nav>
          <div className="mt-8 sm:hidden">
            <ConnectButton compact />
          </div>
        </div>
      ) : null}
    </header>
  );
}

export function Footer() {
  const other = IS_MAINNET ? TESTNET_APP_URL : MAINNET_APP_URL;
  return (
    <footer className="relative z-[1] mt-20 border-t border-[var(--line-soft)]">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-[1.2fr_2fr]">
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Mark size={22} title="" />
            <Wordmark className="text-[13px]" />
          </div>
          <p className="text-sm text-muted">Every off-plan home, its own account.</p>
          <p className="tech text-[10px] text-faint">Built for NEAR HACKATHON 2026 · MIT licence</p>
          <p className="text-xs text-muted">Not financial or legal advice.</p>
        </div>
        <div className="flex flex-col gap-6 sm:flex-row sm:justify-between">
          <nav className="tech grid grid-cols-2 gap-x-8 text-[10.5px] sm:grid-cols-3" aria-label="Footer">
            {[
              ["/how-it-works", "How it works"],
              ["/estates", "Estates"],
              ["/dev", "Developers"],
              ["/estates/harmattan-court/milestones", "Proofs"],
              [GITHUB_URL, "GitHub"],
              [`${GITHUB_URL.replace(/\/$/, "")}/blob/main/docs/SPEC.md`, "Build spec"],
              ["/status", "Status"],
              ["/faq", "FAQ"],
              ["/market", "Market"],
            ].map(([href, label]) =>
              href.startsWith("http") ? (
                <a key={label} href={href} target="_blank" rel="noreferrer" className="flex min-h-11 items-center text-muted hover:text-text">
                  {label} ↗
                </a>
              ) : (
                <Link key={label} href={href} className="flex min-h-11 items-center text-muted hover:text-text">
                  {label}
                </Link>
              ),
            )}
          </nav>
          <div className="space-y-2">
            <p className="label">Network</p>
            <div className="tech flex gap-1 text-[10px]">
              <span className={clsx("px-2 py-2", !IS_MAINNET ? "bg-teal-dim/40 text-teal" : "text-muted")}>testnet</span>
              {other ? (
                <a href={other} className={clsx("px-2 py-2 hover:text-text", IS_MAINNET ? "bg-gold/10 text-gold" : "text-muted")}>
                  mainnet demo
                </a>
              ) : (
                <span className={clsx("px-2 py-2", IS_MAINNET ? "bg-gold/10 text-gold" : "text-muted")} title="Set NEXT_PUBLIC_MAINNET_APP_URL to link the mainnet demo build">
                  mainnet demo
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
