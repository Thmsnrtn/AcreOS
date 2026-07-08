/**
 * Regression test — the dunning reminder ladder (roadmap W1.1, 2026-07 audit).
 *
 * THE BUG: handlePaymentFailure parks events at status "scheduled_retry"
 * whenever Stripe schedules a retry (the normal case), but the scheduled-task
 * cron selected only status "pending" — so latestEvent was undefined and the
 * day-2 reminder / day-6 warning / day-13 final-notice emails NEVER sent for
 * exactly the accounts still recoverable. Only the inline day-0 email fired.
 *
 * These tests drive processScheduledTasks() against a mocked storage where
 * the only open event is "scheduled_retry" and assert the ladder now sends
 * (and still dedupes what was already sent).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/services/systemActivityLogger", () => ({
  logActivity: vi.fn(async () => undefined),
}));
vi.mock("../../server/db", () => ({ db: {} }));

const EMAILS: Array<{ to: string; subject: string }> = [];
vi.mock("../../server/services/emailService", () => ({
  emailService: {
    sendEmail: vi.fn(async (input: { to: string; subject: string }) => {
      EMAILS.push({ to: input.to, subject: input.subject });
      return { success: true };
    }),
  },
}));

const EVENT_UPDATES: Array<{ id: number; updates: any }> = [];
let orgsInDunning: any[] = [];
let dunningEventsByOrg: Record<number, any[]> = {};

vi.mock("../../server/storage", () => ({
  storage: {
    getOrganizationsInDunning: vi.fn(async () => orgsInDunning),
    getDunningEvents: vi.fn(async (orgId: number, status?: string) => {
      const all = dunningEventsByOrg[orgId] ?? [];
      return status ? all.filter((e) => e.status === status) : all;
    }),
    updateDunningEvent: vi.fn(async (id: number, updates: any) => {
      EVENT_UPDATES.push({ id, updates });
      return { id, ...updates };
    }),
    updateOrganization: vi.fn(async () => undefined),
    createSystemAlert: vi.fn(async () => ({ id: 1 })),
  },
}));

import { dunningService } from "../../server/services/dunning";

const DAY_MS = 24 * 60 * 60 * 1000;

function orgAtDay(daysSinceFailure: number) {
  return {
    id: 1,
    name: "Acme Land Co",
    ownerId: "user_1",
    settings: { companyEmail: "billing@acme.test" },
    dunningStartedAt: new Date(Date.now() - daysSinceFailure * DAY_MS - 60_000),
    // Set to the stage the cron would compute so no stage-advance side path runs.
    dunningStage: daysSinceFailure <= 3 ? "grace_period" : daysSinceFailure <= 7 ? "warning" : "restricted",
    subscriptionTier: "pro",
    smsOptOutBilling: true, // keep the SMS leg quiet; we're testing email
  };
}

beforeEach(() => {
  EMAILS.length = 0;
  EVENT_UPDATES.length = 0;
  orgsInDunning = [];
  dunningEventsByOrg = {};
  vi.clearAllMocks();
});

describe("dunning ladder revival (W1.1)", () => {
  it("sends the day-2 reminder when the only open event is scheduled_retry (THE regression)", async () => {
    orgsInDunning = [orgAtDay(2)];
    dunningEventsByOrg[1] = [
      {
        id: 77,
        status: "scheduled_retry",
        amountDueCents: 4900,
        notificationsSent: [{ type: "payment_failed", sentAt: new Date().toISOString(), channel: "email" }],
      },
    ];
    await dunningService.processScheduledTasks();
    expect(EMAILS).toHaveLength(1);
    expect(EMAILS[0].to).toBe("billing@acme.test");
    // The sent notification is recorded on the event for dedupe.
    expect(EVENT_UPDATES).toHaveLength(1);
    expect(EVENT_UPDATES[0].id).toBe(77);
    const types = EVENT_UPDATES[0].updates.notificationsSent.map((n: any) => n.type);
    expect(types).toContain("reminder");
  });

  it("does not resend a notification already recorded on the event", async () => {
    orgsInDunning = [orgAtDay(2)];
    dunningEventsByOrg[1] = [
      {
        id: 78,
        status: "scheduled_retry",
        amountDueCents: 4900,
        notificationsSent: [
          { type: "payment_failed", sentAt: new Date().toISOString(), channel: "email" },
          { type: "reminder", sentAt: new Date().toISOString(), channel: "email" },
        ],
      },
    ];
    await dunningService.processScheduledTasks();
    expect(EMAILS).toHaveLength(0);
    expect(EVENT_UPDATES).toHaveLength(0);
  });

  it("ignores resolved/cancelled events when picking the ladder target", async () => {
    orgsInDunning = [orgAtDay(2)];
    dunningEventsByOrg[1] = [
      { id: 80, status: "resolved", amountDueCents: 4900, notificationsSent: [] },
      { id: 79, status: "scheduled_retry", amountDueCents: 4900, notificationsSent: [] },
    ];
    await dunningService.processScheduledTasks();
    expect(EVENT_UPDATES).toHaveLength(1);
    expect(EVENT_UPDATES[0].id).toBe(79);
  });
});
