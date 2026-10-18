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

/**
 * The stored `ai_telemetry_events.origin` value for background AI work the org
 * pays for in credits once its allowance is spent (campaignOptimizer and
 * leadNurturer batch runs — founder decision 2026-10-17). It counts toward the
 * allowance, because the rule is "free while under the allowance": every cent
 * of that work must be measured against it. Other background work (origin
 * 'background') is still not counted (decision C, 2026-10-08).
 */
const ALLOWANCE_METERED_BACKGROUND_ORIGIN = "background_metered" as const;

/** Every stored origin whose spend counts toward the org's monthly allowance. */
export const ALLOWANCE_COUNTED_ORIGINS: readonly string[] = ["customer", ALLOWANCE_METERED_BACKGROUND_ORIGIN];

/** The origin value to store for a call: a metered background call is recorded as such. */
export function storedAiOrigin(
  origin: "customer" | "background" | null | undefined,
  allowanceMetered: boolean | undefined,
): string | null {
  if (origin === "background" && allowanceMetered) return ALLOWANCE_METERED_BACKGROUND_ORIGIN;
  return origin ?? null;
}
