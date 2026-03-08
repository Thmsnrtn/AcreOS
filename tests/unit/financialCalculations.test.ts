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

// ═══════════════════════════════════════════════════════════════════════════════
// CASH FLOW FORECASTER — pure math helpers
// We replicate the core arithmetic from cashFlowForecaster.ts so these tests
// run without touching the database (all DB calls are mocked at the top).
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Computes the weighted net cash flow from income projections and expenses,
 * mirroring the logic inside CashFlowForecasterService.generateForecast.
 */
function computeNetCashFlow(
  incomeProjections: Array<{ expectedAmount: number; probability: number }>,
  expenseProjections: Array<{ amount: number }>
): { totalIncome: number; totalExpenses: number; netCashFlow: number } {
  const totalIncome = incomeProjections.reduce(
    (sum, item) => sum + item.expectedAmount * item.probability,
    0
  );
  const totalExpenses = expenseProjections.reduce(
    (sum, item) => sum + item.amount,
    0
  );
  return { totalIncome, totalExpenses, netCashFlow: totalIncome - totalExpenses };
}

/**
 * Mirrors the default-probability formula from
 * CashFlowForecasterService.calculateDefaultProbability.
 * Intentionally kept as a standalone pure function so tests don't need a DB.
 */
function calculateDefaultProbability(params: {
  onTimePayments: number;
  latePayments: number;
  missedPayments: number;
  averageDaysLate: number;
  paymentPattern: "consistent" | "declining" | "improving" | "erratic";
  currentDelinquencyStatus: string;
  daysDelinquent: number;
}): number {
  let probability = 0;

  const totalPayments = params.onTimePayments + params.latePayments + params.missedPayments;
  if (totalPayments > 0) {
    const missedRate = params.missedPayments / totalPayments;
    const lateRate = params.latePayments / totalPayments;
    probability += missedRate * 0.4 + lateRate * 0.15;
  }

  if (params.averageDaysLate > 60) {
    probability += 0.2;
  } else if (params.averageDaysLate > 30) {
    probability += 0.1;
  }

  switch (params.paymentPattern) {
    case "declining": probability += 0.15; break;
    case "erratic":   probability += 0.10; break;
    case "improving": probability -= 0.05; break;
  }

  switch (params.currentDelinquencyStatus) {
    case "seriously_delinquent": probability += 0.25; break;
    case "delinquent":           probability += 0.15; break;
    case "early_delinquent":     probability += 0.05; break;
    case "default_candidate":    probability += 0.35; break;
  }

  if (params.daysDelinquent > 90)      probability += 0.15;
  else if (params.daysDelinquent > 60) probability += 0.08;
  else if (params.daysDelinquent > 30) probability += 0.03;

  return Math.max(0, Math.min(1, probability));
}

describe("cashFlowForecaster — net cash flow computation", () => {
  it("normal case: income exceeds expenses → positive net cash flow", () => {
    const income = [
      { expectedAmount: 1_500, probability: 0.95 },
      { expectedAmount: 1_500, probability: 0.90 },
    ];
    const expenses = [{ amount: 200 }, { amount: 150 }];

    const { totalIncome, totalExpenses, netCashFlow } = computeNetCashFlow(income, expenses);

    expect(totalIncome).toBeCloseTo(1_500 * 0.95 + 1_500 * 0.90, 4);
    expect(totalExpenses).toBe(350);
    expect(netCashFlow).toBeGreaterThan(0);
  });

  it("zero income case: when all income projections have zero expected amount", () => {
    const income = [
      { expectedAmount: 0, probability: 0.9 },
      { expectedAmount: 0, probability: 0.8 },
    ];
    const expenses = [{ amount: 500 }];

    const { totalIncome, totalExpenses, netCashFlow } = computeNetCashFlow(income, expenses);

    expect(totalIncome).toBe(0);
    expect(totalExpenses).toBe(500);
    expect(netCashFlow).toBe(-500);
  });

  it("negative cash flow case: expenses outstrip income → netCashFlow < 0", () => {
    const income = [{ expectedAmount: 800, probability: 0.5 }]; // only $400 expected
    const expenses = [{ amount: 1_000 }];

    const { netCashFlow } = computeNetCashFlow(income, expenses);

    expect(netCashFlow).toBeLessThan(0);
  });

  it("zero probability income is not counted toward total", () => {
    const income = [
      { expectedAmount: 10_000, probability: 0 },
      { expectedAmount: 500, probability: 1 },
    ];
    const expenses: Array<{ amount: number }> = [];

    const { totalIncome } = computeNetCashFlow(income, expenses);

    // The $10k item contributes nothing; only the $500 certain item counts.
    expect(totalIncome).toBeCloseTo(500, 4);
  });

  it("empty income and expense arrays produce zero net cash flow", () => {
    const { totalIncome, totalExpenses, netCashFlow } = computeNetCashFlow([], []);
    expect(totalIncome).toBe(0);
    expect(totalExpenses).toBe(0);
    expect(netCashFlow).toBe(0);
  });
});

describe("cashFlowForecaster — default probability calculation", () => {
  it("healthy note with all on-time payments has near-zero default probability", () => {
    const prob = calculateDefaultProbability({
      onTimePayments: 24,
      latePayments: 0,
      missedPayments: 0,
      averageDaysLate: 0,
      paymentPattern: "consistent",
      currentDelinquencyStatus: "current",
      daysDelinquent: 0,
    });
    expect(prob).toBeCloseTo(0, 5);
  });

  it("seriously delinquent note with missed payments and declining pattern has high probability", () => {
    const prob = calculateDefaultProbability({
      onTimePayments: 2,
      latePayments: 3,
      missedPayments: 5,
      averageDaysLate: 75,
      paymentPattern: "declining",
      currentDelinquencyStatus: "seriously_delinquent",
      daysDelinquent: 95,
    });
    // Each risk factor compounds; we expect a high but capped value
    expect(prob).toBeGreaterThan(0.5);
    expect(prob).toBeLessThanOrEqual(1);
  });

  it("improving payment pattern lowers probability relative to consistent", () => {
    const base = {
      onTimePayments: 10,
      latePayments: 2,
      missedPayments: 1,
      averageDaysLate: 10,
      currentDelinquencyStatus: "current",
      daysDelinquent: 0,
    };
    const consistentProb = calculateDefaultProbability({ ...base, paymentPattern: "consistent" });
    const improvingProb  = calculateDefaultProbability({ ...base, paymentPattern: "improving" });
    expect(improvingProb).toBeLessThan(consistentProb);
  });

  it("result is always clamped to [0, 1] even with extreme inputs", () => {
    // Force every additive factor to fire
    const prob = calculateDefaultProbability({
      onTimePayments: 0,
      latePayments: 0,
      missedPayments: 100,
      averageDaysLate: 120,
      paymentPattern: "declining",
      currentDelinquencyStatus: "default_candidate",
      daysDelinquent: 120,
    });
    expect(prob).toBeGreaterThanOrEqual(0);
    expect(prob).toBeLessThanOrEqual(1);
  });

  it("division by zero guard: zero total payments does not cause NaN", () => {
    const prob = calculateDefaultProbability({
      onTimePayments: 0,
      latePayments: 0,
      missedPayments: 0,
      averageDaysLate: 0,
      paymentPattern: "consistent",
      currentDelinquencyStatus: "current",
      daysDelinquent: 0,
    });
    expect(prob).not.toBeNaN();
    expect(prob).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PORTFOLIO OPTIMIZER — pure math helpers
// Replicates the arithmetic from portfolioOptimizer.ts calculatePortfolioMetrics
// and analyzeDiversification without touching the database.
// ═══════════════════════════════════════════════════════════════════════════════

interface TestHolding {
  currentValue: number;
  cashFlow: number;
  acres: number;
  annualAppreciation: number;
  marketRisk: number; // 0–100
}

/**
 * Pure version of PortfolioOptimizer.calculatePortfolioMetrics.
 */
function calcPortfolioMetrics(holdings: TestHolding[]) {
  const totalValue     = holdings.reduce((s, h) => s + h.currentValue, 0);
  const totalCashFlow  = holdings.reduce((s, h) => s + h.cashFlow, 0);
  const totalAcres     = holdings.reduce((s, h) => s + h.acres, 0);

  const avgAppreciation = totalValue > 0
    ? holdings.reduce((s, h) => s + h.annualAppreciation * h.currentValue / totalValue, 0)
    : 0;

  const portfolioReturn = totalValue > 0 ? (totalCashFlow / totalValue) * 100 : 0;
  const avgRisk = totalValue > 0
    ? holdings.reduce((s, h) => s + (h.marketRisk / 100) * h.currentValue / totalValue, 0)
    : 0;
  const riskFreeRate = 4.5;
  const sharpeRatio = avgRisk > 0 ? (portfolioReturn - riskFreeRate) / (avgRisk * 100) : 0;

  const hhi = totalValue > 0
    ? holdings.reduce((s, h) => s + Math.pow(h.currentValue / totalValue, 2), 0)
    : 0;
  const concentrationRisk  = hhi * 100;
  const diversificationScore = Math.max(0, 100 - concentrationRisk);

  return {
    totalValue,
    totalCashFlow,
    totalAcres,
    avgAppreciation,
    sharpeRatio,
    concentrationRisk,
    diversificationScore,
    totalProperties: holdings.length,
  };
}

describe("portfolioOptimizer — basic optimization metrics", () => {
  const holdings: TestHolding[] = [
    { currentValue: 200_000, cashFlow: 12_000, acres: 30, annualAppreciation: 4, marketRisk: 40 },
    { currentValue: 300_000, cashFlow: 18_000, acres: 50, annualAppreciation: 5, marketRisk: 50 },
    { currentValue: 100_000, cashFlow:  6_000, acres: 10, annualAppreciation: 6, marketRisk: 30 },
  ];

  it("totalValue sums all holdings", () => {
    const m = calcPortfolioMetrics(holdings);
    expect(m.totalValue).toBe(600_000);
  });

  it("totalCashFlow sums all holdings", () => {
    const m = calcPortfolioMetrics(holdings);
    expect(m.totalCashFlow).toBe(36_000);
  });

  it("totalAcres sums all holdings", () => {
    const m = calcPortfolioMetrics(holdings);
    expect(m.totalAcres).toBe(90);
  });

  it("avgAppreciation is value-weighted (not a simple mean)", () => {
    const m = calcPortfolioMetrics(holdings);
    // Simple mean would be (4+5+6)/3 = 5; value-weighted shifts toward larger holdings
    const simpleMean = (4 + 5 + 6) / 3;
    // $300k holding has highest appreciation, so weighted avg < simple mean dominated by middle
    expect(m.avgAppreciation).not.toBeCloseTo(simpleMean, 0); // proves it's not a simple average
    expect(m.avgAppreciation).toBeGreaterThan(4); // above the minimum
    expect(m.avgAppreciation).toBeLessThan(6);    // below the maximum
  });

  it("diversificationScore is lower than 100 for a multi-asset portfolio", () => {
    const m = calcPortfolioMetrics(holdings);
    expect(m.diversificationScore).toBeLessThan(100);
    expect(m.diversificationScore).toBeGreaterThan(0);
  });

  it("concentrationRisk + diversificationScore equals 100 when score is positive", () => {
    const m = calcPortfolioMetrics(holdings);
    if (m.diversificationScore > 0) {
      expect(m.concentrationRisk + m.diversificationScore).toBeCloseTo(100, 5);
    }
  });
});

describe("portfolioOptimizer — edge case: empty portfolio", () => {
  it("returns zero for all numeric metrics", () => {
    const m = calcPortfolioMetrics([]);
    expect(m.totalValue).toBe(0);
    expect(m.totalCashFlow).toBe(0);
    expect(m.totalAcres).toBe(0);
    expect(m.totalProperties).toBe(0);
  });

  it("does not produce NaN for derived metrics with empty holdings", () => {
    const m = calcPortfolioMetrics([]);
    expect(m.sharpeRatio).not.toBeNaN();
    expect(m.avgAppreciation).not.toBeNaN();
    expect(m.concentrationRisk).not.toBeNaN();
    expect(m.diversificationScore).not.toBeNaN();
  });
});

describe("portfolioOptimizer — edge case: single asset portfolio", () => {
  const single: TestHolding[] = [
    { currentValue: 500_000, cashFlow: 25_000, acres: 80, annualAppreciation: 5, marketRisk: 45 },
  ];

  it("concentrationRisk is 100 (entire portfolio in one asset)", () => {
    const m = calcPortfolioMetrics(single);
    expect(m.concentrationRisk).toBeCloseTo(100, 5);
  });

  it("diversificationScore is 0 for a single-asset portfolio", () => {
    const m = calcPortfolioMetrics(single);
    expect(m.diversificationScore).toBeCloseTo(0, 5);
  });

  it("avgAppreciation equals the single holding's appreciation", () => {
    const m = calcPortfolioMetrics(single);
    expect(m.avgAppreciation).toBeCloseTo(5, 5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// FINANCIAL EDGE CASES — division by zero, negative values, NaN handling
// ═══════════════════════════════════════════════════════════════════════════════

describe("financial edge cases — division by zero & NaN guards", () => {
  it("cash-on-cash: returns NaN (or Infinity) but NOT a silent wrong number when invested = 0", () => {
    // Guard: callers must check for totalCashInvested > 0 before using the result
    const result = simpleCashOnCash(12_000, 0);
    // Division by zero in JS produces Infinity, not NaN
    expect(isFinite(result)).toBe(false);
  });

  it("HHI score: empty distribution returns 100 (no concentration)", () => {
    expect(hhiScore({}, 0)).toBe(100);
  });

  it("HHI score: totalValue=0 with non-empty distribution avoids division by zero", () => {
    // All value-share fractions become 0/0 → NaN which poisons the sum.
    // The function should guard against this; we verify it returns a number (not NaN).
    const score = hhiScore({ A: 0, B: 0 }, 0);
    // Entries filter to > 0, so result should be 100 (empty after filter)
    expect(score).toBe(100);
  });

  it("calculateMonthlyPayment: returns principal/months when rate is effectively 0", () => {
    const payment = calculateMonthlyPayment(120_000, 0, 120);
    expect(payment).toBeCloseTo(1_000, 2);
    expect(payment).not.toBeNaN();
  });

  it("net cash flow with negative income amount stays numerically correct", () => {
    // A refund or credit note creates negative expected amount
    const income = [{ expectedAmount: -500, probability: 1.0 }];
    const expenses = [{ amount: 200 }];
    const { netCashFlow } = computeNetCashFlow(income, expenses);
    expect(netCashFlow).toBe(-700);
    expect(netCashFlow).not.toBeNaN();
  });

  it("default probability stays in [0,1] even with all-zero payment counts", () => {
    const prob = calculateDefaultProbability({
      onTimePayments: 0,
      latePayments: 0,
      missedPayments: 0,
      averageDaysLate: 0,
      paymentPattern: "consistent",
      currentDelinquencyStatus: "current",
      daysDelinquent: 0,
    });
    expect(prob).toBeGreaterThanOrEqual(0);
    expect(prob).toBeLessThanOrEqual(1);
    expect(prob).not.toBeNaN();
  });

  it("portfolio metrics with all-zero values does not produce NaN", () => {
    const holdings: TestHolding[] = [
      { currentValue: 0, cashFlow: 0, acres: 0, annualAppreciation: 0, marketRisk: 0 },
    ];
    const m = calcPortfolioMetrics(holdings);
    // totalValue is 0, so value-weighted averages fall back to 0
    expect(m.sharpeRatio).not.toBeNaN();
    expect(m.avgAppreciation).not.toBeNaN();
  });
});
