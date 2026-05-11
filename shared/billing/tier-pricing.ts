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
   * BEYOND the bundled 1 seat. `null` means the tier is single-user only —
   * the org must upgrade to add a teammate. Phase 5 §5 (team readiness).
   */
  priceMonthlyPerSeatCents: number | null;
  /** Stripe Price ID for the per-seat add-on, monthly billing. */
  stripePriceIdSeatMonthly?: string;
  /** Stripe Price ID for the per-seat add-on, yearly billing. */
  stripePriceIdSeatYearly?: string;
  /** Maximum seats allowed on this tier (null = unlimited). */
  maxSeats: number | null;
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
    priceMonthlyCents: 2000,   // $20.00 / mo
    priceYearlyCents: 20000,   // $200.00 / yr — ~16% discount
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
    maxSeats: 1,
  },
  pro: {
    priceMonthlyCents: 4900,   // $49.00 / mo
    priceYearlyCents: 49000,   // $490.00 / yr — ~16% discount
    stripePriceIdMonthly: envPriceId("STRIPE_PRICE_OPERATOR_MONTHLY"),
    stripePriceIdYearly: envPriceId("STRIPE_PRICE_OPERATOR_YEARLY"),
    displayName: "Pro",
    // $20/seat after the first.
    priceMonthlyPerSeatCents: 2000,
    stripePriceIdSeatMonthly: envPriceId("STRIPE_PRICE_OPERATOR_SEAT_MONTHLY"),
    stripePriceIdSeatYearly: envPriceId("STRIPE_PRICE_OPERATOR_SEAT_YEARLY"),
    maxSeats: null,
  },
  scale: {
    priceMonthlyCents: 7900,   // $79.00 / mo
    priceYearlyCents: 79000,   // $790.00 / yr — ~16% discount
    stripePriceIdMonthly: envPriceId("STRIPE_PRICE_EMPIRE_MONTHLY"),
    stripePriceIdYearly: envPriceId("STRIPE_PRICE_EMPIRE_YEARLY"),
    displayName: "Scale",
    // $30/seat after the first — see follow-up commit for the
    // reconciliation to the $40 pricing-page promise.
    priceMonthlyPerSeatCents: 3000,
    stripePriceIdSeatMonthly: envPriceId("STRIPE_PRICE_EMPIRE_SEAT_MONTHLY"),
    stripePriceIdSeatYearly: envPriceId("STRIPE_PRICE_EMPIRE_SEAT_YEARLY"),
    maxSeats: null,
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
  },
  buy_and_hold: {
    key: "buy_and_hold",
    displayName: "Property management pack",
    priceMonthlyCents: 20000, // $200/mo
    priceYearlyCents: 200000,
    stripePriceIdMonthly: envPriceId("STRIPE_PRICE_PACK_BH_MONTHLY"),
    stripePriceIdYearly: envPriceId("STRIPE_PRICE_PACK_BH_YEARLY"),
    tagline: "Tenant screening, rent ledger, maintenance tickets, late-fee engine",
  },
  fix_and_flipper: {
    key: "fix_and_flipper",
    displayName: "Fix-and-flip pack",
    priceMonthlyCents: 15000, // $150/mo
    priceYearlyCents: 150000,
    stripePriceIdMonthly: envPriceId("STRIPE_PRICE_PACK_FF_MONTHLY"),
    stripePriceIdYearly: envPriceId("STRIPE_PRICE_PACK_FF_YEARLY"),
    tagline: "ARV, rehab budgets, contractor 1099s, construction draws",
  },
  subdivision: {
    key: "subdivision",
    displayName: "Subdivision pack",
    priceMonthlyCents: 15000,
    priceYearlyCents: 150000,
    stripePriceIdMonthly: envPriceId("STRIPE_PRICE_PACK_SD_MONTHLY"),
    stripePriceIdYearly: envPriceId("STRIPE_PRICE_PACK_SD_YEARLY"),
    tagline: "Lot subdivision, CC&R templates, permit tracker",
  },
  wholesale: {
    key: "wholesale",
    displayName: "Wholesale pack",
    priceMonthlyCents: 10000,
    priceYearlyCents: 100000,
    stripePriceIdMonthly: envPriceId("STRIPE_PRICE_PACK_W_MONTHLY"),
    stripePriceIdYearly: envPriceId("STRIPE_PRICE_PACK_W_YEARLY"),
    tagline: "Assignment-of-contract, buyer-match, double-close, state-rule gate",
  },
};

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
 * Per-seat add-on price (cents) for the tier, honoring billing interval.
 * Returns 0 when the tier is single-user only or seatCount <= 1.
 *
 * Phase 5 §5 (team readiness). Starter cannot add seats — callers should
 * call {@link canAddSeats} BEFORE invoking this and prompt for an upgrade.
 */
export function seatAddonCents(
  tier: Tier,
  seatCount: number,
  interval: BillingInterval = "monthly",
): number {
  const pricing = TIER_PRICES_CENTS[tier];
  if (pricing.priceMonthlyPerSeatCents === null) return 0;
  const extraSeats = Math.max(0, seatCount - 1);
  const monthlyCents = pricing.priceMonthlyPerSeatCents * extraSeats;
  // Yearly add-on is 10× monthly (matches base-tier 16% yearly discount).
  return interval === "yearly" ? monthlyCents * 10 : monthlyCents;
}

/**
 * Total monthly bill (in cents) for a tier + seat count, including the
 * base subscription and per-seat add-on. Used by the billing UI to render
 * the "$49/mo + 2 extra seats × $20 = $89/mo" math.
 */
export function totalMonthlyBillCents(
  tier: Tier,
  seatCount: number,
  interval: BillingInterval = "monthly",
): number {
  return tierPriceCents(tier, interval) + seatAddonCents(tier, seatCount, interval);
}

/**
 * Whether the tier supports the requested seat count. Starter is hard-capped
 * at 1; Pro / Scale are unlimited. Callers MUST check this before creating
 * an invitation that would push seatCount above the limit.
 */
export function canAddSeats(tier: Tier, requestedSeats: number): boolean {
  const max = TIER_PRICES_CENTS[tier].maxSeats;
  if (max === null) return true;
  return requestedSeats <= max;
}

/**
 * Human-readable seat-pricing breakdown for the billing UI. Renders to
 * "Pro @ $49/mo + 2 extra seats × $20 = $89/mo" or, for Starter,
 * "Starter @ $20/mo (single seat)".
 */
export function describeSeatPricing(
  tier: Tier,
  seatCount: number,
  interval: BillingInterval = "monthly",
): string {
  const pricing = TIER_PRICES_CENTS[tier];
  const baseDollars = tierPriceCents(tier, interval) / 100;
  const intervalSuffix = interval === "yearly" ? "/yr" : "/mo";
  if (pricing.priceMonthlyPerSeatCents === null || seatCount <= 1) {
    return `${pricing.displayName} @ $${baseDollars}${intervalSuffix}` +
      (pricing.maxSeats === 1 ? " (single seat)" : "");
  }
  const extraSeats = seatCount - 1;
  const perSeatDollars = (interval === "yearly"
    ? pricing.priceMonthlyPerSeatCents * 10
    : pricing.priceMonthlyPerSeatCents) / 100;
  const totalDollars = totalMonthlyBillCents(tier, seatCount, interval) / 100;
  return `${pricing.displayName} @ $${baseDollars}${intervalSuffix} + ${extraSeats} extra seat${extraSeats === 1 ? "" : "s"} × $${perSeatDollars} = $${totalDollars}${intervalSuffix}`;
}
