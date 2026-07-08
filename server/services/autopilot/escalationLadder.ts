/**
 * Founder Autopilot — the escalation ladder (T3).
 *
 * The red-team's finding: the ultimate safety valve is "ask the founder" — but
 * if the founder is unavailable, critical asks just SIT. An autonomous system
 * whose only fallback is a human who might be asleep can deadlock.
 *
 * The ladder makes absence fail SAFE, never stuck. Given how long an ask has
 * gone unanswered + its urgency, it escalates the nudge, then — for a decision
 * the system can resolve conservatively — auto-resolves to the safe side
 * (decline = DON'T act / hold) rather than waiting forever. A draft-for-review
 * just keeps waiting (no harm in an unsent draft); only ACTIONS time out, and
 * they time out to "no".
 *
 * Pure + deterministic over (urgency, ageHours, kind) → exhaustively testable.
 */

export type LadderUrgency = "urgent" | "normal" | "low";
export type AskKind = "decision" | "draft_review" | "proposal";

export type LadderAction =
  | { step: "wait" }
  | { step: "repage"; reason: string }
  | { step: "auto_resolve_safe"; resolution: "declined"; reason: string };

/** Hours before re-paging an unanswered ask, by urgency. */
export const REPAGE_HOURS: Record<LadderUrgency, number> = { urgent: 2, normal: 12, low: 48 };
/** Hours before auto-resolving an unanswered ACTION to the safe side. */
export const AUTO_RESOLVE_HOURS: Record<LadderUrgency, number> = { urgent: 24, normal: 72, low: 168 };

/**
 * Decide the ladder action for an unanswered ask. Pure + total.
 *
 * - A draft_review / proposal never auto-resolves — an unsent draft is harmless,
 *   so it waits (re-paging once it's stale). Only a `decision` (an action
 *   awaiting go/no-go) times out, and it times out to DECLINED (the safe side:
 *   the system does NOT act on a decision the founder never approved).
 */
export function ladderAction(input: { urgency: LadderUrgency; ageHours: number; kind: AskKind }): LadderAction {
  const { urgency, ageHours, kind } = input;
  const repage = REPAGE_HOURS[urgency] ?? 12;
  const autoResolve = AUTO_RESOLVE_HOURS[urgency] ?? 72;

  if (kind === "decision" && ageHours >= autoResolve) {
    return {
      step: "auto_resolve_safe",
      resolution: "declined",
      reason: `Unanswered for ${Math.floor(ageHours)}h (≥${autoResolve}h) — auto-declined to the safe side; the system did not act without your approval.`,
    };
  }
  if (ageHours >= repage) {
    return { step: "repage", reason: `Unanswered for ${Math.floor(ageHours)}h (≥${repage}h) — re-paging.` };
  }
  return { step: "wait" };
}
