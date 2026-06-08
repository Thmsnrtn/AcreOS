/**
 * resolveParcel facade — delegation, normalized shape, broker fallback, and
 * shadow-diff detection. The registry + broker are mocked so these tests pin the
 * facade's plumbing without booting providers or the DB.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DataCategory, LookupResult } from "../providers/types";

// ── Mocks ─────────────────────────────────────────────────────

const enrichAll = vi.fn();
const getAvailableProviders = vi.fn();
const lookupMultiple = vi.fn();

vi.mock("../providers/provider-registry", () => ({
  providerRegistry: {
    enrichAll: (...args: unknown[]) => enrichAll(...args),
    getAvailableProviders: (...args: unknown[]) => getAvailableProviders(...args),
  },
}));

vi.mock("../data-source-broker", () => ({
  dataSourceBroker: {
    lookupMultiple: (...args: unknown[]) => lookupMultiple(...args),
  },
}));

// Capture shadow-diff logging without asserting on the logger itself.
const logShadowDiffSpy = vi.fn();
vi.mock("./resolveShadow", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./resolveShadow")>();
  return {
    ...orig,
    logShadowDiff: (...args: Parameters<typeof orig.logShadowDiff>) => {
      logShadowDiffSpy(...args);
      return orig.logShadowDiff(...args);
    },
  };
});

import { resolveParcel, classificationForBroker } from "./resolveParcel";
import { diffCategory, logShadowDiff } from "./resolveShadow";
import type { ResolvedCategory } from "./resolveParcel";

// ── Fixtures ──────────────────────────────────────────────────

function registryResult(over: Partial<LookupResult> = {}): LookupResult {
  return {
    provider: "open-data",
    category: "flood_zone",
    confidence: 90,
    costCents: 0,
    fetchedAt: new Date("2026-01-01T00:00:00Z"),
    cached: false,
    latencyMs: 12,
    data: { zone: "X" },
    source: "FEMA NFHL",
    sourceAsOf: new Date("2025-06-01T00:00:00Z"),
    classification: "authoritative",
    stale: false,
    ...over,
  };
}

/** A provider registered for the given categories. */
function provider(categories: DataCategory[]) {
  return { name: "open-data", categories };
}

const COORDS = { type: "coordinates" as const, latitude: 30.1234, longitude: -97.5678 };

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.RESOLVE_PARCEL_SHADOW_SAMPLE_RATE;
});

// ── Delegation + normalized shape ─────────────────────────────

describe("resolveParcel — registry delegation", () => {
  it("delegates registry-covered categories to enrichAll and normalizes the result", async () => {
    getAvailableProviders.mockReturnValue([provider(["flood_zone", "soil"])]);
    enrichAll.mockResolvedValue(
      new Map<DataCategory, LookupResult>([
        ["flood_zone", registryResult()],
        ["soil", registryResult({ category: "soil", source: "USDA SSURGO", data: { series: "Houston Black" } })],
      ]),
    );

    const out = await resolveParcel(COORDS, {
      categories: ["flood_zone", "soil"],
      orgTier: "free",
      maxTier: "free",
    });

    // enrichAll received exactly the registry-covered categories.
    expect(enrichAll).toHaveBeenCalledTimes(1);
    expect(enrichAll.mock.calls[0][0]).toEqual(["flood_zone", "soil"]);
    // Broker never invoked — registry covered everything.
    expect(lookupMultiple).not.toHaveBeenCalled();

    const flood = out.results.flood_zone;
    expect(flood.available).toBe(true);
    expect(flood.source).toBe("FEMA NFHL");
    expect(flood.classification).toBe("authoritative");
    expect(flood.confidence).toBe(90);
    expect(flood.sourceAsOf).toBe("2025-06-01T00:00:00.000Z");
    expect(flood.resolvedVia).toBe("registry");
    expect(out.meta.successCount).toBe(2);
    expect(out.meta.failureCount).toBe(0);
  });

  it("caps orgTier to maxTier when passing to the registry", async () => {
    getAvailableProviders.mockReturnValue([provider(["flood_zone"])]);
    enrichAll.mockResolvedValue(new Map([["flood_zone", registryResult()]]));

    await resolveParcel(COORDS, {
      categories: ["flood_zone"],
      orgTier: "pro",
      maxTier: "free",
    });

    // 3rd positional arg to enrichAll is the tier — capped to "free".
    expect(enrichAll.mock.calls[0][2]).toBe("free");
  });

  it("normalizes a registry miss to an honest empty category", async () => {
    getAvailableProviders.mockReturnValue([provider(["flood_zone"])]);
    enrichAll.mockResolvedValue(new Map()); // miss

    const out = await resolveParcel(COORDS, {
      categories: ["flood_zone"],
      orgTier: "free",
    });

    expect(out.results.flood_zone.available).toBe(false);
    expect(out.results.flood_zone.classification).toBe("unknown");
    expect(out.results.flood_zone.data).toBeNull();
    expect(out.meta.failureCount).toBe(1);
  });
});

// ── Broker fallback ───────────────────────────────────────────

describe("resolveParcel — broker fallback", () => {
  it("routes registry-uncovered categories to the broker and normalizes them", async () => {
    // Registry covers nothing → all categories fall back to broker.
    getAvailableProviders.mockReturnValue([provider([])]);
    lookupMultiple.mockResolvedValue({
      results: {
        zoning: {
          success: true,
          data: { code: "AG", source: "County GIS" },
          source: { title: "County GIS" },
          fromCache: true,
        },
      },
      totalLookupTimeMs: 5,
      successCount: 1,
      failureCount: 0,
    });

    const out = await resolveParcel(COORDS, {
      categories: ["zoning"],
      orgTier: "free",
    });

    expect(enrichAll).not.toHaveBeenCalled();
    expect(lookupMultiple).toHaveBeenCalledTimes(1);
    const z = out.results.zoning;
    expect(z.available).toBe(true);
    expect(z.resolvedVia).toBe("broker");
    expect(z.source).toBe("County GIS"); // prefers data.source
    expect(z.fromCache).toBe(true);
  });

  it("returns honest empties for broker categories when input has no coordinates", async () => {
    getAvailableProviders.mockReturnValue([provider([])]);

    const out = await resolveParcel(
      { type: "apn", apn: "R12345", state: "TX", county: "Travis" },
      { categories: ["zoning"], orgTier: "free" },
    );

    expect(lookupMultiple).not.toHaveBeenCalled();
    expect(out.results.zoning.available).toBe(false);
    expect(out.results.zoning.resolvedVia).toBe("broker");
  });
});

// ── classification mapping ────────────────────────────────────

describe("classificationForBroker", () => {
  it("maps government records authoritative, elevation modeled, demographics estimate", () => {
    expect(classificationForBroker("flood_zone")).toBe("authoritative");
    expect(classificationForBroker("soil")).toBe("authoritative");
    expect(classificationForBroker("elevation")).toBe("modeled");
    expect(classificationForBroker("demographics")).toBe("estimate");
    expect(classificationForBroker("market_data")).toBe("unknown");
  });
});

// ── Shadow-diff detection ─────────────────────────────────────

function cat(over: Partial<ResolvedCategory> = {}): ResolvedCategory {
  return {
    category: "flood_zone",
    available: true,
    data: { zone: "X" },
    source: "FEMA NFHL",
    sourceAsOf: "2025-06-01T00:00:00.000Z",
    classification: "authoritative",
    confidence: 90,
    fromCache: false,
    stale: false,
    resolvedVia: "registry",
    ...over,
  };
}

describe("diffCategory — field-level shadow diff", () => {
  it("reports no diffs when provenance agrees", () => {
    expect(diffCategory("flood_zone", cat(), cat({ resolvedVia: "broker" }))).toEqual([]);
  });

  it("detects a source mismatch", () => {
    const diffs = diffCategory("flood_zone", cat({ source: "FEMA NFHL" }), cat({ source: "County GIS" }));
    expect(diffs).toHaveLength(1);
    expect(diffs[0].field).toBe("source");
    expect(diffs[0].unified).toBe("FEMA NFHL");
    expect(diffs[0].legacy).toBe("County GIS");
  });

  it("detects an availability mismatch (one door has it, the other doesn't)", () => {
    const present = cat({ available: true });
    const absent = cat({ available: false, source: null, classification: "unknown", confidence: null });
    const diffs = diffCategory("flood_zone", present, absent);
    const fields = diffs.map((d) => d.field);
    expect(fields).toContain("available");
    expect(fields).toContain("source");
    expect(fields).toContain("classification");
  });

  it("treats sub-point confidence drift as equal (rounding noise, not a diff)", () => {
    const diffs = diffCategory("flood_zone", cat({ confidence: 90 }), cat({ confidence: 90.4 }));
    expect(diffs).toEqual([]);
  });

  it("treats null and undefined as equal (both mean no value)", () => {
    const a = cat({ sourceAsOf: null });
    const b = cat({ sourceAsOf: undefined as unknown as string });
    expect(diffCategory("flood_zone", a, b)).toEqual([]);
  });
});

describe("logShadowDiff", () => {
  it("returns the flattened diff list across categories", () => {
    const unified = { flood_zone: cat(), soil: cat({ category: "soil", source: "USDA SSURGO" }) };
    const legacy = {
      flood_zone: cat({ source: "FEMA NFHL" }), // agrees
      soil: cat({ category: "soil", source: "Wrong Source" }), // disagrees
    };
    const diffs = logShadowDiff(COORDS, ["flood_zone", "soil"], unified, legacy);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].category).toBe("soil");
    expect(diffs[0].field).toBe("source");
  });
});

// ── End-to-end shadow-compare wiring ──────────────────────────

describe("resolveParcel — shadow-compare wiring", () => {
  it("fires logShadowDiff (sampled at rate 1) using the legacy broker path", async () => {
    getAvailableProviders.mockReturnValue([provider(["flood_zone"])]);
    enrichAll.mockResolvedValue(new Map([["flood_zone", registryResult({ source: "FEMA NFHL" })]]));
    // Legacy broker returns a DIFFERENT source → a diff should be logged.
    lookupMultiple.mockResolvedValue({
      results: {
        flood_zone: {
          success: true,
          data: { zone: "AE", source: "County Flood Layer" },
          source: { title: "County Flood Layer" },
          fromCache: false,
        },
      },
      totalLookupTimeMs: 4,
      successCount: 1,
      failureCount: 0,
    });

    await resolveParcel(COORDS, {
      categories: ["flood_zone"],
      orgTier: "free",
      maxTier: "free",
      shadowSampleRate: 1,
    });

    // Let the fire-and-forget shadow promise settle.
    await new Promise((r) => setImmediate(r));

    expect(lookupMultiple).toHaveBeenCalled(); // legacy path computed
    expect(logShadowDiffSpy).toHaveBeenCalledTimes(1);
    const loggedDiffs = logShadowDiffSpy.mock.calls[0];
    // unified vs legacy normalized maps were passed.
    expect(loggedDiffs[1]).toEqual(["flood_zone"]);
  });

  it("does not fire shadow-compare when sample rate is 0", async () => {
    getAvailableProviders.mockReturnValue([provider(["flood_zone"])]);
    enrichAll.mockResolvedValue(new Map([["flood_zone", registryResult()]]));

    await resolveParcel(COORDS, {
      categories: ["flood_zone"],
      orgTier: "free",
      shadowSampleRate: 0,
    });
    await new Promise((r) => setImmediate(r));

    expect(logShadowDiffSpy).not.toHaveBeenCalled();
  });
});
