/**
 * Plan-limit refusals — the one place their numbers and words are built.
 *
 * A plan limit and a rate limit are different refusals with different
 * remedies. A rate limit clears by waiting; a plan limit never clears by
 * waiting, only by upgrading (or, for monthly allowances, by the month
 * rolling over). Both used to go out as the same 429 `LIMIT_EXCEEDED` with
 * the same top-level copy — "You're sending requests faster than the system
 * can handle. Wait a few seconds and try again." — so a Free org at its 50th
 * lead was told to slow down and retry, which can never work.
 *
 * Plan limits now carry their own code, `PLAN_LIMIT_REACHED`, and a message
 * built here from the canonical tier table (`TIER_LIMITS`) and the canonical
 * upgrade ladder (`nextPaidTier`). No number in a plan-limit message is
 * written by hand anywhere else: the server gate builds the message with
 * `planLimitMessage`, and the client renders the server's message with the
 * title from `planLimitTitle`.
 *
 * Imports nothing but the two canonical billing modules so the client can
 * use it without pulling server code.
 */

import {
  TIER_LIMITS,
  nextPaidTier,
  type ResourceType,
  type SubscriptionTier,
} from "./tier-limits";
import { TIER_PRICES_CENTS, type Tier } from "./tier-pricing";

/** The `error` code of every plan-limit refusal. Distinct from `LIMIT_EXCEEDED`. */
export const PLAN_LIMIT_REACHED = "PLAN_LIMIT_REACHED" as const;

/**
 * `details` payload of a plan-limit refusal. The field set is the one the
 * 429 has always carried (the upgrade toast and banner read it), plus
 * `requested` for bulk imports that would overshoot the cap.
 */
export interface PlanLimitDetails {
  resourceType: ResourceType;
  currentTier: SubscriptionTier;
  currentCount: number;
  currentLimit: number | null;
  /** Rows a bulk import asked to add, when the refusal is for an import. */
  requested?: number;
  nextTier: SubscriptionTier | null;
  nextTierLimit: number | null;
  nextTierMonthlyPriceCents: number | null;
  upgradeUrl: string;
}

interface ResourceNoun {
  singular: string;
  plural: string;
  /** Monthly allowance (resets each month) rather than a standing count. */
  monthly: boolean;
}

const RESOURCE_NOUNS: Record<ResourceType, ResourceNoun> = {
  leads: { singular: "lead", plural: "leads", monthly: false },
  properties: { singular: "property", plural: "properties", monthly: false },
  notes: { singular: "note", plural: "notes", monthly: false },
  ai_requests: { singular: "Pax message", plural: "Pax messages", monthly: true },
  campaigns: { singular: "campaign", plural: "campaigns", monthly: false },
};

function isPaidTier(tier: SubscriptionTier): tier is Tier {
  return tier === "starter" || tier === "pro" || tier === "scale";
}

/** Customer-facing plan name, from the pricing table where one exists. */
export function tierDisplayName(tier: SubscriptionTier): string {
  if (isPaidTier(tier)) return TIER_PRICES_CENTS[tier].displayName;
  return tier === "free" ? "Free" : "Enterprise";
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Build the refusal `details` for a resource at (or about to pass) its cap.
 * Every number comes from `TIER_LIMITS` / `TIER_PRICES_CENTS`.
 */
export function planLimitDetails(input: {
  resourceType: ResourceType;
  tier: SubscriptionTier;
  current: number;
  limit: number | null;
  requested?: number;
}): PlanLimitDetails {
  const target = nextPaidTier(input.tier);
  const nextLimits = target ? TIER_LIMITS[target] : null;
  const nextPricing = target && isPaidTier(target) ? TIER_PRICES_CENTS[target] : null;
  return {
    resourceType: input.resourceType,
    currentTier: input.tier,
    currentCount: input.current,
    currentLimit: input.limit,
    ...(input.requested !== undefined ? { requested: input.requested } : {}),
    nextTier: target,
    nextTierLimit: nextLimits ? (nextLimits[input.resourceType] ?? null) : null,
    nextTierMonthlyPriceCents: nextPricing?.priceMonthlyCents ?? null,
    upgradeUrl: target ? `/settings#billing?tier=${target}` : "/settings#billing",
  };
}

/** What a plan allows of a resource, as a clause: "allows 250 leads". */
function allowanceClause(limit: number | null, noun: ResourceNoun): string {
  if (limit === null) return `has no ${noun.singular} limit`;
  if (limit === 0) return `doesn't include ${noun.plural}`;
  return `allows ${fmt(limit)} ${noun.plural}${noun.monthly ? " a month" : ""}`;
}

/**
 * The refusal sentence. Says what was reached, on which plan, and what the
 * next plan allows — e.g. "You've reached 50 leads on Free. Starter allows
 * 250 leads."
 */
export function planLimitMessage(d: PlanLimitDetails): string {
  const noun = RESOURCE_NOUNS[d.resourceType];
  const plan = tierDisplayName(d.currentTier);
  const limit = d.currentLimit ?? 0;

  let head: string;
  if (d.currentLimit === 0) {
    head = `${capitalize(noun.plural)} aren't included on ${plan}.`;
  } else if (d.requested !== undefined) {
    head =
      `Adding ${fmt(d.requested)} ${d.requested === 1 ? noun.singular : noun.plural} would take you past ` +
      `the ${fmt(limit)} ${noun.plural} ${plan} allows (you have ${fmt(d.currentCount)}).`;
  } else if (noun.monthly) {
    head = `You've used all ${fmt(limit)} ${noun.plural} included this month on ${plan}.`;
  } else {
    head = `You've reached ${fmt(limit)} ${noun.plural} on ${plan}.`;
  }

  const tail = d.nextTier
    ? ` ${tierDisplayName(d.nextTier)} ${allowanceClause(d.nextTierLimit, noun)}.`
    : ` ${plan} is the highest self-serve plan.`;
  return head + tail;
}

/** Short heading for the refusal: "Lead limit reached on Free". */
export function planLimitTitle(d: Pick<PlanLimitDetails, "resourceType" | "currentTier">): string {
  const noun = RESOURCE_NOUNS[d.resourceType] ?? { singular: "usage", plural: "usage", monthly: false };
  return `${capitalize(noun.singular)} limit reached on ${tierDisplayName(d.currentTier)}`;
}
