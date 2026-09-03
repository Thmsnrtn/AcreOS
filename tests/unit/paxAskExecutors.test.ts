/**
 * Every approved ask replays through exactly one rail
 * (AUTONOMY_SPEC.md §4.3, §4.5 — the wave-0 half of paxAsksAreExecutable).
 *
 * The approve route's callback used to call executeTool for every name; three
 * rails now propose asks. This pins, over the WHOLE registry (every name in
 * PAX_TOOL_GROUPS), that executeApprovedAsk touches one backend and only
 * one — and none for a name no rail claims — with the human's tap passed as
 * the trusted approval, and an attributed receipt written after success and
 * never after failure.
 *
 * The other half — every toolName proposePendingAction is called with
 * (call-site scan) resolves here to exactly one rail — is
 * tests/unit/paxAsksAreExecutable.test.ts.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeTool: vi.fn(async () => ({ success: true, data: { ok: true } })),
  executeSupportTool: vi.fn(async () => ({ success: true, data: { ok: true } })),
  sendManualReminder: vi.fn(async () => ({ success: true, reminderId: 5, status: "sent" })),
  getPaxControls: vi.fn(async () => ({
    stance: "ask_before_sending",
    leadScoring: true,
    borrowerReminders: true,
    inboxDrafts: true,
    paused: false,
    pausedUntil: null,
    pausedBy: null,
    checkFailed: false,
    timezone: "America/Chicago",
  })),
  recordPaxEffect: vi.fn(async (_effect: Record<string, unknown>) => ({ written: true })),
}));

vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/websocket", () => ({ wsServer: { broadcastToOrg: vi.fn() } }));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/ai/tools", () => ({ executeTool: mocks.executeTool }));
vi.mock("../../server/ai/supportAgent", () => ({ executeSupportTool: mocks.executeSupportTool }));
vi.mock("../../server/services/financeAgent", () => ({
  financeAgentService: { sendManualReminder: mocks.sendManualReminder },
}));
vi.mock("../../server/services/paxControls", () => ({ getPaxControls: mocks.getPaxControls }));
vi.mock("../../server/services/paxReceipts", () => ({ recordPaxEffect: mocks.recordPaxEffect }));

import type { Organization } from "../../shared/schema";
import { executeApprovedAsk } from "../../server/services/paxAskExecutors";
import { PAX_TOOL_GROUPS, dispatchForTool } from "../../shared/pax-controls";

const org = { id: 7, ownerId: "u-owner" } as unknown as Organization;
const ctx = { org, userId: "u-1", pendingActionId: 99 };

const backends = () =>
  mocks.executeTool.mock.calls.length +
  mocks.executeSupportTool.mock.calls.length +
  mocks.sendManualReminder.mock.calls.length;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("one rail per name, over the whole registry", () => {
  it("routes every registered name to exactly the rail its dispatch says, and unclaimed names to none", async () => {
    const names = Object.keys(PAX_TOOL_GROUPS);
    expect(names.length).toBeGreaterThan(100);
    const wrong: string[] = [];
    for (const name of names) {
      vi.clearAllMocks();
      const args = name === "send_borrower_reminder" ? { noteId: 3, type: "due" } : { lead_id: 1 };
      const result = await executeApprovedAsk(name, args, ctx);
      const expected = dispatchForTool(name);
      const calls = {
        executeTool: mocks.executeTool.mock.calls.length,
        executeSupportTool: mocks.executeSupportTool.mock.calls.length,
        finance_ladder: mocks.sendManualReminder.mock.calls.length,
      };
      const touched = Object.entries(calls).filter(([, c]) => c > 0).map(([k]) => k);
      if (expected === "refused" || expected === null) {
        if (touched.length !== 0 || result.success || result.executor !== null) wrong.push(`${name}: ${touched.join(",")}`);
      } else if (touched.length !== 1 || touched[0] !== expected || result.executor !== expected) {
        wrong.push(`${name}: expected ${expected}, touched ${touched.join(",") || "nothing"}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("a name no rail claims runs nothing, writes nothing, and says so in the glossary's words", async () => {
    const result = await executeApprovedAsk("made_up_tool", {}, ctx);
    expect(result.success).toBe(false);
    expect(result.executor).toBeNull();
    expect(result.error).toMatch(/Ask Pax to draft it again/);
    expect(backends()).toBe(0);
    expect(mocks.recordPaxEffect).not.toHaveBeenCalled();
  });
});

describe("the tap is the trusted approval", () => {
  it("replays a kernel send through executeTool with trustedApproval and the replay origin", async () => {
    const result = await executeApprovedAsk("send_sms", { to: "+15550001", message: "hi" }, ctx);
    expect(result.success).toBe(true);
    expect(result.executor).toBe("executeTool");
    expect(mocks.executeTool).toHaveBeenCalledTimes(1);
    const [name, args, passedOrg, options] = mocks.executeTool.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
      Organization,
      Record<string, unknown>,
    ];
    expect(name).toBe("send_sms");
    expect(args).toEqual({ to: "+15550001", message: "hi" });
    expect(passedOrg).toBe(org);
    expect(options).toMatchObject({ trustedApproval: true, userId: "u-1", origin: "approval_replay" });
  });

  it("replays a support fix through executeSupportTool with the ticket from source_ref AND the trusted options (seam 1)", async () => {
    await executeApprovedAsk("resync_stripe", {}, { ...ctx, sourceRef: { ticketId: 12 } });
    expect(mocks.executeSupportTool).toHaveBeenCalledTimes(1);
    // Without the fifth argument an approved support ask re-froze as a new
    // ask instead of running (wave-0 handoff seam 1).
    expect(mocks.executeSupportTool.mock.calls[0]).toEqual([
      "resync_stripe",
      {},
      org,
      12,
      { trustedApproval: true, userId: "u-1", origin: "approval_replay" },
    ]);
    expect(mocks.executeTool).not.toHaveBeenCalled();
  });

  it("replays a borrower reminder through the existing human path, org-scoped", async () => {
    await executeApprovedAsk("send_borrower_reminder", { reminderId: 5, type: "late" }, { ...ctx, sourceRef: { noteId: 31 } });
    expect(mocks.sendManualReminder).toHaveBeenCalledTimes(1);
    expect(mocks.sendManualReminder.mock.calls[0]).toEqual([31, 7, "late"]);
  });

  it("refuses a borrower reminder with no note to send for, touching nothing", async () => {
    const result = await executeApprovedAsk("send_borrower_reminder", { reminderId: 5 }, ctx);
    expect(result.success).toBe(false);
    expect(backends()).toBe(0);
    expect(mocks.recordPaxEffect).not.toHaveBeenCalled();
  });
});

describe("the receipt", () => {
  it("is written after success, attributed to the replay, the tap and the stance", async () => {
    await executeApprovedAsk("update_lead_status", { lead_id: 4, status: "hot" }, ctx);
    expect(mocks.recordPaxEffect).toHaveBeenCalledTimes(1);
    const effect = mocks.recordPaxEffect.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(effect).toMatchObject({
      orgId: 7,
      actor: "pax",
      origin: "approval_replay",
      group: "changes_records",
      stance: "ask_before_sending",
      tool: "update_lead_status",
      entityType: "pending_action",
      entityId: 99,
      pendingActionId: 99,
      witnessed: true,
      userId: "u-1",
    });
    expect(String(effect.description)).toMatch(/^Mark lead #4 as hot/);
  });

  it("records no stance when the controls could not be read — never a guess", async () => {
    mocks.getPaxControls.mockResolvedValueOnce({
      stance: "ask_before_everything",
      leadScoring: false,
      borrowerReminders: false,
      inboxDrafts: false,
      paused: true,
      pausedUntil: null,
      pausedBy: null,
      checkFailed: true,
      timezone: "America/New_York",
    });
    await executeApprovedAsk("create_task", { title: "Call Bill" }, ctx);
    const effect = mocks.recordPaxEffect.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(effect.stance).toBeNull();
  });

  it("is not written when the rail reports failure", async () => {
    mocks.executeTool.mockResolvedValueOnce({ success: false, error: "no identity" } as never);
    const result = await executeApprovedAsk("send_email", { to: "a@b.c" }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toBe("no identity");
    expect(mocks.recordPaxEffect).not.toHaveBeenCalled();
  });
});
