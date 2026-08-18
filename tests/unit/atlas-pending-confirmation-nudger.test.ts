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
    // A REAL PushResult, not `undefined`. The spy used to resolve undefined,
    // which meant this suite never exercised the dispatch status at all — and
    // when the nudger started reading it, a mutation that removed the status
    // check entirely still passed here. A mock that is vaguer than the contract
    // makes the test agree with any implementation.
    sendPushSpy = vi.fn().mockResolvedValue({ status: "delivered", sent: 1, failed: 0 });

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
      sendPushToPerson: sendPushSpy,
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

    // sendPushToPerson(userId, payload).
    //
    // THIS ASSERTION USED TO READ `expect(firstCall[0]).toBe(0)`, with a comment
    // explaining that the nudger passes "the platform org (0) as
    // organizationId". It pinned the defect as if it were the contract:
    // subscriptions are stored under the subscriber's REAL org, and
    // organizations.id is a serial starting at 1, so org 0 matched no row and
    // the founder received none of these nudges — while {sent:0,failed:0} and
    // this green test both read as success.
    //
    // Rewritten to the new truth rather than deleted. What it was really
    // guarding — "each idle row produces exactly one push, addressed to the
    // right founder, with a stable dedupe tag" — is unchanged and still here.
    const firstCall = sendPushSpy.mock.calls[0];
    expect(firstCall[0]).toBe("u_test_1");
    expect(firstCall[1].title).toMatch(/approval/i);
    expect(firstCall[1].body).toContain("approve_trigger");
    expect(firstCall[1].url).toContain("confirm=abc123");
    expect(firstCall[1].tag).toBe("atlas-confirm-abc123");

    // No caller may pass an organization id here any more: a person-addressed
    // push has no tenant argument to get wrong.
    expect(firstCall).toHaveLength(2);

    // Should have stamped pushedAt — once per row.
    expect(dbUpdateSpy).toHaveBeenCalledTimes(2);
  });

  it("a push that reached nobody does not stamp pushedAt", async () => {
    // THE DEFECT THIS SUITE MISSED. `sendPushToPerson` does not throw when the
    // founder has no registered device, when VAPID is unset, or when the
    // recipient is refused — it returns a status. The nudger used to stamp
    // `pushedAt` on anything that did not throw, so a founder who was never
    // reachable was recorded as nudged and never nudged again: the failure
    // consumed its own retry.
    for (const status of ["no_destination", "not_configured", "not_permitted", "failed"]) {
      dbUpdateSpy.mockClear();
      sendPushSpy.mockResolvedValueOnce({ status, sent: 0, failed: 0 });
      dbSelectRows = [
        { id: "n1", threadId: 7, founderUserId: "u_a", toolName: "fly_deploy", ctxSnapshot: null },
      ];

      const pushed = await runNudgePass();

      expect(pushed, `status=${status} was counted as a nudge`).toBe(0);
      expect(
        dbUpdateSpy,
        `status=${status} stamped pushedAt, so the row will never be retried`,
      ).not.toHaveBeenCalled();
    }
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
