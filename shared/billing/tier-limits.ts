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
export type ResourceType = "leads" | "properties" | "notes" | "ai_requests" | "campaigns";

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
  /**
   * Tier 1I — Economics guardrail (2026-06-10 founder decision: mandatory
   * BYOK past a generous turn threshold, NOT a hard ceiling, NOT metered
   * overage).
   *
   * Monthly Pax-turn count after which the org must bring their own AI key
   * (Anthropic / OpenRouter / OpenAI) to keep chatting this month. With an
   * active AI BYOK credential the threshold does not apply — usage routes
   * through the customer's key and is unlimited (their spend, not our COGS).
   * `null` = no BYOK threshold (the plain `ai_requests` cap, if any, governs).
   *
   * Rationale: a heavy Pro user at the 12,000/mo `ai_requests` cap costs
   * ≈ $180/mo in AI COGS against $49/mo revenue. The threshold keeps the
   * included allotment comfortably margin-positive (1,500 × 1.5¢ ≈ $22.50)
   * while never walling anyone off — BYOK restores unlimited usage.
   *
   * TUNABLE — see AI_TURNS_BYOK_THRESHOLDS below for the per-tier values.
   */
  aiTurnsByokThreshold: number | null;
}

/**
 * TUNABLE CONSTANTS — monthly included AI-turn allotments before BYOK is
 * required. Deliberately generous: these cover the steady-state user with
 * lots of headroom; only the COGS-inverting tail crosses them. Adjust here
 * (single source of truth) — every gate, banner, and test reads this.
 */
// Margin math reconciled 2026-07-03 (roadmap audit): canonical prices are
// $20/$49/$79 (tier-pricing.ts) — the previous annotations cited a $29
// Starter and a $199 Scale that never shipped.
// Re-bounded 2026-07-07 (cost audit): Scale's old shape (500 Opus turns +
// Sonnet to 6,000) bounded worst-case platform-key COGS at ~$90 on a $79
// plan — underwater at full utilization. paxModelTier.ts now runs a
// two-stage downgrade (Opus→Sonnet at 200, →Haiku at 3,000), bounding
// Scale at ≈ $4.50 + $38 + $12 ≈ $54 of $79 (~32% margin at absolute full
// utilization). Starter/pro bounds with the Haiku tail past their soft
// caps: starter ≈ $11.25 of $20 (56% of revenue — thin, watch it),
// pro ≈ $15.50 of $49. Roadmap W4 also tracks that non-chat AI surfaces
// bypass these thresholds entirely (they hit the per-org COGS ceilings in
// aiCostCeiling.ts instead). S3 follow-up: campaign optimize now mirrors
// the tier ladder (campaignOptimizer.ts); document intelligence and agent
// dispatches remain ceiling-only — extend pickPaxModelForOrg to them next.
export const AI_TURNS_BYOK_THRESHOLDS: Record<SubscriptionTier, number | null> = {
  free: null,       // evaluation tier — the 75/mo ai_requests cap governs; no BYOK lane
  starter: 750,     // ~25 turns/day avg
  pro: 1500,        // ~50 turns/day avg
  scale: 6000,      // multi-seat teams
  enterprise: null, // negotiated per-deal — no self-serve threshold
};

/**
 * Warn ratio for the "approaching included AI usage" banner. At ≥ 80% of
 * the BYOK threshold the usage API flags `warning: true` so the client can
 * nudge toward adding a key before the wall is hit.
 */
export const AI_TURNS_BYOK_WARN_RATIO = 0.8;

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
    aiTurnsByokThreshold: AI_TURNS_BYOK_THRESHOLDS.free,
  },
  starter: {
    leads: 250,
    properties: 50,
    notes: 25,
    // Monthly cap. Was 500/DAY, which at ~$0.015/turn × 500 × 30 = $225/mo
    // COGS vs $20/mo revenue (~-1000% margin). At the 1,500/mo cap the
    // PLATFORM-key exposure is bounded earlier by the 750-turn BYOK
    // threshold (~$11.25 COGS vs $20/mo revenue); 1,500 governs total turns
    // across lanes. (Prices reconciled 2026-07-03 — this previously cited a
    // $29 Starter that never shipped.) See
    // docs/internal/pricing/alternatives-2026-06-06.md.
    ai_requests: 1500,
    campaigns: 5,
    sequences: 2,
    byokSupport: false,
    includedSeats: 1,
    maxSeats: 1,
    seatPriceCents: null,
    creditPool: 750,
    aiTurnsByokThreshold: AI_TURNS_BYOK_THRESHOLDS.starter,
  },
  pro: {
    leads: 500,
    properties: 100,
    notes: 50,
    // Monthly cap. Pro is the workhorse tier; 12,000 turns/mo (~400/day)
    // supports a single operator running Pax across the full pipeline.
    // Canonical price is $49/mo (tier-pricing.ts, reconciled 2026-07-03).
    // Worst-case platform-key COGS is bounded well before the 12,000 cap by
    // the 2,500-turn BYOK threshold (~$37.50) plus the tier-proportional AI
    // cost ceiling (aiCostCeiling.ts); past the threshold, turns ride the
    // customer's own key at $0 COGS to us.
    ai_requests: 12000,
    campaigns: null,
    sequences: null,
    byokSupport: true,
    includedSeats: 2,
    maxSeats: 5,
    seatPriceCents: 2000, // $20/seat
    creditPool: 2500,
    aiTurnsByokThreshold: AI_TURNS_BYOK_THRESHOLDS.pro,
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
    // $25/seat past the included 10 (was $40 — founder decision 2026-07-08:
    // the marginal Scale seat cost DOUBLE the marginal Pro seat, taxing
    // exactly the teams the tier is for. See
    // docs/company/decision-memos/2026-07-08-founding-member-pricing.md).
    seatPriceCents: 2500,
    creditPool: 8000,
    aiTurnsByokThreshold: AI_TURNS_BYOK_THRESHOLDS.scale,
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
    aiTurnsByokThreshold: AI_TURNS_BYOK_THRESHOLDS.enterprise,
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
  // Founders are never BYOK-walled.
  aiTurnsByokThreshold: null,
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
