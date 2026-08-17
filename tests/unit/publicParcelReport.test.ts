/**
 * Tier 3A — public parcel report engine (server/services/publicParcelReport.ts).
 *
 * Proves the structural guarantees, not just behavior:
 *  1. FREE DATA ONLY — every resolveParcel call from the public path is
 *     pinned to maxTier:"free" with no org/credit context, AND a registry-
 *     level test shows a paid provider's lookup is never invoked at tier
 *     "free" (the tier filter is the guarantee, not convention).
 *  2. HONEST PARTIAL LCS — locked dimensions never carry a score value;
 *     indeterminate inputs (flood zone D, broker soil default) stay null.
 *  3. PERMALINK IDEMPOTENCY — same parcel in different spellings → one
 *     identity; a fresh row short-circuits before any upstream work.
 *  4. COST GUARDS — daily hard cap refuses new generation (stale rows still
 *     serve) and the spike alert fires through the alert spine.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const state = {
    /** Rows returned for the report-identity SELECT (no select args). */
    reportRows: [] as any[],
    /** UTC-day generation count. */
    todayCount: 0,
    /** county_gis_endpoints rows (select args include `county`). */
    gisRows: [] as any[],
    /** sitemap select rows (select args include `state`). */
    sitemapRows: [] as any[],
    insertCalls: [] as any[],
  };

  function rowsFor(selectArgs: any[]): any[] {
    if (selectArgs.length === 0) return state.reportRows;
    const shape = selectArgs[0] ?? {};
    if ("n" in shape) return [{ n: state.todayCount }];
    if ("county" in shape) return state.gisRows;
    if ("state" in shape) return state.sitemapRows;
    return [];
  }

  const db = {
    select: (...args: any[]) => {
      const rows = () => rowsFor(args);
      const chain: any = {
        from: () => chain,
        where: () => chain,
        orderBy: () => chain,
        limit: () => Promise.resolve(rows()),
        then: (res: any, rej: any) => Promise.resolve(rows()).then(res, rej),
      };
      return chain;
    },
    insert: () => ({
      values: (vals: any) => {
        state.insertCalls.push(vals);
        const row = {
          id: state.insertCalls.length,
          viewCount: 0,
          lastViewedAt: null,
          createdAt: new Date(),
          refreshedAt: new Date(),
          ...vals,
        };
        const after: any = {
          onConflictDoUpdate: () => after,
          onConflictDoNothing: () => after,
          returning: () => Promise.resolve([row]),
          then: (res: any, rej: any) => Promise.resolve([row]).then(res, rej),
        };
        return after;
      },
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
  };

  return {
    state,
    db,
    resolveParcel: vi.fn(),
    raiseAlert: vi.fn(async () => undefined),
  };
});

vi.mock("../../server/db", () => ({ db: h.db }));
vi.mock("../../server/services/parcel/resolveParcel", () => ({
  resolveParcel: h.resolveParcel,
}));
vi.mock("../../server/services/alertSpine", () => ({
  raiseAlert: h.raiseAlert,
}));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  normalizeReportKey,
  computePartialLcs,
  floodZoneSubScore,
  wetlandsSubScore,
  soilSubScore,
  getOrCreateReport,
  reportPath,
  PUBLIC_REPORT_DAILY_ALERT,
  PUBLIC_REPORT_DAILY_HARD_CAP,
} from "../../server/services/publicParcelReport";
import type { PublicReportFactCategory } from "@shared/schema";

// ── Fixtures ─────────────────────────────────────────────────────────────────

function cat(
  category: string,
  data: unknown,
  available = true,
): PublicReportFactCategory {
  return {
    category,
    available,
    data: available ? data : null,
    source: "Test Source",
    sourceAsOf: "2026-06-01",
    classification: "authoritative",
    fromCache: false,
  };
}

/** resolveParcel stub: county hit (apn path) + full federal geo (coords path). */
function stubFreeDataHappyPath() {
  h.resolveParcel.mockImplementation(async (input: any) => {
    if (input.type === "apn") {
      return {
        results: {
          parcel_data: {
            available: true,
            data: {
              centroid: { lat: 30.3, lng: -97.7 },
              data: {
                acres: 5.2,
                owner: "RECORD OWNER",
                assessedValue: 42000,
                taxAmount: 850,
              },
            },
            source: "Travis County GIS",
            sourceAsOf: "2026-06-01",
            classification: "authoritative",
            fromCache: false,
          },
        },
      };
    }
    return {
      results: {
        flood_zone: {
          available: true,
          data: { zone: "Zone X (Minimal flood risk)", riskLevel: "minimal" },
          source: "FEMA NFHL",
          sourceAsOf: "2026-06-01",
          classification: "authoritative",
          fromCache: false,
        },
        soil: {
          available: true,
          data: { soilType: "Houston Black clay", capabilityClass: "II" },
          source: "USDA SSURGO",
          sourceAsOf: "2026-06-01",
          classification: "authoritative",
          fromCache: false,
        },
        elevation: {
          available: true,
          data: { elevationFeet: 612, datum: "NAVD88" },
          source: "USGS 3DEP",
          sourceAsOf: "2026-06-01",
          classification: "authoritative",
          fromCache: false,
        },
        wetlands: {
          available: true,
          data: { hasWetlands: false },
          source: "USFWS NWI",
          sourceAsOf: "2026-06-01",
          classification: "authoritative",
          fromCache: false,
        },
      },
    };
  });
}

const KEY = normalizeReportKey("TX", "Travis County", "123-45-678")!;

beforeEach(() => {
  h.state.reportRows = [];
  h.state.todayCount = 0;
  h.state.gisRows = [];
  h.state.sitemapRows = [];
  h.state.insertCalls = [];
  h.resolveParcel.mockReset();
  h.raiseAlert.mockClear();
});

// ── 1. Permalink identity ────────────────────────────────────────────────────

describe("normalizeReportKey", () => {
  it("normalizes spelling variants of the same parcel to one identity", () => {
    const a = normalizeReportKey("TX", "Travis County", "123-45-678");
    const b = normalizeReportKey("tx", "travis", "12345678");
    const c = normalizeReportKey(" tx ", "Travis%20County", "123.45.678");
    expect(a).not.toBeNull();
    for (const k of [b, c]) {
      expect(k).not.toBeNull();
      expect(k!.state).toBe(a!.state);
      expect(k!.countySlug).toBe(a!.countySlug);
      expect(k!.apnKey).toBe(a!.apnKey);
    }
    expect(a!.state).toBe("TX");
    expect(a!.countySlug).toBe("travis");
    expect(a!.apnKey).toBe("12345678");
    expect(a!.countyLabel).toBe("Travis");
  });

  it("refuses crawler junk: digitless APNs, bad states, oversized input", () => {
    expect(normalizeReportKey("TX", "travis", "about")).toBeNull();
    expect(normalizeReportKey("ZZ", "travis", "12345")).toBeNull();
    expect(normalizeReportKey("TX", "", "12345")).toBeNull();
    expect(normalizeReportKey("TX", "travis", "1")).toBeNull();
    expect(normalizeReportKey("TX", "travis", "9".repeat(65))).toBeNull();
  });

  it("reportPath round-trips the canonical key", () => {
    expect(reportPath({ state: "TX", countySlug: "travis", apn: "123-45-678" })).toBe(
      "/p/tx/travis/123-45-678",
    );
  });
});

// ── 2. Honest partial LCS ────────────────────────────────────────────────────

describe("computePartialLcs honesty invariants", () => {
  it("locked dimensions NEVER carry a score value and name what is missing", () => {
    const lcs = computePartialLcs([
      cat("flood_zone", { zone: "Zone X" }),
      cat("soil", { soilType: "Loam", capabilityClass: "II" }),
      cat("wetlands", { hasWetlands: false }),
      cat("elevation", { elevationFeet: 500 }),
    ]);
    const locked = lcs.dimensions.filter((d) => d.status === "locked");
    expect(locked.map((d) => d.key).sort()).toEqual([
      "financial",
      "legal",
      "location",
      "market",
    ]);
    for (const d of locked) {
      expect(d.score).toBeNull();
      expect(d.coverage).toEqual([]);
      expect(d.missing.length).toBeGreaterThan(0);
    }
  });

  it("scores environmental + physical from real observations on the in-app scale", () => {
    const lcs = computePartialLcs([
      cat("flood_zone", { zone: "Zone X (Minimal flood risk)" }),
      cat("soil", { soilType: "Loam", capabilityClass: "II" }),
      cat("wetlands", { hasWetlands: false }),
    ]);
    const env = lcs.dimensions.find((d) => d.key === "environmental")!;
    const phys = lcs.dimensions.find((d) => d.key === "physical")!;
    expect(env.status).toBe("scored");
    expect(env.score).toBe(90); // (95 flood + 85 wetlands) / 2
    expect(env.coverage).toEqual(["floodRisk", "wetlands"]);
    expect(phys.status).toBe("scored");
    expect(phys.score).toBe(90); // capability class II
    // Renormalized weighted average: (90*10 + 90*20)/30 = 90 → 300+0.9*550
    expect(lcs.partialScore).toBe(795);
    expect(lcs.partialGrade).toBe("A");
    expect(lcs.scoredDimensions).toBe(2);
    expect(lcs.totalDimensions).toBe(6);
    expect(lcs.kind).toBe("partial");
    expect(lcs.basis).toBe("government-data-only");
  });

  it("yields NO score at all when nothing was observed — never a guess", () => {
    const lcs = computePartialLcs([
      cat("flood_zone", null, false),
      cat("soil", null, false),
      cat("wetlands", null, false),
      cat("elevation", null, false),
    ]);
    expect(lcs.scoredDimensions).toBe(0);
    expect(lcs.partialScore).toBeNull();
    expect(lcs.partialGrade).toBeNull();
    for (const d of lcs.dimensions) {
      expect(d.status).toBe("locked");
      expect(d.score).toBeNull();
    }
  });

  it("treats indeterminate inputs as unscored, not as values", () => {
    expect(floodZoneSubScore("Zone D")).toBeNull(); // unstudied
    expect(floodZoneSubScore("")).toBeNull();
    expect(floodZoneSubScore(42)).toBeNull();
    expect(wetlandsSubScore({ classification: "PEM1" })).toBeNull(); // no boolean
    // Broker's no-data default suitability "good" is not a measured fact.
    expect(soilSubScore({ soilType: "Loam", suitability: "good" })).toBeNull();
    expect(soilSubScore({ soilType: "Unknown" })).toBeNull();
  });

  it("maps real zone-family strings the way the in-app score does", () => {
    expect(floodZoneSubScore("Zone VE")).toBe(20);
    expect(floodZoneSubScore("Zone AE")).toBe(40);
    expect(floodZoneSubScore("Zone X500")).toBe(75);
    expect(floodZoneSubScore("Zone B")).toBe(75);
    expect(floodZoneSubScore("Zone X (Minimal flood risk)")).toBe(95);
    expect(wetlandsSubScore({ hasWetlands: true })).toBe(40);
    expect(soilSubScore({ soilType: "Clay", capabilityClass: "VII" })).toBe(40);
    expect(soilSubScore({ soilType: "Loam", suitability: "prime" })).toBe(90);
  });
});

// ── 3. Free-data-only structural guarantee ──────────────────────────────────

describe("free-data-only guarantee", () => {
  it("pins EVERY upstream lookup to maxTier:free with no org/credit context", async () => {
    stubFreeDataHappyPath();
    const result = await getOrCreateReport(KEY);
    expect(result.ok).toBe(true);
    expect(h.resolveParcel).toHaveBeenCalled();
    for (const call of h.resolveParcel.mock.calls) {
      const opts = call[1] ?? {};
      expect(opts.maxTier).toBe("free");
      expect(opts.orgTier).toBe("free");
      expect(opts).not.toHaveProperty("organizationId");
      expect(opts).not.toHaveProperty("creditBalance");
    }
  });

  it("registry-level: a paid provider's lookup is unreachable at tier free", async () => {
    const { providerRegistry } = await import(
      "../../server/services/providers/provider-registry"
    );
    const freeLookup = vi.fn().mockResolvedValue({
      provider: "free-county",
      category: "parcel_data",
      confidence: 80,
      costCents: 0,
      fetchedAt: new Date(),
      cached: false,
      latencyMs: 5,
      data: { ok: true },
    });
    const paidLookup = vi.fn();
    const mk = (name: string, tierRequired: string, lookup: any) => ({
      name,
      displayName: name,
      categories: ["parcel_data"],
      supportedInputTypes: ["coordinates" as const],
      tierRequired,
      costPerLookupCents: () => (tierRequired === "free" ? 0 : 10),
      isConfigured: async () => true,
      lookup,
      healthCheck: async () => ({
        healthy: true,
        latencyMs: 1,
        checkedAt: new Date(),
      }),
    });
    providerRegistry.register("parcel_data", mk("free-county", "free", freeLookup) as any, 10);
    providerRegistry.register("parcel_data", mk("paid-pro", "pro", paidLookup) as any, 1);

    const result = await providerRegistry.lookup(
      "parcel_data",
      { type: "coordinates", latitude: 30.3, longitude: -97.7 },
      "free", // the tier the public path pins
      0, // and zero credit balance — paid lookups have nothing to deduct
    );
    expect(result?.provider).toBe("free-county");
    expect(paidLookup).not.toHaveBeenCalled();
  });
});

// ── 4. Idempotency + cost guards + licensing ────────────────────────────────

describe("getOrCreateReport", () => {
  it("is idempotent: a fresh saved row short-circuits before upstream work", async () => {
    stubFreeDataHappyPath();
    const first = await getOrCreateReport(KEY);
    expect(first.ok && first.generated).toBe(true);
    const callsAfterGenerate = h.resolveParcel.mock.calls.length;
    expect(callsAfterGenerate).toBe(2); // apn + coordinates, once each

    // Same parcel, different spelling → same identity → cache hit.
    h.state.reportRows = [(first as any).report];
    const again = await getOrCreateReport(
      normalizeReportKey("tx", "travis", "12345678")!,
    );
    expect(again.ok).toBe(true);
    expect((again as any).generated).toBe(false);
    expect((again as any).report).toBe((first as any).report);
    expect(h.resolveParcel.mock.calls.length).toBe(callsAfterGenerate);
  });

  it("refuses NEW generation past the daily hard cap but serves stale rows", async () => {
    stubFreeDataHappyPath();
    h.state.todayCount = PUBLIC_REPORT_DAILY_HARD_CAP;

    const refused = await getOrCreateReport(KEY);
    expect(refused).toEqual({ ok: false, reason: "daily_capacity" });
    expect(h.resolveParcel).not.toHaveBeenCalled();

    // A stale existing row still serves (permalink never breaks).
    const stale = {
      id: 7,
      ...KEY,
      facts: {},
      lcs: {},
      refreshedAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
    };
    h.state.reportRows = [stale];
    const served = await getOrCreateReport(KEY);
    expect(served.ok).toBe(true);
    expect((served as any).report).toBe(stale);
    expect((served as any).generated).toBe(false);
    expect(h.resolveParcel).not.toHaveBeenCalled();
  });

  it("raises the alert-spine spike warning at the alert threshold", async () => {
    stubFreeDataHappyPath();
    h.state.todayCount = PUBLIC_REPORT_DAILY_ALERT;
    const result = await getOrCreateReport(KEY);
    expect(result.ok).toBe(true); // below hard cap — generation proceeds
    expect(h.raiseAlert).toHaveBeenCalledTimes(1);
    // Asserted through `toHaveBeenCalledWith` rather than by indexing
    // `mock.calls[0][0]`. The stub is `vi.fn(async () => undefined)`, which
    // declares NO parameters, so its `calls` entries are empty tuples: indexing
    // them was four type errors (TS2493 + three TS18048) that the runtime never
    // saw, because a test's type errors are invisible at runtime too — exactly
    // what `check:tests` exists to catch. This form needs no element access, so
    // it stays correct whatever the stub's declared arity.
    expect(h.raiseAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "public_parcel_reports",
        severity: "warning",
        dedupeKey: expect.stringMatching(/^daily-spike:\d{4}-\d{2}-\d{2}$/),
      }),
    );
  });

  it("returns an honest no_free_source when the county has no free data", async () => {
    h.resolveParcel.mockResolvedValue({ results: {} });
    const result = await getOrCreateReport(KEY);
    expect(result).toEqual({ ok: false, reason: "no_free_source" });
    expect(h.state.insertCalls).toEqual([]); // no fabricated empty report row
  });

  it("withholds county-assessor attributes unless the county license allows", async () => {
    stubFreeDataHappyPath();
    // Default (no GIS row reviewed) → not redistributable.
    const restricted = await getOrCreateReport(KEY);
    expect(restricted.ok).toBe(true);
    const restrictedFacts = h.state.insertCalls[0].facts;
    expect(restrictedFacts.parcel.countyAttributes).toBe("not-redistributable");
    expect(restrictedFacts.parcel.assessorData).toBeNull();
    // acres + centroid are identity facts and stay.
    expect(restrictedFacts.parcel.acres).toBe(5.2);

    // County reviewed as attribution-allowed → attributes persist + credit.
    h.state.insertCalls = [];
    h.state.gisRows = [
      {
        county: "Travis County",
        redistributable: "attribution",
        attribution: "Travis Central Appraisal District",
      },
    ];
    const allowed = await getOrCreateReport(KEY);
    expect(allowed.ok).toBe(true);
    const allowedFacts = h.state.insertCalls[0].facts;
    expect(allowedFacts.parcel.countyAttributes).toBe("included");
    expect(allowedFacts.parcel.assessorData).toMatchObject({
      owner: "RECORD OWNER",
      assessedValue: 42000,
    });
    expect(allowedFacts.parcel.attribution).toBe(
      "Travis Central Appraisal District",
    );
  });
});
