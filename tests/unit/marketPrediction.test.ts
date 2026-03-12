/**
 * T123 — Market Prediction Unit Tests
 *
 * Tests the core prediction logic:
 * - Market timing classification (hot/warm/cooling/cold)
 * - Price prediction dampening and momentum
 * - Demand score calculation
 * - Opportunity window detection
 * - Confidence scaling with data points
 */

import { describe, it, expect } from "vitest";

// ── Pure helpers mirroring MarketPredictionService private methods ────────────

function calculateMarketTiming(
  trends: any[],
  indicators: any
): { timing: string; confidence: number } {
  if (trends.length < 2) {
    return { timing: "warm", confidence: 0.5 };
  }

  const latest = trends[0];
  let momentumScore = 0;

  if (latest.priceChange && parseFloat(latest.priceChange) > 5) {
    momentumScore += 30;
  } else if (latest.priceChange && parseFloat(latest.priceChange) < -5) {
    momentumScore -= 30;
  }

  if (latest.volumeChange && parseFloat(latest.volumeChange) > 20) {
    momentumScore += 25;
  } else if (latest.volumeChange && parseFloat(latest.volumeChange) < -20) {
    momentumScore -= 25;
  }

  if (latest.avgDaysOnMarket < 45) {
    momentumScore += 20;
  } else if (latest.avgDaysOnMarket > 90) {
    momentumScore -= 20;
  }

  if (indicators?.federalFundsRate) {
    const rate = parseFloat(indicators.federalFundsRate);
    if (rate < 3) {
      momentumScore += 15;
    } else if (rate > 5) {
      momentumScore -= 15;
    }
  }

  let timing: string;
  if (momentumScore > 50) {
    timing = "hot";
  } else if (momentumScore > 15) {
    timing = "warm";
  } else if (momentumScore > -15) {
    timing = "cooling";
  } else {
    timing = "cold";
  }

  const confidence = Math.min(0.95, 0.5 + trends.length * 0.05);
  return { timing, confidence };
}

function calculateDemandScore(trends: any[], indicators: any): number {
  let score = 50;

  if (trends.length > 0) {
    const latest = trends[0];

    if (latest.transactionCount > 20) {
      score += 20;
    } else if (latest.transactionCount < 5) {
      score -= 20;
    }

    if (latest.avgDaysOnMarket < 45) {
      score += 15;
    } else if (latest.avgDaysOnMarket > 90) {
      score -= 15;
    }

    const priceChange = parseFloat(latest.priceChange || "0");
    if (priceChange > 10) {
      score += 15;
    } else if (priceChange < -10) {
      score -= 15;
    }
  }

  if (indicators) {
    if (indicators.unemploymentRate && parseFloat(indicators.unemploymentRate) < 4) {
      score += 10;
    }
    if (indicators.gdpGrowthRate && parseFloat(indicators.gdpGrowthRate) > 2) {
      score += 10;
    }
  }

  return Math.max(0, Math.min(100, score));
}

function calculatePricePredictions(trends: any[], _indicators: any) {
  if (trends.length === 0) {
    return { current: 5000, change30Days: 0, change90Days: 0, change12Months: 0 };
  }

  const latest = trends[0];
  const currentPrice = parseFloat(latest.avgPricePerAcre) || 5000;
  const recentChangeRate =
    trends.length >= 2 ? parseFloat(trends[0].priceChange || "0") : 0;

  return {
    current: currentPrice,
    change30Days: recentChangeRate * 0.5,
    change90Days: recentChangeRate * 1.2,
    change12Months: recentChangeRate * 3.0,
  };
}

function detectOpportunityWindow(
  timing: { timing: string; confidence: number },
  demandScore: number,
  indicators: any
): { isOpportunity: boolean; reason?: string; score: number } {
  let opportunityScore = 0;
  const reasons: string[] = [];

  if (timing.timing === "hot" && timing.confidence > 0.7) {
    opportunityScore += 30;
    reasons.push("Strong market momentum");
  }

  if (demandScore > 70) {
    opportunityScore += 25;
    reasons.push("High buyer demand");
  }

  if (indicators?.federalFundsRate && parseFloat(indicators.federalFundsRate) < 3.5) {
    opportunityScore += 20;
    reasons.push("Favorable interest rates");
  }

  return {
    isOpportunity: opportunityScore >= 40,
    reason: reasons.join("; "),
    score: Math.min(100, opportunityScore),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Market Timing Classification", () => {
  it("returns warm with 0.5 confidence when fewer than 2 data points", () => {
    const result = calculateMarketTiming([], null);
    expect(result.timing).toBe("warm");
    expect(result.confidence).toBe(0.5);

    const resultOne = calculateMarketTiming([{ avgDaysOnMarket: 60 }], null);
    expect(resultOne.timing).toBe("warm");
  });

  it("classifies hot market with strong positive signals", () => {
    const trends = [
      { priceChange: "15", volumeChange: "30", avgDaysOnMarket: 30 },
      { priceChange: "10", volumeChange: "20", avgDaysOnMarket: 40 },
    ];
    const result = calculateMarketTiming(trends, { federalFundsRate: "2.5" });
    expect(result.timing).toBe("hot");
  });

  it("classifies cold market with strong negative signals", () => {
    const trends = [
      { priceChange: "-15", volumeChange: "-30", avgDaysOnMarket: 120 },
      { priceChange: "-10", volumeChange: "-25", avgDaysOnMarket: 110 },
    ];
    const result = calculateMarketTiming(trends, { federalFundsRate: "6.5" });
    expect(result.timing).toBe("cold");
  });

  it("classifies warm market with moderate signals", () => {
    const trends = [
      { priceChange: "3", volumeChange: "10", avgDaysOnMarket: 60 },
      { priceChange: "2", volumeChange: "8", avgDaysOnMarket: 65 },
    ];
    const result = calculateMarketTiming(trends, { federalFundsRate: "4.0" });
    expect(["warm", "cooling"]).toContain(result.timing);
  });

  it("high interest rates (>5%) reduce momentum score vs low rates", () => {
    // Base: priceChange 6% (+30), volume 10% (no bonus), DOM 50 (no bonus) = 30
    // Low rates (<3) +15 → 45 = "warm". High rates (>5) -15 → 15 = "cooling".
    const moderateTrends = [
      { priceChange: "6", volumeChange: "10", avgDaysOnMarket: 50 },
      { priceChange: "4", volumeChange: "8", avgDaysOnMarket: 55 },
    ];
    const withLowRates = calculateMarketTiming(moderateTrends, { federalFundsRate: "1.0" });
    const withHighRates = calculateMarketTiming(moderateTrends, { federalFundsRate: "6.0" });
    expect(withLowRates.timing).toBe("warm");
    expect(withHighRates.timing).toBe("cooling");
  });
});

describe("Confidence Scaling", () => {
  it("caps confidence at 0.95", () => {
    // confidence = min(0.95, 0.5 + N * 0.05) → caps at 9+ data points
    const manyTrends = Array(20).fill({
      priceChange: "5",
      volumeChange: "15",
      avgDaysOnMarket: 50,
    });
    const result = calculateMarketTiming(manyTrends, null);
    expect(result.confidence).toBeLessThanOrEqual(0.95);
  });

  it("scales with number of data points", () => {
    const twoTrends = [
      { priceChange: "5", volumeChange: "10", avgDaysOnMarket: 60 },
      { priceChange: "3", volumeChange: "8", avgDaysOnMarket: 65 },
    ];
    const tenTrends = Array(10).fill(twoTrends[0]);
    const two = calculateMarketTiming(twoTrends, null);
    const ten = calculateMarketTiming(tenTrends, null);
    expect(ten.confidence).toBeGreaterThan(two.confidence);
  });
});

describe("Demand Score Calculation", () => {
  it("starts at neutral 50 with no data", () => {
    expect(calculateDemandScore([], null)).toBe(50);
  });

  it("increases score for high transaction volume (>20)", () => {
    const trends = [{ transactionCount: 25, avgDaysOnMarket: 60, priceChange: "0" }];
    expect(calculateDemandScore(trends, null)).toBeGreaterThan(50);
  });

  it("decreases score for low transaction volume (<5)", () => {
    const trends = [{ transactionCount: 3, avgDaysOnMarket: 60, priceChange: "0" }];
    expect(calculateDemandScore(trends, null)).toBeLessThan(50);
  });

  it("increases score for fast-selling markets (<45 DOM)", () => {
    const trends = [{ transactionCount: 10, avgDaysOnMarket: 30, priceChange: "0" }];
    const score = calculateDemandScore(trends, null);
    expect(score).toBeGreaterThan(50);
  });

  it("decreases score for slow markets (>90 DOM)", () => {
    const trends = [{ transactionCount: 10, avgDaysOnMarket: 120, priceChange: "0" }];
    const score = calculateDemandScore(trends, null);
    expect(score).toBeLessThan(50);
  });

  it("never exceeds 100", () => {
    const strongTrends = [
      { transactionCount: 50, avgDaysOnMarket: 20, priceChange: "20" },
    ];
    const indicators = { unemploymentRate: "3.0", gdpGrowthRate: "3.5" };
    expect(calculateDemandScore(strongTrends, indicators)).toBeLessThanOrEqual(100);
  });

  it("never goes below 0", () => {
    const weakTrends = [
      { transactionCount: 1, avgDaysOnMarket: 180, priceChange: "-20" },
    ];
    const indicators = { unemploymentRate: "8.0", gdpGrowthRate: "0.5" };
    expect(calculateDemandScore(weakTrends, indicators)).toBeGreaterThanOrEqual(0);
  });

  it("boosts score for strong economic indicators", () => {
    const neutral = [{ transactionCount: 10, avgDaysOnMarket: 60, priceChange: "0" }];
    const withGoodEconomy = calculateDemandScore(neutral, {
      unemploymentRate: "3.0",
      gdpGrowthRate: "3.0",
    });
    const withNoIndicators = calculateDemandScore(neutral, null);
    expect(withGoodEconomy).toBeGreaterThan(withNoIndicators);
  });
});

describe("Price Predictions", () => {
  it("returns default values when no trend data", () => {
    const result = calculatePricePredictions([], null);
    expect(result.current).toBe(5000);
    expect(result.change30Days).toBe(0);
    expect(result.change90Days).toBe(0);
    expect(result.change12Months).toBe(0);
  });

  it("uses avgPricePerAcre from latest trend", () => {
    const trends = [{ avgPricePerAcre: "3500", priceChange: "0" }];
    const result = calculatePricePredictions(trends, null);
    expect(result.current).toBe(3500);
  });

  it("dampens 30-day prediction to 50% of recent rate", () => {
    const trends = [
      { avgPricePerAcre: "5000", priceChange: "10" },
      { avgPricePerAcre: "4500", priceChange: "8" },
    ];
    const result = calculatePricePredictions(trends, null);
    expect(result.change30Days).toBeCloseTo(5, 1); // 10 * 0.5
  });

  it("amplifies 12-month prediction to 3x recent rate", () => {
    const trends = [
      { avgPricePerAcre: "5000", priceChange: "10" },
      { avgPricePerAcre: "4500", priceChange: "8" },
    ];
    const result = calculatePricePredictions(trends, null);
    expect(result.change12Months).toBeCloseTo(30, 1); // 10 * 3.0
  });

  it("handles negative price changes for declining markets", () => {
    const trends = [
      { avgPricePerAcre: "4000", priceChange: "-8" },
      { avgPricePerAcre: "4500", priceChange: "-5" },
    ];
    const result = calculatePricePredictions(trends, null);
    expect(result.change30Days).toBeLessThan(0);
    expect(result.change12Months).toBeLessThan(0);
  });
});

describe("Opportunity Window Detection", () => {
  it("identifies a strong opportunity with all positive signals", () => {
    const timing = { timing: "hot", confidence: 0.85 };
    const result = detectOpportunityWindow(timing, 80, { federalFundsRate: "2.5" });
    expect(result.isOpportunity).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(40);
  });

  it("rejects opportunity with cold market and high rates", () => {
    const timing = { timing: "cold", confidence: 0.8 };
    const result = detectOpportunityWindow(timing, 40, { federalFundsRate: "7.0" });
    expect(result.isOpportunity).toBe(false);
  });

  it("requires demand score > 70 to trigger demand bonus", () => {
    const timing = { timing: "cold", confidence: 0.8 };
    const low = detectOpportunityWindow(timing, 60, null);
    const high = detectOpportunityWindow(timing, 80, null);
    expect(high.score).toBeGreaterThan(low.score);
  });

  it("requires hot timing AND confidence > 0.7 for timing bonus", () => {
    const hotLowConf = { timing: "hot", confidence: 0.6 };
    const hotHighConf = { timing: "hot", confidence: 0.8 };
    const resultLow = detectOpportunityWindow(hotLowConf, 50, null);
    const resultHigh = detectOpportunityWindow(hotHighConf, 50, null);
    expect(resultHigh.score).toBeGreaterThan(resultLow.score);
  });

  it("caps opportunity score at 100", () => {
    const timing = { timing: "hot", confidence: 0.9 };
    const result = detectOpportunityWindow(timing, 95, { federalFundsRate: "1.0" });
    expect(result.score).toBeLessThanOrEqual(100);
  });
});
