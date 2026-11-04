"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { clsx } from "clsx";
import { GITHUB_URL, IS_MAINNET, MAINNET_APP_URL, TESTNET_APP_URL } from "@/lib/config";
import { Logo, Mark } from "./logo";
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
  useEffect(() => setOpen(false), [path]);
  return (
    <header className="sticky top-0 z-50 h-16 border-b border-line/60 bg-bg/80 backdrop-blur-md">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[70] focus:bg-teal focus:px-3 focus:py-2 focus:text-bg">
        Skip to content
      </a>
      <div className="mx-auto flex h-full max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Logo />
        <nav className="ml-4 hidden items-center gap-1 lg:flex" aria-label="Main">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={clsx("inline-flex min-h-11 items-center px-3 text-sm text-muted hover:text-text", path?.startsWith(l.href) && "text-text")}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
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
            {open ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
          </button>
        </div>
      </div>
      {open ? (
        <div id="mobile-nav" className="border-b border-line bg-bg px-4 pb-4 lg:hidden">
          <nav className="flex flex-col" aria-label="Mobile">
            {LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="flex min-h-12 items-center border-b border-line/50 text-base">
                {l.label}
              </Link>
            ))}
            <Link href="/me" className="flex min-h-12 items-center border-b border-line/50 text-base">
              My units
            </Link>
            <Link href="/qs" className="flex min-h-12 items-center border-b border-line/50 text-base">
              Surveyor app
            </Link>
          </nav>
          <div className="mt-4 sm:hidden">
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
    <footer className="mt-16 border-t border-line">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-[1.2fr_2fr]">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Mark size={24} title="" />
            <p className="text-sm">Plote — every off-plan home, its own account.</p>
          </div>
          <p className="mono text-xs text-muted">Built for NEAR HACKATHON 2026 · MIT licence</p>
          <p className="text-xs text-muted">Not financial or legal advice.</p>
        </div>
        <div className="flex flex-col gap-6 sm:flex-row sm:justify-between">
          <nav className="grid grid-cols-2 gap-x-8 text-sm sm:grid-cols-3" aria-label="Footer">
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
            <div className="mono flex gap-1 text-xs">
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
