/**
 * The committed public priors and backtest record, typed.
 *
 * Both files are BUILT, never typed in: scripts/forecasting/build-public-priors.ts
 * computes them from public downloads (BLS payrolls via ALFRED, Census permits,
 * USDA land values) with the same engines the live ledger runs. Every number
 * here therefore traces to a public series and a function; the build date and
 * sources travel with the data.
 *
 * Browser-safe.
 */
import priorsJson from "./data/publicPriors.json";
import backtestJson from "./data/backtest-2026-10.json";
import type { PhaseProbs, StateCycleForecast, TransitionMatrix } from "./cyclePhase";
import type { StateLandValueForecast } from "./landValue";
import type { IntervalScoreSummary, PhaseScoreSummary } from "./scoring";

export interface PublicPriors {
  builtOn: string;
  sources: { payrolls: string; permits: string; landValues: string };
  cycle: {
    engineId: string;
    engineVersion: string;
    monthlyTransitions: TransitionMatrix;
    climatology: PhaseProbs;
    contraction: { basis: string; count: number; medianMonths: number | null; gfcMedianMonths: number | null; gfcBasis: string };
    nowcast: { asOf: string; label: string; forecasts: StateCycleForecast[] };
  };
  seasonality: {
    engineId: string;
    engineVersion: string;
    basis: string;
    national: number[] | null;
    states: Array<{ state: string; factors: number[]; yearsOfHistory: number; ownWeight: number }>;
  };
  landValue: {
    engineId: string;
    engineVersion: string;
    annualGrowthAllStates: { basis: string; n: number; p10: number; p50: number; p90: number };
    nextYear: { knownThrough: number; label: string; forecasts: StateLandValueForecast[]; fit: { a: number; b: number; n: number } | null };
  };
}

export interface BacktestRecord {
  id: string;
  builtOn: string;
  method: string;
  cycle: {
    engineId: string;
    engineVersion: string;
    horizonMonths: number;
    origins: number;
    firstOrigin: string | null;
    lastOrigin: string | null;
    realtime: { phase: PhaseScoreSummary; ranges: IntervalScoreSummary };
    revisedDataForComparison: { phase: PhaseScoreSummary; ranges: IntervalScoreSummary; note: string };
    tennessee: {
      phase: PhaseScoreSummary;
      ranges: IntervalScoreSummary;
      trail: Array<{ origin: string; lastObservation: string; target: string; mostLikely: string; p: number; realised: string | null }>;
    };
    perOrigin: Array<{ origin: string; states: number; scored: number; brier: number | null; skillVsClimatology: number | null; coverage: number | null }>;
  };
  landValue: {
    engineId: string;
    engineVersion: string;
    knownThrough: { first: number; last: number };
    scored: IntervalScoreSummary;
    baselines: { sameAsLastYearMeanAbsError: number; nationalMeanMeanAbsError: number; n: number };
    perYear: Array<{ knownThrough: number; target: number; scored: number; coverage: number | null; meanAbsError: number | null }>;
  };
}

export const PUBLIC_PRIORS = priorsJson as unknown as PublicPriors;
export const BACKTEST_RECORD = backtestJson as unknown as BacktestRecord;

/** Seasonal factor for a state and calendar month (1–12); the national factor when the state is absent; null when neither exists. */
export function seasonalFactor(state: string, month: number): number | null {
  if (!(month >= 1 && month <= 12)) return null;
  const s = PUBLIC_PRIORS.seasonality.states.find((x) => x.state === state.toUpperCase());
  const f = s?.factors[month - 1] ?? PUBLIC_PRIORS.seasonality.national?.[month - 1];
  return f ?? null;
}

/**
 * How long a SEVERE downturn lasts, from public history: the median length of
 * the state payroll contractions that began in the 2008 recession. The
 * stress scenario uses this rather than the all-history median (a short dip),
 * because a stress test should be one the business would actually feel.
 */
export function publicStressLength(): { months: number; basis: string } | null {
  const c = PUBLIC_PRIORS.cycle.contraction;
  if (c.gfcMedianMonths == null) return null;
  return { months: c.gfcMedianMonths, basis: `median length of state payroll contractions in the 2008 recession — ${c.gfcBasis} (BLS via FRED, built ${PUBLIC_PRIORS.builtOn})` };
}
