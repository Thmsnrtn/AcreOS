/**
 * cognitionThrottle — graduated deprioritization BEFORE the hard cap
 * (Horizon A4 §2).
 *
 * Pins:
 *  - the full pure decision matrix: green → normal for everything; amber →
 *    defer internal machinery only (+6h); red → defer internal machinery
 *    (+24h) AND pin background work to the 0.2 priority floor;
 *  - the structural exempt list — verify + founder-initiated work is never
 *    throttled at ANY envelope status;
 *  - the throttle only defers/deprioritizes — nothing is ever dropped;
 *  - ORDER: assertWithinEnsembleCap still runs FIRST at enqueue and the
 *    throttle is IN ADDITION to it — when the cap throws, nothing is
 *    inserted and the throttle is never consulted; when the envelope is red,
 *    the cap has still been asserted and the row is still enqueued.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  throttleForEnvelope,
  EV_EXEMPT_SOURCE_TYPES,
  INTERNAL_MACHINERY_SOURCE_TYPES,
  BACKGROUND_SOURCE_TYPES,
  AMBER_INTERNAL_DEFER_MS,
  RED_INTERNAL_DEFER_MS,
  RED_BACKGROUND_MAX_PRIORITY,
} from "../../server/services/solene/cognitionThrottle";
import { DISPATCH_SOURCE_TYPES } from "@shared/schema/solene-dispatch";

const ALL_STATUSES = ["green", "amber", "red"] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Pure decision matrix
// ─────────────────────────────────────────────────────────────────────────────

describe("throttleForEnvelope — the pure decision matrix", () => {
  it("green: nothing throttles — every source type runs normally", () => {
    for (const sourceType of DISPATCH_SOURCE_TYPES) {
      const d = throttleForEnvelope("green", sourceType);
      expect(d.action).toBe("normal");
      expect(d.deferMs).toBe(0);
      expect(d.maxPriority).toBeNull();
    }
  });

  it("amber: internal machinery defers +6h; everything else is untouched", () => {
    for (const sourceType of DISPATCH_SOURCE_TYPES) {
      const d = throttleForEnvelope("amber", sourceType);
      if (INTERNAL_MACHINERY_SOURCE_TYPES.has(sourceType)) {
        expect(d.action).toBe("defer");
        expect(d.deferMs).toBe(AMBER_INTERNAL_DEFER_MS);
        expect(d.maxPriority).toBeNull(); // deferred, not deprioritized
      } else {
        expect(d.action).toBe("normal");
        expect(d.deferMs).toBe(0);
        expect(d.maxPriority).toBeNull();
      }
    }
  });

  it("red: internal machinery defers +24h; background work is pinned to the 0.2 floor; the rest is untouched", () => {
    for (const sourceType of DISPATCH_SOURCE_TYPES) {
      const d = throttleForEnvelope("red", sourceType);
      if (EV_EXEMPT_SOURCE_TYPES.has(sourceType)) {
        expect(d.action).toBe("normal");
        expect(d.maxPriority).toBeNull();
      } else if (INTERNAL_MACHINERY_SOURCE_TYPES.has(sourceType)) {
        expect(d.action).toBe("defer");
        expect(d.deferMs).toBe(RED_INTERNAL_DEFER_MS);
        expect(d.maxPriority).toBeNull();
      } else if (BACKGROUND_SOURCE_TYPES.has(sourceType)) {
        expect(d.action).toBe("normal"); // still enqueued + claimable
        expect(d.maxPriority).toBe(RED_BACKGROUND_MAX_PRIORITY);
      } else {
        // solene_manual — neither internal machinery nor background
        expect(d.action).toBe("normal");
        expect(d.maxPriority).toBeNull();
      }
    }
  });

  it("the exempt list is NEVER throttled at any envelope status", () => {
    for (const status of ALL_STATUSES) {
      for (const sourceType of EV_EXEMPT_SOURCE_TYPES) {
        const d = throttleForEnvelope(status, sourceType);
        expect(d.action).toBe("normal");
        expect(d.deferMs).toBe(0);
        expect(d.maxPriority).toBeNull();
      }
    }
  });

  it("every decision carries a plain-language reason (for the enqueue log)", () => {
    for (const status of ALL_STATUSES) {
      for (const sourceType of DISPATCH_SOURCE_TYPES) {
        expect(throttleForEnvelope(status, sourceType).reason.length).toBeGreaterThan(0);
      }
    }
  });

  it("category sets are disjoint and mirror the schema taxonomy", () => {
    for (const sourceType of EV_EXEMPT_SOURCE_TYPES) {
      expect(INTERNAL_MACHINERY_SOURCE_TYPES.has(sourceType)).toBe(false);
      expect(BACKGROUND_SOURCE_TYPES.has(sourceType)).toBe(false);
    }
    for (const sourceType of INTERNAL_MACHINERY_SOURCE_TYPES) {
      expect(BACKGROUND_SOURCE_TYPES.has(sourceType)).toBe(false);
    }
    // Every categorized type is a real schema source type.
    for (const sourceType of [
      ...EV_EXEMPT_SOURCE_TYPES,
      ...INTERNAL_MACHINERY_SOURCE_TYPES,
      ...BACKGROUND_SOURCE_TYPES,
    ]) {
      expect(DISPATCH_SOURCE_TYPES).toContain(sourceType);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Enqueue wiring — the cap assertion still runs FIRST; the throttle is an
// addition, never a replacement.
// ─────────────────────────────────────────────────────────────────────────────

const H = vi.hoisted(() => ({
  CALLS: [] as string[],
  INSERTED: [] as Array<Record<string, unknown>>,
  cap: { reject: false },
  envelope: "green" as "green" | "amber" | "red",
}));

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../server/db", () => ({
  db: {
    insert: (_t: unknown) => ({
      values: (row: Record<string, unknown>) => ({
        returning: (_c: unknown) => {
          H.CALLS.push("insert");
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
    assertWithinEnsembleCap: vi.fn(async () => {
      H.CALLS.push("cap");
      if (H.cap.reject) throw new actual.EnsembleCapExceededError(45, 45, 50);
    }),
    getMonthlyEnvelopeStatus: vi.fn(async () => {
      H.CALLS.push("envelope");
      return {
        envelopeUsd: 50,
        monthToDateUsd: 0,
        percentUsed: 0,
        daysIntoMonth: 1,
        projectedMonthlyUsd: 0,
        status: H.envelope,
      };
    }),
  };
});

vi.mock("../../server/services/solene/tokenEconomyScorer", () => ({
  scoreDispatchProposal: vi.fn(async () => ({
    estimatedCostUsd: 0.01,
    estimatedValueUsd: 20,
    historicalSuccessRate: 0.8,
    envelopeStatus: "green",
    score: 0.6,
    recommendation: "proceed",
    rationale: "test",
    scoreEventId: null,
  })),
  backfillScoreEventDispatchId: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  H.CALLS.length = 0;
  H.INSERTED.length = 0;
  H.cap.reject = false;
  H.envelope = "green";
});

describe("enqueue wiring — the throttle is IN ADDITION TO the hard cap, never instead of it", () => {
  it("ORDER: a tripped cap refuses the enqueue BEFORE the throttle is ever consulted — nothing inserted", async () => {
    const { enqueueDispatch } = await import("../../server/services/solene/dispatchQueue");
    const { EnsembleCapExceededError } = await import(
      "../../server/services/solene/capitalTracker"
    );
    H.cap.reject = true;
    H.envelope = "red";
    await expect(
      enqueueDispatch({
        sourceType: "code_review",
        sourceId: "r:1",
        agentRole: "code-reviewer",
        promptText: "review",
        priority: 2.0,
      }),
    ).rejects.toBeInstanceOf(EnsembleCapExceededError);
    expect(H.CALLS).toContain("cap");
    expect(H.CALLS).not.toContain("envelope"); // throttle never reached
    expect(H.INSERTED).toHaveLength(0); // refused outright — cap semantics untouched
  });

  it("ORDER: on a red envelope the cap is STILL asserted first, then the throttle defers — and the row is still enqueued", async () => {
    const { enqueueDispatch } = await import("../../server/services/solene/dispatchQueue");
    H.envelope = "red";
    const before = Date.now();
    const id = await enqueueDispatch({
      sourceType: "code_review",
      sourceId: "r:2",
      agentRole: "code-reviewer",
      promptText: "review",
      priority: 2.0,
    });
    expect(id).toBeGreaterThan(0);
    expect(H.CALLS.indexOf("cap")).toBeGreaterThanOrEqual(0);
    expect(H.CALLS.indexOf("cap")).toBeLessThan(H.CALLS.indexOf("envelope"));
    expect(H.CALLS.indexOf("envelope")).toBeLessThan(H.CALLS.indexOf("insert"));
    const row = H.INSERTED[0];
    expect(row.status).toBe("queued"); // deferred, not dropped
    const notBeforeAt = row.notBeforeAt as Date;
    expect(notBeforeAt).toBeInstanceOf(Date);
    expect(notBeforeAt.getTime()).toBeGreaterThanOrEqual(before + RED_INTERNAL_DEFER_MS - 1000);
  });

  it("red envelope: background work is floored to 0.2 on the inserted row (still enqueued)", async () => {
    const { enqueueDispatch } = await import("../../server/services/solene/dispatchQueue");
    H.envelope = "red";
    await enqueueDispatch({
      sourceType: "self_audit_drift",
      sourceId: "drift:1",
      agentRole: "iris",
      promptText: "task",
      priority: 1.5,
    });
    expect(Number(H.INSERTED[0].priority)).toBeCloseTo(RED_BACKGROUND_MAX_PRIORITY, 3);
    expect(H.INSERTED[0].notBeforeAt).toBeNull();
  });

  it("exempt work skips the throttle entirely — the envelope is not even read", async () => {
    const { enqueueDispatch } = await import("../../server/services/solene/dispatchQueue");
    H.envelope = "red";
    await enqueueDispatch({
      sourceType: "founder_bypass",
      sourceId: "founder:1",
      agentRole: "iris",
      promptText: "task",
      priority: 3.0,
    });
    expect(H.CALLS).toContain("cap"); // the hard cap ALWAYS runs
    expect(H.CALLS).not.toContain("envelope");
    expect(Number(H.INSERTED[0].priority)).toBeCloseTo(3.0, 3);
    expect(H.INSERTED[0].notBeforeAt).toBeNull();
  });
});
