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
  /** When the decision was recorded (for evidence windowing). Optional/null when unknown. */
  at?: Date | null;
  /**
   * Horizon A2 shadow marker — present when the AUTONOMY gate held this move
   * back (observe block / draft escalate) and the row records the call the
   * autopilot WOULD have made. Read-only evidence for founder-gated promotion
   * cards (shadowAgreement.ts); never a learning input.
   */
  shadow?: { shadowedCapability?: string } | null;
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

// ────────────────────────────────────────────────────────────────────────────
// Impure readers — build DecisionRecords from the real experience log so the
// pure scorer above has live data. Kept below the pure core; the loop, the
// autonomy gate, and the founder surface all consume these. (Wire-for-real:
// decisionEval was dead code until this — there was no source of records.)
// ────────────────────────────────────────────────────────────────────────────

/** The share of resolved decisions that must succeed before autonomy is widened.
 * Cold start (insufficient data) never blocks; only a measured, poor record does. */
export const QUALITY_PROMOTION_FLOOR = Number(
  process.env.AUTOPILOT_QUALITY_PROMOTION_FLOOR ?? 0.5,
);

/**
 * Read recent experiences (optionally for one domain) and map them to the pure
 * DecisionRecord shape. The vote is derived by the SAME honest `outcomeOf` the
 * efficacy model uses — never invented. `predictedSuccess` comes from the row's
 * stored forecast (null if the move carried none). Best-effort: [] on DB error.
 */
export async function buildDecisionRecords(
  domain?: string,
  limit = 200,
): Promise<DecisionRecord[]> {
  try {
    const { db } = await import("../../db");
    const { autopilotExperiences } = await import("@shared/schema");
    const { outcomeOf } = await import("./experienceLog");
    const { desc, eq } = await import("drizzle-orm");
    const base = db.select().from(autopilotExperiences);
    const rows = await (domain
      ? base.where(eq(autopilotExperiences.domain, domain))
      : base
    )
      .orderBy(desc(autopilotExperiences.createdAt))
      .limit(limit);
    return rows.map((r: typeof autopilotExperiences.$inferSelect) => {
      const trace =
        (r.reasoningTrace as {
          senses?: Record<string, unknown>;
          shadow?: boolean;
          shadowedCapability?: string;
        } | null) ?? null;
      const vote = outcomeOf({
        dispatchSuccess: r.dispatchSuccess,
        evalScore: r.evalScore != null ? Number(r.evalScore) : null,
        founderVerdict: r.founderVerdict,
        resolution: r.resolution,
        satisfaction: r.satisfaction,
      });
      return {
        moveKind: r.moveKind,
        domain: r.domain,
        senses: trace?.senses ?? {},
        predictedSuccess: r.predictedSuccess != null ? Number(r.predictedSuccess) : null,
        vote,
        at: r.createdAt ?? null,
        // Horizon A2 — surface the shadow marker verbatim; shadow rows are NOT
        // filtered out (they vote pending until a real signal accretes, which
        // the pure scorer already ignores honestly).
        shadow:
          trace?.shadow === true
            ? {
                shadowedCapability:
                  typeof trace.shadowedCapability === "string" ? trace.shadowedCapability : undefined,
              }
            : null,
      };
    });
  } catch {
    return [];
  }
}

/** Live decision-quality report for a domain (or all domains). */
export async function getDomainDecisionQuality(domain?: string): Promise<DecisionQualityReport> {
  return decisionQualityReport(await buildDecisionRecords(domain));
}

/**
 * Quality gate for autonomy promotion: returns true to HOLD when there is
 * ENOUGH resolved data to trust the number AND the measured success rate is
 * below the floor. Cold start (insufficient) never holds — earn-up stays
 * possible while data accrues; only a proven-poor record blocks widening.
 */
export async function shouldHoldPromotionForQuality(domain: string): Promise<boolean> {
  const report = await getDomainDecisionQuality(domain);
  return report.sufficient && report.successRate !== null && report.successRate < QUALITY_PROMOTION_FLOOR;
}
