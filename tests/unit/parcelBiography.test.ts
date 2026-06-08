/**
 * Parcel Biography Engine — pure-derivation unit tests (Iyari #1).
 *
 * Covers: series ordering, assessed-value velocity/acceleration, owner-tenure +
 * deed cadence, tax-delinquency recurrence detection, and the HONESTY gates
 * (empty / single-point series must never fabricate a trend).
 */
import { describe, it, expect } from "vitest";
import {
  assembleBiography,
  buildFieldBiography,
  coerceNumeric,
  deriveNumericTrend,
  deriveOwnerTenure,
  deriveTaxRecurrence,
  isDelinquentStatus,
  type SeriesPoint,
} from "../../server/services/parcel-biography";

const YEAR = 365.25 * 24 * 60 * 60 * 1000;
const at = (yearsAgoFrom2020: number) => new Date(Date.UTC(2020 + yearsAgoFrom2020, 0, 1));

function pt(value: unknown, observedAt: Date, source = "county_gis"): SeriesPoint {
  return { value, numeric: coerceNumeric(value), source, confidence: null, observedAt };
}

describe("coerceNumeric", () => {
  it("parses numbers, $-strings, and rejects garbage", () => {
    expect(coerceNumeric(1000)).toBe(1000);
    expect(coerceNumeric("$1,250")).toBe(1250);
    expect(coerceNumeric(" 42 ")).toBe(42);
    expect(coerceNumeric("delinquent")).toBeNull();
    expect(coerceNumeric(null)).toBeNull();
    expect(coerceNumeric({})).toBeNull();
  });
});

describe("isDelinquentStatus", () => {
  it("matches common delinquency phrasings, casing-insensitive", () => {
    expect(isDelinquentStatus("DELINQUENT")).toBe(true);
    expect(isDelinquentStatus("Tax Lien")).toBe(true);
    expect(isDelinquentStatus("past due")).toBe(true);
    expect(isDelinquentStatus("current")).toBe(false);
    expect(isDelinquentStatus("paid")).toBe(false);
    expect(isDelinquentStatus(null)).toBe(false);
  });
});

describe("deriveNumericTrend — velocity / acceleration", () => {
  it("returns null for a single point (honesty gate — never fabricate)", () => {
    expect(deriveNumericTrend([pt(1000, at(0))])).toBeNull();
  });

  it("computes velocity per year across the span", () => {
    // 1000 -> 1200 over 2 years = +100/yr
    const trend = deriveNumericTrend([pt(1000, at(0)), pt(1200, at(2))]);
    expect(trend).not.toBeNull();
    expect(trend!.delta).toBe(200);
    expect(trend!.velocityPerYear).toBeCloseTo(100, 0);
    expect(trend!.pctChange).toBeCloseTo(0.2, 5);
    expect(trend!.direction).toBe("rising");
    // 2 points -> no acceleration yet
    expect(trend!.accelerationPerYear2).toBeNull();
  });

  it("computes positive acceleration when the climb speeds up", () => {
    // y0=1000, y2=1100 (+50/yr), y4=1400 (+150/yr) -> velocity increasing
    const trend = deriveNumericTrend([pt(1000, at(0)), pt(1100, at(2)), pt(1400, at(4))]);
    expect(trend).not.toBeNull();
    expect(trend!.accelerationPerYear2).not.toBeNull();
    expect(trend!.accelerationPerYear2!).toBeGreaterThan(0);
    expect(trend!.direction).toBe("rising");
  });

  it("computes negative acceleration when the climb stalls", () => {
    // first half +150/yr, second half +25/yr -> decelerating
    const trend = deriveNumericTrend([pt(1000, at(0)), pt(1300, at(2)), pt(1350, at(4))]);
    expect(trend!.accelerationPerYear2!).toBeLessThan(0);
  });

  it("flags mixed direction and a zero-span velocity", () => {
    const mixed = deriveNumericTrend([pt(1000, at(0)), pt(1500, at(1)), pt(900, at(2))]);
    expect(mixed!.direction).toBe("mixed");
    // All points same instant -> velocity null (no time elapsed)
    const sameInstant = deriveNumericTrend([pt(1000, at(0)), pt(1200, at(0))]);
    expect(sameInstant!.velocityPerYear).toBeNull();
  });

  it("ignores non-numeric points but keeps the numeric series", () => {
    const trend = deriveNumericTrend([pt("n/a", at(0)), pt(1000, at(1)), pt(1100, at(3))]);
    expect(trend).not.toBeNull();
    expect(trend!.firstValue).toBe(1000);
    expect(trend!.lastValue).toBe(1100);
  });
});

describe("deriveOwnerTenure — tenure clock + deed cadence", () => {
  it("collapses repeated owners and clocks current tenure", () => {
    const series = [
      pt("Alice", at(0)),
      pt("Alice", at(1)),
      pt("Bob", at(4)),
      pt("Bob", at(6)),
    ];
    const tenure = deriveOwnerTenure(series, at(10));
    expect(tenure).not.toBeNull();
    expect(tenure!.changeCount).toBe(1); // Alice -> Bob
    expect(tenure!.currentOwnerSince!.getTime()).toBe(at(4).getTime());
    expect(tenure!.currentTenureYears).toBe(6); // 2020+10 minus 2020+4
  });

  it("computes median deed cadence once ≥2 changes observed", () => {
    const series = [pt("A", at(0)), pt("B", at(3)), pt("C", at(6)), pt("D", at(9))];
    const tenure = deriveOwnerTenure(series, at(10));
    expect(tenure!.changeCount).toBe(3);
    expect(tenure!.medianYearsBetweenChanges).toBe(3);
  });

  it("returns null cadence with a single owner (no fabricated cadence)", () => {
    const tenure = deriveOwnerTenure([pt("Solo", at(0)), pt("Solo", at(2))], at(5));
    expect(tenure!.changeCount).toBe(0);
    expect(tenure!.medianYearsBetweenChanges).toBeNull();
  });

  it("skips unknown/blank owners", () => {
    expect(deriveOwnerTenure([pt("Unknown", at(0)), pt("", at(1))], at(2))).toBeNull();
  });
});

describe("deriveTaxRecurrence — recurrence detection", () => {
  it("detects a recurring every-3-years delinquency", () => {
    const series = [
      pt("current", at(0)),
      pt("delinquent", at(1)),
      pt("current", at(2)),
      pt("delinquent", at(4)),
      pt("current", at(5)),
      pt("delinquent", at(7)),
    ];
    const rec = deriveTaxRecurrence(series);
    expect(rec!.episodes).toBe(3);
    expect(rec!.isRecurring).toBe(true);
    expect(rec!.medianYearsBetweenEpisodes).toBe(3); // gaps 3,3
    expect(rec!.currentlyDelinquent).toBe(true);
  });

  it("treats a single sustained delinquency as one episode, not recurring", () => {
    const series = [pt("delinquent", at(0)), pt("delinquent", at(1)), pt("delinquent", at(2))];
    const rec = deriveTaxRecurrence(series);
    expect(rec!.episodes).toBe(1);
    expect(rec!.isRecurring).toBe(false);
    expect(rec!.delinquentCount).toBe(3);
  });

  it("reports never-delinquent cleanly", () => {
    const rec = deriveTaxRecurrence([pt("current", at(0)), pt("paid", at(1))]);
    expect(rec!.episodes).toBe(0);
    expect(rec!.isRecurring).toBe(false);
    expect(rec!.currentlyDelinquent).toBe(false);
  });
});

describe("buildFieldBiography — honesty gates", () => {
  it("empty series -> hasTrend false, no first/last, no trend", () => {
    const bio = buildFieldBiography("assessed_value", []);
    expect(bio.hasTrend).toBe(false);
    expect(bio.firstSeen).toBeNull();
    expect(bio.lastConfirmed).toBeNull();
    expect(bio.trend).toBeUndefined();
  });

  it("single point -> first seen == last confirmed, NO trend line", () => {
    const bio = buildFieldBiography("assessed_value", [pt(1000, at(0))]);
    expect(bio.hasTrend).toBe(false);
    expect(bio.firstSeen!.getTime()).toBe(at(0).getTime());
    expect(bio.lastConfirmed!.getTime()).toBe(at(0).getTime());
    expect(bio.trend).toBeUndefined();
  });

  it("two points -> hasTrend true with a real trend", () => {
    const bio = buildFieldBiography("assessed_value", [pt(1000, at(0)), pt(1100, at(1))]);
    expect(bio.hasTrend).toBe(true);
    expect(bio.trend).toBeDefined();
    expect(bio.sources).toEqual(["county_gis"]);
  });
});

describe("assembleBiography — full aggregation + ordering", () => {
  it("sorts each field oldest→newest regardless of input order", () => {
    const rows = [
      { field: "assessed_value", value: 1200, source: "county_gis", confidence: null, observedAt: at(2) },
      { field: "assessed_value", value: 1000, source: "county_gis", confidence: null, observedAt: at(0) },
      { field: "assessed_value", value: 1100, source: "regrid", confidence: 0.8, observedAt: at(1) },
      { field: "owner", value: "Alice", source: "county_gis", confidence: null, observedAt: at(0) },
      { field: "owner", value: "Bob", source: "county_gis", confidence: null, observedAt: at(3) },
      { field: "tax_status", value: "delinquent", source: "county_gis", confidence: null, observedAt: at(2) },
    ];
    const bio = assembleBiography("APN-1", "tx", "Travis", rows, at(5));

    // ordering
    const av = bio.assessedValue!;
    expect(av.series.map((p) => p.numeric)).toEqual([1000, 1100, 1200]);
    expect(av.firstSeen!.getTime()).toBe(at(0).getTime());
    expect(av.lastConfirmed!.getTime()).toBe(at(2).getTime());
    expect(av.hasTrend).toBe(true);
    expect(av.trend!.velocityPerYear).toBeCloseTo(100, 0); // +200 over 2y
    expect(av.sources.sort()).toEqual(["county_gis", "regrid"]);

    // owner tenure derived
    expect(bio.ownerTenure!.changeCount).toBe(1);
    expect(bio.ownerTenure!.currentTenureYears).toBe(2); // Bob since y3, asOf y5

    // tax recurrence derived
    expect(bio.taxRecurrence!.currentlyDelinquent).toBe(true);

    expect(bio.observationCount).toBe(6);
    expect(bio.hasAnySeries).toBe(true);
  });

  it("single-observation parcel reports honest empty-trend state", () => {
    const rows = [
      { field: "assessed_value", value: 1000, source: "county_gis", confidence: null, observedAt: at(0) },
    ];
    const bio = assembleBiography("APN-2", "TX", "Travis", rows);
    expect(bio.hasAnySeries).toBe(false);
    expect(bio.assessedValue!.hasTrend).toBe(false);
    expect(bio.assessedValue!.trend).toBeUndefined();
    expect(bio.taxStatus).toBeNull();
    expect(bio.owner).toBeNull();
  });

  it("zero observations -> well-formed empty biography", () => {
    const bio = assembleBiography("APN-3", "TX", "Travis", []);
    expect(bio.observationCount).toBe(0);
    expect(bio.hasAnySeries).toBe(false);
    expect(bio.assessedValue).toBeNull();
    expect(bio.ownerTenure).toBeNull();
    expect(bio.taxRecurrence).toBeNull();
  });
});
