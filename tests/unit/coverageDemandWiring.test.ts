/**
 * P1-7 / A-2 — gate-refusal demand wiring.
 *
 * What this pins:
 *  1. The shared taxonomy (shared/coverageDemand.ts): the terminal-refusal
 *     precedence — a configured Regrid key means the paid source ran, so the
 *     terminal reason is a distinguishable `not_found`; without a key, the
 *     county layer's own refusal (gated / no_endpoint) is the reason; with
 *     neither, `no_key`. An affordance is eligible for every refusal EXCEPT
 *     a terminal not-found.
 *  2. The county layer names its refusal WITHOUT changing its contract:
 *     lookupFromCountyGIS still returns null on every miss (the gate's own
 *     suite pins that null) — the reason arrives via the opt-in out-param,
 *     the demand enqueue carries the reason, and NO request reaches a gated
 *     statewide host (the gate is named, never loosened).
 *  3. The terminal APN refusal carries refusalReason + the request
 *     affordance, and — the refusal-path invariance — stripping those two
 *     additive fields reproduces the EXACT pre-P1-7 result: requesting a
 *     county can never change a lookup outcome. The terminal COORDINATE
 *     refusal is the bounded exception: the P1-6 clearance pin requires a
 *     gated point lookup to be indistinguishable from an unseeded one, so
 *     the point path carries only the Regrid-derived reason (no_key /
 *     not_found) and NO affordance — the gate is named only for a
 *     geography the caller specified, never one inferred from coordinates.
 *  4. The passport refusal (pure; it emits nothing) carries the same fields
 *     with its reason text byte-identical.
 *
 * Harness mirrors tests/unit/statewideLookupClearance.test.ts (same mocks,
 * plus an enqueue capture so the demand side-effect is observable).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  fetches: [] as string[],
  endpointRows: [] as Array<Record<string, unknown>>,
  enqueues: [] as Array<{ state: string; county: string; opts: unknown }>,
}));

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/services/providers/fetchGeo", () => ({
  fetchGeo: async (url: string) => {
    h.fetches.push(url);
    const body = new URL(url).host === "app.regrid.com"
      ? { results: [] }
      : { features: [{ attributes: { APN: "123" }, geometry: { rings: [[[0, 0], [0, 1], [1, 1], [0, 0]]] } }] };
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  },
}));
vi.mock("../../server/services/providers/resolveProviderCredential", () => ({ resolveProviderCredential: async () => null }));
vi.mock("../../server/storage", () => ({
  storage: { getParcelSnapshot: async () => undefined, upsertParcelSnapshot: async (r: unknown) => r, getOrganizationIntegration: async () => null, logApiUsage: async () => undefined },
}));
vi.mock("../../server/services/residentialComps", () => ({ getOrgBusinessType: async () => "land_flipper" }));
vi.mock("../../server/db", () => {
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.where = () => chain;
  chain.limit = () => chain;
  chain.then = (f: (v: unknown) => unknown, r?: (e: unknown) => unknown) => Promise.resolve(h.endpointRows).then(f, r);
  const update = () => ({ set: () => ({ where: async () => [] }) });
  return { db: { select: () => chain, update } };
});
vi.mock("../../server/services/data-cache/observation-log", () => ({ recordProviderParcelFacts: async () => undefined, coerceSaleDate: () => null }));
vi.mock("../../server/services/providerIntelligence", () => ({ recordLookup: async () => undefined }));
vi.mock("../../server/services/coverageLedger", () => ({
  enqueueCountyForDiscovery: async (state: string, county: string, opts?: unknown) => {
    h.enqueues.push({ state, county, opts });
    return { queued: true, bumped: false, alreadyCovered: false, queueId: 1, status: "pending", demandCount: 1 };
  },
  normalizeState: (s: string) => s.trim().toUpperCase(),
  normalizeCounty: (c: string) => c.toLowerCase().replace(/ county$/i, "").trim(),
}));
vi.mock("../../server/services/landData/countyPipeline", () => ({ enqueueCountyProcessing: async () => undefined }));

import {
  lookupFromCountyGIS,
  lookupParcelByAPN,
  lookupParcelByCoordinates,
  type CountyGisMissInfo,
} from "../../server/services/parcel";
import { STATEWIDE_PARCEL_ENDPOINTS } from "../../server/services/statewideParcelEndpoints";
import { assemblePropertyPassport } from "../../server/services/landData/propertyPassport";
import { statewideSource } from "../../server/services/openData/statewideSourceRegistry";
import {
  COVERAGE_DEMAND_SURFACES,
  COVERAGE_REFUSAL_REASONS,
  coverageDemandAffordance,
  refusalAffordanceEligible,
  terminalRefusalReason,
} from "@shared/coverageDemand";

const REGRID_NOT_CONFIGURED = "Regrid API key not configured. Please add REGRID_API_KEY to secrets.";

const rowFor = (state: string, id = 1) => {
  const seed = STATEWIDE_PARCEL_ENDPOINTS.find((e) => e.state === state)!;
  return { id, ...seed, isActive: true, isVerified: true, errorCount: 0, additionalParams: null };
};
const touched = (state: string) => {
  const base = STATEWIDE_PARCEL_ENDPOINTS.find((e) => e.state === state)!.baseUrl.replace(/\/$/, "");
  return h.fetches.some((u) => u.startsWith(base));
};
const flush = async () => {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
};

beforeEach(() => {
  h.fetches = [];
  h.endpointRows = [];
  h.enqueues = [];
  delete process.env.REGRID_API_KEY;
});

describe("shared taxonomy — terminal refusal precedence", () => {
  it("the vocabularies are closed and self-consistent", () => {
    expect(COVERAGE_REFUSAL_REASONS).toEqual(["gated", "no_endpoint", "no_key", "not_found"]);
    expect(COVERAGE_DEMAND_SURFACES).toEqual(["maps", "parcel_lookup", "pax", "passport", "drive_mode", "property", "other"]);
    expect(new Set(COVERAGE_REFUSAL_REASONS).size).toBe(COVERAGE_REFUSAL_REASONS.length);
    expect(new Set(COVERAGE_DEMAND_SURFACES).size).toBe(COVERAGE_DEMAND_SURFACES.length);
  });

  it("a configured key means the paid source ran → terminal not_found, whatever the county layer said", () => {
    expect(terminalRefusalReason({ countyLayerReason: "gated", regridKeyPresent: true })).toBe("not_found");
    expect(terminalRefusalReason({ countyLayerReason: "no_endpoint", regridKeyPresent: true })).toBe("not_found");
    expect(terminalRefusalReason({ countyLayerReason: null, regridKeyPresent: true })).toBe("not_found");
  });

  it("without a key, the county layer's refusal is the terminal reason", () => {
    expect(terminalRefusalReason({ countyLayerReason: "gated", regridKeyPresent: false })).toBe("gated");
    expect(terminalRefusalReason({ countyLayerReason: "no_endpoint", regridKeyPresent: false })).toBe("no_endpoint");
    expect(terminalRefusalReason({ countyLayerReason: null, regridKeyPresent: false })).toBe("no_key");
  });

  it("an affordance is eligible for every refusal except a terminal not-found", () => {
    expect(refusalAffordanceEligible("gated")).toBe(true);
    expect(refusalAffordanceEligible("no_endpoint")).toBe(true);
    expect(refusalAffordanceEligible("no_key")).toBe(true);
    expect(refusalAffordanceEligible("not_found")).toBe(false);
  });

  it("the affordance points at the one request endpoint and normalizes state", () => {
    expect(coverageDemandAffordance({ state: "wi", county: "dane", reason: "gated", surface: "pax" })).toEqual({
      state: "WI",
      county: "dane",
      reason: "gated",
      surface: "pax",
      endpoint: "/api/county-coverage/request",
    });
    expect(coverageDemandAffordance({ state: "FL", reason: "gated", surface: "parcel_lookup" }).county).toBeNull();
  });
});

describe("county layer — the refusal is named, the contract is unchanged, the gate is not loosened", () => {
  it("gated statewide row: still null, still zero requests to the host, reason + enqueue say 'gated'", async () => {
    h.endpointRows = [rowFor("WI")];
    const miss: CountyGisMissInfo = {};
    const r = await lookupFromCountyGIS("123", "WI", "dane", miss);
    expect(r).toBeNull();
    expect(miss.refusalReason).toBe("gated");
    expect(touched("WI")).toBe(false);
    await flush();
    expect(h.enqueues).toHaveLength(1);
    expect(h.enqueues[0]).toMatchObject({ state: "WI", county: "dane", opts: { refusalReason: "gated" } });
  });

  it("no endpoint at all: reason + enqueue say 'no_endpoint'", async () => {
    h.endpointRows = [];
    const miss: CountyGisMissInfo = {};
    const r = await lookupFromCountyGIS("123", "FL", "Leon", miss);
    expect(r).toBeNull();
    expect(miss.refusalReason).toBe("no_endpoint");
    await flush();
    expect(h.enqueues[0]).toMatchObject({ opts: { refusalReason: "no_endpoint" } });
  });

  it("a caller that passes no out-param gets the identical null it always got", async () => {
    h.endpointRows = [rowFor("WI")];
    expect(await lookupFromCountyGIS("123", "WI", "dane")).toBeNull();
  });
});

describe("terminal APN refusal — named, afforded, and outcome-invariant", () => {
  it("gated state, no key: reason 'gated', affordance for the asked county, error string untouched", async () => {
    h.endpointRows = [rowFor("WI")];
    const r = await lookupParcelByAPN("123", "/us/wi/dane");
    expect(r.found).toBe(false);
    expect(r.error).toBe(REGRID_NOT_CONFIGURED);
    expect(r.refusalReason).toBe("gated");
    expect(r.demand).toEqual({
      state: "WI",
      county: "dane",
      reason: "gated",
      surface: "parcel_lookup",
      endpoint: "/api/county-coverage/request",
    });
    // Invariance: strip the two additive fields → the pre-P1-7 result, exactly.
    const { refusalReason: _r, demand: _d, ...stripped } = r;
    expect(stripped).toEqual({ found: false, error: REGRID_NOT_CONFIGURED });
  });

  it("no endpoint, no key: reason 'no_endpoint' with an affordance", async () => {
    h.endpointRows = [];
    const r = await lookupParcelByAPN("123", "/us/fl/leon");
    expect(r.refusalReason).toBe("no_endpoint");
    expect(r.demand).toMatchObject({ state: "FL", county: "leon", reason: "no_endpoint" });
    const { refusalReason: _r, demand: _d, ...stripped } = r;
    expect(stripped).toEqual({ found: false, error: REGRID_NOT_CONFIGURED });
  });

  it("with a key, a Regrid miss is a distinguishable terminal not_found — no affordance, same error", async () => {
    process.env.REGRID_API_KEY = "test-key";
    h.endpointRows = [rowFor("WI")];
    const r = await lookupParcelByAPN("123", "/us/wi/dane");
    expect(r.found).toBe(false);
    expect(r.error).toBe("Parcel not found for APN: 123");
    expect(r.refusalReason).toBe("not_found");
    expect(r.demand).toBeUndefined();
  });
});

describe("terminal coordinate refusal — the point path never leaks the gate (P1-6 clearance pin governs)", () => {
  it("gated FL point, no key: reason 'no_key', NO affordance, result identical to an unseeded point", async () => {
    h.endpointRows = [rowFor("FL")];
    const r = await lookupParcelByCoordinates(30.44, -84.28);
    expect(r.found).toBe(false);
    expect(r.error).toBe(REGRID_NOT_CONFIGURED);
    // The gate may be named only for a geography the CALLER specified
    // (APN path, passport, Pax). A coordinate lookup's geography is
    // system-inferred, and the statewide clearance pin requires a gated
    // point lookup to be indistinguishable from an unseeded one — so the
    // terminal reason comes from the Regrid outcome alone and no demand
    // affordance rides on a point result.
    expect(r.refusalReason).toBe("no_key");
    expect(r.demand).toBeUndefined();
    expect(touched("FL")).toBe(false);
    h.endpointRows = [];
    const unseeded = await lookupParcelByCoordinates(30.44, -84.28);
    expect(r).toEqual(unseeded);
    const { refusalReason: _r, ...stripped } = r;
    expect(stripped).toEqual({ found: false, error: REGRID_NOT_CONFIGURED });
  });
});

describe("passport refusal — same naming, reason text byte-identical, nothing emitted", () => {
  it("a gated entry's refusal carries refusalReason 'gated' + the passport affordance", () => {
    const entry = statewideSource("FL");
    expect(entry?.lookup.status).toBe("gated");
    const result = assemblePropertyPassport(
      { apid: "FL-001", parcelKey: "FL:Leon:1", state: "FL", county: "Leon", sourceParcelId: "APN-1" },
      entry,
      { physical: null, legalDistress: null, contextTrajectory: null },
    );
    expect(result.status).toBe("refused");
    if (result.status !== "refused") return;
    // The pre-P1-7 reason text, byte for byte.
    expect(result.reason).toBe(
      "The statewide source for FL is not cleared for lookup; its licence review is recorded on the register, and a source the register does not clear serves nothing.",
    );
    expect(result.refusalReason).toBe("gated");
    expect(result.demand).toEqual({
      state: "FL",
      county: "Leon",
      reason: "gated",
      surface: "passport",
      endpoint: "/api/county-coverage/request",
    });
  });

  it("no register entry at all refuses the same named way", () => {
    const result = assemblePropertyPassport(
      { apid: "XX-001", parcelKey: "XX:Nowhere:1", state: "XX", county: "Nowhere", sourceParcelId: "APN-1" },
      undefined,
      { physical: null, legalDistress: null, contextTrajectory: null },
    );
    expect(result.status).toBe("refused");
    if (result.status !== "refused") return;
    expect(result.refusalReason).toBe("gated");
    expect(result.demand).toMatchObject({ state: "XX", county: "Nowhere", surface: "passport" });
  });
});
