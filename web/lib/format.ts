// Formatting helpers. USDC is 6 decimals; chain times are nanoseconds (U64 strings).

import { FX_URL } from "./config";

export const USDC_DECIMALS = 6;
const USDC_UNIT = 10n ** BigInt(USDC_DECIMALS);

export function toBig(v: string | number | bigint | null | undefined): bigint {
  if (v === null || v === undefined || v === "") return 0n;
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(Math.trunc(v));
  try {
    return BigInt(v);
  } catch {
    return 0n;
  }
}

function groupThousands(s: string): string {
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Format USDC base units.
 *  formatUsdc("41200000000") → "41,200"
 *  formatUsdc("1500000", { dp: 2 }) → "1.50"
 * By default shows up to 2 decimals, dropping a ".00" fraction.
 */
export function formatUsdc(base: string | bigint | number | null | undefined, opts: { dp?: number; trim?: boolean } = {}): string {
  const dp = opts.dp ?? 2;
  const trim = opts.trim ?? opts.dp === undefined;
  const v = toBig(base);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const whole = abs / USDC_UNIT;
  let frac = (abs % USDC_UNIT).toString().padStart(USDC_DECIMALS, "0").slice(0, Math.min(dp, USDC_DECIMALS));
  if (trim) frac = /^0*$/.test(frac) ? "" : frac.replace(/0+$/, "").padEnd(Math.min(2, dp), "0");
  const out = groupThousands(whole.toString()) + (frac ? "." + frac : "");
  return (neg ? "-" : "") + out;
}

/** "$41,200" */
export function formatUsd(base: string | bigint | number | null | undefined, opts: { dp?: number } = {}): string {
  const s = formatUsdc(base, opts);
  return s.startsWith("-") ? "-$" + s.slice(1) : "$" + s;
}

/** Parse a human amount ("12.5", "1,000") to USDC base units. Throws on bad input. */
export function parseUsdc(input: string): string {
  const s = input.replace(/[,\s$]/g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error("Enter an amount like 1250 or 1250.50");
  const [w, f = ""] = s.split(".");
  if (f.length > USDC_DECIMALS) throw new Error("USDC has at most 6 decimal places");
  return (BigInt(w) * USDC_UNIT + BigInt(f.padEnd(USDC_DECIMALS, "0") || "0")).toString();
}

/** Spoken form for aria-label: "1,200 US dollars". */
export function usdcAriaLabel(base: string | bigint | number | null | undefined): string {
  const s = formatUsdc(base);
  const [w, f] = s.split(".");
  return f ? `${w} US dollars and ${parseInt(f.padEnd(2, "0").slice(0, 2), 10)} cents` : `${w} US dollars`;
}

/** Percentage of part/whole as an integer 0..100 (floored). */
export function pct(part: string | bigint, whole: string | bigint): number {
  const w = toBig(whole);
  if (w <= 0n) return 0;
  const p = (toBig(part) * 10000n) / w;
  return Math.max(0, Math.min(100, Number(p) / 100));
}

export function bpsToPct(bps: number): string {
  const v = bps / 100;
  return (Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1)) + "%";
}

/** min(paid, price) × bps / 10_000, the contract's release math. */
export function shareOf(base: string | bigint, bps: number): bigint {
  return (toBig(base) * BigInt(bps)) / 10000n;
}

// ---------- NEAR ----------

const YOCTO = 10n ** 24n;

export function formatNear(yocto: string | bigint | null | undefined, dp = 3): string {
  const v = toBig(yocto);
  const whole = v / YOCTO;
  const frac = (v % YOCTO).toString().padStart(24, "0").slice(0, dp).replace(/0+$/, "");
  return groupThousands(whole.toString()) + (frac ? "." + frac : "");
}

export function nearToYocto(near: string): string {
  const [w, f = ""] = near.split(".");
  return (BigInt(w || "0") * YOCTO + BigInt(f.padEnd(24, "0").slice(0, 24) || "0")).toString();
}

// ---------- time ----------

/** Wall clock (ms). For event handlers; render code should use the useNow() hook. */
export const nowMs = (): number => Date.now();

export function nsToMs(ns: string | number | bigint | null | undefined): number {
  return Number(toBig(ns) / 1_000_000n);
}

export function msToNs(ms: number): string {
  return (BigInt(Math.trunc(ms)) * 1_000_000n).toString();
}

export function nsToDate(ns: string | null | undefined): Date | null {
  if (!ns) return null;
  const ms = nsToMs(ns);
  return ms > 0 ? new Date(ms) : null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "3 Feb 2027" (UTC, so server and client render the same). */
export function formatDate(ns: string | null | undefined): string {
  const d = nsToDate(ns);
  if (!d) return "—";
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "3 Feb 2027, 14:05 UTC" */
export function formatDateTime(ns: string | null | undefined): string {
  const d = nsToDate(ns);
  if (!d) return "—";
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${formatDate(ns)}, ${hh}:${mm} UTC`;
}

/** Human duration: 90_000 → "1m 30s", 3_700_000 → "1h 1m", 3 days → "3d 0h". */
export function formatDuration(ms: number): string {
  const abs = Math.max(0, Math.floor(Math.abs(ms) / 1000));
  const d = Math.floor(abs / 86400);
  const h = Math.floor((abs % 86400) / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = abs % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s.toString().padStart(2, "0")}s`;
  return `${s}s`;
}

/** "5 minutes ago", "in 2 hours". `now` in ms. */
export function timeAgo(ns: string | null | undefined, now: number = Date.now()): string {
  if (!ns) return "—";
  const diff = now - nsToMs(ns);
  const future = diff < 0;
  const s = Math.floor(Math.abs(diff) / 1000);
  let out: string;
  if (s < 45) out = "a few seconds";
  else if (s < 90) out = "a minute";
  else if (s < 3600) out = `${Math.round(s / 60)} minutes`;
  else if (s < 5400) out = "an hour";
  else if (s < 86400) out = `${Math.round(s / 3600)} hours`;
  else if (s < 172800) out = "a day";
  else if (s < 2592000) out = `${Math.round(s / 86400)} days`;
  else if (s < 31536000) out = `${Math.round(s / 2592000)} months`;
  else out = `${Math.round(s / 31536000)} years`;
  return future ? `in ${out}` : `${out} ago`;
}

/** Countdown to a ns deadline: "12m 03s left" / "ended". */
export function countdown(untilNs: string | null | undefined, now: number = Date.now()): { ended: boolean; label: string; msLeft: number } {
  if (!untilNs) return { ended: true, label: "—", msLeft: 0 };
  const left = nsToMs(untilNs) - now;
  if (left <= 0) return { ended: true, label: "ended", msLeft: 0 };
  return { ended: false, label: `${formatDuration(left)} left`, msLeft: left };
}

// ---------- accounts ----------

/** Middle-truncate long account IDs: "a-4b.harmattan-court.plote.testnet" → "a-4b.harma…e.testnet". */
export function truncateAccount(id: string | null | undefined, max = 24): string {
  if (!id) return "—";
  if (id.length <= max) return id;
  const keep = max - 1;
  const head = Math.ceil(keep / 2);
  const tail = Math.floor(keep / 2);
  return `${id.slice(0, head)}…${id.slice(id.length - tail)}`;
}

/** "a-4b" → "A-4B" */
export function unitDisplay(id: string): string {
  return id.toUpperCase();
}

// ---------- FX (≈₦, display only) ----------

const FX_KEY = "plote:fx:usd-ngn";
const FX_TTL_MS = 60 * 60 * 1000;
let fxMemo: { rate: number; at: number } | null = null;
let fxInflight: Promise<number | null> | null = null;

export function formatNaira(base: string | bigint | number | null | undefined, rate: number): string {
  const usd = Number(toBig(base)) / 1e6;
  const n = Math.round(usd * rate);
  return "₦" + groupThousands(String(n));
}

/** USD→NGN rate, cached 1 h (memory + localStorage). Returns null when unavailable. */
export async function getFxRate(): Promise<number | null> {
  const now = Date.now();
  if (fxMemo && now - fxMemo.at < FX_TTL_MS) return fxMemo.rate;
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(FX_KEY) : null;
    if (raw) {
      const p = JSON.parse(raw) as { rate: number; at: number };
      if (p && typeof p.rate === "number" && now - p.at < FX_TTL_MS) {
        fxMemo = p;
        return p.rate;
      }
    }
  } catch {
    /* storage unavailable */
  }
  if (fxInflight) return fxInflight;
  fxInflight = (async () => {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(FX_URL, { signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) return null;
      const j = (await res.json()) as { rates?: Record<string, number> };
      const rate = j.rates?.NGN;
      if (typeof rate !== "number" || !isFinite(rate) || rate <= 0) return null;
      fxMemo = { rate, at: Date.now() };
      try {
        window.localStorage.setItem(FX_KEY, JSON.stringify(fxMemo));
      } catch {
        /* ignore */
      }
      return rate;
    } catch {
      return null;
    } finally {
      fxInflight = null;
    }
  })();
  return fxInflight;
}

// ---------- misc ----------

export function shortHash(h: string | null | undefined, n = 6): string {
  if (!h) return "—";
  return h.length <= n * 2 + 1 ? h : `${h.slice(0, n)}…${h.slice(-n)}`;
}
