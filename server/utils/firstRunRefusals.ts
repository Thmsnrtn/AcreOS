/**
 * Refusals a new account meets in its first session, each saying what
 * unlocks it.
 *
 * A first-run refusal with no path forward reads as "the product is broken":
 * Pax answering a first message with `402 { error: "Insufficient credits" }`,
 * or an invite form answering `402` with no link. These builders do not
 * change WHO is refused — credit amounts, seat counts and plan entitlements
 * are owner decisions and are read, never set, here. They change what the
 * refusal says: a machine-readable `error` code, a sentence naming the plan or
 * action that unlocks the action, and `details.nextStep = { label, href }`,
 * which the client renders as the call to action.
 *
 * Every number in a message is read from the request's own state (the
 * balance, the price of the action) or from the canonical billing tables.
 */

import type { Response } from "express";
import { Errors, sendError } from "./errors";
import {
  TIER_LIMITS,
  TIER_UPGRADE_LADDER,
  isTierVisible,
  nextPaidTier,
  type SubscriptionTier,
} from "@shared/billing/tier-limits";
import { canAddSeats, tierForSubscriptionTier, type Tier } from "@shared/billing/tier-pricing";
import { tierDisplayName } from "@shared/billing/plan-limit-copy";

export const PAX_CREDITS_REQUIRED = "PAX_CREDITS_REQUIRED" as const;
/** A metered action (an email or SMS send) the prepaid credit balance cannot cover. */
const CREDITS_REQUIRED = "CREDITS_REQUIRED" as const;

/** Where each unlocking action lives in the app. */
const NEXT_STEP_HREF = {
  /** Usage & Credits (credit purchase) and Seat management live on the Account tab. */
  addCredits: "/settings#account",
  byok: "/settings/byok",
  support: "/support",
} as const;

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function planLink(tier: SubscriptionTier): string {
  return `/settings#billing?tier=${tier}`;
}

/**
 * Whether a stored tier can route Pax through the org's own AI key, read from
 * the tier table — the same rule `usageLimits.checkAiTurnGate` applies (own-key
 * AI is open to every paid tier). Used when the AI-turn gate failed open and
 * left no answer, so the refusal neither invents nor denies the option.
 */
function tierAllowsOwnAiKey(subscriptionTier: string | null | undefined): boolean {
  const paid = tierForSubscriptionTier(subscriptionTier);
  if (paid) return TIER_LIMITS[paid].byokSupport || paid === "starter";
  return (subscriptionTier ?? "").toLowerCase() === "enterprise";
}

/**
 * 402 for a Pax turn the account's credit lane cannot cover.
 *
 * `lane` is `CreditService.evaluateCredits`'s answer, and it decides the
 * remedy: inside the trial the balance is never read, so "add credits" would
 * be a false promise — only routing the turn through the org's own AI key
 * gets past it before the trial ends. Past the trial, prepaid credits do.
 */
export function refusePaxCredits(
  res: Response,
  input: {
    lane: "trial" | "balance" | "founder";
    requiredCents: number;
    balanceCents: number;
    subscriptionTier: string | null | undefined;
    /**
     * From the AI-turn gate: can this tier connect its own AI key. Undefined
     * when the gate did not run (it fails open) — then the tier table decides.
     */
    byokAvailable: boolean | undefined;
  },
): void {
  const byokAvailable = input.byokAvailable ?? tierAllowsOwnAiKey(input.subscriptionTier);
  let message: string;
  let nextStep: { label: string; href: string };

  if (input.lane === "trial") {
    if (byokAvailable) {
      message =
        "You've used the Pax usage included with your trial. Add your own AI provider key to keep " +
        "chatting now — those messages run on your key, not on credits.";
      nextStep = { label: "Add your AI key", href: NEXT_STEP_HREF.byok };
    } else {
      // Own-key AI routing is open to every paid tier (usageLimits.checkAiTurnGate).
      const unlock = nextPaidTier(input.subscriptionTier);
      message =
        "You've used the Pax usage included with your trial. " +
        (unlock
          ? `Upgrade to ${tierDisplayName(unlock)} to connect your own AI provider key and keep chatting, ` +
            "or add credits once your trial ends."
          : "Add credits once your trial ends to keep chatting.");
      nextStep = unlock
        ? { label: `See ${tierDisplayName(unlock)}`, href: planLink(unlock) }
        : { label: "Add credits", href: NEXT_STEP_HREF.addCredits };
    }
  } else {
    message =
      `This message needs ${dollars(input.requiredCents)} of prepaid credit and this account has ` +
      `${dollars(input.balanceCents)}. Add credits to keep chatting` +
      (byokAvailable ? ", or add your own AI provider key." : ".");
    nextStep = { label: "Add credits", href: NEXT_STEP_HREF.addCredits };
  }

  Errors.refusedUntil(res, PAX_CREDITS_REQUIRED, message, {
    reason: "pax_credits_required",
    lane: input.lane,
    requiredCents: input.requiredCents,
    balanceCents: input.balanceCents,
    byokAvailable,
    nextStep,
  });
}

/**
 * Refusal for a metered send (campaign email / SMS) whose cost the prepaid
 * balance does not cover. These used to answer with the rate-limit sentence
 * ("You're sending requests faster than the system can handle"), which is
 * wrong advice: waiting never refills a balance. Status is the caller's (the
 * campaign sends keep their historical 429); the amounts are the caller's.
 */
export function refuseCreditShortage(
  res: Response,
  input: {
    status: 402 | 429;
    /** What is being paid for, as a sentence subject: "This email send". */
    what: string;
    requiredCents: number;
    balanceCents: number;
    details: Record<string, unknown>;
    docsSlug?: string;
  },
): void {
  sendError(
    res,
    input.status,
    CREDITS_REQUIRED,
    `${input.what} needs ${dollars(input.requiredCents)} of prepaid credit and this account has ` +
      `${dollars(input.balanceCents)}. Add credits, or send to fewer recipients.`,
    {
      ...input.details,
      reason: "credits_required",
      requiredCents: input.requiredCents,
      balanceCents: input.balanceCents,
      nextStep: { label: "Add credits", href: NEXT_STEP_HREF.addCredits },
    },
    input.docsSlug ? `/help/article/${input.docsSlug}` : undefined,
  );
}

/**
 * 402 for a teammate invite the org's plan or seat count does not cover.
 *
 * Codes are unchanged (`upgrade_required`, `seat_purchase_required`); the
 * message now names what unlocks the invite and `details.nextStep` links it.
 * The seat arithmetic is the caller's — this only words the refusal.
 */
export function refuseSeatInvite(
  res: Response,
  input: {
    subscriptionTier: string | null | undefined;
    tier: Tier | null;
    projected: number;
    seatCount: number;
    inviting: number;
  },
): void {
  const { tier, projected, seatCount, inviting } = input;
  const planName = tier ? tierDisplayName(tier) : tierDisplayName("free");

  // Seat counts are not self-serve today: nothing in the app raises
  // `seat_count`, so upgrading a plan does NOT by itself let an owner invite
  // anyone. Every seat refusal therefore names support as the step — the
  // plan is mentioned only as context, never as the fix.
  if (!tier || !canAddSeats(tier, projected)) {
    // The first VISIBLE tier up the ladder whose seat rule admits this many
    // seats (same visibility rule as nextPaidTier).
    let unlock: SubscriptionTier | null = null;
    const start = TIER_UPGRADE_LADDER.indexOf((tier ?? "free") as SubscriptionTier);
    for (let i = Math.max(0, start) + 1; i < TIER_UPGRADE_LADDER.length; i++) {
      const step = TIER_UPGRADE_LADDER[i];
      if (!isTierVisible(step)) continue;
      const candidate = tierForSubscriptionTier(step);
      if (candidate && canAddSeats(candidate, projected)) {
        unlock = candidate;
        break;
      }
    }
    Errors.refusedUntil(
      res,
      "upgrade_required",
      (unlock
        ? `${planName} doesn't include teammate seats; they start on ${tierDisplayName(unlock)}. `
        : `${planName} can't hold ${projected} seats on a self-serve plan. `) +
        "Seat counts are set by support today — contact support to add teammates.",
      {
        projected,
        seatCount,
        tier,
        seatsStartOn: unlock,
        nextStep: { label: "Contact support", href: NEXT_STEP_HREF.support },
      },
    );
    return;
  }

  const needed = projected - seatCount;
  Errors.refusedUntil(
    res,
    "seat_purchase_required",
    `Inviting ${inviting} teammate${inviting === 1 ? "" : "s"} needs ${projected} seats and this ` +
      `organization is set up for ${seatCount}. Seat counts are set by support today — contact support to ` +
      `add ${needed === 1 ? "a seat" : `${needed} seats`}.`,
    {
      projected,
      seatCount,
      tier,
      additionalSeatsNeeded: needed,
      nextStep: { label: "Contact support", href: NEXT_STEP_HREF.support },
    },
  );
}
