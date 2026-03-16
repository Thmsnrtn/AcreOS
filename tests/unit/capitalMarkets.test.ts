/**
 * T266 — Capital Markets Service Tests
 * Tests note pooling calculations, securitization scoring, and portfolio metrics.
 */

import { describe, it, expect } from "vitest";

// ─── Inline pure logic ────────────────────────────────────────────────────────

interface NoteStub {
  id: number;
  principal: number; // cents
  interestRate: number; // decimal, e.g. 0.08
  ltvRatio: number; // 0-1
  termMonths: number;
  paymentsMade: number;
  state: string;
}

interface NotePooling {
  noteIds: number[];
  totalValue: number;
  avgInterestRate: number;
  avgLTV: number;
  avgMaturity: number;
  diversificationScore: number;
}

function poolNotes(notes: NoteStub[]): NotePooling {
  if (notes.length === 0) throw new Error("No notes to pool");

  const totalValue = notes.reduce((sum, n) => sum + n.principal, 0);
  const avgInterestRate = notes.reduce((sum, n) => sum + n.interestRate, 0) / notes.length;
  const avgLTV = notes.reduce((sum, n) => sum + n.ltvRatio, 0) / notes.length;
  const avgMaturity =
    notes.reduce((sum, n) => sum + (n.termMonths - n.paymentsMade), 0) / notes.length;

  const stateSet = new Set(notes.map(n => n.state));
  const diversificationScore = Math.min(100, stateSet.size * 20);

  return {
    noteIds: notes.map(n => n.id),
    totalValue,
    avgInterestRate,
    avgLTV,
    avgMaturity,
    diversificationScore,
  };
}

type SecuritizationRating = "AAA" | "AA" | "A" | "BBB" | "BB" | "B" | "NR";

function ratePool(pool: NotePooling): SecuritizationRating {
  // Simple heuristic rating based on LTV and diversification
  const { avgLTV, diversificationScore } = pool;
  const score = (1 - avgLTV) * 60 + (diversificationScore / 100) * 40;
  if (score >= 80) return "AAA";
  if (score >= 70) return "AA";
  if (score >= 60) return "A";
  if (score >= 50) return "BBB";
  if (score >= 40) return "BB";
  if (score >= 30) return "B";
  return "NR";
}

function calculateWeightedAvgInterestRate(notes: NoteStub[]): number {
  if (notes.length === 0) return 0;
  const totalPrincipal = notes.reduce((s, n) => s + n.principal, 0);
  if (totalPrincipal === 0) return 0;
  return notes.reduce((s, n) => s + n.interestRate * n.principal, 0) / totalPrincipal;
}

function estimatePortfolioYield(
  notes: NoteStub[],
  annualDefaultRate: number
): number {
  const wair = calculateWeightedAvgInterestRate(notes);
  return wair * (1 - annualDefaultRate);
}

function calculateMinimumInvestment(totalPrincipal: number): number {
  // Min ticket: 5% of pool or $25k, whichever is greater
  return Math.max(25_000_00, Math.round(totalPrincipal * 0.05));
}

function getDiversificationLabel(score: number): string {
  if (score >= 80) return "highly_diversified";
  if (score >= 60) return "diversified";
  if (score >= 40) return "moderately_diversified";
  return "concentrated";
}

// ─── Tests ───────────────────────────────────────────────────────────────────

const sampleNotes: NoteStub[] = [
  { id: 1, principal: 50_000_00, interestRate: 0.08, ltvRatio: 0.5, termMonths: 60, paymentsMade: 12, state: "TX" },
  { id: 2, principal: 75_000_00, interestRate: 0.10, ltvRatio: 0.6, termMonths: 84, paymentsMade: 6, state: "AZ" },
  { id: 3, principal: 100_000_00, interestRate: 0.09, ltvRatio: 0.45, termMonths: 120, paymentsMade: 24, state: "FL" },
];

describe("poolNotes", () => {
  it("calculates total value", () => {
    const pool = poolNotes(sampleNotes);
    expect(pool.totalValue).toBe(225_000_00);
  });

  it("calculates average interest rate", () => {
    const pool = poolNotes(sampleNotes);
    const expected = (0.08 + 0.10 + 0.09) / 3;
    expect(pool.avgInterestRate).toBeCloseTo(expected, 5);
  });

  it("calculates average LTV", () => {
    const pool = poolNotes(sampleNotes);
    const expected = (0.5 + 0.6 + 0.45) / 3;
    expect(pool.avgLTV).toBeCloseTo(expected, 4);
  });

  it("calculates average remaining maturity (months)", () => {
    const pool = poolNotes(sampleNotes);
    // (60-12) + (84-6) + (120-24) = 48 + 78 + 96 = 222 / 3 = 74
    expect(pool.avgMaturity).toBeCloseTo(74, 0);
  });

  it("diversification score is 60 for 3 different states", () => {
    const pool = poolNotes(sampleNotes);
    // 3 states × 20 = 60
    expect(pool.diversificationScore).toBe(60);
  });

  it("caps diversification score at 100", () => {
    const manyStates: NoteStub[] = Array.from({ length: 10 }, (_, i) => ({
      id: i,
      principal: 10_000_00,
      interestRate: 0.08,
      ltvRatio: 0.5,
      termMonths: 60,
      paymentsMade: 0,
      state: `S${i}`,
    }));
    const pool = poolNotes(manyStates);
    expect(pool.diversificationScore).toBe(100);
  });

  it("throws for empty notes array", () => {
    expect(() => poolNotes([])).toThrow();
  });

  it("returns note IDs in pool", () => {
    const pool = poolNotes(sampleNotes);
    expect(pool.noteIds).toEqual([1, 2, 3]);
  });
});

describe("ratePool", () => {
  it("gives high rating for low LTV and diversified pool", () => {
    const pool = poolNotes([
      ...sampleNotes,
      { id: 4, principal: 50_000_00, interestRate: 0.08, ltvRatio: 0.3, termMonths: 60, paymentsMade: 0, state: "CO" },
      { id: 5, principal: 50_000_00, interestRate: 0.08, ltvRatio: 0.3, termMonths: 60, paymentsMade: 0, state: "NM" },
    ]);
    const rating = ratePool(pool);
    expect(["AAA", "AA", "A"]).toContain(rating);
  });

  it("gives lower rating for high LTV concentrated pool", () => {
    const concentrated: NoteStub[] = [
      { id: 1, principal: 50_000_00, interestRate: 0.12, ltvRatio: 0.85, termMonths: 60, paymentsMade: 0, state: "TX" },
      { id: 2, principal: 50_000_00, interestRate: 0.12, ltvRatio: 0.90, termMonths: 60, paymentsMade: 0, state: "TX" },
    ];
    const pool = poolNotes(concentrated);
    const rating = ratePool(pool);
    expect(["BB", "B", "NR"]).toContain(rating);
  });
});

describe("calculateWeightedAvgInterestRate", () => {
  it("weights by principal balance", () => {
    const notes: NoteStub[] = [
      { id: 1, principal: 100_000_00, interestRate: 0.08, ltvRatio: 0.5, termMonths: 60, paymentsMade: 0, state: "TX" },
      { id: 2, principal: 200_000_00, interestRate: 0.10, ltvRatio: 0.6, termMonths: 60, paymentsMade: 0, state: "AZ" },
    ];
    // (100k×0.08 + 200k×0.10) / 300k = (8000 + 20000) / 300000 = 28000/300000 ≈ 0.0933
    const wair = calculateWeightedAvgInterestRate(notes);
    expect(wair).toBeCloseTo(0.0933, 3);
  });

  it("returns 0 for empty notes", () => {
    expect(calculateWeightedAvgInterestRate([])).toBe(0);
  });
});

describe("estimatePortfolioYield", () => {
  it("reduces yield by default rate", () => {
    const notes: NoteStub[] = [
      { id: 1, principal: 100_000_00, interestRate: 0.10, ltvRatio: 0.5, termMonths: 60, paymentsMade: 0, state: "TX" },
    ];
    // WAIR = 10%, default rate = 2% → yield = 10% × (1 - 0.02) = 9.8%
    const yield_ = estimatePortfolioYield(notes, 0.02);
    expect(yield_).toBeCloseTo(0.098, 4);
  });
});

describe("calculateMinimumInvestment", () => {
  it("uses $25k floor for small pools", () => {
    expect(calculateMinimumInvestment(100_000_00)).toBe(25_000_00); // 5% = $5k < $25k floor
  });

  it("uses 5% for large pools", () => {
    // $2M pool → 5% = $100k > $25k floor
    expect(calculateMinimumInvestment(200_000_000)).toBe(10_000_000);
  });
});

describe("getDiversificationLabel", () => {
  it("labels 80+ as highly_diversified", () => {
    expect(getDiversificationLabel(80)).toBe("highly_diversified");
    expect(getDiversificationLabel(100)).toBe("highly_diversified");
  });

  it("labels 60-79 as diversified", () => {
    expect(getDiversificationLabel(60)).toBe("diversified");
    expect(getDiversificationLabel(70)).toBe("diversified");
  });

  it("labels 40-59 as moderately_diversified", () => {
    expect(getDiversificationLabel(40)).toBe("moderately_diversified");
  });

  it("labels below 40 as concentrated", () => {
    expect(getDiversificationLabel(20)).toBe("concentrated");
    expect(getDiversificationLabel(0)).toBe("concentrated");
  });
});
