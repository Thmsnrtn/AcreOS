/**
 * Map-door data-honesty contract.
 *
 * The #1 trust risk in the product was the client FABRICATING parcel facts
 * when a lookup was missing: `floodZone ?? "X"` (defaulting a deal-killer to
 * SAFE), `soilQuality ?? 65`, a `Math.sin`-derived slope, `opportunityScore
 * ?? 71`, etc. A land investor who catches one invented number on their own
 * parcel discounts every number in the app — and on a land deal that's a
 * five-figure mistake.
 *
 * These tests lock the fix in place: a parcel with NO enrichment data must
 * yield ZERO fabricated numeric scores and NO default flood zone.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { deriveIntel, INTEL_NUMERIC_FIELDS, type PropertyIntelligence } from "../../client/src/pages/maps-intel";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAPS_TSX = resolve(__dirname, "../../client/src/pages/maps.tsx");

const NO_DATA_PROPERTY = {
  listPrice: null,
  sizeAcres: null,
  zoning: null,
};

describe("deriveIntel — no-data parcel renders zero fabricated facts", () => {
  it("returns NO numeric scores when the AVM lookup is empty", () => {
    const intel = deriveIntel(null, NO_DATA_PROPERTY);
    for (const field of INTEL_NUMERIC_FIELDS) {
      expect(intel[field as keyof PropertyIntelligence]).toBeUndefined();
    }
  });

  it("never defaults the flood zone to 'X' (or anything) — the worst fabrication", () => {
    const intel = deriveIntel(null, NO_DATA_PROPERTY);
    expect(intel.floodZone).toBeUndefined();
    expect(intel.floodRisk).toBeUndefined();
  });

  it("never derives slope from coordinates / a trig hash", () => {
    // The old code did `Math.abs(Math.sin(lat * 0.1) * 15)`. There is no lat/lng
    // input here at all anymore — slope can ONLY come from real terrain data.
    const intel = deriveIntel(null, NO_DATA_PROPERTY);
    expect(intel.slopeGrade).toBeUndefined();
    expect(intel.slopeAspect).toBeUndefined();
    expect(intel.slopeRisk).toBeUndefined();
  });

  it("treats absent access flags as UNKNOWN, never silently false", () => {
    const intel = deriveIntel(null, NO_DATA_PROPERTY);
    expect(intel.roadAccess).toBeUndefined();
    expect(intel.waterAccess).toBeUndefined();
    expect(intel.powerAccess).toBeUndefined();
  });

  it("does not invent zoning, opportunity, solar, or soil constants", () => {
    const intel = deriveIntel({ valuation: null }, NO_DATA_PROPERTY);
    expect(intel.zoningCode).toBeUndefined();
    expect(intel.zoningDescription).toBeUndefined();
    expect(intel.opportunityScore).toBeUndefined();
    expect(intel.solarScore).toBeUndefined();
    expect(intel.soilQuality).toBeUndefined();
  });

  it("emits no value at all (a fully empty view-model) for a bare parcel", () => {
    const intel = deriveIntel(null, NO_DATA_PROPERTY);
    const defined = Object.values(intel).filter((v) => v !== undefined && v !== false);
    expect(defined).toHaveLength(0);
  });
});

describe("deriveIntel — customer-supplied facts are honest, not fabricated", () => {
  it("uses the customer's own list price as estimatedValue, flagged as such", () => {
    const intel = deriveIntel(null, { listPrice: "50000", sizeAcres: "10", zoning: null });
    expect(intel.estimatedValue).toBe(50000);
    expect(intel.estimatedValueIsListPrice).toBe(true);
    expect(intel.pricePerAcre).toBe(5000);
    // But it must NOT manufacture a confidence or a market trend out of thin air.
    expect(intel.valueConfidence).toBeUndefined();
    expect(intel.marketTrend).toBeUndefined();
    expect(intel.marketTrendPct).toBeUndefined();
  });

  it("passes the record's zoning through (a county/customer fact)", () => {
    const intel = deriveIntel(null, { listPrice: null, sizeAcres: "5", zoning: "RR-1" });
    expect(intel.zoningCode).toBe("RR-1");
    expect(intel.zoningDescription).toBeUndefined();
  });
});

/**
 * no-synthetic-series source contract.
 *
 * The Map door once rendered a fabricated 6-month price-per-acre AreaChart
 * built from `Math.sin()` noise (`generatePriceTrendData`) with a per-month
 * dollar tooltip that read as real history, plus a `syntheticBoundary()`
 * polygon drawn as an authoritative surveyed lot line. Both are deleted. This
 * scans the source so they cannot regress: no fabricated time-series may be
 * synthesized and charted on the parcel-intel surface.
 */
describe("maps.tsx — no-synthetic-series contract", () => {
  const src = readFileSync(MAPS_TSX, "utf8");

  it("does not synthesize a price-history / trend series", () => {
    expect(src).not.toMatch(/generatePriceTrendData/);
    expect(src).not.toMatch(/Math\.sin/);
  });

  it("does not render a fabricated AreaChart sparkline", () => {
    expect(src).not.toMatch(/<AreaChart/);
    expect(src).not.toMatch(/\bAreaChart\b/);
  });

  it("does not fabricate an authoritative parcel boundary polygon", () => {
    expect(src).not.toMatch(/syntheticBoundary/);
  });

  it("only hands the map a real boundary, flagging the rest approximate", () => {
    // The mapped property object must carry an explicit `isApproximate` flag and
    // must NOT fall back to a fabricated polygon when the real one is missing.
    expect(src).toMatch(/isApproximate/);
  });
});

describe("deriveIntel — real lookup data passes through faithfully", () => {
  it("surfaces real AVM values AND their provenance", () => {
    const intel = deriveIntel(
      {
        valuation: {
          estimatedValue: 82000,
          confidence: 80,
          floodZone: "AE",
          floodRisk: "high",
          soilQuality: 71,
          slopeGrade: 3.2,
          slopeAspect: 180,
          roadAccess: false,
          opportunityScore: 64,
          source: "FEMA NFHL",
          sourceAsOf: "2024",
          classification: "authoritative",
        },
      },
      { listPrice: "90000", sizeAcres: "20", zoning: "AG" },
    );
    expect(intel.estimatedValue).toBe(82000); // AVM wins over list price
    expect(intel.estimatedValueIsListPrice).toBe(false);
    expect(intel.floodZone).toBe("AE");
    expect(intel.floodRisk).toBe("high");
    expect(intel.soilQuality).toBe(71);
    expect(intel.slopeGrade).toBe(3.2);
    expect(intel.slopeAspect).toBe(180);
    expect(intel.roadAccess).toBe(false); // a REAL false is honest
    expect(intel.source).toBe("FEMA NFHL");
    expect(intel.sourceAsOf).toBe("2024");
    expect(intel.classification).toBe("authoritative");
  });
});
