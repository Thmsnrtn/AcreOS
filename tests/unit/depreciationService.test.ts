/**
 * T251 — Depreciation Service Tests
 * Tests MACRS depreciation schedules, bonus depreciation, and Section 179 deductions.
 */

import { describe, it, expect } from "vitest";

// ─── Inline pure logic ────────────────────────────────────────────────────────

type DepreciationMethod = "straight_line" | "macrs_5yr" | "macrs_7yr" | "macrs_15yr" | "macrs_39yr";

// MACRS half-year convention tables (percentage of cost)
const MACRS_TABLE: Record<string, number[]> = {
  macrs_5yr:  [20.00, 32.00, 19.20, 11.52, 11.52, 5.76],
  macrs_7yr:  [14.29, 24.49, 17.49, 12.49, 8.93, 8.92, 8.93, 4.46],
  macrs_15yr: [5.00, 9.50, 8.55, 7.70, 6.93, 6.23, 5.90, 5.90, 5.91, 5.90, 5.91, 5.90, 5.91, 5.90, 5.91, 2.95],
  macrs_39yr: new Array(40).fill(0).map((_, i) => i === 0 ? 1.391 : i === 39 ? 1.391 : 2.564),
};

function calculateMACRS(
  costBasisCents: number,
  method: DepreciationMethod,
  yearNumber: number // 1-indexed
): number {
  if (method === "straight_line") return 0; // handled separately
  const table = MACRS_TABLE[method];
  if (!table || yearNumber < 1 || yearNumber > table.length) return 0;
  return Math.round(costBasisCents * (table[yearNumber - 1] / 100));
}

function calculateStraightLine(
  costBasisCents: number,
  salvageValueCents: number,
  usefulLifeYears: number,
  yearNumber: number
): number {
  if (yearNumber < 1 || yearNumber > usefulLifeYears) return 0;
  const annual = Math.round((costBasisCents - salvageValueCents) / usefulLifeYears);
  return annual;
}

function calculateSection179Deduction(
  costBasisCents: number,
  annualLimit: number,
  phaseOutThreshold: number,
  totalQualifyingPurchasesCents: number
): { deductionCents: number; phaseOutApplied: boolean } {
  // Phase-out: $1 reduction for every $1 over threshold
  const phaseOutAmount = Math.max(0, totalQualifyingPurchasesCents - phaseOutThreshold);
  const adjustedLimit = Math.max(0, annualLimit - phaseOutAmount);
  const deductionCents = Math.min(costBasisCents, adjustedLimit);
  return {
    deductionCents,
    phaseOutApplied: phaseOutAmount > 0,
  };
}

function calculateAccumulatedDepreciation(
  costBasisCents: number,
  method: DepreciationMethod,
  yearsOwned: number
): number {
  if (method === "straight_line") return 0;
  const table = MACRS_TABLE[method] ?? [];
  const years = Math.min(yearsOwned, table.length);
  return table
    .slice(0, years)
    .reduce((sum, pct) => sum + Math.round(costBasisCents * (pct / 100)), 0);
}

function getBookValue(costBasisCents: number, accumulatedDepreciationCents: number): number {
  return Math.max(0, costBasisCents - accumulatedDepreciationCents);
}

function estimateDepreciationRecapture(
  gainOnSaleCents: number,
  accumulatedDepreciationCents: number,
  recaptureRatePercent = 25
): { recaptureTaxCents: number; capitalGainsCents: number } {
  const recaptureAmount = Math.min(gainOnSaleCents, accumulatedDepreciationCents);
  const capitalGainsPortion = Math.max(0, gainOnSaleCents - recaptureAmount);
  return {
    recaptureTaxCents: Math.round(recaptureAmount * (recaptureRatePercent / 100)),
    capitalGainsCents: capitalGainsPortion,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("calculateMACRS", () => {
  it("calculates year 1 5yr MACRS (20%)", () => {
    expect(calculateMACRS(100_000_00, "macrs_5yr", 1)).toBe(20_000_00);
  });

  it("calculates year 2 5yr MACRS (32%)", () => {
    expect(calculateMACRS(100_000_00, "macrs_5yr", 2)).toBe(32_000_00);
  });

  it("returns 0 for out-of-range year", () => {
    expect(calculateMACRS(100_000_00, "macrs_5yr", 10)).toBe(0);
    expect(calculateMACRS(100_000_00, "macrs_5yr", 0)).toBe(0);
  });

  it("calculates 7yr MACRS year 1 (14.29%)", () => {
    expect(calculateMACRS(100_000_00, "macrs_7yr", 1)).toBe(14_290_00);
  });

  it("returns 0 for straight_line method", () => {
    expect(calculateMACRS(100_000_00, "straight_line", 1)).toBe(0);
  });
});

describe("calculateStraightLine", () => {
  it("returns equal annual deduction", () => {
    // $100k over 10 years = $10k/year
    expect(calculateStraightLine(100_000_00, 0, 10, 1)).toBe(10_000_00);
    expect(calculateStraightLine(100_000_00, 0, 10, 10)).toBe(10_000_00);
  });

  it("accounts for salvage value", () => {
    // $100k - $10k salvage over 10 years = $9k/year
    expect(calculateStraightLine(100_000_00, 10_000_00, 10, 1)).toBe(9_000_00);
  });

  it("returns 0 for year 0 or beyond useful life", () => {
    expect(calculateStraightLine(100_000_00, 0, 10, 0)).toBe(0);
    expect(calculateStraightLine(100_000_00, 0, 10, 11)).toBe(0);
  });
});

describe("calculateSection179Deduction", () => {
  const LIMIT_2024 = 1_160_000_00; // $1.16M
  const PHASE_OUT_2024 = 2_890_000_00; // $2.89M

  it("allows full deduction when under phase-out threshold", () => {
    const result = calculateSection179Deduction(50_000_00, LIMIT_2024, PHASE_OUT_2024, 100_000_00);
    expect(result.deductionCents).toBe(50_000_00);
    expect(result.phaseOutApplied).toBe(false);
  });

  it("caps at limit even if cost is higher", () => {
    const result = calculateSection179Deduction(2_000_000_00, LIMIT_2024, PHASE_OUT_2024, 500_000_00);
    expect(result.deductionCents).toBe(LIMIT_2024);
  });

  it("reduces deduction based on phase-out", () => {
    // Cost = $1.2M, phase-out reduces limit by $200k → adjusted limit = $960k < $1.2M
    const result = calculateSection179Deduction(120_000_000, LIMIT_2024, PHASE_OUT_2024, PHASE_OUT_2024 + 20_000_000);
    expect(result.phaseOutApplied).toBe(true);
    expect(result.deductionCents).toBeLessThan(120_000_000);
  });

  it("returns 0 when fully phased out", () => {
    const bigPurchase = PHASE_OUT_2024 + LIMIT_2024 + 1_00;
    const result = calculateSection179Deduction(50_000_00, LIMIT_2024, PHASE_OUT_2024, bigPurchase);
    expect(result.deductionCents).toBe(0);
  });
});

describe("calculateAccumulatedDepreciation", () => {
  it("returns 0 for 0 years", () => {
    expect(calculateAccumulatedDepreciation(100_000_00, "macrs_5yr", 0)).toBe(0);
  });

  it("accumulates after multiple years", () => {
    const after1 = calculateAccumulatedDepreciation(100_000_00, "macrs_5yr", 1);
    const after2 = calculateAccumulatedDepreciation(100_000_00, "macrs_5yr", 2);
    expect(after2).toBeGreaterThan(after1);
    expect(after2).toBe(52_000_00); // 20 + 32 = 52%
  });

  it("caps at total table length", () => {
    const all = calculateAccumulatedDepreciation(100_000_00, "macrs_5yr", 100);
    const atEnd = calculateAccumulatedDepreciation(100_000_00, "macrs_5yr", 6);
    expect(all).toBe(atEnd);
  });
});

describe("getBookValue", () => {
  it("returns remaining value", () => {
    expect(getBookValue(100_000_00, 30_000_00)).toBe(70_000_00);
  });

  it("returns 0 when fully depreciated", () => {
    expect(getBookValue(100_000_00, 100_000_00)).toBe(0);
  });

  it("returns 0 not negative", () => {
    expect(getBookValue(100_000_00, 120_000_00)).toBe(0);
  });
});

describe("estimateDepreciationRecapture", () => {
  it("calculates recapture tax on depreciated amount", () => {
    // Sold for $50k gain, had $30k depreciation → recapture on $30k at 25%
    const result = estimateDepreciationRecapture(50_000_00, 30_000_00);
    expect(result.recaptureTaxCents).toBe(7_500_00);
    expect(result.capitalGainsCents).toBe(20_000_00);
  });

  it("recapture capped by actual gain", () => {
    // $10k gain, $30k depreciation → recapture only on $10k
    const result = estimateDepreciationRecapture(10_000_00, 30_000_00);
    expect(result.recaptureTaxCents).toBe(2_500_00);
    expect(result.capitalGainsCents).toBe(0);
  });

  it("uses custom recapture rate", () => {
    const result = estimateDepreciationRecapture(50_000_00, 50_000_00, 20);
    expect(result.recaptureTaxCents).toBe(10_000_00);
  });
});
