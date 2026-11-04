import { describe, expect, it } from "vitest";
import {
  bpsToPct, countdown, formatDate, formatDuration, formatNaira, formatNear, formatUsd, formatUsdc, nearToYocto, parseUsdc, pct, shareOf,
  timeAgo, truncateAccount, usdcAriaLabel,
} from "@/lib/format";

describe("USDC formatting (6 dp)", () => {
  it("formats whole amounts with thousands separators", () => {
    expect(formatUsdc("41200000000")).toBe("41,200");
    expect(formatUsd("85000000000")).toBe("$85,000");
  });
  it("keeps cents and drops .00", () => {
    expect(formatUsdc("1500000")).toBe("1.50");
    expect(formatUsdc("1000000")).toBe("1");
    expect(formatUsdc("1234567")).toBe("1.23");
  });
  it("supports explicit decimals", () => {
    expect(formatUsdc("1234567", { dp: 6 })).toBe("1.234567");
    expect(formatUsdc("1000000", { dp: 2 })).toBe("1.00");
  });
  it("handles zero, null and garbage", () => {
    expect(formatUsdc("0")).toBe("0");
    expect(formatUsdc(null)).toBe("0");
    expect(formatUsdc("nope")).toBe("0");
    expect(formatUsd("-2500000")).toBe("-$2.50");
  });
  it("parses human amounts to base units", () => {
    expect(parseUsdc("12.5")).toBe("12500000");
    expect(parseUsdc("1,000")).toBe("1000000000");
    expect(parseUsdc("$0.000001")).toBe("1");
    expect(() => parseUsdc("1.0000001")).toThrow();
    expect(() => parseUsdc("abc")).toThrow();
  });
  it("speaks amounts for screen readers", () => {
    expect(usdcAriaLabel("1200000000")).toBe("1,200 US dollars");
    expect(usdcAriaLabel("1500000")).toBe("1 US dollars and 50 cents");
  });
  it("approximates naira", () => {
    expect(formatNaira("2000000", 1500)).toBe("₦3,000");
  });
});

describe("ratios and release math", () => {
  it("pct floors into 0..100", () => {
    expect(pct("8500000000", "85000000000")).toBe(10);
    expect(pct("1", "0")).toBe(0);
    expect(pct("200", "100")).toBe(100);
  });
  it("bps", () => {
    expect(bpsToPct(2000)).toBe("20%");
    expect(bpsToPct(2550)).toBe("25.5%");
    expect(shareOf("85000000000", 3000)).toBe(25500000000n);
    expect(shareOf("10", 3333)).toBe(3n); // rounds down like the contract
  });
});

describe("NEAR amounts", () => {
  it("round-trips", () => {
    expect(nearToYocto("0.05")).toBe("50000000000000000000000");
    expect(formatNear("50000000000000000000000")).toBe("0.05");
    expect(formatNear("1000000000000000000000000")).toBe("1");
  });
});

describe("time", () => {
  const now = Date.UTC(2026, 10, 4, 12, 0, 0);
  const ns = (ms: number) => (BigInt(ms) * 1_000_000n).toString();
  it("formats dates in UTC", () => {
    expect(formatDate(ns(Date.UTC(2027, 1, 1, 12)))).toBe("1 Feb 2027");
    expect(formatDate(null)).toBe("—");
  });
  it("time ago / in", () => {
    expect(timeAgo(ns(now - 5 * 60_000), now)).toBe("5 minutes ago");
    expect(timeAgo(ns(now + 2 * 3600_000), now)).toBe("in 2 hours");
    expect(timeAgo(ns(now - 3 * 86400_000), now)).toBe("3 days ago");
  });
  it("durations and countdowns", () => {
    expect(formatDuration(90_000)).toBe("1m 30s");
    expect(formatDuration(3_700_000)).toBe("1h 1m");
    expect(formatDuration(3 * 86400_000)).toBe("3d 0h");
    expect(countdown(ns(now + 120_000), now)).toEqual({ ended: false, label: "2m 00s left", msLeft: 120_000 });
    expect(countdown(ns(now - 1), now).ended).toBe(true);
  });
});

describe("accounts", () => {
  it("middle-truncates", () => {
    const a = "a-4b.harmattan-court.plote.testnet";
    const t = truncateAccount(a, 20);
    expect(t.length).toBe(20);
    expect(t).toContain("…");
    expect(t.startsWith("a-4b.harma")).toBe(true);
    expect(t.endsWith("testnet")).toBe(true);
    expect(truncateAccount("bob.testnet")).toBe("bob.testnet");
    expect(truncateAccount(null)).toBe("—");
  });
});
