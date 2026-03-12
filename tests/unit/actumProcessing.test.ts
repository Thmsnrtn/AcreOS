/**
 * T274 — Actum ACH Processing Tests
 * Tests ACH return code classification and retry logic.
 */

import { describe, it, expect } from "vitest";

// ─── Inline pure logic ────────────────────────────────────────────────────────

type AchReturnCategory =
  | "insufficient_funds"
  | "account_closed"
  | "invalid_account"
  | "unauthorized"
  | "administrative"
  | "other";

interface AchReturnCode {
  code: string;
  description: string;
  category: AchReturnCategory;
  retryable: boolean;
  daysToRetry: number | null;
  requiresNewBankInfo: boolean;
}

const ACH_RETURN_CODES: Record<string, AchReturnCode> = {
  R01: { code: "R01", description: "Insufficient Funds", category: "insufficient_funds", retryable: true, daysToRetry: 5, requiresNewBankInfo: false },
  R02: { code: "R02", description: "Account Closed", category: "account_closed", retryable: false, daysToRetry: null, requiresNewBankInfo: true },
  R03: { code: "R03", description: "No Account / Unable to Locate Account", category: "invalid_account", retryable: false, daysToRetry: null, requiresNewBankInfo: true },
  R04: { code: "R04", description: "Invalid Account Number", category: "invalid_account", retryable: false, daysToRetry: null, requiresNewBankInfo: true },
  R05: { code: "R05", description: "Unauthorized Debit to Consumer Account", category: "unauthorized", retryable: false, daysToRetry: null, requiresNewBankInfo: false },
  R07: { code: "R07", description: "Authorization Revoked by Customer", category: "unauthorized", retryable: false, daysToRetry: null, requiresNewBankInfo: false },
  R08: { code: "R08", description: "Payment Stopped", category: "unauthorized", retryable: false, daysToRetry: null, requiresNewBankInfo: false },
  R09: { code: "R09", description: "Uncollected Funds", category: "insufficient_funds", retryable: true, daysToRetry: 5, requiresNewBankInfo: false },
  R13: { code: "R13", description: "Invalid ACH Routing Number", category: "invalid_account", retryable: false, daysToRetry: null, requiresNewBankInfo: true },
};

function classifyAchReturn(returnCode: string): AchReturnCode {
  return ACH_RETURN_CODES[returnCode.toUpperCase()] || {
    code: returnCode,
    description: "Unknown Return Code",
    category: "other",
    retryable: false,
    daysToRetry: null,
    requiresNewBankInfo: false,
  };
}

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
