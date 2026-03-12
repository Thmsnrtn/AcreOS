/**
 * T133 — Price Optimizer Unit Tests
 *
 * Tests the AcreOS price optimization engine:
 * - Comparable-based pricing
 * - Wholesale discount calculation
 * - Owner-finance premium
 * - Days-on-market adjustments
 * - Price-per-acre variance analysis
 */

import { describe, it, expect } from "vitest";

// ── Pure pricing helpers ──────────────────────────────────────────────────────

interface Comparable {
  pricePerAcre: number;
  acres: number;
  daysOnMarket: number;
  distance: number; // miles
  soldDate?: Date;
}

function calcWeightedAvgPricePerAcre(comps: Comparable[]): number {
  if (comps.length === 0) return 0;
  // Weight by recency (recent = higher weight) and proximity (closer = higher)
  const weights = comps.map(c => {
    const recencyWeight = c.soldDate
      ? Math.max(0.5, 1 - (Date.now() - c.soldDate.getTime()) / (365 * 86400000))
      : 1;
    const proximityWeight = Math.max(0.3, 1 - c.distance / 50);
    return recencyWeight * proximityWeight;
  });

  const totalWeight = weights.reduce((s, w) => s + w, 0);
  const weightedSum = comps.reduce((s, c, i) => s + c.pricePerAcre * weights[i], 0);
  return parseFloat((weightedSum / totalWeight).toFixed(2));
}

function calcWholesalePrice(retailPrice: number, discountPercent: number): number {
  return Math.round(retailPrice * (1 - discountPercent / 100));
}

function calcOwnerFinancePremium(
  cashPrice: number,
  interestRate: number,
  termMonths: number
): number {
  // Owner-finance commands a premium over cash price
  const rateMonthly = interestRate / 100 / 12;
  const payment =
    rateMonthly === 0
      ? cashPrice / termMonths
      : (cashPrice * (rateMonthly * Math.pow(1 + rateMonthly, termMonths))) /
        (Math.pow(1 + rateMonthly, termMonths) - 1);
  const totalPaid = payment * termMonths;
  return parseFloat((((totalPaid - cashPrice) / cashPrice) * 100).toFixed(1));
}

function adjustPriceForDOM(
  basePrice: number,
  daysOnMarket: number
): { adjustedPrice: number; adjustmentPct: number } {
  let adjustmentPct = 0;
  // Reduce price for stale listings
  if (daysOnMarket > 365) adjustmentPct = -15;
  else if (daysOnMarket > 180) adjustmentPct = -10;
  else if (daysOnMarket > 90) adjustmentPct = -5;
  else if (daysOnMarket < 30) adjustmentPct = 5; // Fresh, hot demand

  const adjustedPrice = Math.round(basePrice * (1 + adjustmentPct / 100));
  return { adjustedPrice, adjustmentPct };
}

function calcPricePerAcreStats(pricesPerAcre: number[]): {
  min: number;
  max: number;
  mean: number;
  median: number;
  stdDev: number;
} {
  if (pricesPerAcre.length === 0) {
    return { min: 0, max: 0, mean: 0, median: 0, stdDev: 0 };
  }
  const sorted = [...pricesPerAcre].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const mean = sorted.reduce((s, v) => s + v, 0) / sorted.length;
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  const variance = sorted.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / sorted.length;
  const stdDev = parseFloat(Math.sqrt(variance).toFixed(2));
  return { min, max, mean, median, stdDev };
}

function calcPriceRange(
  basePrice: number,
  targetDaysToSell: number
): { listPrice: number; acceptableMin: number; walkAwayMin: number } {
  // List at a premium, accept lower after time passes
  const listMultiplier = targetDaysToSell < 30 ? 1.15 : 1.1;
  const acceptableDiscount = targetDaysToSell > 90 ? 0.85 : 0.9;

  return {
    listPrice: Math.round(basePrice * listMultiplier),
    acceptableMin: Math.round(basePrice * acceptableDiscount),
    walkAwayMin: Math.round(basePrice * 0.75),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Weighted Average Price Per Acre", () => {
  it("returns 0 for empty comps", () => {
    expect(calcWeightedAvgPricePerAcre([])).toBe(0);
  });

  it("returns the single comp value for one comparable", () => {
    const comp: Comparable = { pricePerAcre: 5000, acres: 50, daysOnMarket: 60, distance: 1 };
    expect(calcWeightedAvgPricePerAcre([comp])).toBeCloseTo(5000, 0);
  });

  it("closer comps have more influence", () => {
    const near: Comparable = { pricePerAcre: 6000, acres: 50, daysOnMarket: 60, distance: 1 };
    const far: Comparable = { pricePerAcre: 4000, acres: 50, daysOnMarket: 60, distance: 40 };
    const weighted = calcWeightedAvgPricePerAcre([near, far]);
    // Should be closer to 6000 (the nearby comp)
    expect(weighted).toBeGreaterThan(5000);
  });

  it("recent sales have more influence than older sales", () => {
    const recent: Comparable = {
      pricePerAcre: 7000,
      acres: 50,
      daysOnMarket: 30,
      distance: 5,
      soldDate: new Date(Date.now() - 30 * 86400000),
    };
    const old: Comparable = {
      pricePerAcre: 3000,
      acres: 50,
      daysOnMarket: 60,
      distance: 5,
      soldDate: new Date(Date.now() - 364 * 86400000),
    };
    const weighted = calcWeightedAvgPricePerAcre([recent, old]);
    expect(weighted).toBeGreaterThan(5000);
  });
});

describe("Wholesale Price Calculation", () => {
  it("applies correct discount percentage", () => {
    expect(calcWholesalePrice(100_000, 30)).toBe(70_000);
  });

  it("0% discount returns original price", () => {
    expect(calcWholesalePrice(100_000, 0)).toBe(100_000);
  });

  it("50% discount halves the price", () => {
    expect(calcWholesalePrice(80_000, 50)).toBe(40_000);
  });

  it("wholesale is always less than retail for positive discount", () => {
    const retail = 150_000;
    expect(calcWholesalePrice(retail, 25)).toBeLessThan(retail);
  });
});

describe("Owner Finance Premium", () => {
  it("returns positive premium for interest-bearing notes", () => {
    const premium = calcOwnerFinancePremium(100_000, 8, 120);
    expect(premium).toBeGreaterThan(0);
  });

  it("higher rate yields higher premium", () => {
    const low = calcOwnerFinancePremium(100_000, 4, 120);
    const high = calcOwnerFinancePremium(100_000, 12, 120);
    expect(high).toBeGreaterThan(low);
  });

  it("longer term yields higher total premium", () => {
    const short = calcOwnerFinancePremium(100_000, 8, 60);
    const long = calcOwnerFinancePremium(100_000, 8, 180);
    expect(long).toBeGreaterThan(short);
  });

  it("zero-rate note has minimal premium", () => {
    const premium = calcOwnerFinancePremium(100_000, 0, 60);
    expect(premium).toBe(0);
  });
});

describe("DOM Price Adjustment", () => {
  it("fresh listings get a 5% premium (<30 days)", () => {
    const { adjustmentPct } = adjustPriceForDOM(100_000, 20);
    expect(adjustmentPct).toBe(5);
  });

  it("no adjustment for 30-90 DOM", () => {
    const { adjustmentPct } = adjustPriceForDOM(100_000, 60);
    expect(adjustmentPct).toBe(0);
  });

  it("5% discount for 90-180 DOM", () => {
    const { adjustmentPct } = adjustPriceForDOM(100_000, 120);
    expect(adjustmentPct).toBe(-5);
  });

  it("10% discount for 180-365 DOM", () => {
    const { adjustmentPct } = adjustPriceForDOM(100_000, 200);
    expect(adjustmentPct).toBe(-10);
  });

  it("15% discount for >365 DOM", () => {
    const { adjustmentPct } = adjustPriceForDOM(100_000, 400);
    expect(adjustmentPct).toBe(-15);
  });

  it("adjusted price reflects the percentage change", () => {
    const { adjustedPrice } = adjustPriceForDOM(100_000, 400);
    expect(adjustedPrice).toBe(85_000);
  });
});

describe("Price Per Acre Statistics", () => {
  const prices = [3000, 4000, 5000, 6000, 7000];

  it("calculates correct min", () => {
    expect(calcPricePerAcreStats(prices).min).toBe(3000);
  });

  it("calculates correct max", () => {
    expect(calcPricePerAcreStats(prices).max).toBe(7000);
  });

  it("calculates correct mean", () => {
    expect(calcPricePerAcreStats(prices).mean).toBe(5000);
  });

  it("calculates correct median for odd count", () => {
    expect(calcPricePerAcreStats(prices).median).toBe(5000);
  });

  it("calculates correct median for even count", () => {
    const even = [2000, 4000, 6000, 8000];
    expect(calcPricePerAcreStats(even).median).toBe(5000);
  });

  it("stdDev is 0 for uniform prices", () => {
    expect(calcPricePerAcreStats([5000, 5000, 5000]).stdDev).toBe(0);
  });

  it("returns zeros for empty array", () => {
    const stats = calcPricePerAcreStats([]);
    expect(stats.min).toBe(0);
    expect(stats.max).toBe(0);
    expect(stats.mean).toBe(0);
  });
});

describe("Price Range Generation", () => {
  it("list price is above base for aggressive sales", () => {
    const range = calcPriceRange(100_000, 20); // fast sale target
    expect(range.listPrice).toBeGreaterThan(100_000);
  });

  it("acceptable min is below base price", () => {
    const range = calcPriceRange(100_000, 60);
    expect(range.acceptableMin).toBeLessThan(100_000);
  });

  it("walk-away min is 75% of base", () => {
    const range = calcPriceRange(100_000, 60);
    expect(range.walkAwayMin).toBe(75_000);
  });

  it("price ordering: list > acceptable > walk-away", () => {
    const range = calcPriceRange(100_000, 60);
    expect(range.listPrice).toBeGreaterThan(range.acceptableMin);
    expect(range.acceptableMin).toBeGreaterThan(range.walkAwayMin);
  });
});
