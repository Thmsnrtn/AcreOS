/**
 * THE seat rule — how many people an organization may have, and how many of
 * those seats are billed as add-ons.
 *
 * Every seat number comes from `TIER_LIMITS` (tier-limits.ts): `includedSeats`
 * (bundled in the plan price), `maxSeats` (the plan's ceiling, null =
 * unlimited) and `seatPriceCents` (the add-on price, null = the plan cannot
 * add seats). Founder decision 2026-07-08
 * (docs/company/decision-memos/2026-07-08-founding-member-pricing.md):
 * "Included seats stay: Pro 2 (max 5), Scale 10 (max 100)", and the per-seat
 * add-on applies past the INCLUDED seats.
 *
 * Before this module the rule was computed in several places that disagreed:
 * `organizations.seat_count` defaults to 1 and nothing raised it, so the
 * invite check let a Pro owner (2 seats included) invite nobody; the add-on
 * math billed every seat past the first rather than past the included ones;
 * and the seat ceiling was read from a second table (tier-pricing.ts
 * `maxSeats: null`) that disagreed with tier-limits.ts. Every production
 * reader of a seat number goes through the functions below.
 *
 * Storage: `organizations.seat_count` is the TOTAL number of seats the org has
 * set (default 1). The allowance never falls below the plan's included seats,
 * so the default row is simply "nothing beyond what the plan includes".
 * `organizations.additional_seats` is a legacy column of seats bought beyond
 * the plan; it is honoured on top of the included seats and nothing writes it.
 */

import { TIER_LIMITS, limitsTierFor, type SubscriptionTier } from "./tier-limits";
import { TIER_PRICES_CENTS, tierPriceCents, type Tier, type BillingInterval } from "./tier-pricing";

export interface SeatRule {
  tier: SubscriptionTier;
  includedSeats: number;
  /** null = no ceiling. */
  maxSeats: number | null;
  /** Monthly add-on price per seat beyond the included ones; null = cannot add seats. */
  seatPriceCents: number | null;
}

/** The seat rule for a stored `organizations.subscription_tier` value (legacy names folded). */
export function seatRuleFor(subscriptionTier: string | null | undefined): SeatRule {
  const tier = limitsTierFor(subscriptionTier);
  const limits = TIER_LIMITS[tier];
  return {
    tier,
    includedSeats: limits.includedSeats,
    maxSeats: limits.maxSeats,
    seatPriceCents: limits.seatPriceCents,
  };
}

function wholeSeats(n: number | null | undefined): number {
  return typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

/**
 * How many seats the organization may fill without contacting anyone: the
 * plan's included seats (plus legacy purchased `additional_seats`), or the
 * org's stored `seat_count` when that is higher.
 */
export function effectiveSeatAllowance(
  subscriptionTier: string | null | undefined,
  seatCount: number | null | undefined,
  additionalSeats: number | null | undefined = 0,
): number {
  const { includedSeats } = seatRuleFor(subscriptionTier);
  return Math.max(includedSeats + wholeSeats(additionalSeats), wholeSeats(seatCount));
}

/**
 * Seats billed as per-seat add-ons for a stored seat_count: only the seats
 * beyond the plan's included ones. 0 for a plan that cannot add seats.
 */
export function billableExtraSeats(
  subscriptionTier: string | null | undefined,
  seatCount: number | null | undefined,
): number {
  const rule = seatRuleFor(subscriptionTier);
  if (rule.seatPriceCents === null) return 0;
  return Math.max(0, wholeSeats(seatCount) - rule.includedSeats);
}

/** Whether the plan's ceiling admits this many seats in total. */
export function planAdmitsSeats(subscriptionTier: string | null | undefined, requestedSeats: number): boolean {
  const { includedSeats, maxSeats, seatPriceCents } = seatRuleFor(subscriptionTier);
  if (requestedSeats <= includedSeats) return true;
  if (seatPriceCents === null) return false;
  return maxSeats === null || requestedSeats <= maxSeats;
}

/** Per-seat add-on charge (cents) for a stored seat_count, honouring billing interval. */
export function seatAddonCents(
  tier: Tier,
  seatCount: number,
  interval: BillingInterval = "monthly",
): number {
  const perSeat = TIER_PRICES_CENTS[tier].priceMonthlyPerSeatCents;
  if (perSeat === null) return 0;
  const monthlyCents = perSeat * billableExtraSeats(tier, seatCount);
  // Yearly add-on is 10× monthly (matches base-tier ~17% yearly discount).
  return interval === "yearly" ? monthlyCents * 10 : monthlyCents;
}

/** Base subscription plus per-seat add-on, in cents. */
export function totalMonthlyBillCents(
  tier: Tier,
  seatCount: number,
  interval: BillingInterval = "monthly",
): number {
  return tierPriceCents(tier, interval) + seatAddonCents(tier, seatCount, interval);
}

/**
 * Human-readable seat-pricing breakdown for the billing UI, e.g.
 * "Pro @ $49/mo + 1 extra seat × $20 = $69/mo".
 */
export function describeSeatPricing(
  tier: Tier,
  seatCount: number,
  interval: BillingInterval = "monthly",
): string {
  const pricing = TIER_PRICES_CENTS[tier];
  const rule = seatRuleFor(tier);
  const baseDollars = tierPriceCents(tier, interval) / 100;
  const intervalSuffix = interval === "yearly" ? "/yr" : "/mo";
  const extraSeats = billableExtraSeats(tier, seatCount);
  if (pricing.priceMonthlyPerSeatCents === null || extraSeats === 0) {
    const seatNote = rule.maxSeats === 1
      ? " (single seat)"
      : ` (${rule.includedSeats} seats included)`;
    return `${pricing.displayName} @ $${baseDollars}${intervalSuffix}${seatNote}`;
  }
  const perSeatDollars = (interval === "yearly"
    ? pricing.priceMonthlyPerSeatCents * 10
    : pricing.priceMonthlyPerSeatCents) / 100;
  const totalDollars = totalMonthlyBillCents(tier, seatCount, interval) / 100;
  return `${pricing.displayName} @ $${baseDollars}${intervalSuffix} + ${extraSeats} extra seat${extraSeats === 1 ? "" : "s"} × $${perSeatDollars} = $${totalDollars}${intervalSuffix}`;
}
