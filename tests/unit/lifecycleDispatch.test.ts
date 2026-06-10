/**
 * Tier 2C — lifecycle dispatch eligibility + once-only dedupe.
 *
 * The eligibility rules are pure functions over LifecycleOrgFacts + a clock,
 * so every window edge is exercised here without a database. The
 * dispatchLifecycleOnce dedupe (one send per (org, templateKey), EVER —
 * including suppressed/skipped prior rows) runs against a minimal chained
 * db mock plus a mocked sendLifecycleMessage.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks (hoisted above imports by vitest) ─────────────────────────────────

const mockState = vi.hoisted(() => ({
  // Rows returned by the db.select() chain in dispatchLifecycleOnce's
  // prior-send lookup.
  priorSendRows: [] as Array<{ id: number }>,
  sendResult: { status: "queued" } as { status: string; reason?: string },
  sendCalls: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../server/db", () => {
  const chain = {
    select: vi.fn(() => chain),
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn(async () => mockState.priorSendRows),
  };
  return { db: chain };
});

vi.mock("../../server/services/lifecycleProgram", () => ({
  sendLifecycleMessage: vi.fn(async (params: Record<string, unknown>) => {
    mockState.sendCalls.push(params);
    return mockState.sendResult;
  }),
}));

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  D7_WINDOW_DAYS,
  D30_WINDOW_DAYS,
  CANCEL_CATCHUP_WINDOW_DAYS,
  DISPATCHED_KEYS,
  type LifecycleOrgFacts,
  isD7CheckInEligible,
  isD30NpsEligible,
  isCancellationAskEligible,
  eligibleLifecycleKeys,
  placeholdersFor,
  dispatchLifecycleOnce,
} from "../../server/jobs/lifecycleDispatch";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-06-10T15:05:00Z");

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS);
}

function facts(overrides: Partial<LifecycleOrgFacts> = {}): LifecycleOrgFacts {
  return {
    organizationId: 1,
    createdAt: daysAgo(10),
    updatedAt: daysAgo(1),
    subscriptionStatus: "active",
    firstPaidAt: null,
    hasChurnReason: false,
    priorSends: new Set<string>(),
    ...overrides,
  };
}

// ── d7_check_in ─────────────────────────────────────────────────────────────

describe("isD7CheckInEligible", () => {
  it("fires inside the [7,14]-day window for active orgs", () => {
    expect(isD7CheckInEligible(facts({ createdAt: daysAgo(7) }), NOW)).toBe(true);
    expect(isD7CheckInEligible(facts({ createdAt: daysAgo(10) }), NOW)).toBe(true);
    expect(isD7CheckInEligible(facts({ createdAt: daysAgo(14) }), NOW)).toBe(true);
  });

  it("does not fire before day 7", () => {
    expect(isD7CheckInEligible(facts({ createdAt: daysAgo(6.9) }), NOW)).toBe(false);
    expect(isD7CheckInEligible(facts({ createdAt: daysAgo(0) }), NOW)).toBe(false);
  });

  it("does not fire after day 14 — a fresh deploy can never carpet-bomb old orgs", () => {
    expect(isD7CheckInEligible(facts({ createdAt: daysAgo(14.1) }), NOW)).toBe(false);
    expect(isD7CheckInEligible(facts({ createdAt: daysAgo(365) }), NOW)).toBe(false);
  });

  it("requires an active subscription", () => {
    expect(isD7CheckInEligible(facts({ subscriptionStatus: "cancelled" }), NOW)).toBe(false);
    expect(isD7CheckInEligible(facts({ subscriptionStatus: "trialing" }), NOW)).toBe(false);
    expect(isD7CheckInEligible(facts({ subscriptionStatus: null }), NOW)).toBe(false);
  });

  it("never re-fires once any prior send row exists", () => {
    expect(
      isD7CheckInEligible(facts({ priorSends: new Set(["d7_check_in"]) }), NOW),
    ).toBe(false);
  });

  it("requires a createdAt", () => {
    expect(isD7CheckInEligible(facts({ createdAt: null }), NOW)).toBe(false);
  });
});

// ── d30_nps ─────────────────────────────────────────────────────────────────

describe("isD30NpsEligible", () => {
  it("fires inside [30,44] days after the first paid event", () => {
    expect(isD30NpsEligible(facts({ firstPaidAt: daysAgo(30) }), NOW)).toBe(true);
    expect(isD30NpsEligible(facts({ firstPaidAt: daysAgo(37) }), NOW)).toBe(true);
    expect(isD30NpsEligible(facts({ firstPaidAt: daysAgo(44) }), NOW)).toBe(true);
  });

  it("does not fire outside the window", () => {
    expect(isD30NpsEligible(facts({ firstPaidAt: daysAgo(29.9) }), NOW)).toBe(false);
    expect(isD30NpsEligible(facts({ firstPaidAt: daysAgo(44.1) }), NOW)).toBe(false);
  });

  it("anchors on the paid event, not org age — no paid event, no NPS email", () => {
    // Org is 35 days old but never paid: ineligible.
    expect(
      isD30NpsEligible(facts({ createdAt: daysAgo(35), firstPaidAt: null }), NOW),
    ).toBe(false);
  });

  it("requires active status and no prior send", () => {
    expect(
      isD30NpsEligible(
        facts({ firstPaidAt: daysAgo(31), subscriptionStatus: "cancelled" }),
        NOW,
      ),
    ).toBe(false);
    expect(
      isD30NpsEligible(
        facts({ firstPaidAt: daysAgo(31), priorSends: new Set(["d30_nps"]) }),
        NOW,
      ),
    ).toBe(false);
  });
});

// ── cancellation_reason_ask (catch-up path) ─────────────────────────────────

describe("isCancellationAskEligible", () => {
  const cancelled = (overrides: Partial<LifecycleOrgFacts> = {}) =>
    facts({ subscriptionStatus: "cancelled", updatedAt: daysAgo(2), ...overrides });

  it("fires for recently-cancelled orgs with no exit-survey answer", () => {
    expect(isCancellationAskEligible(cancelled(), NOW)).toBe(true);
    expect(
      isCancellationAskEligible(
        cancelled({ updatedAt: daysAgo(CANCEL_CATCHUP_WINDOW_DAYS) }),
        NOW,
      ),
    ).toBe(true);
  });

  it("never reaches an org that cancelled outside the catch-up window", () => {
    expect(
      isCancellationAskEligible(cancelled({ updatedAt: daysAgo(7.1) }), NOW),
    ).toBe(false);
    expect(
      isCancellationAskEligible(cancelled({ updatedAt: daysAgo(90) }), NOW),
    ).toBe(false);
  });

  it("skips orgs that already answered the in-app exit survey", () => {
    expect(
      isCancellationAskEligible(cancelled({ hasChurnReason: true }), NOW),
    ).toBe(false);
  });

  it("only targets cancelled orgs", () => {
    expect(
      isCancellationAskEligible(facts({ subscriptionStatus: "active" }), NOW),
    ).toBe(false);
  });

  it("never re-fires once any prior send row exists (incl. webhook T+0 path)", () => {
    expect(
      isCancellationAskEligible(
        cancelled({ priorSends: new Set(["cancellation_reason_ask"]) }),
        NOW,
      ),
    ).toBe(false);
  });
});

// ── Aggregate selection ─────────────────────────────────────────────────────

describe("eligibleLifecycleKeys", () => {
  it("can return multiple due keys for one org", () => {
    // Created 10d ago AND first paid 30d ago (backfilled paid event).
    const f = facts({ createdAt: daysAgo(10), firstPaidAt: daysAgo(30) });
    expect(eligibleLifecycleKeys(f, NOW)).toEqual(["d7_check_in", "d30_nps"]);
  });

  it("returns nothing for an org with all sends recorded", () => {
    const f = facts({
      createdAt: daysAgo(10),
      firstPaidAt: daysAgo(30),
      priorSends: new Set(DISPATCHED_KEYS),
    });
    expect(eligibleLifecycleKeys(f, NOW)).toEqual([]);
  });

  it("window constants are sane (min < max, catch-up bounded)", () => {
    expect(D7_WINDOW_DAYS.min).toBeLessThan(D7_WINDOW_DAYS.max);
    expect(D30_WINDOW_DAYS.min).toBeLessThan(D30_WINDOW_DAYS.max);
    expect(CANCEL_CATCHUP_WINDOW_DAYS).toBeGreaterThan(0);
    expect(CANCEL_CATCHUP_WINDOW_DAYS).toBeLessThanOrEqual(14);
  });
});

// ── Placeholders ────────────────────────────────────────────────────────────

describe("placeholdersFor", () => {
  it("gives d30_nps the in-app NPS deep link", () => {
    const p = placeholdersFor("d30_nps");
    expect(p.npsUrl).toMatch(/\/today\?nps=1$/);
  });

  it("reply-based templates need no placeholders", () => {
    expect(placeholdersFor("d7_check_in")).toEqual({});
    expect(placeholdersFor("cancellation_reason_ask")).toEqual({});
  });
});

// ── dispatchLifecycleOnce dedupe ────────────────────────────────────────────

describe("dispatchLifecycleOnce", () => {
  beforeEach(() => {
    mockState.priorSendRows = [];
    mockState.sendResult = { status: "queued" };
    mockState.sendCalls = [];
  });

  it("dispatches through sendLifecycleMessage when no prior row exists", async () => {
    const result = await dispatchLifecycleOnce({
      templateKey: "d7_check_in",
      organizationId: 42,
      recipientEmail: "owner@example.com",
      userId: "user_1",
    });
    expect(result.dispatched).toBe(true);
    expect(mockState.sendCalls).toHaveLength(1);
    expect(mockState.sendCalls[0]).toMatchObject({
      templateKey: "d7_check_in",
      organizationId: 42,
      recipientEmail: "owner@example.com",
    });
  });

  it("refuses to re-send when ANY prior row exists — suppressed/skipped included", async () => {
    mockState.priorSendRows = [{ id: 7 }];
    const result = await dispatchLifecycleOnce({
      templateKey: "cancellation_reason_ask",
      organizationId: 42,
      recipientEmail: "owner@example.com",
    });
    expect(result).toEqual({ dispatched: false, reason: "already_sent" });
    expect(mockState.sendCalls).toHaveLength(0);
  });

  it("reports a non-queued pipeline outcome (e.g. suppression) as not dispatched", async () => {
    mockState.sendResult = { status: "suppressed", reason: "suppressed" };
    const result = await dispatchLifecycleOnce({
      templateKey: "d30_nps",
      organizationId: 42,
      recipientEmail: "owner@example.com",
    });
    expect(result.dispatched).toBe(false);
    expect(result.reason).toBe("suppressed");
  });
});
