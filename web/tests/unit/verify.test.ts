import { describe, expect, it } from "vitest";
import { extractVerdict, parseJsonExact, toVerdictArg, verdictBinds } from "@/lib/server/verify";

const SHA = "ab".repeat(32);
const bare = {
  pass: true, reasons: [], phash: "8e71c0d2a4b39f05", exif_time: "1793739420000000000", gps: [6447118, 3474201], worker_commit: "abc",
  evidence_id: 7, sha256: SHA, ai_model: "Qwen/Qwen3-VL-30B-A3B-Instruct", some_new_field: { x: 1 },
};

describe("HTTPS verdict extraction", () => {
  it("finds bare, string-wrapped and nested verdicts", () => {
    expect(extractVerdict(bare)?.verdict.pass).toBe(true);
    const w = extractVerdict({ status: "Completed", output: JSON.stringify(bare), attestation: "att-1" });
    expect(w?.attestation).toBe("att-1");
    expect(extractVerdict({ result: { Ok: { stdout: JSON.stringify(bare) } }, execution_id: 7 })?.attestation).toBe("7");
    expect(extractVerdict({ status: "Failed" })).toBeNull();
  });
  it("passes the worker's stdout through unchanged (echo, ai_model, unknown fields), filling only attestation", () => {
    const v = toVerdictArg(bare, "att");
    expect(v).toEqual({ ...bare, attestation: "att" });
    expect(toVerdictArg({ ...bare, attestation: "own" }, "att").attestation).toBe("own");
  });
  it("keeps a nanosecond exif_time exact, also inside a JSON string", () => {
    const raw = '{"output":"{\\"pass\\":true,\\"exif_time\\":1793739420000000123,\\"gps\\":[6447118,-3474201],\\"distance_m\\":12.5,\\"note\\":\\"1234567890123456789\\"}"}';
    const v = extractVerdict(parseJsonExact(raw))!.verdict;
    expect(v.exif_time).toBe("1793739420000000123");
    expect(v.gps).toEqual([6447118, -3474201]);
    expect(v.distance_m).toBe(12.5);
    expect(v.note).toBe("1234567890123456789");
    expect(parseJsonExact('{"a":12345678901234567890,"b":"x\\"1"}')).toEqual({ a: "12345678901234567890", b: 'x"1' });
  });
  it("checks the evidence_id / sha256 echo the estate requires", () => {
    expect(verdictBinds(bare, "7", SHA.toUpperCase())).toBe(true);
    expect(verdictBinds({ ...bare, evidence_id: "7" }, "7", SHA)).toBe(true);
    expect(verdictBinds(bare, "8", SHA)).toBe(false);
    expect(verdictBinds({ ...bare, sha256: null }, "7", SHA)).toBe(false);
    expect(verdictBinds({ pass: true }, "7", SHA)).toBe(false);
  });
});
