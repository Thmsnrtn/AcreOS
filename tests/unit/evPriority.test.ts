/**
 * evPriority — the EV-score → queue-priority mapping (Horizon A4 §1).
 *
 * Pins:
 *  - the documented mapping: priority = clamp(score / proceedThreshold, 0.2, 3.0),
 *    so a proceed-threshold score maps to exactly the default priority 1.0;
 *  - the bounds: never below 0.2 (low-EV work stays claimable), never above
 *    3.0 (EV can never outrank the founder band — in practice it tops out at
 *    1/0.6 ≈ 1.667);
 *  - the structural exempt list (verify + founder-initiated work) — never
 *    re-scored, always the caller/default priority;
 *  - fail-open: a non-finite score returns the fallback priority untouched;
 *  - the enqueue wiring: caller-supplied priority always respected, and a
 *    scorer failure enqueues at the default priority (EV never blocks work).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  evPriority,
  DEFAULT_DISPATCH_PRIORITY,
  EV_EXEMPT_SOURCE_TYPES,
  EV_PRIORITY_MIN,
  EV_PRIORITY_MAX,
} from "../../server/services/solene/cognitionThrottle";
import { DECISION_SCORE_THRESHOLDS } from "@shared/schema/solene-token-economy";

// ─────────────────────────────────────────────────────────────────────────────
// Pure mapping
// ─────────────────────────────────────────────────────────────────────────────

describe("evPriority — mapping + bounds (pure)", () => {
  it("a proceed-threshold score maps to exactly the default priority 1.0", () => {
    expect(evPriority(DECISION_SCORE_THRESHOLDS.proceedAtOrAbove, "auto_dispatch")).toBe(1.0);
  });

  it("a saturated score of 1.0 maps to ~1.667 — above default, below the founder band", () => {
    const p = evPriority(1.0, "auto_dispatch");
    expect(p).toBeCloseTo(1 / DECISION_SCORE_THRESHOLDS.proceedAtOrAbove, 3);
    expect(p).toBeLessThan(3.0);
  });

  it("a zero score clamps to the 0.2 floor — deprioritized, never starved out", () => {
    expect(evPriority(0, "auto_dispatch")).toBe(EV_PRIORITY_MIN);
    expect(evPriority(0.05, "detector")).toBe(EV_PRIORITY_MIN);
  });

  it("stays inside [0.2, 3.0] across the whole score domain", () => {
    for (let s = 0; s <= 1.0001; s += 0.05) {
      const p = evPriority(s, "auto_dispatch");
      expect(p).toBeGreaterThanOrEqual(EV_PRIORITY_MIN);
      expect(p).toBeLessThanOrEqual(EV_PRIORITY_MAX);
    }
  });

  it("is monotone: a higher score never yields a lower priority", () => {
    let prev = -Infinity;
    for (let s = 0; s <= 1.0001; s += 0.05) {
      const p = evPriority(s, "auto_dispatch");
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
  });

  it("FAIL-OPEN: a non-finite score returns the fallback priority untouched", () => {
    expect(evPriority(NaN, "auto_dispatch")).toBe(DEFAULT_DISPATCH_PRIORITY);
    expect(evPriority(Infinity, "auto_dispatch", 0.7)).toBe(0.7);
    expect(evPriority(-Infinity, "auto_dispatch")).toBe(DEFAULT_DISPATCH_PRIORITY);
  });
});

describe("evPriority — the structural exempt list", () => {
  it("the exempt list is exactly verify + founder_manual + founder_bypass + letter_reply", () => {
    expect([...EV_EXEMPT_SOURCE_TYPES].sort()).toEqual(
      ["founder_bypass", "founder_manual", "letter_reply", "verify"],
    );
  });

  it("exempt source types are NEVER adjusted, whatever the score", () => {
    for (const sourceType of EV_EXEMPT_SOURCE_TYPES) {
      expect(evPriority(0, sourceType)).toBe(DEFAULT_DISPATCH_PRIORITY);
      expect(evPriority(1, sourceType)).toBe(DEFAULT_DISPATCH_PRIORITY);
      expect(evPriority(0.01, sourceType, 3.0)).toBe(3.0); // caller value passes through
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Enqueue wiring — caller priority respected; scorer failure fails open.
// The db + cap + scorer are mocked; enqueueDispatch is the unit under test.
// ─────────────────────────────────────────────────────────────────────────────

const H = vi.hoisted(() => ({
  INSERTED: [] as Array<Record<string, unknown>>,
  scorer: { score: 0.9, fail: false },
}));

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../server/db", () => ({
  db: {
    insert: (_t: unknown) => ({
      values: (row: Record<string, unknown>) => ({
        returning: (_c: unknown) => {
          H.INSERTED.push(row);
          return Promise.resolve([{ id: H.INSERTED.length }]);
        },
      }),
    }),
  },
}));

vi.mock("../../server/services/solene/capitalTracker", async () => {
  const actual = await vi.importActual<
    typeof import("../../server/services/solene/capitalTracker")
  >("../../server/services/solene/capitalTracker");
  return {
    ...actual,
    assertWithinEnsembleCap: vi.fn().mockResolvedValue(undefined),
    getMonthlyEnvelopeStatus: vi.fn(async () => ({
      envelopeUsd: 50,
      monthToDateUsd: 0,
      percentUsed: 0,
      daysIntoMonth: 1,
      projectedMonthlyUsd: 0,
      status: "green" as const,
    })),
  };
});

vi.mock("../../server/services/solene/tokenEconomyScorer", () => ({
  scoreDispatchProposal: vi.fn(async () => {
    if (H.scorer.fail) throw new Error("scorer outage");
    return {
      estimatedCostUsd: 0.01,
      estimatedValueUsd: 20,
      historicalSuccessRate: 0.8,
      envelopeStatus: "green",
      score: H.scorer.score,
      recommendation: "proceed",
      rationale: "test",
      scoreEventId: null,
    };
  }),
  backfillScoreEventDispatchId: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  H.INSERTED.length = 0;
  H.scorer.score = 0.9;
  H.scorer.fail = false;
});

describe("evPriority — enqueue wiring", () => {
  it("no caller priority → EV-derived priority lands on the row", async () => {
    const { enqueueDispatch } = await import("../../server/services/solene/dispatchQueue");
    await enqueueDispatch({
      sourceType: "auto_dispatch",
      sourceId: "w:1",
      agentRole: "iris",
      promptText: "task",
    });
    expect(Number(H.INSERTED[0].priority)).toBeCloseTo(1.5, 3); // 0.9 / 0.6
  });

  it("caller-supplied priority is respected — the scorer is not consulted", async () => {
    const { enqueueDispatch } = await import("../../server/services/solene/dispatchQueue");
    const { scoreDispatchProposal } = await import(
      "../../server/services/solene/tokenEconomyScorer"
    );
    vi.mocked(scoreDispatchProposal).mockClear();
    await enqueueDispatch({
      sourceType: "auto_dispatch",
      sourceId: "w:2",
      agentRole: "iris",
      promptText: "task",
      priority: 0.4,
    });
    expect(Number(H.INSERTED[0].priority)).toBeCloseTo(0.4, 3);
    expect(scoreDispatchProposal).not.toHaveBeenCalled();
  });

  it("FAIL-OPEN: scorer failure → default priority 1.0 and the enqueue still succeeds", async () => {
    const { enqueueDispatch } = await import("../../server/services/solene/dispatchQueue");
    H.scorer.fail = true;
    const id = await enqueueDispatch({
      sourceType: "detector",
      sourceId: "w:3",
      agentRole: "krieger",
      promptText: "task",
    });
    expect(id).toBeGreaterThan(0);
    expect(Number(H.INSERTED[0].priority)).toBeCloseTo(DEFAULT_DISPATCH_PRIORITY, 3);
  });
});
