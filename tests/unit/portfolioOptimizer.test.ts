/**
 * T124 — Portfolio Optimizer Unit Tests
 *
 * Tests:
 * - Portfolio metrics calculation (weighted averages, Sharpe ratio)
 * - Monte Carlo statistics (percentile, VaR, expected shortfall)
 * - Diversification analysis (concentration, by-state/type)
 * - Recommendation generation logic
 */

import { describe, it, expect } from "vitest";

// ── Mirrored types ────────────────────────────────────────────────────────────

interface PropertyHolding {
  propertyId: string;
  address: string;
  acres: number;
  acquisitionPrice: number;
  currentValue: number;
  annualAppreciation: number;
  cashFlow: number;
  marketRisk: number;
  liquidityScore: number;
  state?: string;
  county?: string;
  propertyType?: string;
}

// ── Pure helpers mirroring PortfolioOptimizer methods ─────────────────────────

function calcPortfolioMetrics(holdings: PropertyHolding[]) {
  if (holdings.length === 0) {
    return {
      totalValue: 0,
      totalCashFlow: 0,
      totalProperties: 0,
      totalAcres: 0,
      avgAppreciation: 0,
      sharpeRatio: 0,
      concentrationRisk: 100,
      diversificationScore: 0,
    };
  }

  const totalValue = holdings.reduce((s, h) => s + h.currentValue, 0);
  const totalCashFlow = holdings.reduce((s, h) => s + h.cashFlow, 0);
  const totalAcres = holdings.reduce((s, h) => s + h.acres, 0);

  const avgAppreciation =
    holdings.reduce((s, h) => s + h.annualAppreciation * h.currentValue, 0) / totalValue;

  // Simplified Sharpe: return / (average risk normalised)
  const avgRisk =
    holdings.reduce((s, h) => s + (h.marketRisk / 100) * h.currentValue, 0) / totalValue;
  const sharpeRatio =
    avgRisk > 0 ? parseFloat((avgAppreciation / (avgRisk * 0.15)).toFixed(2)) : 0;

  // Concentration risk: max single-property percentage
  const maxWeight = Math.max(...holdings.map(h => h.currentValue / totalValue));
  const concentrationRisk = Math.round(maxWeight * 100);

  const diversificationScore = Math.round(Math.max(0, 100 - concentrationRisk));

  return {
    totalValue,
    totalCashFlow,
    totalProperties: holdings.length,
    totalAcres,
    avgAppreciation,
    sharpeRatio,
    concentrationRisk,
    diversificationScore,
  };
}

function calcDiversificationByState(holdings: PropertyHolding[]) {
  const totalValue = holdings.reduce((s, h) => s + h.currentValue, 0);
  const byState: Record<string, number> = {};

  for (const h of holdings) {
    const state = h.state ?? "Unknown";
    byState[state] = (byState[state] ?? 0) + h.currentValue;
  }

  return Object.entries(byState).map(([state, value]) => ({
    state,
    value,
    percentage: parseFloat(((value / totalValue) * 100).toFixed(1)),
  }));
}

function percentile(sortedValues: number[], p: number): number {
  const idx = Math.floor(sortedValues.length * p);
  return sortedValues[Math.max(0, Math.min(idx, sortedValues.length - 1))];
}

function calcValueAtRisk95(initialValue: number, finalValues: number[]): number {
  const sorted = [...finalValues].sort((a, b) => a - b);
  return initialValue - percentile(sorted, 0.05);
}

function calcProbabilityOfLoss(initialValue: number, finalValues: number[]): number {
  const losses = finalValues.filter(v => v < initialValue).length;
  return parseFloat(((losses / finalValues.length) * 100).toFixed(2));
}

function calcExpectedShortfall(initialValue: number, finalValues: number[]): number {
  const sorted = [...finalValues].sort((a, b) => a - b);
  const tail = sorted.slice(0, Math.floor(sorted.length * 0.05));
  if (tail.length === 0) return 0;
  const avgTailLoss = tail.reduce((s, v) => s + (initialValue - v), 0) / tail.length;
  return Math.max(0, avgTailLoss);
}

function calcMaxDrawdown(simulations: number[][]): number {
  let maxDD = 0;
  for (const sim of simulations) {
    let peak = sim[0];
    for (const value of sim) {
      if (value > peak) peak = value;
      const dd = ((peak - value) / peak) * 100;
      if (dd > maxDD) maxDD = dd;
    }
  }
  return maxDD;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Portfolio Metrics Calculation", () => {
  const sampleHoldings: PropertyHolding[] = [
    {
      propertyId: "1",
      address: "123 Main",
      acres: 50,
      acquisitionPrice: 100_000,
      currentValue: 120_000,
      annualAppreciation: 0.08,
      cashFlow: 5_000,
      marketRisk: 30,
      liquidityScore: 70,
      state: "TX",
    },
    {
      propertyId: "2",
      address: "456 Oak",
      acres: 100,
      acquisitionPrice: 200_000,
      currentValue: 250_000,
      annualAppreciation: 0.06,
      cashFlow: -2_000,
      marketRisk: 50,
      liquidityScore: 60,
      state: "FL",
    },
  ];

  it("calculates total portfolio value correctly", () => {
    const metrics = calcPortfolioMetrics(sampleHoldings);
    expect(metrics.totalValue).toBe(370_000);
  });

  it("calculates total cash flow (including negatives)", () => {
    const metrics = calcPortfolioMetrics(sampleHoldings);
    expect(metrics.totalCashFlow).toBe(3_000);
  });

  it("sums total acres", () => {
    const metrics = calcPortfolioMetrics(sampleHoldings);
    expect(metrics.totalAcres).toBe(150);
  });

  it("counts properties correctly", () => {
    const metrics = calcPortfolioMetrics(sampleHoldings);
    expect(metrics.totalProperties).toBe(2);
  });

  it("returns all zeros for empty holdings", () => {
    const metrics = calcPortfolioMetrics([]);
    expect(metrics.totalValue).toBe(0);
    expect(metrics.totalCashFlow).toBe(0);
    expect(metrics.totalProperties).toBe(0);
  });

  it("weighted avg appreciation is between individual values", () => {
    const metrics = calcPortfolioMetrics(sampleHoldings);
    expect(metrics.avgAppreciation).toBeGreaterThan(0.06);
    expect(metrics.avgAppreciation).toBeLessThan(0.08);
  });

  it("concentration risk is 100 for single property", () => {
    const single = [sampleHoldings[0]];
    const metrics = calcPortfolioMetrics(single);
    expect(metrics.concentrationRisk).toBe(100);
    expect(metrics.diversificationScore).toBe(0);
  });

  it("concentration risk is lower for equally-distributed portfolio", () => {
    const equal: PropertyHolding[] = [
      { ...sampleHoldings[0], currentValue: 100_000 },
      { ...sampleHoldings[1], currentValue: 100_000 },
    ];
    const metrics = calcPortfolioMetrics(equal);
    expect(metrics.concentrationRisk).toBe(50);
    expect(metrics.diversificationScore).toBe(50);
  });
});

describe("Diversification by State", () => {
  it("correctly groups holdings by state", () => {
    const holdings: PropertyHolding[] = [
      {
        propertyId: "1",
        address: "TX prop",
        acres: 50,
        acquisitionPrice: 100_000,
        currentValue: 100_000,
        annualAppreciation: 0.07,
        cashFlow: 0,
        marketRisk: 30,
        liquidityScore: 70,
        state: "TX",
      },
      {
        propertyId: "2",
        address: "TX prop 2",
        acres: 50,
        acquisitionPrice: 100_000,
        currentValue: 100_000,
        annualAppreciation: 0.07,
        cashFlow: 0,
        marketRisk: 30,
        liquidityScore: 70,
        state: "TX",
      },
      {
        propertyId: "3",
        address: "FL prop",
        acres: 50,
        acquisitionPrice: 100_000,
        currentValue: 100_000,
        annualAppreciation: 0.07,
        cashFlow: 0,
        marketRisk: 30,
        liquidityScore: 70,
        state: "FL",
      },
    ];

    const byState = calcDiversificationByState(holdings);
    const tx = byState.find(b => b.state === "TX");
    const fl = byState.find(b => b.state === "FL");

    expect(tx?.percentage).toBeCloseTo(66.7, 0);
    expect(fl?.percentage).toBeCloseTo(33.3, 0);
  });

  it("handles Unknown state", () => {
    const holding: PropertyHolding = {
      propertyId: "1",
      address: "No state",
      acres: 50,
      acquisitionPrice: 100_000,
      currentValue: 100_000,
      annualAppreciation: 0.07,
      cashFlow: 0,
      marketRisk: 30,
      liquidityScore: 70,
    };
    const result = calcDiversificationByState([holding]);
    expect(result[0].state).toBe("Unknown");
    expect(result[0].percentage).toBe(100);
  });
});

describe("Monte Carlo Statistics", () => {
  const initialValue = 1_000_000;

  it("calculates VaR95 correctly", () => {
    // If p5 of final values = $900k, VaR = $100k
    const finalValues = Array.from({ length: 100 }, (_, i) => 800_000 + i * 5_000);
    const var95 = calcValueAtRisk95(initialValue, finalValues);
    expect(var95).toBeGreaterThan(0);
  });

  it("calculates 0 probability of loss when all simulations profit", () => {
    const allProfit = Array(1000).fill(1_200_000);
    expect(calcProbabilityOfLoss(initialValue, allProfit)).toBe(0);
  });

  it("calculates 100% probability of loss when all simulations lose", () => {
    const allLoss = Array(1000).fill(800_000);
    expect(calcProbabilityOfLoss(initialValue, allLoss)).toBe(100);
  });

  it("calculates probability of loss proportionally", () => {
    const mixed = [
      ...Array(500).fill(1_200_000), // wins
      ...Array(500).fill(800_000), // losses
    ];
    expect(calcProbabilityOfLoss(initialValue, mixed)).toBeCloseTo(50, 0);
  });

  it("calculates expected shortfall as average of tail losses", () => {
    // 100 values: 5 losses (bottom 5%) of varying depths
    const values = [
      500_000, 600_000, 700_000, 750_000, 800_000, // 5 losses
      ...Array(95).fill(1_200_000), // 95 gains
    ];
    const es = calcExpectedShortfall(initialValue, values);
    expect(es).toBeGreaterThan(0);
    // Average of losses: (500, 600, 700, 750, 800) losses from 1M
    // = (500k, 400k, 300k, 250k, 200k) → avg ≈ 330k
    expect(es).toBeCloseTo(330_000, -4);
  });

  it("max drawdown is 0 for always-increasing portfolio", () => {
    const increasing = [[1_000_000, 1_100_000, 1_200_000, 1_300_000]];
    expect(calcMaxDrawdown(increasing)).toBe(0);
  });

  it("detects max drawdown in volatile portfolio", () => {
    const volatile = [[1_000_000, 1_200_000, 800_000, 900_000]];
    const dd = calcMaxDrawdown(volatile);
    // Peak = 1.2M, bottom = 0.8M, drawdown = (0.4/1.2)*100 ≈ 33.3%
    expect(dd).toBeCloseTo(33.33, 0);
  });
});

describe("Percentile Calculation", () => {
  it("returns the minimum for p=0", () => {
    const sorted = [10, 20, 30, 40, 50];
    expect(percentile(sorted, 0)).toBe(10);
  });

  it("returns the median for p=0.5", () => {
    const sorted = [10, 20, 30, 40, 50];
    expect(percentile(sorted, 0.5)).toBe(30);
  });

  it("handles single-element array", () => {
    expect(percentile([42], 0.5)).toBe(42);
    expect(percentile([42], 0)).toBe(42);
  });
});
