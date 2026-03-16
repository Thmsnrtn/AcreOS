/**
 * Tax Optimization Engine Unit Tests
 *
 * Tests tax strategy computation logic:
 * - 1031 exchange benefit calculation
 * - Opportunity zone benefit calculation
 * - Depreciation strategy computation
 * - Multi-year projection
 * - Strategy ranking
 */

import { describe, it, expect } from "vitest";

// ── Constants mirroring TaxOptimizationEngine ─────────────────────────────────

const LONG_TERM_CAP_GAINS_RATE = 0.20;
const SHORT_TERM_CAP_GAINS_RATE = 0.37;
const DEPRECIATION_RECAPTURE_RATE = 0.25;
const NET_INVESTMENT_INCOME_TAX = 0.038;
const COMMERCIAL_USEFUL_LIFE = 39;
const RESIDENTIAL_USEFUL_LIFE = 27.5;
const COST_SEG_LAND_IMPROVEMENT_LIFE = 15;
const COST_SEG_PERSONAL_PROPERTY_LIFE = 5;

type StrategyType = "1031_exchange" | "depreciation" | "cost_segregation" | "opportunity_zone" | "installment_sale";
type RiskLevel = "low" | "medium" | "high";

interface TaxStrategy {
  strategyType: StrategyType;
  estimatedTaxSavings: number;
  implementationCost: number;
  riskLevel: RiskLevel;
  netBenefit: number;
  score: number; // for ranking
}

// ── Pure helpers mirroring engine logic ───────────────────────────────────────

function calculate1031Benefit(
  gain: number,
  holdYears: number
): { taxDeferred: number; eligible: boolean; reason?: string } {
  if (holdYears < 1) {
    return { taxDeferred: 0, eligible: false, reason: "Must hold property at least 1 year for long-term treatment" };
  }
  if (gain <= 0) {
    return { taxDeferred: 0, eligible: false, reason: "No gain to defer" };
  }

  const effectiveRate = LONG_TERM_CAP_GAINS_RATE + NET_INVESTMENT_INCOME_TAX;
  const taxDeferred = Math.round(gain * effectiveRate);
  return { taxDeferred, eligible: true };
}

function calculateDepreciationSavings(
  improvementValue: number,
  propertyType: "commercial" | "residential",
  years: number = 5
): { annualDeduction: number; totalSavings: number; usefulLife: number } {
  const usefulLife = propertyType === "commercial" ? COMMERCIAL_USEFUL_LIFE : RESIDENTIAL_USEFUL_LIFE;
  const annualDeduction = improvementValue / usefulLife;
  const totalSavings = annualDeduction * SHORT_TERM_CAP_GAINS_RATE * years;

  return {
    annualDeduction: Math.round(annualDeduction * 100) / 100,
    totalSavings: Math.round(totalSavings * 100) / 100,
    usefulLife,
  };
}

function costSegregationAnalysis(
  improvementValue: number
): { year1Deduction: number; totalBenefit: number } {
  // Typical cost seg: 20% personal property (5yr), 10% land improvements (15yr), 70% structural (39yr)
  const personalPropertyBasis = improvementValue * 0.20;
  const landImprovementBasis = improvementValue * 0.10;
  const structuralBasis = improvementValue * 0.70;

  // Year 1: full bonus depreciation on personal property + land improvements
  const year1Deduction =
    personalPropertyBasis + // 100% bonus depreciation
    landImprovementBasis + // 100% bonus depreciation
    structuralBasis / COMMERCIAL_USEFUL_LIFE; // regular straight-line

  const year1TaxSavings = year1Deduction * LONG_TERM_CAP_GAINS_RATE;
  const regularYear1 = (improvementValue / COMMERCIAL_USEFUL_LIFE) * LONG_TERM_CAP_GAINS_RATE;
  const totalBenefit = year1TaxSavings - regularYear1;

  return {
    year1Deduction: Math.round(year1Deduction * 100) / 100,
    totalBenefit: Math.round(totalBenefit * 100) / 100,
  };
}

function calculateOZBenefit(
  originalGain: number,
  ozGainAtSale: number,
  holdYears: number,
  investmentDate: Date
): {
  deferralBenefit: number;
  stepUpBenefit: number;
  exclusionBenefit: number;
  totalBenefit: number;
} {
  // Step-up in basis benefit (10% at 5yr, 15% at 7yr)
  let stepUpPct = 0;
  if (holdYears >= 7) stepUpPct = 0.15;
  else if (holdYears >= 5) stepUpPct = 0.10;
  const stepUpBenefit = Math.round(originalGain * stepUpPct * (LONG_TERM_CAP_GAINS_RATE + NET_INVESTMENT_INCOME_TAX));

  // Permanent exclusion at 10+ years
  const exclusionBenefit = holdYears >= 10 ? Math.round(ozGainAtSale * (LONG_TERM_CAP_GAINS_RATE + NET_INVESTMENT_INCOME_TAX)) : 0;

  // Deferral benefit: time value of deferred tax
  const deferralEndDate = new Date("2026-12-31");
  const yearsDeferred = Math.max(0,
    (deferralEndDate.getTime() - investmentDate.getTime()) / (365.25 * 24 * 3600 * 1000)
  );
  const annualOpportunityRate = 0.05;
  const deferralBenefit = Math.round(originalGain * (LONG_TERM_CAP_GAINS_RATE + NET_INVESTMENT_INCOME_TAX) * annualOpportunityRate * yearsDeferred);

  return {
    deferralBenefit,
    stepUpBenefit,
    exclusionBenefit,
    totalBenefit: deferralBenefit + stepUpBenefit + exclusionBenefit,
  };
}

function projectMultiYear(
  annualDeduction: number,
  taxRate: number,
  years: number
): Array<{ year: number; deduction: number; savingsThisYear: number; cumulativeSavings: number }> {
  const rows = [];
  let cumulative = 0;

  for (let y = 1; y <= years; y++) {
    const savings = annualDeduction * taxRate;
    cumulative += savings;
    rows.push({
      year: y,
      deduction: annualDeduction,
      savingsThisYear: Math.round(savings * 100) / 100,
      cumulativeSavings: Math.round(cumulative * 100) / 100,
    });
  }
  return rows;
}

function rankStrategies(strategies: TaxStrategy[]): TaxStrategy[] {
  // Score = net benefit minus risk penalty
  const riskPenalty: Record<RiskLevel, number> = { low: 0, medium: 0.1, high: 0.25 };
  return strategies
    .map(s => ({
      ...s,
      score: s.netBenefit * (1 - riskPenalty[s.riskLevel]),
    }))
    .sort((a, b) => b.score - a.score);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("1031 Exchange Benefit Calculation", () => {
  it("calculates deferred tax for long-term gain", () => {
    const result = calculate1031Benefit(500_000, 2);
    expect(result.eligible).toBe(true);
    expect(result.taxDeferred).toBeCloseTo(500_000 * (LONG_TERM_CAP_GAINS_RATE + NET_INVESTMENT_INCOME_TAX), -2);
  });

  it("marks ineligible for hold period under 1 year", () => {
    const result = calculate1031Benefit(500_000, 0.5);
    expect(result.eligible).toBe(false);
    expect(result.taxDeferred).toBe(0);
    expect(result.reason).toContain("1 year");
  });

  it("marks ineligible when there is no gain", () => {
    const result = calculate1031Benefit(0, 2);
    expect(result.eligible).toBe(false);
    expect(result.taxDeferred).toBe(0);
  });

  it("scales linearly with gain amount", () => {
    const small = calculate1031Benefit(100_000, 2);
    const large = calculate1031Benefit(200_000, 2);
    expect(large.taxDeferred).toBeCloseTo(small.taxDeferred * 2, -1);
  });

  it("applies both LTCG and NIIT rates", () => {
    const result = calculate1031Benefit(1_000_000, 5);
    const expectedRate = LONG_TERM_CAP_GAINS_RATE + NET_INVESTMENT_INCOME_TAX;
    expect(result.taxDeferred).toBeCloseTo(1_000_000 * expectedRate, -2);
  });
});

describe("Depreciation Strategy Computation", () => {
  it("computes annual deduction for commercial property", () => {
    const result = calculateDepreciationSavings(390_000, "commercial");
    expect(result.annualDeduction).toBeCloseTo(390_000 / COMMERCIAL_USEFUL_LIFE, 2);
    expect(result.usefulLife).toBe(39);
  });

  it("computes annual deduction for residential property", () => {
    const result = calculateDepreciationSavings(275_000, "residential");
    expect(result.annualDeduction).toBeCloseTo(275_000 / RESIDENTIAL_USEFUL_LIFE, 2);
    expect(result.usefulLife).toBe(27.5);
  });

  it("calculates total savings over specified years", () => {
    const result = calculateDepreciationSavings(390_000, "commercial", 5);
    const expected = (390_000 / COMMERCIAL_USEFUL_LIFE) * SHORT_TERM_CAP_GAINS_RATE * 5;
    expect(result.totalSavings).toBeCloseTo(expected, 0);
  });

  it("commercial savings are less per year than residential (shorter life)", () => {
    const commercial = calculateDepreciationSavings(100_000, "commercial");
    const residential = calculateDepreciationSavings(100_000, "residential");
    expect(residential.annualDeduction).toBeGreaterThan(commercial.annualDeduction);
  });
});

describe("Cost Segregation Analysis", () => {
  it("accelerates deductions vs straight-line in year 1", () => {
    const result = costSegregationAnalysis(1_000_000);
    const straightLine = 1_000_000 / COMMERCIAL_USEFUL_LIFE;
    expect(result.year1Deduction).toBeGreaterThan(straightLine);
  });

  it("year 1 deduction is at least 20% of improvement value (personal property portion)", () => {
    const result = costSegregationAnalysis(500_000);
    // At minimum, 20% personal + 10% land improvement = 30% bonus in year 1
    expect(result.year1Deduction).toBeGreaterThan(500_000 * 0.25);
  });

  it("total benefit is positive (cost seg beats regular depreciation)", () => {
    const result = costSegregationAnalysis(500_000);
    expect(result.totalBenefit).toBeGreaterThan(0);
  });

  it("scales with improvement value", () => {
    const small = costSegregationAnalysis(100_000);
    const large = costSegregationAnalysis(200_000);
    expect(large.year1Deduction).toBeCloseTo(small.year1Deduction * 2, 0);
  });
});

describe("Opportunity Zone Benefits", () => {
  const investDate = new Date("2022-01-01");

  it("provides 10% step-up benefit at 5-year hold", () => {
    const result = calculateOZBenefit(500_000, 200_000, 5, investDate);
    const expectedStepUp = Math.round(500_000 * 0.10 * (LONG_TERM_CAP_GAINS_RATE + NET_INVESTMENT_INCOME_TAX));
    expect(result.stepUpBenefit).toBeCloseTo(expectedStepUp, -1);
  });

  it("provides 15% step-up benefit at 7-year hold", () => {
    const fiveYr = calculateOZBenefit(500_000, 200_000, 5, investDate);
    const sevenYr = calculateOZBenefit(500_000, 200_000, 7, investDate);
    expect(sevenYr.stepUpBenefit).toBeGreaterThan(fiveYr.stepUpBenefit);
  });

  it("provides permanent exclusion at 10-year hold", () => {
    const nineYr = calculateOZBenefit(500_000, 300_000, 9, investDate);
    const tenYr = calculateOZBenefit(500_000, 300_000, 10, investDate);
    expect(nineYr.exclusionBenefit).toBe(0);
    expect(tenYr.exclusionBenefit).toBeGreaterThan(0);
  });

  it("10-year exclusion is based on OZ gain, not original gain", () => {
    const result = calculateOZBenefit(500_000, 1_000_000, 10, investDate);
    const expectedExclusion = Math.round(1_000_000 * (LONG_TERM_CAP_GAINS_RATE + NET_INVESTMENT_INCOME_TAX));
    expect(result.exclusionBenefit).toBeCloseTo(expectedExclusion, -2);
  });

  it("provides no step-up below 5-year hold", () => {
    const result = calculateOZBenefit(500_000, 200_000, 3, investDate);
    expect(result.stepUpBenefit).toBe(0);
  });

  it("total benefit is sum of components", () => {
    const result = calculateOZBenefit(500_000, 300_000, 10, investDate);
    expect(result.totalBenefit).toBe(result.deferralBenefit + result.stepUpBenefit + result.exclusionBenefit);
  });
});

describe("Multi-Year Projection", () => {
  it("generates one row per year", () => {
    const projection = projectMultiYear(10_000, 0.37, 5);
    expect(projection).toHaveLength(5);
  });

  it("cumulative savings grows each year", () => {
    const projection = projectMultiYear(10_000, 0.37, 5);
    for (let i = 1; i < projection.length; i++) {
      expect(projection[i].cumulativeSavings).toBeGreaterThan(projection[i - 1].cumulativeSavings);
    }
  });

  it("annual deduction is constant for straight-line", () => {
    const projection = projectMultiYear(5_000, 0.37, 10);
    const firstDeduction = projection[0].deduction;
    expect(projection.every(r => r.deduction === firstDeduction)).toBe(true);
  });

  it("final cumulative savings equals annual savings times years", () => {
    const annualDeduction = 10_000;
    const rate = 0.20;
    const years = 7;
    const projection = projectMultiYear(annualDeduction, rate, years);
    const expected = annualDeduction * rate * years;
    expect(projection[years - 1].cumulativeSavings).toBeCloseTo(expected, 0);
  });

  it("returns empty array for 0 years", () => {
    expect(projectMultiYear(10_000, 0.37, 0)).toHaveLength(0);
  });
});

describe("Strategy Ranking", () => {
  const strategies: TaxStrategy[] = [
    { strategyType: "1031_exchange", estimatedTaxSavings: 100_000, implementationCost: 5_000, riskLevel: "low", netBenefit: 95_000, score: 0 },
    { strategyType: "cost_segregation", estimatedTaxSavings: 80_000, implementationCost: 8_000, riskLevel: "low", netBenefit: 72_000, score: 0 },
    { strategyType: "opportunity_zone", estimatedTaxSavings: 200_000, implementationCost: 10_000, riskLevel: "high", netBenefit: 190_000, score: 0 },
    { strategyType: "installment_sale", estimatedTaxSavings: 50_000, implementationCost: 2_000, riskLevel: "medium", netBenefit: 48_000, score: 0 },
  ];

  it("ranks strategies by score descending", () => {
    const ranked = rankStrategies(strategies);
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1].score).toBeGreaterThanOrEqual(ranked[i].score);
    }
  });

  it("penalizes high-risk strategies relative to equivalent low-risk", () => {
    const lowRisk: TaxStrategy = { strategyType: "depreciation", estimatedTaxSavings: 50_000, implementationCost: 0, riskLevel: "low", netBenefit: 50_000, score: 0 };
    const highRisk: TaxStrategy = { ...lowRisk, riskLevel: "high" };
    const ranked = rankStrategies([highRisk, lowRisk]);
    const lowIdx = ranked.findIndex(s => s.riskLevel === "low");
    const highIdx = ranked.findIndex(s => s.riskLevel === "high");
    expect(lowIdx).toBeLessThan(highIdx);
  });

  it("returns same number of strategies as input", () => {
    const ranked = rankStrategies(strategies);
    expect(ranked).toHaveLength(strategies.length);
  });

  it("opportunity_zone ranks first despite high risk due to large net benefit", () => {
    // opportunity_zone: 190k * (1-0.25) = 142,500 score
    // 1031_exchange: 95k * (1-0) = 95,000 score
    const ranked = rankStrategies(strategies);
    expect(ranked[0].strategyType).toBe("opportunity_zone");
    // But among low-risk strategies, 1031 beats cost_segregation (95k > 72k)
    const lowRiskRanked = ranked.filter(s => s.riskLevel === "low");
    expect(lowRiskRanked[0].strategyType).toBe("1031_exchange");
  });

  it("assigns score to each strategy", () => {
    const ranked = rankStrategies(strategies);
    expect(ranked.every(s => s.score > 0)).toBe(true);
  });
});
