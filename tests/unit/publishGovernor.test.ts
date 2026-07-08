import { describe, it, expect } from "vitest";
import { allowedPublishesPerDay } from "../../server/services/autopilot/publishGovernor";

describe("allowedPublishesPerDay — authority-paced publish brake", () => {
  it("FREEZES (0/day) when reputation is degraded", () => {
    const r = allowedPublishesPerDay({ gscImpressions: 5000, publishedTotal: 50, reputationOk: false });
    expect(r.allowedPerDay).toBe(0);
    expect(r.reason).toMatch(/frozen/i);
  });

  it("holds BASE pace when there's no search signal yet (cold-start)", () => {
    const r = allowedPublishesPerDay({ gscImpressions: null, publishedTotal: 0, reputationOk: true, base: 1 });
    expect(r.allowedPerDay).toBe(1);
    expect(r.reason).toMatch(/no search-authority signal/i);
  });

  it("holds BASE while indexed but not yet earning impressions", () => {
    const r = allowedPublishesPerDay({ gscImpressions: 0, publishedTotal: 30, reputationOk: true, base: 1, impressionsPerExtraSlot: 500 });
    expect(r.allowedPerDay).toBe(1);
    expect(r.reason).toMatch(/not yet earning/i);
  });

  it("does NOT widen for a big page count with ~no impressions (anti published-into-a-void)", () => {
    const r = allowedPublishesPerDay({ gscImpressions: 200, publishedTotal: 500, reputationOk: true, base: 1, impressionsPerExtraSlot: 500 });
    expect(r.allowedPerDay).toBe(1); // floor(200/500) = 0 extra
  });

  it("widens one slot per impressions-per-slot as authority accrues", () => {
    expect(allowedPublishesPerDay({ gscImpressions: 1500, publishedTotal: 40, reputationOk: true, base: 1, impressionsPerExtraSlot: 500 }).allowedPerDay).toBe(4); // 1 + floor(1500/500)
  });

  it("clamps to the ceiling", () => {
    expect(allowedPublishesPerDay({ gscImpressions: 100000, publishedTotal: 40, reputationOk: true, base: 1, max: 5, impressionsPerExtraSlot: 500 }).allowedPerDay).toBe(5);
  });
});
