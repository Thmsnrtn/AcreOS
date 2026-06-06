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

/**
 * Resource keys metered by the usage-limits system.
 *
 * `ai_requests` is the historical key for "Pax message turns" — the metric
 * is enforced on a **monthly** window (was daily prior to 2026-06-06; the
 * daily window produced a -980% margin on Starter at the prior 500/day cap,
 * see `docs/internal/pricing/alternatives-2026-06-06.md`). The key name is
 * preserved as a stable contract for Stripe metadata, the usage-events row
 * `event_type='ai_request'`, and ~15 downstream callers; only the WINDOW
 * (monthly) and the CAP (rebaselined) changed.
 */
export type ResourceType = "leads" | "properties" | "notes" | "ai_requests";

export interface TierLimits {
  leads: number | null;
  properties: number | null;
  notes: number | null;
  /**
   * Monthly Pax-message-turns cap. See `ResourceType` docstring for the
   * 2026-06-06 daily→monthly window correction. Display labels everywhere
   * say "Monthly Pax messages"; only the API identifier remains
   * `ai_requests` for back-compat.
   */
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
    // Monthly cap. Free is a permanent evaluation tier; 75 turns/mo gives
    // ~2-3 turns/day average — enough to feel Pax once before deciding to
    // pay, not enough to operate a business on.
    ai_requests: 75,
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
    // Monthly cap. Was 500/DAY, which at ~$0.015/turn × 500 × 30 = $225/mo
    // COGS vs ~$16.67/mo revenue (-980% margin). At 1,500/mo cap, max COGS
    // is ~$22.50/mo against $29/mo revenue → positive contribution margin
    // with headroom for the steady-state user who runs Pax a few dozen
    // turns/day. See docs/internal/pricing/alternatives-2026-06-06.md.
    ai_requests: 1500,
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
    // Monthly cap. Pro is the workhorse tier; 12,000 turns/mo (~400/day)
    // supports a single operator running Pax across the full pipeline.
    // Max COGS ~$180/mo against $41-$49/mo revenue is offset by BYOK
    // bypass for power users and the credit-pool gate on expensive lanes.
    ai_requests: 12000,
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
    // Monthly cap. 50,000/mo (~1,700/day) for multi-seat teams; BYOK is
    // standard at this tier so most heavy traffic bypasses the AcreOS cap.
    ai_requests: 50000,
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

/**
 * Canonical upgrade ladder. Shared by the server 429 gate, the client 429
 * toast, the 75% usage banner, and the in-app upgrade modal so the
 * "recommended next tier" math is computed in exactly one place.
 *
 * Enterprise is skipped — it's negotiated, not self-serve.
 */
export const TIER_UPGRADE_LADDER: readonly SubscriptionTier[] = [
  "free",
  "starter",
  "pro",
  "scale",
];

/**
 * Returns the next visible paid tier above `current` that the user can
 * self-serve upgrade to, or `null` if they're already on the top
 * self-serve tier. Founders (synthetic `enterprise` tier) get `null`
 * because they can't be "upgraded" by the gate.
 */
export function nextPaidTier(current: string | null | undefined): SubscriptionTier | null {
  const cur = (current ?? "free").toLowerCase() as SubscriptionTier;
  const idx = TIER_UPGRADE_LADDER.indexOf(cur);
  // Unknown tier → start from free. Founders / enterprise → no upgrade.
  if (cur === "enterprise") return null;
  for (let i = Math.max(0, idx) + 1; i < TIER_UPGRADE_LADDER.length; i++) {
    const t = TIER_UPGRADE_LADDER[i];
    if (isTierVisible(t)) return t;
  }
  return null;
}
