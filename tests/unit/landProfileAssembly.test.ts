/**
 * LandProfile assembly + honest-gaps tests (Maren/Andrei — Land Snapshot).
 *
 * The LandProfile is the product's canonical, decision-grade parcel object. It
 * is assembled SERVER-SIDE from the existing free open-data EnrichmentResult.
 * These tests lock in the two load-bearing behaviors:
 *
 *   1. ASSEMBLY — each populated field carries the right value + provenance
 *      (source / asOf / confidence / classification), pulled from the broker's
 *      per-category provenance map.
 *   2. HONESTY — fields we cannot populate are OMITTED (never a fabricated
 *      default) and surfaced in `gaps` with an honest reason:
 *        - "not_looked_up" when no enrichment ran at all,
 *        - "lookup_failed" when the backing category errored,
 *        - "no_data" when enrichment ran but the source had no value here.
 */

import { describe, it, expect } from "vitest";
import { assembleLandProfile } from "../../server/services/landProfile";
import type {
  EnrichmentResult,
  EnrichmentProvenance,
} from "../../server/services/propertyEnrichment";
import { LAND_PROFILE_FIELD_ORDER } from "../../shared/landProfile";

type TestProperty = Parameters<typeof assembleLandProfile>[0];

const baseProperty: TestProperty = {
  id: 42,
  latitude: "33.1234" as any,
  longitude: "-97.5678" as any,
  sizeAcres: "10.5" as any,
  legalDescription: null as any,
};

function prov(source: string, asOf: string | null = null): EnrichmentProvenance {
  return { source, asOf, fromCache: false };
}

/** A reasonably-full enrichment covering the decision fields. */
function fullEnrichment(): EnrichmentResult {
  return {
    latitude: 33.1234,
    longitude: -97.5678,
    enrichedAt: new Date(),
    lookupTimeMs: 120,
    parcel: { owner: "Jane Doe", acreage: 10.5, legalDescription: "LOT 3 BLK A" },
    hazards: { floodZone: "Zone X", wetlandsPercentage: 0 },
    environment: { soilType: "Houston Black", soilSuitability: "II" },
    landCover: { className: "Pasture/Hay", isAgricultural: true, isWetland: false },
    agriculturalValues: { countyAvgPerAcre: 4200 },
    plss: { section: "14", township: "T2N", range: "R3W" },
    transportation: { nearestHighwayMiles: 0.4 },
    water: { nearestStreamMiles: 0.1 },
    provenance: {
      parcel_data: prov("County GIS", "2024"),
      flood_zone: prov("FEMA NFHL", "2024-08-01"),
      wetlands: prov("USFWS NWI"),
      soil: prov("USDA NRCS SDA"),
      land_cover: prov("USGS NLCD", "2021"),
      agricultural_values: prov("USDA NASS", "2023"),
      plss: prov("BLM CadNSDI"),
      transportation: prov("Census TIGER"),
      water_resources: prov("USGS NHD"),
    },
  };
}

describe("assembleLandProfile — assembly", () => {
  it("populates decision fields with correct values + provenance", () => {
    const profile = assembleLandProfile(baseProperty, fullEnrichment(), true);

    expect(profile.propertyId).toBe(42);
    expect(profile.fromCache).toBe(true);

    // Flood — authoritative, carries FEMA source + effective date.
    expect(profile.floodZone?.value).toBe("Zone X");
    expect(profile.floodZone?.source).toBe("FEMA NFHL");
    expect(profile.floodZone?.asOf).toBe("2024-08-01");
    expect(profile.floodZone?.classification).toBe("authoritative");
    expect(profile.floodZone?.confidence).toBeGreaterThanOrEqual(80);

    // Acreage from the county parcel (authoritative), not the owner-entered size.
    expect(profile.acreage?.value).toBe(10.5);
    expect(profile.acreage?.source).toBe("County GIS");
    expect(profile.acreage?.classification).toBe("authoritative");

    // Wetlands 0% is a REAL value (looked up), must be present — not dropped.
    expect(profile.wetlandsPercentage?.value).toBe(0);
    expect(profile.wetlandsPercentage?.source).toBe("USFWS NWI");

    // Owner, soil, land cover, ag value, PLSS all populated.
    expect(profile.owner?.value).toBe("Jane Doe");
    expect(profile.soilCapabilityClass?.value).toBe("II");
    expect(profile.landCover?.value).toBe("Pasture/Hay");
    expect(profile.agValuePerAcre?.value).toBe(4200);
    expect(profile.plss?.value).toContain("SEC 14");

    // Access flags derived honestly from distances.
    expect(profile.roadAccess?.value).toBe(true); // highway 0.4mi <= 1
    expect(profile.waterAccess?.value).toBe(true); // stream 0.1mi <= 0.25
  });

  it("flags modeled values (buildable %) as modeled, never authoritative", () => {
    const profile = assembleLandProfile(baseProperty, fullEnrichment(), false);
    expect(profile.buildablePercentage?.classification).toBe("modeled");
    expect(profile.buildablePercentage?.confidence).toBeLessThan(80);
  });

  it("counts populated fields and never exceeds the tracked total", () => {
    const profile = assembleLandProfile(baseProperty, fullEnrichment(), false);
    expect(profile.fieldsTotal).toBe(LAND_PROFILE_FIELD_ORDER.length);
    expect(profile.fieldsPopulated).toBeGreaterThan(0);
    expect(profile.fieldsPopulated + profile.gaps.length).toBe(profile.fieldsTotal);
  });
});

describe("assembleLandProfile — honest gaps", () => {
  it("a cold parcel (no enrichment) produces all-gaps, reason=not_looked_up", () => {
    const profile = assembleLandProfile(
      { ...baseProperty, sizeAcres: null as any },
      null,
      false,
    );
    // Nothing fabricated.
    expect(profile.fieldsPopulated).toBe(0);
    expect(profile.gaps.length).toBe(profile.fieldsTotal);
    for (const gap of profile.gaps) {
      expect(gap.reason).toBe("not_looked_up");
      expect(gap.label).toBeTruthy();
    }
    // No populated LandField should leak a value.
    for (const key of LAND_PROFILE_FIELD_ORDER) {
      expect((profile as any)[key]).toBeUndefined();
    }
  });

  it("a failed category becomes a gap with reason=lookup_failed", () => {
    const enrichment: EnrichmentResult = {
      latitude: 33.1234,
      longitude: -97.5678,
      enrichedAt: new Date(),
      lookupTimeMs: 80,
      hazards: { floodZone: "Zone AE", wetlandsPercentage: 100 },
      provenance: { flood_zone: prov("FEMA NFHL"), wetlands: prov("USFWS NWI") },
      errors: { soil: "USDA SDA timeout", land_cover: "NLCD 503" },
    };
    const profile = assembleLandProfile(baseProperty, enrichment, false);

    // Flood is populated.
    expect(profile.floodZone?.value).toBe("Zone AE");
    // Soil + land cover errored → gaps with lookup_failed.
    const soilGap = profile.gaps.find((g) => g.field === "soilCapabilityClass");
    const coverGap = profile.gaps.find((g) => g.field === "landCover");
    expect(soilGap?.reason).toBe("lookup_failed");
    expect(coverGap?.reason).toBe("lookup_failed");
  });

  it("a category that ran but returned nothing becomes reason=no_data", () => {
    const enrichment: EnrichmentResult = {
      latitude: 33.1234,
      longitude: -97.5678,
      enrichedAt: new Date(),
      lookupTimeMs: 90,
      hazards: { floodZone: "Zone X" },
      // soil ran (provenance present) but no capability class came back.
      environment: { soilType: "Unknown" },
      provenance: { flood_zone: prov("FEMA NFHL"), soil: prov("USDA NRCS SDA") },
      errors: {},
    };
    const profile = assembleLandProfile(baseProperty, enrichment, false);
    const soilGap = profile.gaps.find((g) => g.field === "soilCapabilityClass");
    expect(soilGap).toBeDefined();
    expect(soilGap?.reason).toBe("no_data");
  });

  it("never fabricates power access — it is always an honest gap on free data", () => {
    const profile = assembleLandProfile(baseProperty, fullEnrichment(), false);
    expect(profile.powerAccess).toBeUndefined();
    expect(profile.gaps.some((g) => g.field === "powerAccess")).toBe(true);
  });

  it("falls back to owner-entered acreage as an ESTIMATE when no county parcel", () => {
    const enrichment: EnrichmentResult = {
      latitude: 33.1234,
      longitude: -97.5678,
      enrichedAt: new Date(),
      lookupTimeMs: 50,
      hazards: { floodZone: "Zone X" },
      provenance: { flood_zone: prov("FEMA NFHL") },
    };
    const profile = assembleLandProfile(baseProperty, enrichment, false);
    expect(profile.acreage?.value).toBe(10.5);
    expect(profile.acreage?.classification).toBe("estimate");
    expect(profile.acreage?.source).toBe("Owner-entered");
  });
});
