/**
 * Pax pause — the unattended jobs honour it (pause coverage, 2026-09-02).
 *
 * Three engines that run on timers with nobody watching:
 *   - leadNurturer.processLeadsForOrg  (every 15 min, per active org)
 *   - task-runner.runTask               (every 60 s, per due scheduled task)
 *   - autonomousTaskProcessor           (every 30 s, auto-executes agent tasks)
 *
 * For each, against the REAL module with its stores stood up as doubles:
 *   paused  → the work is SKIPPED for this tick (never failed, never
 *             cancelled, no bookkeeping advanced) and says so;
 *   unpaused → the same call does the work it did before;
 *   failed pause read → fails CLOSED (treated as paused).
 * Plus the processor-specific promise: one pause read and one log line per
 * org per batch, and a paused org's tasks never starve another org's.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { agentTasks } from "@shared/schema";

const H = vi.hoisted(() => {
  type Call = { method: string; args: unknown[] };
  type Op = { op: "select" | "update" | "insert"; table: unknown; chain: Call[] };
  const dbCalls: Op[] = [];
  let selectRows: (table: unknown) => unknown[] = () => [];

  /** A thenable drizzle-shaped chain that records every call and resolves via `resolver`. */
  function chain(op: Op["op"], table: unknown, resolver: (rec: Op) => unknown) {
    const rec: Op = { op, table, chain: [] };
    dbCalls.push(rec);
    const c: any = {};
    for (const m of ["from", "where", "orderBy", "limit", "set", "values", "returning"]) {
      c[m] = (...args: unknown[]) => {
        rec.chain.push({ method: m, args });
        if (m === "from") rec.table = args[0];
        return c;
      };
    }
    c.then = (onF: any, onR: any) =>
      Promise.resolve()
        .then(() => resolver(rec))
        .then(onF, onR);
    return c;
  }

  const db = {
    select: vi.fn(() => chain("select", undefined, (r) => selectRows(r.table))),
    update: vi.fn((table: unknown) => chain("update", table, () => undefined)),
    insert: vi.fn((table: unknown) => chain("insert", table, () => [])),
  };

  return {
    db,
    dbCalls,
    setSelectRows: (fn: typeof selectRows) => {
      selectRows = fn;
    },
    getPaxPauseState: vi.fn(async (_orgId: number) => ({
      paused: false,
      pausedUntil: null as Date | null,
      checkFailed: false,
    })),
    evaluate: vi.fn(async (_orgId: number, _agent: string, _risk: unknown) => ({
      decision: "deny" as const,
      reason: "test-deny",
      riskScore: 99,
    })),
    recordAction: vi.fn(async () => undefined),
    executeAgentTask: vi.fn(async () => ({ success: true })),
    executeWorkflow: vi.fn(async () => ({ id: 1, status: "completed" })),
    storage: {
      setJobStatus: vi.fn(async (_t: string, _s: string) => undefined),
      getJobCursor: vi.fn(async () => null),
      updateJobCursor: vi.fn(async () => undefined),
      getLeadsNeedingScoring: vi.fn(async (_orgId: number, _limit: number) => [] as any[]),
      getLeadsDueForFollowUp: vi.fn(async () => [] as any[]),
      updateLeadScore: vi.fn(),
      createLeadActivity: vi.fn(),
      getScheduledTask: vi.fn(async (_id: number) => null as any),
      updateScheduledTask: vi.fn(async (_id: number, _u: any) => undefined),
      getWorkflow: vi.fn(async () => ({
        id: 5,
        organizationId: 7,
        actions: [],
        trigger: { event: "deal.updated" },
      })),
      getDueScheduledTasks: vi.fn(async () => [] as any[]),
    },
    checkLeadAging: vi.fn(async () => ({ alertsCreated: 0 })),
    recordUsage: vi.fn(async () => ({ insufficientCredits: false })),
    loggerInfo: vi.fn(),
  };
});

vi.mock("../../server/db", () => ({ db: H.db }));
vi.mock("../../server/storage", () => ({ storage: H.storage, db: H.db }));
vi.mock("../../server/services/paxPause", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/services/paxPause")>();
  return { ...actual, getPaxPauseState: H.getPaxPauseState };
});
vi.mock("../../server/services/autonomousAgentEngine", () => ({
  autonomousAgentEngine: { evaluate: H.evaluate, recordAction: H.recordAction },
}));
vi.mock("../../server/services/core-agents", () => ({
  executeAgentTask: H.executeAgentTask,
}));
vi.mock("../../server/services/workflow-engine", () => ({
  workflowEngine: { executeWorkflow: H.executeWorkflow },
}));
vi.mock("../../server/services/credits", () => ({
  usageMeteringService: { recordUsage: H.recordUsage },
}));
vi.mock("../../server/services/alerting", () => ({
  alertingService: { checkLeadAging: H.checkLeadAging },
}));
vi.mock("../../server/utils/openaiClient", () => ({ getOpenAIClient: () => null }));
vi.mock("../../server/services/tracedLlmCall", () => ({ tracedLlmCall: vi.fn() }));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: H.loggerInfo, warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { leadNurturerService } from "../../server/services/leadNurturer";
import { taskRunnerService } from "../../server/services/task-runner";
import { runOnce } from "../../server/jobs/autonomousTaskProcessor";

const ORG_ID = 7;
const OTHER_ORG_ID = 8;
const PAUSED_UNTIL = new Date(Date.now() + 24 * 60 * 60 * 1000);

const UNPAUSED = { paused: false, pausedUntil: null, checkFailed: false };
const PAUSED = { paused: true, pausedUntil: PAUSED_UNTIL, checkFailed: false };
const CHECK_FAILED = { paused: true, pausedUntil: null, checkFailed: true };

beforeEach(() => {
  vi.clearAllMocks();
  H.dbCalls.length = 0;
  H.setSelectRows(() => []);
  H.getPaxPauseState.mockResolvedValue(UNPAUSED);
});

// ── leadNurturer ─────────────────────────────────────────────────────────────

describe("leadNurturer.processLeadsForOrg", () => {
  const opts = { scoringLimit: 20, generateFollowUps: false };

  it("paused → the whole pass is skipped for this tick with skippedPaused: true; nothing touched", async () => {
    H.getPaxPauseState.mockResolvedValue(PAUSED);

    const result = await leadNurturerService.processLeadsForOrg(ORG_ID, opts);

    expect(result.skippedPaused).toBe(true);
    expect(result.scored).toBe(0);
    expect(result.errors).toEqual([]);
    expect(H.getPaxPauseState).toHaveBeenCalledWith(ORG_ID);
    expect(H.storage.setJobStatus).not.toHaveBeenCalled();
    expect(H.storage.getLeadsNeedingScoring).not.toHaveBeenCalled();
    expect(H.recordUsage).not.toHaveBeenCalled();
    // Aging alerts are part of the pass too — skipped, not run around the gate.
    expect(H.checkLeadAging).not.toHaveBeenCalled();
  });

  it("failed pause read → fails CLOSED (skipped)", async () => {
    H.getPaxPauseState.mockResolvedValue(CHECK_FAILED);
    const result = await leadNurturerService.processLeadsForOrg(ORG_ID, opts);
    expect(result.skippedPaused).toBe(true);
    expect(H.storage.getLeadsNeedingScoring).not.toHaveBeenCalled();
  });

  it("unpaused → the pass runs as before and reports skippedPaused: false", async () => {
    const result = await leadNurturerService.processLeadsForOrg(ORG_ID, opts);

    expect(result.skippedPaused).toBe(false);
    expect(H.storage.getLeadsNeedingScoring).toHaveBeenCalledWith(ORG_ID, 20);
    expect(H.storage.setJobStatus).toHaveBeenCalledWith(`lead_nurturing_${ORG_ID}`, "running");
    expect(H.storage.setJobStatus).toHaveBeenCalledWith(`lead_nurturing_${ORG_ID}`, "idle");
    expect(H.checkLeadAging).toHaveBeenCalledWith(ORG_ID);
  });
});

// ── task-runner ──────────────────────────────────────────────────────────────

describe("task-runner.runTask", () => {
  const TASK = {
    id: 1,
    organizationId: ORG_ID,
    name: "nightly-workflow",
    type: "workflow",
    status: "active",
    schedule: "daily",
    config: { workflowId: 5 },
    retryCount: 0,
    maxRetries: 3,
    retryDelayMinutes: 5,
  };

  beforeEach(() => {
    H.storage.getScheduledTask.mockResolvedValue(TASK);
  });

  it("paused → returns before executing, nextRunAt NOT advanced, not a retry, not a failure", async () => {
    H.getPaxPauseState.mockResolvedValue(PAUSED);

    const result = await taskRunnerService.runTask(1);

    expect(result.success).toBe(false);
    expect(result.skippedPaused).toBe(true);
    expect(result.error).toContain("Pax is paused until");
    expect(result.error).toContain(PAUSED_UNTIL.toISOString());
    expect(H.executeWorkflow).not.toHaveBeenCalled();
    // Mirrors the task-level "paused" early return: no bookkeeping at all,
    // so the task is due again next tick and runs the moment the pause lifts.
    expect(H.storage.updateScheduledTask).not.toHaveBeenCalled();
    expect(H.getPaxPauseState).toHaveBeenCalledWith(ORG_ID);
  });

  it("failed pause read → fails CLOSED (skipped, nothing executed)", async () => {
    H.getPaxPauseState.mockResolvedValue(CHECK_FAILED);
    const result = await taskRunnerService.runTask(1);
    expect(result.skippedPaused).toBe(true);
    expect(result.error).toContain("could not verify");
    expect(H.executeWorkflow).not.toHaveBeenCalled();
    expect(H.storage.updateScheduledTask).not.toHaveBeenCalled();
  });

  it("processScheduledTasks tallies a pause skip as skippedPaused, not as failed", async () => {
    H.getPaxPauseState.mockResolvedValue(PAUSED);
    H.storage.getDueScheduledTasks.mockResolvedValue([{ id: 1 }]);

    const summary = await taskRunnerService.processScheduledTasks();

    expect(summary).toEqual({ processed: 1, succeeded: 0, failed: 0, skippedPaused: 1 });
  });

  it("unpaused → executes the workflow and advances the schedule as before", async () => {
    const result = await taskRunnerService.runTask(1);

    expect(result.success).toBe(true);
    expect(H.executeWorkflow).toHaveBeenCalledTimes(1);
    expect(H.storage.updateScheduledTask).toHaveBeenCalledTimes(1);
    const [id, updates] = H.storage.updateScheduledTask.mock.calls[0];
    expect(id).toBe(1);
    expect(updates).toMatchObject({ status: "active", retryCount: 0, lastError: null });
    expect(updates.nextRunAt).toBeInstanceOf(Date);
  });
});

// ── autonomousTaskProcessor ──────────────────────────────────────────────────

describe("autonomousTaskProcessor.processBatch (via runOnce)", () => {
  function pendingTask(id: number, organizationId: number) {
    return {
      id,
      organizationId,
      agentType: "research",
      status: "pending",
      requiresReview: false,
      priority: 5,
      input: { action: "execute_skill", parameters: { skillId: "sendEmail" } },
      relatedLeadId: null,
      relatedPropertyId: null,
      relatedDealId: null,
      createdAt: new Date(),
    };
  }

  function agentTaskUpdates() {
    return H.dbCalls.filter((c) => c.op === "update" && c.table === agentTasks);
  }

  it("a paused org's pending tasks are left pending — not evaluated, not executed, not written — and the batch still serves other orgs", async () => {
    H.setSelectRows((table) =>
      table === agentTasks
        ? [pendingTask(1, ORG_ID), pendingTask(2, ORG_ID), pendingTask(3, OTHER_ORG_ID)]
        : [],
    );
    H.getPaxPauseState.mockImplementation(async (orgId: number) =>
      orgId === ORG_ID ? PAUSED : UNPAUSED,
    );

    await runOnce();

    // Only org 8's task reached the engine (denied → cancelled). Org 7's two
    // tasks produced NO agent_tasks write of any kind.
    expect(H.evaluate).toHaveBeenCalledTimes(1);
    expect(H.evaluate.mock.calls[0][0]).toBe(OTHER_ORG_ID);
    expect(H.executeAgentTask).not.toHaveBeenCalled();
    const updates = agentTaskUpdates();
    expect(updates).toHaveLength(1);
    const setPayload = updates[0].chain.find((c) => c.method === "set")!.args[0] as any;
    expect(setPayload.status).toBe("cancelled");
    expect(setPayload.error).toContain("test-deny");

    // One pause read and one log line per org per batch — not per task.
    expect(H.getPaxPauseState).toHaveBeenCalledTimes(2);
    const pauseLogs = H.loggerInfo.mock.calls.filter(([msg]) =>
      String(msg).includes(`Pax is paused for org ${ORG_ID}`),
    );
    expect(pauseLogs).toHaveLength(1);
    const batchLog = H.loggerInfo.mock.calls.find(([msg]) => String(msg).includes("Batch complete"));
    expect(batchLog?.[0]).toContain("skippedPaused:2");
    expect(batchLog?.[0]).toContain("failed:1");
  });

  it("failed pause read → fails CLOSED: the org's tasks are left pending", async () => {
    H.setSelectRows((table) => (table === agentTasks ? [pendingTask(1, ORG_ID)] : []));
    H.getPaxPauseState.mockResolvedValue(CHECK_FAILED);

    await runOnce();

    expect(H.evaluate).not.toHaveBeenCalled();
    expect(H.executeAgentTask).not.toHaveBeenCalled();
    expect(agentTaskUpdates()).toHaveLength(0);
  });

  it("unpaused → tasks reach the autonomy engine as before", async () => {
    H.setSelectRows((table) => (table === agentTasks ? [pendingTask(1, ORG_ID)] : []));

    await runOnce();

    expect(H.getPaxPauseState).toHaveBeenCalledWith(ORG_ID);
    expect(H.evaluate).toHaveBeenCalledTimes(1);
    expect(agentTaskUpdates()).toHaveLength(1);
  });
});
