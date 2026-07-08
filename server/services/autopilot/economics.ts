/**
 * Founder Autopilot — full-funnel economic intelligence (T4).
 *
 * The SaaS-founder critique: the loop was acquisition-only and spent without
 * regard to return. This adds the economic discipline a real operator applies:
 *
 *  1. budgetGate — is there room in the monthly envelope for the next action's
 *     worst-case cost? Reserves a slice for non-deferrable work (incidents,
 *     support) so growth can't starve the essentials.
 *  2. allocateByRoi — given candidate moves with a cost and a REAL efficacy
 *     (success rate from history), rank by expected value per dollar so the
 *     marginal dollar goes where it earns most. Unproven moves get an
 *     exploration floor so they're not starved (honest: no efficacy data ⇒
 *     treated as the uninformative prior, not zero).
 *  3. shouldRampBudget — only proposes a budget lift when proven CAC is healthy
 *     (real signups at an acceptable cost), so the system grows its own budget
 *     on evidence, never on hope.
 *
 * Pure + deterministic → exhaustively testable. Money decisions stay honest:
 * every input is a real measured number, and a proposed ramp is still founder-
 * gated.
 */

export interface BudgetState {
  monthlyCapUsd: number;
  spentThisMonthUsd: number;
  /** Fraction of the cap reserved for non-deferrable work (incidents/support). */
  essentialReservePct?: number;
}

/** Can a discretionary action's worst-case cost fit without raiding the reserve? */
export function budgetGate(
  state: BudgetState,
  actionCostUsd: number,
  opts: { deferrable?: boolean } = {},
): { allowed: boolean; remainingUsd: number; reason: string } {
  const reserve = (opts.deferrable === false ? 0 : state.essentialReservePct ?? 0.2) * state.monthlyCapUsd;
  const spendableFloor = opts.deferrable === false ? 0 : reserve;
  const remaining = state.monthlyCapUsd - state.spentThisMonthUsd;
  const available = remaining - spendableFloor;
  if (actionCostUsd > available) {
    return { allowed: false, remainingUsd: Math.max(0, remaining), reason: `Only $${Math.max(0, available).toFixed(2)} is discretionary-available (reserve protected); action needs $${actionCostUsd.toFixed(2)}.` };
  }
  return { allowed: true, remainingUsd: remaining, reason: "within budget" };
}

export interface RoiCandidate {
  id: string;
  costUsd: number;
  successes: number;
  failures: number;
  /** Value of one success, if known (else a unit weight is used). */
  valuePerSuccessUsd?: number;
}

export interface RoiRanked extends RoiCandidate {
  successProb: number;
  expectedValuePerDollar: number;
}

/** Rank candidates by expected value per dollar (real efficacy). Pure. */
export function allocateByRoi(candidates: RoiCandidate[]): RoiRanked[] {
  return candidates
    .map((c) => {
      const s = Math.max(0, c.successes);
      const f = Math.max(0, c.failures);
      const successProb = (1 + s) / (2 + s + f); // Laplace — unproven ⇒ 0.5, never 0
      const value = c.valuePerSuccessUsd ?? 1;
      const cost = Math.max(0.01, c.costUsd);
      return { ...c, successProb, expectedValuePerDollar: (successProb * value) / cost };
    })
    .sort((a, b) => b.expectedValuePerDollar - a.expectedValuePerDollar);
}

export interface CacInputs {
  attributedSignups: number;
  spendUsd: number;
  /** Don't propose a ramp until at least this many real signups are attributed. */
  minSignups?: number;
  /** Healthy cost-per-acquisition ceiling (USD). */
  targetCacUsd?: number;
}

/**
 * Propose a budget ramp ONLY on proven, healthy CAC. Pure + honest: with too
 * little data, it holds (no ramp on hope). Still founder-gated downstream.
 */
export function shouldRampBudget(inp: CacInputs): { ramp: boolean; cacUsd: number | null; reason: string } {
  const minSignups = inp.minSignups ?? 5;
  const targetCac = inp.targetCacUsd ?? 50;
  if (inp.attributedSignups < minSignups) {
    return { ramp: false, cacUsd: inp.attributedSignups > 0 ? inp.spendUsd / inp.attributedSignups : null, reason: `Only ${inp.attributedSignups} attributed signups (need ≥${minSignups}) — too little data to ramp.` };
  }
  const cac = inp.spendUsd / inp.attributedSignups;
  if (cac <= targetCac) {
    return { ramp: true, cacUsd: cac, reason: `CAC $${cac.toFixed(2)} ≤ target $${targetCac} over ${inp.attributedSignups} signups — healthy; propose a budget lift.` };
  }
  return { ramp: false, cacUsd: cac, reason: `CAC $${cac.toFixed(2)} > target $${targetCac} — hold the budget until acquisition is more efficient.` };
}

/**
 * Tighten-ONLY margin guard on a PAID budget ramp: never pour more into paid
 * acquisition while existing customers are contribution-margin-negative. It can
 * only ever BLOCK a ramp shouldRampBudget already approved — never trigger one.
 *
 * Pre-revenue safe: with no revenue yet, owned-channel growth is HOW we reach
 * revenue, so a ramp isn't gated on a margin that's negative purely from fixed
 * costs. The guard bites only once there's real revenue AND it's unprofitable.
 * Pure; reads the existing per-tenant unit-economics rollup at the call site.
 */
export function marginAllowsRamp(input: { revenueUsd: number; marginUsd: number }): {
  allow: boolean;
  reason: string;
} {
  if (!(input.revenueUsd > 0)) {
    return { allow: true, reason: "pre-revenue — owned-channel ramp isn't gated on fixed-cost margin" };
  }
  if (input.marginUsd < 0) {
    return {
      allow: false,
      reason: `contribution margin is negative ($${input.marginUsd.toFixed(0)}) — hold paid spend until unit economics turn positive`,
    };
  }
  return { allow: true, reason: `contribution margin positive ($${input.marginUsd.toFixed(0)})` };
}

/**
 * The next monthly cap to propose, given the current effective cap and a hard
 * ceiling. A modest, bounded step (default +50%) so the budget climbs in proven
 * increments — each ramp founder-gated, each backed by fresh healthy CAC — never
 * a single unbounded jump. Returns the current cap unchanged when already at (or
 * above) the ceiling, which the caller treats as "nothing to propose". Pure.
 */
export function nextBudgetStepUsd(
  currentCapUsd: number,
  ceilingUsd: number,
  factor = 1.5,
): number {
  if (!Number.isFinite(currentCapUsd) || currentCapUsd <= 0) return currentCapUsd;
  if (currentCapUsd >= ceilingUsd) return currentCapUsd;
  const stepped = Math.round(currentCapUsd * Math.max(1, factor));
  return Math.min(stepped, ceilingUsd);
}
