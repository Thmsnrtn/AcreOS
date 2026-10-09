/**
 * The public plan catalogue served by GET /api/subscription/tiers.
 *
 * It used to be SUBSCRIPTION_TIERS serialized raw, which published
 * `limits.monthlyCredits` (e.g. 25,000 on Scale) — a credit inclusion no plan
 * has: nothing granted it, and Scale's real included pool is 3,000. A public
 * number with no mechanism behind it is a fabricated claim
 * (lint:no-fabrication doctrine). The catalogue now carries the CANONICAL
 * included pool, `limits.creditPool`, read from TIER_LIMITS — the same number
 * the debit gate enforces for a new customer on that tier — and `null` for a
 * catalogue entry with no limits tier of its own, never a guess.
 */
import { SUBSCRIPTION_TIERS } from "@shared/schema";
import { TIER_LIMITS, type SubscriptionTier } from "@shared/billing/tier-limits";

export function publicSubscriptionTiers() {
  return Object.fromEntries(
    Object.entries(SUBSCRIPTION_TIERS).map(([key, tier]) => {
      const limitsTier = (key in TIER_LIMITS ? key : null) as SubscriptionTier | null;
      return [
        key,
        {
          ...tier,
          limits: { ...tier.limits, creditPool: limitsTier ? TIER_LIMITS[limitsTier].creditPool : null },
        },
      ];
    }),
  );
}
