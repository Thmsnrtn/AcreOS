/**
 * The twin's macro inputs, calibrated on PUBLIC priors (W4).
 *
 * The twin used to have no calendar: a postcard in January met the same
 * seller as one in June, and no simulated year could contain a downturn. Its
 * macro inputs now come from shared/forecasting/data/publicPriors.json, which
 * scripts/forecasting/build-public-priors.ts builds from Census permits, BLS
 * payrolls (via ALFRED) and USDA land values — read here, never copied, so the
 * twin and the forecasting engines cannot drift apart.
 *
 * What is MEASURED and what is ASSUMED is kept apart in parameters.ts: the
 * seasonal SHAPE is measured on building permits; that seller interest follows
 * it is an assumption, labelled there.
 */
import { PUBLIC_PRIORS, seasonalFactor } from "../../../shared/forecasting/publicPriors";
import { PHASES, propagate, type Phase, type PhaseProbs } from "../../../shared/forecasting/cyclePhase";
import { Rng } from "./rng";

/** Seller-interest multiplier for a parcel's state in a calendar month (1 = an average month). */
export function seasonalDemand(state: string, utcMs: number): number {
  const month = new Date(utcMs).getUTCMonth() + 1;
  return seasonalFactor(state, month) ?? 1;
}

/**
 * A seeded path of job-market phases, month by month, drawn from the public
 * all-state transition pattern. For stress years: start it in "contraction".
 */
export function macroPhasePath(seed: number, months: number, start: Phase = "expansion"): Phase[] {
  const rng = new Rng(seed).fork("macro-phase");
  const m = PUBLIC_PRIORS.cycle.monthlyTransitions;
  const out: Phase[] = [start];
  for (let i = 1; i < months; i++) {
    const row = m[out[i - 1]];
    out.push(rng.categorical<Phase>(Object.fromEntries(PHASES.map((p) => [p, row[p]])) as Record<Phase, number>));
  }
  return out;
}

/** The public pattern's phase mix after `months` from a starting phase (no randomness). */
export function phaseMixAfter(start: Phase, months: number): PhaseProbs {
  const p = Object.fromEntries(PHASES.map((x) => [x, x === start ? 1 : 0])) as PhaseProbs;
  return propagate(p, PUBLIC_PRIORS.cycle.monthlyTransitions, months);
}
