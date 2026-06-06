/**
 * Data-procurement gate (Lena CFO lens, items 3 + 6).
 * Pins the $200-MRR phase gate and the 2%-of-MRR vendor-commit guardrail so a
 * paid data vendor can never be enabled in a margin-negative posture.
 */
import { describe, it, expect } from "vitest";
import {
  evaluatePaidProviderGate,
  MIN_MRR_FOR_PAID_DATA_DOLLARS,
  VENDOR_COMMIT_MRR_FRACTION,
} from "./data-procurement-policy";

describe("evaluatePaidProviderGate", () => {
  it("locks ALL paid data below the $200 MRR phase gate", () => {
    const r = evaluatePaidProviderGate({ trailingMrrDollars: 199, minMonthlyCommitCents: 0 });
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/locked below/i);
  });

  it("allows pay-per-call (no floor) once past the phase gate", () => {
    const r = evaluatePaidProviderGate({ trailingMrrDollars: 200, minMonthlyCommitCents: 0 });
    expect(r.allowed).toBe(true);
    expect(r.reason).toMatch(/pay-per-call/i);
  });

  it("blocks a flat-commit vendor whose floor exceeds 2% of MRR", () => {
    // At $1,000 MRR the 2% ceiling is $20.00 (2000¢). A $50/mo floor is over.
    const r = evaluatePaidProviderGate({ trailingMrrDollars: 1000, minMonthlyCommitCents: 5000 });
    expect(r.allowed).toBe(false);
    expect(r.commitCeilingCents).toBe(2000);
    expect(r.reason).toMatch(/exceeds/i);
  });

  it("allows a flat-commit vendor within the 2% ceiling", () => {
    // At $5,000 MRR the 2% ceiling is $100.00. A $50/mo floor is within.
    const r = evaluatePaidProviderGate({ trailingMrrDollars: 5000, minMonthlyCommitCents: 5000 });
    expect(r.allowed).toBe(true);
    expect(r.commitCeilingCents).toBe(10000);
  });

  it("the ceiling is exactly the configured fraction of MRR-in-cents", () => {
    const mrr = 3000;
    const r = evaluatePaidProviderGate({ trailingMrrDollars: mrr, minMonthlyCommitCents: 0 });
    expect(r.commitCeilingCents).toBe(Math.floor(mrr * 100 * VENDOR_COMMIT_MRR_FRACTION));
  });

  it("treats non-finite / negative MRR as 0 (fail-safe lock)", () => {
    expect(evaluatePaidProviderGate({ trailingMrrDollars: NaN, minMonthlyCommitCents: 0 }).allowed).toBe(false);
    expect(evaluatePaidProviderGate({ trailingMrrDollars: -5, minMonthlyCommitCents: 0 }).allowed).toBe(false);
  });

  it("exposes the documented phase-gate constant", () => {
    expect(MIN_MRR_FOR_PAID_DATA_DOLLARS).toBe(200);
  });
});
