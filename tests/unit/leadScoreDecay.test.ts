/**
 * T125 — Lead Score Decay Unit Tests
 *
 * Tests the score decay model:
 * - 5% weekly decay rate
 * - 50% maximum total decay cap
 * - "Going cold" alert threshold (20-point drop)
 * - Score floor at 0
 * - Days-since-contact calculation
 */

import { describe, it, expect } from "vitest";

// ── Constants (mirrored from leadScoreDecay.ts) ───────────────────────────────
const DECAY_PER_WEEK = 0.05;
const COLD_SCORE_DROP_THRESHOLD = 20;
const DAYS_BEFORE_COLD_ALERT = 14;

// ── Pure decay logic (extracted from service) ─────────────────────────────────

function calcDecayedScore(
  currentScore: number,
  daysSinceContact: number
): { newScore: number; drop: number } {
  const weeksPerDay = 1 / 7;
  const weeksSinceContact = daysSinceContact * weeksPerDay;
  const decayFactor = 1 - Math.min(DECAY_PER_WEEK * weeksSinceContact, 0.5);
  const newScore = Math.max(0, Math.round(currentScore * decayFactor));
  const drop = currentScore - newScore;
  return { newScore, drop };
}

function shouldFireColdAlert(drop: number): boolean {
  return drop >= COLD_SCORE_DROP_THRESHOLD;
}

function isHighValueGoingCold(
  score: number,
  daysSinceContact: number
): boolean {
  return score >= 80 && daysSinceContact >= DAYS_BEFORE_COLD_ALERT;
}

function calcDaysSinceContact(lastContactedAt: Date | null): number {
  if (!lastContactedAt) return 999;
  return (Date.now() - lastContactedAt.getTime()) / 86400000;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Score Decay Calculation", () => {
  it("no decay when just contacted (0 days)", () => {
    const { newScore } = calcDecayedScore(80, 0);
    expect(newScore).toBe(80);
  });

  it("decays ~5% after 7 days (1 week)", () => {
    const { newScore } = calcDecayedScore(100, 7);
    // 100 * (1 - 0.05*1) = 95
    expect(newScore).toBe(95);
  });

  it("decays ~10% after 14 days (2 weeks)", () => {
    const { newScore } = calcDecayedScore(100, 14);
    // 100 * (1 - 0.05*2) = 90
    expect(newScore).toBe(90);
  });

  it("decays ~25% after 5 weeks (35 days)", () => {
    const { newScore } = calcDecayedScore(100, 35);
    // 100 * (1 - 0.05*5) = 75
    expect(newScore).toBe(75);
  });

  it("caps decay at 50% for very old contacts", () => {
    const { newScore } = calcDecayedScore(100, 200); // ~28 weeks
    // decay factor capped at 0.5
    expect(newScore).toBe(50);
  });

  it("score never goes below 0", () => {
    const { newScore } = calcDecayedScore(10, 200);
    expect(newScore).toBeGreaterThanOrEqual(0);
  });

  it("zero score stays at zero", () => {
    const { newScore } = calcDecayedScore(0, 30);
    expect(newScore).toBe(0);
  });

  it("proportional to initial score", () => {
    const { newScore: a } = calcDecayedScore(80, 14);
    const { newScore: b } = calcDecayedScore(40, 14);
    // Both at 2 weeks: factor = 0.9
    expect(a).toBe(72); // 80 * 0.9
    expect(b).toBe(36); // 40 * 0.9
  });
});

describe("Drop Calculation", () => {
  it("reports correct drop amount", () => {
    const { drop } = calcDecayedScore(100, 14); // 100 → 90
    expect(drop).toBe(10);
  });

  it("reports 0 drop when no decay occurs", () => {
    const { drop } = calcDecayedScore(80, 0);
    expect(drop).toBe(0);
  });
});

describe("Cold Alert Threshold", () => {
  it("fires alert when drop is exactly 20 points", () => {
    expect(shouldFireColdAlert(20)).toBe(true);
  });

  it("fires alert when drop exceeds 20 points", () => {
    expect(shouldFireColdAlert(25)).toBe(true);
    expect(shouldFireColdAlert(50)).toBe(true);
  });

  it("does NOT fire alert for drop below 20 points", () => {
    expect(shouldFireColdAlert(19)).toBe(false);
    expect(shouldFireColdAlert(0)).toBe(false);
  });

  it("correctly identifies 20-point drop via score decay", () => {
    // Need ~4 weeks of no contact on a score of ~100 to drop 20 points
    // 100 * (1 - 0.05 * 4) = 80 → drop = 20
    const { drop } = calcDecayedScore(100, 28);
    expect(shouldFireColdAlert(drop)).toBe(true);
  });
});

describe("High-Value Going Cold Detection", () => {
  it("flags leads with score >= 80 not contacted in 14+ days", () => {
    expect(isHighValueGoingCold(80, 14)).toBe(true);
    expect(isHighValueGoingCold(90, 20)).toBe(true);
  });

  it("does NOT flag leads contacted within 14 days", () => {
    expect(isHighValueGoingCold(90, 13)).toBe(false);
    expect(isHighValueGoingCold(80, 7)).toBe(false);
  });

  it("does NOT flag leads with score below 80", () => {
    expect(isHighValueGoingCold(79, 20)).toBe(false);
    expect(isHighValueGoingCold(50, 30)).toBe(false);
  });
});

describe("Days Since Contact Calculation", () => {
  it("returns 999 for null last contact", () => {
    expect(calcDaysSinceContact(null)).toBe(999);
  });

  it("returns approximately 0 for just-contacted lead", () => {
    const now = new Date();
    expect(calcDaysSinceContact(now)).toBeLessThan(0.01);
  });

  it("returns approximately 7 for contact a week ago", () => {
    const oneWeekAgo = new Date(Date.now() - 7 * 86400000);
    const days = calcDaysSinceContact(oneWeekAgo);
    expect(days).toBeCloseTo(7, 0);
  });

  it("returns approximately 30 for contact a month ago", () => {
    const oneMonthAgo = new Date(Date.now() - 30 * 86400000);
    const days = calcDaysSinceContact(oneMonthAgo);
    expect(days).toBeCloseTo(30, 0);
  });
});

describe("Edge Cases", () => {
  it("handles fractional weeks correctly", () => {
    // 3.5 days = 0.5 weeks → decay = 1 - 0.05*0.5 = 0.975
    const { newScore } = calcDecayedScore(100, 3.5);
    expect(newScore).toBe(Math.round(100 * 0.975));
  });

  it("handles very high scores correctly", () => {
    const { newScore } = calcDecayedScore(100, 7);
    expect(newScore).toBe(95);
  });

  it("consistent behavior at 50-week boundary (10 weeks = max decay)", () => {
    // 10 weeks = 70 days: DECAY_PER_WEEK * 10 = 0.5 → max cap
    const atBoundary = calcDecayedScore(100, 70);
    const beyondBoundary = calcDecayedScore(100, 140);
    // Both should produce the same score (capped at 50%)
    expect(atBoundary.newScore).toBe(beyondBoundary.newScore);
  });
});
