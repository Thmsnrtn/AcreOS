/**
 * The committed backtest and priors say what was actually computed.
 *
 *   - The LAND backtest is fully reproducible from committed data
 *     (usdaAgLandValues.json), so it is recomputed here with the same engine
 *     and must equal the record exactly — a hand-edited number goes red.
 *   - The CYCLE backtest needs the ALFRED vintages, which are re-downloadable
 *     public files and are not committed; its record is checked for internal
 *     consistency (every per-origin count adds up to the total, one forecast
 *     per state per origin, the Tennessee trail is one per origin), for
 *     saying it is real-time, and for carrying the revised-data comparison.
 *   - The priors' seasonal factors are factors (twelve, averaging one).
 */
import { describe, expect, it } from "vitest";
import usda from "../../shared/forecasting/data/usdaAgLandValues.json";
import { BACKTEST_RECORD as B, PUBLIC_PRIORS as P, publicStressLength, seasonalFactor } from "../../shared/forecasting/publicPriors";
import { landBacktest, forecastLandValues, type AnnualPoint } from "../../shared/forecasting/landValue";
import { CYCLE_PHASE_ENGINE_VERSION, PHASES } from "../../shared/forecasting/cyclePhase";
import { LAND_VALUE_ENGINE_VERSION } from "../../shared/forecasting/landValue";
import { STATE_CODES } from "../../shared/forecasting/publicSeries";
import { CAPABILITIES } from "../../shared/governance/evidenceLadder";

const land = new Map<string, AnnualPoint[]>(Object.entries((usda as unknown as { values: Record<string, Array<[number, number]>> }).values).map(([st, a]) => [st, a.map(([year, value]) => ({ year, value }))]));

describe("land backtest — recomputed from committed data", () => {
  it("equals the committed record exactly", () => {
    const r = landBacktest(land, B.landValue.knownThrough.first, B.landValue.knownThrough.last);
    expect(r.scored).toEqual(B.landValue.scored);
    expect(r.baselines).toEqual(B.landValue.baselines);
    expect(r.perYear).toEqual(B.landValue.perYear);
  });
  it("the research forecast in the priors is the engine's output on the committed data", () => {
    const now = forecastLandValues(land, P.landValue.nextYear.knownThrough);
    expect(now.forecasts).toEqual(P.landValue.nextYear.forecasts);
  });
  it("was built by the engine version the code runs today", () => {
    expect(B.landValue.engineVersion).toBe(LAND_VALUE_ENGINE_VERSION);
    expect(B.cycle.engineVersion).toBe(CYCLE_PHASE_ENGINE_VERSION);
  });
});

describe("cycle backtest — internally consistent and honest about itself", () => {
  const c = B.cycle;
  it("covers many origins, one forecast per state per origin", () => {
    expect(c.origins).toBeGreaterThanOrEqual(30);
    expect(c.perOrigin.length).toBe(c.origins);
    for (const o of c.perOrigin) expect(o.scored).toBeLessThanOrEqual(STATE_CODES.length);
    expect(c.perOrigin.reduce((a, o) => a + o.scored, 0)).toBe(c.realtime.phase.n);
    expect(c.realtime.ranges.n).toBe(c.realtime.phase.n);
    expect(c.tennessee.trail.length).toBe(c.origins);
  });
  it("says it used real-time vintages, and carries what revised data would have claimed", () => {
    expect(B.method).toMatch(/exactly as published on that date/);
    expect(c.revisedDataForComparison.phase.n).toBe(c.realtime.phase.n);
    expect(c.revisedDataForComparison.note).toMatch(/revised/);
  });
  it("its scores are in range", () => {
    const p = c.realtime.phase;
    expect(p.brier!).toBeGreaterThanOrEqual(0);
    expect(p.brier!).toBeLessThanOrEqual(2);
    expect(c.realtime.ranges.coverage!).toBeGreaterThanOrEqual(0);
    expect(c.realtime.ranges.coverage!).toBeLessThanOrEqual(1);
    expect(p.calibration.bins.length).toBe(10);
  });
  it("the ladder does not claim more than a backtest proves", () => {
    for (const id of ["forecast.cycle-phase", "forecast.land-value"]) {
      const cap = CAPABILITIES.find((x) => x.id === id)!;
      expect(cap.level).toBe("E1");
      expect(cap.caveat).toMatch(/no live forecast/);
    }
  });
});

describe("priors are well-formed", () => {
  it("seasonal factors: twelve per state, averaging one", () => {
    expect(P.seasonality.states.length).toBe(STATE_CODES.length);
    for (const s of P.seasonality.states) {
      expect(s.factors).toHaveLength(12);
      expect(s.factors.reduce((a, b) => a + b, 0) / 12).toBeCloseTo(1, 3);
    }
    expect(seasonalFactor("TN", 13)).toBeNull();
  });
  it("the transition pattern is a stochastic matrix and the nowcast covers every state", () => {
    for (const i of PHASES) expect(PHASES.reduce((a, j) => a + P.cycle.monthlyTransitions[i][j], 0)).toBeCloseTo(1, 9);
    expect(P.cycle.nowcast.forecasts.map((f) => f.state).sort()).toEqual([...STATE_CODES].sort());
  });
  it("the stress length is measured, with its basis", () => {
    const s = publicStressLength();
    expect(s && s.months > 0).toBe(true);
    expect(s!.basis).toMatch(/2008 recession/);
  });
});
