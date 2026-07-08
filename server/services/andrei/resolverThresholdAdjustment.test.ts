/**
 * Tier 2D — bounded, audited calibration-threshold adjustment.
 *
 * Proves:
 *   - computeNextOffset is hard-clamped to [THRESHOLD_OFFSET_MIN,
 *     THRESHOLD_OFFSET_MAX] on every path (drift, recovery, garbage input)
 *   - thin data (< MIN_GRADED_FOR_ADJUSTMENT) NEVER moves the threshold
 *   - drift at saturation holds (clamped:true) instead of climbing forever
 *   - applyCalibrationThresholdAdjustment records the domain-audit finding
 *     on drift AND appends the audit-trail row when the offset moves
 *   - hold decisions write NO audit row; failures never throw
 *   - getActiveResolveThresholdOffset re-clamps a corrupt persisted value
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const state: {
  latestOffsetRows: Array<{ newOffset: number }>;
  insertedValues: unknown[];
  readShouldThrow: boolean;
  insertShouldThrow: boolean;
} = {
  latestOffsetRows: [],
  insertedValues: [],
  readShouldThrow: false,
  insertShouldThrow: false,
};

vi.mock("../../db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => {
              if (state.readShouldThrow) {
                return Promise.reject(new Error("db read down"));
              }
              return Promise.resolve(state.latestOffsetRows);
            },
          }),
        }),
      }),
    }),
    insert: () => ({
      values: (v: unknown) => {
        if (state.insertShouldThrow) {
          return Promise.reject(new Error("db insert down"));
        }
        state.insertedValues.push(v);
        return Promise.resolve();
      },
    }),
  },
}));

const recordFindingMock = vi.fn();
vi.mock("../audit/domainAudit", () => ({
  recordFinding: (input: unknown) => recordFindingMock(input),
}));

import {
  computeNextOffset,
  applyCalibrationThresholdAdjustment,
  getActiveResolveThresholdOffset,
  _resetOffsetCache,
  THRESHOLD_ADJUSTMENT_STEP,
  THRESHOLD_OFFSET_MIN,
  THRESHOLD_OFFSET_MAX,
  MIN_GRADED_FOR_ADJUSTMENT,
} from "./resolverThresholdAdjustment";
import type { SupportResolverCalibrationReport } from "./supportResolverCalibration";

function makeReport(
  overrides: Partial<SupportResolverCalibrationReport> = {},
): SupportResolverCalibrationReport {
  return {
    path: "support_resolve",
    windowDays: 30,
    totalAutoResolved: 40,
    gradedDecisions: 25,
    brierScore: 0.35,
    overconfidenceBias: 18.2,
    verdict: "drifting",
    ...overrides,
  };
}

beforeEach(() => {
  state.latestOffsetRows = [];
  state.insertedValues = [];
  state.readShouldThrow = false;
  state.insertShouldThrow = false;
  recordFindingMock.mockReset();
  recordFindingMock.mockResolvedValue(undefined);
  _resetOffsetCache();
});

// ─── computeNextOffset (pure) ───────────────────────────────────────────────

describe("computeNextOffset", () => {
  it("raises by one step on drift", () => {
    const d = computeNextOffset(0, makeReport({ brierScore: 0.35 }));
    expect(d.action).toBe("raise");
    expect(d.nextOffset).toBe(THRESHOLD_ADJUSTMENT_STEP);
    expect(d.clamped).toBe(false);
  });

  it("never exceeds THRESHOLD_OFFSET_MAX — saturated drift holds with clamped:true", () => {
    const d = computeNextOffset(
      THRESHOLD_OFFSET_MAX,
      makeReport({ brierScore: 0.9 }),
    );
    expect(d.action).toBe("hold");
    expect(d.nextOffset).toBe(THRESHOLD_OFFSET_MAX);
    expect(d.clamped).toBe(true);
  });

  it("clamps a near-max raise to exactly the max", () => {
    // 12 + 5 would be 17 → clamp to 15.
    const d = computeNextOffset(12, makeReport({ brierScore: 0.4 }));
    expect(d.action).toBe("raise");
    expect(d.nextOffset).toBe(THRESHOLD_OFFSET_MAX);
    expect(d.clamped).toBe(true);
  });

  it("lowers toward zero on recovery and never goes below THRESHOLD_OFFSET_MIN", () => {
    const down = computeNextOffset(10, makeReport({ brierScore: 0.1 }));
    expect(down.action).toBe("lower");
    expect(down.nextOffset).toBe(5);

    // 3 - 5 would be -2 → clamp to 0.
    const clamped = computeNextOffset(3, makeReport({ brierScore: 0.1 }));
    expect(clamped.action).toBe("lower");
    expect(clamped.nextOffset).toBe(THRESHOLD_OFFSET_MIN);
    expect(clamped.clamped).toBe(true);

    // Already at 0 → nothing to lower.
    const atFloor = computeNextOffset(0, makeReport({ brierScore: 0.1 }));
    expect(atFloor.action).toBe("hold");
    expect(atFloor.nextOffset).toBe(0);
  });

  it("holds in the dead band between recovery and drift", () => {
    const d = computeNextOffset(5, makeReport({ brierScore: 0.25 }));
    expect(d.action).toBe("hold");
    expect(d.nextOffset).toBe(5);
  });

  it("NEVER moves the threshold on thin data, even with terrible Brier", () => {
    const d = computeNextOffset(
      0,
      makeReport({
        brierScore: 0.9,
        gradedDecisions: MIN_GRADED_FOR_ADJUSTMENT - 1,
      }),
    );
    expect(d.action).toBe("hold");
    expect(d.nextOffset).toBe(0);
  });

  it("holds when brierScore is null", () => {
    const d = computeNextOffset(5, makeReport({ brierScore: null, overconfidenceBias: null }));
    expect(d.action).toBe("hold");
    expect(d.nextOffset).toBe(5);
  });

  it("sanitizes an out-of-bounds current offset before deciding", () => {
    // A corrupt persisted value of 999 must be treated as 15, not amplified.
    const d = computeNextOffset(999, makeReport({ brierScore: 0.5 }));
    expect(d.nextOffset).toBeLessThanOrEqual(THRESHOLD_OFFSET_MAX);
    const e = computeNextOffset(-7, makeReport({ brierScore: 0.1 }));
    expect(e.nextOffset).toBeGreaterThanOrEqual(THRESHOLD_OFFSET_MIN);
  });
});

// ─── applyCalibrationThresholdAdjustment ────────────────────────────────────

describe("applyCalibrationThresholdAdjustment", () => {
  it("on drift: records the domain-audit finding AND appends the audit row", async () => {
    state.latestOffsetRows = [{ newOffset: 5 }];
    const outcome = await applyCalibrationThresholdAdjustment(
      makeReport({ brierScore: 0.35 }),
    );

    expect(outcome.driftDetected).toBe(true);
    expect(outcome.adjusted).toBe(true);
    expect(outcome.decision.action).toBe("raise");
    expect(outcome.decision.nextOffset).toBe(10);

    // Finding recorded with the dedupe key + ai domain.
    expect(recordFindingMock).toHaveBeenCalledTimes(1);
    const finding = recordFindingMock.mock.calls[0][0];
    expect(finding.domain).toBe("ai");
    expect(finding.severity).toBe("warn");
    expect(finding.detector).toBe("support_resolver_calibration_grader");
    expect(finding.dedupeKey).toBe("support_resolve:calibration_drift");
    expect(finding.metadata.currentOffset).toBe(5);
    expect(finding.metadata.nextOffset).toBe(10);

    // Audit-trail row written with full provenance.
    expect(state.insertedValues).toHaveLength(1);
    const row = state.insertedValues[0] as Record<string, unknown>;
    expect(row.surface).toBe("support_resolve");
    expect(row.previousOffset).toBe(5);
    expect(row.newOffset).toBe(10);
    expect(row.direction).toBe("raise");
    expect(row.brierScore).toBe("0.3500");
    expect(row.overconfidenceBias).toBe("18.20");
    expect(row.gradedDecisions).toBe(25);
    expect(row.clamped).toBe(false);
  });

  it("drift at max offset: finding recorded, NO audit row (hold), clamped surfaced", async () => {
    state.latestOffsetRows = [{ newOffset: 15 }];
    const outcome = await applyCalibrationThresholdAdjustment(
      makeReport({ brierScore: 0.5 }),
    );
    expect(outcome.driftDetected).toBe(true);
    expect(outcome.adjusted).toBe(false);
    expect(outcome.decision.action).toBe("hold");
    expect(outcome.decision.clamped).toBe(true);
    expect(recordFindingMock).toHaveBeenCalledTimes(1);
    expect(recordFindingMock.mock.calls[0][0].metadata.clamped).toBe(true);
    expect(state.insertedValues).toHaveLength(0);
  });

  it("recovery: lowers the offset with an audit row, no drift finding", async () => {
    state.latestOffsetRows = [{ newOffset: 10 }];
    const outcome = await applyCalibrationThresholdAdjustment(
      makeReport({ brierScore: 0.1, verdict: "well calibrated" }),
    );
    expect(outcome.driftDetected).toBe(false);
    expect(outcome.adjusted).toBe(true);
    expect(recordFindingMock).not.toHaveBeenCalled();
    const row = state.insertedValues[0] as Record<string, unknown>;
    expect(row.direction).toBe("lower");
    expect(row.previousOffset).toBe(10);
    expect(row.newOffset).toBe(5);
  });

  it("dead band: no finding, no audit row", async () => {
    state.latestOffsetRows = [{ newOffset: 5 }];
    const outcome = await applyCalibrationThresholdAdjustment(
      makeReport({ brierScore: 0.25 }),
    );
    expect(outcome.adjusted).toBe(false);
    expect(recordFindingMock).not.toHaveBeenCalled();
    expect(state.insertedValues).toHaveLength(0);
  });

  it("never throws: offset-read failure → hold, no adjustment", async () => {
    state.readShouldThrow = true;
    const outcome = await applyCalibrationThresholdAdjustment(makeReport());
    expect(outcome.adjusted).toBe(false);
    expect(outcome.decision.action).toBe("hold");
    expect(state.insertedValues).toHaveLength(0);
  });

  it("never throws: finding + insert failures degrade gracefully", async () => {
    state.latestOffsetRows = [{ newOffset: 0 }];
    recordFindingMock.mockRejectedValueOnce(new Error("findings table down"));
    state.insertShouldThrow = true;
    const outcome = await applyCalibrationThresholdAdjustment(
      makeReport({ brierScore: 0.4 }),
    );
    // The decision still happened; only persistence failed.
    expect(outcome.decision.action).toBe("raise");
    expect(outcome.adjusted).toBe(false);
  });
});

// ─── getActiveResolveThresholdOffset ────────────────────────────────────────

describe("getActiveResolveThresholdOffset", () => {
  it("returns the latest persisted offset", async () => {
    state.latestOffsetRows = [{ newOffset: 10 }];
    expect(await getActiveResolveThresholdOffset()).toBe(10);
  });

  it("re-clamps a corrupt persisted value on read (defense in depth)", async () => {
    state.latestOffsetRows = [{ newOffset: 999 }];
    expect(await getActiveResolveThresholdOffset()).toBe(THRESHOLD_OFFSET_MAX);
  });

  it("fails safe to 0 on a db error — never breaks a support turn", async () => {
    state.readShouldThrow = true;
    expect(await getActiveResolveThresholdOffset()).toBe(0);
  });
});
