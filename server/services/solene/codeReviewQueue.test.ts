/**
 * Tests for codeReviewQueue (L2.8 — multi-agent code review).
 *
 * Coverage:
 *  - enqueueReviewDispatch happy path: enqueues a new dispatch + marks original
 *    review_status='pending' + sets reviewed_by_dispatch_id forward pointer
 *    and original_dispatch_id back pointer.
 *  - enqueueReviewDispatch returns skipped='no_commits' when original produced
 *    no commits + stamps review_status='skipped'.
 *  - enqueueReviewDispatch default cost cap is half the original's cap.
 *  - Recursion guard: enqueueing a review of a review-dispatch is rejected
 *    ('already_review') and no new dispatch is created.
 *  - recordReviewOutcome updates the ORIGINAL row's review_status correctly.
 *  - listPendingReviews returns the right shape, ordered by completed_at DESC.
 *
 * We mock `db` to keep this unit-scope (no Postgres required). The mock is
 * intentionally simpler than dispatchQueue.test.ts's — we don't need
 * SKIP-LOCKED semantics here, just CRUD-ish operations.
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

interface QueueRow {
  id: number;
  queued_at: Date;
  status: string;
  priority: string;
  source_type: string;
  source_id: string;
  agent_role: string;
  prompt_text: string;
  max_cost_usd: string;
  timeout_ms: number;
  started_at: Date | null;
  completed_at: Date | null;
  result_summary: string | null;
  result_full_path: string | null;
  enqueued_by: string | null;
  review_status: string | null;
  reviewed_by_dispatch_id: number | null;
  original_dispatch_id: number | null;
}

interface ResultRow {
  id: number;
  dispatch_id: number;
  success: boolean;
  cost_usd: string;
  commits_referenced: string[] | null;
  recorded_at: Date;
}

const QUEUE: QueueRow[] = [];
const RESULTS: ResultRow[] = [];
let nextQueueId = 1;
let nextResultId = 1;

vi.mock("../../db", () => {
  function buildInsert(table: unknown) {
    const tableMeta = (table as any)?._?.name ?? "";
    return {
      values: (row: any) => {
        if (tableMeta.includes("results") || row.dispatchId !== undefined) {
          const r: ResultRow = {
            id: nextResultId++,
            dispatch_id: row.dispatchId,
            success: row.success,
            cost_usd: row.costUsd,
            commits_referenced: row.commitsReferenced ?? null,
            recorded_at: new Date(),
          };
          RESULTS.push(r);
          return Promise.resolve();
        }
        const r: QueueRow = {
          id: nextQueueId++,
          queued_at: new Date(),
          status: row.status ?? "queued",
          priority: row.priority,
          source_type: row.sourceType,
          source_id: row.sourceId,
          agent_role: row.agentRole,
          prompt_text: row.promptText,
          max_cost_usd: row.maxCostUsd,
          timeout_ms: row.timeoutMs,
          started_at: null,
          completed_at: null,
          result_summary: null,
          result_full_path: null,
          enqueued_by: row.enqueuedBy ?? null,
          review_status: null,
          reviewed_by_dispatch_id: null,
          original_dispatch_id: row.originalDispatchId ?? null,
        };
        QUEUE.push(r);
        return {
          returning: (_cols: unknown) => Promise.resolve([{ id: r.id }]),
        };
      },
    };
  }

  function buildUpdate() {
    return {
      set: (patch: any) => ({
        where: (clause: any) => {
          const id = (clause as any)?.__id;
          if (id === undefined) return Promise.resolve();
          const row = QUEUE.find((q) => q.id === id);
          if (!row) return Promise.resolve();
          if (patch.status !== undefined) row.status = patch.status;
          if (patch.startedAt !== undefined) row.started_at = patch.startedAt;
          if (patch.completedAt !== undefined)
            row.completed_at = patch.completedAt;
          if (patch.resultSummary !== undefined)
            row.result_summary = patch.resultSummary;
          if (patch.resultFullPath !== undefined)
            row.result_full_path = patch.resultFullPath;
          if (patch.reviewStatus !== undefined)
            row.review_status = patch.reviewStatus;
          if (patch.reviewedByDispatchId !== undefined)
            row.reviewed_by_dispatch_id = patch.reviewedByDispatchId;
          if (patch.originalDispatchId !== undefined)
            row.original_dispatch_id = patch.originalDispatchId;
          return Promise.resolve();
        },
      }),
    };
  }

  function buildSelect(cols: any) {
    // Disambiguate queue vs results lookup by the columns the caller selected.
    // The codeReviewQueue service selects `commitsReferenced` only when
    // querying solene_dispatch_results; anything else is the queue.
    const colKeys = Object.keys(cols ?? {});
    const isResultsLookup =
      colKeys.length === 1 && colKeys[0] === "commitsReferenced";
    const chain: any = {
      from: (_t: unknown) => chain,
      where: (clause: any) => {
        chain._where = clause;
        return chain;
      },
      orderBy: (_o: any) => chain,
      limit: (_n: number) => {
        if (!isResultsLookup) {
          const id = (chain._where as any)?.__id;
          const row = QUEUE.find((q) => q.id === id);
          if (!row) return Promise.resolve([]);
          return Promise.resolve([
            {
              id: row.id,
              agentRole: row.agent_role,
              promptText: row.prompt_text,
              maxCostUsd: row.max_cost_usd,
              originalDispatchId: row.original_dispatch_id,
              reviewedByDispatchId: row.reviewed_by_dispatch_id,
              reviewStatus: row.review_status,
              status: row.status,
            },
          ]);
        }
        const id = (chain._where as any)?.__id;
        const matching = RESULTS.filter((r) => r.dispatch_id === id).sort(
          (a, b) => b.recorded_at.getTime() - a.recorded_at.getTime(),
        );
        if (matching.length === 0) return Promise.resolve([]);
        return Promise.resolve([
          { commitsReferenced: matching[0].commits_referenced },
        ]);
      },
    };
    return chain;
  }

  const db = {
    insert: (table: unknown) => buildInsert(table),
    update: (_table: unknown) => buildUpdate(),
    select: (cols: any) => buildSelect(cols),
    transaction: async (fn: any) => {
      const tx = {
        insert: (table: unknown) => buildInsert(table),
        update: (_table: unknown) => buildUpdate(),
      };
      return await fn(tx);
    },
    execute: async (_query: unknown) => {
      // listPendingReviews: SELECT ... WHERE o.review_status='pending'
      // JOIN solene_dispatch_queue r ON r.original_dispatch_id = o.id
      const pending = QUEUE.filter((q) => q.review_status === "pending");
      const rows = pending
        .map((o) => {
          const r = QUEUE.find((x) => x.original_dispatch_id === o.id);
          if (!r) return null;
          return {
            original_id: o.id,
            original_agent_role: o.agent_role,
            original_completed_at: o.completed_at,
            review_id: r.id,
            review_status: o.review_status!,
            review_queued_at: r.queued_at,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null)
        .sort((a, b) => {
          const at = a.original_completed_at?.getTime() ?? 0;
          const bt = b.original_completed_at?.getTime() ?? 0;
          return bt - at;
        });
      return { rows } as any;
    },
  };

  return { db };
});

// drizzle's eq returns an opaque object — give our mock a way to read the id.
vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<typeof import("drizzle-orm")>(
    "drizzle-orm",
  );
  return {
    ...actual,
    eq: (_col: any, val: any) => ({ __id: val }),
    desc: (_col: any) => ({ __desc: true }),
  };
});

// --- Helpers --------------------------------------------------------------

async function seedOriginalDispatch(args: {
  agentRole?: string;
  maxCostUsd?: number;
  prompt?: string;
  commits?: string[] | null;
  originalDispatchId?: number | null;
}): Promise<number> {
  const id = nextQueueId++;
  QUEUE.push({
    id,
    queued_at: new Date(),
    status: "completed",
    priority: "1.000",
    source_type: "auto_dispatch",
    source_id: `seed:${id}`,
    agent_role: args.agentRole ?? "iris",
    prompt_text: args.prompt ?? "do the thing — implement L1 + write tests",
    max_cost_usd: (args.maxCostUsd ?? 25).toFixed(2),
    timeout_ms: 60_000,
    started_at: new Date(),
    completed_at: new Date(),
    result_summary: "shipped",
    result_full_path: null,
    enqueued_by: null,
    review_status: null,
    reviewed_by_dispatch_id: null,
    original_dispatch_id: args.originalDispatchId ?? null,
  });
  RESULTS.push({
    id: nextResultId++,
    dispatch_id: id,
    success: true,
    cost_usd: "0.0",
    commits_referenced:
      args.commits === undefined ? ["abc123def"] : args.commits,
    recorded_at: new Date(),
  });
  return id;
}

beforeEach(() => {
  QUEUE.length = 0;
  RESULTS.length = 0;
  nextQueueId = 1;
  nextResultId = 1;
});

afterEach(() => {
  vi.clearAllMocks();
});

// --- Tests ----------------------------------------------------------------

describe("codeReviewQueue.enqueueReviewDispatch", () => {
  it("happy path — enqueues review + marks original review_status='pending' + links both ways", async () => {
    const { enqueueReviewDispatch } = await import("./codeReviewQueue");
    const originalId = await seedOriginalDispatch({
      agentRole: "iris",
      maxCostUsd: 40,
      commits: ["abc123", "def456"],
    });

    const result = await enqueueReviewDispatch(originalId);

    expect(result.skipped).toBe(false);
    expect(result.reviewDispatchId).toBeGreaterThan(0);

    const original = QUEUE.find((q) => q.id === originalId)!;
    expect(original.review_status).toBe("pending");
    expect(original.reviewed_by_dispatch_id).toBe(result.reviewDispatchId);

    const review = QUEUE.find((q) => q.id === result.reviewDispatchId)!;
    expect(review.agent_role).toBe("code-reviewer");
    expect(review.source_type).toBe("code_review");
    expect(review.source_id).toBe(`dispatch:${originalId}`);
    expect(review.original_dispatch_id).toBe(originalId);
    // Prompt should reference the SHAs.
    expect(review.prompt_text).toContain("abc123");
    expect(review.prompt_text).toContain("def456");
    expect(review.prompt_text).toContain(`dispatch #${originalId}`);
  });

  it("returns skipped='no_commits' when original produced no commits, stamps review_status='skipped'", async () => {
    const { enqueueReviewDispatch } = await import("./codeReviewQueue");
    const originalId = await seedOriginalDispatch({ commits: [] });

    const result = await enqueueReviewDispatch(originalId);

    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe("no_commits");
    expect(result.reviewDispatchId).toBeNull();

    const original = QUEUE.find((q) => q.id === originalId)!;
    expect(original.review_status).toBe("skipped");
    // No new dispatch was created.
    expect(QUEUE.filter((q) => q.agent_role === "code-reviewer")).toHaveLength(
      0,
    );
  });

  it("default cost cap = half the original's cap", async () => {
    const { enqueueReviewDispatch } = await import("./codeReviewQueue");
    const originalId = await seedOriginalDispatch({ maxCostUsd: 30 });

    const result = await enqueueReviewDispatch(originalId);
    expect(result.skipped).toBe(false);

    const review = QUEUE.find((q) => q.id === result.reviewDispatchId)!;
    expect(Number(review.max_cost_usd)).toBeCloseTo(15, 2);
  });

  it("respects explicit maxCostUsd override", async () => {
    const { enqueueReviewDispatch } = await import("./codeReviewQueue");
    const originalId = await seedOriginalDispatch({ maxCostUsd: 30 });

    const result = await enqueueReviewDispatch(originalId, { maxCostUsd: 5 });
    expect(result.skipped).toBe(false);
    const review = QUEUE.find((q) => q.id === result.reviewDispatchId)!;
    expect(Number(review.max_cost_usd)).toBeCloseTo(5, 2);
  });

  it("recursion guard — reviewing a review-dispatch is rejected", async () => {
    const { enqueueReviewDispatch } = await import("./codeReviewQueue");
    // Seed a "review" dispatch: agent_role='code-reviewer' OR original_dispatch_id set.
    const originalId = await seedOriginalDispatch({ agentRole: "iris" });
    const reviewId = await seedOriginalDispatch({
      agentRole: "code-reviewer",
      originalDispatchId: originalId,
    });

    const result = await enqueueReviewDispatch(reviewId);

    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe("already_review");
    expect(result.reviewDispatchId).toBeNull();
    // No new dispatch was created.
    expect(QUEUE).toHaveLength(2);
  });

  it("idempotent — already-reviewed original returns 'already_reviewed' and does not double-enqueue", async () => {
    const { enqueueReviewDispatch } = await import("./codeReviewQueue");
    const originalId = await seedOriginalDispatch({ maxCostUsd: 25 });

    const first = await enqueueReviewDispatch(originalId);
    expect(first.skipped).toBe(false);

    const second = await enqueueReviewDispatch(originalId);
    expect(second.skipped).toBe(true);
    expect(second.skipReason).toBe("already_reviewed");
    expect(
      QUEUE.filter((q) => q.agent_role === "code-reviewer"),
    ).toHaveLength(1);
  });

  it("returns 'original_not_found' for missing id", async () => {
    const { enqueueReviewDispatch } = await import("./codeReviewQueue");
    const result = await enqueueReviewDispatch(9999);
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe("original_not_found");
  });
});

describe("codeReviewQueue.recordReviewOutcome", () => {
  it("updates the original's review_status to 'passed'", async () => {
    const { enqueueReviewDispatch, recordReviewOutcome } = await import(
      "./codeReviewQueue"
    );
    const originalId = await seedOriginalDispatch({});
    const { reviewDispatchId } = await enqueueReviewDispatch(originalId);
    expect(reviewDispatchId).not.toBeNull();

    await recordReviewOutcome(reviewDispatchId!, "passed");

    const original = QUEUE.find((q) => q.id === originalId)!;
    expect(original.review_status).toBe("passed");
  });

  it("updates the original's review_status to 'flagged' with findings", async () => {
    const { enqueueReviewDispatch, recordReviewOutcome } = await import(
      "./codeReviewQueue"
    );
    const originalId = await seedOriginalDispatch({});
    const { reviewDispatchId } = await enqueueReviewDispatch(originalId);

    await recordReviewOutcome(
      reviewDispatchId!,
      "flagged",
      "Missing test coverage on new branch",
    );

    const original = QUEUE.find((q) => q.id === originalId)!;
    expect(original.review_status).toBe("flagged");
  });

  it("no-ops cleanly when review id is unknown", async () => {
    const { recordReviewOutcome } = await import("./codeReviewQueue");
    await expect(recordReviewOutcome(9999, "passed")).resolves.toBeUndefined();
  });
});

describe("codeReviewQueue.listPendingReviews", () => {
  it("returns pending reviews ordered by original completed_at DESC", async () => {
    const { enqueueReviewDispatch, listPendingReviews } = await import(
      "./codeReviewQueue"
    );
    const older = await seedOriginalDispatch({});
    const newer = await seedOriginalDispatch({});
    // Make `newer` strictly newer.
    QUEUE.find((q) => q.id === newer)!.completed_at = new Date(
      Date.now() + 60_000,
    );

    await enqueueReviewDispatch(older);
    await enqueueReviewDispatch(newer);

    const pending = await listPendingReviews();
    expect(pending).toHaveLength(2);
    expect(pending[0].originalDispatchId).toBe(newer);
    expect(pending[1].originalDispatchId).toBe(older);
    expect(pending[0].reviewStatus).toBe("pending");
    expect(pending[0].reviewDispatchId).toBeGreaterThan(0);
  });

  it("excludes originals whose review_status is not 'pending'", async () => {
    const { enqueueReviewDispatch, recordReviewOutcome, listPendingReviews } =
      await import("./codeReviewQueue");
    const a = await seedOriginalDispatch({});
    const b = await seedOriginalDispatch({});
    const { reviewDispatchId: reviewA } = await enqueueReviewDispatch(a);
    await enqueueReviewDispatch(b);

    await recordReviewOutcome(reviewA!, "passed");

    const pending = await listPendingReviews();
    expect(pending.map((p) => p.originalDispatchId)).toEqual([b]);
  });
});

describe("codeReviewQueue.REVIEW_PROMPT_TEMPLATE", () => {
  it("contains all four placeholder tokens", async () => {
    const { REVIEW_PROMPT_TEMPLATE } = await import("./codeReviewQueue");
    expect(REVIEW_PROMPT_TEMPLATE).toContain("{ORIGINAL_ID}");
    expect(REVIEW_PROMPT_TEMPLATE).toContain("{SHAS}");
    expect(REVIEW_PROMPT_TEMPLATE).toContain("{ORIGINAL_ROLE}");
    expect(REVIEW_PROMPT_TEMPLATE).toContain("{ORIGINAL_PROMPT_SUMMARY}");
    expect(REVIEW_PROMPT_TEMPLATE).toContain("VERDICT:");
    expect(REVIEW_PROMPT_TEMPLATE).toContain("Do NOT modify any files");
  });
});
