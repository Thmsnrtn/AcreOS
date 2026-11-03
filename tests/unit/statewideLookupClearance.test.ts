/**
 * Founder decision 2026-11-03: a seeded statewide parcel source may answer a
 * live point lookup ONLY when its register state is cleared for lookup
 * (statewideSourceRegistry.ts LOOKUP_CLEARANCE, mirroring dossier register
 * §8.4). Until then it is gated and behaves exactly as if it were not seeded.
 *
 * What this pins, each against the behaviour it replaced (the nine rows were
 * queried before Regrid with no clearance check, owner names included):
 *  (a) an unresolved state's source serves nothing. No request reaches its
 *      host, and the lookup falls through to the next source or to Regrid.
 *      Driven through every production entry point: lookupParcelByCoordinates,
 *      the county-GIS provider's coordinate lookup, the statewide point
 *      function itself, and the APN path's statewide-row match;
 *  (b) flipping a registry entry to cleared restores that source's results.
 *      This also proves each test point really lies inside its state's
 *      coverage, so (a) is not green for want of a candidate;
 *  (c) the ratchet: every seeded statewide row has an explicit clearance
 *      entry; the cleared set is pinned; a
 *      row with no entry is gated at runtime; and every server file that can
 *      reach the statewide rows is on a reviewed list, so a new reader cannot
 *      bypass the gate unnoticed.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { stripComments } from "../helpers/stripComments";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

const h = vi.hoisted(() => ({
  fetches: [] as string[],
  endpointRows: [] as Array<Record<string, unknown>>,
  /** state → clearance override; absent = the real registry entry. */
  overrides: new Map<string, "cleared" | "missing">(),
}));

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/services/providers/fetchGeo", () => ({
  fetchGeo: async (url: string) => {
    h.fetches.push(url);
    const body = url.includes("app.regrid.com")
      ? { results: [{ geometry: { type: "Polygon", coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]] }, properties: { fields: { parcelnumb: "R-1", owner: "REGRID OWNER", lat: 1, lon: 1 } } }] }
      : { features: [{ attributes: { STATE_HOST_FEATURE: url.split("/")[2] }, geometry: { rings: [[[0, 0], [0, 1], [1, 1], [0, 0]]] } }] };
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
vi.mock("../../server/services/coverageLedger", () => ({ enqueueCountyForDiscovery: async () => undefined }));
vi.mock("../../server/services/landData/countyPipeline", () => ({ enqueueCountyProcessing: async () => undefined }));
// The registry stays REAL; a test may override one state's entry, exactly the
// code change a future clearance makes.
vi.mock("../../server/services/openData/statewideSourceRegistry", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../server/services/openData/statewideSourceRegistry")>();
  return {
    ...real,
    statewideSource: (state: string) => {
      const o = h.overrides.get(state.toUpperCase());
      const entry = real.statewideSource(state);
      if (o === "missing") return undefined;
      if (o === "cleared" && entry) {
        return {
          ...entry,
          lookup: {
            status: "cleared" as const,
            determination: "TEST FIXTURE — founder/counsel lookup determination",
            evidence: "TEST FIXTURE — the deciding words, quoted",
            evidenceUrl: "https://example.test/terms",
            decidedOn: "2026-11-03",
          },
        };
      }
      return entry;
    },
  };
});

// (c) walks every server file — a repo-wide sweep needs its declared budget.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

import { lookupFromCountyGIS, lookupFromCountyGISByPoint, lookupParcelByCoordinates } from "../../server/services/parcel";
import { countyGisProvider } from "../../server/services/providers/county-gis-provider";
import { STATEWIDE_PARCEL_ENDPOINTS, STATEWIDE_COUNTY } from "../../server/services/statewideParcelEndpoints";
import {
  isClearedForLookup,
  statewideSource,
  type StatewideSourceEntry,
} from "../../server/services/openData/statewideSourceRegistry";

/**
 * The states cleared for live point lookup. Register §8.4 (2026-11-03): NONE.
 * Clearing a state is a reviewed code change. Change its LOOKUP_CLEARANCE entry
 * to "cleared" with evidence, AND add it here.
 */
const CLEARED_FOR_LOOKUP: string[] = [];

/** A point inside each seeded state (its capital). */
const POINT: Record<string, { lat: number; lng: number }> = {
  FL: { lat: 30.44, lng: -84.28 },
  MT: { lat: 46.59, lng: -112.02 },
  NC: { lat: 35.78, lng: -78.64 },
  WA: { lat: 47.04, lng: -122.9 },
  NJ: { lat: 40.22, lng: -74.76 },
  AR: { lat: 34.75, lng: -92.29 },
  NY: { lat: 42.65, lng: -73.76 },
  WI: { lat: 43.07, lng: -89.38 },
  MD: { lat: 38.98, lng: -76.49 },
};

const host = (url: string) => new URL(url).host;
const rowFor = (state: string, id = 1) => {
  const seed = STATEWIDE_PARCEL_ENDPOINTS.find((e) => e.state === state)!;
  return { id, ...seed, isActive: true, isVerified: true, errorCount: 0, additionalParams: null };
};
/** Did any request go to this state's seeded service? */
const touched = (state: string) => {
  const base = STATEWIDE_PARCEL_ENDPOINTS.find((e) => e.state === state)!.baseUrl.replace(/\/$/, "");
  return h.fetches.some((u) => u.startsWith(base));
};

beforeEach(() => {
  h.fetches = [];
  h.endpointRows = [];
  h.overrides.clear();
  const prev = process.env.REGRID_API_KEY;
  process.env.REGRID_API_KEY = "platform-key";
  return () => {
    if (prev === undefined) delete process.env.REGRID_API_KEY;
    else process.env.REGRID_API_KEY = prev;
  };
});

describe("(a) an unresolved state's source serves nothing — the lookup falls through", () => {
  it.each(STATEWIDE_PARCEL_ENDPOINTS.map((e) => e.state))("%s: the statewide point lookup makes no request and returns null", async (state) => {
    h.endpointRows = [rowFor(state)];
    const p = POINT[state];
    expect(p, `test point for ${state}`).toBeDefined();
    const r = await lookupFromCountyGISByPoint(p.lat, p.lng);
    expect(r).toBeNull();
    expect(touched(state)).toBe(false);
    expect(h.fetches).toEqual([]);
  });

  it("lookupParcelByCoordinates (drive mode, field scout, deals, properties): Regrid answers, the FL service is never asked", async () => {
    h.endpointRows = [rowFor("FL")];
    const r = await lookupParcelByCoordinates(POINT.FL.lat, POINT.FL.lng, { organizationId: 7 });
    expect(r.found).toBe(true);
    expect(r.source).toBe("regrid");
    expect(touched("FL")).toBe(false);
    expect(h.fetches.every((u) => u.includes("app.regrid.com"))).toBe(true);
  });

  it("with no Regrid licence the result is what an unseeded state gets: not found, nothing invented", async () => {
    delete process.env.REGRID_API_KEY;
    h.endpointRows = [rowFor("FL")];
    const gated = await lookupParcelByCoordinates(POINT.FL.lat, POINT.FL.lng);
    h.endpointRows = [];
    const unseeded = await lookupParcelByCoordinates(POINT.FL.lat, POINT.FL.lng);
    expect(gated).toEqual(unseeded);
    expect(gated.found).toBe(false);
    expect(h.fetches).toEqual([]);
  });

  it("the county-GIS provider's coordinate lookup throws its no-match, so the registry tries the next provider", async () => {
    h.endpointRows = [rowFor("NC")];
    await expect(
      countyGisProvider.lookup("owner_info", { type: "coordinates", latitude: POINT.NC.lat, longitude: POINT.NC.lng }),
    ).rejects.toThrow(/no statewide GIS match/);
    expect(touched("NC")).toBe(false);
  });

  it("fallthrough to the NEXT source: a gated NJ row is skipped and an overlapping cleared NY row answers", async () => {
    // Lower Manhattan sits in both the NJ and NY candidate boxes.
    h.endpointRows = [rowFor("NJ", 1), rowFor("NY", 2)];
    h.overrides.set("NY", "cleared");
    const r = await lookupFromCountyGISByPoint(40.71, -74.0);
    expect(r?.found).toBe(true);
    expect(touched("NJ")).toBe(false);
    expect(touched("NY")).toBe(true);
  });

  it("the APN path cannot reach a gated statewide row either (county \"*\")", async () => {
    h.endpointRows = [rowFor("WI")];
    const r = await lookupFromCountyGIS("123", "WI", STATEWIDE_COUNTY);
    expect(r).toBeNull();
    expect(touched("WI")).toBe(false);
  });

  it("per-county rows are not statewide sources and are untouched by the gate", async () => {
    h.endpointRows = [{ id: 3, state: "FL", county: "Leon", isActive: true, endpointType: "arcgis_rest", baseUrl: "https://gis.leon.example/rest/services/Parcels/MapServer", layerId: "0", apnField: "APN", fieldMappings: {}, errorCount: 0 }];
    const r = await lookupFromCountyGIS("123", "FL", "Leon");
    expect(r?.found).toBe(true);
    expect(h.fetches.some((u) => host(u) === "gis.leon.example")).toBe(true);
  });
});

describe("(b) flipping a registry entry to cleared restores that source's results", () => {
  it.each(STATEWIDE_PARCEL_ENDPOINTS.map((e) => e.state))("%s cleared: the point lookup queries its service and answers", async (state) => {
    h.endpointRows = [rowFor(state)];
    h.overrides.set(state, "cleared");
    const r = await lookupFromCountyGISByPoint(POINT[state].lat, POINT[state].lng);
    expect(r?.found).toBe(true);
    expect(r?.source).toBe("county_gis");
    expect(touched(state)).toBe(true);
  });

  it("cleared FL: lookupParcelByCoordinates answers from the free service before Regrid, as before the gate", async () => {
    h.endpointRows = [rowFor("FL")];
    h.overrides.set("FL", "cleared");
    const r = await lookupParcelByCoordinates(POINT.FL.lat, POINT.FL.lng, { organizationId: 7 });
    expect(r.source).toBe("county_gis");
    expect(h.fetches.some((u) => u.includes("app.regrid.com"))).toBe(false);
  });

  it("cleared: the APN path's statewide-row match is restored too", async () => {
    h.endpointRows = [rowFor("WI")];
    h.overrides.set("WI", "cleared");
    const r = await lookupFromCountyGIS("123", "WI", STATEWIDE_COUNTY);
    expect(r?.found).toBe(true);
    expect(touched("WI")).toBe(true);
  });

  it("\"cleared\" counts only with every evidence field filled", () => {
    const base = statewideSource("FL")!;
    const full = { status: "cleared" as const, determination: "d", evidence: "e", evidenceUrl: "https://x.test", decidedOn: "2026-11-03" };
    const with_ = (lookup: StatewideSourceEntry["lookup"]): StatewideSourceEntry => ({ ...base, lookup });
    expect(isClearedForLookup(with_(full))).toBe(true);
    for (const field of ["determination", "evidence", "evidenceUrl", "decidedOn"] as const) {
      expect(isClearedForLookup(with_({ ...full, [field]: "  " })), `blank ${field}`).toBe(false);
    }
    expect(isClearedForLookup(with_({ status: "gated", registerState: "x" }))).toBe(false);
    expect(isClearedForLookup(undefined)).toBe(false);
  });
});

describe("(c) ratchet — the gate cannot be bypassed by future seeding", () => {
  it("every seeded statewide row has an EXPLICIT lookup-clearance entry (not the fail-closed fallback)", () => {
    const seeded = STATEWIDE_PARCEL_ENDPOINTS.map((e) => e.state);
    expect(seeded.length).toBeGreaterThanOrEqual(9); // vacuity floor: the population this reads
    for (const s of seeded) {
      const lookup = statewideSource(s)!.lookup;
      // An explicit entry is either cleared on evidence or gated with its §8.4
      // register state. The fail-closed fallback carries neither.
      const explicit = lookup.status === "cleared" || /§8\.4/.test(lookup.registerState);
      expect(explicit, `${s} has no LOOKUP_CLEARANCE entry`).toBe(true);
    }
  });

  it("the cleared set is pinned: register §8.4 clears no state today", () => {
    const cleared = STATEWIDE_PARCEL_ENDPOINTS.map((e) => e.state).filter((s) => isClearedForLookup(statewideSource(s))).sort();
    expect(cleared).toEqual([...CLEARED_FOR_LOOKUP].sort());
    for (const ep of STATEWIDE_PARCEL_ENDPOINTS) {
      const c = statewideSource(ep.state)!.lookup;
      if (c.status === "gated") expect(c.registerState, ep.state).toMatch(/§8\.4/);
    }
  });

  it("a statewide row with no registry entry (seeded in the DB, or a seed with no entry) is gated at runtime", async () => {
    h.endpointRows = [rowFor("MD")];
    h.overrides.set("MD", "missing");
    expect(await lookupFromCountyGISByPoint(POINT.MD.lat, POINT.MD.lng)).toBeNull();
    expect(h.fetches).toEqual([]);
  });

  /**
   * Population: every server file that can reach the statewide rows, with
   * why it may. A new file naming the seeds, the "*" sentinel, or querying
   * county = "*" fails here until it is reviewed against the gate.
   */
  const STATEWIDE_READERS: Record<string, string> = {
    "server/services/statewideParcelEndpoints.ts": "the seed definitions (pure; no I/O)",
    "server/services/parcel.ts": "the lookup path — seeds the rows and applies statewideRowMayServe on the point AND APN paths",
    "server/services/openData/statewideSourceRegistry.ts": "the registry itself (dossiers + lookup clearance)",
    "server/services/landData/statewideCadastral.ts": "BULK ingest — governed by ingestGate/dossier, out of point-lookup scope",
    "server/services/openData/statewideLayerPoller.ts": "metadata / count poll only — returns no parcel attributes",
    "server/routes-land-data.ts": "lists program metadata (state, host, attribution) — no parcel attributes",
    "server/services/landData/countyPipeline.ts": "BULK county ingest — refuses a statewide row without a verified county field (TN only, URL-blocked); out of point-lookup scope",
    "server/routes-permit-tracker.ts": "false positive: a permit-template wildcard (state/county \"*\"), not a parcel source",
  };
  const READS_STATEWIDE = [
    /\bSTATEWIDE_PARCEL_ENDPOINTS\b/,
    /\bSTATEWIDE_COUNTY\b/,
    /statewideParcelEndpoints["']/,
    /countyGisEndpoints\.county\s*,\s*["'`]\*["'`]/,
    /county\s*[:=]{1,3}\s*["'`]\*["'`]/,
  ];
  const ROOT = resolve(__dirname, "../..");
  const serverFiles = (readdirSync(join(ROOT, "server"), { recursive: true }) as string[])
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => relative(ROOT, join(ROOT, "server", f)).split("\\").join("/"));

  it("every server reader of the statewide rows is on the reviewed list", () => {
    expect(serverFiles.length).toBeGreaterThan(500); // vacuity floor: the walk read the tree
    const readers = serverFiles
      .filter((f) => {
        const src = stripComments(readFileSync(join(ROOT, f), "utf8"));
        return READS_STATEWIDE.some((re) => re.test(src));
      })
      .sort();
    expect(readers).toEqual(Object.keys(STATEWIDE_READERS).sort());
  });

  it("the gate is applied by parcel.ts on both lookup paths (per-member vacuity)", () => {
    const src = stripComments(readFileSync(join(ROOT, "server/services/parcel.ts"), "utf8"));
    expect(src.match(/statewideRowMayServe\(/g)?.length ?? 0).toBeGreaterThanOrEqual(3); // definition + point + APN
  });
});
