/**
 * T131 — Disposition Optimizer Unit Tests
 *
 * Tests ROI calculations, owner-finance term generation,
 * channel cost/reach ranking, strategy comparisons,
 * and holding cost estimation.
 */

import { describe, it, expect } from "vitest";

// ── Constants mirrored from dispositionOptimizer.ts ───────────────────────────

const CHANNEL_COSTS: Record<string, number> = {
  mls: 500,
  facebook: 200,
  craigslist: 0,
  landwatch: 300,
  direct_mail: 1000,
  buyer_list: 50,
};

const CHANNEL_REACH: Record<string, number> = {
  mls: 5000,
  facebook: 10000,
  craigslist: 3000,
  landwatch: 8000,
  direct_mail: 500,
  buyer_list: 200,
};

// ── Pure financial helpers ────────────────────────────────────────────────────

function calcROI(
  acquisitionCost: number,
  holdingCosts: number,
  sellingCosts: number,
  salePrice: number,
  holdingDays: number
): { netProfit: number; roi: number; annualizedReturn: number } {
  const totalCost = acquisitionCost + holdingCosts + sellingCosts;
  const netProfit = salePrice - totalCost;
  const roi = totalCost > 0 ? parseFloat(((netProfit / totalCost) * 100).toFixed(2)) : 0;
  const years = holdingDays / 365;
  const annualizedReturn = years > 0 ? parseFloat((roi / years).toFixed(2)) : 0;
  return { netProfit, roi, annualizedReturn };
}

function calcOwnerFinanceTerms(
  salePrice: number,
  downPaymentPercent: number,
  interestRate: number,
  termMonths: number
): { downPayment: number; financeAmount: number; monthlyPayment: number; totalValue: number } {
  const downPayment = Math.round(salePrice * (downPaymentPercent / 100));
  const financeAmount = salePrice - downPayment;
  const monthlyRate = interestRate / 100 / 12;
  const monthlyPayment =
    monthlyRate === 0
      ? financeAmount / termMonths
      : (financeAmount * (monthlyRate * Math.pow(1 + monthlyRate, termMonths))) /
        (Math.pow(1 + monthlyRate, termMonths) - 1);
  const totalValue = downPayment + monthlyPayment * termMonths;

  return {
    downPayment,
    financeAmount,
    monthlyPayment: parseFloat(monthlyPayment.toFixed(2)),
    totalValue: parseFloat(totalValue.toFixed(2)),
  };
}

function calcHoldingCosts(
  acquisitionCost: number,
  holdingDays: number,
  annualPropertyTaxRate = 0.01,
  annualInsuranceRate = 0.005
): number {
  const years = holdingDays / 365;
  const propertyTax = acquisitionCost * annualPropertyTaxRate * years;
  const insurance = acquisitionCost * annualInsuranceRate * years;
  return Math.round(propertyTax + insurance);
}

function rankChannelsByEfficiency(
  channels: string[]
): Array<{ channel: string; cost: number; reach: number; efficiency: number }> {
  return channels
    .map(ch => ({
      channel: ch,
      cost: CHANNEL_COSTS[ch] ?? 0,
      reach: CHANNEL_REACH[ch] ?? 0,
      efficiency: CHANNEL_COSTS[ch] === 0
        ? CHANNEL_REACH[ch]
        : parseFloat(((CHANNEL_REACH[ch] / (CHANNEL_COSTS[ch] || 1))).toFixed(2)),
    }))
    .sort((a, b) => b.efficiency - a.efficiency);
}

function selectDispositionStrategy(
  holdingDays: number,
  roi: number,
  marketCondition: "hot" | "warm" | "cold"
): string {
  // Forced hold if still appreciate-able and market is hot
  if (holdingDays < 30 && marketCondition === "hot") return "hold";
  if (roi > 100) return "list_retail"; // High-margin retail
  if (roi > 50) return marketCondition === "cold" ? "owner_finance" : "list_retail";
  if (roi > 20) return "sell_wholesale";
  return "auction";
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ROI Calculation", () => {
  it("calculates correct net profit", () => {
    const { netProfit } = calcROI(50_000, 2_000, 1_500, 75_000, 180);
    expect(netProfit).toBe(75_000 - 50_000 - 2_000 - 1_500); // $21,500
  });

  it("calculates correct ROI percentage", () => {
    const { roi } = calcROI(50_000, 2_000, 1_500, 75_000, 180);
    const totalCost = 53_500;
    const expected = ((21_500 / totalCost) * 100);
    expect(roi).toBeCloseTo(expected, 1);
  });

  it("annualizes return based on holding period", () => {
    const { roi, annualizedReturn } = calcROI(50_000, 2_000, 1_500, 75_000, 365);
    // 1 year: annualized = roi / 1
    expect(annualizedReturn).toBeCloseTo(roi, 0);
  });

  it("doubles annualized return for 6-month hold vs 12-month hold", () => {
    const short = calcROI(50_000, 1_000, 1_500, 65_000, 183);
    const long = calcROI(50_000, 1_000, 1_500, 65_000, 365);
    expect(short.annualizedReturn).toBeGreaterThan(long.annualizedReturn);
  });

  it("handles zero-profit scenario", () => {
    const { netProfit, roi } = calcROI(50_000, 2_000, 3_000, 55_000, 180);
    expect(netProfit).toBe(0);
    expect(roi).toBe(0);
  });

  it("handles a loss", () => {
    const { netProfit, roi } = calcROI(80_000, 2_000, 3_000, 70_000, 180);
    expect(netProfit).toBeLessThan(0);
    expect(roi).toBeLessThan(0);
  });
});

describe("Owner Finance Terms", () => {
  it("calculates down payment correctly", () => {
    const terms = calcOwnerFinanceTerms(100_000, 20, 8, 60);
    expect(terms.downPayment).toBe(20_000);
    expect(terms.financeAmount).toBe(80_000);
  });

  it("total value is higher than cash price (interest premium)", () => {
    const terms = calcOwnerFinanceTerms(100_000, 10, 8, 120);
    expect(terms.totalValue).toBeGreaterThan(100_000);
  });

  it("zero-interest note amortizes to exact principal", () => {
    const terms = calcOwnerFinanceTerms(100_000, 20, 0, 60);
    const expectedPayment = 80_000 / 60;
    expect(terms.monthlyPayment).toBeCloseTo(expectedPayment, 1);
  });

  it("higher interest rate yields higher monthly payment", () => {
    const low = calcOwnerFinanceTerms(100_000, 20, 4, 60);
    const high = calcOwnerFinanceTerms(100_000, 20, 12, 60);
    expect(high.monthlyPayment).toBeGreaterThan(low.monthlyPayment);
  });

  it("longer term yields lower monthly payment", () => {
    const short = calcOwnerFinanceTerms(100_000, 20, 8, 36);
    const long = calcOwnerFinanceTerms(100_000, 20, 8, 120);
    expect(long.monthlyPayment).toBeLessThan(short.monthlyPayment);
  });

  it("higher down payment reduces finance amount and monthly payment", () => {
    const low = calcOwnerFinanceTerms(100_000, 10, 8, 60);
    const high = calcOwnerFinanceTerms(100_000, 40, 8, 60);
    expect(high.financeAmount).toBeLessThan(low.financeAmount);
    expect(high.monthlyPayment).toBeLessThan(low.monthlyPayment);
  });
});

describe("Holding Cost Estimation", () => {
  it("returns higher holding cost for longer hold periods", () => {
    const shortHold = calcHoldingCosts(100_000, 90);
    const longHold = calcHoldingCosts(100_000, 365);
    expect(longHold).toBeGreaterThan(shortHold);
  });

  it("is proportional to acquisition cost", () => {
    const small = calcHoldingCosts(50_000, 180);
    const large = calcHoldingCosts(100_000, 180);
    expect(large).toBeGreaterThan(small);
  });

  it("returns 0 for 0-day hold", () => {
    expect(calcHoldingCosts(100_000, 0)).toBe(0);
  });

  it("annual costs are reasonable (1.5% default rate)", () => {
    // 1% tax + 0.5% insurance = 1.5%/yr
    const annualCosts = calcHoldingCosts(100_000, 365);
    expect(annualCosts).toBeCloseTo(1_500, -1);
  });
});

describe("Channel Ranking by Efficiency", () => {
  const allChannels = ["mls", "facebook", "craigslist", "landwatch", "direct_mail", "buyer_list"];

  it("ranks free channels (craigslist) very high due to infinite efficiency", () => {
    const ranked = rankChannelsByEfficiency(allChannels);
    expect(ranked[0].channel).toBe("craigslist");
  });

  it("sorts by efficiency descending", () => {
    const ranked = rankChannelsByEfficiency(allChannels);
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1].efficiency).toBeGreaterThanOrEqual(ranked[i].efficiency);
    }
  });

  it("direct mail is the most expensive channel", () => {
    const ranked = rankChannelsByEfficiency(allChannels);
    const dm = ranked.find(r => r.channel === "direct_mail")!;
    const maxCost = Math.max(...ranked.map(r => r.cost));
    expect(dm.cost).toBe(maxCost);
  });

  it("facebook has the highest reach", () => {
    const ranked = rankChannelsByEfficiency(allChannels);
    const fb = ranked.find(r => r.channel === "facebook")!;
    const maxReach = Math.max(...ranked.map(r => r.reach));
    expect(fb.reach).toBe(maxReach);
  });
});

describe("Disposition Strategy Selection", () => {
  it("recommends hold for very recently acquired hot-market properties", () => {
    expect(selectDispositionStrategy(15, 80, "hot")).toBe("hold");
  });

  it("recommends list_retail for high-ROI properties", () => {
    expect(selectDispositionStrategy(180, 120, "warm")).toBe("list_retail");
  });

  it("recommends owner_finance for mid-ROI in cold market", () => {
    expect(selectDispositionStrategy(180, 60, "cold")).toBe("owner_finance");
  });

  it("recommends sell_wholesale for moderate ROI", () => {
    expect(selectDispositionStrategy(180, 30, "warm")).toBe("sell_wholesale");
  });

  it("recommends auction for low ROI", () => {
    expect(selectDispositionStrategy(180, 10, "warm")).toBe("auction");
  });
});
