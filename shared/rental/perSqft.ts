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
// ============================================================================

export interface PerSqftInput {
  /** Current monthly base rent, in cents. */
  monthlyRentCents: number | null;
  /** The tenant's rentable area, in square feet — the denominator. */
  rentableSqft: number | null;
  /** The monthly CAM estimate the tenant pays, in cents (for occupancy cost). */
  camEstimateMonthlyCents: number | null;
}

export interface PerSqftMetrics {
  /** Annualized base rent per rentable sqft, in cents (round). Null when area is unknown. */
  baseRentPerSqftAnnualCents: number | null;
  /** Annualized (base + CAM estimate) per rentable sqft, in cents. Null when area is unknown. */
  occupancyCostPerSqftAnnualCents: number | null;
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
 * = true) rather than a fabricated figure when the rentable area is unknown.
 */
export function computePerSqftMetrics(input: PerSqftInput): PerSqftMetrics {
  const usableArea = input.rentableSqft != null && input.rentableSqft > 0;
  const baseRentPerSqftAnnualCents = perSqftAnnual(input.monthlyRentCents, input.rentableSqft);
  const occupancyMonthly =
    input.monthlyRentCents != null
      ? input.monthlyRentCents + (input.camEstimateMonthlyCents ?? 0)
      : null;
  const occupancyCostPerSqftAnnualCents = perSqftAnnual(occupancyMonthly, input.rentableSqft);
  return {
    baseRentPerSqftAnnualCents,
    occupancyCostPerSqftAnnualCents,
    rentableSqft: input.rentableSqft,
    unavailable: !usableArea,
  };
}
