import { describe, it, expect } from "vitest";
import {
  buildJwtClaims,
  buildSearchAnalyticsBody,
  summarizeSearchRows,
  isoDay,
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
