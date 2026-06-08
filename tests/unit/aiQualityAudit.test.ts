/**
 * Tests for Andrei's Pax quality-drift detectors (server/services/andrei/aiQualityAudit.ts).
 *
 * Focus: the load-bearing hallucination-flag-rate spike detector (#2). We mock
 * `db` so each detector query resolves the controlled {total, flagged} window
 * rows in call order: the detector measures the RECENT window first, then the
 * BASELINE window (see measureHallucinationWindow call order in the detector).
 *
 * The detector is otherwise pure logic over those two windows, so a per-call
 * queue mock exercises every branch: no-data green, below-sample green,
 * no-spike green, spike → warn, big spike → critical, zero-baseline spike.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Queue of rows the next `db.select(...).from(...).where(...)` resolves to.
const RESULT_QUEUE: Array<Record<string, unknown>[]> = [];

vi.mock("../../server/db", () => {
  // Minimal thenable query builder: select().from().where() resolves to the
  // next queued result array. groupBy/orderBy/limit chain through for the
  // eval/cost detectors' "which model" query.
  function makeBuilder() {
    const builder: any = {
      from: () => builder,
      where: () => builder,
      groupBy: () => builder,
      orderBy: () => builder,
      limit: () => builder,
      then: (resolve: (rows: Record<string, unknown>[]) => unknown) =>
        resolve(RESULT_QUEUE.shift() ?? []),
    };
    return builder;
  }
  return {
    db: { select: () => makeBuilder() },
  };
});

// drizzle-orm helpers are only used to build opaque SQL fragments here.
vi.mock("@shared/schema", () => ({
  aiMessages: { role: "role", createdAt: "created_at", toolCalls: "tool_calls" },
  aiTestRuns: { modelKey: "model_key", runAt: "run_at", passed: "passed", costCents: "cost_cents" },
}));

import { hallucinationSpikeDetector } from "../../server/services/andrei/aiQualityAudit";

function queueWindows(recent: { total: number; flagged: number }, baseline: { total: number; flagged: number }) {
  // Order matters: detector queries recent first, then baseline.
  RESULT_QUEUE.length = 0;
  RESULT_QUEUE.push([{ total: recent.total, flagged: recent.flagged }]);
  RESULT_QUEUE.push([{ total: baseline.total, flagged: baseline.flagged }]);
}

beforeEach(() => {
  RESULT_QUEUE.length = 0;
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("hallucinationSpikeDetector", () => {
  it("green when there is too little recent traffic to judge", async () => {
    queueWindows({ total: 5, flagged: 4 }, { total: 100, flagged: 1 });
    const findings = await hallucinationSpikeDetector.run();
    expect(findings).toEqual([]);
  });

  it("green when the baseline window is too small to compare against", async () => {
    queueWindows({ total: 50, flagged: 20 }, { total: 10, flagged: 0 });
    const findings = await hallucinationSpikeDetector.run();
    expect(findings).toEqual([]);
  });

  it("green when recent rate matches a healthy baseline (no spike)", async () => {
    // recent 2% (1/50), baseline 2% (2/100) — no deviation.
    queueWindows({ total: 50, flagged: 1 }, { total: 100, flagged: 2 });
    const findings = await hallucinationSpikeDetector.run();
    expect(findings).toEqual([]);
  });

  it("warns on a >50% spike over baseline (below the critical floor)", async () => {
    // recent 5% (5/100), baseline 2% (2/100) → +150% deviation, but 5% < 15% abs floor.
    // 150% ≥ 100% would be critical... so pick a deviation between 50% and 100%.
    // recent 3% (3/100), baseline 2% (2/100) → +50%? that's exactly the threshold.
    // recent 3.2% would need fractional flagged. Use recent 7/200=3.5%, baseline 2/100=2% → +75%.
    queueWindows({ total: 200, flagged: 7 }, { total: 100, flagged: 2 });
    const findings = await hallucinationSpikeDetector.run();
    expect(findings).toHaveLength(1);
    expect(findings[0].detector).toBe("pax_hallucination_rate");
    expect(findings[0].domain).toBe("ai");
    expect(findings[0].severity).toBe("warn");
    expect(findings[0].dedupeKey).toBe("pax_hallucination_rate:spike");
  });

  it("escalates to critical when the recent absolute rate is high (≥15%)", async () => {
    // recent 20% (40/200), baseline 2% (2/100) — absolute floor breached → critical.
    queueWindows({ total: 200, flagged: 40 }, { total: 100, flagged: 2 });
    const findings = await hallucinationSpikeDetector.run();
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("critical");
  });

  it("escalates to critical on a ≥100% deviation even below the absolute floor", async () => {
    // recent 6% (12/200), baseline 2% (2/100) → +200% deviation → critical (≥100%).
    queueWindows({ total: 200, flagged: 12 }, { total: 100, flagged: 2 });
    const findings = await hallucinationSpikeDetector.run();
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("critical");
  });

  it("fires from a clean (0%) baseline when recent breaches the absolute floor", async () => {
    // baseline 0% (0/100), recent 16% (32/200) → infinite deviation, abs floor breached.
    queueWindows({ total: 200, flagged: 32 }, { total: 100, flagged: 0 });
    const findings = await hallucinationSpikeDetector.run();
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("critical");
    // deviation recorded as null (was infinite) in metadata.
    expect((findings[0].metadata as any).deviation).toBeNull();
  });

  it("warns (not critical) from a clean baseline when recent stays below the absolute floor", async () => {
    // baseline 0%, recent 5% (10/200) — spikes vs 0 (Infinity deviation > 50%
    // → fires) but 5% < 15% abs floor and Infinity deviation is NOT auto-
    // critical, so this is a warn, not a critical.
    queueWindows({ total: 200, flagged: 10 }, { total: 100, flagged: 0 });
    const findings = await hallucinationSpikeDetector.run();
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("warn");
  });
});
