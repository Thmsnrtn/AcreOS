/**
 * Residential comps/valuation seam — wave V3 of founder ruling #11
 * (the fix_and_flip demotion root cause, founder decision 2026-07-11).
 *
 * Pins the seam's honesty contract:
 *   - unkeyed (no platform ATTOM key, no BYOK) → an EXPLICIT unavailable
 *     state with the exact customer-facing message (verified settings path:
 *     Settings → Your provider keys, /settings/byok, "Property data" group)
 *     — never a land comp, never an invented value;
 *   - keyed (platform or BYOK) → a provider-registry lookup with the right
 *     category, restricted to residential-capable providers (["attom"]);
 *   - BYOK bypasses the credit-balance gate (the customer pays their
 *     vendor directly — R1d);
 *   - platform-billed with an empty pool → honest insufficient-credits
 *     refusal, not a silent null;
 *   - defensive ATTOM payload extraction never fabricates fields.
 *
 * Plus the RESIDENTIAL_BUSINESS_TYPES membership pin (persona-mapping is
 * the taxonomy hub).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock state (factories read these lazily) ─────────────────────────────
let connectedProviders = new Set<string>();
let platformKeyed = false;
let balanceCents = 0;
let orgRows: Array<{ onboardingData: unknown }> = [];

const lookupMock = vi.fn();
const getBalanceMock = vi.fn(async () => balanceCents);

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../server/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => orgRows,
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
  creditService: { getBalance: (...args: unknown[]) => getBalanceMock(...(args as [])) },
}));

import {
  getResidentialComps,
  getResidentialValuation,
  extractResidentialComps,
  extractResidentialAvm,
  RESIDENTIAL_CAPABLE_PROVIDERS,
  RESIDENTIAL_COMPS_UNAVAILABLE_MESSAGE,
  RESIDENTIAL_VALUATION_UNAVAILABLE_MESSAGE,
  getOrgBusinessType,
} from "../../server/services/residentialComps";
import {
  RESIDENTIAL_BUSINESS_TYPES,
  isResidentialBusinessType,
  BUSINESS_TYPES,
} from "@shared/models/persona-mapping";

const SUBJECT = { kind: "coordinates", latitude: 33.4484, longitude: -112.074 } as const;

const OK_RESULT = {
  provider: "attom",
  category: "comps",
  confidence: 80,
  costCents: 20,
  fetchedAt: new Date(),
  cached: false,
  latencyMs: 5,
  data: { property: [] },
  source: "ATTOM Data",
  sourceAsOf: null,
  classification: "authoritative",
};

beforeEach(() => {
  connectedProviders = new Set();
  platformKeyed = false;
  balanceCents = 0;
  orgRows = [];
  lookupMock.mockReset();
  getBalanceMock.mockClear();
});

describe("seam honesty — unkeyed → explicit unavailable, exact message", () => {
  it("comps: no platform key + no BYOK → unavailable with the exact message; registry never touched", async () => {
    const outcome = await getResidentialComps(42, SUBJECT);
    expect(outcome.status).toBe("unavailable");
    if (outcome.status !== "unavailable") throw new Error("unreachable");
    expect(outcome.reason).toBe("attom_not_connected");
    expect(outcome.message).toBe(RESIDENTIAL_COMPS_UNAVAILABLE_MESSAGE);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("valuation: same refusal with the valuation message", async () => {
    const outcome = await getResidentialValuation(42, SUBJECT);
    expect(outcome.status).toBe("unavailable");
    if (outcome.status !== "unavailable") throw new Error("unreachable");
    expect(outcome.message).toBe(RESIDENTIAL_VALUATION_UNAVAILABLE_MESSAGE);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("the messages point to the REAL settings surface (/settings/byok — 'Your provider keys'), not a fictional one", () => {
    // Verified against client/src/pages/settings/byok.tsx: page title
    // "Your provider keys", ATTOM sits in the "Property data" group.
    for (const msg of [RESIDENTIAL_COMPS_UNAVAILABLE_MESSAGE, RESIDENTIAL_VALUATION_UNAVAILABLE_MESSAGE]) {
      expect(msg).toContain("ATTOM connection");
      expect(msg).toContain("Your provider keys");
      expect(msg).toContain("Property data");
      expect(msg).not.toContain("Settings → Connections"); // that surface does not exist
    }
  });
});

describe("seam routing — keyed → registry lookup restricted to residential-capable providers", () => {
  it("platform-keyed comps: registry lookup with category comps + allowProviders ['attom']", async () => {
    platformKeyed = true;
    balanceCents = 100;
    lookupMock.mockResolvedValue({ ...OK_RESULT });

    const outcome = await getResidentialComps(42, SUBJECT);
    expect(outcome.status).toBe("ok");
    expect(lookupMock).toHaveBeenCalledTimes(1);
    const [category, input, tier, balance, orgId, opts] = lookupMock.mock.calls[0];
    expect(category).toBe("comps");
    expect(input).toEqual({ type: "coordinates", latitude: SUBJECT.latitude, longitude: SUBJECT.longitude });
    expect(tier).toBe("pro"); // ATTOM's registration tier — access is key+metering-governed
    expect(balance).toBe(100);
    expect(orgId).toBe(42);
    expect(opts).toEqual({ allowProviders: RESIDENTIAL_CAPABLE_PROVIDERS });
    expect(RESIDENTIAL_CAPABLE_PROVIDERS).toEqual(["attom"]);
  });

  it("valuation uses the valuation category with the same restriction", async () => {
    platformKeyed = true;
    balanceCents = 100;
    lookupMock.mockResolvedValue({ ...OK_RESULT, category: "valuation" });

    const outcome = await getResidentialValuation(42, SUBJECT);
    expect(outcome.status).toBe("ok");
    expect(lookupMock.mock.calls[0][0]).toBe("valuation");
    expect(lookupMock.mock.calls[0][5]).toEqual({ allowProviders: ["attom"] });
  });

  it("address subjects map to the address LookupInput", async () => {
    platformKeyed = true;
    balanceCents = 100;
    lookupMock.mockResolvedValue({ ...OK_RESULT });

    await getResidentialComps(42, {
      kind: "address",
      street: "123 Main St",
      city: "Phoenix",
      state: "AZ",
      zip: "85001",
    });
    expect(lookupMock.mock.calls[0][1]).toEqual({
      type: "address",
      street: "123 Main St",
      city: "Phoenix",
      state: "AZ",
      zip: "85001",
    });
  });

  it("BYOK ('attom' channel) works without a platform key and bypasses the balance gate", async () => {
    connectedProviders = new Set(["attom"]);
    platformKeyed = false;
    balanceCents = 0; // empty pool — BYOK lookups are free to the platform
    lookupMock.mockResolvedValue({ ...OK_RESULT });

    const outcome = await getResidentialComps(42, SUBJECT);
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") throw new Error("unreachable");
    expect(outcome.byok).toBe(true);
    expect(getBalanceMock).not.toHaveBeenCalled(); // no pool gate on BYOK
    expect(lookupMock).toHaveBeenCalledTimes(1);
  });

  it("platform-billed with an empty pool → honest insufficient-credits refusal, registry never called", async () => {
    platformKeyed = true;
    balanceCents = 5; // < 20¢ comps cost
    const outcome = await getResidentialComps(42, SUBJECT);
    expect(outcome.status).toBe("unavailable");
    if (outcome.status !== "unavailable") throw new Error("unreachable");
    expect(outcome.reason).toBe("insufficient_credits");
    expect(outcome.message).toContain("20¢");
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("registry null (provider failed / circuit open) → honest no_data, never a fabricated result", async () => {
    platformKeyed = true;
    balanceCents = 100;
    lookupMock.mockResolvedValue(null);
    const outcome = await getResidentialComps(42, SUBJECT);
    expect(outcome.status).toBe("no_data");
    if (outcome.status !== "no_data") throw new Error("unreachable");
    expect(outcome.message).toContain("no residential comparables");
  });
});

describe("RESIDENTIAL_BUSINESS_TYPES — the explicit data-plane fork set", () => {
  // 2026-07-30: residential_wholesaler joined the set. The original
  // assertion pinned the narrower wave-V3 scope ("exactly the sanctioned
  // set"); the invariant it was protecting was never that literal list, it
  // was EVERY VERTICAL WHOSE SUBJECT PROPERTY IS A HOUSE ROUTES RESIDENTIAL.
  // Rewritten to that, so the pin survives the widening instead of being
  // deleted by it.
  const HOUSE_SUBJECT_VERTICALS = [
    "fix_and_flip",           // buy distressed houses, renovate, resell
    "residential_wholesaler", // assign house contracts to investor buyers
    "buy_and_hold",           // long-term residential rentals
    "short_term_rental",      // furnished house/unit nightly rentals
    "multifamily",            // units
    "mobile_home",            // homes / park lots
    "agent_investor",         // licensed agent — subject is residential (MLS/CMA)
  ] as const;

  it("contains every house-subject vertical, and nothing else", () => {
    expect([...RESIDENTIAL_BUSINESS_TYPES].sort()).toEqual(
      [...HOUSE_SUBJECT_VERTICALS].sort(),
    );
  });

  it("residential_wholesaler is residential (the 2026-07-11 defect, re-fixed 2026-07-30)", () => {
    // A wholesaler values HOUSES. Before this entry existed the vertical fell
    // through both comps chokepoints to Regrid land-parcel comps and the land
    // AVM — the exact defect that demoted fix_and_flip.
    expect(isResidentialBusinessType("residential_wholesaler")).toBe(true);
    expect(RESIDENTIAL_BUSINESS_TYPES.has("residential_wholesaler")).toBe(true);
  });

  it("agent_investor is residential (2026-08 founder decision — a licensed agent's subject is residential: MLS/CMA)", () => {
    // The founder reversed the earlier "agent_investor is a land, not-
    // residential persona" ruling: a licensed agent works over residential
    // real estate, so its comps/valuation route through the ATTOM residential
    // seam (Comparative Market Analysis), NOT the land parcel plane. This is
    // the comps-fork switch only — agent_investor's investorType stays "land".
    expect(isResidentialBusinessType("agent_investor")).toBe(true);
    expect(RESIDENTIAL_BUSINESS_TYPES.has("agent_investor")).toBe(true);
  });

  it("every member is a real businessType", () => {
    for (const bt of RESIDENTIAL_BUSINESS_TYPES) {
      expect(BUSINESS_TYPES).toContain(bt);
    }
  });

  it("land / notes / commercial verticals are NOT residential-routed", () => {
    // These verticals' subject property is raw land, a note, or commercial
    // real estate — the land/parcel data plane is the RIGHT source for them,
    // so they must keep the land fork. (agent_investor moved OUT of this list
    // on the 2026-08 founder decision — a licensed agent's subject is
    // residential; see the positive assertion above.)
    for (const bt of ["land_flipper", "note_investor", "hybrid", "commercial", "subdivider", "developer", "tax_lien_deed", "creative_finance"]) {
      expect(isResidentialBusinessType(bt), bt).toBe(false);
    }
  });

  it("isResidentialBusinessType guards unknown input", () => {
    expect(isResidentialBusinessType("fix_and_flip")).toBe(true);
    expect(isResidentialBusinessType("buy_and_hold")).toBe(true);
    expect(isResidentialBusinessType("residential_wholesaler")).toBe(true);
    expect(isResidentialBusinessType("garbage")).toBe(false);
    expect(isResidentialBusinessType(null)).toBe(false);
    expect(isResidentialBusinessType(undefined)).toBe(false);
  });
});

describe("getOrgBusinessType — the org read the consumer forks key on", () => {
  it("reads organizations.onboardingData.businessType", async () => {
    orgRows = [{ onboardingData: { businessType: "fix_and_flip" } }];
    expect(await getOrgBusinessType(42)).toBe("fix_and_flip");
  });

  it("returns null when unset (never guesses)", async () => {
    orgRows = [{ onboardingData: {} }];
    expect(await getOrgBusinessType(42)).toBeNull();
    orgRows = [];
    expect(await getOrgBusinessType(42)).toBeNull();
  });
});

describe("defensive ATTOM extraction — absent fields stay null, nothing invented", () => {
  it("parses the propertyapi `property` array shape", () => {
    const comps = extractResidentialComps({
      property: [
        {
          address: { oneLine: "456 Oak Ave, Phoenix, AZ 85001", locality: "Phoenix", countrySubd: "AZ" },
          sale: { amount: { saleAmt: 350000 }, salesearchdate: "2026-03-15" },
          building: { rooms: { beds: 3, bathsFull: 2 }, size: { livingSize: 1850 } },
          lot: { lotSize1: 0.18 },
          location: { latitude: "33.45", longitude: "-112.07", distance: 0.4 },
          summary: { propType: "SFR" },
        },
        // A husk with neither address nor sale price must be dropped.
        { building: { rooms: {} } },
      ],
    });
    expect(comps).toHaveLength(1);
    expect(comps[0]).toEqual({
      address: "456 Oak Ave, Phoenix, AZ 85001",
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
    });
  });

  it("returns [] for shapes it cannot verify (no property array)", () => {
    expect(extractResidentialComps(null)).toEqual([]);
    expect(extractResidentialComps({})).toEqual([]);
    expect(extractResidentialComps({ RESPONSE: { anything: true } })).toEqual([]);
  });

  it("AVM: parses value/band/score; null when no usable value", () => {
    const avm = extractResidentialAvm({
      property: [{ avm: { eventDate: "2026-07-01", amount: { value: 412000, low: 390000, high: 431000, scr: 88 } } }],
    });
    expect(avm).toEqual({ value: 412000, low: 390000, high: 431000, score: 88, asOf: "2026-07-01" });

    expect(extractResidentialAvm({ property: [{ avm: { amount: {} } }] })).toBeNull();
    expect(extractResidentialAvm({ property: [{ avm: { amount: { value: 0 } } }] })).toBeNull();
    expect(extractResidentialAvm(null)).toBeNull();
  });
});
