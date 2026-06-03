/**
 * Tests for selfDebug (L3.13 — self-debugging on flagged code-review).
 *
 * Coverage:
 *  - buildSelfDebugPrompt renders all 4 inputs into the prompt text
 *  - enqueueSelfDebugDispatch happy path → enqueueDispatch called, returns
 *    enqueued=true + id, prompt populated
 *  - Idempotency: a self_debug row for the (originalId, reviewId) tuple
 *    already exists → returns enqueued=false, reason='already_debugging'
 *  - enqueueDispatch throws → returns enqueued=false, reason starts with
 *    'enqueue_failed:'
 *  - Cost cap: original=$25 → self-debug=$12.50; original=$8 → floored to $5
 *  - Dry-run: returns enqueued=false, reason='dry_run', promptPreview
 *    populated, does NOT call enqueueDispatch
 *  - original_not_found when row missing
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// --- DB mock --------------------------------------------------------------
// We need richer where-clause semantics here than codeReviewQueue.test.ts
// because the idempotency check filters by sourceType + sourceId + status.

interface QueueRow {
  id: number;
  status: string;
  source_type: string;
  source_id: string;
  agent_role: string;
  prompt_text: string;
  max_cost_usd: string;
}

const QUEUE: QueueRow[] = [];
let nextQueueId = 1;

// Captures every enqueueDispatch call for assertions.
const enqueueDispatchCalls: Array<Record<string, unknown>> = [];
// When non-null, enqueueDispatch will throw with this message.
let enqueueDispatchShouldThrow: string | null = null;

vi.mock("./dispatchQueue", () => ({
  enqueueDispatch: vi.fn(async (opts: Record<string, unknown>) => {
    enqueueDispatchCalls.push(opts);
    if (enqueueDispatchShouldThrow !== null) {
      throw new Error(enqueueDispatchShouldThrow);
    }
    const id = nextQueueId++;
    QUEUE.push({
      id,
      status: "queued",
      source_type: String(opts.sourceType ?? ""),
      source_id: String(opts.sourceId ?? ""),
      agent_role: String(opts.agentRole ?? ""),
      prompt_text: String(opts.promptText ?? ""),
      max_cost_usd: String(opts.maxCostUsd ?? "0"),
    });
    return id;
  }),
}));

vi.mock("../../db", () => {
  function buildSelect(_cols: any) {
    const chain: any = {
      _filters: [] as Array<(r: QueueRow) => boolean>,
      from: (_t: unknown) => chain,
      where: (clause: any) => {
        if (typeof clause === "function") {
          chain._filters.push(clause);
        } else if (Array.isArray(clause)) {
          chain._filters.push(...clause);
        } else if (clause && typeof clause === "object") {
          chain._filters.push(clause as (r: QueueRow) => boolean);
        }
        return chain;
      },
      limit: (n: number) => {
        const matched = QUEUE.filter((r) =>
          chain._filters.every((f: (r: QueueRow) => boolean) => f(r)),
        );
        return Promise.resolve(
          matched.slice(0, n).map((r) => ({
            agentRole: r.agent_role,
            promptText: r.prompt_text,
            maxCostUsd: r.max_cost_usd,
            id: r.id,
          })),
        );
      },
    };
    return chain;
  }

  const db = {
    select: (cols: any) => buildSelect(cols),
  };
  return { db };
});

// drizzle-orm mocks — return predicate functions our select mock applies.
vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<typeof import("drizzle-orm")>(
    "drizzle-orm",
  );
  return {
    ...actual,
    eq: (col: any, val: any) => {
      // Identify the column by its drizzle-internal name when available.
      // Fall back to keying on whether `val` is a number (id) vs string.
      const name: string | undefined =
        col?.name ?? col?.fieldAlias ?? col?._name;
      return (r: QueueRow) => {
        if (name === "id" || (typeof val === "number" && !name)) {
          return r.id === val;
        }
        if (name === "source_type" || name === "sourceType") {
          return r.source_type === val;
        }
        if (name === "source_id" || name === "sourceId") {
          return r.source_id === val;
        }
        if (name === "status") {
          return r.status === val;
        }
        // Heuristic fallback by value type.
        if (typeof val === "number") return r.id === val;
        if (typeof val === "string") {
          // Source ids contain ':'; statuses don't.
          if (val.includes(":")) return r.source_id === val;
          if (val === "self_debug") return r.source_type === val;
          return r.status === val;
        }
        return false;
      };
    },
    and: (...preds: Array<(r: QueueRow) => boolean>) => {
      return (r: QueueRow) => preds.every((p) => p(r));
    },
    not: (pred: (r: QueueRow) => boolean) => {
      return (r: QueueRow) => !pred(r);
    },
    inArray: (col: any, vals: unknown[]) => {
      const name: string | undefined =
        col?.name ?? col?.fieldAlias ?? col?._name;
      return (r: QueueRow) => {
        if (name === "status" || (!name && vals.includes("failed"))) {
          return vals.includes(r.status);
        }
        if (name === "id") return vals.includes(r.id);
        return vals.includes((r as any)[name ?? ""]);
      };
    },
  };
});

// --- Helpers --------------------------------------------------------------

function seedOriginal(args: {
  agentRole?: string;
  prompt?: string;
  maxCostUsd?: number;
}): number {
  const id = nextQueueId++;
  QUEUE.push({
    id,
    status: "completed",
    source_type: "auto_dispatch",
    source_id: `seed:${id}`,
    agent_role: args.agentRole ?? "iris",
    prompt_text: args.prompt ?? "implement L1 schema + tests",
    max_cost_usd: (args.maxCostUsd ?? 25).toFixed(2),
  });
  return id;
}

function seedSelfDebugRow(
  originalId: number,
  reviewId: number,
  status = "queued",
): number {
  const id = nextQueueId++;
  QUEUE.push({
    id,
    status,
    source_type: "self_debug",
    source_id: `flagged:${originalId}:by:${reviewId}`,
    agent_role: "iris",
    prompt_text: "...prior debug...",
    max_cost_usd: "12.50",
  });
  return id;
}

beforeEach(() => {
  QUEUE.length = 0;
  enqueueDispatchCalls.length = 0;
  enqueueDispatchShouldThrow = null;
  nextQueueId = 1;
});

afterEach(() => {
  vi.clearAllMocks();
});

// --- Tests ----------------------------------------------------------------

describe("selfDebug.buildSelfDebugPrompt", () => {
  it("renders all four substitutions into the prompt", async () => {
    const { buildSelfDebugPrompt } = await import("./selfDebug");
    const out = buildSelfDebugPrompt({
      originalDispatchId: 42,
      reviewDispatchId: 99,
      originalAgentRole: "iris",
      originalPromptSummary: "implement the widget",
      reviewFindings: "Missing tsc check + no tests for new branch",
    });

    expect(out).toContain("#42");
    expect(out).toContain("#99");
    expect(out).toContain("You are iris");
    expect(out).toContain("implement the widget");
    expect(out).toContain("Missing tsc check + no tests for new branch");
    // Structural pieces.
    expect(out).toContain("ROOT_CAUSE:");
    expect(out).toContain("PROPOSED_FIX:");
    expect(out).toContain("CONFIDENCE:");
  });

  it("truncates the original prompt summary to 500 chars", async () => {
    const { buildSelfDebugPrompt } = await import("./selfDebug");
    const long = "x".repeat(900);
    const out = buildSelfDebugPrompt({
      originalDispatchId: 1,
      reviewDispatchId: 2,
      originalAgentRole: "iris",
      originalPromptSummary: long,
      reviewFindings: "f",
    });
    // The truncated 500-char block appears; the full 900 does not.
    expect(out).toContain("x".repeat(500));
    expect(out).not.toContain("x".repeat(501));
  });
});

describe("selfDebug.enqueueSelfDebugDispatch", () => {
  it("happy path — calls enqueueDispatch + returns enqueued=true + id", async () => {
    const { enqueueSelfDebugDispatch } = await import("./selfDebug");
    const originalId = seedOriginal({ agentRole: "iris", maxCostUsd: 25 });

    const result = await enqueueSelfDebugDispatch({
      originalDispatchId: originalId,
      reviewDispatchId: 77,
      findings: "Test coverage missing",
    });

    expect(result.enqueued).toBe(true);
    expect(result.selfDebugDispatchId).toBeGreaterThan(0);
    expect(result.promptPreview).toContain("Test coverage missing");
    expect(result.promptPreview).toContain(`#${originalId}`);

    expect(enqueueDispatchCalls).toHaveLength(1);
    const call = enqueueDispatchCalls[0];
    expect(call.sourceType).toBe("self_debug");
    expect(call.sourceId).toBe(`flagged:${originalId}:by:77`);
    expect(call.agentRole).toBe("iris");
    expect(call.enqueuedBy).toBe("selfDebug");
    expect(call.priority).toBeCloseTo(1.5, 3);
    expect(call.timeoutMs).toBe(5 * 60 * 1000);
  });

  it("idempotent — existing self_debug row blocks re-enqueue", async () => {
    const { enqueueSelfDebugDispatch } = await import("./selfDebug");
    const originalId = seedOriginal({});
    seedSelfDebugRow(originalId, 88, "queued");

    const result = await enqueueSelfDebugDispatch({
      originalDispatchId: originalId,
      reviewDispatchId: 88,
      findings: "x",
    });

    expect(result.enqueued).toBe(false);
    expect(result.reason).toBe("already_debugging");
    expect(result.selfDebugDispatchId).toBeNull();
    expect(enqueueDispatchCalls).toHaveLength(0);
  });

  it("idempotency ignores 'failed' + 'cancelled' prior rows (allows retry)", async () => {
    const { enqueueSelfDebugDispatch } = await import("./selfDebug");
    const originalId = seedOriginal({});
    seedSelfDebugRow(originalId, 88, "failed");
    seedSelfDebugRow(originalId, 88, "cancelled");

    const result = await enqueueSelfDebugDispatch({
      originalDispatchId: originalId,
      reviewDispatchId: 88,
      findings: "retry",
    });

    expect(result.enqueued).toBe(true);
    expect(enqueueDispatchCalls).toHaveLength(1);
  });

  it("enqueueDispatch throws → returns enqueued=false with 'enqueue_failed:' reason", async () => {
    const { enqueueSelfDebugDispatch } = await import("./selfDebug");
    const originalId = seedOriginal({});
    enqueueDispatchShouldThrow = "queue is closed";

    const result = await enqueueSelfDebugDispatch({
      originalDispatchId: originalId,
      reviewDispatchId: 5,
      findings: "f",
    });

    expect(result.enqueued).toBe(false);
    expect(result.reason).toMatch(/^enqueue_failed:/);
    expect(result.reason).toContain("queue is closed");
    expect(result.selfDebugDispatchId).toBeNull();
    expect(result.promptPreview).not.toBe("");
  });

  it("cost cap: original $25 → self-debug $12.50", async () => {
    const { enqueueSelfDebugDispatch } = await import("./selfDebug");
    const originalId = seedOriginal({ maxCostUsd: 25 });

    await enqueueSelfDebugDispatch({
      originalDispatchId: originalId,
      reviewDispatchId: 1,
      findings: "f",
    });

    expect(enqueueDispatchCalls).toHaveLength(1);
    expect(enqueueDispatchCalls[0].maxCostUsd).toBeCloseTo(12.5, 2);
  });

  it("cost cap: original $8 → self-debug floored at $5", async () => {
    const { enqueueSelfDebugDispatch } = await import("./selfDebug");
    const originalId = seedOriginal({ maxCostUsd: 8 });

    await enqueueSelfDebugDispatch({
      originalDispatchId: originalId,
      reviewDispatchId: 1,
      findings: "f",
    });

    expect(enqueueDispatchCalls).toHaveLength(1);
    expect(enqueueDispatchCalls[0].maxCostUsd).toBeCloseTo(5, 2);
  });

  it("dry-run: returns enqueued=false + reason='dry_run' + promptPreview populated, NO enqueue", async () => {
    const { enqueueSelfDebugDispatch } = await import("./selfDebug");
    const originalId = seedOriginal({});

    const result = await enqueueSelfDebugDispatch({
      originalDispatchId: originalId,
      reviewDispatchId: 7,
      findings: "abc",
      dryRun: true,
    });

    expect(result.enqueued).toBe(false);
    expect(result.reason).toBe("dry_run");
    expect(result.selfDebugDispatchId).toBeNull();
    expect(result.promptPreview).toContain("abc");
    expect(result.promptPreview).toContain(`#${originalId}`);
    expect(enqueueDispatchCalls).toHaveLength(0);
  });

  it("returns 'original_not_found' for missing id and does not enqueue", async () => {
    const { enqueueSelfDebugDispatch } = await import("./selfDebug");

    const result = await enqueueSelfDebugDispatch({
      originalDispatchId: 9999,
      reviewDispatchId: 1,
      findings: "f",
    });

    expect(result.enqueued).toBe(false);
    expect(result.reason).toBe("original_not_found");
    expect(enqueueDispatchCalls).toHaveLength(0);
  });
});
