/**
 * LandProfile × real terrain wiring — PURE, no network, no DB.
 *
 * Locks the honesty contract for the slope field after the 3DEP terrain
 * service replaced the old land-cover proxy:
 *   - slope is POPULATED only from a successful multi-point EPQS sample
 *     (source "USGS 3DEP", confidence 85, real aspect in the value);
 *   - a failed sample → an honest GAP carrying the sampler's reason
 *     (lookup_failed / no_data) — NEVER the old land-cover proxy string;
 *   - no sample attempted → gap with "not_looked_up";
 *   - buildable % stays clearly MODELED, refined (not replaced) by real
 *     slope when available.
 */

import { describe, it, expect } from "vitest";
import { assembleLandProfile } from "../../server/services/landProfile";
import type {
  EnrichmentResult,
  EnrichmentProvenance,
} from "../../server/services/propertyEnrichment";
import type { TerrainSampleResult, TerrainSummary } from "../../server/services/terrain";

type TestProperty = Parameters<typeof assembleLandProfile>[0];

const baseProperty: TestProperty = {
  id: 7,
  latitude: "33.1234" as any,
  longitude: "-97.5678" as any,
  sizeAcres: "10" as any,
  legalDescription: null as any,
};

function prov(source: string): EnrichmentProvenance {
  return { source, asOf: null, fromCache: false };
}

function enrichmentWithCover(): EnrichmentResult {
  return {
    latitude: 33.1234,
    longitude: -97.5678,
    enrichedAt: new Date(),
    lookupTimeMs: 50,
    hazards: { floodZone: "Zone X", wetlandsPercentage: 0 },
    landCover: { className: "Pasture/Hay", isAgricultural: true, isWetland: false },
    provenance: {
      flood_zone: prov("FEMA NFHL"),
      wetlands: prov("USFWS NWI"),
      land_cover: prov("USGS NLCD"),
      elevation: prov("USGS 3DEP"),
    },
    errors: {},
  };
}

function okTerrain(overrides: Partial<TerrainSummary> = {}): TerrainSampleResult {
  return {
    ok: true,
    summary: {
      meanSlopePercent: 4.2,
      maxSlopePercent: 7.1,
      slopeBand: "gentle (3-8%)",
      aspectDegrees: 225,
      aspectCompass: "SW",
      elevationMinFeet: 900,
      elevationMaxFeet: 940,
      elevationRangeFeet: 40,
      centerElevationFeet: 920,
      validPoints: 9,
      totalPoints: 9,
      spacingMeters: 67,
      pattern: "grid9",
      source: "USGS 3DEP (EPQS)",
      ...overrides,
    },
  };
}

function failedTerrain(reason: "lookup_failed" | "no_data"): TerrainSampleResult {
  return {
    ok: false,
    reason,
    detail: "test failure",
    validPoints: 2,
    totalPoints: 9,
    centerElevationFeet: null,
  };
}

describe("LandProfile slope — real 3DEP sampling", () => {
  it("successful sample → REAL slope field with USGS source, 85 confidence, real aspect", () => {
    const profile = assembleLandProfile(baseProperty, enrichmentWithCover(), false, okTerrain());
    expect(profile.slope).toBeDefined();
    expect(profile.slope?.value).toBe("gentle (3-8%) — 4.2% avg, 7.1% max, SW-facing");
    expect(profile.slope?.source).toBe("USGS 3DEP (EPQS multi-point)");
    expect(profile.slope?.confidence).toBe(85);
    expect(profile.slope?.classification).toBe("estimate");
    // Not in the gaps list.
    expect(profile.gaps.some((g) => g.field === "slope")).toBe(false);
  });

  it("failed sample (lookup_failed) → honest gap, NEVER the old land-cover proxy", () => {
    const profile = assembleLandProfile(
      baseProperty,
      enrichmentWithCover(),
      false,
      failedTerrain("lookup_failed"),
    );
    expect(profile.slope).toBeUndefined();
    const gap = profile.gaps.find((g) => g.field === "slope");
    expect(gap?.reason).toBe("lookup_failed");
  });

  it("failed sample (no_data) → gap with no_data", () => {
    const profile = assembleLandProfile(
      baseProperty,
      enrichmentWithCover(),
      false,
      failedTerrain("no_data"),
    );
    expect(profile.slope).toBeUndefined();
    expect(profile.gaps.find((g) => g.field === "slope")?.reason).toBe("no_data");
  });

  it("no sample attempted → gap with not_looked_up (even with land cover present)", () => {
    // The old code would have emitted a proxy slope string here ("Open /
    // agricultural land cover"). It must now be an honest gap.
    const profile = assembleLandProfile(baseProperty, enrichmentWithCover(), false);
    expect(profile.slope).toBeUndefined();
    expect(profile.gaps.find((g) => g.field === "slope")?.reason).toBe("not_looked_up");
  });
});

describe("LandProfile buildable % — modeled base, refined by real slope", () => {
  it("stays modeled from land cover alone when no terrain (base 85, conf 50)", () => {
    const profile = assembleLandProfile(baseProperty, enrichmentWithCover(), false);
    expect(profile.buildablePercentage?.value).toBe(85);
    expect(profile.buildablePercentage?.classification).toBe("modeled");
    expect(profile.buildablePercentage?.confidence).toBe(50);
    expect(profile.buildablePercentage?.source).toBe("AcreOS (modeled from land cover)");
  });

  it("real moderate slope down-weights the estimate and says so in the source", () => {
    const terrain = okTerrain({ maxSlopePercent: 12, slopeBand: "moderate (8-15%)" });
    const profile = assembleLandProfile(baseProperty, enrichmentWithCover(), false, terrain);
    // 85 × 0.85 = 72.25 → 72.
    expect(profile.buildablePercentage?.value).toBe(72);
    expect(profile.buildablePercentage?.classification).toBe("modeled");
    expect(profile.buildablePercentage?.confidence).toBe(60);
    expect(profile.buildablePercentage?.source).toBe(
      "AcreOS (modeled from land cover + USGS 3DEP slope)",
    );
  });

  it("gentle real slope leaves the base estimate intact (factor 1)", () => {
    const profile = assembleLandProfile(baseProperty, enrichmentWithCover(), false, okTerrain());
    expect(profile.buildablePercentage?.value).toBe(85);
    expect(profile.buildablePercentage?.confidence).toBe(60);
  });

  it("steep real slope cuts hard (>25% → ×0.35)", () => {
    const terrain = okTerrain({ maxSlopePercent: 30, slopeBand: "steep (>15%)" });
    const profile = assembleLandProfile(baseProperty, enrichmentWithCover(), false, terrain);
    expect(profile.buildablePercentage?.value).toBe(30); // 85 × 0.35 = 29.75 → 30
  });

  it("no land-cover base → buildable stays an honest gap even with real slope", () => {
    const enrichment: EnrichmentResult = {
      latitude: 33.1234,
      longitude: -97.5678,
      enrichedAt: new Date(),
      lookupTimeMs: 40,
      hazards: { floodZone: "Zone X" },
      provenance: { flood_zone: prov("FEMA NFHL") },
      errors: {},
    };
    const profile = assembleLandProfile(baseProperty, enrichment, false, okTerrain());
    expect(profile.buildablePercentage).toBeUndefined();
    expect(profile.gaps.some((g) => g.field === "buildablePercentage")).toBe(true);
    // Slope itself is still real — the two fields are independent.
    expect(profile.slope?.source).toContain("USGS 3DEP");
  });

  it("wetland-dominated parcel keeps the low modeled base (20) with no fake slope", () => {
    const enrichment: EnrichmentResult = {
      ...enrichmentWithCover(),
      hazards: { floodZone: "Zone AE", wetlandsPercentage: 80 },
      landCover: { className: "Woody Wetlands", isWetland: true },
    };
    const profile = assembleLandProfile(baseProperty, enrichment, false);
    expect(profile.buildablePercentage?.value).toBe(20);
    expect(profile.slope).toBeUndefined();
  });
});
