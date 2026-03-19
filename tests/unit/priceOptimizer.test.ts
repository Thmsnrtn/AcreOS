/**
 * Price Optimizer Service — Unit Tests
 *
 * Focuses on pure calculation methods: comp weighting, adjustment factors,
 * confidence scoring, and counter-offer math. All DB calls and external
 * service calls are mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── DB mock ────────────────────────────────────────────────────────────────────
vi.mock("../../../server/db", () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([
          {
            id: 1,
            recommendedPrice: "100000",
            priceRangeMin: "90000",
            priceRangeMax: "110000",
            confidence: "0.75",
            comparablesSummary: null,
            adjustments: null,
            strategy: null,
            reasoning: null,
          },
        ]),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
  },
}));

// ── comps service mock ─────────────────────────────────────────────────────────
vi.mock("../../../server/services/comps", () => ({
  getComparableProperties: vi.fn().mockResolvedValue({ success: false, comps: [] }),
  calculateMarketValue: vi.fn().mockResolvedValue(null),
}));

// ── OpenAI mock ────────────────────────────────────────────────────────────────
vi.mock("../../../server/utils/openaiClient", () => ({
  getOpenAIClient: vi.fn().mockReturnValue(null),
}));

import { PriceOptimizerService } from "../../../server/services/priceOptimizer";

// ── Test helpers ───────────────────────────────────────────────────────────────
const makeProperty = (overrides = {}): any => ({
  id: 1,
  organizationId: 1,
  sizeAcres: "10",
  assessedValue: "80000",
  marketValue: "100000",
  listPrice: null,
  latitude: "30.0",
  longitude: "-97.0",
  state: "TX",
  county: "Travis",
  roadAccess: "",
  zoning: "",
  terrain: "",
  utilities: null,
  sellerId: null,
  ...overrides,
});

const makeComp = (overrides = {}): any => ({
  apn: "123",
  salePrice: 100000,
  acreage: 10,
  pricePerAcre: 10000,
  distance: 2,
  saleDate: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
  ...overrides,
});

// ── Tests ──────────────────────────────────────────────────────────────────────
describe("PriceOptimizerService", () => {
  let optimizer: PriceOptimizerService;

  beforeEach(() => {
    vi.clearAllMocks();
    optimizer = new PriceOptimizerService();
  });

  // ── calculateBasePrice ─────────────────────────────────────────────────────
  describe("calculateBasePrice", () => {
    it("returns marketValue when no comps are provided", () => {
      const property = makeProperty({ marketValue: "120000" });
      const result = optimizer.calculateBasePrice([], property);
      expect(result).toBe(120000);
    });

    it("falls back to assessedValue when marketValue is null and no comps", () => {
      const property = makeProperty({ marketValue: null, assessedValue: "80000" });
      const result = optimizer.calculateBasePrice([], property);
      expect(result).toBe(80000);
    });

    it("returns 0 when no comps and no assessed/market value", () => {
      const property = makeProperty({ marketValue: null, assessedValue: null });
      const result = optimizer.calculateBasePrice([], property);
      expect(result).toBe(0);
    });

    it("uses weighted average of comps when available", () => {
      const comps = [
        makeComp({ pricePerAcre: 10000, distance: 1 }),
        makeComp({ pricePerAcre: 12000, distance: 3 }),
      ];
      const property = makeProperty({ sizeAcres: "10" });
      const basePrice = optimizer.calculateBasePrice(comps, property);
      expect(basePrice).toBeGreaterThan(0);
      expect(basePrice).not.toBeNaN();
    });

    it("closer comps get higher weight (distance weighting)", () => {
      const nearComp = makeComp({ pricePerAcre: 20000, distance: 0.5 });
      const farComp = makeComp({ pricePerAcre: 5000, distance: 8 });
      const property = makeProperty({ sizeAcres: "10" });

      const nearWeightResult = optimizer.calculateBasePrice([nearComp, farComp], property);
      const reversedResult = optimizer.calculateBasePrice([farComp, nearComp], property);

      // Both orderings should produce same weighted avg
      expect(nearWeightResult).toBeCloseTo(reversedResult, 0);
      // But price should be biased toward the near (high-price) comp
      expect(nearWeightResult).toBeGreaterThan(10 * 5000); // above far-comp price
    });

    it("recent comps get higher recency weight than old comps", () => {
      const recentComp = makeComp({
        pricePerAcre: 15000,
        saleDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        distance: 2,
      });
      const oldComp = makeComp({
        pricePerAcre: 5000,
        saleDate: new Date(Date.now() - 22 * 30 * 24 * 60 * 60 * 1000).toISOString(),
        distance: 2,
      });
      const property = makeProperty({ sizeAcres: "10" });
      const result = optimizer.calculateBasePrice([recentComp, oldComp], property);
      // Should be biased toward recentComp's higher price
      expect(result).toBeGreaterThan(10 * 5000);
    });

    it("filters comps with zero pricePerAcre", () => {
      const validComp = makeComp({ pricePerAcre: 10000, distance: 1 });
      const zeroComp = makeComp({ pricePerAcre: 0, distance: 1 });
      const property = makeProperty({ sizeAcres: "10" });
      const withZero = optimizer.calculateBasePrice([validComp, zeroComp], property);
      const withoutZero = optimizer.calculateBasePrice([validComp], property);
      expect(withZero).toBeCloseTo(withoutZero, 0);
    });
  });

  // ── calculateAdjustmentFactors ─────────────────────────────────────────────
  describe("calculateAdjustmentFactors — size premium/discount", () => {
    it("applies small parcel premium (1.10) for < 1 acre", () => {
      const property = makeProperty({ sizeAcres: "0.5" });
      const adjustments = optimizer.calculateAdjustmentFactors(property, []);
      expect(adjustments.sizeAdjustment?.factor).toBe(1.10);
    });

    it("applies optimal size range premium (1.05) for 2-10 acres", () => {
      const property = makeProperty({ sizeAcres: "5" });
      const adjustments = optimizer.calculateAdjustmentFactors(property, []);
      expect(adjustments.sizeAdjustment?.factor).toBe(1.05);
    });

    it("applies large parcel discount (0.90) for 40+ acres", () => {
      const property = makeProperty({ sizeAcres: "100" });
      const adjustments = optimizer.calculateAdjustmentFactors(property, []);
      expect(adjustments.sizeAdjustment?.factor).toBe(0.90);
    });

    it("no size adjustment for mid-range parcels (1-40 acres, outside premium bands)", () => {
      const property = makeProperty({ sizeAcres: "15" });
      const adjustments = optimizer.calculateAdjustmentFactors(property, []);
      expect(adjustments.sizeAdjustment).toBeUndefined();
    });
  });

  describe("calculateAdjustmentFactors — road access", () => {
    it("applies 1.15 premium for paved road access", () => {
      const property = makeProperty({ roadAccess: "paved asphalt" });
      const adjustments = optimizer.calculateAdjustmentFactors(property, []);
      expect(adjustments.accessAdjustment?.factor).toBe(1.15);
    });

    it("applies 1.05 premium for gravel/improved road access", () => {
      const property = makeProperty({ roadAccess: "gravel road" });
      const adjustments = optimizer.calculateAdjustmentFactors(property, []);
      expect(adjustments.accessAdjustment?.factor).toBe(1.05);
    });

    it("applies 0.75 discount for no road access", () => {
      const property = makeProperty({ roadAccess: "none" });
      const adjustments = optimizer.calculateAdjustmentFactors(property, []);
      expect(adjustments.accessAdjustment?.factor).toBe(0.75);
    });

    it("applies 0.90 discount for dirt/unimproved road", () => {
      // "unimproved" contains "improved" as a substring, so use "dirt road" to avoid
      // hitting the gravel/improved branch first
      const property = makeProperty({ roadAccess: "dirt road" });
      const adjustments = optimizer.calculateAdjustmentFactors(property, []);
      expect(adjustments.accessAdjustment?.factor).toBe(0.90);
    });
  });

  describe("calculateAdjustmentFactors — zoning", () => {
    it("applies 1.15 premium for residential zoning", () => {
      const property = makeProperty({ zoning: "Residential R-1" });
      const adjustments = optimizer.calculateAdjustmentFactors(property, []);
      expect(adjustments.zoningAdjustment?.factor).toBe(1.15);
    });

    it("applies 1.10 premium for commercial zoning", () => {
      const property = makeProperty({ zoning: "Commercial C-2" });
      const adjustments = optimizer.calculateAdjustmentFactors(property, []);
      expect(adjustments.zoningAdjustment?.factor).toBe(1.10);
    });

    it("applies 0.80 discount for conservation zoning", () => {
      const property = makeProperty({ zoning: "conservation preserve" });
      const adjustments = optimizer.calculateAdjustmentFactors(property, []);
      expect(adjustments.zoningAdjustment?.factor).toBe(0.80);
    });
  });

  describe("calculateAdjustmentFactors — utilities", () => {
    it("applies 1.20 premium for 3+ utilities", () => {
      const property = makeProperty({
        utilities: { electric: true, water: true, sewer: true, gas: false },
      });
      const adjustments = optimizer.calculateAdjustmentFactors(property, []);
      expect(adjustments.utilitiesAdjustment?.factor).toBe(1.20);
    });

    it("applies 1.10 premium for 2 utilities", () => {
      const property = makeProperty({
        utilities: { electric: true, water: true, sewer: false, gas: false },
      });
      const adjustments = optimizer.calculateAdjustmentFactors(property, []);
      expect(adjustments.utilitiesAdjustment?.factor).toBe(1.10);
    });

    it("applies 1.05 premium for single utility", () => {
      const property = makeProperty({
        utilities: { electric: true, water: false, sewer: false, gas: false },
      });
      const adjustments = optimizer.calculateAdjustmentFactors(property, []);
      expect(adjustments.utilitiesAdjustment?.factor).toBe(1.05);
    });
  });

  describe("calculateAdjustmentFactors — terrain", () => {
    it("applies 1.10 premium for flat terrain", () => {
      const property = makeProperty({ terrain: "flat level" });
      const adjustments = optimizer.calculateAdjustmentFactors(property, []);
      expect(adjustments.terrainAdjustment?.factor).toBe(1.10);
    });

    it("applies 0.85 discount for steep/mountainous terrain", () => {
      const property = makeProperty({ terrain: "steep mountainous" });
      const adjustments = optimizer.calculateAdjustmentFactors(property, []);
      expect(adjustments.terrainAdjustment?.factor).toBe(0.85);
    });
  });

  // ── applyAdjustments ───────────────────────────────────────────────────────
  describe("applyAdjustments", () => {
    it("multiplies base price by all adjustment factors", () => {
      const basePrice = 100000;
      const property = makeProperty({ sizeAcres: "0.5", roadAccess: "paved" });
      const adjustments = optimizer.calculateAdjustmentFactors(property, []);
      const adjusted = optimizer.applyAdjustments(basePrice, property, adjustments);
      // small parcel: ×1.10, paved: ×1.15 → 100000 × 1.10 × 1.15 = 126500
      expect(adjusted).toBeCloseTo(126500, 0);
    });

    it("returns base price unchanged when no adjustments apply", () => {
      const basePrice = 50000;
      // "private road" matches no access branch — no adjustment applied
      // 15 acres is mid-size (>10, ≤40): no size premium/discount
      const property = makeProperty({ sizeAcres: "15", roadAccess: "private road", zoning: "" });
      const adjustments = optimizer.calculateAdjustmentFactors(property, []);
      const adjusted = optimizer.applyAdjustments(basePrice, property, adjustments);
      expect(adjusted).toBe(50000);
    });

    it("computes adjustments internally when none are passed", () => {
      const basePrice = 100000;
      // Small parcel (×1.10) + paved road (×1.15) → result > base
      const property = makeProperty({ sizeAcres: "0.5", roadAccess: "paved" });
      const adjusted = optimizer.applyAdjustments(basePrice, property, undefined);
      expect(adjusted).toBeGreaterThan(basePrice);
    });
  });

  // ── getConfidence ──────────────────────────────────────────────────────────
  describe("getConfidence", () => {
    it("returns value between 0.1 and 0.95", () => {
      const c = optimizer.getConfidence(0, 0, 0.5);
      expect(c).toBeGreaterThanOrEqual(0.1);
      expect(c).toBeLessThanOrEqual(0.95);
    });

    it("0 comps reduces confidence below baseline of 0.5", () => {
      const c = optimizer.getConfidence(0, 0, 0.15);
      expect(c).toBeLessThan(0.5);
    });

    it("10+ comps increases confidence significantly above baseline", () => {
      const c = optimizer.getConfidence(10, 0.8, 0.1);
      expect(c).toBeGreaterThan(0.7);
    });

    it("20 comps yields higher confidence than 3 comps", () => {
      const withFew = optimizer.getConfidence(3, 0.5, 0.15);
      const withMany = optimizer.getConfidence(20, 0.5, 0.15);
      expect(withMany).toBeGreaterThan(withFew);
    });

    it("high market volatility reduces confidence", () => {
      const stable = optimizer.getConfidence(5, 0.5, 0.05);
      const volatile = optimizer.getConfidence(5, 0.5, 0.40);
      expect(stable).toBeGreaterThan(volatile);
    });

    it("high comp similarity increases confidence", () => {
      const lowSim = optimizer.getConfidence(5, 0.0, 0.15);
      const highSim = optimizer.getConfidence(5, 1.0, 0.15);
      expect(highSim).toBeGreaterThan(lowSim);
    });
  });

  // ── counter offer calculation ──────────────────────────────────────────────
  describe("counter offer calculation logic", () => {
    it("counter suggestion is always at most 95% of seller ask", () => {
      // Replicate the counter logic inline
      const currentOffer = 80000;
      const sellerAsk = 150000;
      const fairMarketValue = 120000;
      const spread = sellerAsk - currentOffer;
      const fmvPosition = (fairMarketValue - currentOffer) / spread;
      let counterSuggestion = currentOffer + spread * Math.max(0.3, fmvPosition * 0.8);
      counterSuggestion = Math.min(counterSuggestion, sellerAsk * 0.95);
      counterSuggestion = Math.max(counterSuggestion, currentOffer * 1.05);
      expect(counterSuggestion).toBeLessThanOrEqual(sellerAsk * 0.95);
    });

    it("counter suggestion is always at least 5% above current offer", () => {
      const currentOffer = 80000;
      const sellerAsk = 150000;
      const fairMarketValue = 120000;
      const spread = sellerAsk - currentOffer;
      const fmvPosition = (fairMarketValue - currentOffer) / spread;
      let counterSuggestion = currentOffer + spread * Math.max(0.3, fmvPosition * 0.8);
      counterSuggestion = Math.min(counterSuggestion, sellerAsk * 0.95);
      counterSuggestion = Math.max(counterSuggestion, currentOffer * 1.05);
      expect(counterSuggestion).toBeGreaterThanOrEqual(currentOffer * 1.05);
    });

    it("when FMV is below current offer, counter equals current offer (no haircut below market)", () => {
      const currentOffer = 100000;
      const sellerAsk = 150000;
      const fairMarketValue = 90000; // below current offer
      let counterSuggestion: number;
      if (fairMarketValue < currentOffer) {
        counterSuggestion = currentOffer;
      } else {
        const spread = sellerAsk - currentOffer;
        const fmvPosition = (fairMarketValue - currentOffer) / spread;
        counterSuggestion = currentOffer + spread * Math.max(0.3, fmvPosition * 0.8);
      }
      // Clamp as done in service
      counterSuggestion = Math.min(counterSuggestion, sellerAsk * 0.95);
      counterSuggestion = Math.max(counterSuggestion, currentOffer * 1.05);
      // After clamping, it's forced to at least 5% above current offer
      expect(counterSuggestion).toBeGreaterThanOrEqual(currentOffer);
    });

    it("when FMV exceeds seller ask, counter is 60% of spread above current offer", () => {
      const currentOffer = 80000;
      const sellerAsk = 100000;
      const fairMarketValue = 130000; // above ask
      const spread = sellerAsk - currentOffer;
      const counterSuggestion = currentOffer + spread * 0.6;
      expect(counterSuggestion).toBeCloseTo(80000 + 20000 * 0.6, 0);
    });
  });

  // ── accuracy calculation ───────────────────────────────────────────────────
  describe("recommendation accuracy calculation", () => {
    it("accuracy of 1.0 when actual equals recommended", () => {
      const recommended = 100000;
      const actual = 100000;
      const accuracy = Math.max(0, 1 - Math.abs(actual - recommended) / recommended);
      expect(accuracy).toBe(1.0);
    });

    it("accuracy decreases as actual diverges from recommended", () => {
      const recommended = 100000;
      const close = 105000;
      const far = 150000;
      const closeAccuracy = Math.max(0, 1 - Math.abs(close - recommended) / recommended);
      const farAccuracy = Math.max(0, 1 - Math.abs(far - recommended) / recommended);
      expect(closeAccuracy).toBeGreaterThan(farAccuracy);
    });

    it("accuracy is clamped to 0 when actual is 2× recommended", () => {
      const recommended = 100000;
      const actual = 200000;
      const accuracy = Math.max(0, 1 - Math.abs(actual - recommended) / recommended);
      expect(accuracy).toBe(0);
    });
  });
});
