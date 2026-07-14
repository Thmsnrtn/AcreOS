/**
 * cognitionRoi — the realized-value side of the EV loop (Horizon A4 §3).
 *
 * Pins:
 *  - rollup math: spend summed from real per-attempt cost rows; value summed
 *    ONLY from recovered cents with a real dispatch join; cents → USD ÷ 100;
 *  - honest unattributed reporting: spend with no join stays unattributed —
 *    counted in spentUsd and totalDispatches, contributing NOTHING to
 *    attributedValueUsd (never imputed);
 *  - window filtering on both sides (recorded_at for cost, resolved_at for
 *    value);
 *  - extractRecoveredCents only accepts a real, positive, finite figure;
 *  - computeCognitionRoi throws on a read failure (callers render
 *    "unmeasured", never a fabricated zero).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Call-order db stub for computeCognitionRoi: 1st select = cost rows (results
// ⟕ queue), 2nd select = experience rows (experiences ⋈ queue). Tests seed the
// row arrays; setting DB_FAIL makes every select reject.
const DB = vi.hoisted(() => ({
  costRows: [] as unknown[],
  experienceRows: [] as unknown[],
  fail: false,
  selectCount: 0,
}));

vi.mock("../../server/db", () => {
  const chain = (rows: () => unknown[]) => {
    const c: any = {
      from: () => c,
      leftJoin: () => c,
      innerJoin: () => c,
      where: () => c,
      then(onFulfilled: any, onRejected: any) {
        if (DB.fail) {
          return Promise.reject(new Error("simulated read failure")).then(onFulfilled, onRejected);
        }
        return Promise.resolve(rows()).then(onFulfilled, onRejected);
      },
    };
    return c;
  };
  return {
    db: {
      select: (_proj?: unknown) => {
        DB.selectCount += 1;
        const isFirst = DB.selectCount % 2 === 1;
        return chain(() => (isFirst ? DB.costRows : DB.experienceRows));
      },
    },
  };
});

import {
  rollupCognitionRoi,
  extractRecoveredCents,
  computeCognitionRoi,
  type CognitionCostRow,
  type CognitionValueRow,
} from "../../server/services/solene/cognitionRoi";

const NOW = new Date("2026-07-14T12:00:00Z");
const WINDOW_START = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000);

function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);
}

beforeEach(() => {
  DB.costRows = [];
  DB.experienceRows = [];
  DB.fail = false;
  DB.selectCount = 0;
});

// ─────────────────────────────────────────────────────────────────────────────
// extractRecoveredCents
// ─────────────────────────────────────────────────────────────────────────────

describe("extractRecoveredCents — only a real, positive, finite figure counts", () => {
  it("reads recoveredCents from an object trace", () => {
    expect(extractRecoveredCents({ recoveredCents: 12500 })).toBe(12500);
    expect(extractRecoveredCents({ senses: {}, recoveredCents: 1 })).toBe(1);
  });

  it("rejects everything that is not a real positive number — no coerced garbage", () => {
    expect(extractRecoveredCents(null)).toBeNull();
    expect(extractRecoveredCents(undefined)).toBeNull();
    expect(extractRecoveredCents("recoveredCents")).toBeNull();
    expect(extractRecoveredCents([12500])).toBeNull();
    expect(extractRecoveredCents({})).toBeNull();
    expect(extractRecoveredCents({ recoveredCents: 0 })).toBeNull();
    expect(extractRecoveredCents({ recoveredCents: -5 })).toBeNull();
    expect(extractRecoveredCents({ recoveredCents: NaN })).toBeNull();
    expect(extractRecoveredCents({ recoveredCents: "lots" })).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// rollupCognitionRoi — the pure arithmetic
// ─────────────────────────────────────────────────────────────────────────────

describe("rollupCognitionRoi — rollup math", () => {
  it("sums spend, converts cents to USD, and splits by sourceType", () => {
    const cost: CognitionCostRow[] = [
      { dispatchId: 1, costUsd: "1.5000", recordedAt: daysAgo(1), sourceType: "auto_dispatch" },
      { dispatchId: 2, costUsd: 0.5, recordedAt: daysAgo(2), sourceType: "auto_dispatch" },
      { dispatchId: 3, costUsd: "2.0000", recordedAt: daysAgo(3), sourceType: "detector" },
    ];
    const value: CognitionValueRow[] = [
      // dispatch 1 recovered $125.00 (12,500 cents) — a REAL join.
      { dispatchId: 1, recoveredCents: 12500, resolvedAt: daysAgo(1), sourceType: "auto_dispatch" },
    ];

    const roi = rollupCognitionRoi(cost, value, WINDOW_START, NOW, 30);
    expect(roi.spentUsd).toBe(4.0);
    expect(roi.attributedValueUsd).toBe(125.0); // cents ÷ 100
    expect(roi.attributedDispatches).toBe(1);
    expect(roi.totalDispatches).toBe(3);
    expect(roi.windowDays).toBe(30);
    expect(roi.bySourceType).toEqual([
      { sourceType: "auto_dispatch", spentUsd: 2.0, attributedValueUsd: 125.0 },
      { sourceType: "detector", spentUsd: 2.0, attributedValueUsd: 0 },
    ]);
  });

  it("HONEST UNATTRIBUTED: spend with no value join contributes zero attributed value — nothing is imputed", () => {
    const cost: CognitionCostRow[] = [
      { dispatchId: 1, costUsd: "9.9900", recordedAt: daysAgo(1), sourceType: "code_review" },
      { dispatchId: 2, costUsd: "5.0000", recordedAt: daysAgo(1), sourceType: "auto_dispatch" },
    ];
    const roi = rollupCognitionRoi(cost, [], WINDOW_START, NOW, 30);
    expect(roi.spentUsd).toBeCloseTo(14.99, 2);
    expect(roi.attributedValueUsd).toBe(0);
    expect(roi.attributedDispatches).toBe(0);
    expect(roi.totalDispatches).toBe(2);
  });

  it("empty inputs read as genuine zeros", () => {
    const roi = rollupCognitionRoi([], [], WINDOW_START, NOW, 30);
    expect(roi).toEqual({
      windowDays: 30,
      spentUsd: 0,
      attributedValueUsd: 0,
      attributedDispatches: 0,
      totalDispatches: 0,
      bySourceType: [],
    });
  });

  it("window filtering: rows outside the trailing window are excluded on BOTH sides", () => {
    const cost: CognitionCostRow[] = [
      { dispatchId: 1, costUsd: "1.0000", recordedAt: daysAgo(1), sourceType: "auto_dispatch" }, // in
      { dispatchId: 2, costUsd: "1.0000", recordedAt: daysAgo(31), sourceType: "auto_dispatch" }, // out
      { dispatchId: 3, costUsd: "1.0000", recordedAt: null, sourceType: "auto_dispatch" }, // no timestamp — out
    ];
    const value: CognitionValueRow[] = [
      { dispatchId: 1, recoveredCents: 100, resolvedAt: daysAgo(1), sourceType: "auto_dispatch" }, // in
      { dispatchId: 2, recoveredCents: 100, resolvedAt: daysAgo(35), sourceType: "auto_dispatch" }, // out
      { dispatchId: 3, recoveredCents: 100, resolvedAt: null, sourceType: "auto_dispatch" }, // out
    ];
    const roi = rollupCognitionRoi(cost, value, WINDOW_START, NOW, 30);
    expect(roi.spentUsd).toBe(1.0);
    expect(roi.totalDispatches).toBe(1);
    expect(roi.attributedValueUsd).toBe(1.0);
    expect(roi.attributedDispatches).toBe(1);
  });

  it("multiple attempts of the same dispatch sum their real cost but count ONE dispatch", () => {
    const cost: CognitionCostRow[] = [
      { dispatchId: 7, costUsd: "0.5000", recordedAt: daysAgo(1), sourceType: "auto_dispatch" },
      { dispatchId: 7, costUsd: "0.7500", recordedAt: daysAgo(1), sourceType: "auto_dispatch" },
    ];
    const roi = rollupCognitionRoi(cost, [], WINDOW_START, NOW, 30);
    expect(roi.spentUsd).toBeCloseTo(1.25, 2);
    expect(roi.totalDispatches).toBe(1);
  });

  it("a missing sourceType lands in 'unknown' rather than vanishing (real dollars never disappear)", () => {
    const cost: CognitionCostRow[] = [
      { dispatchId: 1, costUsd: "3.0000", recordedAt: daysAgo(1), sourceType: null },
    ];
    const roi = rollupCognitionRoi(cost, [], WINDOW_START, NOW, 30);
    expect(roi.spentUsd).toBe(3.0);
    expect(roi.bySourceType).toEqual([
      { sourceType: "unknown", spentUsd: 3.0, attributedValueUsd: 0 },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computeCognitionRoi — DB plumbing + honesty on read failure
// ─────────────────────────────────────────────────────────────────────────────

describe("computeCognitionRoi", () => {
  it("joins cost + experience rows and extracts recovered cents from the trace", async () => {
    DB.costRows = [
      { dispatchId: 1, costUsd: "2.0000", recordedAt: daysAgo(1), sourceType: "auto_dispatch" },
      { dispatchId: 2, costUsd: "1.0000", recordedAt: daysAgo(2), sourceType: "detector" },
    ];
    DB.experienceRows = [
      // Real consequence: cents in the trace + a dispatch join.
      { dispatchId: 1, reasoningTrace: { recoveredCents: 5000 }, resolvedAt: daysAgo(1), sourceType: "auto_dispatch" },
      // No cents in the trace — honestly invisible to attribution.
      { dispatchId: 2, reasoningTrace: { senses: {} }, resolvedAt: daysAgo(1), sourceType: "detector" },
      // Defensive: a null dispatchId row never attributes.
      { dispatchId: null, reasoningTrace: { recoveredCents: 9999 }, resolvedAt: daysAgo(1), sourceType: "detector" },
    ];

    const roi = await computeCognitionRoi(30, NOW);
    expect(roi.spentUsd).toBe(3.0);
    expect(roi.attributedValueUsd).toBe(50.0);
    expect(roi.attributedDispatches).toBe(1);
    expect(roi.totalDispatches).toBe(2);
  });

  it("HONESTY: a read failure THROWS — callers render 'unmeasured', never a fabricated zero", async () => {
    DB.fail = true;
    await expect(computeCognitionRoi(30, NOW)).rejects.toThrow("simulated read failure");
  });
});
