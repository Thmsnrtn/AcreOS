/**
 * Vertical readiness — maturity as a PROJECTION OF EVIDENCE, not an adjective.
 *
 * ── THE DEFECT THIS EXISTS TO END ───────────────────────────────────────────
 * All fifteen entries in `shared/business-types.ts` declare `maturity: "core"`.
 * Exactly one vertical — `fix_and_flip` — closes the canonical loop end to end
 * (routes-flip-analyzer.ts:556 writes a scenario, :597 writes a decision
 * snapshot citing it, the Today door collects the outcome, ForecastCalibration
 * reads it). The other fourteen make the same claim on less evidence.
 *
 * MEASURED 2026-08-17, and the shape of the gap matters: every vertical DOES
 * have a surface. All fifteen carry 4–7 spotlight modules and 2–5 workflow
 * template ids, and every declared template id resolves to a real definition in
 * the engine — not one is a dangling string. So the shortfall is not cosmetic
 * and not a registry typo. Thirteen verticals sit at exactly `surfaced`: they
 * have somewhere to stand and nothing that closes. THE GAP IS THE LOOP, NOT THE
 * SURFACE — which is why building more screens would not move a single one.
 *
 * The guard that should have caught this could not. `customerPersonas.test.ts`
 * asserts maturity only INSIDE `if (displayName.includes("(waitlist)"))` and
 * `("(beta)")` — and no persona display name contains either string, so the
 * test iterates thirty personas and asserts nothing. A green test over an empty
 * population is this repo's most repeated defect shape, and here it sits on a
 * customer-facing claim.
 *
 * ── THE LAW ─────────────────────────────────────────────────────────────────
 * A DECLARED MATURITY MAY NOT EXCEED EVIDENCED READINESS.
 *
 * `maturity` stays a human editorial label — it is what marketing and
 * onboarding show. This module computes, separately, what the REPOSITORY can
 * actually demonstrate about a vertical, and `verticalReadiness.test.ts` fails
 * when a label outruns it. The label is not derived automatically on purpose:
 * silently rewriting a customer-facing claim from code is its own kind of
 * dishonesty, and which word to show is a founder decision. What is NOT a
 * founder decision is whether the gap is visible and counted.
 *
 * ── WHY THESE SIGNALS ───────────────────────────────────────────────────────
 * Every signal below is checkable from source with no database, and each one is
 * a fact about REACHABILITY rather than intent:
 *
 *   surfaced      the vertical has somewhere to stand — spotlight modules, or
 *                 workflow templates that EXIST in the engine. A template id
 *                 the engine does not define is a claim, not a surface, so the
 *                 caller must pass the set of ids the engine really registers.
 *   underwritten  an economics engine writes a `scenario` for it in production.
 *                 This is the first point at which AcreOS does arithmetic a
 *                 customer could act on.
 *   decided       a production surface records a `decision_snapshot` for it —
 *                 the canonical loop's entry point, and the thing that makes an
 *                 outcome gradeable later.
 *
 * There is deliberately NO `learning` tier here. Grading requires realized
 * outcomes from real customers, and `shared/outcomes/calibration.ts` already
 * refuses to state a direction below six comparisons. A tier this module could
 * never award from source would be decoration.
 *
 * ── NOT A SECOND MATURITY SYSTEM ────────────────────────────────────────────
 * This does not introduce a competing ladder, a table, or a new noun in the
 * customer's vocabulary. It is one pure function over the existing registry
 * plus facts the caller measures from the existing codebase. Nothing persists.
 */

import type { BusinessTypeId, BusinessTypeMeta, VerticalMaturity } from "../business-types";

/**
 * What the repository can demonstrate about a vertical, weakest first.
 *
 * Ordered — index comparison is the whole mechanism.
 */
export const READINESS_TIERS = ["declared", "surfaced", "underwritten", "decided"] as const;
export type ReadinessTier = (typeof READINESS_TIERS)[number];

/**
 * The measured facts a caller supplies. Every one is derived from source by the
 * test, never hand-written here — a hand-written fact would make this module
 * agree with itself.
 */
export interface VerticalEvidence {
  /** Template ids the workflow engine ACTUALLY defines. */
  definedWorkflowTemplateIds: ReadonlySet<string>;
  /** Business types an economics engine writes a scenario for, in production. */
  underwrittenBusinessTypes: ReadonlySet<BusinessTypeId>;
  /** Business types a production surface records a decision snapshot for. */
  decidingBusinessTypes: ReadonlySet<BusinessTypeId>;
}

/**
 * The lowest maturity label each tier can honestly carry.
 *
 * `core` demands `decided` because "core" is what a customer reads as "this
 * vertical is what AcreOS is for". Without a recorded decision there is no
 * canonical loop, nothing to grade, and no calibration — which is the product.
 */
const MATURITY_REQUIRES: Record<VerticalMaturity, ReadinessTier> = {
  core: "decided",
  beta: "surfaced",
  roadmap: "declared",
};

/** Evidenced readiness for one vertical. Pure. */
export function readinessOf(
  meta: BusinessTypeMeta,
  evidence: VerticalEvidence,
): ReadinessTier {
  if (evidence.decidingBusinessTypes.has(meta.id)) return "decided";
  if (evidence.underwrittenBusinessTypes.has(meta.id)) return "underwritten";

  // A template id the engine does not define is a CLAIM, not a surface. Counting
  // it would let a vertical earn a tier by editing a string array.
  const realTemplates = meta.workflowTemplateIds.filter((id) =>
    evidence.definedWorkflowTemplateIds.has(id),
  );
  if (realTemplates.length > 0 || meta.spotlightModules.length > 0) return "surfaced";

  return "declared";
}

/** True when the declared label claims more than the evidence supports. */
export function overclaims(meta: BusinessTypeMeta, evidence: VerticalEvidence): boolean {
  const required = MATURITY_REQUIRES[meta.maturity];
  return READINESS_TIERS.indexOf(readinessOf(meta, evidence)) < READINESS_TIERS.indexOf(required);
}

export interface VerticalReadinessRow {
  id: BusinessTypeId;
  declared: VerticalMaturity;
  evidenced: ReadinessTier;
  /** The tier the declared label demands. */
  required: ReadinessTier;
  overclaims: boolean;
}

/**
 * Project every vertical. The returned rows are the honest answer to "what can
 * this repository actually show?" — and the difference from `maturity` is the
 * gap the ratchet counts.
 */
export function projectReadiness(
  types: Record<BusinessTypeId, BusinessTypeMeta>,
  evidence: VerticalEvidence,
): VerticalReadinessRow[] {
  return Object.values(types).map((meta) => ({
    id: meta.id,
    declared: meta.maturity,
    evidenced: readinessOf(meta, evidence),
    required: MATURITY_REQUIRES[meta.maturity],
    overclaims: overclaims(meta, evidence),
  }));
}
