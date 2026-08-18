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
  });

  it("THE EVAL GATE IS ASYMMETRIC — a passing score is not evidence it worked", () => {
    // This was `.toBe("success")` until 2026-08-18, and only because rule 4 let
    // a clean dispatch vote. The gate asks whether the OUTPUT was acceptable,
    // not whether it helped anybody. Failing it is conclusive; passing it is
    // permission to send, which is where the evidence stops.
    expect(outcomeOf({ dispatchSuccess: true, evalScore: EVAL_PASS_THRESHOLD })).toBe("pending");
    expect(outcomeOf({ evalScore: 0.99 })).toBe("pending");
  });

  it("THE MECHANICAL RESULT IS ASYMMETRIC — a clean dispatch does not vote", () => {
    // Was "a clean dispatch with no eval scored still counts as success
    // (mechanical floor)". The invariant that test was reaching for — a failed
    // dispatch is a failure — survives verbatim below. What it also asserted,
    // that a SUCCESSFUL dispatch is a success, is the defect: rule 4's own name
    // for itself is "did it even run", and that vote carried the same weight as
    // a founder approval into the Thompson sampler that picks the next play.
    expect(outcomeOf({ dispatchSuccess: true })).toBe("pending");

    // Unchanged, and deliberately so. A send that never left is conclusive.
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
      { playId: "parcel-explainer", dispatchSuccess: true }, // sent, nothing back — no vote
      { playId: "parcel-explainer", evalScore: 0.2, dispatchSuccess: true }, // eval fail
      { playId: "still-running", dispatchSuccess: null }, // pending — no vote
      { playId: null, founderVerdict: "approved" }, // no play — ignored
    ]);
    const byId = Object.fromEntries(stats.map((s) => [s.playId, s]));
    expect(byId["county-guide"]).toEqual({ playId: "county-guide", successes: 2, failures: 1 });
    // Was `successes: 1` — and that one success was a dispatch receipt. A play
    // whose only evidence is "it sent" now carries a track record of exactly
    // what is known about it: one real failure, no confirmed wins.
    expect(byId["parcel-explainer"]).toEqual({ playId: "parcel-explainer", successes: 0, failures: 1 });
    expect(byId["still-running"]).toBeUndefined();
    expect(stats.find((s) => s.playId === null)).toBeUndefined();
  });
});
