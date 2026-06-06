/**
 * Reserve floor rule — Tahoe lock-in L6.
 *
 * Codifies the constitutional capital-ladder posture: the combined balance of
 * the three reserve buckets (tax_reserve + refund_reserve + profit_reserve)
 * must remain at-or-above a fraction of trailing-90-day revenue. If that
 * floor is breached, the next allocation policy adjustment proposal should
 * push more incoming revenue into reserves until the floor is recovered.
 *
 * The rule lives in `shared/` so both the runtime check (server-side cron job)
 * and any future client surface (founder cockpit reserve gauge) can read the
 * same canonical constant. Changing this number is a constitutional-level
 * decision; do not edit casually.
 *
 * Why 0.30:
 *   - tax_reserve allocation is 0.25 of revenue → in a steady-state where
 *     every revenue row has been allocated and no reserve has been drained,
 *     reserves total exactly 0.40 (0.25 + 0.10 + 0.05) of trailing revenue.
 *   - Setting the floor at 0.30 leaves 0.10 of headroom before we cross into
 *     "draining reserves to cover opex" territory — a 25% drawdown window
 *     against the steady-state position.
 *   - Below 0.30 the founder needs an explicit decision: raise prices, cut
 *     opex, or accept that the tax bucket is being eaten.
 */

export const RESERVE_FLOOR_RULE = {
  /**
   * Minimum combined reserve balance as a fraction of trailing-window revenue.
   *
   * If `(tax_reserve + refund_reserve + profit_reserve) / trailing_90d_revenue`
   * drops below this number, a row is recorded to `reserve_floor_check`
   * with `belowFloor=true`.
   */
  minFraction: 0.30,

  /**
   * Window in days over which trailing revenue is computed for the
   * denominator. 90 days = one quarter; smooths over monthly billing
   * variation while staying responsive to revenue trend shifts.
   */
  trailingWindowDays: 90,

  /**
   * Bucket names that contribute to the "reserve" total. Must be a strict
   * subset of `shared/billing/allocation-policy.ts` BUCKET_NAMES.
   */
  reserveBuckets: ["tax_reserve", "refund_reserve", "profit_reserve"] as const,
} as const;

export type ReserveBucketName = (typeof RESERVE_FLOOR_RULE.reserveBuckets)[number];

/**
 * Compute floor cents from trailing-window revenue.
 *
 * `Math.round` so the floor lands on an integer cent — avoids spurious
 * "below floor by 0.4¢" results when the comparison is integer-vs-integer.
 */
export function computeReserveFloorCents(trailingRevenueCents: number): number {
  if (!Number.isFinite(trailingRevenueCents) || trailingRevenueCents <= 0) return 0;
  return Math.round(trailingRevenueCents * RESERVE_FLOOR_RULE.minFraction);
}

export interface ReserveFloorCheck {
  /** Combined balance of the three reserve buckets at check time. */
  reservesTotalCents: number;
  /** Trailing-window revenue used as the denominator. */
  trailingRevenueCents: number;
  /** The floor in cents (= trailingRevenue × minFraction). */
  floorCents: number;
  /** Headroom (positive) or breach (negative) in cents. */
  headroomCents: number;
  /** Whether the floor was breached at the moment of the check. */
  belowFloor: boolean;
  /** Fraction reserves are of trailing revenue (0..∞). 0 if trailing revenue is 0. */
  reservesFraction: number;
}

/**
 * Pure assembly helper — given the inputs, produce the structured check
 * payload. Kept in `shared/` so the runtime job and any test can share it
 * without round-tripping through the DB.
 */
export function assembleReserveFloorCheck(args: {
  reservesTotalCents: number;
  trailingRevenueCents: number;
}): ReserveFloorCheck {
  const { reservesTotalCents, trailingRevenueCents } = args;
  const floorCents = computeReserveFloorCents(trailingRevenueCents);
  const headroomCents = reservesTotalCents - floorCents;
  const belowFloor = trailingRevenueCents > 0 && reservesTotalCents < floorCents;
  const reservesFraction = trailingRevenueCents > 0
    ? reservesTotalCents / trailingRevenueCents
    : 0;
  return {
    reservesTotalCents,
    trailingRevenueCents,
    floorCents,
    headroomCents,
    belowFloor,
    reservesFraction,
  };
}
