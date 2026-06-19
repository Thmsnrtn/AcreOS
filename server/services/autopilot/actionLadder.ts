/**
 * Founder Autopilot — the action-economy discipline, generalized (the reasoning
 * primitive every facet shares).
 *
 * The marketing brain reasons elite-ly: free-first, paid-when-proven. That same
 * discipline should govern EVERY domain — support, finance, growth, engineering:
 *
 *   Try the cheapest, safest, most-reversible *effective* action FIRST, and
 *   escalate to costlier / riskier / irreversible actions ONLY as real evidence
 *   and earned trust justify it.
 *
 * This module is that pattern as one reusable primitive. A domain expresses its
 * options as a LADDER — rungs ordered from cheapest/safest to costliest/riskiest,
 * each with (a) an availability check, (b) an earned-autonomy flag, and (c) a
 * justification gate that encodes "is climbing this high warranted yet?". The
 * primitive picks the LOWEST rung that is available + earned + justified. The
 * escalation evidence lives in the ladder's `justified` gates, so the discipline
 * is uniform and the policy is per-domain.
 *
 * Pure + total → exhaustively testable. It produces a choice + a glass-box trace
 * of why each rung was or wasn't taken.
 */

export type CostTier = "free" | "cheap" | "costly";

export interface LadderRung<Ctx> {
  id: string;
  label: string;
  /** Ascending: lower = cheaper / safer / more-reversible → considered first. */
  rung: number;
  cost: CostTier;
  reversible: boolean;
  /** Needs earned domain autonomy beyond the default gates (cost/irreversibility). */
  requiresEarnedAutonomy: boolean;
  /** Is this capability available at all right now (provider / switch / data)? */
  available: (ctx: Ctx) => boolean;
  /** Is climbing THIS high justified by the evidence? (cheaper rungs exhausted,
   *  a proof condition met, the situation demands it). */
  justified: (ctx: Ctx) => boolean;
}

export interface RungVerdict {
  id: string;
  rung: number;
  cost: CostTier;
  eligible: boolean;
  reason: string;
}

export interface LadderChoice<Ctx> {
  /** The cheapest justified+available+earned rung, or null if none qualifies. */
  chosen: LadderRung<Ctx> | null;
  reason: string;
  /** Per-rung evaluation for the glass-box trace. */
  trace: RungVerdict[];
}

/**
 * Climb the ladder under the universal discipline: choose the LOWEST rung that
 * is available AND (if costly) earned AND justified. `earned(rungId)` answers
 * whether the domain has earned autonomy for that rung (default: not earned).
 * Pure.
 */
export function climbLadder<Ctx>(
  ladder: ReadonlyArray<LadderRung<Ctx>>,
  ctx: Ctx,
  earned: (rungId: string) => boolean = () => false,
): LadderChoice<Ctx> {
  const sorted = [...ladder].sort((a, b) => a.rung - b.rung);
  const trace: RungVerdict[] = [];
  let chosen: LadderRung<Ctx> | null = null;

  for (const r of sorted) {
    let eligible = true;
    let reason = "cheapest justified action";
    if (!r.available(ctx)) {
      eligible = false;
      reason = "not available";
    } else if (r.requiresEarnedAutonomy && !earned(r.id)) {
      eligible = false;
      reason = "autonomy not earned for this rung";
    } else if (!r.justified(ctx)) {
      eligible = false;
      reason = "not yet justified by the evidence";
    }
    trace.push({ id: r.id, rung: r.rung, cost: r.cost, eligible, reason });
    if (eligible && chosen === null) chosen = r; // first (lowest) eligible wins
  }

  return {
    chosen,
    reason: chosen ? `${chosen.label} — cheapest justified action (${chosen.cost}${chosen.reversible ? "" : ", irreversible"})` : "no action justified yet — hold",
    trace,
  };
}
