/**
 * THE allowance predicate: has this org spent its shared monthly AI allowance
 * (founder decision 2026-10-08)? Founders and tiers with no allowance (null
 * threshold) never have. checkAiTurnGate's wall, aiAllowance's per-call
 * enforcement and paxTurnFunding's "is this turn included" (founder decision
 * 2026-10-12) all read this, so the wall and the free-turn rule cannot
 * disagree about where the allowance ends. Dependency-free on purpose.
 */
export function isAiAllowanceSpent(gate: {
  mode: "founder" | "byok" | "platform";
  threshold: number | null;
  current: number;
}): boolean {
  return gate.mode !== "founder" && gate.threshold !== null && gate.current >= gate.threshold;
}
