/**
 * Tests for tokenEconomyScorer (L5.27).
 *
 * Coverage:
 *  - Cost calculation correctness at known token counts.
 *  - Historical success rate defaults to 0.80 with no data.
 *  - Envelope-weight applied for all three statuses (green/amber/red).
 *  - Per-role default values applied when expectedValue not provided.
 *  - Recommendation boundaries: 0.59 → defer, 0.61 → proceed, 0.29 → reject.
 *  - Persistence: row written with correct shape.
 *  - Persistence failure does NOT throw.
 *  - listRecentScores ordering + limit.
 *  - getDailyScoringSummary math correctness.
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

// ----------------------------------------------------------------------------
// Shared in-memory state for the mocked DB. Each test resets via beforeEach.
// ----------------------------------------------------------------------------

interface ScoreEventRow {
  id: number;
  scoredAt: Date;
  dispatchId: number | null;
  agentRole: string;
  promptSummary: string;
  estimatedCostUsd: string;
  estimatedValueUsd: string | null;
  historicalSuccessRate: string;
  envelopeStatusAtDecision: string;
  score: string;
  recommendation: string;
  rationale: string;
}

const SCORE_EVENTS: ScoreEventRow[] = [];
let nextScoreEventId = 1;
let throwOnScoreInsert = false;

// Historical dispatch-results query result (passed/total). Tests override
// this to drive the historical-success-rate branch.
let HISTORICAL_RESULT: { total: number; passed: number } = { total: 0, passed: 0 };

// Envelope status returned by the mocked capitalTracker. Tests override.
let ENVELOPE_STATUS: "green" | "amber" | "red" = "green";

vi.mock("./capitalTracker", () => ({
  getMonthlyEnvelopeStatus: vi.fn(async () => ({
    envelopeUsd: 50,
    monthToDateUsd: 0,
    percentUsed: 0,
    daysIntoMonth: 1,
    projectedMonthlyUsd: 0,
    status: ENVELOPE_STATUS,
  })),
}));

// Tag the mocked drizzle tables so the db mock can identify them by identity.
// vi.hoisted hoists this declaration alongside the vi.mock calls so the
// identity-tagged sentinels are available inside the mock factories.
const { SCORE_EVENTS_TABLE, DISPATCH_RESULTS_TABLE, DISPATCH_QUEUE_TABLE } =
  vi.hoisted(() => ({
    SCORE_EVENTS_TABLE: { __testTable: "score_events" },
    DISPATCH_RESULTS_TABLE: { __testTable: "dispatch_results" },
    DISPATCH_QUEUE_TABLE: { __testTable: "dispatch_queue" },
  }));

vi.mock("@shared/schema/solene-token-economy", async () => {
  const actual = await vi.importActual<
    typeof import("@shared/schema/solene-token-economy")
  >("@shared/schema/solene-token-economy");
  return {
    ...actual,
    soleneDecisionScoreEvents: SCORE_EVENTS_TABLE,
  };
});

vi.mock("@shared/schema/solene-dispatch", async () => {
  const actual = await vi.importActual<
    typeof import("@shared/schema/solene-dispatch")
  >("@shared/schema/solene-dispatch");
  return {
    ...actual,
    soleneDispatchResults: DISPATCH_RESULTS_TABLE,
    soleneDispatchQueue: DISPATCH_QUEUE_TABLE,
  };
});

vi.mock("../../db", () => {
  const db = {
    insert: (table: any) => ({
      values: (row: any) => {
        if (table === SCORE_EVENTS_TABLE) {
          if (throwOnScoreInsert) {
            return Promise.reject(new Error("simulated db failure"));
          }
          SCORE_EVENTS.push({
            id: nextScoreEventId++,
            scoredAt: row.scoredAt ?? new Date(),
            dispatchId: row.dispatchId ?? null,
            agentRole: row.agentRole,
            promptSummary: row.promptSummary,
            estimatedCostUsd: String(row.estimatedCostUsd),
            estimatedValueUsd:
              row.estimatedValueUsd === null ||
              row.estimatedValueUsd === undefined
                ? null
                : String(row.estimatedValueUsd),
            historicalSuccessRate: String(row.historicalSuccessRate),
            envelopeStatusAtDecision: row.envelopeStatusAtDecision,
            score: String(row.score),
            recommendation: row.recommendation,
            rationale: row.rationale,
          });
        }
        return Promise.resolve();
      },
    }),
    select: (_projection?: any) => {
      // Two distinct shapes:
      //   (a) historical success rate — `.from(soleneDispatchResults).innerJoin(...).where(...)`
      //       Terminating await yields [{ total, passed }].
      //   (b) listRecentScores / getDailyScoringSummary — `.from(soleneDecisionScoreEvents)...`
      //       Terminating await yields ScoreEventRow[].
      const step: any = {
        _kind: "unknown",
        _limit: undefined as number | undefined,
        _filterFn: undefined as ((r: ScoreEventRow) => boolean) | undefined,
        _orderDesc: false,
        from(table: any) {
          if (table === DISPATCH_RESULTS_TABLE) step._kind = "historical";
          else if (table === SCORE_EVENTS_TABLE) step._kind = "score_events";
          return step;
        },
        innerJoin(_t: any, _on: any) {
          return step;
        },
        where(pred: any) {
          // For score_events queries (daily-summary), pred is an object with
          // .val: Date; for historical (and-chain), pred is an array of preds.
          if (step._kind === "score_events" && pred && pred.val instanceof Date) {
            const cutoff = pred.val;
            step._filterFn = (r: ScoreEventRow) => r.scoredAt >= cutoff;
          }
          return step;
        },
        orderBy(_o: any) {
          step._orderDesc = true;
          return step;
        },
        limit(n: number) {
          step._limit = n;
          return step;
        },
        then(onFulfilled: any, onRejected: any) {
          if (step._kind === "historical") {
            return Promise.resolve([
              { total: HISTORICAL_RESULT.total, passed: HISTORICAL_RESULT.passed },
            ]).then(onFulfilled, onRejected);
          }
          if (step._kind === "score_events") {
            let rows = SCORE_EVENTS.slice();
            if (step._filterFn) rows = rows.filter(step._filterFn);
            if (step._orderDesc) {
              rows.sort((a, b) => b.scoredAt.getTime() - a.scoredAt.getTime());
            }
            if (typeof step._limit === "number") rows = rows.slice(0, step._limit);
            return Promise.resolve(rows).then(onFulfilled, onRejected);
          }
          return Promise.resolve([]).then(onFulfilled, onRejected);
        },
      };
      return step;
    },
  };
  return { db };
});

vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
  return {
    ...actual,
    and: (...preds: unknown[]) => preds,
    eq: (col: unknown, val: unknown) => ({ op: "eq", col, val }),
    gte: (col: unknown, val: unknown) => ({ op: "gte", col, val }),
    desc: (col: unknown) => ({ op: "desc", col }),
    sql: (() => {
      const tag: any = (_strings: TemplateStringsArray, ..._vals: unknown[]) => ({
        op: "sql",
      });
      return tag;
    })(),
  };
});

import {
  scoreDispatchProposal,
  listRecentScores,
  getDailyScoringSummary,
} from "./tokenEconomyScorer";
import {
  DECISION_SCORE_THRESHOLDS,
  ENVELOPE_WEIGHTS,
  PER_ROLE_DEFAULT_VALUE_USD,
  DEFAULT_HISTORICAL_SUCCESS_RATE,
} from "@shared/schema/solene-token-economy";

beforeEach(() => {
  SCORE_EVENTS.length = 0;
  nextScoreEventId = 1;
  throwOnScoreInsert = false;
  HISTORICAL_RESULT = { total: 0, passed: 0 };
  ENVELOPE_STATUS = "green";
  // Use known prices for cost-math assertions.
  process.env.SOLENE_DISPATCH_PRICE_INPUT_PER_M = "15";
  process.env.SOLENE_DISPATCH_PRICE_OUTPUT_PER_M = "75";
});

afterEach(() => {
  vi.clearAllMocks();
});

// ────────────────────────────────────────────────────────────────────────────
// Cost-calculation correctness
// ────────────────────────────────────────────────────────────────────────────

describe("scoreDispatchProposal — cost calculation", () => {
  it("computes cost at known token counts (1M in + 1M out → $3 + $15 = $18)", async () => {
    // Sonnet dispatch-default pricing — corrected 2026-07-08 from the
    // pre-4.6 Opus $15/$75 the scorer wrongly carried.
    const result = await scoreDispatchProposal({
      agentRole: "iris",
      promptText: "test",
      estimatedTokens: { input: 1_000_000, output: 1_000_000 },
      expectedValueUsd: 100,
    });
    expect(result.estimatedCostUsd).toBeCloseTo(18, 4);
  });

  it("handles fractional millions (500k in + 200k out)", async () => {
    const result = await scoreDispatchProposal({
      agentRole: "iris",
      promptText: "test",
      estimatedTokens: { input: 500_000, output: 200_000 },
      expectedValueUsd: 100,
    });
    // 0.5 * 3 + 0.2 * 15 = 1.5 + 3 = 4.5 (Sonnet dispatch-default pricing)
    expect(result.estimatedCostUsd).toBeCloseTo(4.5, 4);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Historical success rate default
// ────────────────────────────────────────────────────────────────────────────

describe("scoreDispatchProposal — historical success rate", () => {
  it("defaults to 0.80 with no history for the role", async () => {
    HISTORICAL_RESULT = { total: 0, passed: 0 };
    const result = await scoreDispatchProposal({
      agentRole: "iris",
      promptText: "test",
      estimatedTokens: { input: 1000, output: 1000 },
      expectedValueUsd: 100,
    });
    expect(result.historicalSuccessRate).toBeCloseTo(
      DEFAULT_HISTORICAL_SUCCESS_RATE,
      4,
    );
  });

  it("computes passed/total when history exists", async () => {
    HISTORICAL_RESULT = { total: 10, passed: 7 };
    const result = await scoreDispatchProposal({
      agentRole: "iris",
      promptText: "test",
      estimatedTokens: { input: 1000, output: 1000 },
      expectedValueUsd: 100,
    });
    expect(result.historicalSuccessRate).toBeCloseTo(0.7, 4);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Envelope weight applied
// ────────────────────────────────────────────────────────────────────────────

describe("scoreDispatchProposal — envelope weighting", () => {
  it("applies green weight 1.0 (no penalty)", async () => {
    ENVELOPE_STATUS = "green";
    const result = await scoreDispatchProposal({
      agentRole: "iris",
      promptText: "test",
      estimatedTokens: { input: 1000, output: 1000 },
      expectedValueUsd: 100,
    });
    expect(result.envelopeStatus).toBe("green");
    // value 100 * success 0.8 * weight 1.0 / max(cost, 0.01) >> 1 → clamps to 1
    expect(result.score).toBeCloseTo(1, 4);
  });

  it("applies amber weight 0.7", async () => {
    ENVELOPE_STATUS = "amber";
    const result = await scoreDispatchProposal({
      agentRole: "iris",
      promptText: "test",
      // Set tokens so cost is meaningful relative to value (1M+1M = $18 at
      // the corrected Sonnet pricing; value 10 keeps the score unclamped).
      estimatedTokens: { input: 1_000_000, output: 1_000_000 }, // $18
      expectedValueUsd: 10,
    });
    expect(result.envelopeStatus).toBe("amber");
    // 10 * 0.8 * 0.7 / 18 = 0.3111...
    expect(result.score).toBeCloseTo((10 * 0.8 * 0.7) / 18, 3);
  });

  it("applies red weight 0.4 (severe penalty)", async () => {
    ENVELOPE_STATUS = "red";
    const result = await scoreDispatchProposal({
      agentRole: "iris",
      promptText: "test",
      estimatedTokens: { input: 1_000_000, output: 1_000_000 }, // $18
      expectedValueUsd: 10,
    });
    expect(result.envelopeStatus).toBe("red");
    expect(result.score).toBeCloseTo((10 * 0.8 * 0.4) / 18, 3);
  });

  it("ENVELOPE_WEIGHTS constants reflect the documented map", () => {
    expect(ENVELOPE_WEIGHTS.green).toBe(1.0);
    expect(ENVELOPE_WEIGHTS.amber).toBe(0.7);
    expect(ENVELOPE_WEIGHTS.red).toBe(0.4);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Per-role default value
// ────────────────────────────────────────────────────────────────────────────

describe("scoreDispatchProposal — per-role default value", () => {
  it("uses caller-provided expectedValueUsd when given", async () => {
    const result = await scoreDispatchProposal({
      agentRole: "iris",
      promptText: "test",
      estimatedTokens: { input: 1000, output: 1000 },
      expectedValueUsd: 200,
    });
    expect(result.estimatedValueUsd).toBe(200);
  });

  it("applies per-role default when expectedValueUsd is omitted", async () => {
    const result = await scoreDispatchProposal({
      agentRole: "beatrice",
      promptText: "test",
      estimatedTokens: { input: 1000, output: 1000 },
    });
    expect(result.estimatedValueUsd).toBe(PER_ROLE_DEFAULT_VALUE_USD.beatrice);
    expect(result.estimatedValueUsd).toBe(40);
  });

  it("PER_ROLE_DEFAULT_VALUE_USD reflects documented defaults", () => {
    expect(PER_ROLE_DEFAULT_VALUE_USD.iris).toBe(50);
    expect(PER_ROLE_DEFAULT_VALUE_USD.beatrice).toBe(40);
    expect(PER_ROLE_DEFAULT_VALUE_USD.soren).toBe(30);
    expect(PER_ROLE_DEFAULT_VALUE_USD.krieger).toBe(25);
    expect(PER_ROLE_DEFAULT_VALUE_USD["code-reviewer"]).toBe(15);
    expect(PER_ROLE_DEFAULT_VALUE_USD["general-purpose"]).toBe(20);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Recommendation boundaries — 0.29 reject / 0.59 defer / 0.61 proceed
// ────────────────────────────────────────────────────────────────────────────
//
// The math: score = clamp(value * success * envelopeWeight / max(cost, 0.01))
// Hold success at 1.0 (HISTORICAL_RESULT=passed:1,total:1), envelope green
// (weight 1.0), and tune value+cost to land at target scores.
//
// To hit a target T precisely:
//   pick cost = 1, then value = T → value * 1 * 1 / 1 = T.

describe("scoreDispatchProposal — recommendation boundaries", () => {
  beforeEach(() => {
    HISTORICAL_RESULT = { total: 1, passed: 1 };
    ENVELOPE_STATUS = "green";
  });

  it("score 0.29 → reject", async () => {
    // cost $1, value $0.29 → score 0.29
    const result = await scoreDispatchProposal({
      agentRole: "iris",
      // Need cost ≈ $1 at $15/M output: 66_667 * 15 / 1e6 = 1.00000 ≈ 1.
      promptText: "test",
      estimatedTokens: { input: 0, output: 66_667 },
      expectedValueUsd: 0.29,
    });
    expect(result.score).toBeLessThan(DECISION_SCORE_THRESHOLDS.rejectBelow);
    expect(result.recommendation).toBe("reject");
  });

  it("score 0.59 → defer", async () => {
    const result = await scoreDispatchProposal({
      agentRole: "iris",
      promptText: "test",
      estimatedTokens: { input: 0, output: 66_667 }, // ≈ $1 cost
      expectedValueUsd: 0.59,
    });
    expect(result.score).toBeGreaterThanOrEqual(
      DECISION_SCORE_THRESHOLDS.rejectBelow,
    );
    expect(result.score).toBeLessThan(
      DECISION_SCORE_THRESHOLDS.proceedAtOrAbove,
    );
    expect(result.recommendation).toBe("defer");
  });

  it("score 0.61 → proceed", async () => {
    const result = await scoreDispatchProposal({
      agentRole: "iris",
      promptText: "test",
      estimatedTokens: { input: 0, output: 66_667 }, // ≈ $1 cost
      expectedValueUsd: 0.61,
    });
    expect(result.score).toBeGreaterThanOrEqual(
      DECISION_SCORE_THRESHOLDS.proceedAtOrAbove,
    );
    expect(result.recommendation).toBe("proceed");
  });

  it("defer rationale cites the marginal-band reason", async () => {
    const result = await scoreDispatchProposal({
      agentRole: "iris",
      promptText: "test",
      estimatedTokens: { input: 0, output: 66_667 },
      expectedValueUsd: 0.45,
    });
    expect(result.recommendation).toBe("defer");
    expect(result.rationale.toLowerCase()).toContain("marginal");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Persistence
// ────────────────────────────────────────────────────────────────────────────

describe("scoreDispatchProposal — persistence", () => {
  it("writes a row with the correct shape", async () => {
    await scoreDispatchProposal({
      agentRole: "iris",
      promptText: "ship a thing",
      estimatedTokens: { input: 1000, output: 1000 },
      expectedValueUsd: 100,
      dispatchId: 42,
    });
    // Fire-and-forget — let the microtask flush.
    await new Promise((r) => setImmediate(r));
    expect(SCORE_EVENTS).toHaveLength(1);
    const row = SCORE_EVENTS[0];
    expect(row.agentRole).toBe("iris");
    expect(row.dispatchId).toBe(42);
    expect(row.promptSummary).toBe("ship a thing");
    expect(Number(row.estimatedCostUsd)).toBeGreaterThan(0);
    expect(row.envelopeStatusAtDecision).toBe("green");
    expect(["proceed", "defer", "reject"]).toContain(row.recommendation);
    expect(row.rationale.length).toBeGreaterThan(0);
  });

  it("does NOT throw when persistence fails", async () => {
    throwOnScoreInsert = true;
    await expect(
      scoreDispatchProposal({
        agentRole: "iris",
        promptText: "x",
        estimatedTokens: { input: 1000, output: 1000 },
        expectedValueUsd: 100,
      }),
    ).resolves.toBeDefined();
    await new Promise((r) => setImmediate(r));
    expect(SCORE_EVENTS).toHaveLength(0);
  });

  it("truncates promptSummary to 500 chars", async () => {
    await scoreDispatchProposal({
      agentRole: "iris",
      promptText: "x".repeat(800),
      estimatedTokens: { input: 1000, output: 1000 },
      expectedValueUsd: 100,
    });
    await new Promise((r) => setImmediate(r));
    expect(SCORE_EVENTS[0].promptSummary.length).toBe(500);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// listRecentScores ordering + limit
// ────────────────────────────────────────────────────────────────────────────

describe("listRecentScores", () => {
  it("returns rows ordered by scoredAt desc with respected limit", async () => {
    const base = Date.now();
    // Insert three rows out of chronological order.
    SCORE_EVENTS.push(
      {
        id: 1,
        scoredAt: new Date(base - 60_000),
        dispatchId: null,
        agentRole: "iris",
        promptSummary: "older",
        estimatedCostUsd: "1.0000",
        estimatedValueUsd: "10.0000",
        historicalSuccessRate: "0.8000",
        envelopeStatusAtDecision: "green",
        score: "0.7500",
        recommendation: "proceed",
        rationale: "r1",
      },
      {
        id: 2,
        scoredAt: new Date(base),
        dispatchId: null,
        agentRole: "iris",
        promptSummary: "newest",
        estimatedCostUsd: "1.0000",
        estimatedValueUsd: "20.0000",
        historicalSuccessRate: "0.9000",
        envelopeStatusAtDecision: "green",
        score: "0.9500",
        recommendation: "proceed",
        rationale: "r2",
      },
      {
        id: 3,
        scoredAt: new Date(base - 30_000),
        dispatchId: null,
        agentRole: "soren",
        promptSummary: "middle",
        estimatedCostUsd: "1.0000",
        estimatedValueUsd: "5.0000",
        historicalSuccessRate: "0.5000",
        envelopeStatusAtDecision: "amber",
        score: "0.2000",
        recommendation: "reject",
        rationale: "r3",
      },
    );

    const rows = await listRecentScores(2);
    expect(rows).toHaveLength(2);
    expect(rows[0].promptSummary).toBe("newest");
    expect(rows[1].promptSummary).toBe("middle");
    // numeric fields decoded
    expect(rows[0].score).toBe(0.95);
    expect(rows[0].estimatedValueUsd).toBe(20);
  });

  it("returns empty array when no rows present", async () => {
    const rows = await listRecentScores();
    expect(rows).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// getDailyScoringSummary math
// ────────────────────────────────────────────────────────────────────────────

describe("getDailyScoringSummary", () => {
  it("returns zero summary when no rows scored today", async () => {
    const summary = await getDailyScoringSummary();
    expect(summary.totalScored).toBe(0);
    expect(summary.proceededCount).toBe(0);
    expect(summary.deferredCount).toBe(0);
    expect(summary.rejectedCount).toBe(0);
    expect(summary.averageScore).toBe(0);
    expect(summary.top3HighValueLowCost).toEqual([]);
  });

  it("counts by recommendation + averages score + ranks top-3 by value/cost ratio", async () => {
    const now = new Date();
    SCORE_EVENTS.push(
      // proceed, high value/cost ratio (best)
      makeRow({
        id: 1,
        scoredAt: now,
        agentRole: "iris",
        score: "0.9000",
        estimatedCostUsd: "1.0000",
        estimatedValueUsd: "100.0000",
        recommendation: "proceed",
        rationale: "high-leverage iris",
      }),
      // defer
      makeRow({
        id: 2,
        scoredAt: now,
        agentRole: "soren",
        score: "0.5000",
        estimatedCostUsd: "2.0000",
        estimatedValueUsd: "30.0000",
        recommendation: "defer",
        rationale: "soren marginal",
      }),
      // reject
      makeRow({
        id: 3,
        scoredAt: now,
        agentRole: "krieger",
        score: "0.1000",
        estimatedCostUsd: "5.0000",
        estimatedValueUsd: "1.0000",
        recommendation: "reject",
        rationale: "krieger reject",
      }),
      // proceed, second-best ratio
      makeRow({
        id: 4,
        scoredAt: now,
        agentRole: "beatrice",
        score: "0.8000",
        estimatedCostUsd: "1.0000",
        estimatedValueUsd: "50.0000",
        recommendation: "proceed",
        rationale: "beatrice good",
      }),
    );

    const summary = await getDailyScoringSummary();
    expect(summary.totalScored).toBe(4);
    expect(summary.proceededCount).toBe(2);
    expect(summary.deferredCount).toBe(1);
    expect(summary.rejectedCount).toBe(1);
    // average = (0.9 + 0.5 + 0.1 + 0.8) / 4 = 0.575
    expect(summary.averageScore).toBeCloseTo(0.575, 4);
    expect(summary.top3HighValueLowCost).toHaveLength(3);
    // ratios: iris 100, beatrice 50, soren 15, krieger 0.2
    expect(summary.top3HighValueLowCost[0].agentRole).toBe("iris");
    expect(summary.top3HighValueLowCost[1].agentRole).toBe("beatrice");
    expect(summary.top3HighValueLowCost[2].agentRole).toBe("soren");
  });
});

// ----------------------------------------------------------------------------
// helpers
// ----------------------------------------------------------------------------

function makeRow(overrides: Partial<ScoreEventRow> & {
  id: number;
  scoredAt: Date;
  agentRole: string;
  score: string;
  estimatedCostUsd: string;
  estimatedValueUsd: string | null;
  recommendation: string;
  rationale: string;
}): ScoreEventRow {
  return {
    dispatchId: null,
    promptSummary: "p",
    historicalSuccessRate: "0.8000",
    envelopeStatusAtDecision: "green",
    ...overrides,
  };
}
