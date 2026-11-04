import { describe, expect, it } from "vitest";
import { describeEvent, eventRows, findEvent, parseEventLog, parseEventLogs } from "@/lib/events";
import { parseOutcome } from "@/lib/near";

const ev = (event: string, data: unknown, standard = "plote") => `EVENT_JSON:${JSON.stringify({ standard, version: "1.0.0", event, data })}`;

describe("EVENT_JSON parsing", () => {
  it("parses plote events", () => {
    const e = parseEventLog(ev("allocated", [{ unit_id: "a-4b", holder: "buyer-1.testnet" }]));
    expect(e).toEqual({ standard: "plote", version: "1.0.0", event: "allocated", data: [{ unit_id: "a-4b", holder: "buyer-1.testnet" }] });
  });
  it("ignores non-event logs and malformed JSON", () => {
    expect(parseEventLog("hello")).toBeNull();
    expect(parseEventLog("EVENT_JSON:{bad")).toBeNull();
    expect(parseEventLog('EVENT_JSON:{"foo":1}')).toBeNull();
    expect(parseEventLog(" EVENT_JSON:{}")).toBeNull();
    expect(parseEventLogs(["x", ev("unfrozen", [{}]), "y"])).toHaveLength(1);
  });
  it("normalises a single data object into an array", () => {
    expect(parseEventLog(ev("frozen", { reason: "r", refunds_open: true }))?.data).toEqual([{ reason: "r", refunds_open: true }]);
  });
  it("flattens rows with the unit id (plote unit_id or nep171 token_ids)", () => {
    const rows = eventRows(parseEventLogs([
      ev("released", [{ unit_id: "a-1a", amount: "1", to: "dev.testnet" }, { unit_id: "a-4b", amount: "2", to: "dev.testnet" }]),
      ev("nft_mint", [{ owner_id: "b.testnet", token_ids: ["a-4b"] }], "nep171"),
      ev("qs_signed", [{ milestone: 1, by: "qs.testnet", veto_until: "1" }]),
    ]));
    expect(rows.map((r) => [r.event, r.unit])).toEqual([["released", "a-1a"], ["released", "a-4b"], ["nft_mint", "a-4b"], ["qs_signed", null]]);
    expect(describeEvent(rows[3])).toBe("Surveyor signed milestone 2");
  });
  it("finds an event's data", () => {
    const evs = parseEventLogs([ev("evidence_submitted", [{ evidence_id: "17", milestone: 1, sha256: "ab" }])]);
    expect(findEvent(evs, "evidence_submitted")).toEqual({ evidence_id: "17", milestone: 1, sha256: "ab" });
    expect(findEvent(evs, "verdict")).toBeNull();
  });
});

describe("transaction outcomes", () => {
  const b64 = (s: string) => btoa(s);
  it("collects logs and the return value", () => {
    const r = parseOutcome({
      transaction: { hash: "HASH" },
      transaction_outcome: { outcome: { logs: [] } },
      receipts_outcome: [{ outcome: { logs: [ev("capture_opened", [{ milestone: 0, by: "a", expires_at: "9" }])], status: { SuccessValue: "" } } }],
      status: { SuccessValue: b64('"K7RQ4M"') },
    });
    expect(r.hash).toBe("HASH");
    expect(r.returnValue).toBe("K7RQ4M");
    expect(r.events[0].event).toBe("capture_opened");
  });
  it("throws the contract error code on failure", () => {
    expect(() => parseOutcome({ transaction: { hash: "H" }, status: { Failure: { ActionError: { kind: { FunctionCallError: { ExecutionError: "Smart contract panicked: E_UNIT_TAKEN: unit a-4b is not available" } } } } } })).toThrowError(/holds this unit/);
  });
});
