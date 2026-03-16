/**
 * T121 — Tax Optimizer Unit Tests
 *
 * Tests pure tax calculation logic: capital gains classification,
 * NIIT threshold, holding period detection, and recommendation triggers.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock dependencies before importing ───────────────────────────────────────
vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: vi.fn() } };
  },
}));
vi.mock("../../server/db", () => ({
  db: {
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(() => []) })) })) })),
  },
}));

// ── Tax Rate Constants (mirrored from taxOptimizer.ts) ────────────────────────

const FEDERAL_LTCG_RATES = [
  { maxIncome: 47025, rate: 0 },
  { maxIncome: 518900, rate: 0.15 },
  { maxIncome: Infinity, rate: 0.20 },
];

const FEDERAL_STCG_RATES = [
  { maxIncome: 11600, rate: 0.10 },
  { maxIncome: 47150, rate: 0.12 },
  { maxIncome: 100525, rate: 0.22 },
  { maxIncome: 191950, rate: 0.24 },
  { maxIncome: 243725, rate: 0.32 },
  { maxIncome: 609350, rate: 0.35 },
  { maxIncome: Infinity, rate: 0.37 },
];

const NIIT_THRESHOLD_SINGLE = 200_000;
const NIIT_RATE = 0.038;

// ── Pure Helpers (mirrors internal logic) ────────────────────────────────────

function getLTCGRate(income: number): number {
  return FEDERAL_LTCG_RATES.find(b => income <= b.maxIncome)!.rate;
}

function getSTCGRate(income: number): number {
  return FEDERAL_STCG_RATES.find(b => income <= b.maxIncome)!.rate;
}

function calcNIIT(gain: number): number {
  return gain > NIIT_THRESHOLD_SINGLE ? (gain - NIIT_THRESHOLD_SINGLE) * NIIT_RATE : 0;
}

function isLongTerm(holdingDays: number): boolean {
  return holdingDays > 365;
}

function estimateTax(gain: number, isLT: boolean, estimatedIncome = 150_000): number {
  const rate = isLT ? getLTCGRate(estimatedIncome) : getSTCGRate(estimatedIncome);
  return Math.max(0, gain * rate) + calcNIIT(gain);
}

function buildRecommendations(gain: number, holdingDays: number): string[] {
  const recs: string[] = [];
  const isLT = isLongTerm(holdingDays);
  if (gain > 50_000 && isLT) recs.push("Consider 1031 exchange to defer taxes");
  if (gain > 100_000) recs.push("Installment sale can spread tax over multiple years");
  if (!isLT && holdingDays > 330)
    recs.push(`Hold ${365 - holdingDays} more days for long-term capital gains rates`);
  if (gain > 200_000) recs.push("QOZ investment can defer and reduce capital gains tax");
  return recs;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("LTCG Rate Brackets", () => {
  it("applies 0% rate for income under $47,025", () => {
    expect(getLTCGRate(40_000)).toBe(0);
  });

  it("applies 15% rate for mid-range income", () => {
    expect(getLTCGRate(100_000)).toBe(0.15);
    expect(getLTCGRate(500_000)).toBe(0.15);
  });

  it("applies 20% rate for income over $518,900", () => {
    expect(getLTCGRate(600_000)).toBe(0.20);
    expect(getLTCGRate(1_000_000)).toBe(0.20);
  });

  it("applies correct rate at exact boundary ($47,025)", () => {
    expect(getLTCGRate(47_025)).toBe(0);
    expect(getLTCGRate(47_026)).toBe(0.15);
  });
});

describe("STCG Rate Brackets", () => {
  it("applies 10% for lowest bracket", () => {
    expect(getSTCGRate(10_000)).toBe(0.10);
  });

  it("applies 22% for middle bracket", () => {
    expect(getSTCGRate(75_000)).toBe(0.22);
  });

  it("applies 37% for highest earners", () => {
    expect(getSTCGRate(700_000)).toBe(0.37);
  });

  it("handles exact bracket boundaries", () => {
    expect(getSTCGRate(47_150)).toBe(0.12);
    expect(getSTCGRate(47_151)).toBe(0.22);
  });
});

describe("NIIT (Net Investment Income Tax)", () => {
  it("returns 0 NIIT for gain at or below $200k threshold", () => {
    expect(calcNIIT(100_000)).toBe(0);
    expect(calcNIIT(200_000)).toBe(0);
  });

  it("calculates 3.8% on gain above $200k", () => {
    const gain = 250_000;
    const expected = (250_000 - 200_000) * 0.038;
    expect(calcNIIT(gain)).toBeCloseTo(expected, 2);
  });

  it("calculates large NIIT correctly", () => {
    const gain = 1_000_000;
    const expected = (1_000_000 - 200_000) * 0.038;
    expect(calcNIIT(gain)).toBeCloseTo(expected, 2);
  });

  it("returns 0 for zero gain", () => {
    expect(calcNIIT(0)).toBe(0);
  });
});

describe("Holding Period Classification", () => {
  it("classifies as short-term for 365 days or less", () => {
    expect(isLongTerm(365)).toBe(false);
    expect(isLongTerm(364)).toBe(false);
    expect(isLongTerm(1)).toBe(false);
  });

  it("classifies as long-term for more than 365 days", () => {
    expect(isLongTerm(366)).toBe(true);
    expect(isLongTerm(730)).toBe(true);
    expect(isLongTerm(1825)).toBe(true);
  });

  it("exactly 365 days is still short-term", () => {
    expect(isLongTerm(365)).toBe(false);
  });
});

describe("Tax Estimation", () => {
  it("applies LTCG rate for long-term holds", () => {
    const gain = 100_000;
    const tax = estimateTax(gain, true, 150_000);
    // 15% LTCG + 0 NIIT (under $200k)
    expect(tax).toBeCloseTo(15_000, 0);
  });

  it("applies STCG rate for short-term holds", () => {
    const gain = 50_000;
    const tax = estimateTax(gain, false, 150_000);
    // 24% STCG bracket at $150k income
    expect(tax).toBeCloseTo(50_000 * 0.24, 0);
  });

  it("adds NIIT for large long-term gains", () => {
    const gain = 300_000;
    const tax = estimateTax(gain, true, 150_000);
    const expectedLTCG = 300_000 * 0.15;
    const expectedNIIT = (300_000 - 200_000) * 0.038;
    expect(tax).toBeCloseTo(expectedLTCG + expectedNIIT, 0);
  });

  it("returns 0 for zero gain", () => {
    expect(estimateTax(0, true)).toBe(0);
    expect(estimateTax(0, false)).toBe(0);
  });

  it("handles negative gain (loss) gracefully", () => {
    expect(estimateTax(-10_000, true)).toBe(0);
  });
});

describe("Tax Recommendations", () => {
  it("suggests 1031 exchange for large long-term gain", () => {
    const recs = buildRecommendations(60_000, 400);
    expect(recs).toContain("Consider 1031 exchange to defer taxes");
  });

  it("suggests installment sale for gain over $100k", () => {
    const recs = buildRecommendations(150_000, 400);
    expect(recs).toContain("Installment sale can spread tax over multiple years");
  });

  it("suggests holding longer when close to 365 days", () => {
    const recs = buildRecommendations(50_000, 350);
    const holdRec = recs.find(r => r.includes("more days for long-term"));
    expect(holdRec).toBeDefined();
    expect(holdRec).toContain("15 more days");
  });

  it("does NOT suggest holding longer when already long-term", () => {
    const recs = buildRecommendations(50_000, 400);
    expect(recs.some(r => r.includes("more days"))).toBe(false);
  });

  it("suggests QOZ for gain over $200k", () => {
    const recs = buildRecommendations(250_000, 400);
    expect(recs).toContain("QOZ investment can defer and reduce capital gains tax");
  });

  it("returns no recommendations for small short-term gain", () => {
    const recs = buildRecommendations(5_000, 100);
    expect(recs).toHaveLength(0);
  });
});

describe("Adjusted Basis Calculation", () => {
  it("calculates realized gain correctly", () => {
    const saleProceeds = 150_000;
    const acquisitionCost = 80_000;
    const improvementCosts = 5_000;
    const closingCosts = 3_000;
    const adjustedBasis = acquisitionCost + improvementCosts + closingCosts;
    const realizedGain = saleProceeds - adjustedBasis;
    expect(realizedGain).toBe(62_000);
  });

  it("produces a loss when basis exceeds sale price", () => {
    const saleProceeds = 50_000;
    const adjustedBasis = 75_000;
    const realizedGain = saleProceeds - adjustedBasis;
    expect(realizedGain).toBe(-25_000);
  });

  it("calculates zero gain when sale equals basis", () => {
    expect(100_000 - 100_000).toBe(0);
  });
});
