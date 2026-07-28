/**
 * Wave-2 Tier-1 signals — wildfire hazard (USFS WHP), broadband (FCC BDC),
 * septic suitability (USDA SSURGO septic interpretation on the "soil"
 * category) — surfaced in the LandProfile and the Map door, HONESTLY.
 *
 * Locks in:
 *   1. ASSEMBLY — canned category results populate the three new LandFields
 *      with the right value + provenance (source / asOf / confidence /
 *      classification).
 *   2. GAPS — absent signals are OMITTED and land in `gaps` with the honest
 *      reason: not_looked_up (category never attempted, incl. pre-wave-2
 *      caches), lookup_failed (category errored — including the free FCC
 *      token not being configured), no_data (category ran, nothing here).
 *   3. MAP HONESTY — deriveIntel never coalesces the new fields; unknown
 *      stays `undefined`, a REAL false passes through.
 *   4. SHARED CONTRACT — the three field keys are pinned in the shared
 *      labels/order registries with the LandField shape.
 */

import { describe, it, expect } from "vitest";
import {
  assembleLandProfile,
  formatWildfireHazardValue,
  formatBroadbandValue,
} from "../../server/services/landProfile";
import type {
  EnrichmentResult,
  EnrichmentProvenance,
} from "../../server/services/propertyEnrichment";
import {
  LAND_PROFILE_FIELD_LABELS,
  LAND_PROFILE_FIELD_ORDER,
} from "../../shared/landProfile";
import {
  deriveIntel,
  INTEL_NUMERIC_FIELDS,
  type PropertyIntelligence,
} from "../../client/src/pages/maps-intel";

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

function baseEnrichment(): EnrichmentResult {
  return {
    latitude: 33.1234,
    longitude: -97.5678,
    enrichedAt: new Date(),
    lookupTimeMs: 100,
    hazards: { floodZone: "Zone X", wetlandsPercentage: 0 },
    provenance: {
      flood_zone: prov("FEMA NFHL"),
      wetlands: prov("USFWS NWI"),
    },
    errors: {},
  };
}

/** Canned wave-2 category results, per the broker contract shapes. */
function wave2Enrichment(): EnrichmentResult {
  const e = baseEnrichment();
  e.wildfireHazard = { whpClass: 4, whpLabel: "high", source: "USFS Wildfire Hazard Potential" };
  e.broadband = {
    served: true,
    maxDownMbps: 940,
    maxUpMbps: 35,
    technologies: ["Cable", "Fixed Wireless"],
    providerCount: 3,
    source: "FCC National Broadband Map (BDC)",
  };
  e.environment = {
    soilType: "Houston Black",
    soilSuitability: "II",
    septicRating: "Very limited",
    septicRatingSource: "USDA NRCS SDA (septic tank absorption fields)",
  };
  e.provenance = {
    ...e.provenance,
    soil: prov("USDA NRCS SDA", "2024"),
    wildfire_hazard: prov("USFS Wildfire Hazard Potential", "2023"),
    broadband: prov("FCC National Broadband Map (BDC)", "2024-06"),
  };
  return e;
}

describe("assembleLandProfile — wave-2 signals populate with provenance", () => {
  it("wildfire hazard: USFS WHP label + class, authoritative, federal-tier confidence", () => {
    const profile = assembleLandProfile(baseProperty, wave2Enrichment(), false);
    expect(profile.wildfireHazard?.value).toBe("High (WHP class 4 of 5)");
    expect(profile.wildfireHazard?.source).toBe("USFS Wildfire Hazard Potential");
    expect(profile.wildfireHazard?.asOf).toBe("2023");
    expect(profile.wildfireHazard?.classification).toBe("authoritative");
    expect(profile.wildfireHazard?.confidence).toBe(85);
  });

  it("broadband: formatted from ONLY the returned parts, FCC-tier confidence (self-reported)", () => {
    const profile = assembleLandProfile(baseProperty, wave2Enrichment(), false);
    expect(profile.broadband?.value).toBe(
      "Served · up to 940/35 Mbps · 3 providers · Cable, Fixed Wireless",
    );
    expect(profile.broadband?.source).toBe("FCC National Broadband Map (BDC)");
    expect(profile.broadband?.asOf).toBe("2024-06");
    expect(profile.broadband?.classification).toBe("authoritative");
    // Documented below the federal point-layers (85-90) and county GIS (80):
    // the FCC map is the system of record but ISP-self-reported.
    expect(profile.broadband?.confidence).toBe(75);
  });

  it("septic suitability: SSURGO rating with its per-datum source winning over the category source", () => {
    const profile = assembleLandProfile(baseProperty, wave2Enrichment(), false);
    expect(profile.septicSuitability?.value).toBe("Very limited");
    expect(profile.septicSuitability?.source).toBe(
      "USDA NRCS SDA (septic tank absorption fields)",
    );
    expect(profile.septicSuitability?.asOf).toBe("2024"); // soil category asOf
    expect(profile.septicSuitability?.classification).toBe("authoritative");
    expect(profile.septicSuitability?.confidence).toBe(85);
    // The existing capability class stays populated alongside it.
    expect(profile.soilCapabilityClass?.value).toBe("II");
  });

  it("a REAL not-served broadband is a populated value, not a gap", () => {
    const e = wave2Enrichment();
    e.broadband = { served: false, maxDownMbps: null, maxUpMbps: null, technologies: [], providerCount: 0 };
    const profile = assembleLandProfile(baseProperty, e, false);
    expect(profile.broadband?.value).toBe("Not served (no fixed broadband reported)");
    expect(profile.gaps.some((g) => g.field === "broadband")).toBe(false);
  });

  it("counts stay consistent: populated + gaps === fieldsTotal with the new fields tracked", () => {
    const profile = assembleLandProfile(baseProperty, wave2Enrichment(), false);
    expect(profile.fieldsTotal).toBe(LAND_PROFILE_FIELD_ORDER.length);
    expect(profile.fieldsPopulated + profile.gaps.length).toBe(profile.fieldsTotal);
  });
});

describe("assembleLandProfile — wave-2 honest gaps", () => {
  it("cold parcel (no enrichment): all three are gaps with not_looked_up", () => {
    const profile = assembleLandProfile(baseProperty, null, false);
    for (const key of ["wildfireHazard", "broadband", "septicSuitability"] as const) {
      expect((profile as any)[key]).toBeUndefined();
      const gap = profile.gaps.find((g) => g.field === key);
      expect(gap?.reason).toBe("not_looked_up");
    }
  });

  it("pre-wave-2 cached enrichment (categories never attempted): not_looked_up, NOT no_data", () => {
    // baseEnrichment has flood/wetlands only — wildfire_hazard and broadband
    // were never attempted, so claiming "no data at this location" would lie.
    const profile = assembleLandProfile(baseProperty, baseEnrichment(), true);
    expect(profile.gaps.find((g) => g.field === "wildfireHazard")?.reason).toBe("not_looked_up");
    expect(profile.gaps.find((g) => g.field === "broadband")?.reason).toBe("not_looked_up");
    expect(profile.gaps.find((g) => g.field === "septicSuitability")?.reason).toBe("not_looked_up");
  });

  it("soil ran but carried no septic rating: septicSuitability gap is no_data", () => {
    const e = baseEnrichment();
    e.environment = { soilType: "Houston Black", soilSuitability: "II" };
    e.provenance = { ...e.provenance, soil: prov("USDA NRCS SDA") };
    const profile = assembleLandProfile(baseProperty, e, false);
    expect(profile.soilCapabilityClass?.value).toBe("II");
    expect(profile.septicSuitability).toBeUndefined();
    expect(profile.gaps.find((g) => g.field === "septicSuitability")?.reason).toBe("no_data");
  });

  it("wildfire category ran but returned no class label: no_data, never a guessed label", () => {
    const e = baseEnrichment();
    e.wildfireHazard = { whpClass: null, whpLabel: null, source: "USFS Wildfire Hazard Potential" };
    e.provenance = { ...e.provenance, wildfire_hazard: prov("USFS Wildfire Hazard Potential") };
    const profile = assembleLandProfile(baseProperty, e, false);
    expect(profile.wildfireHazard).toBeUndefined();
    expect(profile.gaps.find((g) => g.field === "wildfireHazard")?.reason).toBe("no_data");
  });

  it("a failed wildfire lookup: lookup_failed", () => {
    const e = baseEnrichment();
    e.errors = { wildfire_hazard: "USFS ImageServer timeout" };
    const profile = assembleLandProfile(baseProperty, e, false);
    expect(profile.wildfireHazard).toBeUndefined();
    expect(profile.gaps.find((g) => g.field === "wildfireHazard")?.reason).toBe("lookup_failed");
  });

  it("broadband unavailable because the free FCC token is not configured: lookup_failed", () => {
    const e = baseEnrichment();
    e.errors = { broadband: "FCC broadband token not configured" };
    const profile = assembleLandProfile(baseProperty, e, false);
    expect(profile.broadband).toBeUndefined();
    expect(profile.gaps.find((g) => g.field === "broadband")?.reason).toBe("lookup_failed");
  });

  it("broadband ran but service status is unknown (served=null): omitted, no_data — never 'not served'", () => {
    const e = baseEnrichment();
    e.broadband = { served: null, maxDownMbps: null, maxUpMbps: null, technologies: [], providerCount: null };
    e.provenance = { ...e.provenance, broadband: prov("FCC National Broadband Map (BDC)") };
    const profile = assembleLandProfile(baseProperty, e, false);
    expect(profile.broadband).toBeUndefined();
    expect(profile.gaps.find((g) => g.field === "broadband")?.reason).toBe("no_data");
  });
});

describe("wave-2 formatters — display only what the layer returned", () => {
  it("wildfire: label alone when no class; null on unknown/absent labels", () => {
    expect(formatWildfireHazardValue("moderate", null)).toBe("Moderate");
    expect(formatWildfireHazardValue("very_low", 1)).toBe("Very low (WHP class 1 of 5)");
    expect(formatWildfireHazardValue(null, 3)).toBeNull(); // class alone is not a label
    expect(formatWildfireHazardValue("bogus", 3)).toBeNull();
    expect(formatWildfireHazardValue(undefined, undefined)).toBeNull();
  });

  it("broadband: omits parts that were not returned; unknown served is null", () => {
    expect(
      formatBroadbandValue({ served: true, maxDownMbps: 25, maxUpMbps: null, technologies: [], providerCount: null }),
    ).toBe("Served · up to 25 Mbps");
    expect(
      formatBroadbandValue({ served: true, maxDownMbps: null, maxUpMbps: null, technologies: [], providerCount: 1 }),
    ).toBe("Served · 1 provider");
    expect(formatBroadbandValue({ served: false })).toBe("Not served (no fixed broadband reported)");
    expect(formatBroadbandValue({ served: null })).toBeNull();
    expect(formatBroadbandValue({})).toBeNull();
  });
});

describe("shared contract — wave-2 fields pinned", () => {
  it("the three keys are registered in labels + display order", () => {
    for (const key of ["wildfireHazard", "broadband", "septicSuitability"] as const) {
      expect(LAND_PROFILE_FIELD_ORDER).toContain(key);
      expect(LAND_PROFILE_FIELD_LABELS[key]).toBeTruthy();
    }
  });

  it("populated wave-2 fields carry the exact LandField shape", () => {
    const profile = assembleLandProfile(baseProperty, wave2Enrichment(), false);
    for (const key of ["wildfireHazard", "broadband", "septicSuitability"] as const) {
      const f = (profile as any)[key];
      expect(Object.keys(f).sort()).toEqual(
        ["asOf", "classification", "confidence", "source", "value"],
      );
      expect(typeof f.value).toBe("string");
    }
  });
});

describe("deriveIntel — wave-2 map-door honesty", () => {
  const NO_DATA_PROPERTY = { listPrice: null, sizeAcres: null, zoning: null };

  it("a bare parcel yields NO wave-2 values — nothing coalesced", () => {
    const intel = deriveIntel(null, NO_DATA_PROPERTY);
    expect(intel.wildfireHazard).toBeUndefined();
    expect(intel.broadbandServed).toBeUndefined();
    expect(intel.broadbandMaxDownMbps).toBeUndefined();
    expect(intel.broadbandMaxUpMbps).toBeUndefined();
    expect(intel.septicRating).toBeUndefined();
  });

  it("broadband speeds are registered as numeric fields the honesty ratchet checks", () => {
    expect(INTEL_NUMERIC_FIELDS).toContain("broadbandMaxDownMbps");
    expect(INTEL_NUMERIC_FIELDS).toContain("broadbandMaxUpMbps");
    const intel = deriveIntel(null, NO_DATA_PROPERTY);
    for (const field of INTEL_NUMERIC_FIELDS) {
      expect(intel[field as keyof PropertyIntelligence]).toBeUndefined();
    }
  });

  it("absent broadbandServed stays UNKNOWN — never silently false", () => {
    const intel = deriveIntel({ valuation: { floodZone: "AE" } }, NO_DATA_PROPERTY);
    expect(intel.broadbandServed).toBeUndefined();
  });

  it("real lookup values pass through faithfully, including a REAL false", () => {
    const intel = deriveIntel(
      {
        valuation: {
          wildfireHazard: "very_high",
          broadbandServed: false,
          broadbandMaxDownMbps: 0.2,
          septicRating: "Somewhat limited",
        },
      },
      NO_DATA_PROPERTY,
    );
    expect(intel.wildfireHazard).toBe("very_high");
    expect(intel.broadbandServed).toBe(false); // honest "not served"
    expect(intel.broadbandMaxDownMbps).toBe(0.2);
    expect(intel.broadbandMaxUpMbps).toBeUndefined();
    expect(intel.septicRating).toBe("Somewhat limited");
  });

  it("empty-string septic rating is not a value", () => {
    const intel = deriveIntel({ valuation: { septicRating: "  " } }, NO_DATA_PROPERTY);
    expect(intel.septicRating).toBeUndefined();
  });
});
