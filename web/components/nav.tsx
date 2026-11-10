"use client";

// Site header (hamburger at every size, opening a full-screen menu) and footer. Layout inspired by coredao.org.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Menu, X } from "lucide-react";
import { clsx } from "clsx";
import { GITHUB_URL, IS_MAINNET, MAINNET_APP_URL, TESTNET_APP_URL } from "@/lib/config";
import { Logo, Mark } from "./logo";
import { NetworkPill } from "./chain";
import { ConnectButton } from "./wallet";

type NavLink = { href: string; label: string; note?: string };
const SPEC_URL = `${GITHUB_URL.replace(/\/$/, "")}/blob/main/docs/SPEC.md`;

export const NAV_GROUPS: { title: string; links: NavLink[] }[] = [
  {
    title: "Product",
    links: [
      { href: "/how-it-works", label: "How it works", note: "Four steps, no middleman" },
      { href: "/nft", label: "The NFT", note: "A token that holds the money" },
      { href: "/verification", label: "Proof & verification", note: "Photo checks in secure hardware" },
      { href: "/payments", label: "Pay from anywhere", note: "USDC from any chain" },
      { href: "/security", label: "Security", note: "Who can move money, and how" },
    ],
  },
  {
    title: "Use Plote",
    links: [
      { href: "/check", label: "Check a unit", note: "No login" },
      { href: "/estates", label: "Estates" },
      { href: "/market", label: "Resale market" },
      { href: "/me", label: "My units" },
      ...(IS_MAINNET ? [] : [{ href: "/faucet", label: "Test USDC" }]),
    ],
  },
  {
    title: "Build",
    links: [
      { href: "/builders", label: "For developers", note: "Public escrow as a sales tool" },
      { href: "/dev", label: "Developer console" },
      { href: "/surveyors", label: "For surveyors" },
      { href: "/qs", label: "Surveyor app" },
    ],
  },
  {
    title: "Resources",
    links: [
      { href: "/faq", label: "FAQ" },
      { href: "/status", label: "System status" },
      { href: SPEC_URL, label: "Build spec" },
      { href: GITHUB_URL, label: "GitHub" },
    ],
  },
];

function NavItem({ l, onClick, big }: { l: NavLink; onClick?: () => void; big?: boolean }) {
  const ext = l.href.startsWith("http");
  const cls = clsx("group flex min-h-11 flex-col justify-center rounded-xl py-1.5 transition-colors", big ? "text-lg sm:text-xl" : "text-sm text-muted hover:text-text");
  const inner = (
    <>
      <span className="inline-flex items-center gap-1.5">
        {l.label}
        {ext ? <ArrowUpRight className="h-3.5 w-3.5 opacity-60" aria-hidden /> : null}
      </span>
      {big && l.note ? <span className="text-xs text-muted">{l.note}</span> : null}
    </>
  );
  return ext ? (
    <a href={l.href} target="_blank" rel="noreferrer" className={cls} onClick={onClick}>
      {inner}
    </a>
  ) : (
    <Link href={l.href} className={cls} onClick={onClick}>
      {inner}
    </Link>
  );
}

export function Nav() {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  const btn = useRef<HTMLButtonElement>(null);

  // Close on route change, Escape; lock page scroll while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btn.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <header className="sticky top-0 z-50">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[70] focus:rounded-full focus:bg-teal focus:px-4 focus:py-2 focus:text-bg">
        Skip to content
      </a>
      <div className="border-b border-white/[0.06] bg-bg/70 backdrop-blur-xl">
        <div className="mx-auto flex h-[72px] max-w-7xl items-center gap-3 px-4 sm:px-6 lg:px-8">
          <Logo />
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden sm:block">
              <NetworkPill />
            </span>
            <span className="hidden md:block">
              <Link href="/check" className="btn btn-ghost btn-sm" aria-current={path === "/check" ? "page" : undefined}>
                Check a unit
              </Link>
            </span>
            <div className="hidden sm:block">
              <ConnectButton />
            </div>
            <button
              ref={btn}
              type="button"
              className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/[0.06] text-text ring-1 ring-white/[0.14] transition-colors hover:bg-white/[0.12]"
              aria-expanded={open}
              aria-controls="site-menu"
              aria-label={open ? "Close menu" : "Open menu"}
              onClick={() => setOpen((o) => !o)}
            >
              {open ? <X className="h-5 w-5" strokeWidth={1.5} aria-hidden /> : <Menu className="h-5 w-5" strokeWidth={1.5} aria-hidden />}
            </button>
          </div>
        </div>
      </div>

      {open ? (
        <div id="site-menu" role="dialog" aria-modal="true" aria-label="Site menu" className="hero-glow fixed inset-x-0 bottom-0 top-[72px] z-50 overflow-y-auto">
          <div className="mx-auto max-w-7xl px-4 pb-16 pt-8 sm:px-6 lg:px-8">
            <div className="grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
              {NAV_GROUPS.map((g) => (
                <nav key={g.title} aria-label={g.title}>
                  <p className="mb-3 text-xs uppercase tracking-[0.18em] text-muted">{g.title}</p>
                  <ul className="space-y-1">
                    {g.links.map((l) => (
                      <li key={l.href}>
                        <NavItem l={l} big onClick={() => setOpen(false)} />
                      </li>
                    ))}
                  </ul>
                </nav>
              ))}
            </div>
            <div className="glass mt-12 flex flex-col gap-4 rounded-3xl p-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-lg">Check a unit before you pay for it.</p>
                <p className="text-sm text-muted">Anyone can look up any unit: holder, payments, releases and proof. No login.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="sm:hidden">
                  <NetworkPill />
                </span>
                <div className="sm:hidden">
                  <ConnectButton compact />
                </div>
                <Link href="/check" className="btn btn-primary" onClick={() => setOpen(false)}>
                  Check a unit →
                </Link>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}

export function Footer() {
  const other = IS_MAINNET ? TESTNET_APP_URL : MAINNET_APP_URL;
  return (
    <footer className="mt-24 border-t border-white/[0.06] bg-bg-2">
      <div className="mx-auto grid max-w-7xl gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1.1fr_2fr] lg:px-8">
        <div className="space-y-5">
          <Logo />
          <p className="max-w-xs text-sm text-muted">Plote holds off-plan deposits in each unit&apos;s own on-chain account and releases them only on proof.</p>
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.18em] text-muted">Network</p>
            <div className="flex gap-2 text-xs">
              <span className={clsx("rounded-full px-3 py-2", !IS_MAINNET ? "bg-teal/10 text-teal ring-1 ring-teal/30" : "text-muted ring-1 ring-white/10")}>Testnet</span>
              {other ? (
                <a href={other} className={clsx("rounded-full px-3 py-2 hover:text-text", IS_MAINNET ? "bg-gold/10 text-gold ring-1 ring-gold/30" : "text-muted ring-1 ring-white/10")}>
                  Mainnet demo
                </a>
              ) : (
                <span className={clsx("rounded-full px-3 py-2", IS_MAINNET ? "bg-gold/10 text-gold ring-1 ring-gold/30" : "text-muted ring-1 ring-white/10")} title="Set NEXT_PUBLIC_MAINNET_APP_URL to link the mainnet demo build">
                  Mainnet demo
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          {NAV_GROUPS.map((g) => (
            <nav key={g.title} aria-label={`${g.title} (footer)`}>
              <p className="mb-3 text-sm text-text">{g.title}</p>
              <ul>
                {g.links.map((l) => (
                  <li key={l.href}>
                    <NavItem l={l} />
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
      </div>
      <div className="border-t border-white/[0.06]">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-6 text-xs text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <span className="inline-flex items-center gap-2">
            <Mark size={18} title="" /> Plote: every off-plan home, its own account.
          </span>
          <span>Built for NEAR HACKATHON 2026 · MIT licence · Not financial or legal advice.</span>
        </div>
      </div>
    </footer>
  );
}
