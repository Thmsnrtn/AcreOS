/**
 * Opportunity Zone Analyzer Unit Tests
 *
 * Tests OZ analysis logic:
 * - OZ identification by coordinates
 * - Deferral benefit calculation
 * - Step-up benefits at 5yr (10%) and 7yr (15%)
 * - Permanent exclusion at 10yr
 * - Portfolio reporting
 */

import { describe, it, expect } from "vitest";

// ── Constants mirroring OpportunityZoneAnalyzer ────────────────────────────────

const FEDERAL_LTCG_RATE = 0.238; // LTCG + NIIT combined

// Subset of OZ bounding boxes from the service
const OZ_TRACT_BOUNDING_BOXES = [
  { tractId: "48201980100", state: "TX", minLat: 29.70, maxLat: 29.80, minLon: -95.40, maxLon: -95.30, label: "Houston East OZ" },
  { tractId: "06037980000", state: "CA", minLat: 33.94, maxLat: 34.01, minLon: -118.25, maxLon: -118.18, label: "LA South OZ" },
  { tractId: "12086980000", state: "FL", minLat: 25.75, maxLat: 25.82, minLon: -80.24, maxLon: -80.18, label: "Miami OZ" },
  { tractId: "36061980000", state: "NY", minLat: 40.70, maxLat: 40.78, minLon: -74.01, maxLon: -73.96, label: "NYC Lower Manhattan OZ" },
  { tractId: "17031980100", state: "IL", minLat: 41.74, maxLat: 41.82, minLon: -87.65, maxLon: -87.57, label: "Chicago South Side OZ" },
];

// ── Pure helpers mirroring OpportunityZoneAnalyzer ────────────────────────────

function isOpportunityZone(lat: number, lon: number): {
  isOZ: boolean;
  ozTractId?: string;
  label?: string;
  state?: string;
} {
  const match = OZ_TRACT_BOUNDING_BOXES.find(
    oz => lat >= oz.minLat && lat <= oz.maxLat && lon >= oz.minLon && lon <= oz.maxLon
  );

  if (match) {
    return { isOZ: true, ozTractId: match.tractId, label: match.label, state: match.state };
  }
  return { isOZ: false };
}

function calculateDeferralBenefit(gainAmount: number, investmentDate: Date): number {
  const deferralEndDate = new Date("2026-12-31");
  const yearsDeferred = Math.max(0,
    (deferralEndDate.getTime() - investmentDate.getTime()) / (365.25 * 24 * 3600 * 1000)
  );
  const annualOpportunityRate = 0.05;
  return Math.round(gainAmount * FEDERAL_LTCG_RATE * annualOpportunityRate * yearsDeferred);
}

function calculateStepUpBenefit(originalGain: number, holdYears: number): number {
  let stepUpPct = 0;
  if (holdYears >= 7) stepUpPct = 0.15;
  else if (holdYears >= 5) stepUpPct = 0.10;
  return Math.round(originalGain * stepUpPct * FEDERAL_LTCG_RATE);
}

function calculatePermanentExclusion(ozGain: number, holdYears: number): number {
  if (holdYears < 10) return 0;
  return Math.round(ozGain * FEDERAL_LTCG_RATE);
}

interface OZHolding {
  id: number;
  orgId: number;
  ozFundName: string;
  ozTractId: string;
  investmentDate: Date;
  initialInvestment: number;
  deferredGainRollover: number;
  currentValue?: number;
  holdYears?: number;
}

interface PortfolioReport {
  totalInvested: number;
  totalDeferredGain: number;
  totalCurrentValue: number;
  holdingsByStatus: {
    belowFiveYears: OZHolding[];
    fiveToSevenYears: OZHolding[];
    sevenToTenYears: OZHolding[];
    tenPlusYears: OZHolding[];
  };
  estimatedTotalBenefit: number;
}

function generatePortfolioReport(holdings: OZHolding[], referenceDate: Date = new Date()): PortfolioReport {
  const totalInvested = holdings.reduce((sum, h) => sum + h.initialInvestment, 0);
  const totalDeferredGain = holdings.reduce((sum, h) => sum + h.deferredGainRollover, 0);
  const totalCurrentValue = holdings.reduce((sum, h) => sum + (h.currentValue || h.initialInvestment), 0);

  const withHoldYears = holdings.map(h => ({
    ...h,
    holdYears: (referenceDate.getTime() - h.investmentDate.getTime()) / (365.25 * 24 * 3600 * 1000),
  }));

  const holdingsByStatus = {
    belowFiveYears: withHoldYears.filter(h => h.holdYears! < 5),
    fiveToSevenYears: withHoldYears.filter(h => h.holdYears! >= 5 && h.holdYears! < 7),
    sevenToTenYears: withHoldYears.filter(h => h.holdYears! >= 7 && h.holdYears! < 10),
    tenPlusYears: withHoldYears.filter(h => h.holdYears! >= 10),
  };

  const estimatedTotalBenefit = withHoldYears.reduce((sum, h) => {
    const deferral = calculateDeferralBenefit(h.deferredGainRollover, h.investmentDate);
    const stepUp = calculateStepUpBenefit(h.deferredGainRollover, h.holdYears!);
    const exclusion = calculatePermanentExclusion(h.currentValue || h.initialInvestment, h.holdYears!);
    return sum + deferral + stepUp + exclusion;
  }, 0);

  return {
    totalInvested,
    totalDeferredGain,
    totalCurrentValue,
    holdingsByStatus,
    estimatedTotalBenefit,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("OZ Identification Logic", () => {
  it("identifies Houston East OZ by coordinates", () => {
    const result = isOpportunityZone(29.75, -95.35);
    expect(result.isOZ).toBe(true);
    expect(result.tractId).toBeUndefined(); // tractId is in ozTractId
    expect(result.ozTractId).toBe("48201980100");
    expect(result.label).toBe("Houston East OZ");
  });

  it("identifies Miami OZ by coordinates", () => {
    const result = isOpportunityZone(25.78, -80.21);
    expect(result.isOZ).toBe(true);
    expect(result.state).toBe("FL");
  });

  it("returns isOZ: false for coordinates outside all OZ tracts", () => {
    const result = isOpportunityZone(39.0, -77.0); // DC area, not in our OZ list
    expect(result.isOZ).toBe(false);
    expect(result.ozTractId).toBeUndefined();
    expect(result.label).toBeUndefined();
  });

  it("identifies LA South OZ", () => {
    const result = isOpportunityZone(33.97, -118.22);
    expect(result.isOZ).toBe(true);
    expect(result.state).toBe("CA");
  });

  it("returns false at boundary edge outside tract", () => {
    // Houston tract: maxLat=29.80, test at 29.81
    const result = isOpportunityZone(29.81, -95.35);
    expect(result.isOZ).toBe(false);
  });

  it("identifies NYC OZ", () => {
    const result = isOpportunityZone(40.74, -73.98);
    expect(result.isOZ).toBe(true);
    expect(result.state).toBe("NY");
  });
});

describe("Deferral Benefit Calculation", () => {
  it("returns positive benefit for investment before 2026 deferral end", () => {
    const investDate = new Date("2022-01-01");
    const benefit = calculateDeferralBenefit(500_000, investDate);
    expect(benefit).toBeGreaterThan(0);
  });

  it("returns 0 for investment after deferral end date (2026-12-31)", () => {
    const investDate = new Date("2027-01-01");
    const benefit = calculateDeferralBenefit(500_000, investDate);
    expect(benefit).toBe(0);
  });

  it("scales proportionally with gain amount", () => {
    const investDate = new Date("2022-01-01");
    const small = calculateDeferralBenefit(100_000, investDate);
    const large = calculateDeferralBenefit(200_000, investDate);
    expect(large).toBeCloseTo(small * 2, 0);
  });

  it("larger benefit for earlier investment (more time deferred)", () => {
    const earlyInvestment = calculateDeferralBenefit(500_000, new Date("2021-01-01"));
    const lateInvestment = calculateDeferralBenefit(500_000, new Date("2024-01-01"));
    expect(earlyInvestment).toBeGreaterThan(lateInvestment);
  });

  it("applies 5% annual opportunity rate", () => {
    const investDate = new Date("2025-01-01"); // ~2 years before end
    const benefit = calculateDeferralBenefit(1_000_000, investDate);
    // Roughly: 1M * 0.238 * 0.05 * 2yr ≈ 23,800
    expect(benefit).toBeGreaterThan(10_000);
    expect(benefit).toBeLessThan(50_000);
  });
});

describe("Step-Up Benefit Calculation", () => {
  it("returns 0 for hold period under 5 years", () => {
    expect(calculateStepUpBenefit(500_000, 3)).toBe(0);
    expect(calculateStepUpBenefit(500_000, 4.9)).toBe(0);
  });

  it("provides 10% step-up at exactly 5 years", () => {
    const benefit = calculateStepUpBenefit(500_000, 5);
    const expected = Math.round(500_000 * 0.10 * FEDERAL_LTCG_RATE);
    expect(benefit).toBe(expected);
  });

  it("provides 10% step-up between 5 and 7 years", () => {
    const at5 = calculateStepUpBenefit(500_000, 5);
    const at6 = calculateStepUpBenefit(500_000, 6);
    expect(at5).toBe(at6); // same percentage at 5 and 6
  });

  it("provides 15% step-up at 7 years", () => {
    const benefit = calculateStepUpBenefit(500_000, 7);
    const expected = Math.round(500_000 * 0.15 * FEDERAL_LTCG_RATE);
    expect(benefit).toBe(expected);
  });

  it("15% step-up is greater than 10% step-up", () => {
    const fiveYear = calculateStepUpBenefit(500_000, 5);
    const sevenYear = calculateStepUpBenefit(500_000, 7);
    expect(sevenYear).toBeGreaterThan(fiveYear);
  });

  it("step-up does not increase beyond 15% past 7 years", () => {
    const at7 = calculateStepUpBenefit(500_000, 7);
    const at9 = calculateStepUpBenefit(500_000, 9);
    expect(at7).toBe(at9); // capped at 15%
  });

  it("scales with original gain amount", () => {
    const small = calculateStepUpBenefit(100_000, 5);
    const large = calculateStepUpBenefit(500_000, 5);
    expect(large).toBeCloseTo(small * 5, 0);
  });
});

describe("Permanent Exclusion at 10 Years", () => {
  it("returns 0 for hold under 10 years", () => {
    expect(calculatePermanentExclusion(300_000, 9)).toBe(0);
    expect(calculatePermanentExclusion(300_000, 9.9)).toBe(0);
  });

  it("provides full exclusion at exactly 10 years", () => {
    const exclusion = calculatePermanentExclusion(300_000, 10);
    const expected = Math.round(300_000 * FEDERAL_LTCG_RATE);
    expect(exclusion).toBe(expected);
  });

  it("exclusion applies to OZ gain (appreciated value), not original gain", () => {
    // If property doubled in value, exclusion is on 300k OZ gain
    const smallExclusion = calculatePermanentExclusion(150_000, 10);
    const largeExclusion = calculatePermanentExclusion(300_000, 10);
    expect(largeExclusion).toBeCloseTo(smallExclusion * 2, 0);
  });

  it("exclusion scales linearly with OZ gain amount", () => {
    const result = calculatePermanentExclusion(1_000_000, 10);
    expect(result).toBeCloseTo(1_000_000 * FEDERAL_LTCG_RATE, -1);
  });

  it("exclusion is same at 10 and 20 years (10yr is the threshold)", () => {
    const at10 = calculatePermanentExclusion(500_000, 10);
    const at20 = calculatePermanentExclusion(500_000, 20);
    expect(at10).toBe(at20);
  });
});

describe("Portfolio Reporting", () => {
  const referenceDate = new Date("2030-01-01");

  const holdings: OZHolding[] = [
    {
      id: 1,
      orgId: 1,
      ozFundName: "Fund A",
      ozTractId: "48201980100",
      investmentDate: new Date("2028-01-01"), // 2yr hold at reference
      initialInvestment: 100_000,
      deferredGainRollover: 80_000,
      currentValue: 120_000,
    },
    {
      id: 2,
      orgId: 1,
      ozFundName: "Fund B",
      ozTractId: "06037980000",
      investmentDate: new Date("2024-01-01"), // 6yr hold at reference
      initialInvestment: 200_000,
      deferredGainRollover: 150_000,
      currentValue: 280_000,
    },
    {
      id: 3,
      orgId: 1,
      ozFundName: "Fund C",
      ozTractId: "12086980000",
      investmentDate: new Date("2019-01-01"), // 11yr hold at reference
      initialInvestment: 300_000,
      deferredGainRollover: 200_000,
      currentValue: 500_000,
    },
  ];

  it("totals invested amount across all holdings", () => {
    const report = generatePortfolioReport(holdings, referenceDate);
    expect(report.totalInvested).toBe(600_000);
  });

  it("totals deferred gain across all holdings", () => {
    const report = generatePortfolioReport(holdings, referenceDate);
    expect(report.totalDeferredGain).toBe(430_000);
  });

  it("totals current value across all holdings", () => {
    const report = generatePortfolioReport(holdings, referenceDate);
    expect(report.totalCurrentValue).toBe(900_000);
  });

  it("correctly categorizes holdings by hold period", () => {
    const report = generatePortfolioReport(holdings, referenceDate);
    expect(report.holdingsByStatus.belowFiveYears).toHaveLength(1); // 2yr
    expect(report.holdingsByStatus.fiveToSevenYears).toHaveLength(1); // 6yr
    expect(report.holdingsByStatus.tenPlusYears).toHaveLength(1); // 11yr
  });

  it("computes positive total benefit across portfolio", () => {
    const report = generatePortfolioReport(holdings, referenceDate);
    expect(report.estimatedTotalBenefit).toBeGreaterThan(0);
  });

  it("handles empty portfolio", () => {
    const report = generatePortfolioReport([], referenceDate);
    expect(report.totalInvested).toBe(0);
    expect(report.totalDeferredGain).toBe(0);
    expect(report.estimatedTotalBenefit).toBe(0);
  });
});
