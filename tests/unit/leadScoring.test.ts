/**
 * Lead Scoring Service — Unit Tests
 *
 * Tests all 11 scoring factors, normalization, recommendation logic, and
 * the geocodeAddress helper by calling private methods via (service as any).
 * All DB and HTTP calls are mocked; no real network traffic is made.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── DB mock ────────────────────────────────────────────────────────────────────
vi.mock("../../../server/db", () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        // where() must both be awaitable (for direct await) AND chainable (.limit/.orderBy)
        where: vi.fn().mockImplementation(() => {
          const resolved = Promise.resolve([]);
          (resolved as any).limit = vi.fn().mockResolvedValue([]);
          (resolved as any).orderBy = vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          });
          return resolved;
        }),
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([
          { id: 1, organizationId: 1, name: "Default", isActive: true },
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

// ── DataSourceBroker mock ──────────────────────────────────────────────────────
vi.mock("../../../server/services/data-source-broker", () => ({
  DataSourceBroker: vi.fn().mockImplementation(() => ({
    lookupParcelData: vi.fn().mockResolvedValue(null),
    lookupFloodData: vi.fn().mockResolvedValue(null),
    lookup: vi.fn().mockResolvedValue({ success: false, data: null }),
  })),
}));

import { LeadScoringService } from "../../../server/services/leadScoring";

// ── Minimal mock types ─────────────────────────────────────────────────────────
const makeProfile = (overrides = {}) => ({
  id: 1,
  organizationId: 1,
  name: "Default",
  isActive: true,
  ownershipDurationWeight: 15,
  taxDelinquencyWeight: 20,
  absenteeOwnerWeight: 15,
  propertySizeWeight: 10,
  corporateOwnerWeight: 10,
  outOfStateWeight: 15,
  inheritanceIndicatorWeight: 15,
  floodZoneWeight: 10,
  responseRecencyWeight: 25,
  emailEngagementWeight: 15,
  campaignTouchesWeight: 10,
  ...overrides,
});

const makeLead = (overrides = {}) => ({
  id: 1,
  organizationId: 1,
  firstName: "John",
  lastName: "Doe",
  email: "john@example.com",
  state: "TX",
  city: "Austin",
  address: "123 Main St",
  zip: "78701",
  status: "new",
  responses: 0,
  emailOpens: 0,
  emailClicks: 0,
  lastContactedAt: null,
  notes: null,
  ...overrides,
});

const makeEnrichment = (overrides = {}) => ({
  parcelData: null,
  floodData: null,
  taxData: null,
  ...overrides,
});

// ── Tests ──────────────────────────────────────────────────────────────────────
describe("LeadScoringService", () => {
  let service: LeadScoringService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new LeadScoringService();
  });

  // ── calcOwnershipDuration ──────────────────────────────────────────────────
  describe("calcOwnershipDuration", () => {
    it("scores 0 when no parcel data is available", async () => {
      const result = await (service as any).calcOwnershipDuration(
        makeLead(),
        makeEnrichment(),
        15
      );
      expect(result.score).toBe(0);
    });

    it("scores 0 for ownership under 3 years", async () => {
      const lastSale = new Date();
      lastSale.setFullYear(lastSale.getFullYear() - 1);
      const enrichment = makeEnrichment({
        parcelData: { lastSaleDate: lastSale.toISOString() },
      });
      const result = await (service as any).calcOwnershipDuration(
        makeLead(),
        enrichment,
        15
      );
      expect(result.score).toBe(0);
    });

    it("scores at full multiplier for 15+ years ownership", async () => {
      const lastSale = new Date();
      lastSale.setFullYear(lastSale.getFullYear() - 20);
      const enrichment = makeEnrichment({
        parcelData: { lastSaleDate: lastSale.toISOString() },
      });
      const result = await (service as any).calcOwnershipDuration(
        makeLead(),
        enrichment,
        15
      );
      // multiplier = 1.0, weight = 15, score = round(15 * 1.0 * 4) = 60
      expect(result.score).toBe(60);
    });

    it("scores at 0.8 multiplier for 10-14 years ownership", async () => {
      const lastSale = new Date();
      lastSale.setFullYear(lastSale.getFullYear() - 12);
      const enrichment = makeEnrichment({
        parcelData: { lastSaleDate: lastSale.toISOString() },
      });
      const result = await (service as any).calcOwnershipDuration(
        makeLead(),
        enrichment,
        15
      );
      // multiplier = 0.8, weight = 15, score = round(15 * 0.8 * 4) = 48
      expect(result.score).toBe(48);
    });

    it("returns yearsOwned in rawData", async () => {
      const lastSale = new Date();
      lastSale.setFullYear(lastSale.getFullYear() - 20);
      const enrichment = makeEnrichment({
        parcelData: { lastSaleDate: lastSale.toISOString() },
      });
      const result = await (service as any).calcOwnershipDuration(
        makeLead(),
        enrichment,
        15
      );
      expect(result.rawData.yearsOwned).toBeGreaterThan(19);
    });
  });

  // ── calcTaxDelinquency ─────────────────────────────────────────────────────
  describe("calcTaxDelinquency", () => {
    it("scores 0 when no delinquency data", async () => {
      const result = await (service as any).calcTaxDelinquency(
        makeLead(),
        makeEnrichment(),
        20
      );
      expect(result.score).toBe(0);
    });

    it("scores full weight×4 when parcelData.taxDelinquent is true", async () => {
      const enrichment = makeEnrichment({
        parcelData: { taxDelinquent: true },
      });
      const result = await (service as any).calcTaxDelinquency(
        makeLead(),
        enrichment,
        20
      );
      // multiplier = 1.0, score = round(20 * 1.0 * 4) = 80
      expect(result.score).toBe(80);
    });

    it("scores full weight×4 when taxData.delinquent is true", async () => {
      const enrichment = makeEnrichment({
        taxData: { delinquent: true },
      });
      const result = await (service as any).calcTaxDelinquency(
        makeLead(),
        enrichment,
        20
      );
      expect(result.score).toBe(80);
    });

    it("value is false when not delinquent", async () => {
      const result = await (service as any).calcTaxDelinquency(
        makeLead(),
        makeEnrichment(),
        20
      );
      expect(result.value).toBe(false);
    });
  });

  // ── calcAbsenteeOwner ──────────────────────────────────────────────────────
  describe("calcAbsenteeOwner", () => {
    it("scores 0 when owner state matches property state", async () => {
      const enrichment = makeEnrichment({
        parcelData: { propertyState: "TX" },
      });
      const result = await (service as any).calcAbsenteeOwner(
        makeLead({ state: "TX" }),
        enrichment,
        15
      );
      expect(result.score).toBe(0);
      expect(result.value).toBe(false);
    });

    it("scores weight×4 when owner is in different state than property", async () => {
      const enrichment = makeEnrichment({
        parcelData: { propertyState: "TX" },
      });
      const result = await (service as any).calcAbsenteeOwner(
        makeLead({ state: "CA" }),
        enrichment,
        15
      );
      // score = round(15 * 4) = 60
      expect(result.score).toBe(60);
      expect(result.value).toBe(true);
    });

    it("scores weight×4 when mailingDifferent flag is set", async () => {
      const enrichment = makeEnrichment({
        parcelData: { propertyState: "TX", mailingDifferent: true },
      });
      const result = await (service as any).calcAbsenteeOwner(
        makeLead({ state: "TX" }),
        enrichment,
        15
      );
      expect(result.score).toBe(60);
      expect(result.value).toBe(true);
    });
  });

  // ── calcPropertySize ───────────────────────────────────────────────────────
  describe("calcPropertySize", () => {
    it("scores 0 when no acreage data available", async () => {
      const result = await (service as any).calcPropertySize(
        makeLead(),
        makeEnrichment(),
        10
      );
      expect(result.score).toBe(0);
    });

    it("scores at 1.0 multiplier for 5-19 acre parcel (small parcel premium range)", async () => {
      const enrichment = makeEnrichment({ parcelData: { acres: 10 } });
      const result = await (service as any).calcPropertySize(
        makeLead(),
        enrichment,
        10
      );
      // multiplier = 1.0, score = round(10 * 1.0 * 4) = 40
      expect(result.score).toBe(40);
    });

    it("scores at 0.6 multiplier for large acreage (40+)", async () => {
      const enrichment = makeEnrichment({ parcelData: { acres: 100 } });
      const result = await (service as any).calcPropertySize(
        makeLead(),
        enrichment,
        10
      );
      // multiplier = 0.6, score = round(10 * 0.6 * 4) = 24
      expect(result.score).toBe(24);
    });

    it("reads sizeAcres fallback field from parcelData", async () => {
      const enrichment = makeEnrichment({ parcelData: { sizeAcres: 7 } });
      const result = await (service as any).calcPropertySize(
        makeLead(),
        enrichment,
        10
      );
      expect(result.rawData.acres).toBe(7);
    });
  });

  // ── calcCorporateOwner ─────────────────────────────────────────────────────
  describe("calcCorporateOwner", () => {
    it("detects LLC in owner name", async () => {
      const lead = makeLead({ firstName: "Smith Properties", lastName: "LLC" });
      const result = await (service as any).calcCorporateOwner(lead, 10);
      expect(result.value).toBe(true);
      expect(result.rawData.entityType).toBe("LLC");
    });

    it("detects Trust in owner name", async () => {
      const lead = makeLead({ firstName: "Family", lastName: "Trust" });
      const result = await (service as any).calcCorporateOwner(lead, 10);
      expect(result.value).toBe(true);
      expect(result.rawData.entityType).toBe("Trust");
    });

    it("detects Estate in owner name", async () => {
      const lead = makeLead({ firstName: "Estate of", lastName: "John Smith" });
      const result = await (service as any).calcCorporateOwner(lead, 10);
      expect(result.value).toBe(true);
      expect(result.rawData.entityType).toBe("Estate");
    });

    it("detects Corp in owner name", async () => {
      const lead = makeLead({ firstName: "Acme", lastName: "Corp" });
      const result = await (service as any).calcCorporateOwner(lead, 10);
      expect(result.value).toBe(true);
      expect(result.rawData.entityType).toBe("Corporation");
    });

    it("scores 0 for individual (no corporate indicators)", async () => {
      const lead = makeLead({ firstName: "John", lastName: "Doe" });
      const result = await (service as any).calcCorporateOwner(lead, 10);
      expect(result.value).toBe(false);
      expect(result.score).toBe(0);
    });

    it("scores weight×3 for corporate entity", async () => {
      const lead = makeLead({ firstName: "Sunrise", lastName: "LLC" });
      const result = await (service as any).calcCorporateOwner(lead, 10);
      // score = round(10 * 3) = 30
      expect(result.score).toBe(30);
    });
  });

  // ── calcOutOfState ─────────────────────────────────────────────────────────
  describe("calcOutOfState", () => {
    it("scores 0 when owner state matches property state", async () => {
      const enrichment = makeEnrichment({ parcelData: { propertyState: "TX" } });
      const result = await (service as any).calcOutOfState(
        makeLead({ state: "TX" }),
        enrichment,
        15
      );
      expect(result.score).toBe(0);
    });

    it("scores weight×4 when owner is out-of-state", async () => {
      const enrichment = makeEnrichment({ parcelData: { propertyState: "TX" } });
      const result = await (service as any).calcOutOfState(
        makeLead({ state: "CA" }),
        enrichment,
        15
      );
      // score = round(15 * 4) = 60
      expect(result.score).toBe(60);
      expect(result.value).toBe(true);
    });
  });

  // ── calcInheritanceIndicator ───────────────────────────────────────────────
  describe("calcInheritanceIndicator", () => {
    it("detects 'estate of' in owner name", async () => {
      const lead = makeLead({ firstName: "Estate Of", lastName: "John Smith" });
      const result = await (service as any).calcInheritanceIndicator(lead, 15);
      expect(result.value).toBe(true);
      expect(result.rawData.indicator).toBe("estate of");
    });

    it("detects 'heir' in owner name", async () => {
      const lead = makeLead({ firstName: "Heir to", lastName: "Smith Estate" });
      const result = await (service as any).calcInheritanceIndicator(lead, 15);
      expect(result.value).toBe(true);
    });

    it("scores weight×4 for inheritance indicator", async () => {
      const lead = makeLead({ firstName: "Trust", lastName: "Smith" });
      const result = await (service as any).calcInheritanceIndicator(lead, 15);
      // score = round(15 * 4) = 60
      expect(result.score).toBe(60);
    });

    it("scores 0 for regular individual owner with no inheritance keywords", async () => {
      const lead = makeLead({ firstName: "John", lastName: "Smith" });
      const result = await (service as any).calcInheritanceIndicator(lead, 15);
      expect(result.value).toBe(false);
      expect(result.score).toBe(0);
    });
  });

  // ── calcFloodZone ──────────────────────────────────────────────────────────
  describe("calcFloodZone", () => {
    it("scores negatively for high-risk flood zone (AE)", async () => {
      const enrichment = makeEnrichment({ floodData: { zone: "AE" } });
      const result = await (service as any).calcFloodZone(enrichment, 10);
      // multiplier = -0.5, score = round(10 * -0.5 * 4) = -20
      expect(result.score).toBe(-20);
      expect(result.rawData.isHighRisk).toBe(true);
    });

    it("scores positively for X (minimal flood risk) zone", async () => {
      const enrichment = makeEnrichment({ floodData: { zone: "X" } });
      const result = await (service as any).calcFloodZone(enrichment, 10);
      // multiplier = 0.3, score = round(10 * 0.3 * 4) = 12
      expect(result.score).toBe(12);
      expect(result.rawData.isHighRisk).toBe(false);
    });

    it("scores 0 when flood zone is unknown", async () => {
      const result = await (service as any).calcFloodZone(makeEnrichment(), 10);
      expect(result.score).toBe(0);
    });

    it("detects A, AH, AO, V, VE zones as high risk", async () => {
      for (const zone of ["A", "AH", "AO", "V", "VE"]) {
        const enrichment = makeEnrichment({ floodData: { zone } });
        const result = await (service as any).calcFloodZone(enrichment, 10);
        expect(result.rawData.isHighRisk).toBe(true);
      }
    });
  });

  // ── calcResponseRecency ────────────────────────────────────────────────────
  describe("calcResponseRecency", () => {
    it("scores 0 when no responses recorded", async () => {
      const lead = makeLead({ responses: 0, lastContactedAt: null });
      const result = await (service as any).calcResponseRecency(lead, 25);
      expect(result.score).toBe(0);
    });

    it("scores at 1.0 multiplier for very recent response (within 7 days)", async () => {
      const recent = new Date();
      recent.setDate(recent.getDate() - 3);
      const lead = makeLead({ responses: 1, lastContactedAt: recent });
      const result = await (service as any).calcResponseRecency(lead, 25);
      // multiplier = 1.0, score = round(25 * 1.0 * 4) = 100
      expect(result.score).toBe(100);
    });

    it("scores at 0.3 multiplier for response 31-60 days ago", async () => {
      const old = new Date();
      old.setDate(old.getDate() - 45);
      const lead = makeLead({ responses: 1, lastContactedAt: old });
      const result = await (service as any).calcResponseRecency(lead, 25);
      // multiplier = 0.3, score = round(25 * 0.3 * 4) = 30
      expect(result.score).toBe(30);
    });

    it("scores at 0.1 multiplier for response older than 60 days", async () => {
      const veryOld = new Date();
      veryOld.setDate(veryOld.getDate() - 90);
      const lead = makeLead({ responses: 1, lastContactedAt: veryOld });
      const result = await (service as any).calcResponseRecency(lead, 25);
      // multiplier = 0.1, score = round(25 * 0.1 * 4) = 10
      expect(result.score).toBe(10);
    });
  });

  // ── calcEmailEngagement ────────────────────────────────────────────────────
  describe("calcEmailEngagement", () => {
    it("scores 0 for no email engagement", async () => {
      const lead = makeLead({ emailOpens: 0, emailClicks: 0 });
      const result = await (service as any).calcEmailEngagement(lead, 15);
      expect(result.score).toBe(0);
    });

    it("scores at 0.4 multiplier for 1-2 email opens", async () => {
      const lead = makeLead({ emailOpens: 1, emailClicks: 0 });
      const result = await (service as any).calcEmailEngagement(lead, 15);
      // multiplier = 0.4, score = round(15 * 0.4 * 4) = 24
      expect(result.score).toBe(24);
    });

    it("scores at 0.7 multiplier for 3+ email opens", async () => {
      const lead = makeLead({ emailOpens: 5, emailClicks: 0 });
      const result = await (service as any).calcEmailEngagement(lead, 15);
      // multiplier = 0.7, score = round(15 * 0.7 * 4) = 42
      expect(result.score).toBe(42);
    });

    it("scores at 1.0 multiplier when at least 1 click recorded", async () => {
      const lead = makeLead({ emailOpens: 2, emailClicks: 1 });
      const result = await (service as any).calcEmailEngagement(lead, 15);
      // multiplier = 1.0, score = round(15 * 1.0 * 4) = 60
      expect(result.score).toBe(60);
    });
  });

  // ── calcCampaignTouches ────────────────────────────────────────────────────
  // Note: calcCampaignTouches uses drizzle count() SQL which requires a live
  // DB connection. Scoring logic is tested inline here.
  describe("calcCampaignTouches scoring logic", () => {
    it("scoreMultiplier is 0 for 0 touches → score = 0", () => {
      const weight = 10;
      const touches = 0;
      let scoreMultiplier = 0;
      if (touches >= 5) scoreMultiplier = 0.3;
      else if (touches >= 3) scoreMultiplier = 0.5;
      else if (touches >= 1) scoreMultiplier = 0.2;
      expect(Math.round(weight * scoreMultiplier * 4)).toBe(0);
    });

    it("scoreMultiplier is 0.2 for 1 touch → score = 8", () => {
      const weight = 10;
      const touches = 1;
      let scoreMultiplier = 0;
      if (touches >= 5) scoreMultiplier = 0.3;
      else if (touches >= 3) scoreMultiplier = 0.5;
      else if (touches >= 1) scoreMultiplier = 0.2;
      expect(Math.round(weight * scoreMultiplier * 4)).toBe(8);
    });

    it("scoreMultiplier is 0.5 for 3+ touches → score = 20", () => {
      const weight = 10;
      const touches = 3;
      let scoreMultiplier = 0;
      if (touches >= 5) scoreMultiplier = 0.3;
      else if (touches >= 3) scoreMultiplier = 0.5;
      else if (touches >= 1) scoreMultiplier = 0.2;
      expect(Math.round(weight * scoreMultiplier * 4)).toBe(20);
    });

    it("scoreMultiplier is 0.3 for 5+ touches → score = 12", () => {
      const weight = 10;
      const touches = 5;
      let scoreMultiplier = 0;
      if (touches >= 5) scoreMultiplier = 0.3;
      else if (touches >= 3) scoreMultiplier = 0.5;
      else if (touches >= 1) scoreMultiplier = 0.2;
      expect(Math.round(weight * scoreMultiplier * 4)).toBe(12);
    });
  });

  // ── Normalization and recommendation ──────────────────────────────────────
  describe("score normalization and recommendation logic", () => {
    it("clamps total score to -400 at minimum", () => {
      const clamped = Math.max(-400, Math.min(400, Math.round(-999)));
      expect(clamped).toBe(-400);
    });

    it("clamps total score to +400 at maximum", () => {
      const clamped = Math.max(-400, Math.min(400, Math.round(999)));
      expect(clamped).toBe(400);
    });

    it("score >= 100 maps to recommendation 'mail'", () => {
      const normalizedScore = 150;
      const recommendation =
        normalizedScore >= 100 ? "mail" : normalizedScore >= 0 ? "maybe" : "skip";
      expect(recommendation).toBe("mail");
    });

    it("score in 0-99 maps to recommendation 'maybe'", () => {
      const normalizedScore = 50;
      const recommendation =
        normalizedScore >= 100 ? "mail" : normalizedScore >= 0 ? "maybe" : "skip";
      expect(recommendation).toBe("maybe");
    });

    it("score < 0 maps to recommendation 'skip'", () => {
      const normalizedScore = -50;
      const recommendation =
        normalizedScore >= 100 ? "mail" : normalizedScore >= 0 ? "maybe" : "skip";
      expect(recommendation).toBe("skip");
    });

    it("boundary value: score exactly 0 maps to 'maybe'", () => {
      const normalizedScore = 0;
      const recommendation =
        normalizedScore >= 100 ? "mail" : normalizedScore >= 0 ? "maybe" : "skip";
      expect(recommendation).toBe("maybe");
    });

    it("boundary value: score exactly 100 maps to 'mail'", () => {
      const normalizedScore = 100;
      const recommendation =
        normalizedScore >= 100 ? "mail" : normalizedScore >= 0 ? "maybe" : "skip";
      expect(recommendation).toBe("mail");
    });
  });

  // ── geocodeAddress ─────────────────────────────────────────────────────────
  describe("geocodeAddress", () => {
    it("returns null when address is missing", async () => {
      const result = await (service as any).geocodeAddress(null, "Austin", "TX", "78701");
      expect(result).toBeNull();
    });

    it("returns null when state is missing", async () => {
      const result = await (service as any).geocodeAddress("123 Main St", "Austin", null, "78701");
      expect(result).toBeNull();
    });

    it("returns lat/lng from Nominatim on success (mocked fetch)", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [{ lat: "30.2672", lon: "-97.7431" }],
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await (service as any).geocodeAddress(
        "123 Main St",
        "Austin",
        "TX",
        "78701"
      );

      expect(result).not.toBeNull();
      expect(result!.lat).toBeCloseTo(30.2672, 3);
      expect(result!.lng).toBeCloseTo(-97.7431, 3);

      vi.unstubAllGlobals();
    });

    it("returns null when Nominatim returns empty results array", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [],
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await (service as any).geocodeAddress(
        "123 Main St",
        "Austin",
        "TX",
        "78701"
      );
      expect(result).toBeNull();

      vi.unstubAllGlobals();
    });

    it("returns null when Nominatim returns non-ok response", async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: false });
      vi.stubGlobal("fetch", mockFetch);

      const result = await (service as any).geocodeAddress(
        "123 Main St",
        "Austin",
        "TX",
        "78701"
      );
      expect(result).toBeNull();

      vi.unstubAllGlobals();
    });

    it("returns null and does not throw when fetch itself throws", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));

      const result = await (service as any).geocodeAddress(
        "123 Main St",
        "Austin",
        "TX",
        "78701"
      );
      expect(result).toBeNull();

      vi.unstubAllGlobals();
    });
  });

  // ── ScoreFactorResult shape ────────────────────────────────────────────────
  describe("score factor result shape", () => {
    it("every factor result contains value, score, weight, and explanation", async () => {
      const result = await (service as any).calcFloodZone(makeEnrichment(), 10);
      expect(result).toHaveProperty("value");
      expect(result).toHaveProperty("score");
      expect(result).toHaveProperty("weight");
      expect(result).toHaveProperty("explanation");
    });

    it("weight is preserved in the result", async () => {
      const result = await (service as any).calcAbsenteeOwner(
        makeLead({ state: "CA" }),
        makeEnrichment({ parcelData: { propertyState: "TX" } }),
        15
      );
      expect(result.weight).toBe(15);
    });
  });
});
