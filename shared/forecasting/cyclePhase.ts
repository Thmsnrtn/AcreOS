/**
 * Regional cycle phase from state payroll employment — engine v1.
 *
 * WHAT IT SAYS
 * ------------
 * For each state: which of four phases its job market is in, with
 * probabilities, and where that is likely to be six months after the last
 * published month.
 *
 *   expansion    jobs growing, and growing faster than three months ago
 *   peak         jobs growing, but more slowly than three months ago
 *   contraction  jobs shrinking, and shrinking faster
 *   trough       jobs shrinking, but less steeply
 *
 * HOW (every step is one sentence a founder can check)
 * ---------------------------------------------------
 *  1. growth g = six-month change in total nonfarm payrolls, annualised (%).
 *  2. momentum d = g now minus g three months earlier.
 *  3. The phase is the sign of g and the sign of d.
 *  4. How sure: g and d each move by a typical amount month to month (a robust
 *     spread). P(g > 0) = Φ(g / spread), the same for d; the four phase
 *     probabilities are the products. A state with little history borrows the
 *     national spread (partial pooling, weight n / (n + k)).
 *  5. Six months ahead: how often each phase turned into each other phase,
 *     month to month, in that state's own history — pulled toward the all-state
 *     pattern the same way — applied six times to today's probabilities.
 *  6. A range for growth six months ahead: today's growth plus the 10th–90th
 *     percentile of how much growth has moved over six months (state history
 *     blended with all states).
 *
 * WHAT IT DOES NOT SAY
 * --------------------
 * Nothing about prices. Nothing about a county. It reads public payrolls
 * only; no person, household or neighbourhood characteristic is an input (the
 * fair-housing gate in fairHousing.ts enumerates its features).
 *
 * Deterministic: same series in, same forecast out. Versioned: improving any
 * step bumps CYCLE_PHASE_ENGINE_VERSION so a frozen forecast keeps the meaning
 * it was issued under. Pure; browser-safe.
 */
import { addMonths, monthsBetween, type Point } from "./vintage";
import { normalCdf, pooledSample, robustSd, shrink, weightedQuantile, round } from "./stats";

export const CYCLE_PHASE_ENGINE_ID = "cycle_phase_payrolls";
export const CYCLE_PHASE_ENGINE_VERSION = "1.0.0";

export const PHASES = ["expansion", "peak", "contraction", "trough"] as const;
export type Phase = (typeof PHASES)[number];
export type PhaseProbs = Record<Phase, number>;

export const CYCLE_PARAMS = {
  /** Months in the growth window. */
  growthWindow: 6,
  /** Months back for the momentum comparison. */
  momentumLag: 3,
  /** Months ahead of the last published month. */
  horizon: 6,
  /** Partial pooling strength for the month-to-month spread (in months). */
  spreadPoolK: 60,
  /** Partial pooling strength for the transition pattern (in transitions). */
  transitionPoolK: 24,
  /** Partial pooling strength for the six-month growth-change sample. */
  intervalPoolK: 60,
  /** The central share of the growth range. */
  intervalLevel: 0.8,
  /** A state with fewer months than this as known is refused, not guessed. */
  minHistoryMonths: 36,
} as const;

export function classifyPhase(g: number, d: number): Phase {
  if (g > 0) return d >= 0 ? "expansion" : "peak";
  return d < 0 ? "contraction" : "trough";
}

export interface GrowthPoint {
  date: string;
  g: number;
  d: number | null;
}

/**
 * Growth and momentum for a monthly level series. Requires consecutive months;
 * a gap restarts the window (no value is interpolated).
 */
export function growthPath(points: readonly Point[]): GrowthPoint[] {
  const W = CYCLE_PARAMS.growthWindow;
  const L = CYCLE_PARAMS.momentumLag;
  const byDate = new Map(points.map((p) => [p.date, p.value]));
  const out: GrowthPoint[] = [];
  const gByDate = new Map<string, number>();
  for (const p of points) {
    const prev = byDate.get(addMonths(p.date, -W));
    if (prev == null || !(prev > 0) || !(p.value > 0)) continue;
    const g = (Math.pow(p.value / prev, 12 / W) - 1) * 100;
    gByDate.set(p.date, g);
  }
  for (const p of points) {
    const g = gByDate.get(p.date);
    if (g == null) continue;
    const gPrev = gByDate.get(addMonths(p.date, -L));
    out.push({ date: p.date, g, d: gPrev == null ? null : g - gPrev });
  }
  return out;
}

function zeroProbs(): PhaseProbs {
  return { expansion: 0, peak: 0, contraction: 0, trough: 0 };
}

export function phaseProbabilities(g: number, d: number, spreadG: number, spreadD: number): PhaseProbs {
  const pg = normalCdf(g / Math.max(spreadG, 1e-6));
  const pd = normalCdf(d / Math.max(spreadD, 1e-6));
  return {
    expansion: pg * pd,
    peak: pg * (1 - pd),
    contraction: (1 - pg) * (1 - pd),
    trough: (1 - pg) * pd,
  };
}

export type TransitionCounts = Record<Phase, Record<Phase, number>>;

export function emptyCounts(): TransitionCounts {
  return Object.fromEntries(PHASES.map((a) => [a, zeroProbs()])) as TransitionCounts;
}

/** Month-to-month phase transitions in one state's history. */
export function transitionCounts(path: readonly GrowthPoint[]): TransitionCounts {
  const c = emptyCounts();
  let prev: { date: string; phase: Phase } | null = null;
  for (const p of path) {
    if (p.d == null) { prev = null; continue; }
    const phase = classifyPhase(p.g, p.d);
    if (prev && monthsBetween(prev.date, p.date) === 1) c[prev.phase][phase]++;
    prev = { date: p.date, phase };
  }
  return c;
}

export function addCounts(a: TransitionCounts, b: TransitionCounts): TransitionCounts {
  const out = emptyCounts();
  for (const i of PHASES) for (const j of PHASES) out[i][j] = a[i][j] + b[i][j];
  return out;
}

export type TransitionMatrix = TransitionCounts;

/** The all-state pattern, Laplace-smoothed so no transition is impossible. */
export function pooledMatrix(total: TransitionCounts): TransitionMatrix {
  const m = emptyCounts();
  for (const i of PHASES) {
    const row = PHASES.reduce((s, j) => s + total[i][j] + 1, 0);
    for (const j of PHASES) m[i][j] = (total[i][j] + 1) / row;
  }
  return m;
}

/** A state's pattern, pulled toward the pooled one: (counts + k·pooled) / (n + k), per row. */
export function stateMatrix(counts: TransitionCounts, pooled: TransitionMatrix, k: number): TransitionMatrix {
  const m = emptyCounts();
  for (const i of PHASES) {
    const n = PHASES.reduce((s, j) => s + counts[i][j], 0);
    for (const j of PHASES) m[i][j] = (counts[i][j] + k * pooled[i][j]) / (n + k);
  }
  return m;
}

export function propagate(p: PhaseProbs, m: TransitionMatrix, steps: number): PhaseProbs {
  let cur = { ...p };
  for (let s = 0; s < steps; s++) {
    const next = zeroProbs();
    for (const i of PHASES) for (const j of PHASES) next[j] += cur[i] * m[i][j];
    cur = next;
  }
  return cur;
}

/** Unconditional phase frequencies in a set of paths — the "climatology" baseline. */
export function phaseFrequencies(paths: ReadonlyArray<readonly GrowthPoint[]>): PhaseProbs {
  const c = zeroProbs();
  let n = 0;
  for (const path of paths) for (const p of path) {
    if (p.d == null) continue;
    c[classifyPhase(p.g, p.d)]++;
    n++;
  }
  if (n === 0) return { expansion: 0.25, peak: 0.25, contraction: 0.25, trough: 0.25 };
  for (const k of PHASES) c[k] /= n;
  return c;
}

export interface StateCycleForecast {
  state: string;
  /** The last month with a published value, as known. */
  lastObservation: string;
  /** The month the horizon probabilities describe. */
  targetDate: string;
  growthNow: number;
  momentumNow: number;
  nowProbs: PhaseProbs;
  horizonProbs: PhaseProbs;
  mostLikelyNow: Phase;
  mostLikelyAtHorizon: Phase;
  /** Growth (annualised %) at the target month: point and central range. */
  growthRange: { point: number; lo: number; hi: number; level: number };
  /** How much of each estimate came from the state's own history (0..1). */
  ownWeight: { spread: number; transitions: number; range: number };
  historyMonths: number;
}

export type CycleRefusal = { state: string; refused: string };

/**
 * Forecast every state from series AS KNOWN at one moment. The caller must
 * pass as-known data (vintage.ts `asKnownOn`); this function cannot tell a
 * revised series from a real-time one, which is exactly why it is never handed
 * one in a backtest.
 */
export function forecastCyclePhases(seriesByState: ReadonlyMap<string, readonly Point[]>): {
  forecasts: StateCycleForecast[];
  refusals: CycleRefusal[];
  pooled: { matrix: TransitionMatrix; spreadG: number; spreadD: number; climatology: PhaseProbs };
} {
  const P = CYCLE_PARAMS;
  const paths = new Map<string, GrowthPoint[]>();
  for (const [st, pts] of seriesByState) paths.set(st, growthPath(pts));

  // Pooled ingredients across every state with any history.
  let total = emptyCounts();
  const allDg: number[] = [];
  const allDd: number[] = [];
  const allChanges: number[] = [];
  const perState = new Map<string, { dg: number[]; dd: number[]; changes: number[]; counts: TransitionCounts }>();
  for (const [st, path] of paths) {
    const dg: number[] = [], dd: number[] = [], changes: number[] = [];
    const byDate = new Map(path.map((p) => [p.date, p]));
    for (const p of path) {
      const prev = byDate.get(addMonths(p.date, -1));
      if (prev) {
        dg.push(p.g - prev.g);
        if (p.d != null && prev.d != null) dd.push(p.d - prev.d);
      }
      const ahead = byDate.get(addMonths(p.date, P.horizon));
      if (ahead) changes.push(ahead.g - p.g);
    }
    const counts = transitionCounts(path);
    total = addCounts(total, counts);
    allDg.push(...dg); allDd.push(...dd); allChanges.push(...changes);
    perState.set(st, { dg, dd, changes, counts });
  }
  const pooledG = robustSd(allDg) ?? 1;
  const pooledD = robustSd(allDd) ?? 1;
  const matrix = pooledMatrix(total);
  const climatology = phaseFrequencies([...paths.values()]);

  const forecasts: StateCycleForecast[] = [];
  const refusals: CycleRefusal[] = [];
  for (const [st, path] of paths) {
    const pts = seriesByState.get(st) ?? [];
    const last = path[path.length - 1];
    if (pts.length < P.minHistoryMonths || !last || last.d == null) {
      refusals.push({ state: st, refused: `only ${pts.length} months of payroll history as known (need ${P.minHistoryMonths})` });
      continue;
    }
    const lastPoint = pts[pts.length - 1];
    if (lastPoint.date !== last.date) {
      refusals.push({ state: st, refused: `the latest month (${lastPoint.date}) has no six-month comparison (a gap in the series)` });
      continue;
    }
    const s = perState.get(st)!;
    const spreadG = shrink(robustSd(s.dg), s.dg.length, pooledG, P.spreadPoolK);
    const spreadD = shrink(robustSd(s.dd), s.dd.length, pooledD, P.spreadPoolK);
    const nowProbs = phaseProbabilities(last.g, last.d, spreadG, spreadD);
    const nTrans = PHASES.reduce((a, i) => a + PHASES.reduce((b, j) => b + s.counts[i][j], 0), 0);
    const m = stateMatrix(s.counts, matrix, P.transitionPoolK);
    const horizonProbs = propagate(nowProbs, m, P.horizon);
    const sample = pooledSample(s.changes, allChanges, P.intervalPoolK);
    const tail = (1 - P.intervalLevel) / 2;
    const lo = weightedQuantile(sample, tail);
    const hi = weightedQuantile(sample, 1 - tail);
    if (lo == null || hi == null) {
      refusals.push({ state: st, refused: "no six-month growth history to form a range" });
      continue;
    }
    forecasts.push({
      state: st,
      lastObservation: last.date,
      targetDate: addMonths(last.date, P.horizon),
      growthNow: round(last.g, 3),
      momentumNow: round(last.d, 3),
      nowProbs: roundProbs(nowProbs),
      horizonProbs: roundProbs(horizonProbs),
      mostLikelyNow: argmax(nowProbs),
      mostLikelyAtHorizon: argmax(horizonProbs),
      growthRange: { point: round(last.g, 3), lo: round(last.g + lo, 3), hi: round(last.g + hi, 3), level: P.intervalLevel },
      ownWeight: {
        spread: round(s.dg.length / (s.dg.length + P.spreadPoolK), 3),
        transitions: round(nTrans / (nTrans + P.transitionPoolK), 3),
        range: round(s.changes.length / (s.changes.length + P.intervalPoolK), 3),
      },
      historyMonths: pts.length,
    });
  }
  forecasts.sort((a, b) => a.state.localeCompare(b.state));
  refusals.sort((a, b) => a.state.localeCompare(b.state));
  return { forecasts, refusals, pooled: { matrix, spreadG: pooledG, spreadD: pooledD, climatology } };
}

/** The realised phase and growth at one month, from a (later) series. Null when not yet computable. */
export function realisedAt(points: readonly Point[], date: string): { phase: Phase; g: number } | null {
  const path = growthPath(points);
  const p = path.find((x) => x.date === date);
  if (!p || p.d == null) return null;
  return { phase: classifyPhase(p.g, p.d), g: p.g };
}

export function argmax(p: PhaseProbs): Phase {
  let best: Phase = PHASES[0];
  for (const k of PHASES) if (p[k] > p[best]) best = k;
  return best;
}

function roundProbs(p: PhaseProbs): PhaseProbs {
  // Round for storage, then renormalise so the four still sum to 1.
  const r = Object.fromEntries(PHASES.map((k) => [k, Math.max(0, round(p[k], 4))])) as PhaseProbs;
  const s = PHASES.reduce((a, k) => a + r[k], 0) || 1;
  for (const k of PHASES) r[k] = r[k] / s;
  return r;
}

export const PHASE_WORDS: Record<Phase, string> = {
  expansion: "expanding (jobs growing faster)",
  peak: "near a peak (jobs still growing, more slowly)",
  contraction: "contracting (jobs shrinking faster)",
  trough: "near a trough (jobs shrinking, less steeply)",
};
