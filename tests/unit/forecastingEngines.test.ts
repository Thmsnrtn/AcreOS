/**
 * The W4 forecasting engines: cycle phase, land value, scoring and the
 * customer gate, seasonality, the downturn runway and the design slots.
 *
 * Pure functions on synthetic series whose right answer is known by
 * construction. The committed backtest is checked separately
 * (forecastingBacktestRecord.test.ts).
 */
import { describe, expect, it } from "vitest";
import { addMonths, type Point } from "../../shared/forecasting/vintage";
import {
  CYCLE_PARAMS,
  PHASES,
  classifyPhase,
  forecastCyclePhases,
  growthPath,
  phaseProbabilities,
  propagate,
  realisedAt,
  pooledMatrix,
  emptyCounts,
} from "../../shared/forecasting/cyclePhase";
import { forecastLandValues, realisedLandGrowth, type AnnualPoint } from "../../shared/forecasting/landValue";
import { brierMulti, customerForecastGate, reliability, summariseIntervals, summarisePhaseScores, CUSTOMER_GATE } from "../../shared/forecasting/scoring";
import { seasonalPriors, seasonalRatios, taxSaleSeasonality } from "../../shared/forecasting/seasonality";
import { computeDownturnRunway, mrrMonthlyChangeFrom } from "../../shared/forecasting/downturnRunway";
import { aggregateSaturation, countyForecastSlot, COUNTY_SLOT_THRESHOLD } from "../../shared/forecasting/slots";
import { freezeForecast, forecastKey, FORECAST_ENGINES } from "../../shared/forecasting/frozenForecast";
import { BACKTEST_RECORD } from "../../shared/forecasting/publicPriors";

/** A monthly level series from a growth-rate function (annualised % per month index). */
function series(n: number, rate: (i: number) => number, start = "1995-01-01", level = 1000): Point[] {
  const out: Point[] = [];
  let x = level;
  for (let i = 0; i < n; i++) {
    out.push({ date: addMonths(start, i), value: x });
    x *= Math.pow(1 + rate(i) / 100, 1 / 12);
  }
  return out;
}
const cyclic = (phase: number) => (i: number) => 2 + 3 * Math.sin((i + phase) / 9);

describe("cycle phase — definitions", () => {
  it("four phases from the sign of growth and of its change", () => {
    expect(classifyPhase(1, 0.5)).toBe("expansion");
    expect(classifyPhase(1, -0.5)).toBe("peak");
    expect(classifyPhase(-1, -0.5)).toBe("contraction");
    expect(classifyPhase(-1, 0.5)).toBe("trough");
  });
  it("growth is the annualised six-month change, with no value interpolated across a gap", () => {
    const pts = series(30, () => 12);
    const g = growthPath(pts);
    expect(g[0].date).toBe(addMonths("1995-01-01", CYCLE_PARAMS.growthWindow));
    expect(g[0].g).toBeCloseTo(12, 6);
    const gap = pts.filter((_, i) => i !== 20);
    expect(growthPath(gap).some((p) => p.date === addMonths("1995-01-01", 26))).toBe(false);
  });
  it("phase probabilities are a distribution and lean the way the numbers point", () => {
    const p = phaseProbabilities(2, 0.5, 1, 1);
    expect(PHASES.reduce((s, k) => s + p[k], 0)).toBeCloseTo(1, 9);
    expect(p.expansion).toBeGreaterThan(p.peak);
    expect(p.expansion).toBeGreaterThan(p.contraction);
  });
  it("propagating keeps a distribution", () => {
    const m = pooledMatrix(emptyCounts());
    const p = propagate({ expansion: 1, peak: 0, contraction: 0, trough: 0 }, m, 6);
    expect(PHASES.reduce((s, k) => s + p[k], 0)).toBeCloseTo(1, 9);
  });
});

describe("cycle phase — forecasting every state", () => {
  const byState = new Map<string, Point[]>();
  for (let s = 0; s < 8; s++) byState.set(`S${s}`, series(300, cyclic(s * 7)));
  byState.set("THIN", series(48, cyclic(3)));
  byState.set("TOO_SHORT", series(20, cyclic(3)));

  it("is deterministic", () => {
    expect(JSON.stringify(forecastCyclePhases(byState))).toBe(JSON.stringify(forecastCyclePhases(byState)));
  });
  it("refuses a state with too little history rather than guessing", () => {
    const { refusals, forecasts } = forecastCyclePhases(byState);
    expect(refusals.map((r) => r.state)).toContain("TOO_SHORT");
    expect(forecasts.map((f) => f.state)).not.toContain("TOO_SHORT");
  });
  it("partial pooling: a thin state leans on all states more than a long one does", () => {
    const { forecasts } = forecastCyclePhases(byState);
    const thin = forecasts.find((f) => f.state === "THIN")!;
    const long = forecasts.find((f) => f.state === "S0")!;
    expect(thin.ownWeight.transitions).toBeLessThan(long.ownWeight.transitions);
    expect(thin.ownWeight.spread).toBeLessThan(long.ownWeight.spread);
  });
  it("probabilities sum to one, the target is six months after the last month, and the range brackets its point", () => {
    for (const f of forecastCyclePhases(byState).forecasts) {
      expect(PHASES.reduce((s, k) => s + f.nowProbs[k], 0)).toBeCloseTo(1, 6);
      expect(PHASES.reduce((s, k) => s + f.horizonProbs[k], 0)).toBeCloseTo(1, 6);
      expect(f.targetDate).toBe(addMonths(f.lastObservation, CYCLE_PARAMS.horizon));
      expect(f.growthRange.lo).toBeLessThanOrEqual(f.growthRange.hi);
    }
  });
  it("the realised phase is read from a later series at the target month", () => {
    const s = byState.get("S0")!;
    const r = realisedAt(s, s[s.length - 1].date);
    expect(r && PHASES.includes(r.phase)).toBe(true);
    expect(realisedAt(s, "2100-01-01")).toBeNull();
  });
});

describe("land value — the as-known guard", () => {
  const land = new Map<string, AnnualPoint[]>();
  for (let s = 0; s < 6; s++) {
    const pts: AnnualPoint[] = [];
    let v = 2000 + s * 300;
    for (let y = 1997; y <= 2026; y++) {
      pts.push({ year: y, value: Math.round(v) });
      v *= 1 + 0.03 + 0.02 * Math.sin((y + s) / 3);
    }
    land.set(`S${s}`, pts);
  }
  it("years after knownThroughYear cannot influence the forecast, even when passed in", () => {
    const cut = new Map([...land].map(([k, v]) => [k, v.filter((p) => p.year <= 2015)]));
    expect(forecastLandValues(land, 2015)).toEqual(forecastLandValues(cut, 2015));
  });
  it("forecasts the year after the last known one, with an ordered range", () => {
    const { forecasts } = forecastLandValues(land, 2015);
    expect(forecasts.length).toBe(6);
    for (const f of forecasts) {
      expect(f.targetYear).toBe(2016);
      expect(f.growth.lo).toBeLessThanOrEqual(f.growth.point);
      expect(f.growth.point).toBeLessThanOrEqual(f.growth.hi);
      expect(f.valueRange.lo).toBeLessThanOrEqual(f.valueRange.hi);
    }
  });
  it("refuses a state with too few years", () => {
    const thin = new Map(land);
    thin.set("NEW", [{ year: 2012, value: 1000 }, { year: 2013, value: 1100 }, { year: 2014, value: 1200 }]);
    expect(forecastLandValues(thin, 2015).refusals.map((r) => r.state)).toContain("NEW");
  });
  it("realised growth is the log change, null when unpublished", () => {
    expect(realisedLandGrowth([{ year: 2020, value: 100 }, { year: 2021, value: 110 }], 2021)).toBeCloseTo(100 * Math.log(1.1), 9);
    expect(realisedLandGrowth([{ year: 2020, value: 100 }], 2021)).toBeNull();
  });
});

describe("scoring", () => {
  const sure = { expansion: 1, peak: 0, contraction: 0, trough: 0 };
  const flat = { expansion: 0.25, peak: 0.25, contraction: 0.25, trough: 0.25 };
  it("Brier is 0 when certain and right, 2 when certain and wrong, 0.75 for a flat guess", () => {
    expect(brierMulti(sure, "expansion")).toBe(0);
    expect(brierMulti(sure, "trough")).toBe(2);
    expect(brierMulti(flat, "peak")).toBeCloseTo(0.75, 12);
  });
  it("skill is measured against the base rates and against no-change", () => {
    const s = summarisePhaseScores([
      { probs: sure, outcome: "expansion", climatology: flat, persistence: flat },
      { probs: { ...flat }, outcome: "peak", climatology: flat, persistence: flat },
    ]);
    expect(s.brier).toBeCloseTo(0.375, 6);
    expect(s.skillVsClimatology).toBeCloseTo(0.5, 6);
  });
  it("calibration error is zero for a forecaster whose 30% happens 30% of the time", () => {
    const pairs = Array.from({ length: 100 }, (_, i) => ({ p: 0.35, hit: i < 35 }));
    expect(reliability(pairs).ece).toBeCloseTo(0, 6);
    expect(reliability(pairs.map((x) => ({ ...x, hit: true }))).ece).toBeCloseTo(0.65, 6);
  });
  it("coverage counts outcomes inside the range", () => {
    expect(summariseIntervals([{ lo: 0, hi: 1, point: 0.5, actual: 0.2 }, { lo: 0, hi: 1, point: 0.5, actual: 2 }], 0.8).coverage).toBe(0.5);
  });
});

describe("the customer gate — a live scored record, never a backtest", () => {
  const empty = { phase: summarisePhaseScores([]), ranges: summariseIntervals([], 0.8), distinctIssueMonths: 0 };
  it("refuses today, and names every unmet bar", () => {
    const g = customerForecastGate(empty);
    expect(g.allowed).toBe(false);
    expect(g.unmet.length).toBe(5);
  });
  it("the committed backtest, however good, cannot open the gate — it is not a live record", () => {
    // Even fed the backtest's own numbers as if they were live, the gate wants live issue months.
    const asIfLive = { phase: BACKTEST_RECORD.cycle.realtime.phase, ranges: BACKTEST_RECORD.cycle.realtime.ranges, distinctIssueMonths: 0 };
    expect(customerForecastGate(asIfLive).allowed).toBe(false);
  });
  it("opens only when every bar is met", () => {
    const flat = { expansion: 0.25, peak: 0.25, contraction: 0.25, trough: 0.25 };
    // Calibrated by construction: says 60/40 and the 60 happens 60% of the time.
    const probs = { expansion: 0.6, peak: 0.4, contraction: 0, trough: 0 };
    const good = Array.from({ length: CUSTOMER_GATE.minLiveScored }, (_, i) => ({
      probs,
      outcome: (i < CUSTOMER_GATE.minLiveScored * 0.6 ? "expansion" : "peak") as "expansion" | "peak",
      climatology: flat,
      persistence: flat,
    }));
    const ranges = summariseIntervals(Array.from({ length: 60 }, (_, i) => ({ lo: 0, hi: 1, point: 0.5, actual: i % 5 === 0 ? 2 : 0.5 })), 0.8);
    const live = { phase: summarisePhaseScores(good), ranges, distinctIssueMonths: 6 };
    const g = customerForecastGate(live);
    expect(g.unmet).toEqual([]);
    expect(g.allowed).toBe(true);
    expect(customerForecastGate({ ...live, distinctIssueMonths: 5 }).allowed).toBe(false);
  });
});

describe("frozen forecasts", () => {
  it("carry the engine version at issue and a stable natural key", () => {
    const f = freezeForecast({
      engineId: FORECAST_ENGINES[0].id,
      subject: "TN",
      targetDate: "2027-02-01",
      issuedAsOf: "2026-10-25",
      inputs: { asOf: "2026-10-25", series: [{ seriesId: "TNNA", lastObservation: "2026-08-01", observations: 440 }] },
      prediction: { kind: "land_value_growth", growth: { point: 1, lo: 0, hi: 2, level: 0.8 }, valueRange: { lo: 1, hi: 2 }, baseValuePerAcre: 1 },
    });
    expect(f.engineVersion).toBe(FORECAST_ENGINES[0].version);
    expect(f.assumptions.length).toBeGreaterThan(0);
    expect(f.assumptions.every((a) => a.origin === "platform-default")).toBe(true);
    expect(forecastKey(f)).toBe(`${f.engineId}@${f.engineVersion}|TN|2027-02-01|2026-10-25`);
  });
  it("refuse an engine outside the registry", () => {
    expect(() => freezeForecast({ engineId: "llm_guess", subject: "TN", targetDate: "2027-01-01", issuedAsOf: "2026-10-25", inputs: { asOf: "2026-10-25", series: [] }, prediction: { kind: "land_value_growth", growth: { point: 1, lo: 0, hi: 2, level: 0.8 }, valueRange: { lo: 1, hi: 2 }, baseValuePerAcre: 1 } })).toThrow(/registered engines only/);
  });
});

describe("seasonality", () => {
  it("recovers a known seasonal shape from monthly values", () => {
    const shape = [0.7, 0.8, 1.1, 1.2, 1.25, 1.2, 1.1, 1.05, 0.95, 0.95, 0.85, 0.85];
    const avg = shape.reduce((a, b) => a + b, 0) / 12;
    const pts: Point[] = Array.from({ length: 120 }, (_, i) => ({ date: addMonths("2010-01-01", i), value: 1000 * shape[i % 12] }));
    const out = seasonalPriors(new Map([["XX", pts], ["YY", pts]]));
    const xx = out.states.find((s) => s.state === "XX")!;
    shape.forEach((v, i) => expect(xx.factors[i]).toBeCloseTo(v / avg, 2));
    expect(seasonalRatios(pts.slice(0, 12))).toEqual([]);
  });
  it("tax-sale seasonality refuses: the registry has sources, not dates", () => {
    const r = taxSaleSeasonality("TN");
    expect(r.available).toBe(false);
    expect(r.sourcesKnown).toBeGreaterThan(0);
    expect(r.reason).toMatch(/not when/);
    expect(taxSaleSeasonality("WY").reason).toMatch(/No tax-sale sources/);
  });
});

describe("downturn runway", () => {
  const base = { cashUsd: 12000, cashLabel: "ledger reserve buckets", monthlyCostsUsd: 1500, mrrUsd: 1000, observedMrrMonthlyChange: null, mrrHistoryWeeks: 3, publicContractionMonths: 9, publicContractionBasis: "median of state payroll contractions" };
  it("normal holds MRR flat as a LABELLED assumption when there is too little history", () => {
    const r = computeDownturnRunway(base);
    expect(r.assumptions.find((a) => a.key === "normalMrrMonthlyChange")?.basis).toMatch(/too few/);
    // 12000 cash, burning 500 a month: below zero in month 25.
    expect(r.normal.monthsToZero).toBe(25);
  });
  it("stress length is MEASURED when public history is available, and the hit is ASSUMED and says so", () => {
    const r = computeDownturnRunway(base);
    expect(r.measured.find((m) => m.key === "stressMonths")?.value).toBe(9);
    expect(r.assumptions.find((a) => a.key === "stressMrrDeclinePerMonth")?.basis).toMatch(/^ASSUMPTION/);
    expect(r.stress.monthsToZero!).toBeLessThan(r.normal.monthsToZero!);
  });
  it("a measured MRR trend replaces the flat assumption", () => {
    const r = computeDownturnRunway({ ...base, observedMrrMonthlyChange: 0.1, mrrHistoryWeeks: 12 });
    expect(r.assumptions.find((a) => a.key === "normalMrrMonthlyChange")).toBeUndefined();
    expect(r.normal.monthsToZero).toBeNull();
  });
  it("an MRR trend needs eight weeks of snapshots", () => {
    const s = (d: string, c: number) => ({ capturedAt: `${d}T00:00:00Z`, mrrCents: c });
    expect(mrrMonthlyChangeFrom([s("2026-09-01", 100000), s("2026-09-29", 110000)]).change).toBeNull();
    const ok = mrrMonthlyChangeFrom([s("2026-06-01", 100000), s("2026-09-01", 120000)]);
    expect(ok.change!).toBeGreaterThan(0);
  });
});

describe("design slots", () => {
  const T = COUNTY_SLOT_THRESHOLD;
  it("a county reads 'warming up' until every threshold is met, and says what it needs", () => {
    const below = countyForecastSlot({ state: "TN", county: "Knox", outcomes: T.minOutcomes, orgs: T.minOrgs - 1, firstObserved: "2025-01-01", lastObserved: "2026-06-01" });
    expect(below.status).toBe("warming_up");
    if (below.status === "warming_up") expect(below.line).toMatch(/Warming up/);
    expect(countyForecastSlot({ state: "TN", county: "Knox", outcomes: T.minOutcomes - 1, orgs: 9, firstObserved: "2024-01-01", lastObserved: "2026-06-01" }).status).toBe("warming_up");
    expect(countyForecastSlot({ state: "TN", county: "Knox", outcomes: 99, orgs: 9, firstObserved: "2026-01-01", lastObserved: "2026-06-01" }).status).toBe("warming_up");
    expect(countyForecastSlot({ state: "TN", county: "Knox", outcomes: T.minOutcomes, orgs: T.minOrgs, firstObserved: "2025-01-01", lastObserved: "2026-01-01" }).status).toBe("ready");
  });
  it("saturation drops any county under either floor and carries no organisation", () => {
    const rows = [
      { organizationId: 1, state: "tn", county: "Knox County", pieces: 400 },
      { organizationId: 2, state: "TN", county: "Knox", pieces: 30 },
      { organizationId: 3, state: "TN", county: "knox", pieces: 23 },
      { organizationId: 1, state: "TN", county: "Blount", pieces: 5000 },
      { organizationId: 2, state: "TN", county: "Blount", pieces: 5000 },
    ];
    const out = aggregateSaturation(rows);
    expect(out).toEqual([{ state: "TN", county: "Knox", pieces: 450, orgsAtLeast: 3 }]);
    expect(JSON.stringify(out)).not.toMatch(/organizationId/);
  });
});
