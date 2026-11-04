import { describe, expect, it } from "vitest";
import { extractVerdict, toContractVerdict } from "@/lib/server/verify";

const bare = { pass: true, reasons: [], phash: "8e71c0d2a4b39f05", exif_time: 1793739420000000000, gps: [6447118, 3474201], worker_commit: "abc" };

describe("HTTPS verdict extraction", () => {
  it("finds bare, string-wrapped and nested verdicts", () => {
    expect(extractVerdict(bare)?.verdict.pass).toBe(true);
    const w = extractVerdict({ status: "Completed", output: JSON.stringify(bare), attestation: "att-1" });
    expect(w?.attestation).toBe("att-1");
    expect(extractVerdict({ result: { Ok: { stdout: JSON.stringify(bare) } }, execution_id: 7 })?.attestation).toBe("7");
    expect(extractVerdict({ status: "Failed" })).toBeNull();
  });
  it("shapes the contract Verdict (U64 as string)", () => {
    const v = toContractVerdict(bare, "att");
    expect(typeof v.exif_time).toBe("string");
    expect(v.attestation).toBe("att");
    expect(v.nearest_distance).toBe(64);
    expect(v.reasons).toEqual([]);
  });
});
