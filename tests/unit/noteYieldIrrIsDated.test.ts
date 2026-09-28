/**
 * DEFECT-0132 — a note's IRR-to-date is dated to the day it is asked, and
 * counts every dollar received.
 *
 * computeYields (server/routes-notes.ts) built the IRR stream from month 1,
 * so a payment in the acquisition month was dropped. It put the "if paid off
 * today" terminal value in the month after the LAST payment rather than today,
 * so a note that stopped paying two years ago still showed the yield it had
 * when it stopped. It ignored cash held as unapplied (partial payments). And
 * the effective net yield was floored at zero, so a loss rendered as 0.00%.
 */
import { describe, it, expect } from "vitest";
import { computeYields } from "../../server/routes-notes";

const base = {
  acquisitionPriceCents: 1_000_000,
  currentBalanceCents: 1_000_000,
  interestRateBps: 1200,
  paymentAmountCents: 11_122,
  termMonths: 120,
  acquisitionDate: "2024-01-15",
};

describe("DEFECT-0132 — IRR to date", () => {
  it("a payment in the acquisition month is counted", () => {
    const y = computeYields({
      ...base,
      currentBalanceCents: 900_000,
      payments: [{ paymentDate: "2024-01-20", principalCents: 100_000, interestCents: 0 }],
      asOf: new Date("2024-02-10T00:00:00Z"),
    });
    // Paid 1,000 back and holds 9,000: break-even, not a loss.
    expect(y.irrToDate).not.toBeNull();
    expect(Math.abs(y.irrToDate!)).toBeLessThan(1e-6);
  });

  it("the payoff value sits at today, not after the last payment", () => {
    const y = computeYields({
      ...base,
      payments: [{ paymentDate: "2024-02-15", principalCents: 0, interestCents: 10_000 }],
      asOf: new Date("2026-02-15T00:00:00Z"),
    });
    // One month of interest in 25 months is about 0.5% a year — not 12.7%.
    expect(y.irrToDate).not.toBeNull();
    expect(y.irrToDate!).toBeLessThan(0.01);
    expect(y.irrToDate!).toBeGreaterThan(0);
  });

  it("cash held as unapplied is cash received", () => {
    const withoutPartial = computeYields({
      ...base,
      payments: [],
      asOf: new Date("2024-03-15T00:00:00Z"),
    });
    const withPartial = computeYields({
      ...base,
      payments: [{ paymentDate: "2024-02-15", principalCents: 0, interestCents: 0, unappliedCents: 5_000 }],
      asOf: new Date("2024-03-15T00:00:00Z"),
    });
    expect(withPartial.irrToDate!).toBeGreaterThan(withoutPartial.irrToDate!);
  });

  it("a loss is shown as a loss", () => {
    const y = computeYields({
      ...base,
      currentBalanceCents: 500_000,
      payments: [],
      asOf: new Date("2025-01-15T00:00:00Z"),
    });
    expect(y.irrToDate!).toBeLessThan(0);
    expect(y.effectiveNetYield!).toBeLessThan(0);
    expect(y.effectiveNetYield!).toBeCloseTo(y.irrToDate! - 0.0025, 10);
  });
});
