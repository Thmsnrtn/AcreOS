/**
 * Unit Tests: Blind Offer Calculator
 * Core business logic for the land investing acquisition strategy.
 *
 * Tests the blind offer methodology:
 * - The 25% formula (lowest comp ÷ 4)
 * - Offer tier calculations (20%, 25%, 33% of lowest comp)
 * - Comp data quality classification — against the REAL `analyzeComps`
 * - Only sales are comps: USDA / estimated benchmarks never enter the set,
 *   and the zero-comp refusal is reachable (DEFECT-0107)
 * - Market condition — driven through the REAL calculator; a synthetic
 *   (estimate) trend cannot move it
 * - No acceptance rate is promised anywhere in the report
 * - Campaign sizing arithmetic and owner finance note math (spec copies)
 *
 * The comp analysis used to be an INLINE COPY here, returning 1000 / 2000 /
 * 5000 for an empty set — the fabricated branch it was meant to catch. It now
 * imports the implementation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Scripted USDA double — the calculator's only external input.
const USDA = vi.hoisted(() => ({
  snapshot: null as Record<string, unknown> | null,
  trend: null as Record<string, unknown> | null,
}));
vi.mock("../../server/services/usdaNassService", () => ({
  getCachedCountySnapshot: async () => USDA.snapshot,
  getCachedLandTrend: async () => USDA.trend,
}));
vi.mock("../../server/utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import {
  analyzeComps,
  calculateBlindOffer,
  type CompData,
} from "../../server/services/blindOfferCalculator";

beforeEach(() => {
  USDA.snapshot = null;
  USDA.trend = null;
});

/** The trend the USDA service builds from its synthetic state default. */
function trendOf(source: "usda_nass" | "estimate", oneYearChangePercent: number) {
  return {
    county: "Bandera",
    state: "TX",
    years: [
      { year: 2021, valuePerAcre: 1975 },
      { year: 2022, valuePerAcre: 2073 },
      { year: 2023, valuePerAcre: 2177 },
      { year: 2024, valuePerAcre: 2286 },
      { year: 2025, valuePerAcre: 2400 },
    ],
    currentValuePerAcre: 2400,
    oneYearChangePercent,
    threeYearChangePercent: 10,
    fiveYearChangePercent: 21.5,
    trend: "steady_growth",
    cagr5Year: 5,
    source,
  };
}

const SALES: CompData[] = [
  { pricePerAcre: 1200, acres: 10, totalPrice: 12000, source: "county_records" },
  { pricePerAcre: 1400, acres: 12, totalPrice: 16800, source: "county_records" },
  { pricePerAcre: 1100, acres: 8, totalPrice: 8800, source: "user_entered" },
];

// ── Spec copies (pure arithmetic, no production twin to import) ────────────────

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

describe("Blind Offer Formula — Core Offer Tiers", () => {
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

  it("0 comps → insufficient quality, not validated, and NO price (null, never a placeholder)", () => {
    const result = analyzeComps([]);
    expect(result.dataQuality).toBe("insufficient");
    expect(result.isCountyValidated).toBe(false);
    expect(result.compCount).toBe(0);
    expect(result.lowestSalePerAcre).toBeNull();
    expect(result.medianSalePerAcre).toBeNull();
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

  it("10+ comps → excellent quality + county validated (validation threshold)", () => {
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

describe("Market condition — only a MEASURED trend can move it (DEFECT-0107)", () => {
  async function conditionFor(trend: Record<string, unknown> | null) {
    USDA.trend = trend;
    const out = await calculateBlindOffer({ state: "TX", county: "Bandera", targetAcres: 10, comps: SALES });
    return out.marketContext.marketCondition;
  }

  it("a measured NASS trend applies the thresholds (> 8% hot, > 3% sellers, > 0% balanced, else buyers)", async () => {
    expect(await conditionFor(trendOf("usda_nass", 10))).toBe("hot");
    expect(await conditionFor(trendOf("usda_nass", 8))).toBe("sellers_market");
    expect(await conditionFor(trendOf("usda_nass", 3))).toBe("balanced");
    expect(await conditionFor(trendOf("usda_nass", 0))).toBe("buyers_market");
  });

  it("the synthetic estimate trend cannot declare a hot market — it is balanced", async () => {
    expect(await conditionFor(trendOf("estimate", 10))).toBe("balanced");
  });

  it("a trend with no provenance (cached before it existed) is treated as unmeasured", async () => {
    const { source: _drop, ...legacy } = trendOf("usda_nass", 10);
    expect(await conditionFor(legacy)).toBe("balanced");
  });

  it("no trend at all → balanced", async () => {
    expect(await conditionFor(null)).toBe("balanced");
  });
});

describe("Only sales are comps (DEFECT-0107)", () => {
  it("a USDA benchmark passed as a comp is not counted", () => {
    const result = analyzeComps([
      { pricePerAcre: 3400, acres: 1, totalPrice: 3400, source: "usda_nass" },
      { pricePerAcre: 2400, acres: 1, totalPrice: 2400, source: "estimate" },
    ]);
    expect(result.compCount).toBe(0);
    expect(result.lowestSalePerAcre).toBeNull();
    expect(result.dataQualityNotes.join(" ")).toMatch(/2 row\(s\) excluded/);
  });

  it("a row with no positive price per acre is not a sale", () => {
    const result = analyzeComps([
      { pricePerAcre: 0, acres: 5, totalPrice: 0, source: "county_records" },
      { pricePerAcre: Number.NaN, acres: 5, totalPrice: 0, source: "county_records" },
      { pricePerAcre: 1500, acres: 5, totalPrice: 7500, source: "county_records" },
    ]);
    expect(result.compCount).toBe(1);
    expect(result.lowestSalePerAcre).toBe(1500);
  });

  it("no sales + a measured USDA pasture value + an estimate trend → REFUSED, with no offer fields", async () => {
    USDA.snapshot = { pasturePerAcre: 3400, pastureSource: "usda_nass", year: 2025 };
    USDA.trend = trendOf("estimate", 5);
    const out = await calculateBlindOffer({ state: "TX", county: "Bandera", targetAcres: 10 });
    expect(out.status).toBe("insufficient_data");
    expect(out).not.toHaveProperty("offerTiers");
    expect(out).not.toHaveProperty("letterVariables");
    if (out.status === "insufficient_data") {
      // No substitute is offered: USDA is not a price.
      expect(out.missing.join(" ")).not.toMatch(/USDA NASS land values/);
    }
    // The benchmark is still shown, with its provenance.
    expect(out.marketContext.usdaLandValuePerAcre).toBe(3400);
    expect(out.marketContext.benchmarks.trend.source).toBe("estimate");
    expect(out.marketContext.usdaCagr5Year).toBeNull();
  });

  it("with real sales the offer is priced from the LOWEST SALE, never the USDA value", async () => {
    USDA.snapshot = { pasturePerAcre: 500, pastureSource: "usda_nass", year: 2025 };
    const out = await calculateBlindOffer({ state: "TX", county: "Bandera", targetAcres: 10, comps: SALES });
    expect(out.status).toBe("ok");
    if (out.status === "ok") {
      expect(out.lowestCompPerAcre).toBe(1100);
      expect(out.offerTiers.standard.offerTotal).toBe(Math.round(1100 * 0.25 * 10));
      expect(out.compAnalysis.compCount).toBe(3);
    }
  });
});

describe("No acceptance rate is promised (DEFECT-0107)", () => {
  it("every tier's acceptanceRateForecast is null, and no 'N of/in M' rate appears anywhere in the report", async () => {
    USDA.trend = trendOf("usda_nass", 2);
    const out = await calculateBlindOffer({ state: "TX", county: "Bandera", targetAcres: 10, comps: SALES });
    expect(out.status).toBe("ok");
    if (out.status !== "ok") return;
    for (const tier of Object.values(out.offerTiers)) {
      expect(tier.acceptanceRateForecast).toBeNull();
    }
    expect(JSON.stringify(out)).not.toMatch(/\b\d\s*(?:of|in|out of)\s*\d\b/);
  });
});

describe("Campaign sizing arithmetic — the rate is an input, never a promise", () => {
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

describe("Owner Finance Scenario — Note Building", () => {
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
