/**
 * S2 — the LCS outcome loop, end to end at the unit seams.
 *
 * The five-lens audit found the learning loop dead in the middle:
 *   - recordScoreOutcome was a log-only no-op (nothing persisted);
 *   - calculateCreditScore persisted scoreBreakdown keys that matched NEITHER
 *     downstream reader, so runLcsCalibration's hasAllDims was always false;
 *   - calibrated weights were never read back by the scorer.
 *
 * These tests pin the repaired joints:
 *   1. runLcsCalibration accepts the CANONICAL scoreBreakdown shape (numeric
 *      top-level dims + rich `factors`) and gets past the dimension gate.
 *   2. Legacy five-key rows are still skipped gracefully (no throw).
 *   3. recordScoreOutcome writes an `lcs_outcome` row to model_calibration_log.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock state ───────────────────────────────────────────────────────────────
const state = {
  dealRows: [] as any[],
  lcsRow: null as any,
  calibrationLogInserts: [] as any[],
  hydrateRows: [] as any[],
};

const DEALS = Symbol("deals");
const LCS = Symbol("lcs");
const CALLOG = Symbol("callog");

vi.mock("@shared/schema", () => ({
  deals: { table: "deals", id: "d.id", propertyId: "d.property_id", offerAmount: "d.offer", acceptedAmount: "d.accepted", organizationId: "d.org", updatedAt: "d.updated", status: "d.status", __k: "deals" },
  landCreditScores: { table: "lcs", propertyId: "l.property_id", createdAt: "l.created", scoreBreakdown: "l.breakdown", __k: "lcs" },
  modelCalibrationLog: { table: "callog", organizationId: "m.org", modelName: "m.model", createdAt: "m.created", __k: "callog" },
  properties: { __k: "properties" },
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: any[]) => ({ op: "and", args }),
  eq: (a: any, b: any) => ({ op: "eq", a, b }),
  gte: (a: any, b: any) => ({ op: "gte", a, b }),
  desc: (a: any) => ({ op: "desc", a }),
  sql: Object.assign((strings: TemplateStringsArray, ..._v: any[]) => ({ op: "sql", strings }), {
    raw: (s: string) => ({ op: "sql.raw", s }),
  }),
}));

vi.mock("../../server/db", () => {
  const rowsFor = (table: any) => {
    if (table?.__k === "deals") return state.dealRows;
    if (table?.__k === "lcs") return state.lcsRow ? [state.lcsRow] : [];
    if (table?.__k === "callog") return state.hydrateRows;
    return [];
  };
  const chain = (rows: any[]) => {
    const thenable: any = {
      where: () => thenable,
      orderBy: () => thenable,
      limit: () => Promise.resolve(rows),
      then: (res: any, rej: any) => Promise.resolve(rows).then(res, rej),
    };
    return thenable;
  };
  return {
    db: {
      select: (_proj?: any) => ({ from: (t: any) => chain(rowsFor(t)) }),
      selectDistinct: (_proj?: any) => ({ from: (t: any) => chain(rowsFor(t)) }),
      insert: (t: any) => ({
        values: (v: any) => {
          if (t?.__k === "callog") state.calibrationLogInserts.push(v);
          return Promise.resolve();
        },
      }),
    },
  };
});

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/services/alertSpine", () => ({ raiseAlert: vi.fn() }));

// ── Fixtures ────────────────────────────────────────────────────────────────
const CANONICAL_BREAKDOWN = {
  location: 72, physical: 65, legal: 80, financial: 55, environmental: 90, market: 60,
  factors: {
    location: { score: 72, weight: 25 }, physical: { score: 65, weight: 20 },
    legal: { score: 80, weight: 15 }, financial: { score: 55, weight: 20 },
    environmental: { score: 90, weight: 10 }, market: { score: 60, weight: 10 },
  },
  characteristics: 65, marketDemand: 60, economicFactors: 55, timeOnMarket: 80,
};

const LEGACY_BREAKDOWN = {
  location: 72, characteristics: 65, marketDemand: 60, economicFactors: 55, timeOnMarket: 80,
};

function deals20() {
  return Array.from({ length: 20 }, (_, i) => ({
    dealId: i + 1,
    propertyId: 100 + i,
    offerAmount: "10000",
    acceptedAmount: "14000",
  }));
}

beforeEach(() => {
  vi.resetModules();
  state.dealRows = [];
  state.lcsRow = null;
  state.calibrationLogInserts = [];
  state.hydrateRows = [];
});

describe("runLcsCalibration — canonical scoreBreakdown reaches the dimension gate", () => {
  it("canonical rows (factors inside scoreBreakdown) pass hasAllDims and calibration proceeds", async () => {
    state.dealRows = deals20();
    state.lcsRow = { scoreBreakdown: CANONICAL_BREAKDOWN };
    const { runLcsCalibration } = await import("../../server/services/lcsCalibrator");
    const result = await runLcsCalibration(7);
    // 20 full-dimension records — the gate that used to refuse EVERY row now passes.
    expect(result.sampleSize).toBe(20);
    expect(result.reason ?? "").not.toMatch(/dimension data/);
  });

  it("numeric-only canonical rows (no factors object) also pass via top-level dims", async () => {
    state.dealRows = deals20();
    const { factors: _f, ...numericOnly } = CANONICAL_BREAKDOWN as any;
    state.lcsRow = { scoreBreakdown: numericOnly };
    const { runLcsCalibration } = await import("../../server/services/lcsCalibrator");
    const result = await runLcsCalibration(7);
    expect(result.sampleSize).toBe(20);
  });

  it("legacy five-key rows are skipped gracefully — refused for thin data, never a throw", async () => {
    state.dealRows = deals20();
    state.lcsRow = { scoreBreakdown: LEGACY_BREAKDOWN };
    const { runLcsCalibration } = await import("../../server/services/lcsCalibrator");
    const result = await runLcsCalibration(7);
    expect(result.adjusted).toBe(false);
    expect(result.sampleSize).toBe(0);
    expect(result.reason).toMatch(/dimension data/);
  });
});

describe("recordScoreOutcome — outcomes persist instead of vanishing", () => {
  it("writes an lcs_outcome row to model_calibration_log with the outcome payload", async () => {
    const { recordScoreOutcome } = await import("../../server/services/modelCalibration");
    await recordScoreOutcome({
      propertyId: 123,
      lcsAtAcquisition: 685,
      dealOutcome: "won",
      profit: 4000,
      daysToSell: 45,
      organizationId: 7,
    });
    expect(state.calibrationLogInserts).toHaveLength(1);
    const row = state.calibrationLogInserts[0];
    expect(row.modelName).toBe("lcs_outcome");
    expect(row.organizationId).toBe(7);
    expect(row.weights).toMatchObject({ lcsAtAcquisition: 685, profit: 4000, daysToSell: 45, won: 1, propertyId: 123 });
    expect(row.reason).toMatch(/won/);
  });

  it("a lost deal records won: 0", async () => {
    const { recordScoreOutcome } = await import("../../server/services/modelCalibration");
    await recordScoreOutcome({
      propertyId: 124,
      lcsAtAcquisition: 512,
      dealOutcome: "lost",
      profit: 0,
      daysToSell: 0,
      organizationId: 7,
    });
    expect(state.calibrationLogInserts[0].weights.won).toBe(0);
  });
});
