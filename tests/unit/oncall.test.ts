/**
 * On-call delivery (services/oncall.ts).
 *
 * notifyOnCall() is the single way a P0/P1 is raised. The P0 bug it fixes was
 * that a SEV-1 produced a DB row + an unread email and silence on the founder's
 * phone. These tests assert the fan-out reaches ALL THREE delivery channels —
 * VAPID push (primary), email (audit trail), and the ack-deadline timer — and
 * that one channel failing never suppresses the others.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("notifyOnCall", () => {
  let notifyOnCall: typeof import("../../server/services/oncall").notifyOnCall;
  let sendPushSpy: ReturnType<typeof vi.fn>;
  let sendEmailSpy: ReturnType<typeof vi.fn>;
  let registerCriticalAlertSpy: ReturnType<typeof vi.fn>;
  let insertReturningSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();

    sendPushSpy = vi.fn().mockResolvedValue({ sent: 1, failed: 0 });
    sendEmailSpy = vi.fn().mockResolvedValue({ success: true, messageId: "m1" });
    registerCriticalAlertSpy = vi.fn().mockResolvedValue(undefined);
    insertReturningSpy = vi.fn().mockResolvedValue([{ id: 42 }]);

    vi.doMock("../../server/db", () => ({
      db: {
        insert: () => ({
          values: () => ({ returning: insertReturningSpy }),
        }),
      },
    }));

    vi.doMock("../../server/services/pushNotificationService", () => ({
      sendPushToUser: sendPushSpy,
    }));

    vi.doMock("../../server/services/emailService", () => ({
      emailService: { sendEmail: sendEmailSpy },
    }));

    vi.doMock("../../server/services/founder", () => ({
      getFounderEmails: () => ["founder@acreos.io"],
      getFounderUserIds: async () => ["user_founder_1"],
      getFounderPrimaryOrgId: async () => 1,
    }));

    vi.doMock("../../server/routes-founder-critical-alerts", () => ({
      registerCriticalAlert: registerCriticalAlertSpy,
    }));

    notifyOnCall = (await import("../../server/services/oncall")).notifyOnCall;
  });

  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("fans out a P0 to all three channels: push, email, and ack-timer", async () => {
    const result = await notifyOnCall("P0", "Production is down", "Everything is on fire");

    // Channel 1: VAPID push to the founder's phone (PRIMARY).
    expect(sendPushSpy).toHaveBeenCalledTimes(1);
    expect(sendPushSpy).toHaveBeenCalledWith(
      1,
      "user_founder_1",
      expect.objectContaining({ body: "Everything is on fire" }),
    );

    // Channel 2: email audit trail.
    expect(sendEmailSpy).toHaveBeenCalledTimes(1);
    expect(sendEmailSpy).toHaveBeenCalledWith(
      expect.objectContaining({ to: ["founder@acreos.io"] }),
    );

    // Channel 3: ack-deadline timer, anchored to the persisted notification id.
    expect(registerCriticalAlertSpy).toHaveBeenCalledTimes(1);
    expect(registerCriticalAlertSpy).toHaveBeenCalledWith({
      notificationId: 42,
      severity: "P0",
    });

    expect(result.notificationId).toBe(42);
    expect(result.push.sent).toBe(1);
    expect(result.emailSent).toBe(true);
    expect(result.ackTimerRegistered).toBe(true);
  });

  it("still delivers the other channels when push throws", async () => {
    sendPushSpy.mockRejectedValueOnce(new Error("VAPID exploded"));

    const result = await notifyOnCall("P1", "Webhook failing", "Stripe is sad");

    // Push failed, but email + ack-timer must still fire.
    expect(sendEmailSpy).toHaveBeenCalledTimes(1);
    expect(registerCriticalAlertSpy).toHaveBeenCalledTimes(1);
    expect(result.emailSent).toBe(true);
    expect(result.ackTimerRegistered).toBe(true);
    expect(result.push.sent).toBe(0);
  });

  it("passes P1 severity through to the ack-timer", async () => {
    await notifyOnCall("P1", "Slow burn", "budget");
    expect(registerCriticalAlertSpy).toHaveBeenCalledWith({
      notificationId: 42,
      severity: "P1",
    });
  });
});
