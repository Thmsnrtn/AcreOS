/**
 * residential_wholesaler routes to the RESIDENTIAL data plane (2026-07-30).
 *
 * The defect: `residential_wholesaler` was missing from
 * RESIDENTIAL_BUSINESS_TYPES, so both comps chokepoints
 * (comps.ts getComparableProperties and acreOSValuation.generateValuation)
 * fell through to Regrid LAND-parcel comps and the land AVM while the
 * subject property is a HOUSE. That is byte-for-byte the defect that got
 * fix_and_flip demoted on 2026-07-11 — shipped, in a beta vertical.
 *
 * This test deliberately does NOT mock server/services/residentialComps
 * (residentialConsumerFork.test.ts already covers the "seam was called"
 * shape). It exercises the REAL seam so the assertion is the PROVIDER
 * CHOICE — providerRegistry.lookup restricted to ["attom"], and Regrid's
 * radius search (global fetch) never reached — not merely a boolean flag.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock state (factories read these lazily) ─────────────────────────────
let businessType: string | null = null;
let platformKeyed = true;
let balanceCents = 100_00;
let connectedProviders = new Set<string>();

const lookupMock = vi.fn();

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
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

// organizations.onboardingData.businessType is the row the fork reads.
vi.mock("../../server/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ onboardingData: { businessType } }],
        }),
      }),
    }),
  },
}));

vi.mock("../../server/services/providers/provider-registry", () => ({
  providerRegistry: {
    lookup: (...args: unknown[]) => lookupMock(...args),
  },
}));

vi.mock("../../server/services/providers/attom-provider", () => ({
  attomProvider: {
    name: "attom",
    isConfigured: async () => platformKeyed,
    costPerLookupCents: (category: string) => (category === "comps" ? 20 : 10),
  },
}));

vi.mock("../../server/services/byok/dataByok", () => ({
  getConnectedDataProviders: async () => connectedProviders,
}));

vi.mock("../../server/services/credits", () => ({
  creditService: { getBalance: async () => balanceCents },
}));

import { getComparableProperties, getPropertyComps } from "../../server/services/comps";
import { RESIDENTIAL_CAPABLE_PROVIDERS } from "../../server/services/residentialComps";

const LAT = 33.4484;
const LNG = -112.074;
const ORG = 42;

const ATTOM_COMPS_RESULT = {
  provider: "attom",
  category: "comps",
  confidence: 80,
  costCents: 20,
  fetchedAt: new Date(),
  cached: false,
  latencyMs: 5,
  data: {
    property: [
      {
        address: { line1: "456 Oak Ave", locality: "Phoenix", countrySubd: "AZ" },
        sale: { amount: { saleAmt: 350000 }, saleTransDate: "2026-03-15" },
        building: { size: { livingSize: 1850 }, rooms: { beds: 3, bathstotal: 2 } },
        lot: { lotSize1: 0.18 },
        location: { latitude: "33.45", longitude: "-112.07", distance: 0.4 },
        summary: { propClass: "SFR" },
      },
    ],
  },
  source: "ATTOM Data",
  sourceAsOf: null,
  classification: "authoritative",
};

beforeEach(() => {
  businessType = null;
  platformKeyed = true;
  balanceCents = 100_00;
  connectedProviders = new Set();
  lookupMock.mockReset();
  delete process.env.REGRID_API_KEY;
  global.fetch = vi.fn(async () => {
    throw new Error("network must not be touched in this test");
  }) as unknown as typeof fetch;
});

describe("residential_wholesaler — comps chokepoint provider choice", () => {
  it("asks the registry for ATTOM only; Regrid's land radius search is never called", async () => {
    businessType = "residential_wholesaler";
    lookupMock.mockResolvedValue(ATTOM_COMPS_RESULT);

    const result = await getComparableProperties(LAT, LNG, 5, {}, ORG);

    expect(lookupMock).toHaveBeenCalledTimes(1);
    const [category, input, tier, , orgId, options] = lookupMock.mock.calls[0];
    expect(category).toBe("comps");
    expect(input).toEqual({ type: "coordinates", latitude: LAT, longitude: LNG });
    expect(tier).toBe("pro");
    expect(orgId).toBe(ORG);
    // THE assertion: the candidate set is residential-capable providers only.
    expect((options as { allowProviders: string[] }).allowProviders).toEqual(
      RESIDENTIAL_CAPABLE_PROVIDERS,
    );
    expect((options as { allowProviders: string[] }).allowProviders).toEqual(["attom"]);
    expect((options as { allowProviders: string[] }).allowProviders).not.toContain("regrid");

    // Regrid's parcel radius search is a raw fetch — it must never run.
    expect(global.fetch).not.toHaveBeenCalled();

    expect(result.success).toBe(true);
    expect(result.residential).toBe(true);
    expect(result.comps).toHaveLength(1);
    expect(result.comps[0].salePrice).toBe(350000);
    // House comps are never priced per acre — land $/acre math stays inert.
    expect(result.comps[0].pricePerAcre).toBeNull();
    expect(result.message).toContain("valued per sale, not per acre");
  });

  it("unkeyed wholesaler org degrades honestly — no land comp substituted", async () => {
    businessType = "residential_wholesaler";
    platformKeyed = false;
    connectedProviders = new Set();

    const result = await getComparableProperties(LAT, LNG, 5, {}, ORG);

    expect(result.success).toBe(false);
    expect(result.residential).toBe(true);
    expect(result.comps).toEqual([]);
    expect(result.error).toContain("ATTOM");
    expect(lookupMock).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("getPropertyComps runs no land $/acre model, offer bands or land desirability for a wholesaler", async () => {
    businessType = "residential_wholesaler";
    lookupMock.mockResolvedValue(ATTOM_COMPS_RESULT);

    const result = await getPropertyComps(
      LAT,
      LNG,
      2.5,
      5,
      {},
      { roadAccess: "paved", terrain: "flat", zoning: "residential", sizeAcres: 2.5 },
      ORG,
    );

    expect(result.residential).toBe(true);
    expect(result.marketAnalysis).toBeUndefined();
    expect(result.offerPrices).toBeUndefined();
    expect(result.desirabilityScore).toBeUndefined();
  });

  it("a LAND vertical is unaffected — it keeps the Regrid/land path", async () => {
    businessType = "land_flipper";

    const result = await getComparableProperties(LAT, LNG, 5, {}, ORG);

    expect(lookupMock).not.toHaveBeenCalled(); // no residential seam
    expect(result.residential).toBeUndefined();
    expect(result.success).toBe(false);
    expect(result.error).toContain("Regrid API key not configured");
  });
});

describe("residential_wholesaler — AVM chokepoint", () => {
  it("valuation asks for the ATTOM AVM, never the land model", async () => {
    businessType = "residential_wholesaler";
    // Valuation lookup returns nothing → the seam must say so honestly
    // rather than falling through to the land GBM / "rural land" LLM.
    lookupMock.mockResolvedValue(null);

    const { getResidentialValuation } = await import(
      "../../server/services/residentialComps"
    );
    const outcome = await getResidentialValuation(ORG, {
      kind: "coordinates",
      latitude: LAT,
      longitude: LNG,
    });

    expect(lookupMock).toHaveBeenCalledTimes(1);
    const [category, , , , , options] = lookupMock.mock.calls[0];
    expect(category).toBe("valuation");
    expect((options as { allowProviders: string[] }).allowProviders).toEqual(["attom"]);
    expect(outcome.status).toBe("no_data");
  });
});
