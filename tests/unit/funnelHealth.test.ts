import { describe, it, expect } from "vitest";
import { assessFunnelHealth, IMPRESSION_GRACE_DAYS, SIGNUP_GRACE_DAYS } from "../../server/services/autopilot/funnelHealth";

describe("assessFunnelHealth — work-done vs demand-captured honesty", () => {
  it("not_started when nothing is published", () => {
    const r = assessFunnelHealth({ publishedTotal: 0, daysSinceFirstPublish: null, gscImpressions: null, attributedSignups: 0 });
    expect(r.status).toBe("not_started");
    expect(r.starved).toBe(false);
  });

  it("does NOT flag a stall before the indexing grace window (SEO dead-time is expected)", () => {
    const r = assessFunnelHealth({ publishedTotal: 10, daysSinceFirstPublish: IMPRESSION_GRACE_DAYS - 1, gscImpressions: 0, attributedSignups: 0 });
    expect(r.starved).toBe(false);
    expect(r.status).toBe("building");
  });

  it("FLAGS discovery stall: published, 0 impressions past the grace window", () => {
    const r = assessFunnelHealth({ publishedTotal: 20, daysSinceFirstPublish: IMPRESSION_GRACE_DAYS + 5, gscImpressions: 0, attributedSignups: 0 });
    expect(r.status).toBe("starved_discovery");
    expect(r.starved).toBe(true);
    expect(r.line).toMatch(/void/i);
  });

  it("FLAGS conversion stall: earning impressions but 0 signups past the signup window", () => {
    const r = assessFunnelHealth({ publishedTotal: 20, daysSinceFirstPublish: SIGNUP_GRACE_DAYS + 1, gscImpressions: 4000, attributedSignups: 0 });
    expect(r.status).toBe("starved_conversion");
    expect(r.starved).toBe(true);
  });

  it("is UNKNOWN (not a stall) when Search Console isn't connected", () => {
    const r = assessFunnelHealth({ publishedTotal: 20, daysSinceFirstPublish: 60, gscImpressions: null, attributedSignups: 0 });
    expect(r.status).toBe("unknown");
    expect(r.starved).toBe(false);
  });

  it("is BUILDING (healthy) when impressions + signups are flowing", () => {
    const r = assessFunnelHealth({ publishedTotal: 30, daysSinceFirstPublish: 40, gscImpressions: 5000, attributedSignups: 3 });
    expect(r.status).toBe("building");
    expect(r.starved).toBe(false);
    expect(r.line).toMatch(/flywheel is turning/i);
  });
});
