import { describe, it, expect } from "vitest";
import {
  outcomeOf,
  statsFromExperiences,
  EVAL_PASS_THRESHOLD,
} from "../../server/services/autopilot/experienceLog";

describe("autopilot experience log — honest signal → vote", () => {
  it("the founder's verdict is ground truth and wins over everything", () => {
    expect(outcomeOf({ founderVerdict: "approved", dispatchSuccess: false, evalScore: 0.1 })).toBe("success");
    expect(outcomeOf({ founderVerdict: "declined", dispatchSuccess: true, evalScore: 0.99 })).toBe("failure");
  });

  it("support resolution counts: resolved = success, reopened = failure", () => {
    expect(outcomeOf({ resolution: "resolved" })).toBe("success");
    expect(outcomeOf({ resolution: "reopened" })).toBe("failure");
  });

  it("a resolved-but-unhappy case (satisfaction ≤ 2) is a failure, not a win", () => {
    expect(outcomeOf({ resolution: "resolved", satisfaction: 1 })).toBe("failure");
    expect(outcomeOf({ resolution: "resolved", satisfaction: 5 })).toBe("success");
  });

  it("the eval gate fails a low-scored output even if the dispatch ran", () => {
    expect(outcomeOf({ dispatchSuccess: true, evalScore: EVAL_PASS_THRESHOLD - 0.01 })).toBe("failure");
    expect(outcomeOf({ dispatchSuccess: true, evalScore: EVAL_PASS_THRESHOLD })).toBe("success");
  });

  it("a clean dispatch with no eval scored still counts as success (mechanical floor)", () => {
    expect(outcomeOf({ dispatchSuccess: true })).toBe("success");
    expect(outcomeOf({ dispatchSuccess: false })).toBe("failure");
  });

  it("HONESTY: an experience with no real signal yet does NOT vote (pending)", () => {
    expect(outcomeOf({})).toBe("pending");
    expect(outcomeOf({ dispatchSuccess: null, evalScore: null, founderVerdict: null })).toBe("pending");
  });

  it("statsFromExperiences aggregates per play and ignores pending + play-less rows", () => {
    const stats = statsFromExperiences([
      { playId: "county-guide", founderVerdict: "approved" },
      { playId: "county-guide", founderVerdict: "approved" },
      { playId: "county-guide", founderVerdict: "declined" },
      { playId: "parcel-explainer", dispatchSuccess: true },
      { playId: "parcel-explainer", evalScore: 0.2, dispatchSuccess: true }, // eval fail
      { playId: "still-running", dispatchSuccess: null }, // pending — no vote
      { playId: null, founderVerdict: "approved" }, // no play — ignored
    ]);
    const byId = Object.fromEntries(stats.map((s) => [s.playId, s]));
    expect(byId["county-guide"]).toEqual({ playId: "county-guide", successes: 2, failures: 1 });
    expect(byId["parcel-explainer"]).toEqual({ playId: "parcel-explainer", successes: 1, failures: 1 });
    expect(byId["still-running"]).toBeUndefined();
    expect(stats.find((s) => s.playId === null)).toBeUndefined();
  });
});
