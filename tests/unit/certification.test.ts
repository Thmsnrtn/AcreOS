/**
 * T188 — Certification Service Tests
 * Tests certificate generation, achievement unlocking, and learning rank logic.
 */

import { describe, it, expect } from "vitest";
import crypto from "crypto";

// ─── Inline pure logic ────────────────────────────────────────────────────────

function generateVerificationCode(userId: number, courseId: number, issuedAt: string): string {
  return crypto
    .createHash("sha256")
    .update(`${userId}-${courseId}-${issuedAt}`)
    .digest("hex")
    .substring(0, 16)
    .toUpperCase();
}

function determineLearningRank(coursesCompleted: number): "Beginner" | "Investor" | "Expert" | "Master" {
  if (coursesCompleted >= 10) return "Master";
  if (coursesCompleted >= 5) return "Expert";
  if (coursesCompleted >= 2) return "Investor";
  return "Beginner";
}

function determineAchievementTier(type: string): "bronze" | "silver" | "gold" | "platinum" {
  if (type === "all_courses") return "platinum";
  if (type === "five_courses" || type === "perfect_score") return "gold";
  if (type === "three_courses" || type === "speed_learner") return "silver";
  return "bronze"; // first_course
}

function calculateAverageScore(scores: number[]): number {
  if (scores.length === 0) return 0;
  return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10;
}

function isEligibleForCertificate(enrollment: {
  completed: boolean;
  progressPercent: number;
  passedAllQuizzes?: boolean;
}): boolean {
  return enrollment.completed && enrollment.progressPercent >= 100;
}

function getAchievementsForCompletion(coursesCompleted: number, perfectScore: boolean): string[] {
  const achievements: string[] = [];
  if (coursesCompleted === 1) achievements.push("first_course");
  if (coursesCompleted === 3) achievements.push("three_courses");
  if (coursesCompleted === 5) achievements.push("five_courses");
  if (coursesCompleted >= 1 && perfectScore) achievements.push("perfect_score");
  return achievements;
}

function estimateHoursLearned(modulesCompleted: number, avgMinutesPerModule = 20): number {
  return Math.round((modulesCompleted * avgMinutesPerModule) / 60 * 10) / 10;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("generateVerificationCode", () => {
  it("generates a 16-character uppercase hex code", () => {
    const code = generateVerificationCode(1, 10, "2024-01-01T00:00:00.000Z");
    expect(code).toHaveLength(16);
    expect(code).toMatch(/^[A-F0-9]{16}$/);
  });

  it("is deterministic for same inputs", () => {
    const iso = "2024-06-15T12:00:00.000Z";
    expect(generateVerificationCode(5, 3, iso)).toBe(generateVerificationCode(5, 3, iso));
  });

  it("differs with different userId", () => {
    const iso = "2024-01-01T00:00:00.000Z";
    expect(generateVerificationCode(1, 1, iso)).not.toBe(generateVerificationCode(2, 1, iso));
  });

  it("differs with different courseId", () => {
    const iso = "2024-01-01T00:00:00.000Z";
    expect(generateVerificationCode(1, 1, iso)).not.toBe(generateVerificationCode(1, 2, iso));
  });

  it("differs with different timestamp", () => {
    expect(
      generateVerificationCode(1, 1, "2024-01-01T00:00:00.000Z")
    ).not.toBe(
      generateVerificationCode(1, 1, "2024-01-02T00:00:00.000Z")
    );
  });
});

describe("determineLearningRank", () => {
  it("returns Beginner for 0 or 1 course", () => {
    expect(determineLearningRank(0)).toBe("Beginner");
    expect(determineLearningRank(1)).toBe("Beginner");
  });

  it("returns Investor for 2-4 courses", () => {
    expect(determineLearningRank(2)).toBe("Investor");
    expect(determineLearningRank(4)).toBe("Investor");
  });

  it("returns Expert for 5-9 courses", () => {
    expect(determineLearningRank(5)).toBe("Expert");
    expect(determineLearningRank(9)).toBe("Expert");
  });

  it("returns Master for 10+ courses", () => {
    expect(determineLearningRank(10)).toBe("Master");
    expect(determineLearningRank(50)).toBe("Master");
  });
});

describe("determineAchievementTier", () => {
  it("returns bronze for first_course", () => {
    expect(determineAchievementTier("first_course")).toBe("bronze");
  });

  it("returns silver for three_courses and speed_learner", () => {
    expect(determineAchievementTier("three_courses")).toBe("silver");
    expect(determineAchievementTier("speed_learner")).toBe("silver");
  });

  it("returns gold for five_courses and perfect_score", () => {
    expect(determineAchievementTier("five_courses")).toBe("gold");
    expect(determineAchievementTier("perfect_score")).toBe("gold");
  });

  it("returns platinum for all_courses", () => {
    expect(determineAchievementTier("all_courses")).toBe("platinum");
  });
});

describe("calculateAverageScore", () => {
  it("returns 0 for empty array", () => {
    expect(calculateAverageScore([])).toBe(0);
  });

  it("calculates correct average", () => {
    expect(calculateAverageScore([80, 90, 100])).toBe(90);
  });

  it("rounds to one decimal", () => {
    expect(calculateAverageScore([85, 92])).toBe(88.5);
    expect(calculateAverageScore([70, 75, 80])).toBe(75);
  });

  it("handles single score", () => {
    expect(calculateAverageScore([95])).toBe(95);
  });
});

describe("isEligibleForCertificate", () => {
  it("returns true when completed and 100% progress", () => {
    expect(isEligibleForCertificate({ completed: true, progressPercent: 100 })).toBe(true);
  });

  it("returns false when not completed", () => {
    expect(isEligibleForCertificate({ completed: false, progressPercent: 100 })).toBe(false);
  });

  it("returns false when progress < 100%", () => {
    expect(isEligibleForCertificate({ completed: true, progressPercent: 99 })).toBe(false);
  });

  it("returns false for both false", () => {
    expect(isEligibleForCertificate({ completed: false, progressPercent: 50 })).toBe(false);
  });
});

describe("getAchievementsForCompletion", () => {
  it("awards first_course on first completion", () => {
    expect(getAchievementsForCompletion(1, false)).toContain("first_course");
  });

  it("awards three_courses on 3rd completion", () => {
    expect(getAchievementsForCompletion(3, false)).toContain("three_courses");
  });

  it("awards five_courses on 5th completion", () => {
    expect(getAchievementsForCompletion(5, false)).toContain("five_courses");
  });

  it("awards perfect_score when applicable", () => {
    expect(getAchievementsForCompletion(2, true)).toContain("perfect_score");
  });

  it("does not award first_course on 2nd completion", () => {
    expect(getAchievementsForCompletion(2, false)).not.toContain("first_course");
  });

  it("returns empty for non-milestone completions", () => {
    expect(getAchievementsForCompletion(4, false)).toHaveLength(0);
  });
});

describe("estimateHoursLearned", () => {
  it("returns 0 for 0 modules", () => {
    expect(estimateHoursLearned(0)).toBe(0);
  });

  it("calculates hours from modules at default rate", () => {
    // 3 modules * 20 min = 60 min = 1 hour
    expect(estimateHoursLearned(3)).toBe(1);
  });

  it("rounds to one decimal place", () => {
    // 5 modules * 20 min = 100 min = 1.7 hours
    expect(estimateHoursLearned(5)).toBe(1.7);
  });

  it("accepts custom minutes per module", () => {
    // 2 modules * 30 min = 60 min = 1 hour
    expect(estimateHoursLearned(2, 30)).toBe(1);
  });
});
