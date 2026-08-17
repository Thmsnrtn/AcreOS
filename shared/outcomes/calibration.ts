/**
 * Calibration — the layer above a single variance (Master Audit Section VII D).
 *
 * A variance says one forecast missed. That is nearly useless on its own: every
 * forecast misses, and one miss teaches an investor nothing except, at worst, to
 * distrust a good process because of an unlucky deal (BI178). What is worth
 * knowing is the PATTERN — *this operator's resale assumptions run consistently
 * optimistic* — because that is actionable, and because unlike a single outcome
 * it is a property of the process rather than of luck.
 *
 * WHY THIS IS NOT THE FOUNDER PLANE'S decisionEval
 * ------------------------------------------------
 * `server/services/autopilot/decisionEval.ts` already scores judgement, and it
 * is deliberately not extended here because it measures a different KIND of
 * thing: a probability of success against a binary success/failure vote, via
 * Brier score. That is the right shape for "was the autopilot's confidence
 * warranted".
 *
 * This measures a predicted NUMBER against an actual NUMBER — $58,000 forecast
 * against $54,000 realised — across many decisions, per metric. Brier does not
 * apply and neither does a hit rate. What IS reused is decisionEval's
 * discipline, which is the part that matters: a hard cold-start floor, a refusal
 * to emit a number the data cannot support, and no aggregate score that hides
 * which measurement is weak.
 *
 * PURE: no I/O, no clock, no database. The store feeds it variances.
 *
 * THE THREE RULES THIS FILE EXISTS TO KEEP
 * ----------------------------------------
 * 1. REFUSE BELOW THE FLOOR. Three outcomes is an anecdote. Reporting "you run
 *    optimistic" from it would be fabrication wearing a statistic's clothes.
 * 2. MEDIAN, NEVER MEAN. One deal that went sideways by 10x would drag a mean
 *    into a number describing nothing.
 * 3. NEVER SCORE THE OPERATOR. Calibration describes a forecasting tendency, not
 *    a person's skill, and it never says a decision was right or wrong.
 */

import { metricById, type MetricUnit } from "../economics/scenario";
import type { MetricVariance } from "./outcome";

/** Bump when the calibration SHAPE changes, not when the maths is tuned. */
export const CALIBRATION_SHAPE_VERSION = 1 as const;

/**
 * The fewest COMPARED pairs from which a directional claim can be made at all.
 *
 * Six, and the number is derived rather than chosen. Direction is a two-sided
 * sign test: with `n` comparisons all missing the same way, the probability of
 * that under an unbiased forecaster is `2 × 2^-n`. At n=6 that is 0.031, the
 * first n at which even a UNANIMOUS result clears 0.05; at n=5 it is 0.0625,
 * so five outcomes cannot establish a direction however lopsided they look.
 *
 * A floor picked for feeling right would be the fabrication this module exists
 * to prevent, so it is picked at the point below which no evidence is possible.
 */
export const MIN_COMPARISONS_FOR_DIRECTION = 6;

/** How a forecast tends to miss. About the FORECAST, never about the operator. */
export type CalibrationBias = "optimistic" | "pessimistic" | "centred";

export interface MetricCalibration {
  metricId: string;
  label: string;
  unit: MetricUnit;
  /** Outcomes that produced a predicted/actual PAIR for this metric. */
  comparedCount: number;
  /**
   * Predicted and then never measured. Carried, not dropped: a metric forecast
   * forty times and measured twice has a calibration built on two points, and a
   * reader who cannot see that will read it as built on forty.
   */
  unmeasuredCount: number;
  /**
   * Compared, but with a predicted value of zero — so no relative error exists
   * (dividing by zero yields a confident-looking Infinity). Counted separately
   * because these pairs are real comparisons that cannot inform a percentage.
   */
  unscaledCount: number;
  /**
   * `calibrated` only when there is enough to say something. Otherwise
   * `insufficient`, and every derived field below is ABSENT rather than null —
   * an absent field cannot be rendered as a zero.
   */
  state: "calibrated" | "insufficient";
  /**
   * Median of (actual − predicted) / |predicted|. Median rather than mean so a
   * single outlier cannot define the number.
   */
  medianRelativeError?: number;
  /** Median of (actual − predicted), in the metric's own unit. */
  medianDelta?: number;
  /**
   * Direction, and it is only ever non-`centred` when the sign test clears
   * 0.05. A 7-of-10 lean is not a finding, and naming it one is how noise
   * becomes advice.
   */
  bias?: CalibrationBias;
  /** How many of the compared pairs missed in the majority direction. */
  majorityDirectionCount?: number;
  /** Two-sided sign-test probability of that split under an unbiased forecast. */
  directionProbability?: number;
  /** Plain-language reasons, always present — including when refusing. */
  factors: string[];
}

export interface CalibrationReport {
  shapeVersion: number;
  /** How many outcomes were considered in total. */
  outcomeCount: number;
  /**
   * Per metric, sorted by id. Deliberately NO overall score: a single number
   * mixing a cents metric with a ratio metric would be arithmetic on
   * incompatible units, and it would hide exactly which measurement is thin.
   */
  metrics: MetricCalibration[];
}

// ── Maths (small, exact, dependency-free) ────────────────────────────────────

/** Median of a non-empty list. Even lengths average the middle pair. */
function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** n choose k, exact for the small n this module deals in. */
function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return Math.round(r);
}

/**
 * Two-sided sign test: the probability of seeing at least `k` of `n` land the
 * same way if the forecaster were unbiased.
 *
 * Exact rather than a normal approximation, because n here is small and an
 * approximation at n=7 is the sort of quiet inaccuracy this file is about.
 */
export function signTestProbability(n: number, k: number): number {
  if (n === 0) return 1;
  const hi = Math.max(k, n - k);
  let tail = 0;
  for (let i = hi; i <= n; i++) tail += choose(n, i);
  return Math.min(1, (2 * tail) / 2 ** n);
}

// ── The report ──────────────────────────────────────────────────────────────

/**
 * Aggregate many outcomes' variances into a per-metric calibration.
 *
 * @param variancesPerOutcome one entry per OUTCOME, each the full
 *   `computeVariance` result for that outcome. Passing the per-outcome grouping
 *   rather than a flat list is what lets `outcomeCount` be honest.
 */
export function computeCalibration(
  variancesPerOutcome: readonly (readonly MetricVariance[])[],
): CalibrationReport {
  const compared = new Map<string, MetricVariance[]>();
  const unmeasured = new Map<string, number>();

  for (const one of variancesPerOutcome) {
    for (const v of one) {
      if (v.state === "compared") {
        const g = compared.get(v.metricId);
        if (g) g.push(v);
        else compared.set(v.metricId, [v]);
      } else if (v.state === "unmeasured") {
        unmeasured.set(v.metricId, (unmeasured.get(v.metricId) ?? 0) + 1);
      }
      // `unpredicted` is deliberately not counted here. It says the DECISION
      // made no forecast, which is a fact about coverage rather than about how
      // good the forecasts that were made turned out to be.
    }
  }

  const ids = [...new Set([...compared.keys(), ...unmeasured.keys()])].sort();

  const metrics: MetricCalibration[] = ids.map((metricId) => {
    const pairs = compared.get(metricId) ?? [];
    const spec = metricById(metricId);
    const scaled = pairs.filter((p) => p.relative !== undefined);
    const base: MetricCalibration = {
      metricId,
      label: spec?.label ?? metricId,
      unit: spec?.unit ?? "ratio",
      comparedCount: pairs.length,
      unmeasuredCount: unmeasured.get(metricId) ?? 0,
      unscaledCount: pairs.length - scaled.length,
      state: "insufficient",
      factors: [],
    };

    if (pairs.length < MIN_COMPARISONS_FOR_DIRECTION) {
      return {
        ...base,
        factors: [
          `${pairs.length} measured outcome(s); ${MIN_COMPARISONS_FOR_DIRECTION} ` +
            `are needed before any direction can be distinguished from chance`,
        ],
      };
    }

    // Direction is computed over ALL compared pairs — a zero-predicted pair
    // still has a sign — while the relative error uses only the scaled ones.
    const deltas = pairs.map((p) => p.delta!);
    const overCount = deltas.filter((d) => d > 0).length;
    const underCount = deltas.filter((d) => d < 0).length;
    const decisive = overCount + underCount;
    const majority = Math.max(overCount, underCount);
    const probability = signTestProbability(decisive, majority);

    const higherIsBetter = spec?.higherIsBetter ?? true;
    // "Optimistic" means the forecast was more FAVOURABLE than reality, which
    // depends on which way the metric reads well. A break-even sale price
    // (higherIsBetter: false) predicted BELOW the actual was the optimistic
    // forecast, even though the number was smaller.
    const leanedOver = overCount > underCount;
    const bias: CalibrationBias =
      probability >= 0.05 || overCount === underCount
        ? "centred"
        : leanedOver === higherIsBetter
          ? "pessimistic" // reality beat the forecast in the good direction
          : "optimistic";

    const factors = [
      `${pairs.length} measured outcome(s)`,
      `${majority} of ${decisive} missed the same way (p=${probability.toFixed(3)})`,
    ];
    if (base.unmeasuredCount > 0) {
      factors.push(
        `${base.unmeasuredCount} further decision(s) predicted this and never measured it`,
      );
    }
    if (base.unscaledCount > 0) {
      factors.push(
        `${base.unscaledCount} comparison(s) predicted zero, so contribute a ` +
          `direction but no percentage`,
      );
    }
    if (bias === "centred") {
      factors.push(
        probability >= 0.05
          ? "the direction is not distinguishable from chance"
          : "over- and under-shoots are balanced",
      );
    }

    return {
      ...base,
      state: "calibrated",
      medianDelta: median(deltas),
      ...(scaled.length > 0
        ? { medianRelativeError: median(scaled.map((p) => p.relative!)) }
        : {}),
      bias,
      majorityDirectionCount: majority,
      directionProbability: probability,
      factors,
    };
  });

  return {
    shapeVersion: CALIBRATION_SHAPE_VERSION,
    outcomeCount: variancesPerOutcome.length,
    metrics,
  };
}

/**
 * One honest line per metric.
 *
 * Says what the forecasts did. Never says the operator is bad at this, never
 * says a decision was right or wrong (BI178), and never turns an insufficient
 * sample into a hedged claim — "not enough yet" is the whole sentence.
 */
export function describeCalibration(report: CalibrationReport): string[] {
  return report.metrics.map((m) => {
    if (m.state === "insufficient") {
      return `${m.label}: not enough measured outcomes yet (${m.comparedCount}).`;
    }
    if (m.bias === "centred") {
      return `${m.label}: ${m.comparedCount} measured; no consistent direction.`;
    }
    const pct =
      m.medianRelativeError === undefined
        ? ""
        : ` by a median of ${Math.abs(m.medianRelativeError * 100).toFixed(0)}%`;
    // The NUMERIC direction comes from the median delta, never from the bias.
    // Those two agree only for higher-is-better metrics: an OPTIMISTIC
    // break-even forecast is one that came in BELOW the actual, because a lower
    // break-even is the favourable one. Deriving "above/below" from the bias
    // word would state the opposite of what happened for every
    // lower-is-better metric.
    const direction = (m.medianDelta ?? 0) < 0 ? "above" : "below";
    return (
      `${m.label}: over ${m.comparedCount} measured outcome(s), forecasts ran ` +
      `${direction} what happened${pct} — ${m.bias} for this metric.`
    );
  });
}
