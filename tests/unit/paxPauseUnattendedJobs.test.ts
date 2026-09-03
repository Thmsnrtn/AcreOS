/**
 * Pax controls — the unattended jobs honour them (AUTONOMY_SPEC.md §4.4).
 *
 * Two engines that run on timers with nobody watching:
 *   - leadNurturer.processLeadsForOrg  (every 15 min, per active org)
 *   - task-runner.runTask               (every 60 s, per due scheduled task)
 *
 * For each, against the REAL module with its stores stood up as doubles and
 * the ONE reader (getPaxControls) controllable:
 *   paused            → the work is SKIPPED for this tick (never failed,
 *                       never cancelled, no bookkeeping advanced) and says
 *                       so in the glossary's words;
 *   switch off        → lead scoring is a real Off (`skippedOff`);
 *   unpaused, on      → the same call does the work it did before, and a
 *                       stage transition leaves a "What Pax did" receipt
 *                       that says a score is not a message;
 *   failed read       → fails CLOSED (treated as paused, "could not verify").
 * Plus the one-read promise: controls handed in by the job are not re-read.
 *
 * (The autonomous task processor that used to sit in this file was deleted
 * 2026-09-02 — founder decision #7 of the customer autonomy clarity program.
 * paxPauseCoverage.test.ts pins that it stays deleted.)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

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
    update: vi.fn((table: unknown) => chain("update", table, () => [])),
    insert: vi.fn((table: unknown) => chain("insert", table, () => [])),
  };

  return {
    db,
    dbCalls,
    setSelectRows: (fn: typeof selectRows) => {
      selectRows = fn;
    },
    getPaxControls: vi.fn(async (_orgId: number) => ({}) as any),
    recordPaxEffect: vi.fn(async () => ({ written: true })),
    executeWorkflow: vi.fn(async () => ({ id: 1, status: "completed" })),
    storage: {
      setJobStatus: vi.fn(async (_t: string, _s: string) => undefined),
      getJobCursor: vi.fn(async () => null),
      updateJobCursor: vi.fn(async () => undefined),
      getLeadsNeedingScoring: vi.fn(async (_orgId: number, _limit: number) => [] as any[]),
      getLeadsDueForFollowUp: vi.fn(async () => [] as any[]),
      updateLeadScore: vi.fn(async (id: number, score: number, factors: unknown) => ({ id, score, scoreFactors: factors, nurturingStage: "cold" })),
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
vi.mock("../../server/services/paxControls", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/services/paxControls")>();
  return { ...actual, getPaxControls: H.getPaxControls };
});
vi.mock("../../server/services/paxReceipts", () => ({ recordPaxEffect: H.recordPaxEffect }));
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

const ORG_ID = 7;
const PAUSED_UNTIL = new Date(Date.now() + 24 * 60 * 60 * 1000);

function controls(over: Record<string, unknown> = {}) {
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

const UNPAUSED = controls();
const PAUSED = controls({ paused: true, pausedUntil: PAUSED_UNTIL, pausedBy: { userId: "u-2", name: "Maria Lopez" } });
const CHECK_FAILED = controls({ paused: true, checkFailed: true, stance: "ask_before_everything", leadScoring: false, borrowerReminders: false, inboxDrafts: false });

beforeEach(() => {
  vi.clearAllMocks();
  H.dbCalls.length = 0;
  H.setSelectRows(() => []);
  H.getPaxControls.mockResolvedValue(UNPAUSED);
});

// ── leadNurturer ─────────────────────────────────────────────────────────────

describe("leadNurturer.processLeadsForOrg", () => {
  const opts = { scoringLimit: 20, generateFollowUps: false };

  it("paused → the whole pass is skipped for this tick with skippedPaused: true; nothing touched", async () => {
    H.getPaxControls.mockResolvedValue(PAUSED);

    const result = await leadNurturerService.processLeadsForOrg(ORG_ID, opts);

    expect(result.skippedPaused).toBe(true);
    expect(result.skippedOff).toBe(false);
    expect(result.scored).toBe(0);
    expect(result.errors).toEqual([]);
    expect(H.getPaxControls).toHaveBeenCalledWith(ORG_ID);
    expect(H.storage.setJobStatus).not.toHaveBeenCalled();
    expect(H.storage.getLeadsNeedingScoring).not.toHaveBeenCalled();
    expect(H.recordUsage).not.toHaveBeenCalled();
    // Aging alerts are part of the pass too — skipped, not run around the gate.
    expect(H.checkLeadAging).not.toHaveBeenCalled();
    expect(H.recordPaxEffect).not.toHaveBeenCalled();
  });

  it("lead scoring switched OFF → a real Off: skippedOff, nothing scored, no alert, no receipt", async () => {
    H.getPaxControls.mockResolvedValue(controls({ leadScoring: false }));

    const result = await leadNurturerService.processLeadsForOrg(ORG_ID, opts);

    expect(result.skippedOff).toBe(true);
    expect(result.skippedPaused).toBe(false);
    expect(H.storage.getLeadsNeedingScoring).not.toHaveBeenCalled();
    expect(H.checkLeadAging).not.toHaveBeenCalled();
    expect(H.recordPaxEffect).not.toHaveBeenCalled();
  });

  it("failed controls read → fails CLOSED (skipped as paused)", async () => {
    H.getPaxControls.mockResolvedValue(CHECK_FAILED);
    const result = await leadNurturerService.processLeadsForOrg(ORG_ID, opts);
    expect(result.skippedPaused).toBe(true);
    expect(H.storage.getLeadsNeedingScoring).not.toHaveBeenCalled();
  });

  it("unpaused, on → the pass runs as before at EITHER stance and reports no skip", async () => {
    for (const stance of ["ask_before_sending", "ask_before_everything"]) {
      vi.clearAllMocks();
      H.getPaxControls.mockResolvedValue(controls({ stance }));
      const result = await leadNurturerService.processLeadsForOrg(ORG_ID, opts);

      expect(result.skippedPaused).toBe(false);
      expect(result.skippedOff).toBe(false);
      expect(H.storage.getLeadsNeedingScoring).toHaveBeenCalledWith(ORG_ID, 20);
      expect(H.storage.setJobStatus).toHaveBeenCalledWith(`lead_nurturing_${ORG_ID}`, "running");
      expect(H.storage.setJobStatus).toHaveBeenCalledWith(`lead_nurturing_${ORG_ID}`, "idle");
      expect(H.checkLeadAging).toHaveBeenCalledWith(ORG_ID);
    }
  });

  it("controls handed in by the job are used — the engine does not read them a second time", async () => {
    await leadNurturerService.processLeadsForOrg(ORG_ID, { ...opts, controls: PAUSED as any });
    expect(H.getPaxControls).not.toHaveBeenCalled();
    expect(H.storage.getLeadsNeedingScoring).not.toHaveBeenCalled();
  });

  it("a stage transition leaves a receipt — actor rule, the org's stance, before/after — stating a score is not a message", async () => {
    H.getPaxControls.mockResolvedValue(controls({ stance: "ask_before_everything" }));
    // A lead that scores hot (recent response + negotiating) while stored cold.
    H.storage.getLeadsNeedingScoring.mockResolvedValue([
      {
        id: 42,
        organizationId: ORG_ID,
        status: "negotiating",
        source: "referral",
        responses: 3,
        lastContactedAt: new Date(),
        emailOpens: 3,
        emailClicks: 1,
        nurturingStage: "cold",
        score: 30,
      },
    ] as any[]);
    H.storage.updateLeadScore.mockImplementation(async (id: number, score: number, factors: unknown) => ({
      id,
      score,
      scoreFactors: factors,
      nurturingStage: "cold",
    }));

    const result = await leadNurturerService.processLeadsForOrg(ORG_ID, opts);

    expect(result.scored).toBe(1);
    expect(H.recordPaxEffect).toHaveBeenCalledTimes(1);
    const receipt = H.recordPaxEffect.mock.calls[0][0] as any;
    expect(receipt).toMatchObject({
      orgId: ORG_ID,
      actor: "rule",
      origin: "engine",
      engine: "lead_scoring",
      stance: "ask_before_everything",
      entityType: "lead",
      entityId: 42,
      witnessed: false,
    });
    expect(receipt.before.nurturingStage).toBe("cold");
    expect(receipt.after.nurturingStage).toBe("hot");
    expect(receipt.description).toContain("a score is not a message");
  });

  it("no receipt when the stage did not change, and none when a human re-scores by hand", async () => {
    H.storage.getLeadsNeedingScoring.mockResolvedValue([
      { id: 43, organizationId: ORG_ID, status: "new", nurturingStage: "cold", score: 40, createdAt: new Date() },
    ] as any[]);
    // updateLeadScore reports the stage the score implies → no transition.
    H.storage.updateLeadScore.mockImplementation(async (id: number, score: number, factors: unknown) => ({
      id,
      score,
      scoreFactors: factors,
      nurturingStage: leadNurturerService.segmentLead(score),
    }));
    await leadNurturerService.processLeadsForOrg(ORG_ID, opts);
    expect(H.recordPaxEffect).not.toHaveBeenCalled();

    // The human path (no attribution) writes the stage but no Pax receipt.
    H.storage.updateLeadScore.mockResolvedValue({ id: 44, score: 90, scoreFactors: {}, nurturingStage: "cold" } as any);
    await leadNurturerService.scoreLead({ id: 44, organizationId: ORG_ID, status: "negotiating", responses: 2, lastContactedAt: new Date(), nurturingStage: "cold" } as any);
    expect(H.recordPaxEffect).not.toHaveBeenCalled();
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

  it("paused → returns before executing, nextRunAt NOT advanced, not a retry, not a failure — with the glossary line", async () => {
    H.getPaxControls.mockResolvedValue(PAUSED);

    const result = await taskRunnerService.runTask(1);

    expect(result.success).toBe(false);
    expect(result.skippedPaused).toBe(true);
    expect(result.error).toContain("Pax is paused until");
    expect(result.error).toContain("paused by Maria Lopez");
    expect(result.error).toMatch(/\b(Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d{1,2}:\d{2} (am|pm)\b/);
    expect(result.error).not.toContain(PAUSED_UNTIL.toISOString());
    expect(result.error).toMatch(/Settings → Pax\b/);
    expect(H.executeWorkflow).not.toHaveBeenCalled();
    // Mirrors the task-level "paused" early return: no bookkeeping at all,
    // so the task is due again next tick and runs the moment the pause lifts.
    expect(H.storage.updateScheduledTask).not.toHaveBeenCalled();
    expect(H.getPaxControls).toHaveBeenCalledWith(ORG_ID);
  });

  it("failed controls read → fails CLOSED (skipped, nothing executed)", async () => {
    H.getPaxControls.mockResolvedValue(CHECK_FAILED);
    const result = await taskRunnerService.runTask(1);
    expect(result.skippedPaused).toBe(true);
    expect(result.error).toContain("could not verify");
    expect(H.executeWorkflow).not.toHaveBeenCalled();
    expect(H.storage.updateScheduledTask).not.toHaveBeenCalled();
  });

  it("processScheduledTasks tallies a pause skip as skippedPaused, not as failed", async () => {
    H.getPaxControls.mockResolvedValue(PAUSED);
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
