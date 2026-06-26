import { describe, it, expect } from "vitest";
import {
  buildJwtClaims,
  buildSearchAnalyticsBody,
  summarizeSearchRows,
  isoDay,
  searchReachEvidence,
  SEARCH_REACH_IMPRESSION_FLOOR,
  SEARCH_REACH_SUCCESS_CAP,
} from "../../server/services/autopilot/searchConsoleSense";

describe("buildJwtClaims", () => {
  it("builds a 1-hour read-only webmasters assertion", () => {
    const c = buildJwtClaims("svc@proj.iam.gserviceaccount.com", 1_000_000);
    expect(c.iss).toBe("svc@proj.iam.gserviceaccount.com");
    expect(c.scope).toBe("https://www.googleapis.com/auth/webmasters.readonly");
    expect(c.aud).toBe("https://oauth2.googleapis.com/token");
    expect(c.iat).toBe(1_000_000);
    expect(c.exp).toBe(1_003_600);
  });
});

describe("isoDay", () => {
  it("formats yyyy-mm-dd in UTC", () => {
    expect(isoDay(new Date("2026-06-23T18:30:00Z"))).toBe("2026-06-23");
  });
});

describe("buildSearchAnalyticsBody", () => {
  it("builds a windowed aggregate query", () => {
    expect(buildSearchAnalyticsBody("2026-05-01", "2026-05-28")).toEqual({
      startDate: "2026-05-01",
      endDate: "2026-05-28",
      dimensions: [],
      rowLimit: 1,
    });
  });
});

describe("summarizeSearchRows — honest headline metrics", () => {
  it("summarizes a real row", () => {
    expect(summarizeSearchRows([{ impressions: 1234.6, clicks: 12, position: 14.27 }], 28)).toEqual({
      impressions: 1235,
      clicks: 12,
      avgPosition: 14.3,
      windowDays: 28,
    });
  });
  it("treats an empty result as genuine zeros with null position (not fabricated)", () => {
    expect(summarizeSearchRows([], 28)).toEqual({ impressions: 0, clicks: 0, avgPosition: null, windowDays: 28 });
    expect(summarizeSearchRows(undefined, 7)).toEqual({ impressions: 0, clicks: 0, avgPosition: null, windowDays: 7 });
  });
  it("never returns negatives", () => {
    expect(summarizeSearchRows([{ impressions: -5, clicks: -1 }], 28).impressions).toBe(0);
  });
});

describe("searchReachEvidence — the acquisition loop-closer (real GSC reach → world-model edge)", () => {
  const m = (impressions: number, clicks: number) => ({ impressions, clicks, avgPosition: null, windowDays: 28 });

  it("null metrics (GSC unconfigured) → {0,0}: no evidence, edge unchanged (safe-off)", () => {
    expect(searchReachEvidence(null)).toEqual({ successes: 0, failures: 0 });
  });

  it("real click-throughs are success evidence, capped", () => {
    expect(searchReachEvidence(m(5000, 3))).toEqual({ successes: 3, failures: 0 });
    expect(searchReachEvidence(m(5000, 999))).toEqual({ successes: SEARCH_REACH_SUCCESS_CAP, failures: 0 });
  });

  it("meaningful impressions without clicks → a single weaker success", () => {
    expect(searchReachEvidence(m(SEARCH_REACH_IMPRESSION_FLOOR, 0))).toEqual({ successes: 1, failures: 0 });
  });

  it("HONESTY: low/zero reach during the indexing lag is NEVER a failure (absence ≠ failure)", () => {
    expect(searchReachEvidence(m(0, 0))).toEqual({ successes: 0, failures: 0 });
    expect(searchReachEvidence(m(SEARCH_REACH_IMPRESSION_FLOOR - 1, 0))).toEqual({ successes: 0, failures: 0 });
    // it can ONLY ever produce successes or nothing — failures stay 0 for every input
    for (const [i, c] of [[0, 0], [50, 0], [99, 0], [100, 0], [9999, 50]] as const) {
      expect(searchReachEvidence(m(i, c)).failures).toBe(0);
    }
  });

  it("is total on noisy input (negatives / fractions floored)", () => {
    expect(searchReachEvidence(m(-10, -1))).toEqual({ successes: 0, failures: 0 });
    expect(searchReachEvidence(m(250.9, 2.7))).toEqual({ successes: 2, failures: 0 });
  });
});
