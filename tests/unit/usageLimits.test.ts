/**
 * T201 — Usage Limits Tests
 * Tests quota enforcement, overage detection, and reset logic.
 */

import { describe, it, expect } from "vitest";

// ─── Inline pure logic ────────────────────────────────────────────────────────

interface PlanQuota {
  feature: string;
  limit: number;
  overageAllowed: boolean;
  overageRateCents?: number; // per unit over limit
}

interface UsageRecord {
  feature: string;
  used: number;
  resetDate: Date;
}

function isOverLimit(used: number, limit: number): boolean {
  return used >= limit;
}

function isNearLimit(used: number, limit: number, thresholdPct = 80): boolean {
  return (used / limit) * 100 >= thresholdPct;
}

function getRemainingUsage(used: number, limit: number): number {
  return Math.max(0, limit - used);
}

function getUsagePercent(used: number, limit: number): number {
  if (limit === 0) return 100;
  return Math.min(100, Math.round((used / limit) * 100));
}

function canPerformAction(used: number, quota: PlanQuota): { allowed: boolean; reason?: string } {
  if (used < quota.limit) return { allowed: true };
  if (quota.overageAllowed) return { allowed: true };
  return { allowed: false, reason: `${quota.feature} limit of ${quota.limit} reached` };
}

function calculateOverageCost(used: number, limit: number, rateCentsPerUnit: number): number {
  const overage = Math.max(0, used - limit);
  return overage * rateCentsPerUnit;
}

function isResetDue(resetDate: Date, now = new Date()): boolean {
  return now >= resetDate;
}

function getNextResetDate(period: "monthly" | "annual", from = new Date()): Date {
  const next = new Date(from);
  if (period === "monthly") {
    next.setMonth(next.getMonth() + 1);
  } else {
    next.setFullYear(next.getFullYear() + 1);
  }
  return next;
}

function aggregateUsage(records: UsageRecord[]): Record<string, number> {
  return records.reduce((acc, r) => {
    acc[r.feature] = (acc[r.feature] ?? 0) + r.used;
    return acc;
  }, {} as Record<string, number>);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("isOverLimit", () => {
  it("returns false when under limit", () => {
    expect(isOverLimit(9, 10)).toBe(false);
  });

  it("returns true at exact limit", () => {
    expect(isOverLimit(10, 10)).toBe(true);
  });

  it("returns true when over limit", () => {
    expect(isOverLimit(11, 10)).toBe(true);
  });

  it("returns false for zero usage", () => {
    expect(isOverLimit(0, 10)).toBe(false);
  });
});

describe("isNearLimit", () => {
  it("returns false when well under 80%", () => {
    expect(isNearLimit(5, 100)).toBe(false);
  });

  it("returns true at exactly 80%", () => {
    expect(isNearLimit(80, 100)).toBe(true);
  });

  it("returns true above 80%", () => {
    expect(isNearLimit(90, 100)).toBe(true);
  });

  it("uses custom threshold", () => {
    expect(isNearLimit(50, 100, 50)).toBe(true);
    expect(isNearLimit(49, 100, 50)).toBe(false);
  });

  it("returns true when over limit", () => {
    expect(isNearLimit(105, 100)).toBe(true);
  });
});

describe("getRemainingUsage", () => {
  it("returns remaining capacity", () => {
    expect(getRemainingUsage(3, 10)).toBe(7);
  });

  it("returns 0 when at limit", () => {
    expect(getRemainingUsage(10, 10)).toBe(0);
  });

  it("returns 0 when over limit (not negative)", () => {
    expect(getRemainingUsage(15, 10)).toBe(0);
  });
});

describe("getUsagePercent", () => {
  it("returns 50 for half usage", () => {
    expect(getUsagePercent(50, 100)).toBe(50);
  });

  it("caps at 100 when over limit", () => {
    expect(getUsagePercent(150, 100)).toBe(100);
  });

  it("returns 100 when limit is 0", () => {
    expect(getUsagePercent(0, 0)).toBe(100);
  });

  it("returns 0 for no usage", () => {
    expect(getUsagePercent(0, 100)).toBe(0);
  });
});

describe("canPerformAction", () => {
  const limitedQuota: PlanQuota = { feature: "ai_calls", limit: 100, overageAllowed: false };
  const overageQuota: PlanQuota = { feature: "ai_calls", limit: 100, overageAllowed: true };

  it("allows action when under limit", () => {
    expect(canPerformAction(50, limitedQuota).allowed).toBe(true);
  });

  it("blocks action when at limit and overage not allowed", () => {
    const result = canPerformAction(100, limitedQuota);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("100");
  });

  it("allows overage when overage is permitted", () => {
    expect(canPerformAction(100, overageQuota).allowed).toBe(true);
  });

  it("allows action at 99 of 100", () => {
    expect(canPerformAction(99, limitedQuota).allowed).toBe(true);
  });
});

describe("calculateOverageCost", () => {
  it("returns 0 when under limit", () => {
    expect(calculateOverageCost(80, 100, 50)).toBe(0);
  });

  it("returns 0 when at limit", () => {
    expect(calculateOverageCost(100, 100, 50)).toBe(0);
  });

  it("calculates overage for excess usage", () => {
    // 10 units over at $0.50 each = $5.00 = 500 cents
    expect(calculateOverageCost(110, 100, 50)).toBe(500);
  });

  it("scales with usage", () => {
    expect(calculateOverageCost(200, 100, 10)).toBe(1000);
  });
});

describe("isResetDue", () => {
  it("returns true when reset date is in the past", () => {
    const pastDate = new Date(Date.now() - 86400000);
    expect(isResetDue(pastDate)).toBe(true);
  });

  it("returns false when reset date is in the future", () => {
    const futureDate = new Date(Date.now() + 86400000);
    expect(isResetDue(futureDate)).toBe(false);
  });

  it("returns true for exact now", () => {
    const now = new Date();
    expect(isResetDue(now, now)).toBe(true);
  });
});

describe("getNextResetDate", () => {
  it("adds 1 month for monthly period", () => {
    const from = new Date("2024-01-15");
    const next = getNextResetDate("monthly", from);
    expect(next.getMonth()).toBe(1); // February
  });

  it("adds 1 year for annual period", () => {
    const from = new Date("2024-01-15");
    const next = getNextResetDate("annual", from);
    expect(next.getFullYear()).toBe(2025);
  });
});

describe("aggregateUsage", () => {
  it("sums usage across multiple records for same feature", () => {
    const records: UsageRecord[] = [
      { feature: "ai", used: 30, resetDate: new Date() },
      { feature: "ai", used: 20, resetDate: new Date() },
      { feature: "sms", used: 5, resetDate: new Date() },
    ];
    const agg = aggregateUsage(records);
    expect(agg["ai"]).toBe(50);
    expect(agg["sms"]).toBe(5);
  });

  it("returns empty object for no records", () => {
    expect(aggregateUsage([])).toEqual({});
  });
});
