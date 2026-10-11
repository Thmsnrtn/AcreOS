/**
 * The founding-member YEARLY offer (W3 acquisition engine). Browser-safe.
 *
 * Pricing is a founder-only hard stop, so the plan AND the price ship UNSET.
 * Until the founder sets both (a code change recorded in
 * docs/company/founder-decisions-*.md), and turns on the feature flag, and the
 * Stripe yearly price is configured, the offer page refuses and shows no price.
 *
 * No lifetime deals (master build plan W3.4): the offer is a yearly
 * auto-renewing subscription and nothing else. `interval` is the literal
 * "year", and checkout refuses any Stripe price that is not a yearly recurring
 * price of exactly `priceYearlyCents` (server/routes-acquisition-offers.ts).
 *
 * California's Automatic Renewal Law (W1, shared/billing/autoRenewalTerms.ts)
 * applies in full: the terms beside the consent, an acknowledgment the buyer
 * keeps, the 15–45-day pre-renewal notice, and online cancellation.
 */
import { autoRenewalTermsText } from "./autoRenewalTerms";
import type { Tier } from "./tier-pricing";

export const FOUNDING_MEMBER_OFFER: {
  flagKey: "offer.founding_member_yearly";
  /** Which plan founding members get. null = not decided. */
  tier: Tier | null;
  /** Yearly price in cents. null = not decided. */
  priceYearlyCents: number | null;
  /** Env var holding the Stripe yearly price id the founder creates. */
  stripePriceEnv: "STRIPE_PRICE_FOUNDING_MEMBER_YEARLY";
  interval: "year";
  decidedOn: string | null;
  decisionRecord: string | null;
} = {
  flagKey: "offer.founding_member_yearly",
  tier: null,
  priceYearlyCents: null,
  stripePriceEnv: "STRIPE_PRICE_FOUNDING_MEMBER_YEARLY",
  interval: "year",
  decidedOn: null,
  decisionRecord: null,
};

const PLAN_NAMES: Record<Tier, string> = { starter: "Starter", pro: "Pro", scale: "Scale" };

export type FoundingOfferAvailability =
  | { available: true; offer: { tier: Tier; planName: string; priceYearlyCents: number; currency: "usd"; interval: "year"; termsText: string } }
  | { available: false; reason: "flag_off" | "price_unset" | "plan_unset" | "stripe_price_missing"; message: string };

const FOUNDING_OFFER_MESSAGES = {
  flag_off: "The founding-member offer is not open.",
  price_unset: "The founding-member offer is not open yet: its price has not been set.",
  plan_unset: "The founding-member offer is not open yet: its plan has not been chosen.",
  stripe_price_missing: "The founding-member offer is not open yet: its yearly price is not configured for checkout.",
} as const;

/** Whether the offer may be shown, and with which terms. Pure. */
export function foundingOfferAvailability(env: { flagOn: boolean; stripePriceId: string | null | undefined }): FoundingOfferAvailability {
  const o = FOUNDING_MEMBER_OFFER;
  if (!env.flagOn) return { available: false, reason: "flag_off", message: FOUNDING_OFFER_MESSAGES.flag_off };
  if (o.priceYearlyCents === null || !(o.priceYearlyCents > 0)) return { available: false, reason: "price_unset", message: FOUNDING_OFFER_MESSAGES.price_unset };
  if (o.tier === null) return { available: false, reason: "plan_unset", message: FOUNDING_OFFER_MESSAGES.plan_unset };
  if (!env.stripePriceId) return { available: false, reason: "stripe_price_missing", message: FOUNDING_OFFER_MESSAGES.stripe_price_missing };
  const planName = `${PLAN_NAMES[o.tier]} (founding member)`;
  return {
    available: true,
    offer: {
      tier: o.tier,
      planName,
      priceYearlyCents: o.priceYearlyCents,
      currency: "usd",
      interval: "year",
      termsText: autoRenewalTermsText({ planName, priceCents: o.priceYearlyCents, interval: "year" }),
    },
  };
}
