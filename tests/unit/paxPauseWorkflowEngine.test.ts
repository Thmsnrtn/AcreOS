/**
 * Pax pause — the workflow engine honours it (pause coverage, 2026-09-02).
 *
 * The workflow engine runs unattended: event emitters, the delay-resume
 * sweep and scheduled tasks all end in `executeAction`. Before this gate a
 * paused org's workflows still emailed counterparties, wrote records, created
 * tasks, dispatched skills and posted notifications — the switch's promise
 * ("stops every auto-execution path") was false for the whole engine.
 *
 * What is asserted, behaviourally, against the REAL engine with its rails
 * stood up as doubles:
 *   1. While paused, EVERY acting step comes back "blocked" with the honest
 *      "Pax is paused until …" reason — and no rail is touched: no email, no
 *      task, no record update, no skill dispatch, no notification. Including
 *      an acting step nested inside a conditional branch.
 *   2. A pause is a SKIP, not a cancellation: the run still completes, so
 *      the log shows exactly which steps did not happen.
 *   3. A failed pause read fails CLOSED with the "could not verify" reason.
 *   4. Unpaused, the same workflow runs every rail exactly as before.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const H = vi.hoisted(() => ({
  getPaxPauseState: vi.fn(async (_orgId: number) => ({
    paused: false,
    pausedUntil: null as Date | null,
    checkFailed: false,
  })),
  createWorkflowRun: vi.fn(async (data: any) => ({ id: 101, ...data })),
  updateWorkflowRun: vi.fn(async (id: number, updates: any) => ({ id, ...updates })),
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
  getSkillById: vi.fn((_id: string) => ({ id: "scoreLead" }) as any),
  executeSkill: vi.fn(async (_id: string, _params: any, _ctx: any) => ({
    success: true,
    data: { score: 82 },
    message: "scored",
  })),
}));

// The gate under test — controllable pause state; the refusal message is the
// REAL one so the assertions are against product truth, not a copy.
vi.mock("../../server/services/paxPause", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/services/paxPause")>();
  return { ...actual, getPaxPauseState: H.getPaxPauseState };
});
vi.mock("../../server/storage", () => ({
  storage: {
    createWorkflowRun: H.createWorkflowRun,
    updateWorkflowRun: H.updateWorkflowRun,
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
  canSendViaChannel: () => ({ allowed: true }),
}));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { workflowEngine, ACTION_STATUS_BLOCKED } from "../../server/services/workflow-engine";

const ORG_ID = 7;
const PAUSED_UNTIL = new Date(Date.now() + 24 * 60 * 60 * 1000);

const ACTING_STEP_IDS = ["a_email", "a_task", "a_update", "a_skill", "a_notify"] as const;

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

function setPause(state: { paused: boolean; pausedUntil: Date | null; checkFailed: boolean }) {
  H.getPaxPauseState.mockResolvedValue(state);
}

function expectNoRailTouched() {
  expect(H.sendEmail).not.toHaveBeenCalled();
  expect(H.createTask).not.toHaveBeenCalled();
  expect(H.updateLead).not.toHaveBeenCalled();
  expect(H.executeSkill).not.toHaveBeenCalled();
  expect(H.createNotification).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  setPause({ paused: false, pausedUntil: null, checkFailed: false });
  H.getSkillById.mockReturnValue({ id: "scoreLead" });
});

describe("paused org — every acting workflow step is blocked, nothing runs, the run continues", () => {
  it("blocks send_email / create_task / update_record / run_agent_skill / send_notification with the honest reason", async () => {
    setPause({ paused: true, pausedUntil: PAUSED_UNTIL, checkFailed: false });

    const run = await workflowEngine.executeWorkflow(makeWorkflow(), TRIGGER);
    const log = run.executionLog as any[];

    for (const id of ACTING_STEP_IDS) {
      const entry = log.find((e) => e.actionId === id);
      expect(entry, `log entry for ${id}`).toBeTruthy();
      expect(entry.status, `${id} must be "blocked", not "${entry.status}"`).toBe(ACTION_STATUS_BLOCKED);
      expect(entry.result.paxPaused).toBe(true);
      expect(entry.result.pausedUntil).toBe(PAUSED_UNTIL.toISOString());
      expect(entry.result.reason).toContain("Pax is paused until");
      expect(entry.result.reason).toContain(PAUSED_UNTIL.toISOString());
      expect(entry.result.reason).toContain("Settings");
    }

    // The nested create_task inside the conditional branch was gated too —
    // createTask was never called, top-level OR nested.
    expectNoRailTouched();
    expect(H.getPaxPauseState).toHaveBeenCalledWith(ORG_ID);

    // Skip, not cancel: the run completes so the log is an honest record.
    expect(run.status).toBe("completed");
  });

  it("FAILS CLOSED when the pause read failed — blocked with the 'could not verify' reason", async () => {
    setPause({ paused: true, pausedUntil: null, checkFailed: true });

    const run = await workflowEngine.executeWorkflow(makeWorkflow(), TRIGGER);
    const log = run.executionLog as any[];
    for (const id of ACTING_STEP_IDS) {
      const entry = log.find((e) => e.actionId === id);
      expect(entry.status).toBe(ACTION_STATUS_BLOCKED);
      expect(entry.result.reason).toContain("could not verify");
      expect(entry.result.reason).toContain("not executed");
      expect(entry.result.pausedUntil).toBeNull();
    }
    expectNoRailTouched();
    expect(run.status).toBe("completed");
  });

  it("blocked results carry no rail output — nothing merges into workflow variables", async () => {
    setPause({ paused: true, pausedUntil: PAUSED_UNTIL, checkFailed: false });
    const run = await workflowEngine.executeWorkflow(makeWorkflow(), TRIGGER);
    const log = run.executionLog as any[];
    const email = log.find((e) => e.actionId === "a_email");
    expect(email.result.emailSent).toBeUndefined();
    expect(email.result.messageId).toBeUndefined();
    const skill = log.find((e) => e.actionId === "a_skill");
    expect(skill.result.skillExecuted).toBeUndefined();
  });
});

describe("unpaused org — the same workflow runs every rail as before", () => {
  it("send_email / create_task / update_record / run_agent_skill / send_notification all complete", async () => {
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
    // The gate DID consult the switch — that is what makes it real.
    expect(H.getPaxPauseState).toHaveBeenCalledWith(ORG_ID);
    expect(run.status).toBe("completed");
  });
});
