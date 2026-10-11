/**
 * Scoring forecasts — and the gate a forecast must pass before any customer
 * sees one.
 *
 * Three questions, each a number:
 *   - accuracy:    Brier score of the phase probabilities (0 perfect, 2 worst
 *                  for four phases), and its skill against two dumb rivals —
 *                  "climatology" (how often each phase happens) and
 *                  "persistence" (today's probabilities, unchanged);
 *   - calibration: when the model said 30%, did it happen ~30% of the time?
 *                  (expected calibration error over ten probability bins);
 *   - coverage:    did the 80% ranges contain the outcome ~80% of the time?
 *
 * THE CUSTOMER GATE (`customerForecastGate`). A forecast reaches a customer
 * surface only on a LIVE scored track record — forecasts frozen before their
 * outcome was known, then scored when it arrived. A backtest, however careful,
 * is the model graded on the past by its author; it is shown to the founder,
 * labelled, and never counts here. Pure; browser-safe.
 */
import { PHASES, type Phase, type PhaseProbs } from "./cyclePhase";
import { round } from "./stats";

export function brierMulti(p: PhaseProbs, outcome: Phase): number {
  return PHASES.reduce((s, k) => s + (p[k] - (k === outcome ? 1 : 0)) ** 2, 0);
}

export function logScore(p: PhaseProbs, outcome: Phase): number {
  return -Math.log(Math.max(p[outcome], 1e-6));
}

export interface ReliabilityBin {
  lo: number;
  hi: number;
  n: number;
  meanPredicted: number | null;
  observedRate: number | null;
}

/** Reliability over every (probability, happened?) pair, ten equal-width bins. */
export function reliability(pairs: ReadonlyArray<{ p: number; hit: boolean }>, bins = 10): { bins: ReliabilityBin[]; ece: number | null; n: number } {
  const out: ReliabilityBin[] = [];
  for (let b = 0; b < bins; b++) out.push({ lo: b / bins, hi: (b + 1) / bins, n: 0, meanPredicted: null, observedRate: null });
  const sums = out.map(() => ({ p: 0, h: 0 }));
  for (const { p, hit } of pairs) {
    const b = Math.min(bins - 1, Math.max(0, Math.floor(p * bins)));
    out[b].n++;
    sums[b].p += p;
    sums[b].h += hit ? 1 : 0;
  }
  let ece = 0;
  const n = pairs.length;
  for (let b = 0; b < bins; b++) {
    if (out[b].n === 0) continue;
    out[b].meanPredicted = round(sums[b].p / out[b].n, 4);
    out[b].observedRate = round(sums[b].h / out[b].n, 4);
    ece += (out[b].n / n) * Math.abs(sums[b].p / out[b].n - sums[b].h / out[b].n);
  }
  return { bins: out, ece: n === 0 ? null : round(ece, 4), n };
}

export interface PhaseScoreRecord {
  probs: PhaseProbs;
  outcome: Phase;
  climatology: PhaseProbs;
  persistence: PhaseProbs;
}

export interface PhaseScoreSummary {
  n: number;
  brier: number | null;
  brierClimatology: number | null;
  brierPersistence: number | null;
  /** 1 − brier / brierClimatology. Above 0 = better than knowing only the base rates. */
  skillVsClimatology: number | null;
  skillVsPersistence: number | null;
  logScore: number | null;
  /** Share of forecasts whose most likely phase happened. */
  hitRate: number | null;
  calibration: { ece: number | null; bins: ReliabilityBin[] };
}

export function summarisePhaseScores(rs: readonly PhaseScoreRecord[]): PhaseScoreSummary {
  const n = rs.length;
  if (n === 0) {
    return { n: 0, brier: null, brierClimatology: null, brierPersistence: null, skillVsClimatology: null, skillVsPersistence: null, logScore: null, hitRate: null, calibration: { ece: null, bins: reliability([]).bins } };
  }
  let b = 0, bc = 0, bp = 0, ls = 0, hits = 0;
  const pairs: Array<{ p: number; hit: boolean }> = [];
  for (const r of rs) {
    b += brierMulti(r.probs, r.outcome);
    bc += brierMulti(r.climatology, r.outcome);
    bp += brierMulti(r.persistence, r.outcome);
    ls += logScore(r.probs, r.outcome);
    const top = PHASES.reduce((a, k) => (r.probs[k] > r.probs[a] ? k : a), PHASES[0]);
    if (top === r.outcome) hits++;
    for (const k of PHASES) pairs.push({ p: r.probs[k], hit: k === r.outcome });
  }
  const rel = reliability(pairs);
  return {
    n,
    brier: round(b / n, 4),
    brierClimatology: round(bc / n, 4),
    brierPersistence: round(bp / n, 4),
    skillVsClimatology: bc > 0 ? round(1 - b / bc, 4) : null,
    skillVsPersistence: bp > 0 ? round(1 - b / bp, 4) : null,
    logScore: round(ls / n, 4),
    hitRate: round(hits / n, 4),
    calibration: { ece: rel.ece, bins: rel.bins },
  };
}

export interface IntervalScoreSummary {
  n: number;
  nominal: number;
  coverage: number | null;
  /** Mean width of the ranges, in the target's unit. */
  meanWidth: number | null;
  /** Mean absolute error of the point, in the target's unit. */
  meanAbsError: number | null;
}

export function summariseIntervals(rs: ReadonlyArray<{ lo: number; hi: number; point: number; actual: number }>, nominal: number): IntervalScoreSummary {
  const n = rs.length;
  if (n === 0) return { n: 0, nominal, coverage: null, meanWidth: null, meanAbsError: null };
  let hit = 0, w = 0, e = 0;
  for (const r of rs) {
    if (r.actual >= r.lo && r.actual <= r.hi) hit++;
    w += r.hi - r.lo;
    e += Math.abs(r.actual - r.point);
  }
  return { n, nominal, coverage: round(hit / n, 4), meanWidth: round(w / n, 3), meanAbsError: round(e / n, 3) };
}

// ── The customer gate ─────────────────────────────────────────────────────

export const CUSTOMER_GATE = {
  /** Live forecasts scored (frozen before the outcome, scored after). */
  minLiveScored: 60,
  /** Distinct issue months among them — one lucky month is not a record. */
  minDistinctMonths: 6,
  /** Must beat knowing only the base rates. */
  minSkillVsClimatology: 0,
  /** Ranges must cover within this distance of nominal. */
  coverageTolerance: 0.1,
  /** Calibration error ceiling. */
  maxEce: 0.1,
} as const;

export interface LiveTrackRecord {
  phase: PhaseScoreSummary;
  ranges: IntervalScoreSummary;
  distinctIssueMonths: number;
}

/**
 * May a forecast from this engine be shown to a customer? Only on a live
 * record that clears every bar; every unmet bar is named, so the refusal
 * says what would change it. A backtest is not a parameter here, on purpose.
 */
export function customerForecastGate(live: LiveTrackRecord): { allowed: boolean; unmet: string[] } {
  const G = CUSTOMER_GATE;
  const unmet: string[] = [];
  if (live.phase.n < G.minLiveScored) unmet.push(`${live.phase.n} of ${G.minLiveScored} live forecasts scored`);
  if (live.distinctIssueMonths < G.minDistinctMonths) unmet.push(`${live.distinctIssueMonths} of ${G.minDistinctMonths} months of live forecasts`);
  if (live.phase.skillVsClimatology == null || live.phase.skillVsClimatology <= G.minSkillVsClimatology) unmet.push("not yet shown to beat the base rates live");
  if (live.ranges.coverage == null || Math.abs(live.ranges.coverage - live.ranges.nominal) > G.coverageTolerance) unmet.push("range coverage not yet within 10 points of nominal live");
  if (live.phase.calibration.ece == null || live.phase.calibration.ece > G.maxEce) unmet.push("calibration error not yet under 0.10 live");
  return { allowed: unmet.length === 0, unmet };
}
