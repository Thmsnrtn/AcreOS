/**
 * Founder Autopilot — calibrated foresight (an honest world model).
 *
 * Two pure capabilities, both grounded ONLY in the real Experience Log:
 *
 *  1. forecastMove() — before acting, predict the outcome from what actually
 *     happened the last N times something like this ran: a success probability
 *     (Laplace-smoothed over real successes/failures), an evidence count, a
 *     confidence tier, and the typical cost. This is RETRODICTION over real
 *     history, never an invented projection — with no track record it says so.
 *
 *  2. calibration — the system measures whether its OWN predictions come true.
 *     Each forecast's probability is stored; when the outcome resolves we have a
 *     (predicted, actual) pair. The Brier score + reliability curve tell the
 *     founder how well-calibrated the system is — turning "trust me" into "here
 *     is my track record of being right." Over-confidence (degrading
 *     calibration) is itself a safety signal.
 *
 * Everything here is pure + deterministic → exhaustively testable.
 */

export interface ForecastInput {
  successes: number;
  failures: number;
  /** Resolved costs (USD) of similar past actions, for the typical-cost estimate. */
  costSamplesUsd?: number[];
}

export type Confidence = "none" | "low" | "medium" | "high";

export interface MoveForecast {
  /** Laplace-smoothed success probability over real outcomes. */
  successProb: number;
  /** Evidence count (resolved successes + failures). */
  n: number;
  confidence: Confidence;
  /** Typical (median) cost from history, or null if unknown. */
  medianCostUsd: number | null;
}

function confidenceFor(n: number): Confidence {
  if (n <= 0) return "none";
  if (n < 3) return "low";
  if (n < 10) return "medium";
  return "high";
}

function median(xs: number[]): number | null {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/**
 * Predict a move's outcome from its real track record. Pure + total. With no
 * history the success probability is the honest uninformative prior (0.5) at
 * `none` confidence — never a fabricated number.
 */
export function forecastMove(input: ForecastInput): MoveForecast {
  const successes = Math.max(0, input.successes);
  const failures = Math.max(0, input.failures);
  const n = successes + failures;
  return {
    successProb: (1 + successes) / (2 + n), // Laplace smoothing → 0.5 at n=0
    n,
    confidence: confidenceFor(n),
    medianCostUsd: median(input.costSamplesUsd ?? []),
  };
}

/** A one-line honest forecast for the founder ask / simulation. */
export function renderForecast(f: MoveForecast): string {
  if (f.confidence === "none") {
    return "Forecast: no track record yet — this is a first try, so I can't predict the outcome honestly.";
  }
  const pct = Math.round(f.successProb * 100);
  const cost = f.medianCostUsd != null ? `, typically ~$${f.medianCostUsd.toFixed(2)}` : "";
  return `Forecast: based on ${f.n} similar past run${f.n === 1 ? "" : "s"}, ~${pct}% have gone well (${f.confidence} confidence)${cost}.`;
}

// ── Calibration: does the system's confidence match reality? ─────────────────

export interface CalibrationPair {
  predicted: number; // 0..1
  actual: 0 | 1;
}

export interface CalibrationReport {
  /** Mean squared error of predictions; lower is better. Null if no data. */
  brier: number | null;
  n: number;
  grade: "unproven" | "well-calibrated" | "fair" | "over-confident";
  /** Reliability curve — predicted-vs-actual by bucket. */
  bins: Array<{ from: number; to: number; predictedMean: number; actualRate: number; n: number }>;
}

/** Brier score over (predicted, actual) pairs. Pure. Null when empty. */
export function brierScore(pairs: CalibrationPair[]): number | null {
  if (pairs.length === 0) return null;
  const sum = pairs.reduce((acc, p) => acc + (clamp01(p.predicted) - p.actual) ** 2, 0);
  return sum / pairs.length;
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0.5;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Reliability curve: bucket predictions and compare mean-predicted vs actual rate. */
export function reliabilityCurve(pairs: CalibrationPair[], buckets = 5): CalibrationReport["bins"] {
  const bins = Array.from({ length: buckets }, (_, i) => ({
    from: i / buckets,
    to: (i + 1) / buckets,
    predictedSum: 0,
    actualSum: 0,
    n: 0,
  }));
  for (const p of pairs) {
    const pred = clamp01(p.predicted);
    const idx = Math.min(buckets - 1, Math.floor(pred * buckets));
    bins[idx].predictedSum += pred;
    bins[idx].actualSum += p.actual;
    bins[idx].n += 1;
  }
  return bins.map((b) => ({
    from: b.from,
    to: b.to,
    predictedMean: b.n ? b.predictedSum / b.n : 0,
    actualRate: b.n ? b.actualSum / b.n : 0,
    n: b.n,
  }));
}

/**
 * Full calibration report. Grade thresholds are deliberately conservative.
 * "over-confident" specifically flags when predictions run HIGHER than reality
 * (the dangerous direction) — that's the safety signal that should tighten
 * autonomy, not just a high Brier.
 */
export function calibrationReport(pairs: CalibrationPair[], minN = 10): CalibrationReport {
  const n = pairs.length;
  const brier = brierScore(pairs);
  const bins = reliabilityCurve(pairs);
  if (brier == null || n < minN) {
    return { brier, n, grade: "unproven", bins };
  }
  const avgPredicted = pairs.reduce((a, p) => a + clamp01(p.predicted), 0) / n;
  const avgActual = pairs.reduce((a, p) => a + p.actual, 0) / n;
  const overconfident = avgPredicted - avgActual > 0.1; // claims more than it delivers
  const grade: CalibrationReport["grade"] = overconfident
    ? "over-confident"
    : brier <= 0.15
      ? "well-calibrated"
      : "fair";
  return { brier, n, grade, bins };
}
