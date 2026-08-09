// ============================================================================
// SHARED/COMMISSION/TIER-TYPES.TS — the tiered commission vocabulary, pure.
// ----------------------------------------------------------------------------
// Pure and browser-safe. The tiered-commission types and the tier-resolution
// rule used to live in server/services/commissionService.ts (DB-bound). They are
// lifted here so the browser-safe forecast engine (shared/commission/forecast.ts)
// can resolve a tier without importing server code. commissionService.ts
// re-exports these for its existing consumers, so this is the single source of
// truth and nothing is duplicated.
// ============================================================================

export interface CommissionTier {
  /** Minimum closed deals in the period to qualify for this tier. */
  minDeals: number;
  /** Commission % of deal sale price. */
  ratePercent: number;
  /** e.g. "Bronze", "Silver", "Gold". */
  label: string;
}

export interface CommissionConfig {
  /** Sorted ascending by minDeals. */
  tiers: CommissionTier[];
  /** Flat per-deal bonus in cents (in addition to the %). */
  baseFlatAmount?: number;
  /** The volume-counting window. */
  trackingPeriod: "monthly" | "quarterly" | "annual";
}

/**
 * Given a config and the number of deals already closed this period by an agent,
 * determine which tier applies to the NEXT deal. Picks the highest eligible
 * tier; falls back to the first tier when none qualifies.
 */
export function resolveCommissionTier(
  config: CommissionConfig,
  closedDealsInPeriod: number,
): CommissionTier {
  const eligible = config.tiers
    .filter((t) => closedDealsInPeriod >= t.minDeals)
    .sort((a, b) => b.minDeals - a.minDeals);
  return eligible[0] ?? config.tiers[0];
}
