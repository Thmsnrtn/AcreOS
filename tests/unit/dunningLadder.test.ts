/**
 * Dunning ladder (server/services/dunning.ts) — the revenue-recovery machine.
 *
 * Pins three things:
 *   1. Stage math boundaries (grace → warning → restricted → suspended →
 *      cancelled) and their alignment with DUNNING_STAGES access levels —
 *      the "read-only from day 8" promise depends on these constants.
 *   2. DUNNING_CONFIG schedule invariants (ordered offsets, one SMS leg,
 *      everything inside the cancellation window).
 *   3. The roadmap W1.1 regression: events parked at "scheduled_retry" (the
 *      NORMAL Stripe case) must be visible to the reminder selector. Before
 *      the fix the selector only fetched "pending", so the day-2/6/13
 *      recovery emails never sent for exactly the accounts still
 *      recoverable.
 *
 * DB/storage/email surfaces are mocked or spied — these tests exercise the
 * service's decision logic, not Postgres.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/storage", () => ({
  storage: {
    getDunningEvents: vi.fn(),
    updateDunningEvent: vi.fn().mockResolvedValue(undefined),
    updateOrganization: vi.fn().mockResolvedValue(undefined),
    createSystemAlert: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("../../server/services/systemActivityLogger", () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { dunningService } from "../../server/services/dunning";
import { storage } from "../../server/storage";
import { DUNNING_CONFIG, DUNNING_STAGES } from "@shared/schema";

describe("calculateDunningStage — boundary math", () => {
  it.each([
    [0, "grace_period"],
    [3, "grace_period"], // gracePeriodDays inclusive
    [4, "warning"],
    [7, "warning"], // warningPeriodDays inclusive
    [8, "restricted"], // the "read-only from day 8" line
    [14, "restricted"],
    [15, "suspended"],
    [21, "suspended"],
    [22, "cancelled"],
    [90, "cancelled"],
  ] as const)("day %i → %s", (days, expected) => {
    expect(dunningService.calculateDunningStage(days)).toBe(expected);
  });
});

describe("stage access levels — the day-8 promise", () => {
  it("grace period keeps full access; day 8+ stages are all restricted", () => {
    expect(dunningService.hasRestrictedAccess("grace_period")).toBe(false);
    for (const stage of ["restricted", "suspended", "cancelled"] as const) {
      expect(dunningService.hasRestrictedAccess(stage), stage).toBe(true);
    }
  });
});

describe("DUNNING_CONFIG invariants", () => {
  it("notification offsets are strictly ascending and inside the cancellation window", () => {
    const offsets = DUNNING_CONFIG.notificationSchedule.map((n) => n.dayOffset);
    for (let i = 1; i < offsets.length; i++) {
      expect(offsets[i]).toBeGreaterThan(offsets[i - 1]);
    }
    expect(Math.max(...offsets)).toBeLessThan(DUNNING_CONFIG.finalCancellationDays);
  });

  it("retry schedule is ascending and bounded by the cancellation window", () => {
    const days = DUNNING_CONFIG.retryScheduleDays;
    for (let i = 1; i < days.length; i++) {
      expect(days[i]).toBeGreaterThan(days[i - 1]);
    }
    expect(Math.max(...days)).toBeLessThanOrEqual(DUNNING_CONFIG.finalCancellationDays);
  });

  it("exactly one SMS leg exists (the one-SMS-per-sequence throttle premise)", () => {
    const smsLegs = DUNNING_CONFIG.notificationSchedule.filter((n) => n.channel === "sms");
    expect(smsLegs).toHaveLength(1);
    expect(smsLegs[0].type).toBe("dunning_sms");
  });

  it("stage windows and DUNNING_STAGES agree on where full access ends", () => {
    // grace 0-3 full; warning 4-7 (limited but not read-only); restricted 8+.
    expect(DUNNING_CONFIG.gracePeriodDays).toBe(3);
    expect(DUNNING_CONFIG.warningPeriodDays).toBe(7);
    expect(DUNNING_STAGES.grace_period.accessLevel).toBe("full");
    expect(DUNNING_STAGES.restricted.accessLevel).not.toBe("full");
  });
});

describe("processScheduledTasks — the W1.1 scheduled_retry regression", () => {
  const NOW = new Date("2026-07-07T16:00:00Z");
  const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000 - 60 * 60 * 1000);

  let sendEmailSpy: ReturnType<typeof vi.spyOn>;
  let sendSmsSpy: ReturnType<typeof vi.spyOn>;
  let activeOrgsSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    sendEmailSpy = vi
      .spyOn(dunningService as any, "sendDunningEmail")
      .mockResolvedValue(undefined);
    sendSmsSpy = vi.spyOn(dunningService as any, "sendDunningSMS").mockResolvedValue(true);
    activeOrgsSpy = vi.spyOn(dunningService, "getActiveDunningOrgs");
    vi.mocked(storage.getDunningEvents).mockReset();
    vi.mocked(storage.updateDunningEvent).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    sendEmailSpy.mockRestore();
    sendSmsSpy.mockRestore();
    activeOrgsSpy.mockRestore();
  });

  const org = (overrides: Record<string, unknown> = {}) =>
    ({
      id: 7,
      name: "Test Org",
      dunningStartedAt: daysAgo(6), // day 6 → "warning" email leg
      dunningStage: "warning", // matches expected stage → no advancement path
      subscriptionTier: "pro",
      ...overrides,
    }) as any;

  it("sends the scheduled reminder for an event parked at scheduled_retry (the W1.1 fix)", async () => {
    activeOrgsSpy.mockResolvedValue([org()]);
    vi.mocked(storage.getDunningEvents).mockResolvedValue([
      // The NORMAL case: Stripe scheduled a retry, so handlePaymentFailure
      // parked the event here. Pre-fix, the selector only saw "pending" and
      // the whole reminder ladder went silent.
      { id: 42, status: "scheduled_retry", notificationsSent: [], amountDueCents: 4900 },
    ] as any);

    await dunningService.processScheduledTasks();

    expect(sendEmailSpy).toHaveBeenCalledTimes(1);
    expect(sendEmailSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), "warning", 4900);
    // The dispatch is recorded on the event so it never double-sends.
    expect(storage.updateDunningEvent).toHaveBeenCalledWith(
      42,
      expect.objectContaining({
        notificationsSent: [
          expect.objectContaining({ type: "warning", channel: "email" }),
        ],
      }),
    );
  });

  it("still sends for plain pending events", async () => {
    activeOrgsSpy.mockResolvedValue([org()]);
    vi.mocked(storage.getDunningEvents).mockResolvedValue([
      { id: 43, status: "pending", notificationsSent: [], amountDueCents: 2000 },
    ] as any);

    await dunningService.processScheduledTasks();
    expect(sendEmailSpy).toHaveBeenCalledTimes(1);
  });

  it("does NOT send when the only events are closed (recovered/failed)", async () => {
    activeOrgsSpy.mockResolvedValue([org()]);
    vi.mocked(storage.getDunningEvents).mockResolvedValue([
      { id: 44, status: "recovered", notificationsSent: [], amountDueCents: 2000 },
      { id: 45, status: "failed", notificationsSent: [], amountDueCents: 2000 },
    ] as any);

    await dunningService.processScheduledTasks();
    expect(sendEmailSpy).not.toHaveBeenCalled();
    expect(sendSmsSpy).not.toHaveBeenCalled();
  });

  it("never double-sends a notification type already recorded on the event", async () => {
    activeOrgsSpy.mockResolvedValue([org()]);
    vi.mocked(storage.getDunningEvents).mockResolvedValue([
      {
        id: 46,
        status: "scheduled_retry",
        notificationsSent: [{ type: "warning", sentAt: daysAgo(0).toISOString(), channel: "email" }],
        amountDueCents: 4900,
      },
    ] as any);

    await dunningService.processScheduledTasks();
    expect(sendEmailSpy).not.toHaveBeenCalled();
    expect(storage.updateDunningEvent).not.toHaveBeenCalled();
  });

  it("routes the day-3 leg to SMS (Phase 3 W10) and records the sms channel", async () => {
    activeOrgsSpy.mockResolvedValue([
      org({ dunningStartedAt: daysAgo(3), dunningStage: "grace_period" }),
    ]);
    vi.mocked(storage.getDunningEvents).mockResolvedValue([
      { id: 47, status: "scheduled_retry", notificationsSent: [], amountDueCents: 4900 },
    ] as any);

    await dunningService.processScheduledTasks();
    expect(sendSmsSpy).toHaveBeenCalledTimes(1);
    expect(sendEmailSpy).not.toHaveBeenCalled();
    expect(storage.updateDunningEvent).toHaveBeenCalledWith(
      47,
      expect.objectContaining({
        notificationsSent: [expect.objectContaining({ type: "dunning_sms", channel: "sms" })],
      }),
    );
  });
});
