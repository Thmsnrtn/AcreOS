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
 * Canonical tier names (renamed 2026-05-11 to match the customer-facing
 * pricing page; old names retained as aliases for the
 * `organizations.subscription_tier` column so historical rows still resolve):
 *   - starter ($20 / mo, $200 / yr) — 1 investor, replaces the spreadsheet
 *   - pro     ($49 / mo, $490 / yr) — partnerships and small teams
 *   - scale   ($79 / mo, $790 / yr) — full-time multi-state operations
 *
 * Legacy `organizations.subscription_tier` values that we still recognise:
 * "solo" (now starter), "operator" (now pro), "empire" (now scale). All
 * lookups go through {@link tierForSubscriptionTier} which folds both label
 * sets onto the canonical key.
 *
 * Stripe price IDs come from environment variables and may be undefined in
 * local/dev environments — that is intentional. CI tests assert that prices
 * are positive and self-consistent and only verify env IDs when they are set.
 */

import { type BusinessTypeId, isProductionReady } from "../business-types";

export type Tier = "starter" | "pro" | "scale";
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
  /**
   * Per-seat add-on price (monthly, in USD cents). Charged on every seat
   * beyond the tier's INCLUDED seats (tier-limits.ts `includedSeats`; the
   * arithmetic is shared/billing/seats.ts). `null` means the tier cannot add
   * seats. Must equal tier-limits.ts `seatPriceCents` (planTablesAgree.test.ts).
   */
  priceMonthlyPerSeatCents: number | null;
  /** Stripe Price ID for the per-seat add-on, monthly billing. */
  stripePriceIdSeatMonthly?: string;
  /** Stripe Price ID for the per-seat add-on, yearly billing. */
  stripePriceIdSeatYearly?: string;
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
  starter: {
    priceMonthlyCents: 4900,   // $49.00 / mo
    priceYearlyCents: 49000,   // $490.00 / yr — pay 10 months, ~17% off (matches "Save 17%" badge)
    // Stripe env vars kept on their legacy SOLO/OPERATOR/EMPIRE names so
    // existing Stripe price IDs in Fly secrets keep resolving without a
    // billing-side renaming sweep. The aliases are documented next to the
    // canonical tier keys here.
    stripePriceIdMonthly: envPriceId("STRIPE_PRICE_SOLO_MONTHLY"),
    stripePriceIdYearly: envPriceId("STRIPE_PRICE_SOLO_YEARLY"),
    displayName: "Starter",
    // Starter is single-user only. Inviting a teammate must prompt for a
    // Pro / Scale upgrade rather than charging per-seat.
    priceMonthlyPerSeatCents: null,
  },
  pro: {
    priceMonthlyCents: 9900,   // $99.00 / mo
    priceYearlyCents: 99000,   // $990.00 / yr — pay 10 months, ~17% off (matches "Save 17%" badge)
    stripePriceIdMonthly: envPriceId("STRIPE_PRICE_OPERATOR_MONTHLY"),
    stripePriceIdYearly: envPriceId("STRIPE_PRICE_OPERATOR_YEARLY"),
    displayName: "Pro",
    // $20/seat past the INCLUDED 2 (tier-limits.ts includedSeats — the
    // previous "after the first" note here had drifted from that source).
    priceMonthlyPerSeatCents: 2000,
    stripePriceIdSeatMonthly: envPriceId("STRIPE_PRICE_OPERATOR_SEAT_MONTHLY"),
    stripePriceIdSeatYearly: envPriceId("STRIPE_PRICE_OPERATOR_SEAT_YEARLY"),
  },
  scale: {
    priceMonthlyCents: 19900,   // $199.00 / mo
    priceYearlyCents: 199000,   // $1,990.00 / yr — pay 10 months, ~17% off (matches "Save 17%" badge)
    stripePriceIdMonthly: envPriceId("STRIPE_PRICE_EMPIRE_MONTHLY"),
    stripePriceIdYearly: envPriceId("STRIPE_PRICE_EMPIRE_YEARLY"),
    displayName: "Scale",
    // $25/seat past the INCLUDED 10 (tier-limits.ts includedSeats).
    // Was $40 — founder decision 2026-07-08: the marginal Scale seat must
    // not cost more than the marginal Pro seat ($20); see
    // docs/company/decision-memos/2026-07-08-founding-member-pricing.md.
    priceMonthlyPerSeatCents: 2500,
    stripePriceIdSeatMonthly: envPriceId("STRIPE_PRICE_EMPIRE_SEAT_MONTHLY"),
    stripePriceIdSeatYearly: envPriceId("STRIPE_PRICE_EMPIRE_SEAT_YEARLY"),
  },
};

/** Returns the price in cents for a (tier, interval) pair. */
export function tierPriceCents(tier: Tier, interval: BillingInterval): number {
  const pricing = TIER_PRICES_CENTS[tier];
  return interval === "yearly" ? pricing.priceYearlyCents : pricing.priceMonthlyCents;
}

// ─── FW-TEGAN-1 + FW-ASHOK-1 (push-forward 2026-05-08): vertical packs ────
// 5-persona convergence (Tegan + Bryn + Ashok + Caspar + Ana): meter
// verticals as +$100–$200/mo packs on top of any base tier. Future-proofs
// the 4+ vertical roadmap and prevents a second "seven-pricing-tables"
// drift episode. Each VerticalPack composes additively with the base tier
// price; an org may activate any subset of packs.

export type VerticalPackKey =
  | "note_investor"
  | "buy_and_hold"
  | "fix_and_flipper"
  | "subdivision"
  | "wholesale";

export interface VerticalPack {
  key: VerticalPackKey;
  displayName: string;
  priceMonthlyCents: number;
  priceYearlyCents: number;
  stripePriceIdMonthly?: string;
  stripePriceIdYearly?: string;
  /** Description shown on the pricing page tile. */
  tagline: string;
  /**
   * The vertical this pack unlocks. A pack is only purchasable when its
   * vertical is production-ready (core|beta); a `roadmap` vertical is on the
   * waitlist and must NOT be sold — see isVerticalPackPurchasable().
   */
  businessTypeId: BusinessTypeId;
}

export const VERTICAL_PACKS: Record<VerticalPackKey, VerticalPack> = {
  note_investor: {
    key: "note_investor",
    displayName: "Note Investor pack",
    priceMonthlyCents: 10000, // $100/mo
    priceYearlyCents: 100000, // $1,000/yr (~17% off)
    stripePriceIdMonthly: envPriceId("STRIPE_PRICE_PACK_NI_MONTHLY"),
    stripePriceIdYearly: envPriceId("STRIPE_PRICE_PACK_NI_YEARLY"),
    tagline: "Amortization, payment ledger, 1098/1099-INT, portfolio dashboard",
    businessTypeId: "note_investor",
  },
  buy_and_hold: {
    key: "buy_and_hold",
    displayName: "Property management pack",
    priceMonthlyCents: 20000, // $200/mo
    priceYearlyCents: 200000,
    stripePriceIdMonthly: envPriceId("STRIPE_PRICE_PACK_BH_MONTHLY"),
    stripePriceIdYearly: envPriceId("STRIPE_PRICE_PACK_BH_YEARLY"),
    tagline: "Tenant screening, rent ledger, maintenance tickets, late-fee engine",
    businessTypeId: "buy_and_hold",
  },
  fix_and_flipper: {
    key: "fix_and_flipper",
    displayName: "Fix-and-flip pack",
    priceMonthlyCents: 15000, // $150/mo
    priceYearlyCents: 150000,
    stripePriceIdMonthly: envPriceId("STRIPE_PRICE_PACK_FF_MONTHLY"),
    stripePriceIdYearly: envPriceId("STRIPE_PRICE_PACK_FF_YEARLY"),
    tagline: "ARV, rehab budgets, contractor 1099s, construction draws",
    businessTypeId: "fix_and_flip",
  },
  subdivision: {
    key: "subdivision",
    displayName: "Subdivision pack",
    priceMonthlyCents: 15000,
    priceYearlyCents: 150000,
    stripePriceIdMonthly: envPriceId("STRIPE_PRICE_PACK_SD_MONTHLY"),
    stripePriceIdYearly: envPriceId("STRIPE_PRICE_PACK_SD_YEARLY"),
    tagline: "Lot subdivision, CC&R templates, permit tracker",
    businessTypeId: "subdivider",
  },
  wholesale: {
    key: "wholesale",
    displayName: "Wholesale pack",
    priceMonthlyCents: 10000,
    priceYearlyCents: 100000,
    stripePriceIdMonthly: envPriceId("STRIPE_PRICE_PACK_W_MONTHLY"),
    stripePriceIdYearly: envPriceId("STRIPE_PRICE_PACK_W_YEARLY"),
    tagline: "Assignment-of-contract, buyer-match, double-close, state-rule gate",
    businessTypeId: "residential_wholesaler",
  },
};

/**
 * Whether a vertical pack may be sold. A pack is purchasable only when its
 * underlying vertical is production-ready (core|beta). A `roadmap` vertical
 * is on the waitlist — e.g. fix_and_flip was demoted beta→roadmap by founder
 * decision 2026-07-11 — and selling access to it would charge a customer for
 * a frozen product. The checkout route and the pricing UI both gate on this.
 */
export function isVerticalPackPurchasable(packKey: VerticalPackKey): boolean {
  const pack = VERTICAL_PACKS[packKey];
  if (!pack) return false;
  return isProductionReady(pack.businessTypeId);
}

/** The subset of packs that are currently purchasable (vertical is core|beta). */
export function purchasableVerticalPacks(): VerticalPack[] {
  return Object.values(VERTICAL_PACKS).filter((p) => isProductionReady(p.businessTypeId));
}

export function packPriceCents(packKey: VerticalPackKey, interval: BillingInterval): number {
  const pack = VERTICAL_PACKS[packKey];
  if (!pack) return 0;
  return interval === "yearly" ? pack.priceYearlyCents : pack.priceMonthlyCents;
}

export function totalSubscriptionCents(opts: {
  tier: Tier;
  interval: BillingInterval;
  activePacks: VerticalPackKey[];
}): { tierCents: number; packCents: number; totalCents: number } {
  const tierCents = tierPriceCents(opts.tier, opts.interval);
  const packCents = (opts.activePacks ?? []).reduce(
    (s, k) => s + packPriceCents(k, opts.interval),
    0,
  );
  return { tierCents, packCents, totalCents: tierCents + packCents };
}

/** Convenience: returns the price in dollars (float) for display contexts. */
export function tierPriceDollars(tier: Tier, interval: BillingInterval): number {
  return tierPriceCents(tier, interval) / 100;
}

/**
 * Aliases for the legacy `organizations.subscription_tier` column values.
 * Keep this map in sync with the column comment in `shared/schema.ts`.
 *
 * Pre-2026-05-11 the canonical keys were solo/operator/empire — those
 * labels are retained here as aliases so DB rows that were written before
 * the rename still resolve to the right tier.
 */
const SUBSCRIPTION_TIER_ALIASES: Record<string, Tier> = {
  starter: "starter",
  solo: "starter",
  pro: "pro",
  operator: "pro",
  scale: "scale",
  empire: "scale",
};

/**
 * Maps an `organizations.subscription_tier` column value (which may be
 * "free" / "starter" / "pro" / "scale" / legacy "solo" / "operator" /
 * "empire") to the canonical paid {@link Tier}. Returns `null` for the
 * free tier or any unrecognised value — callers should treat that as $0
 * MRR contribution.
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

export const TIERS: readonly Tier[] = ["starter", "pro", "scale"] as const;

/**
 * The env-var NAME that backs a (tier, interval) Stripe price ID. Exposed so
 * checkout guards and the integration-readiness summary can report exactly
 * which secret to set — by NAME only, never the value. Returns the legacy
 * SOLO/OPERATOR/EMPIRE env names (see the comment on TIER_PRICES_CENTS).
 */
export function stripePriceEnvVarName(tier: Tier, interval: BillingInterval): string {
  const legacy: Record<Tier, string> = { starter: "SOLO", pro: "OPERATOR", scale: "EMPIRE" };
  const suffix = interval === "yearly" ? "YEARLY" : "MONTHLY";
  return `STRIPE_PRICE_${legacy[tier]}_${suffix}`;
}

/**
 * Resolve the configured Stripe price ID for a (tier, interval) pair, or
 * `undefined` when the backing `STRIPE_PRICE_*` env var is unset. Use this in
 * checkout code instead of reaching into TIER_PRICES_CENTS directly so the
 * "is this tier purchasable yet?" question has one answer.
 */
export function stripePriceIdFor(tier: Tier, interval: BillingInterval): string | undefined {
  // Read the backing env var LIVE rather than the value captured into
  // TIER_PRICES_CENTS at module load. Load-time capture meant a STRIPE_PRICE_*
  // secret set after import (a fresh Fly secret, or a test) had no effect until
  // a full restart — and made "is this tier purchasable yet?" untestable.
  return envPriceId(stripePriceEnvVarName(tier, interval));
}

/** True when a tier+interval has a configured Stripe price ID and can be checked out. */
export function isTierPurchasable(tier: Tier, interval: BillingInterval): boolean {
  return Boolean(stripePriceIdFor(tier, interval));
}

/**
 * Reverse map: which tier does a Stripe price ID belong to? (Roadmap W1.2,
 * 2026-07 audit.) The subscription webhook resolved tier ONLY from
 * `product.metadata.tier`; when that metadata was missing or misconfigured a
 * PAYING customer stayed on free entitlements and MRR undercounted them.
 * This gives the webhook a deterministic fallback derived from the same
 * STRIPE_PRICE_* env vars checkout uses — the price the customer actually
 * paid can never disagree with the tier it maps to.
 */
export function tierForStripePriceId(priceId: string | null | undefined): Tier | null {
  if (!priceId) return null;
  const tiers: Tier[] = ["starter", "pro", "scale"];
  const intervals: BillingInterval[] = ["monthly", "yearly"];
  for (const tier of tiers) {
    for (const interval of intervals) {
      if (stripePriceIdFor(tier, interval) === priceId) return tier;
    }
  }
  return null;
}

/**
 * Error thrown when a checkout is attempted for a tier whose Stripe price ID
 * is not configured. The message names the missing env var (never a value) so
 * route handlers can surface an honest 503 rather than handing `undefined` to
 * the Stripe API and producing a silent broken checkout.
 */
export class StripePriceNotConfiguredError extends Error {
  readonly tier: Tier;
  readonly interval: BillingInterval;
  readonly envVarName: string;
  constructor(tier: Tier, interval: BillingInterval) {
    const envVarName = stripePriceEnvVarName(tier, interval);
    super(
      `Stripe checkout is not configured for the ${TIER_PRICES_CENTS[tier].displayName} ` +
        `(${interval}) plan — set the ${envVarName} secret before charging for this tier.`,
    );
    this.name = "StripePriceNotConfiguredError";
    this.tier = tier;
    this.interval = interval;
    this.envVarName = envVarName;
  }
}

/**
 * Resolve a Stripe price ID for checkout, throwing {@link StripePriceNotConfiguredError}
 * when the backing env var is unset. Checkout route handlers should call this
 * and translate the thrown error into a 503 ("billing not configured") rather
 * than letting an `undefined` price ID reach Stripe.
 */
export function requireStripePriceId(tier: Tier, interval: BillingInterval): string {
  const priceId = stripePriceIdFor(tier, interval);
  if (!priceId) {
    throw new StripePriceNotConfiguredError(tier, interval);
  }
  return priceId;
}

// Seat arithmetic (allowance, add-on billing, ceiling) lives in
// ./seats.ts, which reads the seat numbers from tier-limits.ts.
