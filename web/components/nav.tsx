"use client";

// Site header (compact white bar: logo, primary links on wide screens, wallet, the accent CTA and a menu button that opens
// the full sitemap) and footer (columns).

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
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
      { href: "/pay", label: IS_MAINNET ? "Pay the mainnet unit" : "Cross-chain payment", note: IS_MAINNET ? "A real 1Click payment" : "Runs on the mainnet build" },
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

/** The few links shown inline on wide screens; everything else is in the menu. */
const PRIMARY: NavLink[] = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/estates", label: "Estates" },
  { href: "/check", label: "Check a unit" },
  { href: "/market", label: "Market" },
  { href: "/verification", label: "Proof" },
  { href: "/builders", label: "Developers" },
];

function NavItem({ l, onClick, big }: { l: NavLink; onClick?: () => void; big?: boolean }) {
  const ext = l.href.startsWith("http");
  const cls = clsx("group flex min-h-11 flex-col justify-center rounded-xl py-1.5 transition-colors", big ? "text-lg font-medium hover:text-orange-ink" : "text-sm text-muted hover:text-text");
  const inner = (
    <>
      <span className="inline-flex items-center gap-1.5">
        {l.label}
        {ext ? <ArrowUpRight className="h-3.5 w-3.5 opacity-60" aria-hidden /> : null}
      </span>
      {big && l.note ? <span className="text-xs font-normal text-muted">{l.note}</span> : null}
    </>
  );
  return ext ? (
    <a href={l.href} target="_blank" rel="noreferrer" className={cls} onClick={onClick}>
      {inner}
    </a>
  ) : (
    <Link href={l.href} prefetch={false} className={cls} onClick={onClick}>
      {inner}
    </Link>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Nav() {
  const path = usePathname();
  // The menu belongs to the page it was opened on: any route change (a link, the back button) closes it.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn !== null && openOn === path;
  const btn = useRef<HTMLButtonElement>(null);
  const header = useRef<HTMLElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const close = useCallback((refocus = true) => {
    setOpenOn(null);
    if (refocus) btn.current?.focus();
  }, []);

  // While open: Escape and Back close it, Tab stays inside (toggle + menu), the page behind is inert and doesn't scroll.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== "Tab" || !menu.current) return;
      const items = [btn.current, ...menu.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x): x is HTMLElement => !!x && x.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const at = document.activeElement as HTMLElement | null;
      const inside = !!at && items.includes(at);
      if (e.shiftKey && (at === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (at === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };
    // Back with the menu open on the same path (a hash or query entry) still closes it.
    const onPop = () => close(false);
    document.addEventListener("keydown", onKey);
    window.addEventListener("popstate", onPop);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const made: HTMLElement[] = [];
    for (const el of Array.from(document.body.children) as HTMLElement[]) {
      if (el.contains(header.current) || el.hasAttribute("data-overlay-keep") || el.inert) continue;
      el.inert = true;
      made.push(el);
    }
    menu.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("popstate", onPop);
      document.body.style.overflow = prev;
      made.forEach((el) => (el.inert = false));
    };
  }, [open, close]);

  return (
    <header ref={header} className="sticky top-0 z-50">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[70] focus:rounded-full focus:bg-orange focus:px-4 focus:py-2 focus:text-ink">
        Skip to content
      </a>
      <div className="border-b border-line bg-surface/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center gap-3 px-4 sm:px-6 lg:px-8">
          <Logo />
          <nav aria-label="Primary" className="ml-6 hidden flex-1 justify-center lg:flex">
            <ul className="flex items-center gap-1">
              {PRIMARY.map((l) => {
                const on = path === l.href || (l.href !== "/" && path.startsWith(`${l.href}/`));
                return (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      prefetch={false}
                      aria-current={on ? "page" : undefined}
                      className={clsx("inline-flex min-h-11 items-center rounded-full px-3 text-[14px] transition-colors", on ? "font-medium text-text" : "text-text-2/80 hover:text-text")}
                    >
                      {l.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden xl:block">
              <NetworkPill />
            </span>
            <div className="hidden sm:block">
              <ConnectButton />
            </div>
            <Link href="/estates/playground" prefetch={false} className="btn btn-primary btn-sm hidden md:inline-flex">
              Try the playground
            </Link>
            <button
              ref={btn}
              type="button"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-surface px-3 text-sm font-medium text-text ring-1 ring-line transition-colors hover:bg-surface-2"
              aria-expanded={open}
              aria-controls="site-menu"
              aria-label={open ? "Close menu" : "Open menu"}
              onClick={() => (open ? close() : setOpenOn(path))}
            >
              {open ? <X className="h-5 w-5" strokeWidth={1.75} aria-hidden /> : <Menu className="h-5 w-5" strokeWidth={1.75} aria-hidden />}
              <span className="hidden sm:inline" aria-hidden>{open ? "Close" : "Menu"}</span>
            </button>
          </div>
        </div>
      </div>

      {open ? (
        <div ref={menu} id="site-menu" role="dialog" aria-modal="true" aria-label="Site menu" className="fixed inset-x-0 bottom-0 top-16 z-50 overflow-y-auto bg-bg">
          <div className="mx-auto max-w-[1200px] px-4 pb-16 pt-8 sm:px-6 lg:px-8">
            <div className="grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
              {NAV_GROUPS.map((g) => (
                <nav key={g.title} aria-label={g.title}>
                  <p className="eyebrow mb-3">{g.title}</p>
                  <ul className="space-y-1">
                    {g.links.map((l) => (
                      <li key={l.href}>
                        <NavItem l={l} big onClick={() => close(false)} />
                      </li>
                    ))}
                  </ul>
                </nav>
              ))}
            </div>
            <div className="mt-12 flex flex-col gap-4 rounded-[20px] bg-surface p-6 ring-1 ring-line sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-lg font-medium">Check a unit before you pay for it.</p>
                <p className="text-sm text-muted">Anyone can look up any unit: holder, payments, releases and proof. No login.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="sm:hidden">
                  <NetworkPill />
                </span>
                <div className="sm:hidden">
                  <ConnectButton compact />
                </div>
                <Link href="/check" prefetch={false} className="btn btn-primary" onClick={() => close(false)}>
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

/** Footer network switch: the current build is a plain label; the other is a link only when its URL is configured. */
function NetworkSwitch() {
  const pills: { label: string; current: boolean; url: string | undefined; tone: string }[] = [
    { label: "Testnet", current: !IS_MAINNET, url: TESTNET_APP_URL, tone: "bg-orange-soft text-orange-ink ring-1 ring-orange/30" },
    { label: "Mainnet demo", current: IS_MAINNET, url: MAINNET_APP_URL, tone: "bg-accent-soft text-accent ring-1 ring-accent/30" },
  ];
  return (
    <ul className="flex gap-2 text-xs" aria-label="Network">
      {pills.map((p) => (
        <li key={p.label}>
          {p.current ? (
            <span className={clsx("inline-flex rounded-full px-3 py-2", p.tone)} aria-current="true">{p.label}</span>
          ) : p.url ? (
            <a href={p.url} className="inline-flex items-center gap-1 rounded-full px-3 py-2 text-text-2 underline decoration-line-strong underline-offset-4 ring-1 ring-line hover:text-text hover:decoration-text">
              {p.label} <ArrowUpRight className="h-3 w-3" aria-hidden />
            </a>
          ) : (
            <span className="inline-flex cursor-default rounded-full border border-dashed border-line-strong px-3 py-2 text-muted" title={`No ${p.label.toLowerCase()} build is linked from this deployment`}>
              {p.label}
              <span className="sr-only"> (not linked from this deployment)</span>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

export function Footer() {
  return (
    <footer className="mt-24 border-t border-line bg-surface">
      <div className="mx-auto grid max-w-[1200px] gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1.1fr_2fr] lg:px-8">
        <div className="space-y-5">
          <Logo />
          <p className="max-w-xs text-sm text-muted">Plote holds off-plan deposits in each unit&apos;s own on-chain account and releases them only on proof.</p>
          <div className="space-y-2">
            <p className="eyebrow">Network</p>
            <NetworkSwitch />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          {NAV_GROUPS.map((g) => (
            <nav key={g.title} aria-label={`${g.title} (footer)`}>
              <p className="mono mb-3 text-[11px] font-medium uppercase tracking-[0.12em] text-muted">{g.title}</p>
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
      <div className="border-t border-line">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-2 px-4 py-6 text-xs text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <span className="inline-flex items-center gap-2">
            <Mark size={18} title="" /> Plote: every off-plan home, its own account.
          </span>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Link href="/terms" prefetch={false} className="hover:text-text">Terms</Link>
            <Link href="/privacy" prefetch={false} className="hover:text-text">Privacy</Link>
            <span>Built for NEAR HACKATHON 2026 · MIT licence · Not financial or legal advice.</span>
          </span>
        </div>
      </div>
    </footer>
  );
}
