/**
 * Single source of truth for AcreOS subscription tier *limits*.
 *
 * Sits next to `shared/billing/tier-pricing.ts` so price + limits travel
 * together — Lens 3 (Pricing Coherence) caught the same numbers drifting
 * across `server/services/usageLimits.ts`, `client/src/pages/pricing.tsx`,
 * and `client/src/components/tier-upgrade-panel.tsx`. Every site that
 * needs tier limits (server gate, pricing page, upgrade modal, tests)
 * MUST import from this module.
 *
 * Server-only constants (founder-tier sentinel) stay alongside the public
 * tier table so we don't accidentally serve founder limits to a customer.
 *
 * Re-exported from `server/services/usageLimits.ts` for back-compat.
 */

export type SubscriptionTier = "free" | "starter" | "pro" | "scale" | "enterprise";

export type ResourceType = "leads" | "properties" | "notes" | "ai_requests";

export interface TierLimits {
  leads: number | null;
  properties: number | null;
  notes: number | null;
  ai_requests: number | null;
  /** null = unlimited */
  campaigns: number | null;
  /** null = unlimited */
  sequences: number | null;
  /** Bring Your Own Key data provider support */
  byokSupport: boolean;
  /** Seats included in the tier */
  includedSeats: number;
  /** Maximum seats allowed (null = unlimited) */
  maxSeats: number | null;
  /** Price per additional seat in cents (null = cannot purchase) */
  seatPriceCents: number | null;
  /**
   * Pillar 4 — Credit System + Tier Realignment.
   *
   * Monthly credit pool size (1 credit ≈ $0.01 of provider cost). Metered
   * actions debit this pool per `shared/billing/credit-weights.ts`. Pool
   * resets at each billing cycle. Pro+ tiers can also enable BYOK lanes
   * that bypass the pool entirely (see `byokSupport`).
   */
  creditPool: number;
}

/**
 * Feature flags for higher tiers — Scale is on per Lens 3 (Pricing
 * Coherence); Enterprise stays hidden until a manual rollout.
 */
export const PRICING_FEATURE_FLAGS = {
  pricing_scale_tier_enabled: true,
  pricing_enterprise_tier_enabled: false,
} as const;

export const TIER_LIMITS: Record<SubscriptionTier, TierLimits> = {
  free: {
    // Bumped 10 → 50 (2026-05-11): the sample-data flow seeds 35+ leads
    // during evaluation, so the prior 10-lead cap surfaced as a hard wall
    // before a new user could even finish exploring the canned dataset.
    // 50 leaves enough headroom for sample data + a few user-added leads
    // without making the upgrade decision feel coerced.
    leads: 50,
    properties: 3,
    notes: 2,
    ai_requests: 25,
    campaigns: 0,
    sequences: 0,
    byokSupport: false,
    includedSeats: 1,
    maxSeats: 1,
    seatPriceCents: null,
    creditPool: 50,
  },
  starter: {
    leads: 250,
    properties: 50,
    notes: 25,
    ai_requests: 500,
    campaigns: 5,
    sequences: 2,
    byokSupport: false,
    includedSeats: 1,
    maxSeats: 1,
    seatPriceCents: null,
    creditPool: 750,
  },
  pro: {
    leads: 500,
    properties: 100,
    notes: 50,
    ai_requests: 1000,
    campaigns: null,
    sequences: null,
    byokSupport: true,
    includedSeats: 2,
    maxSeats: 5,
    seatPriceCents: 2000, // $20/seat
    creditPool: 2500,
  },
  scale: {
    leads: null,
    properties: null,
    notes: null,
    ai_requests: null,
    campaigns: null,
    sequences: null,
    byokSupport: true,
    includedSeats: 10,
    maxSeats: 100,
    seatPriceCents: 4000, // $40/seat
    creditPool: 8000,
  },
  enterprise: {
    leads: null,
    properties: null,
    notes: null,
    ai_requests: null,
    campaigns: null,
    sequences: null,
    byokSupport: true,
    includedSeats: 25,
    maxSeats: null,
    seatPriceCents: 5000, // $50/seat (negotiable)
    // Enterprise pools are negotiated per-deal; this is the default floor.
    creditPool: 25000,
  },
};

/** Founder tier has unlimited everything. Server-only — never expose. */
export const FOUNDER_TIER_LIMITS: TierLimits = {
  leads: null,
  properties: null,
  notes: null,
  ai_requests: null,
  campaigns: null,
  sequences: null,
  byokSupport: true,
  includedSeats: 1000,
  maxSeats: null,
  seatPriceCents: null,
  // Founders are not metered — a very large pool serves as a sentinel for
  // any consumer that does not separately gate on `isFounder`.
  creditPool: 1_000_000,
};

export function isTierVisible(tier: SubscriptionTier): boolean {
  if (tier === "scale") return PRICING_FEATURE_FLAGS.pricing_scale_tier_enabled;
  if (tier === "enterprise") return PRICING_FEATURE_FLAGS.pricing_enterprise_tier_enabled;
  return true; // free, starter, pro always visible
}

export function getVisibleTiers(): SubscriptionTier[] {
  return (Object.keys(TIER_LIMITS) as SubscriptionTier[]).filter(isTierVisible);
}
