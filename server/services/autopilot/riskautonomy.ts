/**
 * Founder Autopilot — risk-calibrated autonomy.
 *
 * Earned autonomy (the Trust Ledger) answers "can this DOMAIN act on its own?".
 * This adds the second question a real executive asks: "is THIS PARTICULAR
 * action safe to do without checking in?" — gating on the action's own
 * reversibility, value, and novelty, not just the domain's standing.
 *
 * The rule is strictly one-directional: risk can only ADD friction, never
 * remove the earned floor. A trusted domain still escalates a novel, expensive,
 * or irreversible action for a human tap; it never auto-runs something it hasn't
 * earned. (And a low-risk action never gains autonomy the domain hasn't earned.)
 *
 * Pure + deterministic → exhaustively testable. Novelty comes from the real
 * evidence count (forecast n), so "I haven't done this enough to be sure" is an
 * honest signal, not a guess.
 */

export interface RiskFactors {
  /** Can the effect be undone after it lands? */
  reversible: boolean;
  /** Does it reach a customer? */
  customerFacing: boolean;
  /** Hard cost ceiling for the action (USD). */
  predictedCostUsd: number;
  /** Evidence count from history — low = novel/unproven. */
  noveltyN: number;
}

export type RiskTier = "low" | "medium" | "high";

export interface RiskAssessment {
  tier: RiskTier;
  score: number;
  reasons: string[];
}

/** Cost above this is "expensive" for the lean envelope; above the lower bound is "notable". */
export const COST_HIGH_USD = 10;
export const COST_NOTABLE_USD = 3;
/** Below this evidence count an action is genuinely novel. */
export const NOVELTY_MIN_N = 3;
export const NOVELTY_SOME_N = 10;

/** Assess an action's intrinsic risk. Pure + total. */
export function assessRisk(f: RiskFactors): RiskAssessment {
  let score = 0;
  const reasons: string[] = [];

  if (!f.reversible) {
    score += 2;
    reasons.push("it can't be undone once it lands");
  }
  if (f.customerFacing) {
    score += 2;
    reasons.push("it reaches a customer");
  }
  if (f.predictedCostUsd > COST_HIGH_USD) {
    score += 2;
    reasons.push(`it could cost up to $${f.predictedCostUsd.toFixed(2)}`);
  } else if (f.predictedCostUsd > COST_NOTABLE_USD) {
    score += 1;
    reasons.push(`it could cost up to $${f.predictedCostUsd.toFixed(2)}`);
  }
  if (f.noveltyN < NOVELTY_MIN_N) {
    score += 2;
    reasons.push("I've barely done this before, so I can't be sure how it'll go");
  } else if (f.noveltyN < NOVELTY_SOME_N) {
    score += 1;
    reasons.push("I don't have much track record with this yet");
  }

  const tier: RiskTier = score >= 4 ? "high" : score >= 2 ? "medium" : "low";
  return { tier, score, reasons };
}

/**
 * Risk only ever TIGHTENS an otherwise-permitted decision. Given the domain
 * gate's status ("pass" when earned) and the assessment, return whether this
 * specific action should still escalate for a human tap. Pure.
 *
 * `loopConfidence` (0..1) makes calibration a HARD, graduated gate (frontier #3,
 * promoting T2.4's soft throttle): the worse the brain's forecasts are
 * calibrated, the lower the bar to escalate. TIGHTEN-ONLY — low confidence can
 * only ADD escalation, never remove it. The ladder:
 *   • OVER-CONFIDENT (loopConfidence ≤ 0.2 — the brain actively claims MORE than
 *     it delivers, the dangerous direction) → a HARD gate: EVERY action escalates,
 *     even a low-risk reversible reflex. An actively-miscalibrated brain auto-runs
 *     NOTHING.
 *   • UNPROVEN/poorly-calibrated (0.2 < loopConfidence < 0.5) → medium AND high
 *     escalate; a genuinely low-risk reversible reflex (which doesn't lean on a
 *     forecast) can still run — calibration gates FORECAST-dependent risk, not
 *     rule-based reflexes.
 *   • CALIBRATED ENOUGH (≥ 0.5, or omitted=1) → only high escalates (the base).
 */
export function shouldEscalateForRisk(
  domainPassed: boolean,
  assessment: RiskAssessment,
  loopConfidence = 1,
): boolean {
  if (!domainPassed) return false;
  // HARD gate (frontier #3): an OVER-CONFIDENT brain auto-runs NOTHING.
  if (loopConfidence <= 0.2) return true;
  if (assessment.tier === "high") return true;
  // Poorly-calibrated ⇒ escalate medium-tier too (reflexes still run).
  if (loopConfidence < 0.5 && assessment.tier === "medium") return true;
  return false;
}
