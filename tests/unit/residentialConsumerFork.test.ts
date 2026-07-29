/**
 * Consumer fork routing — wave V3 of founder ruling #11.
 *
 * Pins the two chokepoints every comps/AVM consumer funnels through:
 *
 *   1. comps.ts getComparableProperties — the single land-comps service
 *      behind /api/properties/:id/comps, /api/comps/search, due diligence,
 *      the DD report generator, Pax's run_comps_analysis tool, the agent
 *      researchComps skill, and the offer/price/disposition engines. A
 *      RESIDENTIAL org (RESIDENTIAL_BUSINESS_TYPES) must be routed to the
 *      residential seam BEFORE any Regrid/land code (including the shared
 *      coordinate-keyed compsCache) runs; a land org keeps the land path.
 *
 *   2. acreOSValuation.generateValuation — the AVM behind /api/avm/* and
 *      the DD report. A residential org gets the ATTOM AVM (or an honest
 *      insufficient_data refusal, which the AVM route refunds); the land
 *      model (land training rows + land GBM + "rural land" LLM) never runs.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock state ───────────────────────────────────────────────────────────
let businessType: string | null = null;
let compsOutcome: unknown = null;
let valuationOutcome: unknown = null;
let insertedRows: Array<Record<string, unknown>> = [];

const getResidentialCompsMock = vi.fn(async () => compsOutcome);
const getResidentialValuationMock = vi.fn(async () => valuationOutcome);

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../server/storage", () => ({
  storage: {
    getOrganizationIntegration: vi.fn(async () => null),
    logApiUsage: vi.fn(async () => undefined),
  },
}));

vi.mock("../../server/services/fieldEncryption", () => ({
  decryptJsonCredentials: vi.fn(),
}));

vi.mock("../../server/db", () => {
  const limit = async () => [];
  const where = () => ({ limit });
  const from = () => ({ where, limit });
  return {
    db: {
      select: () => ({ from }),
      insert: () => ({
        values: (v: Record<string, unknown>) => {
          insertedRows.push(v);
          // awaitable + .returning() for both insert styles
          const thenable = {
            returning: async () => [{ id: 1 }],
            then: (resolve: (v: unknown) => void) => resolve(undefined),
          };
          return thenable;
        },
      }),
    },
  };
});

vi.mock("../../server/services/residentialComps", () => ({
  getOrgBusinessType: vi.fn(async () => businessType),
  getResidentialComps: (...args: unknown[]) => getResidentialCompsMock(...(args as [])),
  getResidentialValuation: (...args: unknown[]) => getResidentialValuationMock(...(args as [])),
  extractResidentialComps: (data: unknown) =>
    (data as { parsedComps?: unknown[] } | null)?.parsedComps ?? [],
  extractResidentialAvm: (data: unknown) =>
    (data as { avm?: unknown } | null)?.avm ?? null,
  RESIDENTIAL_COMPS_UNAVAILABLE_MESSAGE: "COMPS_UNAVAILABLE_SENTINEL",
  RESIDENTIAL_VALUATION_UNAVAILABLE_MESSAGE: "VALUATION_UNAVAILABLE_SENTINEL",
}));

import { getComparableProperties, getPropertyComps } from "../../server/services/comps";
import { acreOSValuation } from "../../server/services/acreOSValuation";

const LAT = 33.4484;
const LNG = -112.074;

beforeEach(() => {
  businessType = null;
  compsOutcome = null;
  valuationOutcome = null;
  insertedRows = [];
  getResidentialCompsMock.mockClear();
  getResidentialValuationMock.mockClear();
  delete process.env.REGRID_API_KEY;
  global.fetch = vi.fn(async () => {
    throw new Error("network must not be touched in this test");
  }) as unknown as typeof fetch;
});

describe("comps chokepoint — getComparableProperties forks by org businessType", () => {
  it("fix_and_flip org, seam unavailable → the exact unavailable error; Regrid/land path never touched", async () => {
    businessType = "fix_and_flip";
    compsOutcome = {
      status: "unavailable",
      reason: "attom_not_connected",
      message: "COMPS_UNAVAILABLE_SENTINEL",
    };

    const result = await getComparableProperties(LAT, LNG, 5, {}, 42);
    expect(result.success).toBe(false);
    expect(result.residential).toBe(true);
    expect(result.error).toBe("COMPS_UNAVAILABLE_SENTINEL");
    expect(result.comps).toEqual([]); // NEVER a land comp under a house label
    expect(getResidentialCompsMock).toHaveBeenCalledWith(42, {
      kind: "coordinates",
      latitude: LAT,
      longitude: LNG,
    });
    expect(global.fetch).not.toHaveBeenCalled(); // no Regrid radius search
  });

  it("landlord family routes through the seam too (buy_and_hold / short_term_rental / multifamily / mobile_home)", async () => {
    compsOutcome = { status: "unavailable", reason: "attom_not_connected", message: "COMPS_UNAVAILABLE_SENTINEL" };
    for (const bt of ["buy_and_hold", "short_term_rental", "multifamily", "mobile_home"]) {
      businessType = bt;
      getResidentialCompsMock.mockClear();
      const result = await getComparableProperties(LAT, LNG, 5, {}, 42);
      expect(result.residential, bt).toBe(true);
      expect(getResidentialCompsMock, bt).toHaveBeenCalledTimes(1);
    }
  });

  it("seam ok → ATTOM house comps with pricePerAcre null (land $/acre math stays inert)", async () => {
    businessType = "fix_and_flip";
    compsOutcome = {
      status: "ok",
      byok: false,
      result: {
        data: {
          parsedComps: [
            {
              address: "456 Oak Ave",
              city: "Phoenix",
              state: "AZ",
              salePrice: 350000,
              saleDate: "2026-03-15",
              sqft: 1850,
              bedrooms: 3,
              bathrooms: 2,
              lotAcres: 0.18,
              distanceMiles: 0.4,
              latitude: 33.45,
              longitude: -112.07,
              propertyType: "SFR",
            },
          ],
        },
      },
    };

    const result = await getComparableProperties(LAT, LNG, 5, {}, 42);
    expect(result.success).toBe(true);
    expect(result.residential).toBe(true);
    expect(result.credentialSource).toBe("platform");
    expect(result.comps).toHaveLength(1);
    const comp = result.comps[0];
    expect(comp.salePrice).toBe(350000);
    expect(comp.pricePerAcre).toBeNull(); // house comps are never $/acre
    expect(comp.sqft).toBe(1850);
    expect(comp.bedrooms).toBe(3);
    expect(comp.propertyType).toBe("SFR");
  });

  it("getPropertyComps never runs land market analysis / offer bands / land desirability on a residential result", async () => {
    businessType = "fix_and_flip";
    compsOutcome = {
      status: "ok",
      byok: true,
      result: {
        data: {
          parsedComps: [
            { address: "1 Elm St", city: "Mesa", state: "AZ", salePrice: 300000, saleDate: "2026-05-01", sqft: 1500, bedrooms: 3, bathrooms: 2, lotAcres: 0.2, distanceMiles: 0.2, latitude: 33.4, longitude: -111.8, propertyType: "SFR" },
          ],
        },
      },
    };

    const result = await getPropertyComps(LAT, LNG, 2.5, 5, {}, {
      roadAccess: "paved",
      terrain: "flat",
      zoning: "residential",
      sizeAcres: 2.5,
    }, 42);

    expect(result.residential).toBe(true);
    expect(result.credentialSource).toBe("organization"); // BYOK-served
    expect(result.marketAnalysis).toBeUndefined(); // $/acre model — land only
    expect(result.offerPrices).toBeUndefined(); // acreage offer bands — land only
    expect(result.desirabilityScore).toBeUndefined(); // land desirability — land only
  });

  it("a LAND org keeps the land path (no residential flag, Regrid credential error when unkeyed)", async () => {
    businessType = "land_flipper";
    const result = await getComparableProperties(LAT, LNG, 5, {}, 42);
    expect(getResidentialCompsMock).not.toHaveBeenCalled();
    expect(result.residential).toBeUndefined();
    expect(result.success).toBe(false);
    expect(result.error).toContain("Regrid API key not configured");
  });

  it("no orgId (registry land-provider path) keeps the land path untouched", async () => {
    const result = await getComparableProperties(LAT, LNG, 5, {});
    expect(getResidentialCompsMock).not.toHaveBeenCalled();
    expect(result.residential).toBeUndefined();
  });
});

describe("AVM chokepoint — generateValuation forks by org businessType", () => {
  const REQUEST = {
    propertyId: "0", // non-positive → skips the land-status DB guard
    acres: 0.25,
    location: { state: "AZ", county: "Maricopa", zipCode: "85001", latitude: LAT, longitude: LNG },
    characteristics: {},
  };

  it("residential org, seam unavailable → honest insufficient_data carrying the exact message (route refunds it)", async () => {
    businessType = "fix_and_flip";
    valuationOutcome = {
      status: "unavailable",
      reason: "attom_not_connected",
      message: "VALUATION_UNAVAILABLE_SENTINEL",
    };

    const result = await acreOSValuation.generateValuation("42", REQUEST);
    expect(result.status).toBe("insufficient_data");
    expect(result.classification).toBe("insufficient_data");
    expect(result.estimatedValue).toBe(0);
    expect(result.missing).toContain("VALUATION_UNAVAILABLE_SENTINEL");
    expect(getResidentialValuationMock).toHaveBeenCalledTimes(1);
    expect(insertedRows).toHaveLength(0); // refusals are never persisted as predictions
  });

  it("residential org, ATTOM AVM ok → attom_avm classification + honest methodology + attom_avm row persisted", async () => {
    businessType = "fix_and_flip";
    valuationOutcome = {
      status: "ok",
      byok: false,
      result: {
        confidence: 85,
        data: { avm: { value: 412000, low: 390000, high: 431000, score: 88, asOf: "2026-07-01" } },
      },
    };

    const result = await acreOSValuation.generateValuation("42", REQUEST);
    expect(result.status).toBe("ok");
    expect(result.classification).toBe("attom_avm");
    expect(result.estimatedValue).toBe(412000);
    expect(result.confidence).toBe(88); // ATTOM's own score, not invented
    expect(result.confidenceInterval).toEqual({ low: 390000, high: 431000 });
    expect(result.methodology).toContain("ATTOM AVM");
    expect(result.methodology).toContain("not the AcreOS land model");

    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0].modelVersion).toBe("attom_avm");
    expect(insertedRows[0].predictedValue).toBe("412000");
  });

  it("residential org, ATTOM returns no usable value → honest refusal, nothing invented", async () => {
    businessType = "buy_and_hold";
    valuationOutcome = { status: "ok", byok: false, result: { confidence: 85, data: {} } };

    const result = await acreOSValuation.generateValuation("42", REQUEST);
    expect(result.status).toBe("insufficient_data");
    expect(result.missing?.[0]).toContain("ATTOM AVM returned no usable value");
    expect(insertedRows).toHaveLength(0);
  });

  it("residential org without coordinates → honest refusal naming the gap", async () => {
    businessType = "fix_and_flip";
    const result = await acreOSValuation.generateValuation("42", {
      ...REQUEST,
      location: { ...REQUEST.location, latitude: 0, longitude: 0 },
    });
    expect(result.status).toBe("insufficient_data");
    expect(result.missing?.[0]).toContain("coordinates");
    expect(getResidentialValuationMock).not.toHaveBeenCalled();
  });

  it("a LAND org never touches the residential seam", async () => {
    businessType = "land_flipper";
    // Land path proceeds into findComparables → mocked db returns [] via
    // db.query — provide the query shim lazily to keep the land path honest.
    const dbModule = await import("../../server/db");
    (dbModule.db as unknown as { query: unknown }).query = {
      transactionTraining: { findMany: async () => [] },
    };

    const result = await acreOSValuation.generateValuation("42", REQUEST);
    expect(getResidentialValuationMock).not.toHaveBeenCalled();
    // No comps + no GBM + no LLM key in tests → the land model's own honest
    // refusal (W3.1), proving we stayed on the land path.
    expect(result.status).toBe("insufficient_data");
    expect(result.classification).toBe("insufficient_data");
  });
});
