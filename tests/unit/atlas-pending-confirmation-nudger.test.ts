/**
 * Atlas pending-confirmation nudger (Phase F push).
 *
 * The nudger reads chat_pending_tool_calls, picks rows that are idle
 * past NUDGE_AFTER_SECONDS and haven't been pushed yet, and fires a
 * web-push via pushNotificationService. We test the SELECT/UPDATE
 * orchestration logic with the db client mocked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("atlasPendingConfirmationNudger", () => {
  let runNudgePass: typeof import("../../server/jobs/atlasPendingConfirmationNudger").runNudgePass;
  let sendPushSpy: ReturnType<typeof vi.fn>;
  let dbSelectRows: Array<{
    id: string;
    threadId: number;
    founderUserId: string;
    toolName: string;
    ctxSnapshot: Record<string, unknown> | null;
  }>;
  let dbUpdateSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    dbSelectRows = [];
    dbUpdateSpy = vi.fn().mockReturnValue({
      set: () => ({ where: () => Promise.resolve(undefined) }),
    });
    sendPushSpy = vi.fn().mockResolvedValue(undefined);

    vi.doMock("../../server/db", () => ({
      db: {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () => Promise.resolve(dbSelectRows),
            }),
          }),
        }),
        update: dbUpdateSpy,
      },
    }));

    vi.doMock("../../server/services/pushNotificationService", () => ({
      sendPushToUser: sendPushSpy,
    }));

    runNudgePass = (await import("../../server/jobs/atlasPendingConfirmationNudger")).runNudgePass;
  });

  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("returns 0 and sends nothing when no rows are pending", async () => {
    dbSelectRows = [];
    const pushed = await runNudgePass();
    expect(pushed).toBe(0);
    expect(sendPushSpy).not.toHaveBeenCalled();
  });

  it("sends a push for each idle row and stamps pushedAt", async () => {
    dbSelectRows = [
      { id: "abc123", threadId: 1, founderUserId: "u_test_1", toolName: "approve_trigger", ctxSnapshot: null },
      { id: "def456", threadId: 2, founderUserId: "u_test_2", toolName: "transfer_between_buckets", ctxSnapshot: { somethingElse: true } },
    ];
    const pushed = await runNudgePass();

    expect(pushed).toBe(2);
    expect(sendPushSpy).toHaveBeenCalledTimes(2);

    const firstCall = sendPushSpy.mock.calls[0];
    expect(firstCall[0]).toBe("u_test_1");
    expect(firstCall[1].title).toMatch(/approval/i);
    expect(firstCall[1].body).toContain("approve_trigger");
    expect(firstCall[1].url).toContain("confirm=abc123");
    expect(firstCall[1].tag).toBe("atlas-confirm-abc123");

    // Should have stamped pushedAt — once per row.
    expect(dbUpdateSpy).toHaveBeenCalledTimes(2);
  });

  it("push failure does not stamp pushedAt — row retried next pass", async () => {
    dbSelectRows = [
      { id: "x", threadId: 1, founderUserId: "u_a", toolName: "fly_deploy", ctxSnapshot: null },
    ];
    sendPushSpy.mockRejectedValueOnce(new Error("VAPID missing"));

    const pushed = await runNudgePass();
    expect(pushed).toBe(0);
    expect(sendPushSpy).toHaveBeenCalledTimes(1);
    expect(dbUpdateSpy).not.toHaveBeenCalled();
  });
});
