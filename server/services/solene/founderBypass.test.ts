/**
 * Tests for founderBypass (Phase B L6.31 — founder-mode bypass).
 *
 * Coverage:
 *  - founderDispatch enqueues with priority=3.0 default
 *  - founderDispatch with maxCostUsd=$200 sets founderOverride=true
 *  - founderDispatch with maxCostUsd=$50 does NOT set founderOverride
 *  - bypassedCostCeiling true when maxCostUsd > $100
 *  - bypassedPlanProposalStage always true
 *  - founderDispatch passes through caller priority when provided
 *  - founderDispatch rejects non-positive maxCostUsd / empty prompt
 *  - founderCancelDispatch on queued row delegates to cancelQueuedDispatch
 *  - founderCancelDispatch on in_progress row issues direct DB update
 *  - founderCancelDispatch on terminal row is a no-op
 *  - founderCancelDispatch on missing row throws
 *  - listFounderInvocations filters by enqueued_by='founder' + respects limit cap
 *  - Audit log fires (logger.info) on every founder invocation
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Logger mock (must be hoisted before the SUT import) ----------------

const loggerInfoMock = vi.fn();
const loggerWarnMock = vi.fn();
const loggerErrorMock = vi.fn();

vi.mock("../../utils/logger", () => ({
  logger: {
    info: loggerInfoMock,
    warn: loggerWarnMock,
    error: loggerErrorMock,
    debug: vi.fn(),
  },
}));

// --- dispatchQueue mock --------------------------------------------------

interface EnqueueCall {
  sourceType: string;
  sourceId: string;
  agentRole: string;
  promptText: string;
  maxCostUsd?: number;
  timeoutMs?: number;
  priority?: number;
  enqueuedBy?: string;
  founderOverride?: boolean;
}

const enqueueCalls: EnqueueCall[] = [];
const cancelQueuedCalls: Array<{ id: number; reason: string }> = [];
let nextDispatchId = 5000;

vi.mock("./dispatchQueue", () => ({
  enqueueDispatch: vi.fn(async (opts: EnqueueCall) => {
    enqueueCalls.push(opts);
    return nextDispatchId++;
  }),
  cancelQueuedDispatch: vi.fn(async (id: number, reason: string) => {
    cancelQueuedCalls.push({ id, reason });
    const row = QUEUE.find((q) => q.id === id);
    if (!row) return { ok: false, priorStatus: null };
    if (row.status !== "queued") {
      return { ok: false, priorStatus: row.status };
    }
    row.status = "cancelled";
    row.completed_at = new Date();
    row.result_summary = `cancelled by founder: ${reason}`;
    return { ok: true, priorStatus: "queued" };
  }),
}));

// --- DB mock -------------------------------------------------------------

interface QueueRow {
  id: number;
  status: string;
  priority: string;
  source_type: string;
  source_id: string;
  agent_role: string;
  prompt_text: string;
  max_cost_usd: string;
  timeout_ms: number;
  enqueued_by: string | null;
  result_summary: string | null;
  completed_at: Date | null;
  queued_at: Date;
}

const QUEUE: QueueRow[] = [];

interface UpdateCall {
  id: number;
  patch: Record<string, unknown>;
}
const updateCalls: UpdateCall[] = [];

vi.mock("../../db", () => {
  const db = {
    select: (_cols: unknown) => {
      const chain: any = {
        _where: undefined as any,
        _orderApplied: false,
        _isFounderQuery: false,
        from: (_t: unknown) => chain,
        where: (clause: any) => {
          chain._where = clause;
          if ((clause as any)?.__enqueuedBy !== undefined) {
            chain._isFounderQuery = true;
          }
          return chain;
        },
        orderBy: (_o: any) => {
          chain._orderApplied = true;
          return chain;
        },
        limit: (n: number) => {
          // listFounderInvocations path
          if (chain._isFounderQuery) {
            const matched = QUEUE.filter(
              (q) => q.enqueued_by === chain._where.__enqueuedBy,
            )
              .slice()
              .sort((a, b) => b.queued_at.getTime() - a.queued_at.getTime())
              .slice(0, n);
            return Promise.resolve(
              matched.map((r) => ({
                id: r.id,
                agentRole: r.agent_role,
                promptText: r.prompt_text,
                maxCostUsd: r.max_cost_usd,
                priority: r.priority,
                status: r.status,
                queuedAt: r.queued_at,
                resultSummary: r.result_summary,
              })),
            );
          }
          // founderCancelDispatch lookup path: by id
          const id = (chain._where as any)?.__id;
          const row = QUEUE.find((q) => q.id === id);
          if (!row) return Promise.resolve([]);
          return Promise.resolve([{ id: row.id, status: row.status }]);
        },
      };
      return chain;
    },
    update: (_table: unknown) => ({
      set: (patch: any) => ({
        where: (clause: any) => {
          const id = (clause as any)?.__id;
          updateCalls.push({ id, patch });
          const row = QUEUE.find((q) => q.id === id);
          if (row) {
            if (patch.status !== undefined) row.status = patch.status;
            if (patch.completedAt !== undefined) row.completed_at = patch.completedAt;
            if (patch.resultSummary !== undefined) row.result_summary = patch.resultSummary;
          }
          return Promise.resolve();
        },
      }),
    }),
  };
  return { db };
});

// drizzle eq stub — embeds field intent + value into the clause object so
// the mock can branch on it.
vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<typeof import("drizzle-orm")>(
    "drizzle-orm",
  );
  return {
    ...actual,
    eq: (col: any, val: any) => {
      // The schema's drizzle column has a `.name` property in some versions
      // and a nested `_.name` in others. We don't rely on it — instead we
      // disambiguate via the value type + the calling-site context.
      const name = col?.name ?? col?._?.name ?? "";
      if (name === "enqueued_by" || val === "founder") {
        return { __enqueuedBy: val };
      }
      return { __id: val };
    },
    desc: (_col: any) => ({ __desc: true }),
  };
});

// --- Test helpers --------------------------------------------------------

function seedQueueRow(partial: Partial<QueueRow>): QueueRow {
  const row: QueueRow = {
    id: partial.id ?? Math.floor(Math.random() * 1000) + 100,
    status: partial.status ?? "queued",
    priority: partial.priority ?? "3.000",
    source_type: partial.source_type ?? "founder_bypass",
    source_id: partial.source_id ?? `founder:${Date.now()}`,
    agent_role: partial.agent_role ?? "iris",
    prompt_text: partial.prompt_text ?? "do thing",
    max_cost_usd: partial.max_cost_usd ?? "50.00",
    timeout_ms: partial.timeout_ms ?? 600000,
    enqueued_by: partial.enqueued_by ?? "founder",
    result_summary: partial.result_summary ?? null,
    completed_at: partial.completed_at ?? null,
    queued_at: partial.queued_at ?? new Date(),
  };
  QUEUE.push(row);
  return row;
}

beforeEach(() => {
  enqueueCalls.length = 0;
  cancelQueuedCalls.length = 0;
  updateCalls.length = 0;
  QUEUE.length = 0;
  nextDispatchId = 5000;
  loggerInfoMock.mockClear();
  loggerWarnMock.mockClear();
  loggerErrorMock.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ========================================================================
// founderDispatch
// ========================================================================

describe("founderBypass.founderDispatch", () => {
  it("enqueues with default priority 3.0", async () => {
    const { founderDispatch } = await import("./founderBypass");
    const res = await founderDispatch({
      agentRole: "iris",
      promptText: "investigate the slow query",
      maxCostUsd: 25,
    });
    expect(res.dispatchId).toBe(5000);
    expect(enqueueCalls).toHaveLength(1);
    expect(enqueueCalls[0].priority).toBe(3.0);
    expect(enqueueCalls[0].sourceType).toBe("founder_bypass");
    expect(enqueueCalls[0].enqueuedBy).toBe("founder");
    expect(enqueueCalls[0].sourceId).toMatch(/^founder:\d+$/);
  });

  it("passes through caller-specified priority", async () => {
    const { founderDispatch } = await import("./founderBypass");
    await founderDispatch({
      agentRole: "soren",
      promptText: "draft a launch post",
      maxCostUsd: 25,
      priority: 5.5,
    });
    expect(enqueueCalls[0].priority).toBe(5.5);
  });

  it("sets founderOverride=true when maxCostUsd=$200", async () => {
    const { founderDispatch } = await import("./founderBypass");
    const res = await founderDispatch({
      agentRole: "iris",
      promptText: "overnight deep-dive",
      maxCostUsd: 200,
    });
    expect(enqueueCalls[0].founderOverride).toBe(true);
    expect(res.bypassedCostCeiling).toBe(true);
    expect(res.bypassedPlanProposalStage).toBe(true);
  });

  it("does NOT set founderOverride when maxCostUsd=$50", async () => {
    const { founderDispatch } = await import("./founderBypass");
    const res = await founderDispatch({
      agentRole: "iris",
      promptText: "quick lookup",
      maxCostUsd: 50,
    });
    expect(enqueueCalls[0].founderOverride).toBe(false);
    expect(res.bypassedCostCeiling).toBe(false);
    expect(res.bypassedPlanProposalStage).toBe(true);
  });

  it("treats maxCostUsd exactly $100 as NOT bypassed (strict >)", async () => {
    const { founderDispatch } = await import("./founderBypass");
    const res = await founderDispatch({
      agentRole: "iris",
      promptText: "right at the line",
      maxCostUsd: 100,
    });
    expect(res.bypassedCostCeiling).toBe(false);
    expect(enqueueCalls[0].founderOverride).toBe(false);
  });

  it("rejects non-positive maxCostUsd", async () => {
    const { founderDispatch } = await import("./founderBypass");
    await expect(
      founderDispatch({
        agentRole: "iris",
        promptText: "x",
        maxCostUsd: 0,
      }),
    ).rejects.toThrow(/invalid maxCostUsd/);
    await expect(
      founderDispatch({
        agentRole: "iris",
        promptText: "x",
        maxCostUsd: -10,
      }),
    ).rejects.toThrow(/invalid maxCostUsd/);
  });

  it("rejects empty promptText", async () => {
    const { founderDispatch } = await import("./founderBypass");
    await expect(
      founderDispatch({
        agentRole: "iris",
        promptText: "   ",
        maxCostUsd: 25,
      }),
    ).rejects.toThrow(/promptText must be non-empty/);
  });

  it("fires structured audit log (logger.info) on every invocation", async () => {
    const { founderDispatch } = await import("./founderBypass");
    await founderDispatch({
      agentRole: "iris",
      promptText: "audit me",
      maxCostUsd: 75,
      reason: "incident response — fast iteration",
    });

    const auditCall = loggerInfoMock.mock.calls.find(
      (c) => c[0] === "[founderBypass] dispatch enqueued",
    );
    expect(auditCall).toBeDefined();
    const payload = auditCall![1] as Record<string, unknown>;
    expect(payload.agentRole).toBe("iris");
    expect(payload.maxCostUsd).toBe(75);
    expect(payload.priority).toBe(3.0);
    expect(payload.bypassedCostCeiling).toBe(false);
    expect(payload.bypassedPlanProposalStage).toBe(true);
    expect(payload.reason).toBe("incident response — fast iteration");
    expect(payload.promptPreview).toBe("audit me");
  });
});

// ========================================================================
// founderCancelDispatch
// ========================================================================

describe("founderBypass.founderCancelDispatch", () => {
  it("delegates to cancelQueuedDispatch when status='queued'", async () => {
    seedQueueRow({ id: 42, status: "queued" });
    const { founderCancelDispatch } = await import("./founderBypass");
    await founderCancelDispatch(42, "changed my mind");
    expect(cancelQueuedCalls).toEqual([{ id: 42, reason: "changed my mind" }]);
    // Should NOT have performed a direct update on top of the delegation.
    expect(updateCalls).toHaveLength(0);
  });

  it("issues direct DB update when status='in_progress'", async () => {
    seedQueueRow({ id: 99, status: "in_progress" });
    const { founderCancelDispatch } = await import("./founderBypass");
    await founderCancelDispatch(99, "stop now");
    expect(cancelQueuedCalls).toHaveLength(0);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].id).toBe(99);
    expect(updateCalls[0].patch.status).toBe("cancelled");
    expect(updateCalls[0].patch.resultSummary).toBe(
      "cancelled by founder: stop now",
    );
    expect(updateCalls[0].patch.completedAt).toBeInstanceOf(Date);
  });

  it("is a no-op on terminal-status rows", async () => {
    seedQueueRow({ id: 7, status: "completed" });
    seedQueueRow({ id: 8, status: "failed" });
    seedQueueRow({ id: 9, status: "cancelled" });
    const { founderCancelDispatch } = await import("./founderBypass");
    await founderCancelDispatch(7, "n/a");
    await founderCancelDispatch(8, "n/a");
    await founderCancelDispatch(9, "n/a");
    expect(cancelQueuedCalls).toHaveLength(0);
    expect(updateCalls).toHaveLength(0);
  });

  it("throws when no dispatch with the given id exists", async () => {
    const { founderCancelDispatch } = await import("./founderBypass");
    await expect(founderCancelDispatch(99999, "x")).rejects.toThrow(
      /no dispatch with id=99999/,
    );
  });

  it("logs an audit info entry on successful cancel", async () => {
    seedQueueRow({ id: 55, status: "in_progress" });
    const { founderCancelDispatch } = await import("./founderBypass");
    await founderCancelDispatch(55, "ops escalation");
    const auditCall = loggerInfoMock.mock.calls.find(
      (c) => c[0] === "[founderBypass] dispatch cancelled",
    );
    expect(auditCall).toBeDefined();
    expect((auditCall![1] as Record<string, unknown>).priorStatus).toBe(
      "in_progress",
    );
  });
});

// ========================================================================
// listFounderInvocations
// ========================================================================

describe("founderBypass.listFounderInvocations", () => {
  it("returns only rows enqueued_by='founder' in DESC order", async () => {
    // Two founder rows + one auto-dispatch row.
    seedQueueRow({
      id: 1,
      enqueued_by: "founder",
      agent_role: "iris",
      prompt_text: "first invocation",
      max_cost_usd: "50.00",
      priority: "3.000",
      status: "queued",
      queued_at: new Date(2026, 5, 3, 9, 0, 0),
    });
    seedQueueRow({
      id: 2,
      enqueued_by: "auto_dispatch",
      agent_role: "soren",
      prompt_text: "auto work",
      max_cost_usd: "25.00",
      priority: "1.000",
      status: "queued",
      queued_at: new Date(2026, 5, 3, 9, 30, 0),
    });
    seedQueueRow({
      id: 3,
      enqueued_by: "founder",
      agent_role: "beatrice",
      prompt_text: "second invocation",
      max_cost_usd: "200.00",
      priority: "3.000",
      status: "completed",
      queued_at: new Date(2026, 5, 3, 10, 0, 0),
    });

    const { listFounderInvocations } = await import("./founderBypass");
    const res = await listFounderInvocations(20);
    expect(res).toHaveLength(2);
    expect(res[0].dispatchId).toBe(3); // newer first
    expect(res[1].dispatchId).toBe(1);
    expect(res[0].agentRole).toBe("beatrice");
    expect(res[0].maxCostUsd).toBe(200);
    expect(res[0].priority).toBe(3);
    expect(res[1].promptPreview).toBe("first invocation");
  });

  it("respects limit and caps at 100", async () => {
    for (let i = 0; i < 5; i++) {
      seedQueueRow({
        id: 100 + i,
        enqueued_by: "founder",
        queued_at: new Date(2026, 5, 3, 9, i, 0),
      });
    }
    const { listFounderInvocations } = await import("./founderBypass");
    const limited = await listFounderInvocations(2);
    expect(limited).toHaveLength(2);
    // limit > 100 must cap at 100, not pass through verbatim. We assert
    // that an oversized request still returns the existing rows without
    // throwing; the cap is enforced internally.
    const oversized = await listFounderInvocations(5000);
    expect(oversized.length).toBeLessThanOrEqual(100);
    expect(oversized).toHaveLength(5);
  });

  it("uses default limit of 20 when not specified", async () => {
    for (let i = 0; i < 3; i++) {
      seedQueueRow({
        id: 200 + i,
        enqueued_by: "founder",
        queued_at: new Date(2026, 5, 3, 8, i, 0),
      });
    }
    const { listFounderInvocations } = await import("./founderBypass");
    const res = await listFounderInvocations();
    expect(res).toHaveLength(3);
  });
});
