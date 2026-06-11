/**
 * County SEO generator — broker-payload normalizer contract (T3-3A Phase 3).
 *
 * scripts/county-page-lib.mjs is the build-script layer for the /learn/county
 * generator. Its load-bearing piece is normalizeBrokerPayload(), which maps the
 * data-source broker's RAW per-category payloads (flood_zone / soil / elevation)
 * into the { value, note, source, asOf } display-figure shape the county page
 * consumes — and, critically, refuses to invent a figure when the broker payload
 * lacks a real value or a real freshness date (the truth-ratchet).
 *
 * This proves the capability WITHOUT a live broker: we feed representative MOCK
 * BrokerResult payloads and assert (a) the normalized shape and field mapping,
 * and (b) that incomplete/malformed data is REJECTED (null), never fabricated.
 *
 * The broker's raw payload shapes mirrored here come from
 * server/services/data-source-broker.ts (queryFemaFlood / querySoilData /
 * queryElevation return blocks).
 */
import { describe, it, expect } from "vitest";
import {
  normalizeBrokerPayload,
  resolveCentroid,
  normalizeFips,
  applySubsetGuard,
  toIsoDate,
  FIPS_CENTROIDS,
  SUBSET_ALLOWLIST_FIPS,
  // @ts-expect-error — .mjs sibling script module, no .d.ts
} from "../../scripts/county-page-lib.mjs";

// A BrokerResult-shaped entry wrapping a raw per-category data payload.
function brokerResult(data: unknown, success = true) {
  return { success, data, source: { id: 1, title: "FEMA NFHL", tier: "free", costCents: 0 } };
}

describe("normalizeBrokerPayload — broker → figure field mapping", () => {
  it("normalizes a COMPLETE payload into full sourced figures", () => {
    const payload = {
      flood: brokerResult({
        zone: "Zone AE",
        riskLevel: "high",
        source: "FEMA NFHL",
        lastUpdated: "2026-06-01T00:00:00.000Z",
        details: { FLD_ZONE: "AE" },
      }),
      soil: brokerResult({
        soilType: "Caralampi gravelly sandy loam",
        soilSymbol: "C12",
        suitability: "limited",
        drainage: "Well drained",
        capabilityClass: "VII",
        source: "USDA NRCS SDA",
        lastUpdated: "2026-05-15T00:00:00.000Z",
      }),
      elevation: brokerResult({
        elevationFeet: 4287,
        elevationMeters: 1307,
        datum: "NAVD88",
        source: "USGS 3DEP National Map",
        queryDate: "2026-04-30",
        lastUpdated: "2026-06-10T00:00:00.000Z",
      }),
    };

    const out = normalizeBrokerPayload(payload);

    // All three figures present and shaped { value, note, source:{name,url}, asOf }.
    for (const key of ["elevation", "soil", "flood"] as const) {
      expect(out[key]).not.toBeNull();
      expect(typeof out[key].value).toBe("string");
      expect(out[key].value.length).toBeGreaterThan(0);
      expect(out[key].source.name.length).toBeGreaterThan(0);
      expect(out[key].asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }

    // Field mapping assertions.
    expect(out.flood.value).toContain("Zone AE");
    expect(out.flood.value).toContain("high");
    expect(out.flood.source.name).toContain("FEMA");
    expect(out.flood.asOf).toBe("2026-06-01"); // from lastUpdated

    expect(out.soil.value).toContain("Caralampi gravelly sandy loam");
    expect(out.soil.value).toContain("C12");
    expect(out.soil.source.name).toContain("SSURGO");
    expect(out.soil.asOf).toBe("2026-05-15");

    expect(out.elevation.value).toContain("4,287 ft");
    expect(out.elevation.value).toContain("NAVD88");
    expect(out.elevation.source.name).toContain("USGS");
    expect(out.elevation.asOf).toBe("2026-04-30"); // queryDate preferred over lastUpdated
  });

  it("prefers the broker LookupResult sourceAsOf over the payload date", () => {
    const out = normalizeBrokerPayload({
      flood: {
        success: true,
        sourceAsOf: "2025-12-31",
        data: { zone: "Zone X", riskLevel: "low", lastUpdated: "2026-06-10T00:00:00.000Z" },
      },
    });
    expect(out.flood).not.toBeNull();
    expect(out.flood.asOf).toBe("2025-12-31");
  });

  it("PARTIAL payload missing flood → flood figure is null (quality-bar fail), others still map", () => {
    const out = normalizeBrokerPayload({
      flood: null, // category failed at the broker
      soil: brokerResult({
        soilType: "Aridisol complex",
        soilSymbol: "A9",
        drainage: "Excessively drained",
        lastUpdated: "2026-05-15",
      }),
      elevation: brokerResult({
        elevationFeet: 3580,
        datum: "NAVD88",
        queryDate: "2026-05-01",
      }),
    });
    expect(out.flood).toBeNull(); // never invented
    expect(out.soil).not.toBeNull();
    expect(out.elevation).not.toBeNull();
  });

  it("rejects a figure whose value is present but freshness date is MISSING (no fabricated asOf)", () => {
    const out = normalizeBrokerPayload({
      elevation: brokerResult({
        elevationFeet: 4000,
        datum: "NAVD88",
        // no queryDate, no lastUpdated, no sourceAsOf
      }),
    });
    expect(out.elevation).toBeNull();
  });

  it("rejects an UNSUCCESSFUL broker result even if it carries data", () => {
    const out = normalizeBrokerPayload({
      flood: brokerResult(
        { zone: "Zone AE", riskLevel: "high", lastUpdated: "2026-06-01" },
        false, // success:false
      ),
    });
    expect(out.flood).toBeNull();
  });

  it("rejects a soil payload whose map unit is Unknown (no real named figure)", () => {
    const out = normalizeBrokerPayload({
      soil: brokerResult({
        soilType: "Unknown",
        soilSymbol: "Unknown",
        lastUpdated: "2026-05-15",
      }),
    });
    expect(out.soil).toBeNull();
  });

  it("MALFORMED inputs are safely skipped (null / undefined / wrong types)", () => {
    expect(normalizeBrokerPayload(null)).toEqual({ elevation: null, soil: null, flood: null });
    expect(normalizeBrokerPayload(undefined)).toEqual({ elevation: null, soil: null, flood: null });
    expect(normalizeBrokerPayload("nonsense")).toEqual({ elevation: null, soil: null, flood: null });
    const out = normalizeBrokerPayload({
      flood: brokerResult({ zone: 12345 /* wrong type */, lastUpdated: "2026-06-01" }),
      soil: brokerResult({}),
      elevation: brokerResult({ elevationFeet: "tall" /* wrong type */, queryDate: "2026-01-01" }),
    });
    expect(out.flood).toBeNull();
    expect(out.soil).toBeNull();
    expect(out.elevation).toBeNull();
  });
});

describe("toIsoDate — date guard (never default to today)", () => {
  it("passes a real ISO date, coerces a Date, rejects garbage", () => {
    expect(toIsoDate("2026-06-01")).toBe("2026-06-01");
    expect(toIsoDate("2026-06-01T12:34:56.000Z")).toBe("2026-06-01");
    expect(toIsoDate(new Date("2026-03-15T00:00:00Z"))).toBe("2026-03-15");
    expect(toIsoDate("not-a-date")).toBeNull();
    expect(toIsoDate(null)).toBeNull();
    expect(toIsoDate(undefined)).toBeNull();
  });
});

describe("resolveCentroid + FIPS fallback (never fabricate coordinates)", () => {
  it("uses the registry row's own centroid when present", () => {
    const c = resolveCentroid({ centroid: { latitude: 1.5, longitude: -2.5 } });
    expect(c).toEqual({ latitude: 1.5, longitude: -2.5 });
  });

  it("falls back to the FIPS-centroid asset (verified seed-derived coords)", () => {
    const c = resolveCentroid({ fipsCode: "04003" }); // Cochise AZ
    expect(c).toEqual(FIPS_CENTROIDS["04003"] && {
      latitude: FIPS_CENTROIDS["04003"].latitude,
      longitude: FIPS_CENTROIDS["04003"].longitude,
    });
  });

  it("returns null for a county with no centroid anywhere → caller SKIPS, never fabricates", () => {
    expect(resolveCentroid({ fipsCode: "48999" })).toBeNull();
    expect(resolveCentroid({})).toBeNull();
  });

  it("normalizeFips pads 4-digit and rejects junk", () => {
    expect(normalizeFips("4003")).toBe("04003");
    expect(normalizeFips("48043")).toBe("48043");
    expect(normalizeFips(48043)).toBe("48043");
    expect(normalizeFips("abc")).toBeNull();
    expect(normalizeFips(null)).toBeNull();
  });
});

describe("applySubsetGuard — Option-A bundle-blowup guard", () => {
  it("admits only allowlisted FIPS and skips the rest with a reason", () => {
    const counties = [
      { state: "AZ", county: "Cochise", fipsCode: "04003" }, // allowed
      { state: "CA", county: "Los Angeles", fipsCode: "06037" }, // not allowlisted
      { state: "TX", county: "Brewster", fipsCode: "48043" }, // allowed
      { state: "??", county: "NoFips" }, // no fips
    ];
    const { allowed, skipped } = applySubsetGuard(counties);
    expect(allowed.map((c: any) => c.fipsCode).sort()).toEqual(["04003", "48043"]);
    expect(skipped).toHaveLength(2);
    for (const s of skipped) expect(typeof s.reason).toBe("string");
  });

  it("enforces a hard cap so a registry run can never fan out everything", () => {
    const allow = new Set(["04003", "48043"]);
    const counties = [
      { state: "AZ", county: "Cochise", fipsCode: "04003" },
      { state: "TX", county: "Brewster", fipsCode: "48043" },
    ];
    const { allowed, skipped } = applySubsetGuard(counties, { allowlist: allow, cap: 1 });
    expect(allowed).toHaveLength(1);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].reason).toContain("hard cap");
  });

  it("the shipped allowlist is bounded (Option A — never the full ~3,100)", () => {
    expect(SUBSET_ALLOWLIST_FIPS.size).toBeLessThanOrEqual(50);
    expect(SUBSET_ALLOWLIST_FIPS.has("04003")).toBe(true); // Cochise on the customer-market list
  });
});
