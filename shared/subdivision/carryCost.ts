// ============================================================================
// SHARED/SUBDIVISION/CARRYCOST.TS — the carry of a plat in the queue, projected.
// ----------------------------------------------------------------------------
// Pure and browser-safe: no DB, no `process`, no imports. A subdivider bids an
// acquisition on the CARRY of the county's approval timeline (Brigid §7:
// "Williamson is fourteen months end-to-end … I bake in fourteen months of
// property tax, interest carry, and opportunity cost"). This is the ONE place
// that carry is projected, so its honesty rules live once here:
//
//   1. The timeline is NEVER assumed. Carry is projected over a county's p50 /
//      p90 lead time; when that lead time is unknown the projection is null —
//      the engine refuses to invent a duration, because a carry cost bid on a
//      guessed timeline is exactly the number that loses a project.
//   2. p50 and p90 are projected INDEPENDENTLY, so the operator sees the range
//      the timeline uncertainty actually implies — not a single point that
//      hides it.
//   3. Every component (holding, debt interest, opportunity) is a linear
//      function of the (recorded) monthly/annual inputs and the projected
//      months; nothing is spread from an average or back-filled.
// ============================================================================

/** The recorded cost inputs a carry projection scales over the timeline. */
export interface CarryCostInputs {
  /** Property tax + insurance + ops, per month, in cents. */
  holdingCostMonthlyCents: number;
  /** Outstanding debt principal, in cents (0 when unlevered). */
  debtPrincipalCents: number;
  /** Annual debt rate, in basis points (1000 = 10%). */
  debtRateBps: number;
  /** The parcel's purchase basis, in cents — the base of opportunity cost. */
  purchaseBasisCents: number;
  /** Opportunity cost rate, in basis points (800 = 8%). */
  opportunityCostBps: number;
}

/** One projection — the carry over a given number of months. */
export interface CarryProjection {
  /** Projected months (one decimal), from lead-days ÷ 30. */
  months: number;
  holdingCostCents: number;
  debtInterestCents: number;
  opportunityCostCents: number;
  totalCarryCents: number;
}

export interface CarryCostResult {
  /** True when the county timeline supplied at least one of p50 / p90 lead-days. */
  timelineFound: boolean;
  /** Carry over the p50 lead time — null when that lead time is unknown. */
  p50: CarryProjection | null;
  /** Carry over the p90 lead time — null when that lead time is unknown. */
  p90: CarryProjection | null;
}

/** Days → months, the convention the carry projector uses (30-day months). */
const DAYS_PER_MONTH = 30;

/**
 * Project the carry cost over a given number of months — or null when the month
 * count is unknown (no county timeline). Holding scales by the month; debt
 * interest and opportunity cost scale their annual figure by months ÷ 12.
 */
export function projectCarryForMonths(
  months: number | null,
  inputs: CarryCostInputs,
): CarryProjection | null {
  if (months === null) return null;
  const annualDebtCents = (inputs.debtPrincipalCents * inputs.debtRateBps) / 10000;
  const annualOppCents = (inputs.purchaseBasisCents * inputs.opportunityCostBps) / 10000;
  const holdingCostCents = Math.round(inputs.holdingCostMonthlyCents * months);
  const debtInterestCents = Math.round((annualDebtCents / 12) * months);
  const opportunityCostCents = Math.round((annualOppCents / 12) * months);
  return {
    months: Math.round(months * 10) / 10,
    holdingCostCents,
    debtInterestCents,
    opportunityCostCents,
    totalCarryCents: holdingCostCents + debtInterestCents + opportunityCostCents,
  };
}

/**
 * Project a parcel's carry over a county's p50 / p90 approval lead times.
 *
 * `p50TotalDays` / `p90TotalDays` come from the county subdivision timeline (or
 * null when no such timeline is on file). A null lead time yields a null
 * projection for that percentile — the engine never assumes a duration.
 * `timelineFound` reflects whether ANY lead time was available, so the caller
 * can tell "no timeline on file" apart from a genuine zero-carry projection.
 */
export function projectCarryCost(args: {
  p50TotalDays: number | null;
  p90TotalDays: number | null;
  inputs: CarryCostInputs;
}): CarryCostResult {
  const p50Months = args.p50TotalDays !== null ? args.p50TotalDays / DAYS_PER_MONTH : null;
  const p90Months = args.p90TotalDays !== null ? args.p90TotalDays / DAYS_PER_MONTH : null;
  return {
    timelineFound: args.p50TotalDays !== null || args.p90TotalDays !== null,
    p50: projectCarryForMonths(p50Months, args.inputs),
    p90: projectCarryForMonths(p90Months, args.inputs),
  };
}
