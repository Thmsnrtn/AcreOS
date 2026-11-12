// ============================================================================
// SHARED/RENTAL/PERSQFT.TS — commercial per-square-foot metrics, computed honestly.
// ----------------------------------------------------------------------------
// Pure and browser-safe. Commercial real estate is quoted per square foot per
// year: base rent $/sqft, and occupancy cost $/sqft (base + the CAM estimate).
// This is the ONE place those are derived.
//
// HONESTY: every metric REFUSES (returns null) when the rentable area is unknown
// or non-positive — a per-sqft figure computed against a zero or missing
// denominator is a fabricated number, and dividing by it is meaningless. A lease
// without a recorded rentable area simply has no per-sqft metric until one is
// entered; we never substitute a guess.
//
// W2-COMMERCIAL (2026-11-06, when this first got a screen) closed two defaults
// that would have put a wrong figure on it:
//   - the base rent is the rent IN EFFECT for `asOfMonth`, computed from the
//     lease's escalation steps by the canonical engine (rentEscalation.ts) —
//     rental_leases.monthlyRentCents is the STARTING rent, so quoting it after a
//     step took effect would quote a rent the tenant no longer pays;
//   - a missing CAM estimate is no longer read as $0. Occupancy cost is base +
//     the recorded estimate; on a GROSS lease (rent is all-in) a missing estimate
//     genuinely means none, so occupancy equals base; on any other or unrecorded
//     lease type it is unknown, and null says so.
// ============================================================================

import { effectiveBaseRentForMonth, type RentScheduleStepInput } from "./rentEscalation";

export interface PerSqftInput {
  /** The lease's STARTING monthly base rent, in cents (rental_leases.monthlyRentCents). */
  monthlyRentCents: number | null;
  /** The lease's escalation steps; the rent in effect for asOfMonth is computed from them (none = flat). */
  scheduleSteps: readonly RentScheduleStepInput[];
  /** The month the metrics are quoted for, YYYY-MM (a YYYY-MM-DD is accepted; only the month is read). */
  asOfMonth: string;
  /** The tenant's rentable area, in square feet — the denominator. */
  rentableSqft: number | null;
  /** The monthly CAM estimate the tenant pays, in cents (for occupancy cost). */
  camEstimateMonthlyCents: number | null;
  /** Whether a missing CAM estimate means "none" (gross) or "unknown" (anything else). */
  leaseType: "gross" | "nnn" | "modified_gross" | null;
}

export interface PerSqftMetrics {
  /** Annualized base rent per rentable sqft, in cents (round). Null when area is unknown. */
  baseRentPerSqftAnnualCents: number | null;
  /** Annualized (base + CAM estimate) per rentable sqft, in cents. Null when it cannot be stated. */
  occupancyCostPerSqftAnnualCents: number | null;
  /** How occupancy cost was formed, or null when it is not stated. */
  occupancyCostBasis: "base_plus_cam_estimate" | "gross_base_only" | null;
  /** The monthly base rent the figures are built on — the escalated rent in effect for asOfMonth. */
  monthlyRentCentsUsed: number | null;
  /** The month the figures are quoted for, YYYY-MM. */
  asOfMonth: string;
  /** Echoed so a caller/UI can show the denominator behind the figures. */
  rentableSqft: number | null;
  /** True when rentableSqft is missing/non-positive — the metrics are null and this says why. */
  unavailable: boolean;
}

/** Annualized cents-per-sqft = (monthlyCents × 12) ÷ sqft, or null when sqft is unusable. */
function perSqftAnnual(monthlyCents: number | null, rentableSqft: number | null): number | null {
  if (monthlyCents == null || rentableSqft == null || rentableSqft <= 0) return null;
  return Math.round((monthlyCents * 12) / rentableSqft);
}

/**
 * Derive the per-sqft metrics for a commercial lease. Returns nulls (unavailable
 * = true) rather than a fabricated figure when the rentable area is unknown, and
 * a null occupancy cost when the CAM estimate it needs is unknown.
 */
export function computePerSqftMetrics(input: PerSqftInput): PerSqftMetrics {
  const asOfMonth = String(input.asOfMonth).slice(0, 7);
  const usableArea = input.rentableSqft != null && input.rentableSqft > 0;
  const monthlyRentCentsUsed =
    input.monthlyRentCents != null
      ? effectiveBaseRentForMonth(input.monthlyRentCents, input.scheduleSteps, asOfMonth)
      : null;
  const baseRentPerSqftAnnualCents = perSqftAnnual(monthlyRentCentsUsed, input.rentableSqft);

  let occupancyMonthly: number | null = null;
  let occupancyCostBasis: PerSqftMetrics["occupancyCostBasis"] = null;
  if (monthlyRentCentsUsed != null) {
    if (input.camEstimateMonthlyCents != null) {
      occupancyMonthly = monthlyRentCentsUsed + input.camEstimateMonthlyCents;
      occupancyCostBasis = "base_plus_cam_estimate";
    } else if (input.leaseType === "gross") {
      occupancyMonthly = monthlyRentCentsUsed;
      occupancyCostBasis = "gross_base_only";
    }
  }
  const occupancyCostPerSqftAnnualCents = perSqftAnnual(occupancyMonthly, input.rentableSqft);
  return {
    baseRentPerSqftAnnualCents,
    occupancyCostPerSqftAnnualCents,
    occupancyCostBasis: occupancyCostPerSqftAnnualCents != null ? occupancyCostBasis : null,
    monthlyRentCentsUsed,
    asOfMonth,
    rentableSqft: input.rentableSqft,
    unavailable: !usableArea,
  };
}
