/**
 * Tests for adversarialTests (Phase B L3.15 — adversarial self-testing).
 *
 * Coverage:
 *  - scheduleAdversarialTest happy path
 *  - enqueueAdversaryDispatch calls enqueueDispatch with right shape
 *    (sourceType='adversarial_test', agentRole='general-purpose',
 *    $15 cap, 8min timeout) + stamps testRow with id + status='enqueued'
 *  - enqueueDispatch throws → returns null + reason starts 'enqueue_failed:'
 *  - recordAdversaryFindings('found_issues', ...) requires severity (throws
 *    if missing)
 *  - recordAdversaryFindings('clean', ...) accepts severity null
 *  - listPendingTests filters by status='pending'
 *  - listFindingsByOriginal returns the history for a given original
 *  - buildAdversaryPrompt: each of the 5 strategies produces distinct prompt
 *    text containing its strategy name + the test_focus verbatim
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

// --- Stub state ----------------------------------------------------------

interface TestRow {
  id: number;
  created_at: Date;
  original_dispatch_id: number;
  adversarial_dispatch_id: number | null;
  original_agent_role: string;
  adversary_strategy: string;
  test_focus: string;
  status: string;
  findings: string | null;
  severity: string | null;
  reported_at: Date | null;
}

interface ResultRow {
  id: number;
  dispatch_id: number;
  commits_referenced: string[] | null;
  recorded_at: Date;
}

const TESTS: TestRow[] = [];
const RESULTS: ResultRow[] = [];
let nextTestId = 1;
let nextResultId = 1;

const enqueueDispatchCalls: Array<Record<string, unknown>> = [];
let enqueueDispatchShouldThrow: string | null = null;
let nextDispatchId = 1000;

vi.mock("./dispatchQueue", () => ({
  enqueueDispatch: vi.fn(async (opts: Record<string, unknown>) => {
    enqueueDispatchCalls.push(opts);
    if (enqueueDispatchShouldThrow !== null) {
      throw new Error(enqueueDispatchShouldThrow);
    }
    return nextDispatchId++;
  }),
}));

vi.mock("../../db", () => {
  function buildInsert(_table: unknown) {
    return {
      values: (row: any) => {
        const r: TestRow = {
          id: nextTestId++,
          created_at: new Date(),
          original_dispatch_id: row.originalDispatchId,
          adversarial_dispatch_id: row.adversarialDispatchId ?? null,
          original_agent_role: row.originalAgentRole,
          adversary_strategy: row.adversaryStrategy,
          test_focus: row.testFocus,
          status: row.status ?? "pending",
          findings: row.findings ?? null,
          severity: row.severity ?? null,
          reported_at: row.reportedAt ?? null,
        };
        TESTS.push(r);
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
          const row = TESTS.find((r) => r.id === id);
          if (!row) return Promise.resolve();
          if (patch.status !== undefined) row.status = patch.status;
          if (patch.findings !== undefined) row.findings = patch.findings;
          if (patch.severity !== undefined) row.severity = patch.severity;
          if (patch.reportedAt !== undefined) row.reported_at = patch.reportedAt;
          if (patch.adversarialDispatchId !== undefined)
            row.adversarial_dispatch_id = patch.adversarialDispatchId;
          return Promise.resolve();
        },
      }),
    };
  }

  function buildSelect(cols: any) {
    const colKeys = Object.keys(cols ?? {});
    const isResultsLookup =
      colKeys.length === 1 && colKeys[0] === "commitsReferenced";

    const chain: any = {
      _where: undefined as any,
      _order: undefined as any,
      from: (_t: unknown) => chain,
      where: (clause: any) => {
        chain._where = clause;
        return chain;
      },
      orderBy: (_o: any) => {
        chain._order = true;
        return chain;
      },
      limit: (n: number) => {
        if (isResultsLookup) {
          const id = (chain._where as any)?.__id;
          const matching = RESULTS.filter((r) => r.dispatch_id === id).sort(
            (a, b) => b.recorded_at.getTime() - a.recorded_at.getTime(),
          );
          if (matching.length === 0) return Promise.resolve([]);
          return Promise.resolve(
            matching
              .slice(0, n)
              .map((r) => ({ commitsReferenced: r.commits_referenced })),
          );
        }
        const w = chain._where as any;
        let matched: TestRow[];
        if (w?.__id !== undefined) {
          matched = TESTS.filter((r) => r.id === w.__id);
        } else if (w?.__status !== undefined) {
          matched = TESTS.filter((r) => r.status === w.__status);
        } else if (w?.__originalDispatchId !== undefined) {
          matched = TESTS.filter(
            (r) => r.original_dispatch_id === w.__originalDispatchId,
          );
        } else {
          matched = [];
        }
        // newest first for ordering — tests assert presence not strict order.
        matched = [...matched].sort(
          (a, b) => b.created_at.getTime() - a.created_at.getTime(),
        );
        const sliced = n === undefined ? matched : matched.slice(0, n);
        // Project to camelCase keys matching the row shape callers consume.
        return Promise.resolve(
          sliced.map((r) => ({
            id: r.id,
            createdAt: r.created_at,
            originalDispatchId: r.original_dispatch_id,
            adversarialDispatchId: r.adversarial_dispatch_id,
            originalAgentRole: r.original_agent_role,
            adversaryStrategy: r.adversary_strategy,
            testFocus: r.test_focus,
            status: r.status,
            findings: r.findings,
            severity: r.severity,
            reportedAt: r.reported_at,
          })),
        );
      },
    };

    // Some code paths call .where then immediately await (no .limit).
    chain.then = (resolve: any) => {
      // Materialize as a deferred select-all-matching.
      return chain.limit(1000).then(resolve);
    };

    return chain;
  }

  const db = {
    insert: (table: unknown) => buildInsert(table),
    update: (_table: unknown) => buildUpdate(),
    select: (cols?: any) => buildSelect(cols),
  };
  return { db };
});

// drizzle-orm mocks — give where-clauses observable identities.
vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<typeof import("drizzle-orm")>(
    "drizzle-orm",
  );
  return {
    ...actual,
    eq: (col: any, val: any) => {
      const name: string | undefined =
        col?.name ?? col?.fieldAlias ?? col?._name;
      // Heuristic by column name.
      if (name === "id") return { __id: val };
      if (name === "status") return { __status: val };
      if (name === "original_dispatch_id" || name === "originalDispatchId") {
        return { __originalDispatchId: val };
      }
      if (name === "dispatch_id" || name === "dispatchId") {
        return { __id: val };
      }
      // Fallback by value type.
      if (typeof val === "number") return { __id: val };
      if (typeof val === "string") {
        if (
          val === "pending" ||
          val === "enqueued" ||
          val === "found_issues" ||
          val === "clean" ||
          val === "inconclusive"
        ) {
          return { __status: val };
        }
        return { __id: val };
      }
      return { __id: val };
    },
    desc: (_col: any) => ({ __desc: true }),
    and: (...preds: any[]) => preds,
    isNotNull: (_col: any) => ({ __notNull: true }),
    isNull: (_col: any) => ({ __null: true }),
  };
});

// --- Helpers --------------------------------------------------------------

function seedTest(args: {
  originalDispatchId?: number;
  originalAgentRole?: string;
  adversaryStrategy?: string;
  testFocus?: string;
  status?: string;
  adversarialDispatchId?: number | null;
}): number {
  const id = nextTestId++;
  TESTS.push({
    id,
    created_at: new Date(Date.now() + id * 10), // distinct timestamps
    original_dispatch_id: args.originalDispatchId ?? 42,
    adversarial_dispatch_id: args.adversarialDispatchId ?? null,
    original_agent_role: args.originalAgentRole ?? "iris",
    adversary_strategy: args.adversaryStrategy ?? "edge_case_hunter",
    test_focus: args.testFocus ?? "attack the new endpoint",
    status: args.status ?? "pending",
    findings: null,
    severity: null,
    reported_at: null,
  });
  return id;
}

function seedResult(dispatchId: number, commits: string[]): void {
  RESULTS.push({
    id: nextResultId++,
    dispatch_id: dispatchId,
    commits_referenced: commits,
    recorded_at: new Date(),
  });
}

beforeEach(() => {
  TESTS.length = 0;
  RESULTS.length = 0;
  enqueueDispatchCalls.length = 0;
  enqueueDispatchShouldThrow = null;
  nextTestId = 1;
  nextResultId = 1;
  nextDispatchId = 1000;
});

afterEach(() => {
  vi.clearAllMocks();
});

// --- Tests ----------------------------------------------------------------

describe("adversarialTests.scheduleAdversarialTest", () => {
  it("happy path — inserts a pending row and returns testId", async () => {
    const { scheduleAdversarialTest } = await import("./adversarialTests");
    const { testId } = await scheduleAdversarialTest({
      originalDispatchId: 100,
      originalAgentRole: "iris",
      adversaryStrategy: "security_red_team",
      testFocus: "probe the new /api/foo route for auth bypass",
    });

    expect(testId).toBeGreaterThan(0);
    const row = TESTS.find((r) => r.id === testId)!;
    expect(row.status).toBe("pending");
    expect(row.original_dispatch_id).toBe(100);
    expect(row.adversary_strategy).toBe("security_red_team");
    expect(row.test_focus).toContain("/api/foo");
    expect(row.adversarial_dispatch_id).toBeNull();
  });

  it("rejects invalid strategy", async () => {
    const { scheduleAdversarialTest } = await import("./adversarialTests");
    await expect(
      scheduleAdversarialTest({
        originalDispatchId: 1,
        originalAgentRole: "iris",
        // @ts-expect-error — intentionally bad value
        adversaryStrategy: "not_a_real_strategy",
        testFocus: "x",
      }),
    ).rejects.toThrow(/invalid adversaryStrategy/);
  });

  it("rejects empty testFocus", async () => {
    const { scheduleAdversarialTest } = await import("./adversarialTests");
    await expect(
      scheduleAdversarialTest({
        originalDispatchId: 1,
        originalAgentRole: "iris",
        adversaryStrategy: "edge_case_hunter",
        testFocus: "   ",
      }),
    ).rejects.toThrow(/testFocus must be non-empty/);
  });
});

describe("adversarialTests.enqueueAdversaryDispatch", () => {
  it("happy path — enqueues with the right shape + stamps the test row", async () => {
    const { enqueueAdversaryDispatch } = await import("./adversarialTests");
    const testId = seedTest({
      originalDispatchId: 42,
      adversaryStrategy: "race_condition_prober",
      testFocus: "two workers claim same row",
    });
    seedResult(42, ["sha-aaa", "sha-bbb"]);

    const result = await enqueueAdversaryDispatch(testId);

    expect(result.adversarialDispatchId).not.toBeNull();
    expect(result.reason).toBeUndefined();
    expect(enqueueDispatchCalls).toHaveLength(1);
    const call = enqueueDispatchCalls[0];
    expect(call.sourceType).toBe("adversarial_test");
    expect(call.sourceId).toBe(`adversarial:${testId}:original:42`);
    expect(call.agentRole).toBe("general-purpose");
    expect(call.maxCostUsd).toBe(15);
    expect(call.timeoutMs).toBe(8 * 60 * 1000);
    expect(call.enqueuedBy).toBe(`adversarialTests:${testId}`);
    expect(String(call.promptText)).toContain("sha-aaa");
    expect(String(call.promptText)).toContain("two workers claim same row");
    expect(String(call.promptText)).toContain("RACE_CONDITION_PROBER");

    // Row was stamped.
    const row = TESTS.find((r) => r.id === testId)!;
    expect(row.status).toBe("enqueued");
    expect(row.adversarial_dispatch_id).toBe(result.adversarialDispatchId);
  });

  it("works when the original has no commits — prompt notes (no commits recorded)", async () => {
    const { enqueueAdversaryDispatch } = await import("./adversarialTests");
    const testId = seedTest({ originalDispatchId: 7 });
    // No seedResult — no commits exist.

    const result = await enqueueAdversaryDispatch(testId);
    expect(result.adversarialDispatchId).not.toBeNull();
    expect(enqueueDispatchCalls).toHaveLength(1);
    expect(String(enqueueDispatchCalls[0].promptText)).toContain(
      "(no commits recorded)",
    );
  });

  it("idempotent — already-enqueued test returns its existing dispatch id", async () => {
    const { enqueueAdversaryDispatch } = await import("./adversarialTests");
    const testId = seedTest({
      status: "enqueued",
      adversarialDispatchId: 999,
    });

    const result = await enqueueAdversaryDispatch(testId);
    expect(result.adversarialDispatchId).toBe(999);
    expect(result.reason).toBe("already_enqueued");
    expect(enqueueDispatchCalls).toHaveLength(0);
  });

  it("enqueueDispatch throws → returns null + reason starts with 'enqueue_failed:'", async () => {
    const { enqueueAdversaryDispatch } = await import("./adversarialTests");
    const testId = seedTest({});
    enqueueDispatchShouldThrow = "queue is closed";

    const result = await enqueueAdversaryDispatch(testId);
    expect(result.adversarialDispatchId).toBeNull();
    expect(result.reason).toMatch(/^enqueue_failed:/);
    expect(result.reason).toContain("queue is closed");

    // Test row unchanged (still pending, no dispatch id stamped).
    const row = TESTS.find((r) => r.id === testId)!;
    expect(row.status).toBe("pending");
    expect(row.adversarial_dispatch_id).toBeNull();
  });

  it("returns test_not_found for missing id", async () => {
    const { enqueueAdversaryDispatch } = await import("./adversarialTests");
    const result = await enqueueAdversaryDispatch(9999);
    expect(result.adversarialDispatchId).toBeNull();
    expect(result.reason).toBe("test_not_found");
    expect(enqueueDispatchCalls).toHaveLength(0);
  });
});

describe("adversarialTests.recordAdversaryFindings", () => {
  it("'found_issues' requires a valid severity", async () => {
    const { recordAdversaryFindings } = await import("./adversarialTests");
    const testId = seedTest({});

    await expect(
      recordAdversaryFindings(testId, {
        status: "found_issues",
        findings: "broken",
        // no severity
      }),
    ).rejects.toThrow(/requires a valid severity/);

    // Row unchanged.
    const row = TESTS.find((r) => r.id === testId)!;
    expect(row.status).toBe("pending");
  });

  it("'found_issues' with severity persists correctly", async () => {
    const { recordAdversaryFindings } = await import("./adversarialTests");
    const testId = seedTest({});

    await recordAdversaryFindings(testId, {
      status: "found_issues",
      findings: "SQLi in /api/foo via name param",
      severity: "high",
    });

    const row = TESTS.find((r) => r.id === testId)!;
    expect(row.status).toBe("found_issues");
    expect(row.findings).toContain("SQLi");
    expect(row.severity).toBe("high");
    expect(row.reported_at).not.toBeNull();
  });

  it("'clean' allows severity null", async () => {
    const { recordAdversaryFindings } = await import("./adversarialTests");
    const testId = seedTest({});

    await recordAdversaryFindings(testId, {
      status: "clean",
      findings: "no findings after edge_case sweep",
    });

    const row = TESTS.find((r) => r.id === testId)!;
    expect(row.status).toBe("clean");
    expect(row.severity).toBeNull();
    expect(row.findings).toContain("no findings");
  });

  it("'inconclusive' allows severity null", async () => {
    const { recordAdversaryFindings } = await import("./adversarialTests");
    const testId = seedTest({});

    await recordAdversaryFindings(testId, {
      status: "inconclusive",
      findings: "could not reproduce; needs prod traffic",
    });

    const row = TESTS.find((r) => r.id === testId)!;
    expect(row.status).toBe("inconclusive");
    expect(row.severity).toBeNull();
  });

  it("no-ops cleanly when test id is unknown", async () => {
    const { recordAdversaryFindings } = await import("./adversarialTests");
    await expect(
      recordAdversaryFindings(9999, {
        status: "clean",
        findings: "x",
      }),
    ).resolves.toBeUndefined();
  });
});

describe("adversarialTests.listPendingTests", () => {
  it("returns only rows with status='pending'", async () => {
    const { listPendingTests } = await import("./adversarialTests");
    const a = seedTest({ status: "pending" });
    seedTest({ status: "enqueued" });
    const c = seedTest({ status: "pending" });
    seedTest({ status: "found_issues" });

    const rows = await listPendingTests();
    const ids = rows.map((r) => r.id).sort();
    expect(ids).toEqual([a, c].sort());
  });

  it("honors the limit", async () => {
    const { listPendingTests } = await import("./adversarialTests");
    seedTest({ status: "pending" });
    seedTest({ status: "pending" });
    seedTest({ status: "pending" });

    const rows = await listPendingTests(2);
    expect(rows).toHaveLength(2);
  });
});

describe("adversarialTests.listFindingsByOriginal", () => {
  it("returns history filtered by originalDispatchId", async () => {
    const { listFindingsByOriginal } = await import("./adversarialTests");
    seedTest({ originalDispatchId: 100 });
    seedTest({ originalDispatchId: 200 });
    seedTest({ originalDispatchId: 100 });

    const rows = await listFindingsByOriginal(100);
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.originalDispatchId).toBe(100);
    }
  });

  it("returns empty when no tests exist for the original", async () => {
    const { listFindingsByOriginal } = await import("./adversarialTests");
    seedTest({ originalDispatchId: 1 });

    const rows = await listFindingsByOriginal(9999);
    expect(rows).toEqual([]);
  });
});

describe("adversarialTests.buildAdversaryPrompt", () => {
  it("each of the 5 strategies produces a distinct prompt containing its strategy name + the focus", async () => {
    const { buildAdversaryPrompt } = await import("./adversarialTests");
    const strategies = [
      "edge_case_hunter",
      "security_red_team",
      "race_condition_prober",
      "spec_misinterpretation",
      "regression_predictor",
    ] as const;

    const seen = new Set<string>();
    const focus = "attack the new /api/foo endpoint";

    for (const s of strategies) {
      const prompt = buildAdversaryPrompt({
        strategy: s,
        originalDispatchId: 42,
        originalAgentRole: "iris",
        testFocus: focus,
        originalCommitShas: ["sha-1", "sha-2"],
      });

      // Strategy name appears (in upper-case header form).
      expect(prompt).toContain(s.toUpperCase());
      // The strategy lowercase token also appears in the metadata line.
      expect(prompt).toContain(s);
      // Focus appears verbatim.
      expect(prompt).toContain(focus);
      // Target metadata.
      expect(prompt).toContain("dispatch #42");
      expect(prompt).toContain("sha-1");
      expect(prompt).toContain("sha-2");
      // Structured output block.
      expect(prompt).toContain("FINDINGS_STATUS:");
      expect(prompt).toContain("SEVERITY:");
      expect(prompt).toContain("FINDINGS:");

      // Distinctness.
      const fingerprint = prompt.slice(0, 200);
      expect(seen.has(fingerprint)).toBe(false);
      seen.add(fingerprint);
    }
    expect(seen.size).toBe(5);
  });

  it("handles empty commit list with a placeholder", async () => {
    const { buildAdversaryPrompt } = await import("./adversarialTests");
    const prompt = buildAdversaryPrompt({
      strategy: "edge_case_hunter",
      originalDispatchId: 1,
      originalAgentRole: "iris",
      testFocus: "f",
      originalCommitShas: [],
    });
    expect(prompt).toContain("(no commits recorded)");
  });

  it("throws on invalid strategy", async () => {
    const { buildAdversaryPrompt } = await import("./adversarialTests");
    expect(() =>
      buildAdversaryPrompt({
        // @ts-expect-error — intentionally bad value
        strategy: "made_up",
        originalDispatchId: 1,
        originalAgentRole: "iris",
        testFocus: "f",
        originalCommitShas: [],
      }),
    ).toThrow(/invalid strategy/);
  });
});
