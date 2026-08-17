/**
 * Buyer Matching AI Service — Unit Tests
 *
 * Tests all 6 match score factors and the composite score calculation.
 * Uses the public calculateMatchScore method which is already non-private
 * and calls the private sub-calculators.
 * All DB calls are mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── DB mock ────────────────────────────────────────────────────────────────────
vi.mock("../../server/db", () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 1 }]),
        onConflictDoUpdate: vi.fn().mockReturnValue({
          catch: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
  },
}));

// ── OpenAI mock ────────────────────────────────────────────────────────────────
vi.mock("../../server/utils/openaiClient", () => ({
  getOpenAIClient: vi.fn().mockReturnValue(null),
}));

import { BuyerMatchingAIService } from "../../server/services/buyerMatchingAI";

// ── Test helpers ───────────────────────────────────────────────────────────────
const makeProperty = (overrides = {}): any => ({
  id: 1,
  organizationId: 1,
  state: "TX",
  county: "Travis",
  sizeAcres: "10",
  listPrice: "100000",
  marketValue: "100000",
  zoning: "agricultural",
  roadAccess: "paved",
  terrain: "flat",
  utilities: { electric: true, water: true, sewer: false, gas: false },
  description: "Great land",
  ...overrides,
});

const makeBuyerProfile = (overrides = {}): any => ({
  id: 1,
  organizationId: 1,
  profileType: "individual",
  isActive: true,
  preferences: {
    states: ["TX"],
    counties: ["Travis"],
    minAcreage: 5,
    maxAcreage: 20,
    zoningTypes: ["agricultural"],
    useTypes: ["agricultural"],
    roadAccess: ["paved"],
    utilities: ["electric", "water"],
    terrainTypes: ["flat"],
    minPrice: 50000,
    maxPrice: 150000,
  },
  financialInfo: {
    budget: 150000,
    financingType: "cash",
    preApproved: false,
    preApprovalAmount: null,
    downPaymentCapacity: null,
    monthlyPaymentCapacity: null,
  },
  intent: {
    purchaseTimeline: "3-6 months",
    primaryUse: "agriculture",
  },
  ...overrides,
});

// ── Tests ──────────────────────────────────────────────────────────────────────
describe("BuyerMatchingAIService — calculateMatchScore", () => {
  let service: BuyerMatchingAIService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new BuyerMatchingAIService();
  });

  // ── Composite score ────────────────────────────────────────────────────────
  describe("composite score calculation", () => {
    it("perfect match across all factors produces high composite score", () => {
      const buyer = makeBuyerProfile();
      const property = makeProperty();
      const { score } = service.calculateMatchScore(buyer, property);
      expect(score).toBeGreaterThanOrEqual(80);
    });

    it("composite score is the weighted sum of all 6 factors", () => {
      const buyer = makeBuyerProfile();
      const property = makeProperty();
      const { score, factors } = service.calculateMatchScore(buyer, property);

      const expectedScore = Math.round(
        factors.priceMatch * 0.25 +
        factors.sizeMatch * 0.15 +
        factors.locationMatch * 0.20 +
        factors.zoningMatch * 0.15 +
        factors.featureMatch * 0.10 +
        factors.financingMatch * 0.15
      );

      expect(score).toBe(expectedScore);
    });

    it("score < 40 threshold: mismatched property scores below 40", () => {
      const buyer = makeBuyerProfile({
        preferences: {
          states: ["CA"],
          counties: ["Los Angeles"],
          minAcreage: 100,
          maxAcreage: 200,
          zoningTypes: ["commercial"],
          minPrice: 500000,
          maxPrice: 1000000,
        },
        financialInfo: { budget: 1000000, financingType: "cash" },
      });
      // Property is in TX, 5 acres, priced at $2M (over budget) — wrong on all axes
      const property = makeProperty({
        state: "TX",
        county: "Travis",
        sizeAcres: "5",
        listPrice: "2000000",
        askingPrice: "2000000",
      });
      const { score } = service.calculateMatchScore(buyer, property);
      expect(score).toBeLessThan(40);
    });

    it("score has all 6 factor keys in the factors object", () => {
      const { factors } = service.calculateMatchScore(makeBuyerProfile(), makeProperty());
      expect(factors).toHaveProperty("priceMatch");
      expect(factors).toHaveProperty("sizeMatch");
      expect(factors).toHaveProperty("locationMatch");
      expect(factors).toHaveProperty("zoningMatch");
      expect(factors).toHaveProperty("featureMatch");
      expect(factors).toHaveProperty("financingMatch");
    });
  });

  // ── priceMatch (25%) ───────────────────────────────────────────────────────
  describe("priceMatch factor", () => {
    it("returns 100 when budget utilization is 70-95% of max budget", () => {
      const buyer = makeBuyerProfile({
        financialInfo: { budget: 130000, financingType: "cash" },
        preferences: { minPrice: 0, maxPrice: 130000 },
      });
      // property at 100k, budget 130k → utilization = 100/130 ≈ 77%
      const property = makeProperty({ listPrice: "100000" });
      const { factors } = service.calculateMatchScore(buyer, property);
      expect(factors.priceMatch).toBe(100);
    });

    it("returns 85 when property is well under budget (< 50% utilization)", () => {
      const buyer = makeBuyerProfile({
        financialInfo: { budget: 300000, financingType: "cash" },
        preferences: { minPrice: 0, maxPrice: 300000 },
      });
      // property at 100k, budget 300k → utilization = 33%
      const property = makeProperty({ listPrice: "100000" });
      const { factors } = service.calculateMatchScore(buyer, property);
      expect(factors.priceMatch).toBe(85);
    });

    it("returns 20 when property is more than 20% over budget", () => {
      const buyer = makeBuyerProfile({
        financialInfo: { budget: 80000, financingType: "cash" },
        preferences: { minPrice: 0, maxPrice: 80000 },
      });
      // property at 100k, budget 80k → 25% over
      const property = makeProperty({ listPrice: "100000" });
      const { factors, concerns } = service.calculateMatchScore(buyer, property);
      expect(factors.priceMatch).toBe(20);
      expect(concerns.some((c: string) => c.includes("over budget"))).toBe(true);
    });

    it("sliding scale for slight over-budget: returns between 20 and 60", () => {
      const buyer = makeBuyerProfile({
        financialInfo: { budget: 95000, financingType: "cash" },
        preferences: { minPrice: 0, maxPrice: 95000 },
      });
      // property at 100k, budget 95k → ~5.3% over
      const property = makeProperty({ listPrice: "100000" });
      const { factors } = service.calculateMatchScore(buyer, property);
      expect(factors.priceMatch).toBeGreaterThan(20);
      expect(factors.priceMatch).toBeLessThan(60);
    });

    it("returns 60 when no budget is set", () => {
      const buyer = makeBuyerProfile({
        financialInfo: { financingType: "cash" }, // no budget
        preferences: { minPrice: 0 },
      });
      const { factors } = service.calculateMatchScore(buyer, makeProperty());
      expect(factors.priceMatch).toBe(60);
    });
  });

  // ── sizeMatch (15%) ────────────────────────────────────────────────────────
  describe("sizeMatch factor", () => {
    it("returns 100 when property size is within min/max acreage range", () => {
      const buyer = makeBuyerProfile({
        preferences: { minAcreage: 5, maxAcreage: 20 },
      });
      const property = makeProperty({ sizeAcres: "10" });
      const { factors } = service.calculateMatchScore(buyer, property);
      expect(factors.sizeMatch).toBe(100);
    });

    it("reduces score proportionally when property is smaller than minimum", () => {
      const buyer = makeBuyerProfile({
        preferences: { minAcreage: 20, maxAcreage: 50 },
      });
      // property at 10 acres, min is 20 → 50% smaller than min
      const property = makeProperty({ sizeAcres: "10" });
      const { factors, concerns } = service.calculateMatchScore(buyer, property);
      expect(factors.sizeMatch).toBeLessThan(100);
      expect(concerns.some((c: string) => c.includes("smaller than preferred"))).toBe(true);
    });

    it("reduces score when property is more than 50% larger than max", () => {
      const buyer = makeBuyerProfile({
        preferences: { minAcreage: 1, maxAcreage: 5 },
      });
      // property at 10 acres, max is 5 → 100% larger
      const property = makeProperty({ sizeAcres: "10" });
      const { factors } = service.calculateMatchScore(buyer, property);
      expect(factors.sizeMatch).toBeLessThanOrEqual(30);
    });

    it("returns 50 when property size is not available", () => {
      const buyer = makeBuyerProfile();
      const property = makeProperty({ sizeAcres: null });
      const { factors } = service.calculateMatchScore(buyer, property);
      expect(factors.sizeMatch).toBe(50);
    });
  });

  // ── locationMatch (20%) ────────────────────────────────────────────────────
  describe("locationMatch factor", () => {
    it("returns 100 for exact county match", () => {
      const buyer = makeBuyerProfile({
        preferences: { states: ["TX"], counties: ["Travis"] },
      });
      const property = makeProperty({ state: "TX", county: "Travis" });
      const { factors } = service.calculateMatchScore(buyer, property);
      expect(factors.locationMatch).toBe(100);
    });

    it("returns 85 for same-state but different county", () => {
      const buyer = makeBuyerProfile({
        preferences: { states: ["TX"], counties: ["Dallas"] },
      });
      const property = makeProperty({ state: "TX", county: "Travis" });
      const { factors } = service.calculateMatchScore(buyer, property);
      // county doesn't match but state does → 85
      expect(factors.locationMatch).toBe(85);
    });

    it("returns 30 for different state entirely", () => {
      const buyer = makeBuyerProfile({
        preferences: { states: ["CA"], counties: ["Los Angeles"] },
      });
      const property = makeProperty({ state: "TX", county: "Travis" });
      const { factors } = service.calculateMatchScore(buyer, property);
      expect(factors.locationMatch).toBe(30);
    });

    it("returns 70 when buyer has no location preference", () => {
      const buyer = makeBuyerProfile({
        preferences: { states: [], counties: [] },
      });
      const { factors } = service.calculateMatchScore(buyer, makeProperty());
      expect(factors.locationMatch).toBe(70);
    });
  });

  // ── zoningMatch (15%) ──────────────────────────────────────────────────────
  describe("zoningMatch factor", () => {
    it("returns 100 when property zoning matches preferred zoning type", () => {
      const buyer = makeBuyerProfile({
        preferences: { zoningTypes: ["agricultural"], useTypes: [] },
      });
      const property = makeProperty({ zoning: "agricultural" });
      const { factors } = service.calculateMatchScore(buyer, property);
      expect(factors.zoningMatch).toBe(100);
    });

    it("returns 90 when property zoning supports preferred use type", () => {
      const buyer = makeBuyerProfile({
        preferences: { zoningTypes: [], useTypes: ["agricultural"] },
      });
      // zoning is "ag" which maps to the agricultural use category
      const property = makeProperty({ zoning: "ag" });
      const { factors } = service.calculateMatchScore(buyer, property);
      expect(factors.zoningMatch).toBe(90);
    });

    it("returns 40 when zoning does not match any preference", () => {
      const buyer = makeBuyerProfile({
        preferences: { zoningTypes: ["residential"], useTypes: [] },
      });
      const property = makeProperty({ zoning: "industrial" });
      const { factors } = service.calculateMatchScore(buyer, property);
      expect(factors.zoningMatch).toBe(40);
    });

    it("returns 70 when buyer has no zoning preference", () => {
      const buyer = makeBuyerProfile({
        preferences: { zoningTypes: [], useTypes: [] },
      });
      const { factors } = service.calculateMatchScore(buyer, makeProperty());
      expect(factors.zoningMatch).toBe(70);
    });
  });

  // ── featureMatch (10%) ─────────────────────────────────────────────────────
  describe("featureMatch factor", () => {
    it("returns 100 when all road, utility, and terrain preferences are met", () => {
      const buyer = makeBuyerProfile({
        preferences: {
          roadAccess: ["paved"],
          utilities: ["electric", "water"],
          terrainTypes: ["flat"],
        },
      });
      const property = makeProperty({
        roadAccess: "paved",
        utilities: { electric: true, water: true, sewer: false, gas: false },
        terrain: "flat level",
      });
      const { factors } = service.calculateMatchScore(buyer, property);
      expect(factors.featureMatch).toBe(100);
    });

    it("returns 70 when buyer has no feature preferences set", () => {
      const buyer = makeBuyerProfile({
        preferences: { roadAccess: [], utilities: [], terrainTypes: [] },
      });
      const { factors } = service.calculateMatchScore(buyer, makeProperty());
      expect(factors.featureMatch).toBe(70);
    });

    it("partial match: one of two preferences met → ~50 score", () => {
      const buyer = makeBuyerProfile({
        preferences: {
          roadAccess: ["paved"],
          terrainTypes: ["mountainous"], // won't match flat property
          utilities: [],
        },
      });
      const property = makeProperty({ roadAccess: "paved", terrain: "flat" });
      const { factors } = service.calculateMatchScore(buyer, property);
      // 1 of 2 preferences matched → score = round(1/2 * 100) = 50, clamped at max(30,50)
      expect(factors.featureMatch).toBe(50);
    });
  });

  // ── financingMatch (15%) ───────────────────────────────────────────────────
  describe("financingMatch factor", () => {
    it("returns 100 for cash buyer when property is within budget", () => {
      const buyer = makeBuyerProfile({
        financialInfo: { budget: 150000, financingType: "cash" },
      });
      const property = makeProperty({ listPrice: "100000" });
      const { factors } = service.calculateMatchScore(buyer, property);
      expect(factors.financingMatch).toBe(100);
    });

    it("returns 95 for owner_finance buyer who qualifies with down and monthly capacity", () => {
      const buyer = makeBuyerProfile({
        financialInfo: {
          financingType: "owner_finance",
          budget: null,
          downPaymentCapacity: 20000, // 10% of 100k = 10k; buyer has 20k
          monthlyPaymentCapacity: 2000, // 90k / 60 = 1500; buyer has 2000
        },
      });
      const property = makeProperty({ listPrice: "100000" });
      const { factors } = service.calculateMatchScore(buyer, property);
      expect(factors.financingMatch).toBe(95);
    });

    it("returns 100 for pre-approved buyer within pre-approval amount", () => {
      const buyer = makeBuyerProfile({
        financialInfo: {
          financingType: "conventional",
          preApproved: true,
          preApprovalAmount: 200000,
          budget: null,
        },
      });
      const property = makeProperty({ listPrice: "100000" });
      const { factors } = service.calculateMatchScore(buyer, property);
      expect(factors.financingMatch).toBe(100);
    });

    it("returns 50 when property exceeds pre-approval amount", () => {
      const buyer = makeBuyerProfile({
        financialInfo: {
          financingType: "conventional",
          preApproved: true,
          preApprovalAmount: 80000,
          budget: null,
        },
      });
      const property = makeProperty({ listPrice: "100000" });
      const { factors } = service.calculateMatchScore(buyer, property);
      expect(factors.financingMatch).toBe(50);
    });

    it("returns 60 when no financial info is provided", () => {
      const buyer = makeBuyerProfile({ financialInfo: null });
      const { factors } = service.calculateMatchScore(buyer, makeProperty());
      expect(factors.financingMatch).toBe(60);
    });
  });

  // ── reasons and concerns ───────────────────────────────────────────────────
  describe("reasons and concerns arrays", () => {
    it("populates reasons for matching factors", () => {
      const buyer = makeBuyerProfile({
        preferences: { states: ["TX"], counties: ["Travis"] },
      });
      const { reasons } = service.calculateMatchScore(buyer, makeProperty());
      expect(Array.isArray(reasons)).toBe(true);
      expect(reasons.length).toBeGreaterThan(0);
    });

    it("populates concerns for non-matching factors", () => {
      const buyer = makeBuyerProfile({
        preferences: { states: ["CA"], counties: [], minAcreage: 100, maxAcreage: 200 },
        financialInfo: { budget: 80000, financingType: "cash" },
      });
      const property = makeProperty({ state: "TX", listPrice: "100000" });
      const { concerns } = service.calculateMatchScore(buyer, property);
      expect(Array.isArray(concerns)).toBe(true);
      expect(concerns.length).toBeGreaterThan(0);
    });
  });
});
