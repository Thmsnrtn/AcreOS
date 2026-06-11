/**
 * Single source of pricing-TIER MARKETING COPY (name, tagline, feature
 * bullets, CTA label) for the two public pricing surfaces:
 *
 *   - client/src/pages/pricing.tsx          (the full /pricing page)
 *   - client/src/pages/landing/Pricing.tsx  (the landing-page section)
 *
 * T3 Census W4-5 — both surfaces previously carried their own copy of this
 * data and drifted (the landing card still advertised "10 leads" on Free
 * after the 2026-05-11 bump to 50, and "Unlimited seats" on Pro against a
 * 2-included / 5-max seat table). The two surfaces may RENDER differently;
 * the DATA must come from here.
 *
 * Numbers are NEVER hand-typed:
 *   - prices derive from shared/billing/tier-pricing.ts (TIER_PRICES_CENTS)
 *   - limits derive from shared/billing/tier-limits.ts (TIER_LIMITS)
 *
 * Only qualitative marketing claims (counties in buy-box, mailer volumes,
 * white-glove migration, …) live here as literals — and those existed on
 * the public surfaces before this module; do not invent new claims.
 */

import { TIER_PRICES_CENTS } from "@shared/billing/tier-pricing";
import { TIER_LIMITS } from "@shared/billing/tier-limits";

export type PricingTierId = "free" | "starter" | "pro" | "scale";

export interface PricingTierCopy {
  /**
   * Keys the ?plan= tier context the signup CTA carries into the
   * acquisition-UTM chain (Tier 2C) — must match TIER_PRICES_CENTS keys.
   */
  id: PricingTierId;
  name: string;
  /** One-line positioning under the tier name. */
  tagline: string;
  /** Monthly price in whole dollars (0 for the free tier). */
  priceMonthly: number;
  /** Yearly price in whole dollars (0 for the free tier). */
  priceYearly: number;
  /** Marketing feature bullets (landing cards; /pricing renders its own comparison table). */
  features: string[];
  ctaLabel: string;
  /** Sales-assisted tiers route to SCALE_SALES_MAILTO, never self-serve checkout. */
  salesAssisted: boolean;
  /** "Most popular" treatment. */
  highlighted: boolean;
}

function fmtLimit(value: number | null): string {
  return value === null ? "Unlimited" : value.toLocaleString("en-US");
}

/**
 * Seat bullet derived from TIER_LIMITS so seat copy can never contradict
 * the server-side seat gate. (The landing card used to claim "Unlimited
 * seats" on Pro and "Unlimited users" on Scale against a 5- / 100-seat
 * table — the limits module wins.)
 */
function seatLine(tier: PricingTierId): string {
  const t = TIER_LIMITS[tier];
  if (t.seatPriceCents === null) {
    return t.includedSeats === 1 ? "1 user" : `${t.includedSeats} users`;
  }
  const seats = t.includedSeats.toLocaleString("en-US");
  return `${seats} seats included (add more at $${t.seatPriceCents / 100}/seat)`;
}

/** Sales-assisted Scale path — single mailto shared by both surfaces. */
export const SCALE_SALES_MAILTO =
  "mailto:sales@acreos.io?subject=AcreOS%20Scale%20tier%20inquiry";

/**
 * Tier 2C — carry which tier + cadence the user clicked into the signup
 * URL. capturePendingUtm() folds plan/billing into the first-touch
 * snapshot so trial_to_paid cohorts can be segmented by stated intent.
 */
export function tierSignupHref(
  id: PricingTierId,
  billing: "yearly" | "monthly",
): string {
  return `/auth?mode=register&plan=${id}&billing=${billing}`;
}

/**
 * Monthly-equivalent display price: annual tiers show priceYearly / 12,
 * rounded — both surfaces must round the same way or the landing and
 * /pricing disagree by a dollar.
 */
export function displayMonthlyPrice(tier: PricingTierCopy, annual: boolean): number {
  if (tier.priceMonthly === 0) return 0;
  return annual ? Math.round(tier.priceYearly / 12) : tier.priceMonthly;
}

export const PRICING_TIER_COPY: PricingTierCopy[] = [
  {
    id: "free",
    name: "Free",
    tagline: "Explore the platform — no card required.",
    priceMonthly: 0,
    priceYearly: 0,
    features: [
      seatLine("free"),
      `${fmtLimit(TIER_LIMITS.free.leads)} leads / ${fmtLimit(TIER_LIMITS.free.properties)} properties / ${fmtLimit(TIER_LIMITS.free.notes)} notes`,
      `Pax assistant (${fmtLimit(TIER_LIMITS.free.ai_requests)} messages / mo)`,
      "Lead inbox with Pax drafts",
      "6 free data sources",
    ],
    ctaLabel: "Get started",
    salesAssisted: false,
    highlighted: false,
  },
  {
    id: "starter",
    name: TIER_PRICES_CENTS.starter.displayName,
    tagline: "Replace your spreadsheet.",
    priceMonthly: TIER_PRICES_CENTS.starter.priceMonthlyCents / 100,
    priceYearly: TIER_PRICES_CENTS.starter.priceYearlyCents / 100,
    features: [
      seatLine("starter"),
      "3 counties in buy-box",
      `Full Pax assistant (${fmtLimit(TIER_LIMITS.starter.ai_requests)} messages / mo)`,
      "500 mailers / mo",
      "Lead inbox with Pax drafts",
      "Audit log",
    ],
    ctaLabel: "Start 14-day free trial",
    salesAssisted: false,
    highlighted: false,
  },
  {
    id: "pro",
    name: TIER_PRICES_CENTS.pro.displayName,
    tagline: "For serious operators.",
    priceMonthly: TIER_PRICES_CENTS.pro.priceMonthlyCents / 100,
    priceYearly: TIER_PRICES_CENTS.pro.priceYearlyCents / 100,
    features: [
      seatLine("pro"),
      "Unlimited counties in buy-box",
      "Full Pax assistant + automation builder",
      "Unlimited campaigns (BYOK for postage)",
      "Bring-your-own-key for parcel + skip-trace data",
      "Note servicing automation",
      "Roles + permissions",
      "Priority support",
    ],
    ctaLabel: "Start 14-day free trial",
    salesAssisted: false,
    highlighted: true,
  },
  {
    id: "scale",
    name: TIER_PRICES_CENTS.scale.displayName,
    tagline: "For full-time operations & multi-state.",
    priceMonthly: TIER_PRICES_CENTS.scale.priceMonthlyCents / 100,
    priceYearly: TIER_PRICES_CENTS.scale.priceYearlyCents / 100,
    features: [
      seatLine("scale"),
      "Custom integrations",
      "Dedicated success partner",
      "10K mailers / mo",
      "White-glove migration",
      "Quarterly portfolio review",
    ],
    // Scale is sales-assisted, not self-serve — custom integrations,
    // white-glove migration, and a dedicated success partner are quoted,
    // not checked out.
    ctaLabel: "Talk to us",
    salesAssisted: true,
    highlighted: false,
  },
];
