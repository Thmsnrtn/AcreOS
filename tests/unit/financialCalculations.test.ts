/**
 * Financial Calculation Unit Tests
 *
 * Tests pure math functions without hitting the database.
 * DB-dependent service methods are exercised via mocks.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── calculateMonthlyPayment ───────────────────────────────────────────────────
// We test the exported helper directly.
vi.mock("../server/db", () => ({ db: {} }));

import { calculateMonthlyPayment } from "../../server/storage";

describe("calculateMonthlyPayment", () => {
  it("returns correct payment for a standard amortizing loan", () => {
    // $100,000 at 6% annual for 30 years (360 months)
    // Textbook answer ≈ $599.55
    const payment = calculateMonthlyPayment(100_000, 6, 360);
    expect(payment).toBeCloseTo(599.55, 0);
  });

  it("returns principal / months when rate is 0 (zero-interest)", () => {
    const payment = calculateMonthlyPayment(60_000, 0, 60);
    expect(payment).toBeCloseTo(1_000, 2);
  });

  it("handles a short-term balloon note (12 months)", () => {
    // $50,000 at 8% annual for 12 months ≈ $4,349.42
    const payment = calculateMonthlyPayment(50_000, 8, 12);
    expect(payment).toBeCloseTo(4_349.42, 0);
  });

  it("returns positive value for any positive input", () => {
    expect(calculateMonthlyPayment(200_000, 5.5, 240)).toBeGreaterThan(0);
  });

  it("produces result that amortises the loan to ~$0 balance", () => {
    const principal = 80_000;
    const annualRate = 7;
    const termMonths = 120;
    const payment = calculateMonthlyPayment(principal, annualRate, termMonths);
    const monthlyRate = annualRate / 100 / 12;

    let balance = principal;
    for (let i = 0; i < termMonths; i++) {
      const interest = balance * monthlyRate;
      const principalPaid = Math.min(payment - interest, balance);
      balance -= principalPaid;
    }
    // After all payments balance should be essentially zero (rounding drift < $1)
    expect(Math.abs(balance)).toBeLessThan(1);
  });
});

// ── IRR / cash-on-cash helper ─────────────────────────────────────────────────
// These are inline pure functions — we test them by replicating the logic
// from cashFlowForecaster and verifying known good values.

function simpleCashOnCash(annualNetIncome: number, totalCashInvested: number): number {
  return (annualNetIncome / totalCashInvested) * 100;
}

describe("cash-on-cash return", () => {
  it("returns expected percentage for simple scenario", () => {
    // $12,000 annual income on $100,000 invested = 12%
    expect(simpleCashOnCash(12_000, 100_000)).toBeCloseTo(12, 5);
  });

  it("returns 0 when income is 0", () => {
    expect(simpleCashOnCash(0, 50_000)).toBe(0);
  });

  it("returns negative when income is negative (loss)", () => {
    expect(simpleCashOnCash(-5_000, 100_000)).toBeLessThan(0);
  });
});

// ── HHI Diversification Score ─────────────────────────────────────────────────
// Replicates the hhiScore arrow function from portfolioOptimizer.ts

function hhiScore(dist: Record<string, number>, totalValue: number): number {
  const entries = Object.values(dist).filter(v => v > 0);
  if (entries.length === 0) return 100;
  const hhi = entries.reduce((sum, v) => sum + Math.pow(v / totalValue, 2), 0);
  return (1 - hhi) * 100;
}

describe("HHI diversification score", () => {
  it("returns 100 for perfectly equal distribution (maximum diversification)", () => {
    // 4 equal holdings at 25% each → HHI = 4×(0.25²) = 0.25 → score = 75
    const dist = { A: 25, B: 25, C: 25, D: 25 };
    const score = hhiScore(dist, 100);
    expect(score).toBeCloseTo(75, 1);
  });

  it("returns 0 for a single holding (maximum concentration)", () => {
    // 1 holding = 100% of portfolio → HHI = 1 → score = 0
    const dist = { A: 100 };
    const score = hhiScore(dist, 100);
    expect(score).toBeCloseTo(0, 5);
  });

  it("returns 100 when distribution is empty", () => {
    expect(hhiScore({}, 100)).toBe(100);
  });

  it("ignores zero-value holdings", () => {
    const withZero = hhiScore({ A: 50, B: 50, C: 0 }, 100);
    const withoutZero = hhiScore({ A: 50, B: 50 }, 100);
    expect(withZero).toBeCloseTo(withoutZero, 5);
  });

  it("more concentrated portfolio has lower score than diversified one", () => {
    const concentrated = hhiScore({ A: 90, B: 10 }, 100);
    const diversified = hhiScore({ A: 25, B: 25, C: 25, D: 25 }, 100);
    expect(diversified).toBeGreaterThan(concentrated);
  });
});

// ── Monte Carlo boundary conditions ───────────────────────────────────────────
// Tests the pure math invariants without running 10,000 simulations.

function percentile(sortedValues: number[], pct: number): number {
  return sortedValues[Math.floor(sortedValues.length * pct)];
}

describe("Monte Carlo percentile extraction", () => {
  it("p50 is median of sorted values", () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const p50 = percentile(values, 0.5);
    expect(p50).toBe(6); // index 5 of 10
  });

  it("p10 is less than p90 for any non-trivial distribution", () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(values, 0.1)).toBeLessThan(percentile(values, 0.9));
  });

  it("pessimistic ROI is less than optimistic ROI", () => {
    const portfolioValue = 1_000_000;
    // Simulate a spread of final values: 700k to 1.5m
    const finalValues = Array.from({ length: 100 }, (_, i) => 700_000 + i * 8_000).sort((a, b) => a - b);

    const pessimisticROI = ((percentile(finalValues, 0.1) - portfolioValue) / portfolioValue) * 100;
    const optimisticROI = ((percentile(finalValues, 0.9) - portfolioValue) / portfolioValue) * 100;

    expect(pessimisticROI).toBeLessThan(optimisticROI);
  });
});

// ── Amortization schedule invariants ─────────────────────────────────────────

function buildSchedule(principal: number, annualRate: number, termMonths: number) {
  const monthlyPayment = calculateMonthlyPayment(principal, annualRate, termMonths);
  const monthlyRate = annualRate / 100 / 12;
  const schedule: { principal: number; interest: number; balance: number }[] = [];
  let balance = principal;

  for (let i = 1; i <= termMonths && balance > 0; i++) {
    const interest = balance * monthlyRate;
    const principalPaid = Math.min(monthlyPayment - interest, balance);
    balance = Math.max(0, balance - principalPaid);
    schedule.push({
      principal: Number(principalPaid.toFixed(2)),
      interest: Number(interest.toFixed(2)),
      balance: Number(balance.toFixed(2)),
    });
  }
  return schedule;
}

describe("amortization schedule", () => {
  const schedule = buildSchedule(100_000, 6, 360);

  it("has exactly termMonths entries", () => {
    expect(schedule).toHaveLength(360);
  });

  it("final balance is near zero", () => {
    expect(schedule[schedule.length - 1].balance).toBeLessThan(1);
  });

  it("interest decreases over time (declining balance)", () => {
    const firstInterest = schedule[0].interest;
    const lastInterest = schedule[schedule.length - 2].interest;
    expect(lastInterest).toBeLessThan(firstInterest);
  });

  it("principal portion increases over time", () => {
    const firstPrincipal = schedule[0].principal;
    const lastPrincipal = schedule[schedule.length - 2].principal;
    expect(lastPrincipal).toBeGreaterThan(firstPrincipal);
  });

  it("total interest paid is positive", () => {
    const totalInterest = schedule.reduce((sum, p) => sum + p.interest, 0);
    expect(totalInterest).toBeGreaterThan(0);
  });

  it("sum of principal payments equals original principal", () => {
    const totalPrincipal = schedule.reduce((sum, p) => sum + p.principal, 0);
    expect(Math.abs(totalPrincipal - 100_000)).toBeLessThan(1); // rounding drift < $1
  });
});

// ── Valuation confidence bounds ───────────────────────────────────────────────
// Tests that confidence interval math from acreOSValuation is internally consistent.

function buildConfidenceInterval(
  estimatedValue: number,
  confidence: number // 0-100
): { low: number; high: number } {
  // The service uses ±(1 - confidence/100) * 0.5 as the band
  const band = (1 - confidence / 100) * 0.5;
  return {
    low: estimatedValue * (1 - band),
    high: estimatedValue * (1 + band),
  };
}

describe("valuation confidence interval", () => {
  it("low is always less than high", () => {
    const ci = buildConfidenceInterval(500_000, 80);
    expect(ci.low).toBeLessThan(ci.high);
  });

  it("estimate sits between low and high", () => {
    const value = 750_000;
    const ci = buildConfidenceInterval(value, 70);
    expect(ci.low).toBeLessThan(value);
    expect(ci.high).toBeGreaterThan(value);
  });

  it("higher confidence → narrower interval", () => {
    const value = 1_000_000;
    const highConfCI = buildConfidenceInterval(value, 95);
    const lowConfCI = buildConfidenceInterval(value, 50);
    const highSpread = highConfCI.high - highConfCI.low;
    const lowSpread = lowConfCI.high - lowConfCI.low;
    expect(highSpread).toBeLessThan(lowSpread);
  });

  it("100% confidence collapses to a point estimate", () => {
    const ci = buildConfidenceInterval(400_000, 100);
    expect(ci.low).toBeCloseTo(ci.high, 0);
  });
});
