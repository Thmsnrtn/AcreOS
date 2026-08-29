/**
 * Execution Engine Honesty — no manufactured success for unrun actions.
 *
 * The engine used to return { success: true, note: "Action logged (no specific
 * executor)" } when actionRegistry had no executor for an action — so five live
 * callers (autonomyFinalMile, reactiveOrchestrationV14, agentInitiativeEngine,
 * sagaOrchestratorV12; selfHealingExecutor, deleted 2026-08-28 as zero-caller) could report completed work that
 * never ran. That is fabricated activity, forbidden by the no-fabrication
 * hard-stop. This suite pins the honest behavior: unregistered action →
 * success:false + "no_executor_registered", audited as NOT run; registered
 * actions still execute and succeed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Captured audit rows (agent_events inserts) ────────────────────────────────
const insertedRows: Array<Record<string, any>> = [];

vi.mock("../../server/db", () => ({
  db: {
    // Rate limiter upsert + GC both go through db.execute; count 1 keeps the
    // fail-closed throttle green so the registry path is what's under test.
    execute: vi.fn().mockResolvedValue({ rows: [{ count: 1 }] }),
    insert: vi.fn().mockImplementation(() => ({
      values: vi.fn().mockImplementation((row: Record<string, any>) => {
        insertedRows.push(row);
        return Promise.resolve([]);
      }),
    })),
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    })),
    update: vi.fn().mockImplementation(() => ({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    })),
  },
}));

const broadcastFounderEvent = vi.fn();
vi.mock("../../server/websocket", () => ({
  wsServer: {
    broadcastFounderEvent: (...args: any[]) => broadcastFounderEvent(...args),
    broadcast: vi.fn(),
  },
}));

// Safety-gate collaborators (dynamically imported by the engine) — pass all
// gates so the tests isolate the executor-lookup behavior.
vi.mock("../../server/services/trustAuthorityEscalation", () => ({
  trustAuthorityEscalation: {
    isActionAllowed: vi.fn().mockReturnValue(true),
    getTier: vi.fn().mockReturnValue({ label: "test", allowedActions: [] }),
  },
}));
vi.mock("../../server/services/companyAgents", () => ({
  companyAgentService: {
    getByCodename: vi.fn().mockResolvedValue(undefined),
    // The trust-authority gate reads the EFFECTIVE score (base + any active
    // CEO-absence boost, derived rather than stored). An unknown agent has no
    // earned standing, so 0 — which is what the real implementation returns for
    // a missing row, and which getTier() maps to Observer.
    effectiveTrustScore: vi.fn().mockResolvedValue(0),
  },
}));
vi.mock("../../server/services/eventMeshPublisher", () => ({
  eventMeshPublisher: {
    publish: vi.fn().mockResolvedValue(undefined),
  },
}));

import { executionEngine } from "../../server/services/executionEngine";

const baseCtx = {
  orgId: 42,
  agentCodename: "test-agent",
  action: "definitely_not_a_registered_action",
  input: { leadId: 7, note: "hello" },
};

beforeEach(() => {
  insertedRows.length = 0;
  broadcastFounderEvent.mockClear();
});

describe("executionEngine honesty — unregistered actions", () => {
  it("refuses with success:false and no_executor_registered instead of manufacturing success", async () => {
    const result = await executionEngine.execute({ ...baseCtx });

    expect(result.success).toBe(false);
    expect(result.error).toBe("no_executor_registered");
    expect(result.output).toMatchObject({
      action: "definitely_not_a_registered_action",
      input: baseCtx.input,
      error: "no_executor_registered",
    });
    // The old fabricated shape must be gone
    expect(result.output.note).toBeUndefined();
  });

  it("sideEffects state that NOTHING was executed", async () => {
    const result = await executionEngine.execute({ ...baseCtx });

    expect(result.sideEffects).toHaveLength(1);
    expect(result.sideEffects[0]).toMatch(/NOTHING executed/);
    expect(result.sideEffects[0]).toContain("definitely_not_a_registered_action");
  });

  it("audits the attempt as refused/failed, never as succeeded", async () => {
    await executionEngine.execute({ ...baseCtx });

    const refusal = insertedRows.find((r) => r.eventType === "action_refused_no_executor");
    expect(refusal).toBeDefined();
    expect(refusal!.organizationId).toBe(42);
    expect(refusal!.payload).toMatchObject({
      action: "definitely_not_a_registered_action",
      executed: false,
      error: "no_executor_registered",
    });

    const outcome = insertedRows.find((r) => r.eventType === "action_failed");
    expect(outcome).toBeDefined();
    expect(outcome!.payload).toMatchObject({
      action: "definitely_not_a_registered_action",
      success: false,
      error: "no_executor_registered",
    });

    // Regression guard: the manufactured-success outcome must never appear
    expect(insertedRows.some((r) => r.eventType === "action_succeeded")).toBe(false);
  });
});

describe("executionEngine honesty — registered actions", () => {
  it("still executes registered actions and reports real success", async () => {
    const executorSpy = vi.fn().mockResolvedValue({
      success: true,
      output: { didThing: true },
      sideEffects: ["did the thing"],
      durationMs: 0,
    });
    executionEngine.registerAction("honesty_test_registered_action", executorSpy);

    const result = await executionEngine.execute({
      ...baseCtx,
      action: "honesty_test_registered_action",
    });

    expect(executorSpy).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect(result.output).toEqual({ didThing: true });
    expect(result.sideEffects).toEqual(["did the thing"]);
    expect(result.error).toBeUndefined();

    // Outcome recorded as a real success, and broadcast as executed
    expect(insertedRows.some((r) => r.eventType === "action_succeeded")).toBe(true);
    expect(broadcastFounderEvent).toHaveBeenCalledWith(
      "action_executed",
      expect.objectContaining({ action: "honesty_test_registered_action", success: true }),
    );
  });
});
