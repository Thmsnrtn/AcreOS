/**
 * Tests for verifyQueue (CP2 + CP3 of Jarvis Phase 1 — Verified
 * Act-and-Confirm).
 *
 * Coverage:
 *  - buildVerifyPrompt / VERIFY_PROMPT_TEMPLATE render criteria + context and
 *    end with the SAME structured block CP1's parseReviewVerdict consumes
 *    (VERDICT: passed | flagged + FINDINGS), read-only instruction included.
 *  - buildVerifySourceId / parseVerifySourceId round-trip the
 *    'verify:<targetKind>:<targetId>' convention (all four kinds).
 *  - enqueueVerifyDispatch eligibility: happy path per target kind
 *    (sourceType='verify', sourceId convention, criteria stored on the row,
 *    import job / mail shipment stamped verify_status='pending'); skips on
 *    no_criteria, dispatch_disabled, target_not_found, target_is_verify
 *    (never verify a verify), already_verifying; never throws
 *    (enqueue_failed).
 *  - recordVerifyOutcome routing per target kind: 'verify:dispatch:<id>'
 *    flips the target's review_status + fires self-debug on flagged;
 *    'verify:import:<jobId>' and 'verify:mailShipment:<id>' write
 *    verify_status/verify_findings + log Letter-visibly via
 *    logActivity(job:'verify'); 'verify:dunningEvent:<id>' logs
 *    Letter-visibly only.
 *  - CP3 trust binding (applyVerifiedTrustEvidence): passed → verified clean
 *    evidence for the dispatch's KNOWN autopilot domain; flagged → bounce
 *    through the existing demotion seam; unknown/absent domain → honest skip
 *    (never guess); trust-ledger failure never breaks the verdict write.
 *  - buildImportVerifyCriteria / buildMailShipmentVerifyCriteria /
 *    buildDunningVerifyCriteria derive HONEST criteria from the target's own
 *    record (explicit about what is NOT checkable).
 *
 * DB mock follows the selfDebug.test.ts style (predicate-based drizzle
 * mocks); stores are routed by TABLE IDENTITY (the real drizzle table
 * objects) so multi-table CP3 flows read/write the right in-memory store.
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

interface MailRow {
  id: number;
  organization_id: number;
  status: string;
  piece_count: number;
  debit_event_key: string | null;
  debited_cents: number | null;
  provider: string | null;
  verify_status: string | null;
  verify_findings: string | null;
}

interface DunningRow {
  id: number;
  organization_id: number;
  status: string;
  resolved_at: Date | null;
  resolution_type: string | null;
}

interface OrgRow {
  id: number;
  subscription_tier: string | null;
}

const QUEUE: QueueRow[] = [];
const IMPORTS: ImportRow[] = [];
const MAIL: MailRow[] = [];
const DUNNING: DunningRow[] = [];
const ORGS: OrgRow[] = [];
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

// CP3 — the Trust Ledger seam. This resolves to the SAME module act.ts
// imports as './domainAutonomy', so both the direct recordVerifiedOutcome
// call and act's own imports hit these stand-ins (no DB).
const trustCalls: Array<{ domain: string; passed: boolean; evidence: string }> = [];
let trustShouldThrow = false;
vi.mock("../autopilot/domainAutonomy", () => ({
  recordVerifiedOutcome: vi.fn(
    async (domain: string, passed: boolean, evidence: string) => {
      if (trustShouldThrow) throw new Error("trust ledger unavailable");
      trustCalls.push({ domain, passed, evidence });
      return "draft";
    },
  ),
  // act.ts imports these at module scope — inert stand-ins keep it loadable.
  recordCleanCycle: vi.fn(async () => "observe"),
  recordAnomaly: vi.fn(async () => "observe"),
}));

// --- DB mock ------------------------------------------------------------------

function camelToSnake(k: string): string {
  return k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

vi.mock("../../db", async () => {
  // Route each query to its in-memory store by TABLE IDENTITY — the same
  // drizzle table objects the service imports (neither module is mocked, so
  // both resolve to the same instances).
  const schema = await vi.importActual<Record<string, unknown>>("@shared/schema");
  const dispatchSchema = await vi.importActual<Record<string, unknown>>(
    "@shared/schema/solene-dispatch",
  );
  function storeFor(table: unknown): Array<Record<string, unknown>> {
    if (table === schema.importJobs) return IMPORTS as any[];
    if (table === schema.mailShipments) return MAIL as any[];
    if (table === schema.dunningEvents) return DUNNING as any[];
    if (table === schema.organizations) return ORGS as any[];
    if (table === dispatchSchema.soleneDispatchQueue) return QUEUE as any[];
    throw new Error("verifyQueue.test db mock: unknown table");
  }

  function buildSelect(cols: Record<string, unknown>) {
    const chain: any = {
      _filters: [] as Array<(r: Record<string, unknown>) => boolean>,
      _store: QUEUE as any[],
      from: (t: unknown) => {
        chain._store = storeFor(t);
        return chain;
      },
      where: (pred: any) => {
        chain._filters.push(pred);
        return chain;
      },
      limit: (n: number) => {
        const matched = (chain._store as Array<Record<string, unknown>>).filter(
          (r) =>
            chain._filters.every(
              (f: (r: Record<string, unknown>) => boolean) => f(r),
            ),
        );
        return Promise.resolve(
          matched.slice(0, n).map((r) => {
            const mapped: Record<string, unknown> = {};
            for (const key of Object.keys(cols ?? {})) {
              // Prefer the selected column's real SQL name (handles aliased
              // selects like `{ tier: organizations.subscriptionTier }`).
              const colName =
                (cols[key] as { name?: string } | undefined)?.name ??
                camelToSnake(key);
              mapped[key] = r[colName];
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
    update: (table: unknown) => ({
      set: (patch: Record<string, unknown>) => ({
        where: (pred: (r: Record<string, unknown>) => boolean) => {
          const store = storeFor(table);
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
  sourceId?: string;
  maxCostUsd?: number;
  status?: string;
}): number {
  const id = nextQueueId++;
  QUEUE.push({
    id,
    status: args.status ?? "completed",
    source_type: args.sourceType ?? "auto_dispatch",
    source_id: args.sourceId ?? `seed:${id}`,
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

function seedMailShipment(args: Partial<MailRow> & { id: number }): void {
  MAIL.push({
    organization_id: 5,
    status: "sent",
    piece_count: 120,
    debit_event_key: `mail:queue:5:1720000000:${args.id}`,
    debited_cents: 1840,
    provider: "lob",
    verify_status: null,
    verify_findings: null,
    ...args,
  });
}

function seedDunningEvent(args: Partial<DunningRow> & { id: number }): void {
  DUNNING.push({
    organization_id: 9,
    status: "resolved",
    resolved_at: new Date(),
    resolution_type: "manual_payment",
    ...args,
  });
}

function seedOrg(id: number, tier: string | null): void {
  ORGS.push({ id, subscription_tier: tier });
}

const CRITERIA = [
  {
    id: "c1",
    description: "row accounting adds up",
    check: "SELECT total_rows FROM import_jobs WHERE id = 7",
  },
  { id: "c2", description: "error rate below 5%" },
];

/** Flush the fire-and-forget import().then chains (a few ticks — the CP3
 *  trust binding chains two dynamic imports behind a db read). */
async function flushAsync(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
}

beforeEach(() => {
  QUEUE.length = 0;
  IMPORTS.length = 0;
  MAIL.length = 0;
  DUNNING.length = 0;
  ORGS.length = 0;
  enqueueDispatchCalls.length = 0;
  logActivityCalls.length = 0;
  selfDebugCalls.length = 0;
  trustCalls.length = 0;
  trustShouldThrow = false;
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
  it("round-trips all four target kinds", async () => {
    const { buildVerifySourceId, parseVerifySourceId } = await import("./verifyQueue");
    expect(buildVerifySourceId("dispatch", 123)).toBe("verify:dispatch:123");
    expect(buildVerifySourceId("import", 456)).toBe("verify:import:456");
    expect(buildVerifySourceId("mailShipment", 78)).toBe("verify:mailShipment:78");
    expect(buildVerifySourceId("dunningEvent", 90)).toBe("verify:dunningEvent:90");
    expect(parseVerifySourceId("verify:dispatch:123")).toEqual({
      targetKind: "dispatch",
      targetId: 123,
    });
    expect(parseVerifySourceId("verify:import:456")).toEqual({
      targetKind: "import",
      targetId: 456,
    });
    expect(parseVerifySourceId("verify:mailShipment:78")).toEqual({
      targetKind: "mailShipment",
      targetId: 78,
    });
    expect(parseVerifySourceId("verify:dunningEvent:90")).toEqual({
      targetKind: "dunningEvent",
      targetId: 90,
    });
  });

  it("rejects foreign sourceIds", async () => {
    const { parseVerifySourceId } = await import("./verifyQueue");
    expect(parseVerifySourceId("dispatch:123")).toBeNull();
    expect(parseVerifySourceId("verify:outreach:1")).toBeNull();
    expect(parseVerifySourceId("verify:mailshipment:1")).toBeNull(); // case-sensitive
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

// ── CP3 — verdicts feed the Trust Ledger ─────────────────────────────────────

describe("CP3 — applyVerifiedTrustEvidence (trust binding)", () => {
  it("passed verify on an autopilot dispatch with a KNOWN move → verified clean evidence in its domain", async () => {
    const { recordVerifyOutcome } = await import("./verifyQueue");
    // resolve_incident binds to the 'deploy' domain in act.ts.
    const targetId = seedDispatch({
      sourceType: "auto_dispatch",
      sourceId: "autopilot:resolve_incident",
    });
    const verifyId = seedVerifyRow(`verify:dispatch:${targetId}`, "completed");

    await recordVerifyOutcome(verifyId, "passed");

    expect(QUEUE.find((q) => q.id === targetId)?.review_status).toBe("passed");
    // The trust binding is fire-and-forget behind two dynamic imports — a
    // fixed tick-flush is racy under CI's cold module cache (the call can
    // land AFTER the assertion and bleed into the next test). Wait on the
    // condition, not the clock.
    await vi.waitFor(() =>
      expect(trustCalls).toEqual([
        expect.objectContaining({ domain: "deploy", passed: true }),
      ]),
    );
  });

  it("flagged verify → a bounce through the existing demotion seam (passed=false) + self-debug still fires", async () => {
    const { recordVerifyOutcome } = await import("./verifyQueue");
    // recover_payments binds to the 'finance' domain.
    const targetId = seedDispatch({
      sourceType: "auto_dispatch",
      sourceId: "autopilot:recover_payments",
    });
    const verifyId = seedVerifyRow(`verify:dispatch:${targetId}`, "completed");

    await recordVerifyOutcome(verifyId, "flagged", "- ledger row missing");

    expect(QUEUE.find((q) => q.id === targetId)?.review_status).toBe("flagged");
    // Condition-based wait — see the passed-verify test above.
    await vi.waitFor(() =>
      expect(trustCalls).toEqual([
        expect.objectContaining({ domain: "finance", passed: false }),
      ]),
    );
    expect(trustCalls[0].evidence).toContain("ledger row missing");
    await vi.waitFor(() => expect(selfDebugCalls).toHaveLength(1));
  });

  it("skips HONESTLY when the dispatch carries no domain — non-autopilot source and unknown move kind", async () => {
    const { recordVerifyOutcome } = await import("./verifyQueue");
    // Founder/manual work: never earns or costs domain trust.
    const manualId = seedDispatch({ sourceType: "founder_manual", sourceId: "founder:123" });
    const verifyA = seedVerifyRow(`verify:dispatch:${manualId}`, "completed");
    await recordVerifyOutcome(verifyA, "passed");
    // Unknown move kind: must NOT fall through to the fail-closed 'ops'
    // default — no guessing.
    const unknownId = seedDispatch({
      sourceType: "auto_dispatch",
      sourceId: "autopilot:brand_new_unbound_move",
    });
    const verifyB = seedVerifyRow(`verify:dispatch:${unknownId}`, "completed");
    await recordVerifyOutcome(verifyB, "passed");
    await flushAsync();

    expect(trustCalls).toHaveLength(0);
    // The verdict writes themselves still landed.
    expect(QUEUE.find((q) => q.id === manualId)?.review_status).toBe("passed");
    expect(QUEUE.find((q) => q.id === unknownId)?.review_status).toBe("passed");
  });

  it("fire-and-forget isolation — a trust-ledger failure never breaks the verdict write", async () => {
    const { recordVerifyOutcome } = await import("./verifyQueue");
    trustShouldThrow = true;
    const targetId = seedDispatch({
      sourceType: "auto_dispatch",
      sourceId: "autopilot:optimize",
    });
    const verifyId = seedVerifyRow(`verify:dispatch:${targetId}`, "completed");

    await expect(recordVerifyOutcome(verifyId, "passed")).resolves.toBeUndefined();
    await flushAsync();

    expect(QUEUE.find((q) => q.id === targetId)?.review_status).toBe("passed");
    expect(trustCalls).toHaveLength(0);
  });

  it("direct call reports its outcome honestly (applied / skip reasons) for both vias", async () => {
    const { applyVerifiedTrustEvidence } = await import("./verifyQueue");
    const known = seedDispatch({
      sourceType: "auto_dispatch",
      sourceId: "autopilot:grow_owned_channels",
    });
    const viaReview = await applyVerifiedTrustEvidence({
      targetDispatchId: known,
      outcome: "passed",
      verdictDispatchId: 777,
      via: "code_review",
    });
    expect(viaReview).toEqual({ applied: true, domain: "growth" });

    const missing = await applyVerifiedTrustEvidence({
      targetDispatchId: 99999,
      outcome: "passed",
      verdictDispatchId: 777,
      via: "verify",
    });
    expect(missing).toEqual({ applied: false, skipReason: "target_not_found" });

    const manual = seedDispatch({ sourceType: "solene_manual" });
    const noDomain = await applyVerifiedTrustEvidence({
      targetDispatchId: manual,
      outcome: "flagged",
      verdictDispatchId: 777,
      via: "verify",
    });
    expect(noDomain).toEqual({ applied: false, skipReason: "no_domain" });
  });
});

// ── CP3 — outreach mail verification ─────────────────────────────────────────

describe("CP3 — buildMailShipmentVerifyCriteria (honest outreach criteria)", () => {
  const FACTS = {
    shipmentId: 11,
    organizationId: 5,
    pieceCount: 120,
    debitEventKey: "mail:queue:5:1720000000:120",
    debitedCents: 1840,
    orgTier: "free",
    provider: "lob",
  };

  it("derives stable criterion ids from the shipment's own record", async () => {
    const { buildMailShipmentVerifyCriteria } = await import("./verifyQueue");
    const criteria = buildMailShipmentVerifyCriteria(FACTS);
    expect(criteria.map((c) => c.id)).toEqual([
      "mailShipment:11:piece-accounting",
      "mailShipment:11:debit-ledger",
      "mailShipment:11:compliance-posture",
    ]);
  });

  it("piece accounting pins the quote-locked count and is honest that delivery is a provider fact", async () => {
    const { buildMailShipmentVerifyCriteria } = await import("./verifyQueue");
    const [pieces] = buildMailShipmentVerifyCriteria(FACTS);
    expect(pieces.description).toContain("piece_count=120");
    expect(pieces.description).toContain("status='sent'");
    expect(pieces.description).toContain("HONEST LIMIT");
    expect(pieces.description).toContain("provider/USPS fact");
    expect(pieces.check).toContain("mail_shipment_pieces WHERE shipment_id = 11");
  });

  it("debit criterion demands the debit row present AND the refund row ABSENT on a sent shipment", async () => {
    const { buildMailShipmentVerifyCriteria } = await import("./verifyQueue");
    const [, debit] = buildMailShipmentVerifyCriteria(FACTS);
    expect(debit.description).toContain("debited_cents=1840");
    expect(debit.description).toContain("'mail:queue:5:1720000000:120'");
    expect(debit.description).toContain(":refund' must be ABSENT");
    expect(debit.check).toContain("financial_ledger");
  });

  it("debit criterion is honest when no debit key was persisted (legacy row) — no guessing", async () => {
    const { buildMailShipmentVerifyCriteria } = await import("./verifyQueue");
    const [, debit] = buildMailShipmentVerifyCriteria({
      ...FACTS,
      debitEventKey: null,
      debitedCents: null,
    });
    expect(debit.description).toContain("NOT attributable");
    expect(debit.description).toContain("report this limit");
  });

  it("free-tier compliance points at the canonical cap constant and names what is NOT checkable", async () => {
    const { buildMailShipmentVerifyCriteria } = await import("./verifyQueue");
    const [, , compliance] = buildMailShipmentVerifyCriteria(FACTS);
    expect(compliance.description).toContain("FREE tier");
    expect(compliance.description).toContain("FREE_TIER_LIFETIME_PIECES");
    expect(compliance.description).toContain("do not assume its value");
    // Honest limits: dedupe is advisory, no suppression list on this path.
    expect(compliance.description).toContain("advisory UX only");
    expect(compliance.description).toContain("NO suppression list");
    expect(compliance.check).toContain("status != 'cancelled'");
  });

  it("paid-tier compliance says the free cap does not apply (the pool debit is the control)", async () => {
    const { buildMailShipmentVerifyCriteria } = await import("./verifyQueue");
    const [, , compliance] = buildMailShipmentVerifyCriteria({
      ...FACTS,
      orgTier: "pro",
    });
    expect(compliance.description).toContain("'pro' (paid) tier");
    expect(compliance.description).toContain("does not apply");
    expect(compliance.description).toContain("credit-pool");
  });
});

describe("CP3 — enqueueMailShipmentVerify (the mailFlusher seam)", () => {
  it("reads the shipment + org tier, enqueues verify:mailShipment:<id>, stamps verify_status='pending'", async () => {
    const { enqueueMailShipmentVerify } = await import("./verifyQueue");
    seedMailShipment({ id: 11, organization_id: 5 });
    seedOrg(5, "free");

    const result = await enqueueMailShipmentVerify(11);

    expect(result.skipped).toBe(false);
    const row = QUEUE.find((q) => q.id === result.verifyDispatchId)!;
    expect(row.source_type).toBe("verify");
    expect(row.source_id).toBe("verify:mailShipment:11");
    expect(row.prompt_text).toContain("mail shipment #11");
    expect(row.prompt_text).toContain("piece_count=120");
    expect((row.success_criteria as any).criteria).toHaveLength(3);
    expect(MAIL.find((m) => m.id === 11)?.verify_status).toBe("pending");
  });

  it("missing shipment → skipped 'target_not_found', nothing enqueued, never throws", async () => {
    const { enqueueMailShipmentVerify } = await import("./verifyQueue");
    const result = await enqueueMailShipmentVerify(404);
    expect(result).toEqual({
      verifyDispatchId: null,
      skipped: true,
      skipReason: "target_not_found",
    });
    expect(enqueueDispatchCalls).toHaveLength(0);
  });
});

describe("CP3 — recordVerifyOutcome mailShipment routing", () => {
  it("writes verify_status/verify_findings on the shipment + logs Letter-visibly", async () => {
    const { recordVerifyOutcome } = await import("./verifyQueue");
    seedMailShipment({ id: 11, organization_id: 5 });
    const verifyId = seedVerifyRow("verify:mailShipment:11", "completed");

    await recordVerifyOutcome(verifyId, "flagged", "- 3 pieces stuck 'pending' under a sent shipment");
    await flushAsync();

    const ship = MAIL.find((m) => m.id === 11)!;
    expect(ship.verify_status).toBe("flagged");
    expect(ship.verify_findings).toContain("stuck 'pending'");
    expect(logActivityCalls).toHaveLength(1);
    expect(logActivityCalls[0]).toMatchObject({
      orgId: 5,
      job: "verify",
      action: "mail_shipment_verify_flagged",
      entityType: "mail_shipment",
      entityId: 11,
    });
    // Non-dispatch targets never fire self-debug or trust evidence.
    expect(selfDebugCalls).toHaveLength(0);
    expect(trustCalls).toHaveLength(0);
  });

  it("passed verdict lands as mail_shipment_verify_passed with findings null", async () => {
    const { recordVerifyOutcome } = await import("./verifyQueue");
    seedMailShipment({ id: 12, organization_id: 6 });
    const verifyId = seedVerifyRow("verify:mailShipment:12", "completed");

    await recordVerifyOutcome(verifyId, "passed");
    await flushAsync();

    expect(MAIL.find((m) => m.id === 12)?.verify_status).toBe("passed");
    expect(MAIL.find((m) => m.id === 12)?.verify_findings).toBeNull();
    expect(logActivityCalls[0]).toMatchObject({ action: "mail_shipment_verify_passed" });
  });
});

// ── CP3 — note-vertical / dunning verification ───────────────────────────────

describe("CP3 — buildDunningVerifyCriteria (honest dunning criteria)", () => {
  it("maps each hand action to the resolution_type dunningService actually writes", async () => {
    const { DUNNING_EXPECTED_RESOLUTION } = await import("./verifyQueue");
    expect(DUNNING_EXPECTED_RESOLUTION).toEqual({
      retry: "manual_payment",
      cancel: "subscription_cancelled",
      resolve: "escalated",
    });
  });

  it("status-transition criterion pins resolved_at + resolution_type and is honest about retry_count", async () => {
    const { buildDunningVerifyCriteria } = await import("./verifyQueue");
    const [transition] = buildDunningVerifyCriteria({
      eventId: 33,
      organizationId: 9,
      action: "retry",
    });
    expect(transition.id).toBe("dunningEvent:33:status-transition");
    expect(transition.description).toContain("status='resolved'");
    expect(transition.description).toContain("resolution_type='manual_payment'");
    // Honest limit: the hand paths do NOT stamp the auto-retry attempt marker.
    expect(transition.description).toContain("do NOT increment");
    expect(transition.description).toContain("retry_count");
    expect(transition.check).toContain("dunning_events WHERE id = 33");
  });

  it("org-state criterion requires the cleared stage but allows open siblings", async () => {
    const { buildDunningVerifyCriteria } = await import("./verifyQueue");
    const [, orgState] = buildDunningVerifyCriteria({
      eventId: 33,
      organizationId: 9,
      action: "resolve",
    });
    expect(orgState.description).toContain("dunning_stage must be 'none'");
    expect(orgState.description).toContain("open siblings");
    expect(orgState.check).toContain("organization_id = 9");
  });

  it("ledger criterion is honest that the Stripe-side outcome is NOT checkable here", async () => {
    const { buildDunningVerifyCriteria } = await import("./verifyQueue");
    const [, , ledger] = buildDunningVerifyCriteria({
      eventId: 33,
      organizationId: 9,
      action: "cancel",
    });
    expect(ledger.description).toContain("STRIPE");
    expect(ledger.description).toContain("NOT checkable from this database");
    expect(ledger.description).toContain("out of scope");
  });
});

describe("CP3 — enqueueDunningEventVerify (the witnessed-hand seam)", () => {
  it("enqueues verify:dunningEvent:<id> with the event's criteria on the row", async () => {
    const { enqueueDunningEventVerify } = await import("./verifyQueue");
    seedDunningEvent({ id: 33, organization_id: 9 });

    const result = await enqueueDunningEventVerify(33, "retry");

    expect(result.skipped).toBe(false);
    const row = QUEUE.find((q) => q.id === result.verifyDispatchId)!;
    expect(row.source_id).toBe("verify:dunningEvent:33");
    expect(row.prompt_text).toContain("dunning event #33");
    expect(row.prompt_text).toContain("resolution_type='manual_payment'");
    expect((row.success_criteria as any).criteria).toHaveLength(3);
  });

  it("missing event → skipped 'target_not_found', never throws", async () => {
    const { enqueueDunningEventVerify } = await import("./verifyQueue");
    const result = await enqueueDunningEventVerify(404, "resolve");
    expect(result).toEqual({
      verifyDispatchId: null,
      skipped: true,
      skipReason: "target_not_found",
    });
    expect(enqueueDispatchCalls).toHaveLength(0);
  });
});

describe("CP3 — recordVerifyOutcome dunningEvent routing", () => {
  it("logs Letter-visibly only (dunning_events carries no verify columns by design)", async () => {
    const { recordVerifyOutcome } = await import("./verifyQueue");
    seedDunningEvent({ id: 33, organization_id: 9 });
    const verifyId = seedVerifyRow("verify:dunningEvent:33", "completed");

    await recordVerifyOutcome(verifyId, "flagged", "- org stage not cleared");
    await flushAsync();

    expect(logActivityCalls).toHaveLength(1);
    expect(logActivityCalls[0]).toMatchObject({
      orgId: 9,
      job: "verify",
      action: "dunning_verify_flagged",
      entityType: "dunning_event",
      entityId: 33,
    });
    expect(selfDebugCalls).toHaveLength(0);
    expect(trustCalls).toHaveLength(0);
  });

  it("missing event no-ops cleanly (logged, no activity write)", async () => {
    const { recordVerifyOutcome } = await import("./verifyQueue");
    const verifyId = seedVerifyRow("verify:dunningEvent:404", "completed");
    await expect(recordVerifyOutcome(verifyId, "passed")).resolves.toBeUndefined();
    expect(logActivityCalls).toHaveLength(0);
  });
});
