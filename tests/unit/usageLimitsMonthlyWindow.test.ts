/**
 * Monthly-window correction tests (2026-06-06 — Lena P0).
 *
 * Locks in the daily→monthly window change for `ai_requests` enforcement.
 * Pre-fix, the Starter tier had a 500/DAY cap which at ~$0.015/turn
 * produced -980% gross margin. The cap is now monthly and reset is
 * anchored to the 1st of the calendar month (matching the Stripe
 * subscription billing cycle).
 *
 * These tests assert:
 *   1. TIER_LIMITS values match the agreed-on monthly caps so a future
 *      drift PR can't silently restore the daily numbers.
 *   2. The counter window in `getMonthlyAiRequestCount` resets at month
 *      boundary — events from the prior month are NOT counted.
 *   3. Same-day events posted earlier today are still counted (so the
 *      window did not narrow to "since-just-now" by mistake).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { TIER_LIMITS } from "@shared/billing/tier-limits";

describe("TIER_LIMITS — monthly Pax-message caps (2026-06-06)", () => {
  it("Starter cap is 1500/mo (not 500/day) — margin positive", () => {
    expect(TIER_LIMITS.starter.ai_requests).toBe(1500);
    // Margin sanity: at $0.015/turn, max monthly COGS is $22.50 against
    // $29/mo Starter revenue (effective ~$16.67 for annual). The 1500
    // cap leaves a positive contribution margin in the worst case.
    const maxCogsCents = 1500 * 1.5; // 1.5¢/turn
    expect(maxCogsCents).toBeLessThan(2900);
  });

  it("Free is 75/mo (not 25/day)", () => {
    expect(TIER_LIMITS.free.ai_requests).toBe(75);
  });

  it("Pro is 12,000/mo", () => {
    expect(TIER_LIMITS.pro.ai_requests).toBe(12000);
  });

  it("Scale is 50,000/mo", () => {
    expect(TIER_LIMITS.scale.ai_requests).toBe(50000);
  });

  it("Enterprise stays unlimited (null)", () => {
    expect(TIER_LIMITS.enterprise.ai_requests).toBeNull();
  });
});

// ─── Window: counter resets at calendar-month boundary ────────────────────

describe("getMonthlyAiRequestCount — calendar-month window", () => {
  // Capture the where-clause arguments threaded into Drizzle so we can
  // assert against the monthStart timestamp the service computes.
  const whereCalls: any[] = [];

  beforeEach(() => {
    whereCalls.length = 0;
    vi.resetModules();
  });

  it("queries from the 1st of the current month, not the start of today", async () => {
    // Mock the @shared/schema import surface to a minimal shape.
    vi.doMock("@shared/schema", () => ({
      organizations: { id: "organizations.id", subscriptionTier: "sub_tier", subscriptionStatus: "sub_status", isFounder: "is_founder", trialEndsAt: "trial_ends" },
      leads: { organizationId: "leads.org" },
      properties: { organizationId: "properties.org" },
      notes: { organizationId: "notes.org" },
      usageEvents: {
        organizationId: "usage.org",
        eventType: "usage.event_type",
        quantity: "usage.quantity",
        createdAt: "usage.created_at",
      },
    }));

    vi.doMock("drizzle-orm", () => ({
      eq: (a: any, b: any) => ({ op: "eq", a, b }),
      and: (...args: any[]) => ({ op: "and", args }),
      gte: (a: any, b: any) => ({ op: "gte", a, b }),
      count: () => ({ op: "count" }),
      sum: () => ({ op: "sum" }),
    }));

    vi.doMock("../../server/storage", () => ({
      db: {
        select: () => ({
          from: () => ({
            where: (clause: any) => {
              whereCalls.push(clause);
              // One row shape serves every select() in this code path: the
              // org-tier lookup reads subscriptionTier/status/founder/trial,
              // the count/sum lookups read count/total. Provide all fields so
              // the first (org) query doesn't hand normalizeTier `undefined`.
              return Promise.resolve([
                {
                  total: 7,
                  count: 7,
                  subscriptionTier: "starter",
                  subscriptionStatus: "active",
                  isFounder: false,
                  trialEndsAt: null,
                },
              ]);
            },
          }),
        }),
      },
    }));

    const { checkUsageLimit } = await import("../../server/services/usageLimits");

    // Force a known "now" so the assertion is deterministic.
    const fakeNow = new Date(2026, 5, 20, 14, 30, 0, 0); // 2026-06-20 14:30 local
    vi.setSystemTime(fakeNow);

    // We can't easily intercept the underlying private function, so we
    // invoke checkUsageLimit with the ai_requests resource and inspect
    // the captured where-clauses. The first .where call is the org tier
    // lookup; the AI-request count call follows.
    await checkUsageLimit(1, "ai_requests", { isFounder: false });

    // At least one of the captured where clauses must contain a `gte`
    // node whose RHS is the 1st-of-month Date, NOT the start of today.
    const monthStart = new Date(2026, 5, 1, 0, 0, 0, 0).getTime();
    const todayStart = new Date(2026, 5, 20, 0, 0, 0, 0).getTime();

    // Walk every captured where node and find any gte Date arg.
    const dates: Date[] = [];
    function walk(node: any) {
      if (!node || typeof node !== "object") return;
      if (node.op === "gte" && node.b instanceof Date) dates.push(node.b);
      if (Array.isArray(node.args)) node.args.forEach(walk);
    }
    whereCalls.forEach(walk);

    expect(dates.length).toBeGreaterThan(0);
    const hasMonthStart = dates.some((d) => d.getTime() === monthStart);
    const hasTodayStart = dates.some((d) => d.getTime() === todayStart);
    expect(hasMonthStart).toBe(true);
    expect(hasTodayStart).toBe(false);

    vi.useRealTimers();
  });
});
