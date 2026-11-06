import { describe, expect, it } from "vitest";
import { canDeclareDefault, defaultOpensAt, defaultPayout, nextRefundOpensAt } from "@/lib/default";
import { loginKeyContract } from "@/lib/estates";
import { fromWorldPx, worldPx } from "@/lib/geo";
import type { MilestoneView, UnitView } from "@/lib/types";

const DAY = 86_400_000_000_000n; // ns
const params = { default_grace_ns: (14n * DAY).toString() };
const unit = (paid: string, plan: [bigint, string][], status: UnitView["status"] = "Allocated") => ({
  status,
  paid,
  plan: plan.map(([due, cumulative]) => ({ due_at: due.toString(), cumulative })),
});

describe("S5 default timing (mirrors resale.rs overdue)", () => {
  it("opens at the earliest unpaid instalment's due date + grace", () => {
    const u = unit("10000000", [[100n * DAY, "10000000"], [200n * DAY, "20000000"], [150n * DAY, "15000000"]]);
    expect(defaultOpensAt(u, params)).toBe(164n * DAY);
  });
  it("is strictly after due + grace, like the contract", () => {
    const u = unit("0", [[100n * DAY, "1"]]);
    expect(canDeclareDefault(u, params, 114n * DAY)).toBe(false);
    expect(canDeclareDefault(u, params, 114n * DAY + 1n)).toBe(true);
  });
  it("never for paid-up plans or units that aren't Allocated", () => {
    expect(defaultOpensAt(unit("50", [[1n, "50"]]), params)).toBeNull();
    expect(defaultOpensAt(unit("0", [[1n, "50"]], "InDefault"), params)).toBeNull();
    expect(defaultOpensAt(unit("0", [[1n, "50"]], "HandedOver"), params)).toBeNull();
  });
  it("pays the holder paid − 5% and the developer 5%", () => {
    expect(defaultPayout("8500000000", 500)).toEqual({ ask: 8500000000n, penalty: 425000000n, toHolder: 8075000000n });
    expect(defaultPayout("0", 500)).toEqual({ ask: 0n, penalty: 0n, toHolder: 0n });
  });
});

describe("M8 refund countdown", () => {
  const m = (i: number, status: MilestoneView["status"], at: bigint, veto_passed = false) =>
    ({ index: i, status, veto_passed, refunds_open_at: at.toString() }) as MilestoneView;
  it("is the earliest deadline + grace among stages not yet approved", () => {
    expect(nextRefundOpensAt([m(0, "Approved", 10n, true), m(1, "Open", 30n), m(2, "Missed", 20n)])).toBe("20");
    expect(nextRefundOpensAt([m(0, "Approved", 10n, false), m(1, "Open", 30n)])).toBe("10");
  });
  it("is null when everything is approved", () => {
    expect(nextRefundOpensAt([m(0, "Approved", 10n, true)])).toBeNull();
    expect(nextRefundOpensAt(undefined)).toBeNull();
  });
});

describe("§9.1 login key contract from the URL", () => {
  it("uses the estate in the path, else the first configured estate", () => {
    expect(loginKeyContract("/estates/baobab-heights/units/b-2a")).toBe("baobab-heights.plote.testnet");
    expect(loginKeyContract("/buy/playground/p-01")).toBe("playground.plote.testnet");
    expect(loginKeyContract("/me/units/harmattan-court/a-4b")).toBe("harmattan-court.plote.testnet");
    expect(loginKeyContract("/qs/playground/capture")).toBe("playground.plote.testnet");
    expect(loginKeyContract("/dev/estates/new")).toBe("harmattan-court.plote.testnet");
    expect(loginKeyContract("/")).toBe("harmattan-court.plote.testnet");
  });
});

describe("pick map projection", () => {
  it("fromWorldPx inverts worldPx", () => {
    for (const [lat, lon, z] of [[6.447, 3.474, 15], [-33.9, 18.4, 10], [51.5, -0.12, 17]] as const) {
      const [x, y] = worldPx(lat, lon, z);
      const [la, lo] = fromWorldPx(x, y, z);
      expect(la).toBeCloseTo(lat, 9);
      expect(lo).toBeCloseTo(lon, 9);
    }
  });
});
