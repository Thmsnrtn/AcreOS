/**
 * Founder Autopilot — decision-quality eval harness (Elite roadmap E1, Leap 2).
 *
 * "You can't get elite at what you can't measure." This is the keystone of the
 * intelligence roadmap: a standing harness that scores the BRAIN'S JUDGMENT —
 * not just whether actions ran, but whether the decisions were GOOD. It is the
 * thing that turns every future intelligence upgrade from "we hope it helped"
 * into "we measured +N% decision quality."
 *
 * What it does, honestly:
 *   • hit-rate + calibration + Brier over RESOLVED decisions (real signal);
 *   • a replay engine to run a CANDIDATE policy over logged situations (the
 *     machinery for A/B-ing brain policies offline);
 *   • an honest off-policy PROXY (agreement-with-historical-wins) — clearly
 *     labelled as necessary-not-sufficient, because true off-policy value needs
 *     inverse-propensity weighting or a world model (a later leap), and we will
 *     not fake a number we can't yet earn.
 *
 * Cold-start-safe: with too few resolved decisions it returns `sufficient:false`
 * and refuses to pretend. Pure → exhaustively unit-testable.
 */
import { brierScore, type CalibrationPair } from "./forecast";

export type DecisionVote = "success" | "failure" | "pending";

export interface DecisionRecord {
  moveKind: string;
  domain: string;
  /** The senses at decision time (the situation), for replay. */
  senses: Record<string, unknown>;
  /** The brain's forecast success probability at decision time (0..1), if any. */
  predictedSuccess: number | null;
  /** The resolved real outcome. */
  vote: DecisionVote;
}

/** Below this many RESOLVED decisions, the numbers aren't trustworthy. */
export const MIN_RESOLVED_FOR_SIGNAL = 20;

export interface DecisionQualityReport {
  total: number;
  resolved: number;
  /** Fraction of resolved decisions that succeeded (the brain's hit rate). */
  successRate: number | null;
  /** Mean |predicted − actual| over decisions that carried a forecast AND
   *  resolved (lower = better calibrated). null if too few. */
  calibrationError: number | null;
  /** Brier score over the (predicted, actual) decision pairs. */
  brier: number | null;
  /** True only when there's enough resolved data to trust the above. */
  sufficient: boolean;
}

function isResolved(v: DecisionVote): v is "success" | "failure" {
  return v === "success" || v === "failure";
}

/** Score the brain's decision quality over a window of records. Pure. */
export function decisionQualityReport(records: DecisionRecord[]): DecisionQualityReport {
  const resolved = records.filter((r) => isResolved(r.vote));
  const n = resolved.length;
  const sufficient = n >= MIN_RESOLVED_FOR_SIGNAL;

  const successRate = n > 0 ? resolved.filter((r) => r.vote === "success").length / n : null;

  // Calibration: only decisions that carried a forecast.
  const pairs: CalibrationPair[] = resolved
    .filter((r) => r.predictedSuccess != null)
    .map((r) => ({ predicted: r.predictedSuccess as number, actual: (r.vote === "success" ? 1 : 0) as 0 | 1 }));
  const calibrationError =
    pairs.length > 0 ? pairs.reduce((acc, p) => acc + Math.abs(p.predicted - p.actual), 0) / pairs.length : null;

  return {
    total: records.length,
    resolved: n,
    successRate,
    calibrationError,
    brier: brierScore(pairs),
    sufficient,
  };
}

/**
 * Replay a CANDIDATE policy over the logged situations: for each record, what
 * would the policy choose? The machinery for offline A/B of brain policies.
 * `policyFn` takes the situation and returns a move-kind. Pure given a pure fn.
 */
export function replayPolicy(
  records: DecisionRecord[],
  policyFn: (senses: Record<string, unknown>) => string,
): Array<{ chosen: string; actual: string; vote: DecisionVote }> {
  return records.map((r) => ({ chosen: policyFn(r.senses), actual: r.moveKind, vote: r.vote }));
}

export interface AgreementProxy {
  /** Of the historically-SUCCESSFUL decisions, the share the candidate policy
   *  would have made the same call on. Necessary-not-sufficient for "better". */
  agreementOnWins: number | null;
  /** Of the historically-FAILED decisions, the share the candidate AVOIDS
   *  (picks something different). Higher = it dodges known mistakes. */
  divergenceOnLosses: number | null;
  winsN: number;
  lossesN: number;
  /** Honest caveat carried with the numbers. */
  caveat: string;
}

/**
 * An HONEST off-policy proxy from a replay: does the candidate agree with the
 * decisions that worked, and diverge from the ones that didn't? This is a
 * proxy, NOT a value estimate — true off-policy value needs IPW or a world
 * model (a later leap). Labelled so no one mistakes it for ground truth. Pure.
 */
export function agreementProxy(replay: ReturnType<typeof replayPolicy>): AgreementProxy {
  const wins = replay.filter((r) => r.vote === "success");
  const losses = replay.filter((r) => r.vote === "failure");
  return {
    agreementOnWins: wins.length > 0 ? wins.filter((r) => r.chosen === r.actual).length / wins.length : null,
    divergenceOnLosses: losses.length > 0 ? losses.filter((r) => r.chosen !== r.actual).length / losses.length : null,
    winsN: wins.length,
    lossesN: losses.length,
    caveat: "Proxy only: agreement-with-wins + divergence-from-losses is necessary-not-sufficient for a better policy. True off-policy value needs IPW / a world model.",
  };
}

/** One-line decision-quality summary for the daily letter / board report. Pure. */
export function decisionEvalLine(report: DecisionQualityReport): string {
  if (!report.sufficient) {
    return `Decision quality: ${report.resolved}/${MIN_RESOLVED_FOR_SIGNAL} resolved decisions — not enough to score yet (cold start).`;
  }
  const sr = Math.round((report.successRate ?? 0) * 100);
  const cal = report.calibrationError != null ? `, calibration err ${report.calibrationError.toFixed(2)}` : "";
  return `Decision quality: ${sr}% hit-rate over ${report.resolved} resolved${cal}.`;
}
