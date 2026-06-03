/**
 * Tests for the Solene fine-grain decision rationale service (Layer 3 L3.16).
 *
 * Coverage:
 *  - addTraceStep happy path → returns id + step_number=1 first, =2 second
 *  - addTraceStep with non-existent decisionId → warn + traceId=-1
 *  - addTraceStep step_text > 2000 chars → truncated with `… [truncated]`
 *  - addTraceStep confidence out of range → warn + clamp to [0,1]
 *  - addTraceStep unknown stepKind → warn + skipped
 *  - addTraceStep chosenPathReason on non-choice → warn but allow
 *  - loadTrace returns steps in step_number order
 *  - loadTrace empty → returns [] (not null)
 *  - addTraceSteps bulk insert preserves order
 *  - addTraceSteps returns correct first/lastStepNumber
 *  - addTraceSteps empty input → 0
 *  - renderTraceAsMarkdown empty → header + "_No trace recorded._"
 *  - renderTraceAsMarkdown full case → all 4 step types + evidence +
 *    alternatives + confidence + chosen-because
 *  - getTraceSummary math (kind counts, average confidence excludes nulls,
 *    hasUncertaintyMarkers detects)
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

// ============================================================================
// In-memory DB
// ============================================================================

interface TraceRow {
  id: number;
  decisionId: number;
  stepNumber: number;
  recordedAt: Date;
  stepKind: string;
  stepText: string;
  evidenceRefs: string[] | null;
  alternativesConsidered: string[] | null;
  chosenPathReason: string | null;
  confidenceAtStep: string | null;
}

const TRACE_ROWS: TraceRow[] = [];
const EXISTING_DECISIONS = new Set<number>();
let nextTraceId = 1;
let throwOnInsert = false;

// Predicate parser — walks a nested {op,col,val} / {preds:[]} tree and pulls
// out the (id-eq, decisionId-eq) we care about.
interface PredInfo {
  decisionIdEq?: number;
  idEq?: number;
}
function parseWhere(pred: any): PredInfo {
  const info: PredInfo = {};
  walk(pred);
  return info;
  function walk(node: any) {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const c of node) walk(c);
      return;
    }
    if (typeof node === "object") {
      if (node.op === "eq") {
        if (node.col === "decision_id") info.decisionIdEq = node.val;
        else if (node.col === "id") info.idEq = node.val;
      } else if (Array.isArray(node.preds)) {
        for (const c of node.preds) walk(c);
      }
    }
  }
}

// `select` chain handles both the traces table (returning trace rows) and the
// decisions table (returning a stub {id} row when the id is in
// EXISTING_DECISIONS). Plus a MAX(step_number) aggregate when projected.
function buildDbMock() {
  let pendingDecisionIdEq: number | undefined;
  let pendingIdEq: number | undefined;
  let pendingOrderAsc = false;
  let pendingLimit: number | undefined;
  let pendingProjection: "rows" | "id-only" | "max-step" = "rows";
  let pendingTable: "traces" | "decisions" | null = null;

  const reset = () => {
    pendingDecisionIdEq = undefined;
    pendingIdEq = undefined;
    pendingOrderAsc = false;
    pendingLimit = undefined;
    pendingProjection = "rows";
    pendingTable = null;
  };

  const chain: any = {
    from(table: any) {
      pendingTable = table?.__tableName === "decisions" ? "decisions" : "traces";
      return chain;
    },
    where(pred: any) {
      const info = parseWhere(pred);
      pendingDecisionIdEq = info.decisionIdEq;
      pendingIdEq = info.idEq;
      return chain;
    },
    orderBy(_arg: any) {
      pendingOrderAsc = true;
      return chain;
    },
    limit(n: number) {
      pendingLimit = n;
      return chain;
    },
    then(onFulfilled: any, onRejected: any) {
      let out: any[];
      if (pendingTable === "decisions") {
        if (pendingIdEq !== undefined && EXISTING_DECISIONS.has(pendingIdEq)) {
          out = [{ id: pendingIdEq }];
        } else {
          out = [];
        }
      } else if (pendingProjection === "max-step") {
        const filtered =
          pendingDecisionIdEq !== undefined
            ? TRACE_ROWS.filter((r) => r.decisionId === pendingDecisionIdEq)
            : TRACE_ROWS;
        const max =
          filtered.length === 0
            ? null
            : filtered.reduce((m, r) => Math.max(m, r.stepNumber), 0);
        out = [{ maxStep: max }];
      } else {
        let rows = [...TRACE_ROWS];
        if (pendingDecisionIdEq !== undefined) {
          rows = rows.filter((r) => r.decisionId === pendingDecisionIdEq);
        }
        if (pendingOrderAsc) {
          rows.sort((a, b) => a.stepNumber - b.stepNumber);
        }
        if (pendingLimit !== undefined) rows = rows.slice(0, pendingLimit);
        out = rows;
      }
      reset();
      return Promise.resolve(out).then(onFulfilled, onRejected);
    },
  };

  return {
    insert: (_table: any) => ({
      values: (row: any) => {
        // Bulk path: row is an array.
        if (Array.isArray(row)) {
          if (throwOnInsert) {
            return Promise.reject(new Error("simulated db failure"));
          }
          for (const r of row) {
            TRACE_ROWS.push({
              id: nextTraceId++,
              decisionId: r.decisionId,
              stepNumber: r.stepNumber,
              recordedAt: new Date(),
              stepKind: r.stepKind,
              stepText: r.stepText,
              evidenceRefs: r.evidenceRefs ?? null,
              alternativesConsidered: r.alternativesConsidered ?? null,
              chosenPathReason: r.chosenPathReason ?? null,
              confidenceAtStep: r.confidenceAtStep ?? null,
            });
          }
          // Return a thenable so callers can await.
          return Promise.resolve(undefined);
        }
        // Single-row path: returning(...) wrapper.
        return {
          returning: async () => {
            if (throwOnInsert) {
              throw new Error("simulated db failure");
            }
            const created: TraceRow = {
              id: nextTraceId++,
              decisionId: row.decisionId,
              stepNumber: row.stepNumber,
              recordedAt: new Date(),
              stepKind: row.stepKind,
              stepText: row.stepText,
              evidenceRefs: row.evidenceRefs ?? null,
              alternativesConsidered: row.alternativesConsidered ?? null,
              chosenPathReason: row.chosenPathReason ?? null,
              confidenceAtStep: row.confidenceAtStep ?? null,
            };
            TRACE_ROWS.push(created);
            return [{ id: created.id }];
          },
        };
      },
    }),
    select: (projection?: any) => {
      // Detect max-step projection by presence of `maxStep` key.
      if (projection && typeof projection === "object" && "maxStep" in projection) {
        pendingProjection = "max-step";
      } else if (projection && typeof projection === "object" && "id" in projection && Object.keys(projection).length === 1) {
        pendingProjection = "id-only";
      } else {
        pendingProjection = "rows";
      }
      return chain;
    },
  };
}

vi.mock("../../db", () => ({ db: buildDbMock() }));

vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<typeof import("drizzle-orm")>(
    "drizzle-orm",
  );
  return {
    ...actual,
    and: (...preds: unknown[]) => ({ preds }),
    eq: (col: any, val: unknown) => {
      const name =
        typeof col === "object" && col !== null && "name" in col
          ? (col as any).name
          : "unknown";
      return { op: "eq", col: name, val };
    },
    asc: (col: any) => ({ op: "asc", col }),
    desc: (col: any) => ({ op: "desc", col }),
    sql: (() => {
      const tag: any = (_strings: TemplateStringsArray, ..._vals: unknown[]) => ({
        op: "sql",
      });
      return tag;
    })(),
  };
});

vi.mock("@shared/schema/solene-decision-traces", () => ({
  soleneDecisionTraces: {
    __tableName: "traces",
    id: { name: "id" },
    decisionId: { name: "decision_id" },
    stepNumber: { name: "step_number" },
    recordedAt: { name: "recorded_at" },
    stepKind: { name: "step_kind" },
    stepText: { name: "step_text" },
    evidenceRefs: { name: "evidence_refs" },
    alternativesConsidered: { name: "alternatives_considered" },
    chosenPathReason: { name: "chosen_path_reason" },
    confidenceAtStep: { name: "confidence_at_step" },
  },
  DECISION_TRACE_STEP_KINDS: [
    "observation",
    "hypothesis",
    "evidence",
    "alternative",
    "choice",
    "uncertainty",
  ],
  DECISION_TRACE_STEP_TEXT_MAX_CHARS: 2000,
  DECISION_TRACE_TRUNCATION_SUFFIX: "… [truncated]",
}));

vi.mock("@shared/schema/solene-agent-identity", () => ({
  soleneAgentIdentityDecisions: {
    __tableName: "decisions",
    id: { name: "id" },
  },
}));

import {
  addTraceStep,
  addTraceSteps,
  loadTrace,
  renderTraceAsMarkdown,
  getTraceSummary,
} from "./decisionTraces";

beforeEach(() => {
  TRACE_ROWS.length = 0;
  EXISTING_DECISIONS.clear();
  nextTraceId = 1;
  throwOnInsert = false;
});

afterEach(() => {
  vi.clearAllMocks();
});

// ────────────────────────────────────────────────────────────────────────
// addTraceStep
// ────────────────────────────────────────────────────────────────────────

describe("addTraceStep", () => {
  it("happy path: assigns step_number=1 then 2 for the same decisionId", async () => {
    EXISTING_DECISIONS.add(42);

    const first = await addTraceStep({
      decisionId: 42,
      stepKind: "observation",
      stepText: "I see an unhandled exception in the cache layer.",
    });
    expect(first.traceId).toBeGreaterThan(0);
    expect(first.stepNumber).toBe(1);

    const second = await addTraceStep({
      decisionId: 42,
      stepKind: "hypothesis",
      stepText: "TTL is probably unset.",
    });
    expect(second.traceId).toBeGreaterThan(0);
    expect(second.stepNumber).toBe(2);

    expect(TRACE_ROWS).toHaveLength(2);
    expect(TRACE_ROWS[0].decisionId).toBe(42);
    expect(TRACE_ROWS[0].stepKind).toBe("observation");
    expect(TRACE_ROWS[1].stepKind).toBe("hypothesis");
  });

  it("step_number increments per decisionId (not globally)", async () => {
    EXISTING_DECISIONS.add(1);
    EXISTING_DECISIONS.add(2);

    const a1 = await addTraceStep({
      decisionId: 1,
      stepKind: "observation",
      stepText: "a1",
    });
    const b1 = await addTraceStep({
      decisionId: 2,
      stepKind: "observation",
      stepText: "b1",
    });
    const a2 = await addTraceStep({
      decisionId: 1,
      stepKind: "hypothesis",
      stepText: "a2",
    });

    expect(a1.stepNumber).toBe(1);
    expect(b1.stepNumber).toBe(1);
    expect(a2.stepNumber).toBe(2);
  });

  it("returns traceId=-1 + warns when decisionId does not exist", async () => {
    const result = await addTraceStep({
      decisionId: 99999,
      stepKind: "observation",
      stepText: "this should not insert",
    });
    expect(result.traceId).toBe(-1);
    expect(result.stepNumber).toBe(0);
    expect(TRACE_ROWS).toHaveLength(0);
  });

  it("truncates step_text > 2000 chars with `… [truncated]` suffix", async () => {
    EXISTING_DECISIONS.add(1);
    const huge = "x".repeat(2500);
    const result = await addTraceStep({
      decisionId: 1,
      stepKind: "observation",
      stepText: huge,
    });
    expect(result.traceId).toBeGreaterThan(0);
    const stored = TRACE_ROWS[0].stepText;
    expect(stored.length).toBe(2000);
    expect(stored.endsWith("… [truncated]")).toBe(true);
  });

  it("clamps confidenceAtStep > 1 to 1 and < 0 to 0", async () => {
    EXISTING_DECISIONS.add(1);
    await addTraceStep({
      decisionId: 1,
      stepKind: "choice",
      stepText: "way too confident",
      confidenceAtStep: 1.5,
    });
    await addTraceStep({
      decisionId: 1,
      stepKind: "uncertainty",
      stepText: "negative confidence shouldn't exist",
      confidenceAtStep: -0.2,
    });

    expect(TRACE_ROWS[0].confidenceAtStep).toBe("1");
    expect(TRACE_ROWS[1].confidenceAtStep).toBe("0");
  });

  it("preserves valid confidence in range", async () => {
    EXISTING_DECISIONS.add(1);
    await addTraceStep({
      decisionId: 1,
      stepKind: "choice",
      stepText: "well calibrated",
      confidenceAtStep: 0.85,
    });
    expect(TRACE_ROWS[0].confidenceAtStep).toBe("0.85");
  });

  it("skips unknown stepKind with warn", async () => {
    EXISTING_DECISIONS.add(1);
    const result = await addTraceStep({
      decisionId: 1,
      stepKind: "ghost" as any,
      stepText: "what is this",
    });
    expect(result.traceId).toBe(-1);
    expect(TRACE_ROWS).toHaveLength(0);
  });

  it("allows chosenPathReason on non-choice steps but warns", async () => {
    EXISTING_DECISIONS.add(1);
    const result = await addTraceStep({
      decisionId: 1,
      stepKind: "observation",
      stepText: "looking around",
      chosenPathReason: "this shouldn't really be set here",
    });
    expect(result.traceId).toBeGreaterThan(0);
    expect(TRACE_ROWS[0].chosenPathReason).toBe(
      "this shouldn't really be set here",
    );
  });

  it("never throws on db failure", async () => {
    EXISTING_DECISIONS.add(1);
    throwOnInsert = true;
    const result = await addTraceStep({
      decisionId: 1,
      stepKind: "observation",
      stepText: "this insert blows up",
    });
    expect(result.traceId).toBe(-1);
  });
});

// ────────────────────────────────────────────────────────────────────────
// loadTrace
// ────────────────────────────────────────────────────────────────────────

describe("loadTrace", () => {
  it("returns steps in step_number ascending order", async () => {
    EXISTING_DECISIONS.add(7);
    await addTraceStep({
      decisionId: 7,
      stepKind: "observation",
      stepText: "step one",
    });
    await addTraceStep({
      decisionId: 7,
      stepKind: "hypothesis",
      stepText: "step two",
    });
    await addTraceStep({
      decisionId: 7,
      stepKind: "choice",
      stepText: "step three",
    });

    const trace = await loadTrace(7);
    expect(trace).toHaveLength(3);
    expect(trace[0].stepNumber).toBe(1);
    expect(trace[1].stepNumber).toBe(2);
    expect(trace[2].stepNumber).toBe(3);
    expect(trace[0].stepText).toBe("step one");
    expect(trace[2].stepText).toBe("step three");
  });

  it("returns empty array (not null) when no steps recorded", async () => {
    const trace = await loadTrace(999);
    expect(trace).toEqual([]);
    expect(Array.isArray(trace)).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────
// addTraceSteps
// ────────────────────────────────────────────────────────────────────────

describe("addTraceSteps", () => {
  it("bulk-inserts multiple steps in order", async () => {
    EXISTING_DECISIONS.add(5);
    const result = await addTraceSteps(5, [
      { stepKind: "observation", stepText: "a" },
      { stepKind: "hypothesis", stepText: "b" },
      { stepKind: "evidence", stepText: "c" },
      { stepKind: "choice", stepText: "d" },
    ]);
    expect(result.stepsAdded).toBe(4);
    expect(result.firstStepNumber).toBe(1);
    expect(result.lastStepNumber).toBe(4);

    const trace = await loadTrace(5);
    expect(trace).toHaveLength(4);
    expect(trace.map((r) => r.stepText)).toEqual(["a", "b", "c", "d"]);
    expect(trace.map((r) => r.stepNumber)).toEqual([1, 2, 3, 4]);
  });

  it("continues numbering after pre-existing steps", async () => {
    EXISTING_DECISIONS.add(5);
    await addTraceStep({
      decisionId: 5,
      stepKind: "observation",
      stepText: "pre-existing",
    });

    const result = await addTraceSteps(5, [
      { stepKind: "hypothesis", stepText: "x" },
      { stepKind: "choice", stepText: "y" },
    ]);
    expect(result.firstStepNumber).toBe(2);
    expect(result.lastStepNumber).toBe(3);
  });

  it("returns zeroes when decisionId does not exist", async () => {
    const result = await addTraceSteps(404, [
      { stepKind: "observation", stepText: "nope" },
    ]);
    expect(result).toEqual({
      stepsAdded: 0,
      firstStepNumber: 0,
      lastStepNumber: 0,
    });
    expect(TRACE_ROWS).toHaveLength(0);
  });

  it("returns zeroes on empty steps array", async () => {
    EXISTING_DECISIONS.add(5);
    const result = await addTraceSteps(5, []);
    expect(result.stepsAdded).toBe(0);
    expect(result.firstStepNumber).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────
// renderTraceAsMarkdown
// ────────────────────────────────────────────────────────────────────────

describe("renderTraceAsMarkdown", () => {
  it("renders header + 'No trace recorded.' when empty", async () => {
    const md = await renderTraceAsMarkdown(123);
    expect(md).toContain("# Decision trace — #123");
    expect(md).toContain("_No trace recorded._");
  });

  it("renders all four step types with evidence + alternatives + confidence + chosen", async () => {
    EXISTING_DECISIONS.add(11);
    await addTraceSteps(11, [
      {
        stepKind: "observation",
        stepText: "Cache misses spiked at 14:02.",
        evidenceRefs: ["logs/cache.log:482", "https://example.com/dashboard"],
        confidenceAtStep: 0.8,
      },
      {
        stepKind: "hypothesis",
        stepText: "The TTL config got dropped in the last deploy.",
      },
      {
        stepKind: "alternative",
        stepText: "Could also be a downstream rate-limit collapse.",
        alternativesConsidered: [
          "TTL config regression",
          "downstream rate-limit",
          "process restart loop",
        ],
        confidenceAtStep: 0.4,
      },
      {
        stepKind: "choice",
        stepText: "Patching the TTL config.",
        chosenPathReason: "git blame shows the line was removed in v591.",
        confidenceAtStep: 0.85,
      },
    ]);

    const md = await renderTraceAsMarkdown(11);

    // Header.
    expect(md).toContain("# Decision trace — #11");
    // Step headers + confidence formatting.
    expect(md).toContain("## Step 1: observation (confidence: 0.80)");
    expect(md).toContain("## Step 2: hypothesis");
    expect(md).toContain("## Step 3: alternative (confidence: 0.40)");
    expect(md).toContain("## Step 4: choice (confidence: 0.85)");
    // Body text.
    expect(md).toContain("Cache misses spiked at 14:02.");
    expect(md).toContain("Patching the TTL config.");
    // Evidence section.
    expect(md).toContain("**Evidence:**");
    expect(md).toContain("- logs/cache.log:482");
    expect(md).toContain("- https://example.com/dashboard");
    // Alternatives section.
    expect(md).toContain("**Alternatives on the table:**");
    expect(md).toContain("- TTL config regression");
    expect(md).toContain("- downstream rate-limit");
    // Chosen-because (only on choice).
    expect(md).toContain(
      "**Chosen because:** git blame shows the line was removed in v591.",
    );
    // Step ordering preserved.
    const idxObs = md.indexOf("## Step 1");
    const idxHyp = md.indexOf("## Step 2");
    const idxAlt = md.indexOf("## Step 3");
    const idxCho = md.indexOf("## Step 4");
    expect(idxObs).toBeGreaterThanOrEqual(0);
    expect(idxHyp).toBeGreaterThan(idxObs);
    expect(idxAlt).toBeGreaterThan(idxHyp);
    expect(idxCho).toBeGreaterThan(idxAlt);
  });

  it("skips optional sections when their data is empty/null", async () => {
    EXISTING_DECISIONS.add(12);
    await addTraceStep({
      decisionId: 12,
      stepKind: "hypothesis",
      stepText: "bare-bones step",
    });
    const md = await renderTraceAsMarkdown(12);
    expect(md).not.toContain("**Evidence:**");
    expect(md).not.toContain("**Alternatives on the table:**");
    expect(md).not.toContain("**Chosen because:**");
    // No confidence parenthetical when not set.
    expect(md).toContain("## Step 1: hypothesis");
    expect(md).not.toMatch(/## Step 1: hypothesis \(confidence:/);
  });
});

// ────────────────────────────────────────────────────────────────────────
// getTraceSummary
// ────────────────────────────────────────────────────────────────────────

describe("getTraceSummary", () => {
  it("returns zeros + empty breakdown when no steps", async () => {
    const summary = await getTraceSummary(404);
    expect(summary.stepCount).toBe(0);
    expect(summary.averageConfidence).toBeNull();
    expect(summary.hasUncertaintyMarkers).toBe(false);
    expect(summary.kindBreakdown.observation).toBe(0);
    expect(summary.kindBreakdown.uncertainty).toBe(0);
  });

  it("counts kinds + averages confidence + detects uncertainty markers", async () => {
    EXISTING_DECISIONS.add(20);
    await addTraceSteps(20, [
      { stepKind: "observation", stepText: "o1", confidenceAtStep: 0.6 },
      { stepKind: "observation", stepText: "o2", confidenceAtStep: 0.8 },
      { stepKind: "hypothesis", stepText: "h1" }, // null confidence
      { stepKind: "uncertainty", stepText: "u1", confidenceAtStep: 0.4 },
      { stepKind: "choice", stepText: "c1", confidenceAtStep: 0.9 },
    ]);

    const summary = await getTraceSummary(20);
    expect(summary.stepCount).toBe(5);
    expect(summary.kindBreakdown.observation).toBe(2);
    expect(summary.kindBreakdown.hypothesis).toBe(1);
    expect(summary.kindBreakdown.uncertainty).toBe(1);
    expect(summary.kindBreakdown.choice).toBe(1);
    expect(summary.kindBreakdown.evidence).toBe(0);
    expect(summary.kindBreakdown.alternative).toBe(0);
    expect(summary.hasUncertaintyMarkers).toBe(true);

    // Average excludes the null-confidence hypothesis row.
    // (0.6 + 0.8 + 0.4 + 0.9) / 4 = 0.675
    expect(summary.averageConfidence).not.toBeNull();
    expect(summary.averageConfidence!).toBeCloseTo(0.675, 4);
  });

  it("hasUncertaintyMarkers=false when no uncertainty rows", async () => {
    EXISTING_DECISIONS.add(21);
    await addTraceSteps(21, [
      { stepKind: "observation", stepText: "o" },
      { stepKind: "choice", stepText: "c" },
    ]);
    const summary = await getTraceSummary(21);
    expect(summary.hasUncertaintyMarkers).toBe(false);
  });

  it("averageConfidence is null when no rows have confidence set", async () => {
    EXISTING_DECISIONS.add(22);
    await addTraceSteps(22, [
      { stepKind: "observation", stepText: "o" },
      { stepKind: "hypothesis", stepText: "h" },
    ]);
    const summary = await getTraceSummary(22);
    expect(summary.averageConfidence).toBeNull();
    expect(summary.stepCount).toBe(2);
  });
});
