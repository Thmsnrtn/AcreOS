/**
 * The public plan catalogue served by GET /api/subscription/tiers.
 *
 * It used to be SUBSCRIPTION_TIERS serialized raw, which published
 * `limits.monthlyCredits` (e.g. 25,000 on Scale) — a credit inclusion no plan
 * has: nothing granted it, and Scale's real included pool is 3,000. A public
 * number with no mechanism behind it is a fabricated claim
 * (lint:no-fabrication doctrine). The catalogue now carries the CANONICAL
 * included pool, `limits.creditPool`, read from TIER_LIMITS — the same number
 * the debit gate enforces for a new customer on that tier. Every other number
 * in SUBSCRIPTION_TIERS is itself projected from TIER_LIMITS /
 * TIER_PRICES_CENTS (shared/schema.ts), and every catalogue key is a limits
 * tier.
 */
import { SUBSCRIPTION_TIERS } from "@shared/schema";
import { TIER_LIMITS, type SubscriptionTier } from "@shared/billing/tier-limits";

export function publicSubscriptionTiers() {
  return Object.fromEntries(
    (Object.keys(SUBSCRIPTION_TIERS) as SubscriptionTier[]).map((key) => {
      const tier = SUBSCRIPTION_TIERS[key];
      return [key, { ...tier, limits: { ...tier.limits, creditPool: TIER_LIMITS[key].creditPool } }];
    }),
  );
}
