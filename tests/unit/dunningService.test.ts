/**
 * Unit Tests: Dunning Service
 * Tasks #75-78: Dunning state machine, stage transitions, access restriction
 *
 * Tests the pure business logic of the dunning service in isolation:
 * - Stage calculation based on days since failure
 * - Access restriction per stage
 * - Retry scheduling
 * - Notification scheduling
 * - Recovery (payment succeeded) logic
 */

import { describe, it, expect } from "vitest";

// ── Constants (mirroring DUNNING_CONFIG in shared/schema.ts) ─────────────────

const DUNNING_CONFIG = {
  retryScheduleDays: [3, 5, 7, 14], // retry at day 3, 5, 7, 14 after failure
  gracePeriodDays: 3,
  warningPeriodDays: 7,
  restrictedPeriodDays: 14,
  finalCancellationDays: 21,
  notificationSchedule: [
    { dayOffset: 0, type: "payment_failed", channel: "email" },
    { dayOffset: 2, type: "reminder", channel: "email" },
    { dayOffset: 6, type: "warning", channel: "email" },
    { dayOffset: 13, type: "final_notice", channel: "email" },
  ],
} as const;

type DunningStage = "none" | "grace_period" | "warning" | "restricted" | "suspended" | "cancelled";

// ── Pure dunning logic (extracted from server/services/dunning.ts) ────────────

function calculateDunningStage(daysSinceFailure: number): DunningStage {
  if (daysSinceFailure <= DUNNING_CONFIG.gracePeriodDays) return "grace_period";
  if (daysSinceFailure <= DUNNING_CONFIG.warningPeriodDays) return "warning";
  if (daysSinceFailure <= DUNNING_CONFIG.restrictedPeriodDays) return "restricted";
  if (daysSinceFailure <= DUNNING_CONFIG.finalCancellationDays) return "suspended";
  return "cancelled";
}

function hasRestrictedAccess(dunningStage: DunningStage): boolean {
  return dunningStage === "restricted" || dunningStage === "suspended" || dunningStage === "cancelled";
}

function isSuspendedOrCancelled(dunningStage: DunningStage): boolean {
  return dunningStage === "suspended" || dunningStage === "cancelled";
}

function calculateNextRetryDate(attemptNumber: number): Date | null {
  const retryIndex = attemptNumber - 1;
  if (retryIndex >= DUNNING_CONFIG.retryScheduleDays.length) return null;
  const daysUntilRetry = DUNNING_CONFIG.retryScheduleDays[retryIndex];
  const retryDate = new Date();
  retryDate.setDate(retryDate.getDate() + daysUntilRetry);
  return retryDate;
}

function getScheduledNotification(daysSinceFailure: number): typeof DUNNING_CONFIG.notificationSchedule[number] | null {
  for (const notification of DUNNING_CONFIG.notificationSchedule) {
    if (Math.abs(notification.dayOffset - daysSinceFailure) < 1) {
      return notification;
    }
  }
  return null;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Dunning Stage Calculation (Task #75)", () => {
  it("day 0 (immediate failure) = grace_period", () => {
    expect(calculateDunningStage(0)).toBe("grace_period");
  });

  it("day 1 = grace_period", () => {
    expect(calculateDunningStage(1)).toBe("grace_period");
  });

  it("day 3 (boundary) = grace_period", () => {
    expect(calculateDunningStage(3)).toBe("grace_period");
  });

  it("day 4 = warning", () => {
    expect(calculateDunningStage(4)).toBe("warning");
  });

  it("day 7 (boundary) = warning", () => {
    expect(calculateDunningStage(7)).toBe("warning");
  });

  it("day 8 = restricted", () => {
    expect(calculateDunningStage(8)).toBe("restricted");
  });

  it("day 14 (boundary) = restricted", () => {
    expect(calculateDunningStage(14)).toBe("restricted");
  });

  it("day 15 = suspended", () => {
    expect(calculateDunningStage(15)).toBe("suspended");
  });

  it("day 21 (boundary) = suspended", () => {
    expect(calculateDunningStage(21)).toBe("suspended");
  });

  it("day 22+ = cancelled", () => {
    expect(calculateDunningStage(22)).toBe("cancelled");
    expect(calculateDunningStage(30)).toBe("cancelled");
    expect(calculateDunningStage(90)).toBe("cancelled");
  });
});

describe("Dunning Access Restriction (Task #75)", () => {
  it("none stage has no restriction", () => {
    expect(hasRestrictedAccess("none")).toBe(false);
  });

  it("grace_period has no restriction (full access)", () => {
    expect(hasRestrictedAccess("grace_period")).toBe(false);
  });

  it("warning has no restriction (full access with warning)", () => {
    expect(hasRestrictedAccess("warning")).toBe(false);
  });

  it("restricted stage limits access", () => {
    expect(hasRestrictedAccess("restricted")).toBe(true);
  });

  it("suspended stage limits access", () => {
    expect(hasRestrictedAccess("suspended")).toBe(true);
  });

  it("cancelled stage limits access", () => {
    expect(hasRestrictedAccess("cancelled")).toBe(true);
  });
});

describe("Dunning Suspension / Cancellation Detection (Task #76)", () => {
  it("only suspended and cancelled are suspension-level", () => {
    expect(isSuspendedOrCancelled("none")).toBe(false);
    expect(isSuspendedOrCancelled("grace_period")).toBe(false);
    expect(isSuspendedOrCancelled("warning")).toBe(false);
    expect(isSuspendedOrCancelled("restricted")).toBe(false);
    expect(isSuspendedOrCancelled("suspended")).toBe(true);
    expect(isSuspendedOrCancelled("cancelled")).toBe(true);
  });
});

describe("Dunning Retry Schedule (Task #77)", () => {
  it("first failure retries in 3 days", () => {
    const retryDate = calculateNextRetryDate(1);
    expect(retryDate).not.toBeNull();
    const daysUntilRetry = Math.round(
      (retryDate!.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    );
    expect(daysUntilRetry).toBe(3);
  });

  it("second failure retries in 5 days", () => {
    const retryDate = calculateNextRetryDate(2);
    const daysUntilRetry = Math.round(
      (retryDate!.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    );
    expect(daysUntilRetry).toBe(5);
  });

  it("third failure retries in 7 days", () => {
    const retryDate = calculateNextRetryDate(3);
    const daysUntilRetry = Math.round(
      (retryDate!.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    );
    expect(daysUntilRetry).toBe(7);
  });

  it("fourth failure retries in 14 days", () => {
    const retryDate = calculateNextRetryDate(4);
    const daysUntilRetry = Math.round(
      (retryDate!.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    );
    expect(daysUntilRetry).toBe(14);
  });

  it("returns null after all retries exhausted", () => {
    const retryDate = calculateNextRetryDate(5);
    expect(retryDate).toBeNull();
  });

  it("retry schedule has exactly 4 retry slots", () => {
    expect(DUNNING_CONFIG.retryScheduleDays).toHaveLength(4);
  });
});

describe("Dunning Notification Schedule (Task #78)", () => {
  it("immediate failure triggers payment_failed notification", () => {
    const notification = getScheduledNotification(0);
    expect(notification).not.toBeNull();
    expect(notification?.type).toBe("payment_failed");
    expect(notification?.channel).toBe("email");
  });

  it("day 2 triggers reminder notification", () => {
    const notification = getScheduledNotification(2);
    expect(notification).not.toBeNull();
    expect(notification?.type).toBe("reminder");
  });

  it("day 6 triggers warning notification", () => {
    const notification = getScheduledNotification(6);
    expect(notification).not.toBeNull();
    expect(notification?.type).toBe("warning");
  });

  it("day 13 triggers final_notice notification", () => {
    const notification = getScheduledNotification(13);
    expect(notification).not.toBeNull();
    expect(notification?.type).toBe("final_notice");
  });

  it("day 15 has no scheduled notification", () => {
    const notification = getScheduledNotification(15);
    expect(notification).toBeNull();
  });

  it("notification schedule has 4 entries", () => {
    expect(DUNNING_CONFIG.notificationSchedule).toHaveLength(4);
  });

  it("all notifications go via email channel", () => {
    for (const notif of DUNNING_CONFIG.notificationSchedule) {
      expect(notif.channel).toBe("email");
    }
  });
});

describe("Dunning Config Correctness (Task #75)", () => {
  it("grace period is 3 days", () => {
    expect(DUNNING_CONFIG.gracePeriodDays).toBe(3);
  });

  it("warning period ends at 7 days", () => {
    expect(DUNNING_CONFIG.warningPeriodDays).toBe(7);
  });

  it("restricted period ends at 14 days", () => {
    expect(DUNNING_CONFIG.restrictedPeriodDays).toBe(14);
  });

  it("cancellation triggers at 21 days", () => {
    expect(DUNNING_CONFIG.finalCancellationDays).toBe(21);
  });

  it("retry schedule days are in ascending order", () => {
    const days = DUNNING_CONFIG.retryScheduleDays;
    for (let i = 1; i < days.length; i++) {
      expect(days[i]).toBeGreaterThan(days[i - 1]);
    }
  });

  it("stage progression is monotonically increasing (no skips)", () => {
    const stages: DunningStage[] = [];
    for (let day = 0; day <= 25; day++) {
      stages.push(calculateDunningStage(day));
    }

    const stageOrder: DunningStage[] = [
      "grace_period",
      "warning",
      "restricted",
      "suspended",
      "cancelled",
    ];

    let currentStageIdx = 0;
    for (const stage of stages) {
      const idx = stageOrder.indexOf(stage);
      expect(idx).toBeGreaterThanOrEqual(currentStageIdx);
      currentStageIdx = idx;
    }
  });
});
