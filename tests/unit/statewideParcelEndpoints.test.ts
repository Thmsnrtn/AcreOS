/**
 * Statewide parcel endpoints (Open-Data Phase 3) — pure-logic unit tests.
 *
 * Guards three things:
 *   1. Seed shape: every statewide seed row passes the drizzle-zod insert
 *      schema AND the SSRF guard (https + public host), uses the "*"
 *      statewide sentinel, and is internally consistent (apnField mirrored
 *      in fieldMappings, ArcGIS endpoint type the point path can query).
 *   2. Point→state routing: statesForPoint returns the right candidate
 *      state for a live-verified probe point in EVERY seeded state (so no
 *      seed is unreachable by the bbox router), and nothing for points
 *      outside all seeded states or with invalid coordinates.
 *   3. Query construction: buildArcgisPointQueryParams always requests
 *      outSR=4326 (FL is EPSG:3086 and NC is EPSG:2264 natively — the
 *      ring normalizer only understands WGS84 + Web Mercator), point
 *      intersection semantics, and merges per-row additionalParams.
 */

import { describe, it, expect } from "vitest";
import {
  STATEWIDE_COUNTY,
  STATEWIDE_PARCEL_ENDPOINTS,
  statesForPoint,
  buildArcgisPointQueryParams,
} from "../../server/services/statewideParcelEndpoints";
import { insertCountyGisEndpointSchema } from "../../shared/schema";
import { checkOperatorUrl } from "../../server/services/providers/ssrf-guard";

// One live-verified probe point per seeded state (the same points used to
// verify the services empirically on 2026-07-13).
const PROBE_POINTS: Record<string, { lat: number; lng: number }> = {
  FL: { lat: 30.438, lng: -84.2821 }, // Tallahassee (FL Capitol parcel)
  MT: { lat: 45.677, lng: -111.0429 }, // Bozeman
  NC: { lat: 35.8436, lng: -78.6445 }, // Raleigh (North Hills)
  WA: { lat: 47.0379, lng: -122.9007 }, // Olympia
  NJ: { lat: 40.2206, lng: -74.7699 }, // Trenton
  AR: { lat: 34.7465, lng: -92.2896 }, // Little Rock
  TN: { lat: 35.9965, lng: -85.9032 }, // DeKalb County
};

describe("STATEWIDE_PARCEL_ENDPOINTS seed rows", () => {
  it("every row validates against the county_gis_endpoints insert schema", () => {
    for (const seed of STATEWIDE_PARCEL_ENDPOINTS) {
      const row = { ...seed, isActive: true, isVerified: false, contributedBy: "system" };
      const parsed = insertCountyGisEndpointSchema.safeParse(row);
      expect(parsed.success, `${seed.state}: ${JSON.stringify(parsed.success ? "" : parsed.error.issues)}`).toBe(true);
    }
  });

  it("every baseUrl passes the SSRF guard (https, public host)", () => {
    for (const seed of STATEWIDE_PARCEL_ENDPOINTS) {
      const check = checkOperatorUrl(seed.baseUrl);
      expect(check.ok, `${seed.state}: ${check.reason ?? ""}`).toBe(true);
    }
  });

  it("rows use the statewide sentinel and unique 2-letter states", () => {
    const states = new Set<string>();
    for (const seed of STATEWIDE_PARCEL_ENDPOINTS) {
      expect(seed.county).toBe(STATEWIDE_COUNTY);
      expect(seed.state).toMatch(/^[A-Z]{2}$/);
      expect(states.has(seed.state), `duplicate statewide row for ${seed.state}`).toBe(false);
      states.add(seed.state);
    }
  });

  it("rows are queryable by the point path: ArcGIS type, numeric layerId, consistent apn mapping", () => {
    for (const seed of STATEWIDE_PARCEL_ENDPOINTS) {
      expect(["arcgis_rest", "arcgis_feature"]).toContain(seed.endpointType);
      expect(seed.layerId).toMatch(/^\d+$/);
      expect(seed.apnField.length).toBeGreaterThan(0);
      expect(seed.fieldMappings.apn).toBe(seed.apnField);
      // baseUrl is the service root — the lookup appends /<layerId>/query itself.
      expect(seed.baseUrl.endsWith("/")).toBe(false);
      expect(seed.baseUrl).not.toMatch(/\/query$/i);
      expect(seed.baseUrl).toMatch(/\/(FeatureServer|MapServer)$/);
      // No fabricated blank mappings.
      for (const [key, value] of Object.entries(seed.fieldMappings)) {
        expect(typeof value, `${seed.state}.fieldMappings.${key}`).toBe("string");
        expect((value as string).length).toBeGreaterThan(0);
      }
      // Attribution + source provenance are mandatory for open-data rows.
      expect(seed.attribution.length).toBeGreaterThan(0);
      expect(seed.sourceUrl.startsWith("https://")).toBe(true);
    }
  });
});

describe("statesForPoint", () => {
  it("routes a verified in-state probe point to every seeded state", () => {
    for (const seed of STATEWIDE_PARCEL_ENDPOINTS) {
      const probe = PROBE_POINTS[seed.state];
      expect(probe, `missing probe point for ${seed.state}`).toBeDefined();
      expect(statesForPoint(probe.lat, probe.lng)).toContain(seed.state);
    }
  });

  it("returns nothing for a point outside all seeded states", () => {
    // Topeka, KS — no seeded statewide service.
    expect(statesForPoint(39.0473, -95.678)).toEqual([]);
    // Middle of the Pacific.
    expect(statesForPoint(0, -150)).toEqual([]);
  });

  it("returns nothing for invalid coordinates", () => {
    expect(statesForPoint(NaN, -84)).toEqual([]);
    expect(statesForPoint(30, NaN)).toEqual([]);
    expect(statesForPoint(91, -84)).toEqual([]);
    expect(statesForPoint(30, -181)).toEqual([]);
  });

  it("border overlap can return multiple candidates (routing hint, not a claim)", () => {
    // Bristol sits on the TN/NC-adjacent corridor: candidates are tried in
    // turn and a wrong candidate just returns zero features.
    const candidates = statesForPoint(36.5951, -82.1887);
    expect(candidates).toContain("TN");
  });
});

describe("buildArcgisPointQueryParams", () => {
  it("builds a WGS84 point-intersection query with outSR=4326", () => {
    const params = buildArcgisPointQueryParams(30.438, -84.2821);
    expect(params.get("geometry")).toBe("-84.2821,30.438");
    expect(params.get("geometryType")).toBe("esriGeometryPoint");
    expect(params.get("inSR")).toBe("4326");
    expect(params.get("outSR")).toBe("4326");
    expect(params.get("spatialRel")).toBe("esriSpatialRelIntersects");
    expect(params.get("returnGeometry")).toBe("true");
    expect(params.get("f")).toBe("json");
    expect(params.get("outFields")).toBe("*");
  });

  it("merges per-endpoint additionalParams (row-level override wins)", () => {
    const params = buildArcgisPointQueryParams(45.0, -111.0, { outFields: "PARCELID", token: "x" });
    expect(params.get("outFields")).toBe("PARCELID");
    expect(params.get("token")).toBe("x");
    expect(params.get("outSR")).toBe("4326");
  });
});
