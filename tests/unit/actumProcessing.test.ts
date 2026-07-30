/**
 * T274 — ACH return-code taxonomy tests.
 *
 * 2026-07-29: this file used to re-declare its own 9-code copy of
 * ACH_RETURN_CODES and its own classifyAchReturn, so it asserted against a
 * duplicate and could not have caught drift in the shipped table. It now
 * imports the REAL taxonomy from server/services/actumProcessing.ts — which,
 * after the "be the rail, not the provider" ruling deleted the platform-merchant
 * Actum client, is the only thing that file contains, and is what the live
 * Stripe us_bank_account autopay path classifies returns against.
 */

import { describe, it, expect } from "vitest";
import {
  ACH_RETURN_CODES,
  classifyAchReturn,
  returnRevokesAuthorization,
  type AchReturnCategory,
} from "../../server/services/actumProcessing";

// ─── Thin wrappers over the real classifier ──────────────────────────────────

function shouldRetryPayment(returnCode: string): boolean {
  return classifyAchReturn(returnCode).retryable;
}

function getDaysUntilRetry(returnCode: string): number | null {
  return classifyAchReturn(returnCode).daysToRetry;
}

function requiresNewBankInfo(returnCode: string): boolean {
  return classifyAchReturn(returnCode).requiresNewBankInfo;
}

function getRetryableReturns(codes: string[]): string[] {
  return codes.filter(c => shouldRetryPayment(c));
}

function categorizeReturnCodes(codes: string[]): Record<AchReturnCategory, string[]> {
  const result: Record<AchReturnCategory, string[]> = {
    insufficient_funds: [],
    account_closed: [],
    invalid_account: [],
    unauthorized: [],
    administrative: [],
    other: [],
  };
  for (const code of codes) {
    const info = classifyAchReturn(code);
    result[info.category].push(code);
  }
  return result;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("classifyAchReturn", () => {
  it("classifies R01 as insufficient_funds", () => {
    const info = classifyAchReturn("R01");
    expect(info.category).toBe("insufficient_funds");
    expect(info.retryable).toBe(true);
    expect(info.requiresNewBankInfo).toBe(false);
  });

  it("classifies R02 as account_closed (not retryable, needs new bank info)", () => {
    const info = classifyAchReturn("R02");
    expect(info.category).toBe("account_closed");
    expect(info.retryable).toBe(false);
    expect(info.requiresNewBankInfo).toBe(true);
  });

  it("classifies R05 as unauthorized", () => {
    const info = classifyAchReturn("R05");
    expect(info.category).toBe("unauthorized");
    expect(info.retryable).toBe(false);
  });

  it("classifies R13 as invalid_account", () => {
    const info = classifyAchReturn("R13");
    expect(info.category).toBe("invalid_account");
    expect(info.requiresNewBankInfo).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(classifyAchReturn("r01").category).toBe("insufficient_funds");
    expect(classifyAchReturn("R01").category).toBe("insufficient_funds");
  });

  it("returns 'other' for unknown return code", () => {
    const info = classifyAchReturn("R99");
    expect(info.category).toBe("other");
    expect(info.retryable).toBe(false);
    expect(info.description).toBe("Unknown Return Code");
  });

  it("includes days to retry for retryable codes", () => {
    expect(classifyAchReturn("R01").daysToRetry).toBe(5);
    expect(classifyAchReturn("R09").daysToRetry).toBe(5);
    expect(classifyAchReturn("R02").daysToRetry).toBeNull();
  });
});

describe("shouldRetryPayment", () => {
  it("returns true for R01 (insufficient funds)", () => {
    expect(shouldRetryPayment("R01")).toBe(true);
  });

  it("returns true for R09 (uncollected funds)", () => {
    expect(shouldRetryPayment("R09")).toBe(true);
  });

  it("returns false for R02 (account closed)", () => {
    expect(shouldRetryPayment("R02")).toBe(false);
  });

  it("returns false for R07 (authorization revoked)", () => {
    expect(shouldRetryPayment("R07")).toBe(false);
  });

  it("returns false for unknown code", () => {
    expect(shouldRetryPayment("R99")).toBe(false);
  });
});

describe("requiresNewBankInfo", () => {
  it("returns true for R02, R03, R04, R13", () => {
    expect(requiresNewBankInfo("R02")).toBe(true);
    expect(requiresNewBankInfo("R03")).toBe(true);
    expect(requiresNewBankInfo("R04")).toBe(true);
    expect(requiresNewBankInfo("R13")).toBe(true);
  });

  it("returns false for R01 (just insufficient funds)", () => {
    expect(requiresNewBankInfo("R01")).toBe(false);
  });
});

describe("getRetryableReturns", () => {
  it("filters to only retryable return codes", () => {
    const codes = ["R01", "R02", "R09", "R07"];
    const retryable = getRetryableReturns(codes);
    expect(retryable).toEqual(["R01", "R09"]);
  });

  it("returns empty array when none are retryable", () => {
    expect(getRetryableReturns(["R02", "R05"])).toEqual([]);
  });
});

describe("categorizeReturnCodes", () => {
  it("groups codes by category", () => {
    const codes = ["R01", "R09", "R02", "R05", "R07"];
    const result = categorizeReturnCodes(codes);
    expect(result.insufficient_funds).toEqual(["R01", "R09"]);
    expect(result.account_closed).toEqual(["R02"]);
    expect(result.unauthorized).toEqual(["R05", "R07"]);
  });
});

describe("the shipped taxonomy is complete and self-consistent", () => {
  it("covers every consumer code R01–R29", () => {
    for (let n = 1; n <= 29; n++) {
      const code = `R${String(n).padStart(2, "0")}`;
      expect(ACH_RETURN_CODES[code], `${code} missing from the table`).toBeDefined();
      expect(ACH_RETURN_CODES[code].code).toBe(code);
    }
  });

  it("gives every retryable code a retry delay, and every non-retryable none", () => {
    for (const entry of Object.values(ACH_RETURN_CODES)) {
      if (entry.retryable) {
        expect(entry.daysToRetry, `${entry.code} retryable with no delay`).toBeGreaterThan(0);
      } else {
        expect(entry.daysToRetry, `${entry.code} non-retryable with a delay`).toBeNull();
      }
    }
  });

  it("never marks a code that demands new bank info as retryable", () => {
    // Re-presenting against an account we already know is wrong or gone is
    // both pointless and, for a revoked authorization, prohibited.
    for (const entry of Object.values(ACH_RETURN_CODES)) {
      if (entry.requiresNewBankInfo) {
        expect(entry.retryable, `${entry.code} retryable despite needing new bank info`).toBe(false);
      }
    }
  });

  it("treats revocation codes as authorization-killing (R05/R07/R08/R10/R29)", () => {
    for (const code of ["R05", "R07", "R08", "R10", "R29"]) {
      expect(
        returnRevokesAuthorization(classifyAchReturn(code)),
        `${code} must revoke the mandate`,
      ).toBe(true);
    }
  });

  it("does NOT treat R11 as a revocation (a corrected re-presentment is allowed)", () => {
    const r11 = classifyAchReturn("R11");
    expect(r11.retryable).toBe(true);
    expect(returnRevokesAuthorization(r11)).toBe(false);
  });

  it("does not revoke on a code it does not recognise", () => {
    expect(returnRevokesAuthorization(classifyAchReturn("R99"))).toBe(false);
  });
});
