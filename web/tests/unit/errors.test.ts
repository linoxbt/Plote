import { describe, expect, it } from "vitest";
import { ERROR_CODES, ERROR_MESSAGES, explainError, messageForCode, parseErrorCode, PloteError } from "@/lib/errors";

// INTERFACE.md §1.5, verbatim
const INTERFACE_CODES = `E_NOT_DEVELOPER E_NOT_SURVEYOR E_NOT_HOLDER E_NOT_RESERVER E_NOT_RELAYER E_NOT_LENDER E_NOT_GUARDIAN E_UNIT_TAKEN
E_UNIT_NOT_FOUND E_UNIT_EXISTS E_BAD_UNIT_ID E_BALANCE_PENDING E_RESERVATION_ACTIVE E_NO_RESERVATION E_DEPOSIT
E_MILESTONE_STATE E_NOT_VERIFIED E_VETO_WINDOW E_FROZEN E_NO_REFUND_YET E_NOTHING_TO_REFUND E_LIEN E_LISTING
E_UNDERPAID E_IN_FLIGHT E_BUDGET E_BAD_TOKEN E_BPS_SUM E_DEADLINES E_NO_CHALLENGE E_CHALLENGE_EXPIRED
E_NOTHING_TO_SWEEP E_NO_EXCESS E_NOT_ELIGIBLE E_ALREADY_VOTED E_PROPOSAL_STATE E_PROPOSAL_OPEN E_PLAYGROUND_ONLY
E_NOT_DUE E_HANDOVER E_RECOVERY E_TOO_MANY E_BAD_ARGS E_NOT_UNIT E_ALREADY_SOLD`.split(/\s+/);

describe("error mapping", () => {
  it("maps every code in INTERFACE §1.5 to a plain sentence", () => {
    for (const c of INTERFACE_CODES) {
      expect(ERROR_MESSAGES[c as keyof typeof ERROR_MESSAGES], c).toBeTruthy();
      expect(messageForCode(c)).toMatch(/[.!]$/);
    }
    expect(ERROR_CODES.sort()).toEqual([...INTERFACE_CODES].sort());
  });
  it("uses the spec's sentence for E_UNIT_TAKEN", () => {
    expect(messageForCode("E_UNIT_TAKEN")).toBe("Someone already holds this unit.");
  });
  it("finds the code inside wrapped panic messages", () => {
    expect(parseErrorCode("E_UNIT_TAKEN: unit a-4b is not available")).toBe("E_UNIT_TAKEN");
    expect(parseErrorCode('{"ActionError":{"kind":{"FunctionCallError":{"ExecutionError":"Smart contract panicked: E_FROZEN: releases frozen"}}}}')).toBe("E_FROZEN");
    expect(parseErrorCode("no code here")).toBeNull();
  });
  it("explains arbitrary throwables", () => {
    expect(explainError(new Error("Smart contract panicked: E_NO_REFUND_YET: wait")).code).toBe("E_NO_REFUND_YET");
    expect(explainError(new Error("User rejected the request")).code).toBe("WALLET_REJECTED");
    expect(explainError(new TypeError("Failed to fetch")).code).toBe("RPC_UNAVAILABLE");
    expect(explainError("weird").code).toBe("UNKNOWN");
    const p = new PloteError("E_LIEN", "raw text");
    expect(explainError(p)).toEqual({ code: "E_LIEN", message: ERROR_MESSAGES.E_LIEN, raw: "raw text" });
  });
});
