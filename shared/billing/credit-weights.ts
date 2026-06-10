/**
 * Credit weights — Pillar 4 (Credit System + Tier Realignment), foundations.
 *
 * Customers buy a monthly "credit pool" with their tier (see
 * `server/services/usageLimits.ts → TIER_LIMITS[*].creditPool`). Each metered
 * action draws a fixed weight from that pool. Weights are denominated in
 * tenths of a cent (so 1 credit ≈ $0.01 of provider cost) — they should
 * roughly track the 90th-percentile actual cost-to-us per action so heavy
 * usage stays contribution-positive.
 *
 * The constants below are the launch defaults from the approved plan:
 *
 *   sms_outbound:    1     // ~$0.01/segment via Telnyx (Twilio fallback)
 *   email_outbound:  0.02  // ~$0.0002/email via SES (warm IP)
 *   postcard_eddm:   31    // ~$0.31 saturation EDDM, sponsor pool eligible
 *   postcard_postgrid: 55  // ~$0.55 single-piece PostGrid
 *   postcard_lob:    75    // ~$0.75 single-piece Lob fallback
 *   letter_presort:  32    // ~$0.32 presort via Mail.dat partner
 *   letter_lob:      120   // ~$1.20 single-piece Lob letter fallback
 *   skip_trace:      30    // ~$0.30 BatchData (cache-shared, ~$0.05 effective)
 *   ai_turn_avg:     1.5   // ~$0.015 blended (Haiku-classify + Sonnet-synthesize)
 *
 * Every value lives in `founder_settings` under key `credits.weight.{action}`
 * so the founder can recalibrate from /founder/studio/credits without a
 * deploy. The constants in this file are the fallback the settings service
 * returns when no override row exists.
 *
 * NOTE: This file is foundation-only. Action handlers do not yet draw from
 * the pool — wiring happens in the enforcement task. Handlers import the
 * async `creditCost()` override-aware helper from
 * server/services/creditCost.ts (server-only; this shared file stays pure).
 */

export type CreditAction =
  | "sms_outbound"
  | "email_outbound"
  | "postcard_eddm"
  | "postcard_postgrid"
  | "postcard_lob"
  | "letter_presort"
  | "letter_lob"
  | "skip_trace"
  | "ai_turn_avg"
  // ── Paid data-lookup actions (Lena: close the margin leak) ──
  // Each fires only when a PAID provider serves a non-cached result. Free
  // providers and cache hits debit 0 (no weight drawn). Weights track the
  // 90th-percentile provider cost-to-us per lookup (Regrid 3–8¢, ATTOM 5–20¢).
  | "parcel_lookup_paid"
  | "comps_lookup"
  | "owner_lookup"
  | "valuation_lookup";

/**
 * Cent-cost weight per metered action. 1 credit = ~$0.01 to AcreOS.
 * Fractional weights (e.g. email at 0.02) round up at deduction time so
 * we never undercount a heavy month.
 */
export const CREDIT_WEIGHTS: Record<CreditAction, number> = {
  sms_outbound: 1,
  email_outbound: 0.02,
  postcard_eddm: 31,
  postcard_postgrid: 55,
  postcard_lob: 75,
  letter_presort: 32,
  letter_lob: 120,
  skip_trace: 30,
  ai_turn_avg: 1.5,
  // Paid data lookups — p90 provider cost-to-us per category. These are the
  // FALLBACK weights; the registry passes the real costCents at deduction
  // time via poolDebit, but these define the credit-pool sizing math and the
  // founder-recalibration anchor for each action.
  parcel_lookup_paid: 8, // Regrid parcel up to 8¢
  comps_lookup: 20, // ATTOM comps up to 20¢
  owner_lookup: 8, // Regrid/ATTOM owner up to 8¢
  valuation_lookup: 10, // ATTOM AVM up to 10¢
};

/**
 * Map a data-lookup category to its paid-lookup CreditAction, or null when
 * the category has no paid-lookup weight (e.g. environmental/demographics are
 * federal/free and never billed). Used by the provider registry to pick the
 * right action when debiting a paid, non-cached provider success.
 *
 * NOTE: imported by `server/services/providers/provider-registry.ts`. Kept as
 * a pure synchronous map so it's safe to import from either side.
 */
export function creditActionForCategory(
  category: string,
): CreditAction | null {
  switch (category) {
    case "parcel_data":
    case "property_details":
    case "structure":
      return "parcel_lookup_paid";
    case "comps":
      return "comps_lookup";
    case "owner_info":
      return "owner_lookup";
    case "valuation":
      return "valuation_lookup";
    case "skip_trace":
      return "skip_trace";
    default:
      // environmental / demographics → free federal data, never billed.
      return null;
  }
}

// NOTE: the async `creditCost()` helper (founder_settings override + this
// file's constants as fallback) lives in server/services/creditCost.ts — it
// needs the settings service (drizzle/pg) and shared/ must stay
// client-bundle-safe (enforced by scripts/check-boundaries.mjs).

/**
 * One illustrative breakdown for the pricing-page UI. Each example shows
 * what a customer could do with the full pool if they spent it entirely on
 * one channel. The mix surfaces channel-economics differences at a glance
 * (e.g. 24 EDDM postcards vs 750 SMS for the same pool size).
 */
export interface CreditExample {
  label: string;
  action: CreditAction;
  quantity: number;
  /** Total credit spend (poolSize for these examples — they consume it all). */
  creditsConsumed: number;
}

/**
 * Concrete examples for the pricing-page UI — "$20 buys 750 credits, which
 * is 750 SMS / 37,500 emails / 24 EDDM postcards / 25 letters." Caller
 * passes the tier's credit pool size; the result is 4 illustrative
 * full-consumption breakdowns for the Starter $20 → 750 spec in the plan.
 *
 * Uses CREDIT_WEIGHTS (the synchronous constant) rather than the async
 * creditCost() helper — the pricing page is a marketing surface and reads
 * the canonical launch values, not founder-calibrated overrides.
 */
export function creditExamples(poolSize: number): CreditExample[] {
  const examples: Array<{ label: string; action: CreditAction }> = [
    { label: "SMS messages", action: "sms_outbound" },
    { label: "marketing emails", action: "email_outbound" },
    { label: "EDDM postcards", action: "postcard_eddm" },
    { label: "presort letters", action: "letter_presort" },
  ];

  return examples.map(({ label, action }) => {
    const weight = CREDIT_WEIGHTS[action];
    const quantity = Math.floor(poolSize / weight);
    return {
      label,
      action,
      quantity,
      creditsConsumed: poolSize,
    };
  });
}
