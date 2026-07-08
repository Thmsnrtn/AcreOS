import { describe, it, expect } from "vitest";
import {
  governExploration,
  explorationCapForRunway,
  detectOscillation,
  dampingFactor,
} from "../../server/services/autopilot/loopStability";
import { exploitPlay, type PlayStats } from "../../server/services/autopilot/efficacy";

/**
 * Frontier #10 — the exploration governor + oscillation damper. Both are
 * safety-MONOTONE: they can only make the loop more conservative / more stable,
 * never more adventurous. These tests pin that.
 */
describe("exploration governor", () => {
  it("allows exploration at cold start (no history) — learning must be able to begin", () => {
    expect(governExploration(0, 0).mayExplore).toBe(true);
  });
  it("allows while under the cap, forbids at/over it", () => {
    expect(governExploration(2, 10, 0.5).mayExplore).toBe(true); // 0.2 < 0.5
    expect(governExploration(5, 10, 0.5).mayExplore).toBe(false); // 0.5 not < 0.5
    expect(governExploration(8, 10, 0.5).mayExplore).toBe(false); // 0.8
  });
  it("a zero cap forbids ALL exploration once any history exists (runway red)", () => {
    expect(governExploration(0, 5, 0).mayExplore).toBe(false);
    expect(governExploration(0, 0, 0).mayExplore).toBe(true); // cold start still allowed
  });
  it("tightens the cap as runway tightens (monotone)", () => {
    expect(explorationCapForRunway("green")).toBe(0.5);
    expect(explorationCapForRunway("amber")).toBe(0.25);
    expect(explorationCapForRunway("red")).toBe(0);
  });
});

describe("exploitPlay — the greedy counterpart the governor routes to", () => {
  it("picks the highest posterior mean, deterministically", () => {
    const stats: PlayStats[] = [
      { playId: "a", successes: 1, failures: 5 },
      { playId: "b", successes: 9, failures: 1 },
      { playId: "c", successes: 0, failures: 0 },
    ];
    expect(exploitPlay(stats)).toBe("b");
    expect(exploitPlay(stats)).toBe("b"); // deterministic
  });
  it("is total on the empty set", () => {
    expect(exploitPlay([])).toBeNull();
  });
});

describe("oscillation detector", () => {
  it("scores a stable focus 0 and an alternating focus ~1", () => {
    expect(detectOscillation(["g", "g", "g", "g"]).score).toBe(0);
    expect(detectOscillation(["g", "g", "g", "g"]).oscillating).toBe(false);
    const alt = detectOscillation(["g", "s", "g", "s", "g"]);
    expect(alt.score).toBe(1);
    expect(alt.oscillating).toBe(true);
    expect(alt.distinct).toBe(2);
  });
  it("doesn't flag a short window or a single switch as thrash", () => {
    expect(detectOscillation(["g", "s"]).oscillating).toBe(false); // below minWindow
    expect(detectOscillation(["g", "g", "g", "s"]).oscillating).toBe(false); // 1 switch / 3 = 0.33
  });
  it("is total on trivial input", () => {
    expect(detectOscillation([])).toEqual({ score: 0, oscillating: false, distinct: 0 });
    expect(detectOscillation(["g"]).score).toBe(0);
  });
});

describe("damping factor", () => {
  it("is 1 when stable, shrinks toward the floor as oscillation rises, never below floor", () => {
    expect(dampingFactor({ score: 0, oscillating: false, distinct: 1 })).toBe(1);
    const d = dampingFactor({ score: 0.8, oscillating: true, distinct: 3 });
    expect(d).toBeCloseTo(0.2 < 0.25 ? 0.25 : 0.2, 5); // max(floor=0.25, 1-0.8=0.2) = 0.25
    expect(dampingFactor({ score: 1, oscillating: true, distinct: 4 }, 0.1)).toBe(0.1);
    expect(dampingFactor({ score: 0.65, oscillating: true, distinct: 2 })).toBeCloseTo(0.35, 5);
  });
});
