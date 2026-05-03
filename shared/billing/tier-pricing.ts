/**
 * Single source of truth for AcreOS subscription tier pricing.
 *
 * Six places in the codebase used to carry tier prices and they drifted —
 * `/api/founder/executive-dashboard` was even using $29/$79/$199 while the
 * pricing page shipped $20/$49/$79, so the MRR math was fiction.
 *
 * Every site that needs tier prices (UI, MRR math, Stripe checkout helpers,
 * tests) MUST import from this module. Do not hardcode tier prices anywhere.
 *
 * Canonical tier names used across product strategy:
 *   - solo      ($20 / mo, $200 / yr) — 1 investor, replaces the spreadsheet
 *   - operator  ($49 / mo, $490 / yr) — partnerships and small teams
 *   - empire    ($79 / mo, $790 / yr) — full-time multi-state operations
 *
 * The `organizations.subscription_tier` column historically used the labels
 * "starter / pro / scale" with the same prices. Both label sets refer to the
 * same plans; consumers that need to map an org's stored tier to a canonical
 * pricing key should use {@link tierForSubscriptionTier}.
 *
 * Stripe price IDs come from environment variables and may be undefined in
 * local/dev environments — that is intentional. CI tests assert that prices
 * are positive and self-consistent and only verify env IDs when they are set.
 */

export type Tier = "solo" | "operator" | "empire";
export type BillingInterval = "monthly" | "yearly";

export interface TierPricing {
  /** Monthly price, in USD cents (integer). */
  priceMonthlyCents: number;
  /** Yearly price, in USD cents (integer). */
  priceYearlyCents: number;
  /** Stripe Price ID for monthly billing — undefined if env var is unset. */
  stripePriceIdMonthly?: string;
  /** Stripe Price ID for yearly billing — undefined if env var is unset. */
  stripePriceIdYearly?: string;
  /** User-facing tier name. */
  displayName: string;
}

/**
 * Read a Stripe price ID from `process.env`. Returns `undefined` when the env
 * var is missing or empty so we never accidentally pass empty strings into
 * Stripe API calls. Guarded against environments where `process` is undefined
 * (e.g. some browser builds) so this module can be imported by both client
 * and server code.
 */
function envPriceId(name: string): string | undefined {
  if (typeof process === "undefined" || !process.env) return undefined;
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

export const TIER_PRICES_CENTS: Record<Tier, TierPricing> = {
  solo: {
    priceMonthlyCents: 2000,   // $20.00 / mo
    priceYearlyCents: 20000,   // $200.00 / yr — ~16% discount
    stripePriceIdMonthly: envPriceId("STRIPE_PRICE_SOLO_MONTHLY"),
    stripePriceIdYearly: envPriceId("STRIPE_PRICE_SOLO_YEARLY"),
    displayName: "Solo",
  },
  operator: {
    priceMonthlyCents: 4900,   // $49.00 / mo
    priceYearlyCents: 49000,   // $490.00 / yr — ~16% discount
    stripePriceIdMonthly: envPriceId("STRIPE_PRICE_OPERATOR_MONTHLY"),
    stripePriceIdYearly: envPriceId("STRIPE_PRICE_OPERATOR_YEARLY"),
    displayName: "Operator",
  },
  empire: {
    priceMonthlyCents: 7900,   // $79.00 / mo
    priceYearlyCents: 79000,   // $790.00 / yr — ~16% discount
    stripePriceIdMonthly: envPriceId("STRIPE_PRICE_EMPIRE_MONTHLY"),
    stripePriceIdYearly: envPriceId("STRIPE_PRICE_EMPIRE_YEARLY"),
    displayName: "Empire",
  },
};

/** Returns the price in cents for a (tier, interval) pair. */
export function tierPriceCents(tier: Tier, interval: BillingInterval): number {
  const pricing = TIER_PRICES_CENTS[tier];
  return interval === "yearly" ? pricing.priceYearlyCents : pricing.priceMonthlyCents;
}

/** Convenience: returns the price in dollars (float) for display contexts. */
export function tierPriceDollars(tier: Tier, interval: BillingInterval): number {
  return tierPriceCents(tier, interval) / 100;
}

/**
 * Aliases for the legacy `organizations.subscription_tier` column values.
 * Keep this map in sync with the column comment in `shared/schema.ts`.
 */
const SUBSCRIPTION_TIER_ALIASES: Record<string, Tier> = {
  solo: "solo",
  starter: "solo",
  operator: "operator",
  pro: "operator",
  empire: "empire",
  scale: "empire",
};

/**
 * Maps an `organizations.subscription_tier` column value (which may be
 * "free" / "starter" / "pro" / "scale" / "solo" / "operator" / "empire") to
 * the canonical paid {@link Tier}. Returns `null` for the free tier or any
 * unrecognised value — callers should treat that as $0 MRR contribution.
 */
export function tierForSubscriptionTier(subscriptionTier: string | null | undefined): Tier | null {
  if (!subscriptionTier) return null;
  return SUBSCRIPTION_TIER_ALIASES[subscriptionTier.toLowerCase()] ?? null;
}

/**
 * MRR contribution (in cents) for an org given its stored subscription_tier
 * column value and billing interval. Yearly subscriptions are normalised to a
 * monthly figure so the totals stay comparable.
 */
export function monthlyRevenueCentsFor(
  subscriptionTier: string | null | undefined,
  interval: BillingInterval = "monthly",
): number {
  const tier = tierForSubscriptionTier(subscriptionTier);
  if (!tier) return 0;
  if (interval === "yearly") {
    return Math.round(TIER_PRICES_CENTS[tier].priceYearlyCents / 12);
  }
  return TIER_PRICES_CENTS[tier].priceMonthlyCents;
}

export const TIERS: readonly Tier[] = ["solo", "operator", "empire"] as const;
