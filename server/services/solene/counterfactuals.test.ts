/**
 * Tests for the Solene counterfactual-reasoning service (Phase B L4.21).
 *
 * Coverage:
 *  - recordCounterfactual happy path → returns positive id
 *  - recordCounterfactual confidence out of [0,1] → clamps + warn
 *  - recordCounterfactual rejects invalid sourceDecisionId / agent role / empty text
 *  - listCounterfactualsForDecision returns all rows for a decision
 *  - getCounterfactual returns single row or null
 *  - buildCounterfactualPrompt includes all 5 input fields
 *  - summarizeLessons skips rows with null lesson_learned
 *  - summarizeLessons computes correct percentage average confidence
 *  - aggregateConfidence weighted by row count (simple mean)
 *  - aggregateConfidence treats missing/non-numeric confidence as excluded
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

interface CfRow {
  id: number;
  analyzedAt: Date;
  sourceDecisionId: number;
  analyzingAgentRole: string;
  alternativePath: string;
  alternativeRationale: string;
  predictedOutcome: string;
  comparisonToActual: string;
  lessonLearned: string | null;
  confidence: string | null;
}

const CF_ROWS: CfRow[] = [];
let nextCfId = 1;
let throwOnInsert = false;

interface PredInfo {
  sourceDecisionIdEq?: number;
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
        if (node.col === "source_decision_id") info.sourceDecisionIdEq = node.val;
        else if (node.col === "id") info.idEq = node.val;
      } else if (Array.isArray(node.preds)) {
        for (const c of node.preds) walk(c);
      }
    }
  }
}

function buildDbMock() {
  let pendingSourceEq: number | undefined;
  let pendingIdEq: number | undefined;
  let pendingOrderAsc = false;
  let pendingLimit: number | undefined;

  const reset = () => {
    pendingSourceEq = undefined;
    pendingIdEq = undefined;
    pendingOrderAsc = false;
    pendingLimit = undefined;
  };

  const chain: any = {
    from(_table: any) {
      return chain;
    },
    where(pred: any) {
      const info = parseWhere(pred);
      pendingSourceEq = info.sourceDecisionIdEq;
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
      let rows = [...CF_ROWS];
      if (pendingSourceEq !== undefined) {
        rows = rows.filter((r) => r.sourceDecisionId === pendingSourceEq);
      }
      if (pendingIdEq !== undefined) {
        rows = rows.filter((r) => r.id === pendingIdEq);
      }
      if (pendingOrderAsc) {
        rows.sort((a, b) => a.analyzedAt.getTime() - b.analyzedAt.getTime());
      }
      if (pendingLimit !== undefined) rows = rows.slice(0, pendingLimit);
      reset();
      return Promise.resolve(rows).then(onFulfilled, onRejected);
    },
  };

  return {
    insert: (_table: any) => ({
      values: (row: any) => ({
        returning: async () => {
          if (throwOnInsert) {
            throw new Error("simulated db failure");
          }
          const created: CfRow = {
            id: nextCfId++,
            analyzedAt: new Date(),
            sourceDecisionId: row.sourceDecisionId,
            analyzingAgentRole: row.analyzingAgentRole,
            alternativePath: row.alternativePath,
            alternativeRationale: row.alternativeRationale,
            predictedOutcome: row.predictedOutcome,
            comparisonToActual: row.comparisonToActual,
            lessonLearned: row.lessonLearned ?? null,
            confidence: row.confidence ?? null,
          };
          CF_ROWS.push(created);
          return [{ id: created.id }];
        },
      }),
    }),
    select: (_projection?: any) => chain,
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
  };
});

vi.mock("@shared/schema/solene-counterfactuals", () => ({
  soleneCounterfactualAnalyses: {
    __tableName: "counterfactuals",
    id: { name: "id" },
    sourceDecisionId: { name: "source_decision_id" },
    analyzingAgentRole: { name: "analyzing_agent_role" },
    analyzedAt: { name: "analyzed_at" },
  },
}));

vi.mock("@shared/schema/solene-dispatch", () => ({
  DISPATCH_AGENT_ROLES: [
    "iris",
    "soren",
    "beatrice",
    "krieger",
    "general-purpose",
    "code-reviewer",
  ],
}));

import {
  recordCounterfactual,
  listCounterfactualsForDecision,
  getCounterfactual,
  buildCounterfactualPrompt,
  summarizeLessons,
  aggregateConfidence,
  type CounterfactualRow,
} from "./counterfactuals";

beforeEach(() => {
  CF_ROWS.length = 0;
  nextCfId = 1;
  throwOnInsert = false;
});

afterEach(() => {
  vi.clearAllMocks();
});

// ────────────────────────────────────────────────────────────────────────
// recordCounterfactual
// ────────────────────────────────────────────────────────────────────────

const validInput = {
  sourceDecisionId: 42,
  analyzingAgentRole: "iris" as const,
  alternativePath: "Used a queue instead of inline writes.",
  alternativeRationale: "Queue would have absorbed the burst.",
  predictedOutcome: "Tail latency would have stayed flat.",
  comparisonToActual: "Actually we got 5s p99 spikes.",
  lessonLearned: "Buffer load-bearing writes when ingress is bursty.",
  confidence: 0.7,
};

describe("recordCounterfactual", () => {
  it("happy path: persists a row and returns positive id", async () => {
    const result = await recordCounterfactual({ ...validInput });
    expect(result.counterfactualId).toBeGreaterThan(0);
    expect(CF_ROWS).toHaveLength(1);
    expect(CF_ROWS[0].sourceDecisionId).toBe(42);
    expect(CF_ROWS[0].analyzingAgentRole).toBe("iris");
    expect(CF_ROWS[0].alternativePath).toBe(validInput.alternativePath);
    expect(CF_ROWS[0].lessonLearned).toBe(validInput.lessonLearned);
    expect(CF_ROWS[0].confidence).toBe("0.7");
  });

  it("clamps confidence > 1 to 1 and warns", async () => {
    await recordCounterfactual({ ...validInput, confidence: 1.5 });
    expect(CF_ROWS[0].confidence).toBe("1");
  });

  it("clamps confidence < 0 to 0 and warns", async () => {
    await recordCounterfactual({ ...validInput, confidence: -0.4 });
    expect(CF_ROWS[0].confidence).toBe("0");
  });

  it("rejects invalid sourceDecisionId", async () => {
    const result = await recordCounterfactual({
      ...validInput,
      sourceDecisionId: 0,
    });
    expect(result.counterfactualId).toBe(-1);
    expect(CF_ROWS).toHaveLength(0);
  });

  it("rejects unknown analyzingAgentRole", async () => {
    const result = await recordCounterfactual({
      ...validInput,
      analyzingAgentRole: "ghost" as any,
    });
    expect(result.counterfactualId).toBe(-1);
    expect(CF_ROWS).toHaveLength(0);
  });

  it("rejects empty alternativePath", async () => {
    const result = await recordCounterfactual({
      ...validInput,
      alternativePath: "   ",
    });
    expect(result.counterfactualId).toBe(-1);
    expect(CF_ROWS).toHaveLength(0);
  });

  it("persists lessonLearned=null when omitted", async () => {
    const { lessonLearned: _lessonLearned, ...rest } = validInput;
    void _lessonLearned;
    await recordCounterfactual(rest);
    expect(CF_ROWS[0].lessonLearned).toBeNull();
  });

  it("never throws on db failure", async () => {
    throwOnInsert = true;
    const result = await recordCounterfactual({ ...validInput });
    expect(result.counterfactualId).toBe(-1);
  });
});

// ────────────────────────────────────────────────────────────────────────
// listCounterfactualsForDecision
// ────────────────────────────────────────────────────────────────────────

describe("listCounterfactualsForDecision", () => {
  it("returns all rows for a given decision", async () => {
    await recordCounterfactual({ ...validInput, sourceDecisionId: 5 });
    await recordCounterfactual({
      ...validInput,
      sourceDecisionId: 5,
      alternativePath: "different alt",
    });
    await recordCounterfactual({ ...validInput, sourceDecisionId: 9 });

    const list = await listCounterfactualsForDecision(5);
    expect(list).toHaveLength(2);
    for (const r of list) {
      expect(r.sourceDecisionId).toBe(5);
    }
  });

  it("returns empty array when no rows exist", async () => {
    const list = await listCounterfactualsForDecision(999);
    expect(list).toEqual([]);
    expect(Array.isArray(list)).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────
// getCounterfactual
// ────────────────────────────────────────────────────────────────────────

describe("getCounterfactual", () => {
  it("returns the row by id", async () => {
    const { counterfactualId } = await recordCounterfactual({ ...validInput });
    const row = await getCounterfactual(counterfactualId);
    expect(row).not.toBeNull();
    expect(row?.id).toBe(counterfactualId);
    expect(row?.alternativePath).toBe(validInput.alternativePath);
  });

  it("returns null when not found", async () => {
    const row = await getCounterfactual(404);
    expect(row).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────
// buildCounterfactualPrompt
// ────────────────────────────────────────────────────────────────────────

describe("buildCounterfactualPrompt", () => {
  it("includes all five input fields", () => {
    const prompt = buildCounterfactualPrompt({
      sourceDecisionId: 17,
      decisionSummary: "Chose synchronous inline writes over a queue.",
      decisionRationale: "Simpler ops surface, didn't expect burst traffic.",
      decisionKind: "architectural",
      decisionReferencedFiles: [
        "server/services/ingest.ts",
        "shared/schema/events.ts",
      ],
      actualOutcomeNotes: "p99 latency spiked to 5s under load.",
    });

    expect(prompt).toContain("decision #17");
    expect(prompt).toContain("architectural");
    expect(prompt).toContain("Chose synchronous inline writes over a queue.");
    expect(prompt).toContain(
      "Simpler ops surface, didn't expect burst traffic.",
    );
    expect(prompt).toContain("server/services/ingest.ts");
    expect(prompt).toContain("shared/schema/events.ts");
    expect(prompt).toContain("p99 latency spiked to 5s under load.");
    // Structured output instructions present.
    expect(prompt).toContain("ALTERNATIVE 1:");
    expect(prompt).toContain("recordCounterfactual");
  });

  it("handles empty referenced files + missing actual outcome", () => {
    const prompt = buildCounterfactualPrompt({
      sourceDecisionId: 1,
      decisionSummary: "s",
      decisionRationale: "r",
      decisionKind: "k",
      decisionReferencedFiles: [],
    });
    expect(prompt).toContain("(no referenced files recorded)");
    expect(prompt).toContain(
      "(no actual-outcome notes recorded — your comparison will be speculative)",
    );
  });
});

// ────────────────────────────────────────────────────────────────────────
// summarizeLessons
// ────────────────────────────────────────────────────────────────────────

function makeRow(overrides: Partial<CounterfactualRow>): CounterfactualRow {
  return {
    id: 0,
    analyzedAt: new Date("2026-06-03T00:00:00Z"),
    sourceDecisionId: 1,
    analyzingAgentRole: "iris",
    alternativePath: "p",
    alternativeRationale: "r",
    predictedOutcome: "p",
    comparisonToActual: "c",
    lessonLearned: null,
    confidence: null,
    ...overrides,
  } as unknown as CounterfactualRow;
}

describe("summarizeLessons", () => {
  it("skips rows with null lesson_learned but counts them in total", () => {
    const rows: CounterfactualRow[] = [
      makeRow({
        id: 1,
        sourceDecisionId: 5,
        lessonLearned: "Buffer bursty writes.",
        confidence: "0.8",
      }),
      makeRow({
        id: 2,
        sourceDecisionId: 5,
        lessonLearned: null,
        confidence: "0.6",
      }),
      makeRow({
        id: 3,
        sourceDecisionId: 8,
        lessonLearned: "Cache TTL must be explicit.",
        confidence: "0.7",
      }),
    ];

    const md = summarizeLessons(rows);

    expect(md).toContain("## Counterfactual lessons (3 analyses)");
    expect(md).toContain("**Alternative paths examined:** 3");
    expect(md).toContain("(decision #5) Lesson: Buffer bursty writes.");
    expect(md).toContain(
      "(decision #8) Lesson: Cache TTL must be explicit.",
    );
    // The null-lesson row is omitted from the bullet list.
    const bulletLines = md
      .split("\n")
      .filter((l) => l.startsWith("- (decision #"));
    expect(bulletLines).toHaveLength(2);
  });

  it("computes correct percentage average confidence (rounded)", () => {
    const rows: CounterfactualRow[] = [
      makeRow({ id: 1, confidence: "0.8" }),
      makeRow({ id: 2, confidence: "0.6" }),
      makeRow({ id: 3, confidence: "0.7" }),
    ];
    // avg = 0.7 → 70%
    const md = summarizeLessons(rows);
    expect(md).toContain("**Average confidence in counterfactuals:** 70%");
  });

  it("renders zero counts cleanly when given no rows", () => {
    const md = summarizeLessons([]);
    expect(md).toContain("## Counterfactual lessons (0 analyses)");
    expect(md).toContain("**Alternative paths examined:** 0");
    expect(md).toContain("**Average confidence in counterfactuals:** 0%");
  });
});

// ────────────────────────────────────────────────────────────────────────
// aggregateConfidence
// ────────────────────────────────────────────────────────────────────────

describe("aggregateConfidence", () => {
  it("returns simple mean across non-null confidences", () => {
    const rows: CounterfactualRow[] = [
      makeRow({ confidence: "0.8" }),
      makeRow({ confidence: "0.6" }),
      makeRow({ confidence: "0.4" }),
    ];
    expect(aggregateConfidence(rows)).toBeCloseTo(0.6, 10);
  });

  it("excludes null / non-numeric confidences from the average", () => {
    const rows: CounterfactualRow[] = [
      makeRow({ confidence: "0.9" }),
      makeRow({ confidence: null }),
      makeRow({ confidence: "0.5" }),
    ];
    // mean of [0.9, 0.5] = 0.7
    expect(aggregateConfidence(rows)).toBeCloseTo(0.7, 10);
  });

  it("returns 0 on empty input", () => {
    expect(aggregateConfidence([])).toBe(0);
  });

  it("returns 0 when every row's confidence is null", () => {
    const rows: CounterfactualRow[] = [
      makeRow({ confidence: null }),
      makeRow({ confidence: null }),
    ];
    expect(aggregateConfidence(rows)).toBe(0);
  });
});
