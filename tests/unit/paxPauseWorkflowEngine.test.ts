/**
 * Pax controls — the workflow engine PARKS a paused org's run
 * (AUTONOMY_SPEC.md §4.4 "Workflows"; wave-0 handoff seam 7, adjudicated
 * PARK over per-action BLOCK on 2026-09-02: a paused rule resumes whole).
 *
 * The workflow engine runs unattended: event emitters, the delay-resume
 * sweep and scheduled tasks all end in the same action loop. What is
 * asserted, behaviourally, against the REAL engine with its rails stood up
 * as doubles and the ONE reader (getPaxControls) controllable:
 *   1. While paused, the run PARKS before its first pending step: status
 *      "waiting", resumeAt = the pause expiry, resumeState.reason "paused",
 *      resumeState.nextActionIndex = the step it stopped before. No rail is
 *      touched — no email, no task, no record update, no skill dispatch, no
 *      notification. The run is never "completed" and never "failed".
 *   2. A failed controls read fails CLOSED: parked with resumeAt ~15 min out
 *      and the "could not verify" reason.
 *   3. Resume re-checks: a parked run whose org is still paused re-parks;
 *      once the pause lifts, it resumes at exactly the step it stopped
 *      before and runs every remaining rail.
 *   4. Unpaused, the same workflow runs every rail exactly as before and
 *      each acting step leaves a "What Pax did" receipt (actor rule, the
 *      org's stance) — including an acting step nested in a conditional.
 *   5. There is no per-action pause block any more: the pause is read once
 *      per loop, not per step.
 *
 * Probe that must go red (spec §7): mark the paused run completed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const H = vi.hoisted(() => ({
  getPaxControls: vi.fn(async (_orgId: number) => ({}) as unknown as PaxControlsState),
  recordPaxEffect: vi.fn(async (_effect: PaxEffect) => ({ written: true })),
  createWorkflowRun: vi.fn(async (data: any) => ({ id: 101, ...data })),
  updateWorkflowRun: vi.fn(async (id: number, updates: any) => ({ id, ...updates })),
  getWorkflowById: vi.fn(async (_id: number) => null as any),
  createTask: vi.fn(async (t: any) => ({ id: 42, ...t })),
  createNotification: vi.fn(async (n: any) => ({ id: 7, ...n })),
  updateLead: vi.fn(async () => ({ id: 5, status: "contacted" })),
  getLead: vi.fn(async () => ({
    id: 5,
    organizationId: 7,
    email: "seller@example.com",
    tcpaConsent: true,
    doNotContact: false,
  })),
  sendEmail: vi.fn(async (_opts: any) => ({ success: true, messageId: "ses-msg-1", attempts: 1 })),
  canSendViaChannel: vi.fn((_lead: any, _channel: string) => ({ allowed: true }) as any),
  getSkillById: vi.fn((_id: string) => ({ id: "scoreLead" }) as any),
  executeSkill: vi.fn(async (_id: string, _params: any, _ctx: any) => ({
    success: true,
    data: { score: 82 },
    message: "scored",
  })),
}));

vi.mock("../../server/services/paxControls", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/services/paxControls")>();
  return { ...actual, getPaxControls: H.getPaxControls };
});
vi.mock("../../server/services/paxReceipts", () => ({ recordPaxEffect: H.recordPaxEffect }));
vi.mock("../../server/storage", () => ({
  storage: {
    createWorkflowRun: H.createWorkflowRun,
    updateWorkflowRun: H.updateWorkflowRun,
    getWorkflowById: H.getWorkflowById,
    createTask: H.createTask,
    createNotification: H.createNotification,
    updateLead: H.updateLead,
    getLead: H.getLead,
    getActiveWorkflowsByTrigger: async () => [],
  },
}));
vi.mock("../../server/services/emailService", () => ({
  emailService: { sendEmail: H.sendEmail },
}));
vi.mock("../../server/services/agent-skills", () => ({
  skillRegistry: { getSkillById: H.getSkillById, executeSkill: H.executeSkill },
}));
vi.mock("../../server/services/tcpaCompliance", () => ({
  canSendViaChannel: (lead: any, channel: string) => H.canSendViaChannel(lead, channel),
}));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { workflowEngine } from "../../server/services/workflow-engine";
import type { PaxControlsState } from "../../server/services/paxControls";
import type { PaxEffect } from "../../server/services/paxReceipts";
import { OFFERED_STANCES } from "../../shared/pax-controls";

/** `resumeState.reason` the engine writes for a pause park (pinned as a literal on purpose). */
const RESUME_REASON_PAUSED = "paused";

const ORG_ID = 7;
const PAUSED_UNTIL = new Date(Date.now() + 24 * 60 * 60 * 1000);
const FIFTEEN_MIN = 15 * 60 * 1000;

const ACTING_STEP_IDS = ["a_email", "a_task", "a_update", "a_skill", "a_notify"] as const;

function controls(over: Partial<PaxControlsState> = {}): PaxControlsState {
  return {
    paused: false,
    pausedUntil: null as Date | null,
    pausedBy: null as { userId: string; name: string } | null,
    checkFailed: false,
    stance: "ask_before_sending",
    leadScoring: true,
    borrowerReminders: true,
    inboxDrafts: true,
    timezone: "America/Chicago",
    ...over,
  };
}

function makeWorkflow() {
  return {
    id: 1,
    organizationId: ORG_ID,
    name: "pause-coverage",
    description: "",
    trigger: { event: "lead.created" },
    actions: [
      { id: "a_email", type: "send_email", config: { to: "seller@example.com", subject: "s", body: "b" } },
      { id: "a_task", type: "create_task", config: { title: "Call back", description: "d" } },
      { id: "a_update", type: "update_record", config: { entityType: "lead", updates: { status: "contacted" } } },
      { id: "a_skill", type: "run_agent_skill", config: { skillId: "scoreLead", skillParams: {} } },
      { id: "a_notify", type: "send_notification", config: { message: "hello" } },
      {
        id: "a_cond",
        type: "conditional",
        config: {
          condition: { field: "x", operator: "eq", value: 1 },
          ifTrue: [{ id: "a_nested_task", type: "create_task", config: { title: "nested" } }],
        },
      },
    ],
    isActive: true,
  } as any;
}

const TRIGGER = { event: "lead.created" as any, entityId: 5, entityType: "lead", data: { x: 1 } };

function expectNoRailTouched() {
  expect(H.sendEmail).not.toHaveBeenCalled();
  expect(H.createTask).not.toHaveBeenCalled();
  expect(H.updateLead).not.toHaveBeenCalled();
  expect(H.executeSkill).not.toHaveBeenCalled();
  expect(H.createNotification).not.toHaveBeenCalled();
  expect(H.recordPaxEffect).not.toHaveBeenCalled();
}

/** The last update the engine wrote to the run — the row's final state. */
function lastRunUpdate() {
  const calls = H.updateWorkflowRun.mock.calls;
  return calls[calls.length - 1][1];
}

beforeEach(() => {
  vi.clearAllMocks();
  H.getPaxControls.mockResolvedValue(controls());
  H.canSendViaChannel.mockReturnValue({ allowed: true });
  H.getSkillById.mockReturnValue({ id: "scoreLead" });
  H.getWorkflowById.mockResolvedValue(makeWorkflow());
});

describe("paused org — the run parks whole, nothing runs, and it is never completed", () => {
  it("parks as waiting at the first step: resumeAt = the pause expiry, resumeState.reason paused, no rail touched", async () => {
    H.getPaxControls.mockResolvedValue(
      controls({ paused: true, pausedUntil: PAUSED_UNTIL, pausedBy: { userId: "u-2", name: "Maria Lopez" } }),
    );

    const run = await workflowEngine.executeWorkflow(makeWorkflow(), TRIGGER);

    expect(run.status).toBe("waiting");
    expect(run.status).not.toBe("completed");
    expect(run.resumeAt).toEqual(PAUSED_UNTIL);
    expect(run.resumeState).toMatchObject({
      reason: RESUME_REASON_PAUSED,
      nextActionIndex: 0,
      delayActionIndex: -1,
      pausedUntil: PAUSED_UNTIL.toISOString(),
    });
    expect((run.resumeState as any).variables).toEqual({ x: 1 });

    const log = run.executionLog as any[];
    expect(log[0].actionId).toBe("a_email");
    expect(log[0].status).toBe("waiting");
    expect(log[0].result.paxPaused).toBe(true);
    expect(log[0].result.reason).toContain("Pax is paused until");
    expect(log[0].result.reason).toContain("paused by Maria Lopez");
    expect(log[0].result.reason).not.toContain(PAUSED_UNTIL.toISOString());
    expect(log[0].result.reason).toMatch(/Settings → Pax\b/);
    for (const entry of log.slice(1)) expect(entry.status).toBe("pending");

    expectNoRailTouched();
    expect(H.getPaxControls).toHaveBeenCalledWith(ORG_ID);
    // The row's final state is the park — not a later "completed".
    expect(lastRunUpdate().status).toBe("waiting");
    expect(H.updateWorkflowRun.mock.calls.some(([, u]) => u.status === "completed" || u.status === "failed")).toBe(false);
  });

  it("FAILS CLOSED when the controls read failed — parked ~15 minutes out with the 'could not verify' reason", async () => {
    H.getPaxControls.mockResolvedValue(controls({ paused: true, checkFailed: true, stance: "ask_before_everything" }));
    const before = Date.now();

    const run = await workflowEngine.executeWorkflow(makeWorkflow(), TRIGGER);

    const after = Date.now();
    expect(run.status).toBe("waiting");
    expect(run.resumeAt!.getTime()).toBeGreaterThanOrEqual(before + FIFTEEN_MIN - 1000);
    expect(run.resumeAt!.getTime()).toBeLessThanOrEqual(after + FIFTEEN_MIN + 1000);
    expect((run.resumeState as any).reason).toBe(RESUME_REASON_PAUSED);
    expect((run.resumeState as any).pausedUntil).toBeNull();
    const log = run.executionLog as any[];
    expect(log[0].result.reason).toContain("could not verify");
    expect(log[0].result.checkFailed).toBe(true);
    expectNoRailTouched();
  });
});

describe("resume re-checks the pause", () =>
{
  it("a parked run whose org is still paused re-parks at the same step; no rail runs", async () => {
    H.getPaxControls.mockResolvedValue(controls({ paused: true, pausedUntil: PAUSED_UNTIL }));
    const parked = await workflowEngine.executeWorkflow(makeWorkflow(), TRIGGER);
    vi.clearAllMocks();
    H.getPaxControls.mockResolvedValue(controls({ paused: true, pausedUntil: PAUSED_UNTIL }));
    H.getWorkflowById.mockResolvedValue(makeWorkflow());

    const again = await workflowEngine.resumeWorkflowRun({ ...parked, status: "running" });

    expect(again.status).toBe("waiting");
    expect((again.resumeState as any).reason).toBe(RESUME_REASON_PAUSED);
    expect((again.resumeState as any).nextActionIndex).toBe(0);
    expect(again.resumeAt).toEqual(PAUSED_UNTIL);
    expectNoRailTouched();
  });

  it("once the pause lifts, the run resumes at exactly the step it stopped before and runs every remaining rail", async () => {
    // Park a run that had already finished its first step (a delay-park
    // shape: index 0 done, parked before index 1).
    H.getPaxControls.mockResolvedValue(controls({ paused: true, pausedUntil: PAUSED_UNTIL }));
    const workflow = makeWorkflow();
    const executionLog = workflow.actions.map((a: any, i: number) => ({
      actionId: a.id,
      actionType: a.type,
      status: i === 0 ? "completed" : "pending",
    }));
    const parkedRun = {
      id: 202,
      workflowId: 1,
      status: "running",
      triggerData: TRIGGER,
      executionLog,
      resumeAt: PAUSED_UNTIL,
      resumeState: { delayActionIndex: -1, nextActionIndex: 1, variables: { x: 1 }, delayMinutes: 0, reason: RESUME_REASON_PAUSED },
    } as any;

    H.getPaxControls.mockResolvedValue(controls());
    const resumed = await workflowEngine.resumeWorkflowRun(parkedRun);

    expect(resumed.status).toBe("completed");
    // Step 0 (send_email) was NOT re-run; steps 1-5 ran.
    expect(H.sendEmail).not.toHaveBeenCalled();
    expect(H.createTask).toHaveBeenCalledTimes(2); // a_task + the nested one
    expect(H.updateLead).toHaveBeenCalledTimes(1);
    expect(H.executeSkill).toHaveBeenCalledTimes(1);
    expect(H.createNotification).toHaveBeenCalledTimes(1);
    const log = resumed.executionLog as any[];
    expect(log[0].status).toBe("completed");
    for (const id of ["a_task", "a_update", "a_skill", "a_notify", "a_cond"]) {
      expect(log.find((e) => e.actionId === id).status, id).toBe("completed");
    }
  });
});

describe("unpaused org — the same workflow runs every rail as before and leaves receipts", () => {
  it.each(OFFERED_STANCES)(
    "stance %s: send_email / create_task / update_record / run_agent_skill / send_notification all complete, each with a receipt",
    async (stance) => {
      H.getPaxControls.mockResolvedValue(controls({ stance }));

      const run = await workflowEngine.executeWorkflow(makeWorkflow(), TRIGGER);
      const log = run.executionLog as any[];

      for (const id of ACTING_STEP_IDS) {
        const entry = log.find((e) => e.actionId === id);
        expect(entry.status, `${id}`).toBe("completed");
      }
      expect(H.sendEmail).toHaveBeenCalledTimes(1);
      expect(H.sendEmail.mock.calls[0][0].purpose).toBe("counterparty");
      // top-level + the nested conditional-branch task
      expect(H.createTask).toHaveBeenCalledTimes(2);
      expect(H.updateLead).toHaveBeenCalledTimes(1);
      expect(H.executeSkill).toHaveBeenCalledTimes(1);
      expect(H.createNotification).toHaveBeenCalledTimes(1);
      // The gate DID consult the reader — once for the loop, not once per step.
      expect(H.getPaxControls).toHaveBeenCalledTimes(1);
      expect(H.getPaxControls).toHaveBeenCalledWith(ORG_ID);
      expect(run.status).toBe("completed");

      // "What Pax did": one receipt per acting step that ran (5 top-level +
      // 1 nested create_task), actor rule, the org's stance, the run id.
      expect(H.recordPaxEffect).toHaveBeenCalledTimes(6);
      for (const [effect] of H.recordPaxEffect.mock.calls as any[]) {
        expect(effect).toMatchObject({
          orgId: ORG_ID,
          actor: "rule",
          origin: "engine",
          engine: "workflows",
          stance,
          workflowRunId: 101,
          witnessed: false,
        });
      }
      const taskReceipts = H.recordPaxEffect.mock.calls.filter(([e]: any[]) => e.action === "workflow_create_task");
      expect(taskReceipts).toHaveLength(2);
      expect(taskReceipts[0][0]).toMatchObject({ entityType: "task", entityId: 42 });
      const emailReceipt = H.recordPaxEffect.mock.calls.find(([e]: any[]) => e.action === "workflow_send_email")![0] as any;
      expect(emailReceipt).toMatchObject({ entityType: "lead", entityId: 5 });
      expect(emailReceipt.description).toContain("seller@example.com");
    },
  );

  it("a refused step (consent) leaves no receipt — refusals are not effects", async () => {
    H.canSendViaChannel.mockReturnValue({ allowed: false, reason: "this contact has opted out" });

    const run = await workflowEngine.executeWorkflow(
      { ...makeWorkflow(), actions: [makeWorkflow().actions[0], makeWorkflow().actions[4]] },
      TRIGGER,
    );

    const log = run.executionLog as any[];
    expect(log[0].status).toBe("blocked");
    expect(H.sendEmail).not.toHaveBeenCalled();
    // The notification after it still ran and is the ONLY receipt.
    expect(log[1].status).toBe("completed");
    expect(H.recordPaxEffect).toHaveBeenCalledTimes(1);
    expect(H.recordPaxEffect.mock.calls[0][0]).toMatchObject({ action: "workflow_send_notification" });
    expect(run.status).toBe("completed");
  });
});
