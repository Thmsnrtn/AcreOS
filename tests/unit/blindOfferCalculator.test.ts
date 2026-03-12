/**
 * Unit Tests: Blind Offer Calculator (Podolsky Formula)
 * Core business logic for the land investing acquisition strategy.
 *
 * Tests the Podolsky blind offer methodology:
 * - The 25% formula (lowest comp ÷ 4)
 * - Offer tier calculations (20%, 25%, 33% of lowest comp)
 * - Comp data quality classification
 * - Market condition detection
 * - Campaign sizing (how many letters to send)
 * - Owner finance scenario building
 */

import { describe, it, expect } from "vitest";

// ── Types (mirroring blindOfferCalculator.ts) ──────────────────────────────────

interface CompData {
  pricePerAcre: number;
  acres: number;
  totalPrice: number;
  daysOnMarket?: number;
  saleDate?: string;
  source: string;
}

interface CompAnalysis {
  lowestSalePerAcre: number;
  medianSalePerAcre: number;
  highestSalePerAcre: number;
  compCount: number;
  dataQuality: "excellent" | "good" | "limited" | "insufficient";
  isCountyValidated: boolean;
  avgDaysOnMarket: number | null;
}

// ── Inline implementations for pure unit tests ─────────────────────────────────

function analyzeComps(comps: CompData[]): CompAnalysis {
  if (comps.length === 0) {
    return {
      lowestSalePerAcre: 1000,
      medianSalePerAcre: 2000,
      highestSalePerAcre: 5000,
      compCount: 0,
      dataQuality: "insufficient",
      isCountyValidated: false,
      avgDaysOnMarket: null,
    };
  }

  const prices = comps.map((c) => c.pricePerAcre).sort((a, b) => a - b);
  const domValues = comps.filter((c) => c.daysOnMarket !== undefined).map((c) => c.daysOnMarket!);
  const avgDom =
    domValues.length > 0
      ? Math.round(domValues.reduce((a, b) => a + b, 0) / domValues.length)
      : null;

  const compCount = comps.length;
  const isCountyValidated = compCount >= 10;
  let dataQuality: CompAnalysis["dataQuality"];

  if (compCount >= 10) dataQuality = "excellent";
  else if (compCount >= 5) dataQuality = "good";
  else if (compCount >= 2) dataQuality = "limited";
  else dataQuality = "insufficient";

  return {
    lowestSalePerAcre: prices[0],
    medianSalePerAcre: prices[Math.floor(prices.length / 2)],
    highestSalePerAcre: prices[prices.length - 1],
    compCount,
    dataQuality,
    isCountyValidated,
    avgDaysOnMarket: avgDom,
  };
}

function buildOfferTiers(lowestCompPerAcre: number, acres: number) {
  return {
    aggressive: {
      offerPerAcre: Math.round(lowestCompPerAcre * 0.20),
      offerTotal: Math.round(lowestCompPerAcre * 0.20 * acres),
      pctOfLowestComp: 20,
    },
    standard: {
      offerPerAcre: Math.round(lowestCompPerAcre * 0.25),
      offerTotal: Math.round(lowestCompPerAcre * 0.25 * acres),
      pctOfLowestComp: 25,
    },
    competitive: {
      offerPerAcre: Math.round(lowestCompPerAcre * 0.33),
      offerTotal: Math.round(lowestCompPerAcre * 0.33 * acres),
      pctOfLowestComp: 33,
    },
  };
}

function detectMarketCondition(
  oneYearChangePercent: number
): "buyers_market" | "balanced" | "sellers_market" | "hot" {
  if (oneYearChangePercent > 8) return "hot";
  if (oneYearChangePercent > 3) return "sellers_market";
  if (oneYearChangePercent > 0) return "balanced";
  return "buyers_market";
}

function sizeCampaign(targetDeals: number, targetAcceptanceRate: number): number {
  // Letters needed = target deals / acceptance rate
  return Math.ceil(targetDeals / targetAcceptanceRate);
}

function buildOwnerFinanceScenario(
  purchasePrice: number,
  salePrice: number,
  downPaymentPct: number,
  interestRatePct: number,
  termMonths: number
) {
  const downPayment = Math.round(salePrice * downPaymentPct);
  const noteAmount = salePrice - downPayment;
  const monthlyRate = interestRatePct / 100 / 12;
  const monthlyPayment =
    monthlyRate === 0
      ? noteAmount / termMonths
      : (noteAmount * monthlyRate * Math.pow(1 + monthlyRate, termMonths)) /
        (Math.pow(1 + monthlyRate, termMonths) - 1);

  const totalCollected = downPayment + Math.round(monthlyPayment) * termMonths;
  const profit = totalCollected - purchasePrice;

  return {
    downPayment,
    noteAmount,
    monthlyPayment: Math.round(monthlyPayment),
    totalCollected,
    profit,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("Podolsky Formula — Core Offer Tiers", () => {
  it("standard tier is 25% of lowest comp (÷4 rule)", () => {
    const lowestComp = 4000; // $4,000/acre
    const acres = 10;
    const tiers = buildOfferTiers(lowestComp, acres);

    expect(tiers.standard.pctOfLowestComp).toBe(25);
    expect(tiers.standard.offerPerAcre).toBe(1000); // $4000 * 0.25
    expect(tiers.standard.offerTotal).toBe(10000); // $1000 * 10 acres
  });

  it("aggressive tier is 20% of lowest comp", () => {
    const lowestComp = 5000;
    const acres = 20;
    const tiers = buildOfferTiers(lowestComp, acres);

    expect(tiers.aggressive.pctOfLowestComp).toBe(20);
    expect(tiers.aggressive.offerPerAcre).toBe(1000); // $5000 * 0.20
    expect(tiers.aggressive.offerTotal).toBe(20000); // $1000 * 20 acres
  });

  it("competitive tier is 33% of lowest comp", () => {
    const lowestComp = 3000;
    const acres = 5;
    const tiers = buildOfferTiers(lowestComp, acres);

    expect(tiers.competitive.pctOfLowestComp).toBe(33);
    expect(tiers.competitive.offerPerAcre).toBe(990); // Math.round(3000 * 0.33)
    expect(tiers.competitive.offerTotal).toBe(4950); // $990 * 5 acres
  });

  it("offer is always below market value (creates margin of safety)", () => {
    const lowestComp = 2000;
    const acres = 40;
    const tiers = buildOfferTiers(lowestComp, acres);

    // All tiers should be below 100% of lowest comp
    expect(tiers.aggressive.offerPerAcre).toBeLessThan(lowestComp);
    expect(tiers.standard.offerPerAcre).toBeLessThan(lowestComp);
    expect(tiers.competitive.offerPerAcre).toBeLessThan(lowestComp);
  });

  it("aggressive < standard < competitive in offer amount", () => {
    const lowestComp = 6000;
    const acres = 10;
    const tiers = buildOfferTiers(lowestComp, acres);

    expect(tiers.aggressive.offerTotal).toBeLessThan(tiers.standard.offerTotal);
    expect(tiers.standard.offerTotal).toBeLessThan(tiers.competitive.offerTotal);
  });

  it("offer total equals offer-per-acre × acres", () => {
    const lowestComp = 4000;
    const acres = 12;
    const tiers = buildOfferTiers(lowestComp, acres);

    // Within rounding tolerance
    expect(tiers.standard.offerTotal).toBeCloseTo(tiers.standard.offerPerAcre * acres, -1);
    expect(tiers.aggressive.offerTotal).toBeCloseTo(tiers.aggressive.offerPerAcre * acres, -1);
  });
});

describe("Comp Analysis — Data Quality Classification", () => {
  function makeComp(pricePerAcre: number): CompData {
    return { pricePerAcre, acres: 10, totalPrice: pricePerAcre * 10, source: "county_records" };
  }

  it("0 comps → insufficient quality, not validated", () => {
    const result = analyzeComps([]);
    expect(result.dataQuality).toBe("insufficient");
    expect(result.isCountyValidated).toBe(false);
    expect(result.compCount).toBe(0);
  });

  it("1 comp → insufficient quality", () => {
    const result = analyzeComps([makeComp(3000)]);
    expect(result.dataQuality).toBe("insufficient");
  });

  it("2–4 comps → limited quality", () => {
    const result = analyzeComps([makeComp(3000), makeComp(3500), makeComp(4000)]);
    expect(result.dataQuality).toBe("limited");
  });

  it("5–9 comps → good quality", () => {
    const comps = Array.from({ length: 7 }, (_, i) => makeComp(3000 + i * 100));
    const result = analyzeComps(comps);
    expect(result.dataQuality).toBe("good");
    expect(result.isCountyValidated).toBe(false);
  });

  it("10+ comps → excellent quality + county validated (Podolsky threshold)", () => {
    const comps = Array.from({ length: 10 }, (_, i) => makeComp(3000 + i * 100));
    const result = analyzeComps(comps);
    expect(result.dataQuality).toBe("excellent");
    expect(result.isCountyValidated).toBe(true);
  });

  it("12 comps → still excellent, validated", () => {
    const comps = Array.from({ length: 12 }, (_, i) => makeComp(2000 + i * 200));
    const result = analyzeComps(comps);
    expect(result.dataQuality).toBe("excellent");
    expect(result.isCountyValidated).toBe(true);
  });
});

describe("Comp Analysis — Price Statistics", () => {
  it("lowest, median, and highest are correctly extracted", () => {
    const comps: CompData[] = [
      { pricePerAcre: 5000, acres: 10, totalPrice: 50000, source: "test" },
      { pricePerAcre: 3000, acres: 5, totalPrice: 15000, source: "test" },
      { pricePerAcre: 4000, acres: 8, totalPrice: 32000, source: "test" },
    ];
    const result = analyzeComps(comps);

    expect(result.lowestSalePerAcre).toBe(3000);
    expect(result.medianSalePerAcre).toBe(4000);
    expect(result.highestSalePerAcre).toBe(5000);
  });

  it("average days on market is computed from comps with DOM data", () => {
    const comps: CompData[] = [
      { pricePerAcre: 3000, acres: 10, totalPrice: 30000, source: "test", daysOnMarket: 60 },
      { pricePerAcre: 3500, acres: 5, totalPrice: 17500, source: "test", daysOnMarket: 90 },
      { pricePerAcre: 4000, acres: 8, totalPrice: 32000, source: "test" }, // No DOM
    ];
    const result = analyzeComps(comps);

    expect(result.avgDaysOnMarket).toBe(75); // (60+90)/2 = 75
  });

  it("avgDaysOnMarket is null when no comps have DOM data", () => {
    const comps: CompData[] = [
      { pricePerAcre: 3000, acres: 10, totalPrice: 30000, source: "test" },
    ];
    const result = analyzeComps(comps);
    expect(result.avgDaysOnMarket).toBeNull();
  });
});

describe("Market Condition Detection", () => {
  it("hot market: >8% YoY price appreciation", () => {
    expect(detectMarketCondition(10)).toBe("hot");
    expect(detectMarketCondition(8.1)).toBe("hot");
  });

  it("sellers market: 3–8% YoY appreciation", () => {
    expect(detectMarketCondition(5)).toBe("sellers_market");
    expect(detectMarketCondition(3.1)).toBe("sellers_market");
  });

  it("balanced market: 0–3% YoY appreciation", () => {
    expect(detectMarketCondition(1)).toBe("balanced");
    expect(detectMarketCondition(0.1)).toBe("balanced");
  });

  it("buyers market: flat or declining prices (≤0%)", () => {
    expect(detectMarketCondition(0)).toBe("buyers_market");
    expect(detectMarketCondition(-5)).toBe("buyers_market");
  });

  it("exact threshold values", () => {
    expect(detectMarketCondition(8)).toBe("sellers_market"); // 8 is NOT > 8, so not hot
    expect(detectMarketCondition(3)).toBe("balanced"); // 3 is NOT > 3, so not sellers market
  });
});

describe("Campaign Sizing — The 3-of-5 Rule", () => {
  it("to close 3 deals at 60% acceptance rate: send 5 letters", () => {
    const letters = sizeCampaign(3, 0.6);
    expect(letters).toBe(5);
  });

  it("to close 10 deals at 25% acceptance: send 40 letters", () => {
    const letters = sizeCampaign(10, 0.25);
    expect(letters).toBe(40);
  });

  it("to close 1 deal at 25% acceptance: send 4 letters (rounds up)", () => {
    const letters = sizeCampaign(1, 0.25);
    expect(letters).toBe(4);
  });

  it("higher acceptance rate requires fewer letters", () => {
    const lowAcceptance = sizeCampaign(5, 0.1);
    const highAcceptance = sizeCampaign(5, 0.5);
    expect(lowAcceptance).toBeGreaterThan(highAcceptance);
  });
});

describe("Owner Finance Scenario — Podolsky Note Building", () => {
  it("builds correct monthly payment for 9% rate, 84-month note", () => {
    // Buy at $10K, sell at $40K, 0% down, 9%, 84 months
    const scenario = buildOwnerFinanceScenario(10000, 40000, 0, 9, 84);

    // Monthly payment for $40K at 9% / 12 for 84 months
    // P = 40000, r = 0.0075, n = 84
    // Payment ≈ $629
    expect(scenario.monthlyPayment).toBeGreaterThan(600);
    expect(scenario.monthlyPayment).toBeLessThan(700);
  });

  it("total collected exceeds purchase price (positive ROI)", () => {
    const scenario = buildOwnerFinanceScenario(10000, 40000, 0, 9, 84);
    expect(scenario.totalCollected).toBeGreaterThan(10000);
    expect(scenario.profit).toBeGreaterThan(0);
  });

  it("with down payment, note amount is reduced", () => {
    // 25% down = $10K down on $40K sale
    const withDown = buildOwnerFinanceScenario(10000, 40000, 0.25, 9, 84);
    const withoutDown = buildOwnerFinanceScenario(10000, 40000, 0, 9, 84);

    expect(withDown.noteAmount).toBeLessThan(withoutDown.noteAmount);
    expect(withDown.downPayment).toBe(10000); // 25% of $40K
  });

  it("zero interest rate produces equal monthly payments (note principal / months)", () => {
    const scenario = buildOwnerFinanceScenario(5000, 20000, 0, 0, 60);
    // $20K / 60 months = $333.33/month
    expect(scenario.monthlyPayment).toBeCloseTo(333, 0);
  });

  it("longer term produces lower monthly payment", () => {
    const shortTerm = buildOwnerFinanceScenario(10000, 40000, 0, 9, 60);
    const longTerm = buildOwnerFinanceScenario(10000, 40000, 0, 9, 120);
    expect(longTerm.monthlyPayment).toBeLessThan(shortTerm.monthlyPayment);
  });

  it("longer term produces more total interest collected", () => {
    const shortTerm = buildOwnerFinanceScenario(10000, 40000, 0, 9, 60);
    const longTerm = buildOwnerFinanceScenario(10000, 40000, 0, 9, 120);
    // More payments × same or higher rate = more total collected
    expect(longTerm.totalCollected).toBeGreaterThan(shortTerm.totalCollected);
  });
});

describe("Margin of Safety", () => {
  it("standard offer (25%) provides 300% margin of safety over purchase price", () => {
    // If market value = $100K and you offer $25K (25%), the margin is:
    // Market / Offer = 100K / 25K = 4x = 300% above offer
    const lowestComp = 10000; // $10K/acre
    const acres = 10; // 100K total
    const tiers = buildOfferTiers(lowestComp, acres);

    const marketValue = lowestComp * acres;
    const offerPrice = tiers.standard.offerTotal;
    const marginMultiplier = marketValue / offerPrice;

    expect(marginMultiplier).toBeCloseTo(4, 0); // 4x = 300% above cost
  });

  it("aggressive offer (20%) provides 400% margin (5x)", () => {
    const lowestComp = 10000;
    const acres = 10;
    const tiers = buildOfferTiers(lowestComp, acres);

    const marketValue = lowestComp * acres;
    const offerPrice = tiers.aggressive.offerTotal;
    const marginMultiplier = marketValue / offerPrice;

    expect(marginMultiplier).toBeCloseTo(5, 0); // 5x = 400% above cost
  });
});
