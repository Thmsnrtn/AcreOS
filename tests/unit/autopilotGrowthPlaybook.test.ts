import { describe, it, expect } from "vitest";
import {
  GROWTH_PLAYS,
  selectNextGrowthPlay,
  growthPlayById,
  growthPlayRationale,
} from "../../server/services/autopilot/growthPlaybook";

describe("autopilot growth playbook — owned, $0, tasteful, rotating", () => {
  it("every play is owned (not customer-facing) and carries a concrete brief", () => {
    expect(GROWTH_PLAYS.length).toBeGreaterThanOrEqual(3);
    for (const p of GROWTH_PLAYS) {
      expect(p.isCustomerFacing).toBe(false); // owned surfaces, not sends
      expect(p.brief.length).toBeGreaterThan(40);
      expect(p.id).toMatch(/^[a-z-]+$/);
    }
  });

  it("no play instructs hype, fabrication, or fake urgency — the briefs forbid it", () => {
    const joined = GROWTH_PLAYS.map((p) => p.brief).join(" ").toLowerCase();
    // the briefs explicitly steer AWAY from these — sanity check the catalog's spirit
    expect(joined).toMatch(/never invent|no hype|honest|accurate|no sales angle|no marketing padding/);
  });

  it("selectNextGrowthPlay rotates deterministically and is total over any integer", () => {
    const n = GROWTH_PLAYS.length;
    expect(selectNextGrowthPlay(0).id).toBe(GROWTH_PLAYS[0].id);
    expect(selectNextGrowthPlay(1).id).toBe(GROWTH_PLAYS[1].id);
    // wraps cleanly
    expect(selectNextGrowthPlay(n).id).toBe(GROWTH_PLAYS[0].id);
    // handles negatives without throwing or returning undefined
    expect(selectNextGrowthPlay(-1).id).toBe(GROWTH_PLAYS[n - 1].id);
    // a full cycle hits every play exactly once
    const cycle = new Set(Array.from({ length: n }, (_, i) => selectNextGrowthPlay(i).id));
    expect(cycle.size).toBe(n);
  });

  it("growthPlayById round-trips and returns null for unknown ids", () => {
    expect(growthPlayById(GROWTH_PLAYS[0].id)?.id).toBe(GROWTH_PLAYS[0].id);
    expect(growthPlayById("does-not-exist")).toBeNull();
  });

  it("growthPlayRationale yields a concrete title + brief (the move's specialized 'what')", () => {
    const r = growthPlayRationale(GROWTH_PLAYS[0]);
    expect(r).toContain(GROWTH_PLAYS[0].title);
    expect(r.length).toBeGreaterThan(GROWTH_PLAYS[0].title.length + 10);
  });
});
