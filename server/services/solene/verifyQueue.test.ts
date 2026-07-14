/**
 * Tests for verifyQueue (CP2 of Jarvis Phase 1 — Verified Act-and-Confirm).
 *
 * Coverage:
 *  - buildVerifyPrompt / VERIFY_PROMPT_TEMPLATE render criteria + context and
 *    end with the SAME structured block CP1's parseReviewVerdict consumes
 *    (VERDICT: passed | flagged + FINDINGS), read-only instruction included.
 *  - buildVerifySourceId / parseVerifySourceId round-trip the
 *    'verify:<targetKind>:<targetId>' convention.
 *  - enqueueVerifyDispatch eligibility: happy path for BOTH target kinds
 *    (sourceType='verify', sourceId convention, criteria stored on the row,
 *    import job stamped verify_status='pending'); skips on no_criteria,
 *    dispatch_disabled, target_not_found, target_is_verify (never verify a
 *    verify), already_verifying; never throws (enqueue_failed).
 *  - recordVerifyOutcome routing for both target kinds:
 *    'verify:dispatch:<id>' flips the target's review_status + fires
 *    self-debug on flagged; 'verify:import:<jobId>' writes
 *    verify_status/verify_findings + logs Letter-visibly via
 *    logActivity(job:'verify').
 *  - buildImportVerifyCriteria derives HONEST criteria from the job record.
 *
 * DB mock follows the selfDebug.test.ts style (predicate-based drizzle
 * mocks) extended with a second in-memory store for import_jobs.
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

// --- In-memory stores -------------------------------------------------------

interface QueueRow {
  id: number;
  status: string;
  source_type: string;
  source_id: string;
  agent_role: string;
  prompt_text: string;
  max_cost_usd: string;
  review_status: string | null;
  success_criteria: unknown;
  idempotency_key: string | null;
}

interface ImportRow {
  id: number;
  organization_id: number;
  verify_status: string | null;
  verify_findings: string | null;
}

const QUEUE: QueueRow[] = [];
const IMPORTS: ImportRow[] = [];
let nextQueueId = 1;

// --- Collaborator mocks -------------------------------------------------------

const enqueueDispatchCalls: Array<Record<string, unknown>> = [];
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
      review_status: null,
      success_criteria: opts.successCriteria ?? null,
      idempotency_key: (opts.idempotencyKey as string | null) ?? null,
    });
    return id;
  }),
  // Deterministic stand-in — the real effect-key hashing is covered by
  // dispatchQueue.test.ts; here we only care that a key is supplied.
  computeEffectKey: (p: { domain: string; moveKind: string; targetId?: string | null }) =>
    `effkey:${p.domain}:${p.moveKind}:${p.targetId ?? "-"}`,
}));

let dispatchEnabled = true;
vi.mock("../autopilot/settings", () => ({
  isDispatchEnabled: vi.fn(async () => dispatchEnabled),
}));

const logActivityCalls: Array<Record<string, unknown>> = [];
vi.mock("../systemActivityLogger", () => ({
  logActivity: vi.fn(async (p: Record<string, unknown>) => {
    logActivityCalls.push(p);
  }),
}));

const selfDebugCalls: Array<Record<string, unknown>> = [];
vi.mock("./selfDebug", () => ({
  enqueueSelfDebugDispatch: vi.fn(async (input: Record<string, unknown>) => {
    selfDebugCalls.push(input);
    return { enqueued: true, selfDebugDispatchId: 999, promptPreview: "" };
  }),
}));

// --- DB mock ------------------------------------------------------------------

function camelToSnake(k: string): string {
  return k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

vi.mock("../../db", () => {
  function buildSelect(cols: Record<string, unknown>) {
    // Import-jobs selects are the only ones asking for organizationId.
    const store: Array<Record<string, unknown>> =
      "organizationId" in (cols ?? {}) ? (IMPORTS as any[]) : (QUEUE as any[]);
    const chain: any = {
      _filters: [] as Array<(r: Record<string, unknown>) => boolean>,
      from: (_t: unknown) => chain,
      where: (pred: any) => {
        chain._filters.push(pred);
        return chain;
      },
      limit: (n: number) => {
        const matched = store.filter((r) =>
          chain._filters.every((f: (r: Record<string, unknown>) => boolean) => f(r)),
        );
        return Promise.resolve(
          matched.slice(0, n).map((r) => {
            const mapped: Record<string, unknown> = {};
            for (const key of Object.keys(cols ?? {})) {
              mapped[key] = r[camelToSnake(key)];
            }
            return mapped;
          }),
        );
      },
    };
    return chain;
  }

  const db = {
    select: (cols: Record<string, unknown>) => buildSelect(cols),
    update: (_table: unknown) => ({
      set: (patch: Record<string, unknown>) => ({
        where: (pred: (r: Record<string, unknown>) => boolean) => {
          const store: Array<Record<string, unknown>> =
            "verifyStatus" in patch || "verifyFindings" in patch
              ? (IMPORTS as any[])
              : (QUEUE as any[]);
          for (const r of store) {
            if (pred(r)) {
              for (const [k, v] of Object.entries(patch)) {
                r[camelToSnake(k)] = v;
              }
            }
          }
          return Promise.resolve();
        },
      }),
    }),
  };
  return { db };
});

// drizzle-orm mocks — predicates over the snake_case row shape, keyed by the
// real column's SQL name (col.name).
vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
  return {
    ...actual,
    eq: (col: any, val: any) => (r: Record<string, unknown>) =>
      r[col?.name] === val,
    and:
      (...preds: Array<(r: Record<string, unknown>) => boolean>) =>
      (r: Record<string, unknown>) =>
        preds.every((p) => p(r)),
    not:
      (pred: (r: Record<string, unknown>) => boolean) =>
      (r: Record<string, unknown>) =>
        !pred(r),
    inArray: (col: any, vals: unknown[]) => (r: Record<string, unknown>) =>
      vals.includes(r[col?.name]),
  };
});

// --- Helpers --------------------------------------------------------------

function seedDispatch(args: {
  sourceType?: string;
  maxCostUsd?: number;
  status?: string;
}): number {
  const id = nextQueueId++;
  QUEUE.push({
    id,
    status: args.status ?? "completed",
    source_type: args.sourceType ?? "auto_dispatch",
    source_id: `seed:${id}`,
    agent_role: "iris",
    prompt_text: "do the thing",
    max_cost_usd: (args.maxCostUsd ?? 20).toFixed(2),
    review_status: null,
    success_criteria: null,
    idempotency_key: null,
  });
  return id;
}

function seedVerifyRow(sourceId: string, status = "queued"): number {
  const id = nextQueueId++;
  QUEUE.push({
    id,
    status,
    source_type: "verify",
    source_id: sourceId,
    agent_role: "general-purpose",
    prompt_text: "verify...",
    max_cost_usd: "2.50",
    review_status: null,
    success_criteria: null,
    idempotency_key: null,
  });
  return id;
}

function seedImportJob(id: number, organizationId: number): void {
  IMPORTS.push({
    id,
    organization_id: organizationId,
    verify_status: null,
    verify_findings: null,
  });
}

const CRITERIA = [
  {
    id: "c1",
    description: "row accounting adds up",
    check: "SELECT total_rows FROM import_jobs WHERE id = 7",
  },
  { id: "c2", description: "error rate below 5%" },
];

/** Flush the fire-and-forget import().then chains. */
async function flushAsync(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  QUEUE.length = 0;
  IMPORTS.length = 0;
  enqueueDispatchCalls.length = 0;
  logActivityCalls.length = 0;
  selfDebugCalls.length = 0;
  enqueueDispatchShouldThrow = null;
  dispatchEnabled = true;
  nextQueueId = 1;
});

afterEach(() => {
  vi.clearAllMocks();
});

// --- Tests ----------------------------------------------------------------

describe("verifyQueue.VERIFY_PROMPT_TEMPLATE / buildVerifyPrompt", () => {
  it("template carries the placeholders + the CP1-compatible verdict block + read-only order", async () => {
    const { VERIFY_PROMPT_TEMPLATE } = await import("./verifyQueue");
    expect(VERIFY_PROMPT_TEMPLATE).toContain("{TARGET_LABEL}");
    expect(VERIFY_PROMPT_TEMPLATE).toContain("{CONTEXT}");
    expect(VERIFY_PROMPT_TEMPLATE).toContain("{CRITERIA}");
    expect(VERIFY_PROMPT_TEMPLATE).toContain("VERDICT: passed | flagged");
    expect(VERIFY_PROMPT_TEMPLATE).toContain("FINDINGS:");
    expect(VERIFY_PROMPT_TEMPLATE).toContain("Do NOT modify any files");
    expect(VERIFY_PROMPT_TEMPLATE).toContain("Read-only verification");
  });

  it("renders numbered criteria with check hints and the enqueuer context", async () => {
    const { buildVerifyPrompt } = await import("./verifyQueue");
    const prompt = buildVerifyPrompt({
      targetKind: "import",
      targetId: 7,
      criteria: CRITERIA,
      context: "job reported 100 rows",
    });
    expect(prompt).toContain("import job #7");
    expect(prompt).toContain("1. [c1] row accounting adds up");
    expect(prompt).toContain("check: SELECT total_rows FROM import_jobs WHERE id = 7");
    expect(prompt).toContain("2. [c2] error rate below 5%");
    expect(prompt).toContain("job reported 100 rows");
    // The verdict block must survive rendering so parseReviewVerdict's
    // last-match rule applies to the agent's REAL verdict, not the template.
    expect(prompt).toContain("VERDICT: passed | flagged");
  });

  it("the rendered prompt's verdict contract is consumable by CP1's parser", async () => {
    const { parseReviewVerdict } = await import("./codeReviewQueue");
    // Simulate an agent's final message: quoted template + real verdict.
    const finalMessage = [
      "I evaluated both criteria against the live tables.",
      "VERDICT: flagged",
      "FINDINGS:",
      "- error_count is 9% of total_rows (threshold 5%)",
    ].join("\n");
    const v = parseReviewVerdict(finalMessage);
    expect(v?.outcome).toBe("flagged");
    expect(v?.findings).toContain("9% of total_rows");
  });
});

describe("verifyQueue.buildVerifySourceId / parseVerifySourceId", () => {
  it("round-trips both target kinds", async () => {
    const { buildVerifySourceId, parseVerifySourceId } = await import("./verifyQueue");
    expect(buildVerifySourceId("dispatch", 123)).toBe("verify:dispatch:123");
    expect(buildVerifySourceId("import", 456)).toBe("verify:import:456");
    expect(parseVerifySourceId("verify:dispatch:123")).toEqual({
      targetKind: "dispatch",
      targetId: 123,
    });
    expect(parseVerifySourceId("verify:import:456")).toEqual({
      targetKind: "import",
      targetId: 456,
    });
  });

  it("rejects foreign sourceIds", async () => {
    const { parseVerifySourceId } = await import("./verifyQueue");
    expect(parseVerifySourceId("dispatch:123")).toBeNull();
    expect(parseVerifySourceId("verify:outreach:1")).toBeNull();
    expect(parseVerifySourceId("verify:dispatch:abc")).toBeNull();
    expect(parseVerifySourceId("")).toBeNull();
  });
});

describe("verifyQueue.enqueueVerifyDispatch", () => {
  it("happy path (dispatch target) — sourceId convention, criteria on the row, half-cap default", async () => {
    const { enqueueVerifyDispatch } = await import("./verifyQueue");
    const targetId = seedDispatch({ maxCostUsd: 20 });

    const result = await enqueueVerifyDispatch({
      targetKind: "dispatch",
      targetId,
      criteria: CRITERIA,
      context: "dispatch claimed success",
    });

    expect(result.skipped).toBe(false);
    expect(result.verifyDispatchId).toBeGreaterThan(0);

    const row = QUEUE.find((q) => q.id === result.verifyDispatchId)!;
    expect(row.source_type).toBe("verify");
    expect(row.source_id).toBe(`verify:dispatch:${targetId}`);
    expect(row.agent_role).toBe("general-purpose");
    expect(Number(row.max_cost_usd)).toBeCloseTo(10, 2); // half of $20
    expect(row.success_criteria).toEqual({ criteria: CRITERIA });
    expect(row.idempotency_key).toContain("effkey:verify:dispatch");
    expect(row.prompt_text).toContain(`dispatch #${targetId}`);
    expect(row.prompt_text).toContain("row accounting adds up");
    expect(row.prompt_text).toContain("VERDICT: passed | flagged");
    expect(row.prompt_text).toContain("Do NOT modify any files");
  });

  it("happy path (import target) — fixed cap + stamps verify_status='pending' on the job", async () => {
    const { enqueueVerifyDispatch, VERIFY_IMPORT_COST_USD } = await import("./verifyQueue");
    seedImportJob(7, 3);

    const result = await enqueueVerifyDispatch({
      targetKind: "import",
      targetId: 7,
      criteria: CRITERIA,
    });

    expect(result.skipped).toBe(false);
    const row = QUEUE.find((q) => q.id === result.verifyDispatchId)!;
    expect(row.source_id).toBe("verify:import:7");
    expect(Number(row.max_cost_usd)).toBeCloseTo(VERIFY_IMPORT_COST_USD, 2);
    expect(IMPORTS.find((j) => j.id === 7)?.verify_status).toBe("pending");
  });

  it("skips with 'no_criteria' on an empty criteria list", async () => {
    const { enqueueVerifyDispatch } = await import("./verifyQueue");
    const targetId = seedDispatch({});
    const result = await enqueueVerifyDispatch({
      targetKind: "dispatch",
      targetId,
      criteria: [],
    });
    expect(result).toEqual({
      verifyDispatchId: null,
      skipped: true,
      skipReason: "no_criteria",
    });
    expect(enqueueDispatchCalls).toHaveLength(0);
  });

  it("skips with 'dispatch_disabled' when the master switch is OFF", async () => {
    const { enqueueVerifyDispatch } = await import("./verifyQueue");
    const targetId = seedDispatch({});
    dispatchEnabled = false;
    const result = await enqueueVerifyDispatch({
      targetKind: "dispatch",
      targetId,
      criteria: CRITERIA,
    });
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe("dispatch_disabled");
    expect(enqueueDispatchCalls).toHaveLength(0);
  });

  it("skips with 'target_not_found' for a missing dispatch AND a missing import job", async () => {
    const { enqueueVerifyDispatch } = await import("./verifyQueue");
    const a = await enqueueVerifyDispatch({
      targetKind: "dispatch",
      targetId: 9999,
      criteria: CRITERIA,
    });
    expect(a.skipReason).toBe("target_not_found");
    const b = await enqueueVerifyDispatch({
      targetKind: "import",
      targetId: 9999,
      criteria: CRITERIA,
    });
    expect(b.skipReason).toBe("target_not_found");
    expect(enqueueDispatchCalls).toHaveLength(0);
  });

  it("recursion guard — never verifies a verify dispatch", async () => {
    const { enqueueVerifyDispatch } = await import("./verifyQueue");
    const verifyId = seedVerifyRow("verify:import:7");
    const result = await enqueueVerifyDispatch({
      targetKind: "dispatch",
      targetId: verifyId,
      criteria: CRITERIA,
    });
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe("target_is_verify");
    expect(enqueueDispatchCalls).toHaveLength(0);
  });

  it("idempotent — a live verify for the same target skips with 'already_verifying'", async () => {
    const { enqueueVerifyDispatch } = await import("./verifyQueue");
    const targetId = seedDispatch({});
    seedVerifyRow(`verify:dispatch:${targetId}`, "queued");
    const result = await enqueueVerifyDispatch({
      targetKind: "dispatch",
      targetId,
      criteria: CRITERIA,
    });
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe("already_verifying");
    expect(enqueueDispatchCalls).toHaveLength(0);
  });

  it("a FAILED prior verify does not block a re-verify (same stance as self_debug)", async () => {
    const { enqueueVerifyDispatch } = await import("./verifyQueue");
    const targetId = seedDispatch({});
    seedVerifyRow(`verify:dispatch:${targetId}`, "failed");
    const result = await enqueueVerifyDispatch({
      targetKind: "dispatch",
      targetId,
      criteria: CRITERIA,
    });
    expect(result.skipped).toBe(false);
  });

  it("never throws — an enqueue failure returns skipReason='enqueue_failed'", async () => {
    const { enqueueVerifyDispatch } = await import("./verifyQueue");
    const targetId = seedDispatch({});
    enqueueDispatchShouldThrow = "ensemble cap exceeded";
    const result = await enqueueVerifyDispatch({
      targetKind: "dispatch",
      targetId,
      criteria: CRITERIA,
    });
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe("enqueue_failed");
    expect(result.verifyDispatchId).toBeNull();
  });
});

describe("verifyQueue.recordVerifyOutcome — verdict routing", () => {
  it("verify:dispatch:<id> passed → flips the TARGET dispatch's review_status, no self-debug", async () => {
    const { recordVerifyOutcome } = await import("./verifyQueue");
    const targetId = seedDispatch({});
    const verifyId = seedVerifyRow(`verify:dispatch:${targetId}`, "completed");

    await recordVerifyOutcome(verifyId, "passed");
    await flushAsync();

    expect(QUEUE.find((q) => q.id === targetId)?.review_status).toBe("passed");
    expect(selfDebugCalls).toHaveLength(0);
  });

  it("verify:dispatch:<id> flagged → review_status='flagged' + fires the self-debug chain", async () => {
    const { recordVerifyOutcome } = await import("./verifyQueue");
    const targetId = seedDispatch({});
    const verifyId = seedVerifyRow(`verify:dispatch:${targetId}`, "completed");

    await recordVerifyOutcome(verifyId, "flagged", "- error rate 9% (threshold 5%)");
    await flushAsync();

    expect(QUEUE.find((q) => q.id === targetId)?.review_status).toBe("flagged");
    expect(selfDebugCalls).toHaveLength(1);
    expect(selfDebugCalls[0]).toMatchObject({
      originalDispatchId: targetId,
      reviewDispatchId: verifyId,
      findings: "- error rate 9% (threshold 5%)",
    });
  });

  it("verify:import:<jobId> → writes verify_status/verify_findings + logs Letter-visibly (job:'verify')", async () => {
    const { recordVerifyOutcome } = await import("./verifyQueue");
    seedImportJob(7, 3);
    const verifyId = seedVerifyRow("verify:import:7", "completed");

    await recordVerifyOutcome(verifyId, "flagged", "- 12 rows missing org scoping");
    await flushAsync();

    const job = IMPORTS.find((j) => j.id === 7)!;
    expect(job.verify_status).toBe("flagged");
    expect(job.verify_findings).toBe("- 12 rows missing org scoping");
    expect(logActivityCalls).toHaveLength(1);
    expect(logActivityCalls[0]).toMatchObject({
      orgId: 3,
      job: "verify",
      action: "import_verify_flagged",
      entityType: "import_job",
      entityId: 7,
    });
    // Import verdicts never touch the self-debug chain.
    expect(selfDebugCalls).toHaveLength(0);
  });

  it("verify:import:<jobId> passed with no findings → verify_findings stays null", async () => {
    const { recordVerifyOutcome } = await import("./verifyQueue");
    seedImportJob(8, 4);
    const verifyId = seedVerifyRow("verify:import:8", "completed");

    await recordVerifyOutcome(verifyId, "passed");
    await flushAsync();

    const job = IMPORTS.find((j) => j.id === 8)!;
    expect(job.verify_status).toBe("passed");
    expect(job.verify_findings).toBeNull();
    expect(logActivityCalls[0]).toMatchObject({ action: "import_verify_passed" });
  });

  it("no-ops cleanly on unknown ids, non-verify rows, and unparseable sourceIds", async () => {
    const { recordVerifyOutcome } = await import("./verifyQueue");
    await expect(recordVerifyOutcome(9999, "passed")).resolves.toBeUndefined();

    const notVerify = seedDispatch({ sourceType: "code_review" });
    await expect(recordVerifyOutcome(notVerify, "passed")).resolves.toBeUndefined();

    const weird = seedVerifyRow("verify:outreach:1");
    await expect(recordVerifyOutcome(weird, "passed")).resolves.toBeUndefined();

    // Missing import job behind a well-formed sourceId — logged, no write.
    const orphan = seedVerifyRow("verify:import:404");
    await expect(recordVerifyOutcome(orphan, "flagged", "x")).resolves.toBeUndefined();
    expect(logActivityCalls).toHaveLength(0);
  });
});

describe("verifyQueue.buildImportVerifyCriteria — honest import criteria", () => {
  const FACTS = {
    jobId: 42,
    organizationId: 7,
    kind: "leads",
    totalRows: 100,
    successCount: 90,
    errorCount: 8,
    duplicatesSkipped: 2,
  };

  it("derives the three criteria with stable ids from the job record", async () => {
    const { buildImportVerifyCriteria } = await import("./verifyQueue");
    const criteria = buildImportVerifyCriteria(FACTS);
    expect(criteria.map((c) => c.id)).toEqual([
      "import:42:row-accounting",
      "import:42:error-rate",
      "import:42:org-scoping",
    ]);
    // Row accounting quotes the job's OWN numbers + a machine-checkable query.
    expect(criteria[0].description).toContain("total_rows=100");
    expect(criteria[0].description).toContain("success_count=90");
    expect(criteria[0].description).toContain("error_count=8");
    expect(criteria[0].description).toContain("duplicates_skipped=2");
    expect(criteria[0].check).toContain("FROM import_jobs WHERE id = 42");
  });

  it("error-rate criterion carries the 5% threshold", async () => {
    const { buildImportVerifyCriteria, IMPORT_VERIFY_ERROR_RATE_THRESHOLD } =
      await import("./verifyQueue");
    expect(IMPORT_VERIFY_ERROR_RATE_THRESHOLD).toBe(0.05);
    const criteria = buildImportVerifyCriteria(FACTS);
    expect(criteria[1].description).toContain("5%");
    expect(criteria[1].check).toContain("0.05");
  });

  it("error-rate is honest when zero rows were attempted", async () => {
    const { buildImportVerifyCriteria } = await import("./verifyQueue");
    const criteria = buildImportVerifyCriteria({ ...FACTS, totalRows: 0 });
    expect(criteria[1].description).toContain("cannot be computed");
  });

  it("org-scoping criterion is honest about the attribution limit", async () => {
    const { buildImportVerifyCriteria } = await import("./verifyQueue");
    const criteria = buildImportVerifyCriteria(FACTS);
    expect(criteria[2].description).toContain("organization_id=7");
    expect(criteria[2].description).toContain("NOT stamped with the import-job id");
    expect(criteria[2].description).toContain("'leads'");
  });
});
