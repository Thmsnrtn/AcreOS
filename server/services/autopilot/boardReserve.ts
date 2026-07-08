/**
 * Founder Autopilot — the founder-reserve classifier (Elite Vision H4).
 *
 * 99.9% autonomy means the founder is the BOARD, not the operator — contacted
 * only for the irreducible 0.1% that is genuinely theirs to decide. This module
 * draws that line: given a decision's context, is it FOUNDER-RESERVE (must reach
 * the founder, forever) or DELEGABLE (the system handles it once the domain has
 * earned autonomy)?
 *
 * The reserve is the honest ceiling on autonomy — it never empties, by design:
 *   • constitutional changes (immutables can't self-modify);
 *   • capital allocation above a threshold (the founder owns the balance sheet);
 *   • irreversible actions of consequence (riskautonomy escalates these always);
 *   • genuinely novel, no-precedent calls (the learning loop has nothing to draw on);
 *   • the human relationships (key partnerships, VIPs) that ARE the founder.
 *
 * Everything else is delegable — and as a domain earns trust on real outcomes,
 * the system stops asking. The attention-load tracker measures whether the
 * system is honoring the 0.1% target or bothering the founder too much (a
 * calibration signal). Pure → unit-testable.
 */

/** Dollar stakes at/above which capital + irreversible decisions are reserved. */
export const FOUNDER_RESERVE_VALUE_THRESHOLD_USD = 500;

export interface DecisionContext {
  /** Can it be undone cheaply? */
  reversible: boolean;
  /** Dollar stakes of the decision. */
  valueUsd: number;
  /** No precedent in the learning loop (genuinely novel situation). */
  novel: boolean;
  touchesConstitution: boolean;
  touchesCapitalAllocation: boolean;
  /** A key partnership / VIP / human relationship the founder owns. */
  isHumanRelationship: boolean;
  /** Has the owning domain earned autonomy for this class of action? */
  domainAutonomyEarned: boolean;
}

export type Reserve = "founder_reserve" | "delegable";

export interface ReserveVerdict {
  reserve: Reserve;
  /** The irreducible-reserve reasons (present even when delegable-by-trust). */
  reasons: string[];
}

/**
 * Classify a decision. Founder-reserve if ANY irreducible trigger fires; else,
 * delegable once the domain has earned autonomy (until then the founder is in
 * the loop — the pre-99.9 earning phase, not the permanent reserve).
 */
export function classifyReserve(ctx: DecisionContext): ReserveVerdict {
  const reasons: string[] = [];
  if (ctx.touchesConstitution) reasons.push("constitutional change — never self-modifiable");
  if (ctx.touchesCapitalAllocation && ctx.valueUsd >= FOUNDER_RESERVE_VALUE_THRESHOLD_USD) reasons.push(`capital allocation ≥ $${FOUNDER_RESERVE_VALUE_THRESHOLD_USD}`);
  if (!ctx.reversible && ctx.valueUsd >= FOUNDER_RESERVE_VALUE_THRESHOLD_USD) reasons.push("irreversible action of consequence");
  if (ctx.novel) reasons.push("novel, no-precedent situation");
  if (ctx.isHumanRelationship) reasons.push("a human relationship the founder owns");

  if (reasons.length > 0) return { reserve: "founder_reserve", reasons };
  if (!ctx.domainAutonomyEarned) return { reserve: "founder_reserve", reasons: ["domain has not yet earned autonomy for this action (earning phase, not permanent reserve)"] };
  return { reserve: "delegable", reasons: [] };
}

export interface AttentionLoad {
  asks: number;
  decisions: number;
  /** Fraction of decisions that reached the founder. */
  askRate: number;
  /** True if the system is bothering the founder more than the 0.1% target. */
  overBudget: boolean;
}

/** The 99.9%-autonomy target: ≤ 0.1% of decisions reach the founder. */
export const FOUNDER_ATTENTION_TARGET = 0.001;

/**
 * Measure founder-attention load over a window — the calibration signal. A high
 * ask-rate means the escalation ladder / earned autonomy aren't yet calibrated
 * to board-only. Pure.
 */
export function attentionLoad(asks: number, decisions: number, target = FOUNDER_ATTENTION_TARGET): AttentionLoad {
  const askRate = decisions > 0 ? asks / decisions : 0;
  return { asks, decisions, askRate, overBudget: decisions > 0 && askRate > target };
}
