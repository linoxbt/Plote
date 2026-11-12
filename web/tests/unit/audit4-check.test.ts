// /check must say NOT A PLOTE UNIT for anything that isn't a genuine estate, whatever its contract answers.
import { describe, expect, it, vi } from "vitest";
import { runCheck } from "@/components/check";
import type { TakenView } from "@/lib/types";

const available: TakenView = { exists: true, status: "Available", holder: null, paid: "0", released: "0", price: "1", label: "x", account: "a-1.scam.testnet", reserved_until: null, allocated_at: null };

describe("runCheck", () => {
  it("a look-alike estate reporting AVAILABLE is NOT A PLOTE UNIT, and its contract isn't even asked", async () => {
    const isTaken = vi.fn(async () => available);
    const o = await runCheck("a-1.scam.testnet", { genuine: async () => ({ genuine: false, why: "scam.testnet isn't one of Plote's estates." }), isTaken });
    expect(o.kind).toBe("not_plote");
    expect(isTaken).not.toHaveBeenCalled();
  });

  it("a genuine estate reporting a foreign unit account is NOT A PLOTE UNIT", async () => {
    const o = await runCheck("a-1.harmattan-court.plote.testnet", { genuine: async () => ({ genuine: true, how: "configured" }), isTaken: async () => ({ ...available, account: "attacker.testnet" }) });
    expect(o.kind).toBe("not_plote");
  });

  it("a genuine estate's available unit is AVAILABLE", async () => {
    const o = await runCheck("a-1.harmattan-court.plote.testnet", { genuine: async () => ({ genuine: true, how: "configured" }), isTaken: async () => ({ ...available, account: "a-1.harmattan-court.plote.testnet" }) });
    expect(o.kind).toBe("available");
  });
});
