/**
 * Cost Basis Tracker Unit Tests
 *
 * Tests cost basis recording and computation:
 * - Acquisition recording and initial basis calculation
 * - Improvement adjustments
 * - Gain/loss computation
 * - Holding period determination (short-term vs long-term)
 */

import { describe, it, expect } from "vitest";

// ── Types ─────────────────────────────────────────────────────────────────────

type HoldingPeriod = "short" | "long";
type AdjustmentType = "depreciation" | "casualty_loss" | "insurance_recovery" | "partial_sale" | "other";

interface CostBasisRecord {
  propertyId: number;
  organizationId: number;
  acquisitionDate: Date;
  acquisitionPrice: number;
  acquisitionCosts: number; // closing costs, title, survey
  improvementCosts: number;
  depreciationTaken: number;
  adjustedBasis: number;
  holdingPeriod: HoldingPeriod;
  notes: string;
}

interface GainLossResult {
  proceeds: number;
  adjustedBasis: number;
  gainLoss: number;
  isGain: boolean;
  holdingPeriod: HoldingPeriod;
  taxTreatment: "long_term_capital_gain" | "short_term_capital_gain" | "long_term_capital_loss" | "short_term_capital_loss";
}

// ── Pure helpers ───────────────────────────────────────────────────────────────

const SHORT_TERM_THRESHOLD_MONTHS = 12; // IRS: ≤12 months = short-term

function computeInitialBasis(acquisitionPrice: number, acquisitionCosts: number): number {
  return acquisitionPrice + acquisitionCosts;
}

function determineHoldingPeriod(acquisitionDate: Date, dispositionDate: Date): HoldingPeriod {
  const msPerMonth = 30.4375 * 24 * 60 * 60 * 1000;
  const monthsHeld = (dispositionDate.getTime() - acquisitionDate.getTime()) / msPerMonth;
  return monthsHeld > SHORT_TERM_THRESHOLD_MONTHS ? "long" : "short";
}

function applyImprovement(currentRecord: CostBasisRecord, improvementAmount: number): CostBasisRecord {
  if (improvementAmount <= 0) throw new Error("Improvement amount must be positive");
  return {
    ...currentRecord,
    improvementCosts: currentRecord.improvementCosts + improvementAmount,
    adjustedBasis: currentRecord.adjustedBasis + improvementAmount,
  };
}

function applyBasisAdjustment(
  currentRecord: CostBasisRecord,
  adjustmentType: AdjustmentType,
  amount: number // positive increases basis, negative decreases
): CostBasisRecord {
  let newBasis = currentRecord.adjustedBasis + amount;
  let newDepreciation = currentRecord.depreciationTaken;

  if (adjustmentType === "depreciation") {
    newDepreciation = currentRecord.depreciationTaken + Math.abs(amount);
  }

  return {
    ...currentRecord,
    adjustedBasis: Math.max(0, newBasis),
    depreciationTaken: newDepreciation,
    notes: `${currentRecord.notes}\n${adjustmentType} (${new Date().toISOString().slice(0, 10)}): ${amount >= 0 ? "+" : ""}${amount}`.trim(),
  };
}

function computeGainLoss(
  proceeds: number,
  record: CostBasisRecord,
  dispositionDate: Date
): GainLossResult {
  const holdingPeriod = determineHoldingPeriod(record.acquisitionDate, dispositionDate);
  const gainLoss = proceeds - record.adjustedBasis;
  const isGain = gainLoss >= 0;

  let taxTreatment: GainLossResult["taxTreatment"];
  if (holdingPeriod === "long" && isGain) taxTreatment = "long_term_capital_gain";
  else if (holdingPeriod === "short" && isGain) taxTreatment = "short_term_capital_gain";
  else if (holdingPeriod === "long" && !isGain) taxTreatment = "long_term_capital_loss";
  else taxTreatment = "short_term_capital_loss";

  return {
    proceeds,
    adjustedBasis: record.adjustedBasis,
    gainLoss: Math.round(gainLoss * 100) / 100,
    isGain,
    holdingPeriod,
    taxTreatment,
  };
}

function computeHoldYears(acquisitionDate: Date, referenceDate: Date = new Date()): number {
  return Math.max(0, (referenceDate.getTime() - acquisitionDate.getTime()) / (365.25 * 24 * 3600 * 1000));
}

function makeRecord(overrides: Partial<CostBasisRecord> = {}): CostBasisRecord {
  return {
    propertyId: 1,
    organizationId: 1,
    acquisitionDate: new Date("2020-01-01"),
    acquisitionPrice: 200_000,
    acquisitionCosts: 5_000,
    improvementCosts: 0,
    depreciationTaken: 0,
    adjustedBasis: 205_000,
    holdingPeriod: "long",
    notes: "",
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Acquisition Recording", () => {
  it("computes initial basis as acquisition price plus costs", () => {
    const basis = computeInitialBasis(200_000, 5_000);
    expect(basis).toBe(205_000);
  });

  it("handles zero acquisition costs", () => {
    const basis = computeInitialBasis(150_000, 0);
    expect(basis).toBe(150_000);
  });

  it("correctly adds closing costs, title, and survey fees", () => {
    const price = 300_000;
    const costs = 3_500 + 1_200 + 800; // closing + title + survey
    expect(computeInitialBasis(price, costs)).toBe(305_500);
  });
});

describe("Improvement Adjustments", () => {
  it("increases adjusted basis by improvement amount", () => {
    const record = makeRecord();
    const updated = applyImprovement(record, 50_000);
    expect(updated.adjustedBasis).toBe(255_000);
    expect(updated.improvementCosts).toBe(50_000);
  });

  it("accumulates multiple improvements", () => {
    let record = makeRecord();
    record = applyImprovement(record, 20_000);
    record = applyImprovement(record, 15_000);
    expect(record.improvementCosts).toBe(35_000);
    expect(record.adjustedBasis).toBe(205_000 + 35_000);
  });

  it("throws for non-positive improvement amounts", () => {
    const record = makeRecord();
    expect(() => applyImprovement(record, 0)).toThrow();
    expect(() => applyImprovement(record, -1000)).toThrow();
  });
});

describe("Basis Adjustments", () => {
  it("reduces basis for depreciation (negative amount)", () => {
    const record = makeRecord();
    const updated = applyBasisAdjustment(record, "depreciation", -10_000);
    expect(updated.adjustedBasis).toBe(195_000);
    expect(updated.depreciationTaken).toBe(10_000);
  });

  it("tracks total depreciation taken separately", () => {
    let record = makeRecord();
    record = applyBasisAdjustment(record, "depreciation", -5_000);
    record = applyBasisAdjustment(record, "depreciation", -3_000);
    expect(record.depreciationTaken).toBe(8_000);
  });

  it("increases basis for insurance recovery", () => {
    const record = makeRecord();
    const updated = applyBasisAdjustment(record, "insurance_recovery", 15_000);
    expect(updated.adjustedBasis).toBe(220_000);
  });

  it("never reduces basis below zero", () => {
    const record = makeRecord({ adjustedBasis: 5_000 });
    const updated = applyBasisAdjustment(record, "depreciation", -100_000);
    expect(updated.adjustedBasis).toBe(0);
  });

  it("appends note about adjustment type", () => {
    const record = makeRecord({ notes: "Initial acquisition" });
    const updated = applyBasisAdjustment(record, "casualty_loss", -20_000);
    expect(updated.notes).toContain("casualty_loss");
    expect(updated.notes).toContain("Initial acquisition");
  });
});

describe("Gain/Loss Computation", () => {
  const longTermRecord = makeRecord({
    acquisitionDate: new Date("2020-01-01"),
    adjustedBasis: 205_000,
  });

  it("computes capital gain correctly", () => {
    const dispositionDate = new Date("2023-06-15");
    const result = computeGainLoss(350_000, longTermRecord, dispositionDate);
    expect(result.gainLoss).toBeCloseTo(145_000, 0);
    expect(result.isGain).toBe(true);
  });

  it("computes capital loss correctly", () => {
    const dispositionDate = new Date("2023-01-01");
    const result = computeGainLoss(180_000, longTermRecord, dispositionDate);
    expect(result.gainLoss).toBeCloseTo(-25_000, 0);
    expect(result.isGain).toBe(false);
  });

  it("uses adjusted basis (not acquisition price) for gain calculation", () => {
    const recordWithImprovements = makeRecord({ adjustedBasis: 280_000 });
    const dispositionDate = new Date("2023-01-01");
    const result = computeGainLoss(300_000, recordWithImprovements, dispositionDate);
    expect(result.adjustedBasis).toBe(280_000);
    expect(result.gainLoss).toBeCloseTo(20_000, 0);
  });

  it("returns proceeds in result", () => {
    const dispositionDate = new Date("2023-01-01");
    const result = computeGainLoss(400_000, longTermRecord, dispositionDate);
    expect(result.proceeds).toBe(400_000);
  });
});

describe("Holding Period Determination", () => {
  it("classifies long-term for hold over 12 months", () => {
    const acq = new Date("2020-01-01");
    const disp = new Date("2022-01-01"); // 24 months
    expect(determineHoldingPeriod(acq, disp)).toBe("long");
  });

  it("classifies short-term for hold under 12 months", () => {
    const acq = new Date("2023-01-01");
    const disp = new Date("2023-08-01"); // 7 months
    expect(determineHoldingPeriod(acq, disp)).toBe("short");
  });

  it("classifies short-term at exactly 12 months", () => {
    const acq = new Date("2022-01-01");
    const disp = new Date("2023-01-01"); // exactly 12 months
    expect(determineHoldingPeriod(acq, disp)).toBe("short"); // IRS: >12 months for long-term
  });

  it("classifies long-term for hold just over 12 months", () => {
    const acq = new Date("2022-01-01");
    const disp = new Date("2023-02-01"); // 13 months
    expect(determineHoldingPeriod(acq, disp)).toBe("long");
  });

  it("assigns correct tax treatment for long-term gain", () => {
    const record = makeRecord({ acquisitionDate: new Date("2020-01-01") });
    const result = computeGainLoss(350_000, record, new Date("2023-01-01"));
    expect(result.taxTreatment).toBe("long_term_capital_gain");
  });

  it("assigns correct tax treatment for short-term loss", () => {
    const record = makeRecord({
      acquisitionDate: new Date("2023-01-01"),
      adjustedBasis: 250_000,
    });
    const result = computeGainLoss(200_000, record, new Date("2023-06-01"));
    expect(result.taxTreatment).toBe("short_term_capital_loss");
  });
});

describe("Hold Years Computation", () => {
  it("computes hold years correctly", () => {
    const acq = new Date("2020-01-01");
    const ref = new Date("2023-01-01");
    const years = computeHoldYears(acq, ref);
    expect(years).toBeCloseTo(3, 0);
  });

  it("returns 0 for future acquisition date", () => {
    const future = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    expect(computeHoldYears(future)).toBe(0);
  });

  it("returns fractional years for partial holds", () => {
    const acq = new Date("2023-01-01");
    const ref = new Date("2023-07-01"); // ~0.5 years
    const years = computeHoldYears(acq, ref);
    expect(years).toBeGreaterThan(0.4);
    expect(years).toBeLessThan(0.6);
  });
});
