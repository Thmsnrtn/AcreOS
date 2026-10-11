/**
 * Next year's farm-real-estate value growth per state — engine v1.
 *
 * Reads the USDA NASS Land Values survey (average value of agricultural land
 * including buildings, $/acre, state level, one number a year, released each
 * August). Forecasts the percent change from this year to next, with a range.
 *
 * HOW
 *  1. growth r = 100 × ln(value this year / value last year).
 *  2. One line for every state together: r next year = a + b × r this year
 *     (ordinary least squares over every state-year known at forecast time).
 *  3. Each state's own habit of running above or below that line (the mean of
 *     its leftovers) counts in proportion n / (n + k) — partial pooling, so a
 *     state with few years leans on the national line.
 *  4. The range is the 10th–90th percentile of past leftovers, the state's
 *     own blended with every state's the same way.
 *
 * This is farmland, the only state-level land price series published free with
 * a long history. It is not a price for any parcel and is never shown as one.
 * No characteristic of any person or neighbourhood is an input.
 *
 * Pure; browser-safe.
 */
import { ols, pooledSample, shrink, weightedQuantile, round, mean } from "./stats";
import { summariseIntervals, type IntervalScoreSummary } from "./scoring";

export const LAND_VALUE_ENGINE_ID = "ag_land_value_growth";
export const LAND_VALUE_ENGINE_VERSION = "1.0.0";

export const LAND_VALUE_PARAMS = {
  /** Partial pooling strength for a state's offset and range (in years). */
  poolK: 10,
  intervalLevel: 0.8,
  /** Years of growth a state needs as known before it is forecast. */
  minYears: 8,
  /** First survey year used (the annual survey is continuous from here). */
  firstYear: 1997,
} as const;

export interface AnnualPoint {
  year: number;
  value: number;
}

export interface StateLandValueForecast {
  state: string;
  /** Latest survey year known. */
  baseYear: number;
  targetYear: number;
  baseValuePerAcre: number;
  /** Percent change base → target (log-percent): point and central range. */
  growth: { point: number; lo: number; hi: number; level: number };
  /** The $/acre the range implies for the target year. */
  valueRange: { lo: number; hi: number };
  ownWeight: number;
  yearsOfHistory: number;
}

function growths(points: readonly AnnualPoint[]): Array<{ year: number; r: number }> {
  const byYear = new Map(points.map((p) => [p.year, p.value]));
  const out: Array<{ year: number; r: number }> = [];
  for (const p of points) {
    if (p.year < LAND_VALUE_PARAMS.firstYear) continue;
    const prev = byYear.get(p.year - 1);
    if (prev == null || !(prev > 0) || !(p.value > 0)) continue;
    out.push({ year: p.year, r: 100 * Math.log(p.value / prev) });
  }
  return out;
}

/**
 * Forecast every state from survey values AS KNOWN (only years through
 * `knownThroughYear` are used even if more are passed — the guard that makes a
 * backtest honest when the caller hands it the whole history).
 */
export function forecastLandValues(
  byState: ReadonlyMap<string, readonly AnnualPoint[]>,
  knownThroughYear: number,
): { forecasts: StateLandValueForecast[]; refusals: Array<{ state: string; refused: string }>; fit: { a: number; b: number; n: number } | null } {
  const P = LAND_VALUE_PARAMS;
  const g = new Map<string, Array<{ year: number; r: number }>>();
  for (const [st, pts] of byState) g.set(st, growths(pts.filter((p) => p.year <= knownThroughYear)));

  const pairs: Array<{ st: string; x: number; y: number }> = [];
  for (const [st, rs] of g) {
    const byYear = new Map(rs.map((r) => [r.year, r.r]));
    for (const r of rs) {
      const prev = byYear.get(r.year - 1);
      if (prev != null) pairs.push({ st, x: prev, y: r.r });
    }
  }
  const fit = ols(pairs);
  const forecasts: StateLandValueForecast[] = [];
  const refusals: Array<{ state: string; refused: string }> = [];
  if (!fit) {
    for (const st of byState.keys()) refusals.push({ state: st, refused: "not enough state-years known to fit the line" });
    return { forecasts, refusals, fit: null };
  }
  const resid = pairs.map((p) => ({ st: p.st, e: p.y - (fit.a + fit.b * p.x) }));
  // Leftovers around each state's own offset, so the range is not counted twice.
  const stateMean = new Map<string, number>();
  for (const st of g.keys()) stateMean.set(st, mean(resid.filter((r) => r.st === st).map((r) => r.e)) ?? 0);
  const allE = resid.map((r) => r.e - (stateMean.get(r.st) ?? 0));
  for (const [st, rs] of g) {
    const pts = (byState.get(st) ?? []).filter((p) => p.year <= knownThroughYear).slice().sort((a, b) => a.year - b.year);
    const last = rs[rs.length - 1];
    const lastPt = pts[pts.length - 1];
    if (rs.length < P.minYears || !last || !lastPt || last.year !== lastPt.year) {
      refusals.push({ state: st, refused: `only ${rs.length} years of land-value growth known (need ${P.minYears})` });
      continue;
    }
    const own = resid.filter((r) => r.st === st).map((r) => r.e);
    const offset = shrink(mean(own), own.length, 0, P.poolK);
    const point = fit.a + fit.b * last.r + offset;
    const centred = own.map((e) => e - (stateMean.get(st) ?? 0));
    const sample = pooledSample(centred, allE, P.poolK);
    const tail = (1 - P.intervalLevel) / 2;
    const lo = weightedQuantile(sample, tail);
    const hi = weightedQuantile(sample, 1 - tail);
    if (lo == null || hi == null) {
      refusals.push({ state: st, refused: "no leftovers to form a range" });
      continue;
    }
    forecasts.push({
      state: st,
      baseYear: last.year,
      targetYear: last.year + 1,
      baseValuePerAcre: lastPt.value,
      growth: { point: round(point, 3), lo: round(point + lo, 3), hi: round(point + hi, 3), level: P.intervalLevel },
      valueRange: {
        lo: Math.round(lastPt.value * Math.exp((point + lo) / 100)),
        hi: Math.round(lastPt.value * Math.exp((point + hi) / 100)),
      },
      ownWeight: round(own.length / (own.length + P.poolK), 3),
      yearsOfHistory: rs.length,
    });
  }
  forecasts.sort((a, b) => a.state.localeCompare(b.state));
  return { forecasts, refusals, fit: { a: round(fit.a, 4), b: round(fit.b, 4), n: fit.n } };
}

/** Realised log-percent growth for a year, or null when not yet published. */
export function realisedLandGrowth(points: readonly AnnualPoint[], year: number): number | null {
  const v = points.find((p) => p.year === year)?.value;
  const p = points.find((x) => x.year === year - 1)?.value;
  if (v == null || p == null || !(v > 0) || !(p > 0)) return null;
  return 100 * Math.log(v / p);
}

export interface LandBacktest {
  scored: IntervalScoreSummary;
  baselines: { sameAsLastYearMeanAbsError: number; nationalMeanMeanAbsError: number; n: number };
  perYear: Array<{ knownThrough: number; target: number; scored: number; coverage: number | null; meanAbsError: number | null }>;
}

/**
 * Walk-forward: for each year Y, forecast Y+1 from years ≤ Y only, then score
 * against the published Y+1. Two dumb rivals for the point: "same growth as
 * last year" and "the mean growth of every state-year known so far".
 */
export function landBacktest(land: ReadonlyMap<string, readonly AnnualPoint[]>, firstKnownThrough: number, lastKnownThrough: number): LandBacktest {
  const rows: Array<{ lo: number; hi: number; point: number; actual: number }> = [];
  let persistenceAbs = 0, nationalAbs = 0, n = 0;
  const perYear: LandBacktest["perYear"] = [];
  for (let Y = firstKnownThrough; Y <= lastKnownThrough; Y++) {
    const { forecasts } = forecastLandValues(land, Y);
    const known: number[] = [];
    for (const pts of land.values()) for (let y = LAND_VALUE_PARAMS.firstYear + 1; y <= Y; y++) { const g = realisedLandGrowth(pts, y); if (g != null) known.push(g); }
    const nationalMean = known.reduce((a, b) => a + b, 0) / Math.max(1, known.length);
    const yr: typeof rows = [];
    for (const fc of forecasts) {
      const pts = land.get(fc.state)!;
      const actual = realisedLandGrowth(pts, Y + 1);
      if (actual == null) continue;
      yr.push({ ...fc.growth, actual });
      const last = realisedLandGrowth(pts, Y);
      if (last != null) { persistenceAbs += Math.abs(actual - last); nationalAbs += Math.abs(actual - nationalMean); n++; }
    }
    rows.push(...yr);
    const s = summariseIntervals(yr, LAND_VALUE_PARAMS.intervalLevel);
    perYear.push({ knownThrough: Y, target: Y + 1, scored: s.n, coverage: s.coverage, meanAbsError: s.meanAbsError });
  }
  return {
    scored: summariseIntervals(rows, LAND_VALUE_PARAMS.intervalLevel),
    baselines: { sameAsLastYearMeanAbsError: round(persistenceAbs / Math.max(1, n), 3), nationalMeanMeanAbsError: round(nationalAbs / Math.max(1, n), 3), n },
    perYear,
  };
}
