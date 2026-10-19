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
import { tierForSubscriptionTier, type Tier } from "@shared/billing/tier-pricing";
import { planAdmitsSeats, seatRuleFor } from "@shared/billing/seats";
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
 * `lane` is `CreditService.evaluateCredits`'s answer. The org's own balance
 * pays first in every lane (credits.ts), so buying credits always unblocks
 * this refusal; `"trial"` only adds that the trial's free allowance is spent,
 * and the org's own AI key is the other way past it.
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
        "chatting now — those messages run on your key, not on credits — or add credits.";
      nextStep = { label: "Add your AI key", href: NEXT_STEP_HREF.byok };
    } else {
      // Own-key AI routing is open to every paid tier (usageLimits.checkAiTurnGate).
      const unlock = nextPaidTier(input.subscriptionTier);
      message =
        "You've used the Pax usage included with your trial. Add credits to keep chatting" +
        (unlock ? `, or upgrade to ${tierDisplayName(unlock)} to connect your own AI provider key.` : ".");
      nextStep = { label: "Add credits", href: NEXT_STEP_HREF.addCredits };
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
    /** The other way past it, after "Add credits, or …". Default: send to fewer recipients. */
    orElse?: string;
    docsSlug?: string;
  },
): void {
  sendError(
    res,
    input.status,
    CREDITS_REQUIRED,
    `${input.what} needs ${dollars(input.requiredCents)} of prepaid credit and this account has ` +
      `${dollars(input.balanceCents)}. Add credits, or ${input.orElse ?? "send to fewer recipients"}.`,
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
 * 402 for a teammate invite the org's seat allowance does not cover.
 *
 * Codes are unchanged (`upgrade_required`, `seat_purchase_required`); the
 * message names what unlocks the invite and `details.nextStep` links it.
 * The seat arithmetic is shared/billing/seats.ts — this only words the
 * refusal, and every number in it is read from TIER_LIMITS.
 *
 * What is self-serve today: changing plan (a plan's included seats apply as
 * soon as the org is on it). What is not: seats beyond a plan's included
 * ones — no in-app control applies them — so those name support.
 */
export function refuseSeatInvite(
  res: Response,
  input: {
    subscriptionTier: string | null | undefined;
    tier: Tier | null;
    projected: number;
    seatAllowance: number;
    inviting: number;
  },
): void {
  const { subscriptionTier, tier, projected, seatAllowance, inviting } = input;
  const current = seatRuleFor(subscriptionTier);
  const planName = tierDisplayName(current.tier);
  const seats = (n: number) => `${n} seat${n === 1 ? "" : "s"}`;

  if (!planAdmitsSeats(subscriptionTier, projected)) {
    // The first VISIBLE tier up the ladder whose INCLUDED seats cover the
    // invite (self-serve: upgrading applies them), else the first whose
    // ceiling admits it (the seats past its included ones need support).
    let included: SubscriptionTier | null = null;
    let admits: SubscriptionTier | null = null;
    const start = TIER_UPGRADE_LADDER.indexOf(current.tier);
    for (let i = Math.max(0, start) + 1; i < TIER_UPGRADE_LADDER.length; i++) {
      const step = TIER_UPGRADE_LADDER[i];
      if (!isTierVisible(step)) continue;
      if (!included && seatRuleFor(step).includedSeats >= projected) included = step;
      if (!admits && planAdmitsSeats(step, projected)) admits = step;
    }
    const base = {
      projected,
      seatAllowance,
      includedSeats: current.includedSeats,
      tier,
    };
    if (included) {
      Errors.refusedUntil(
        res,
        "upgrade_required",
        `${planName} includes ${seats(current.includedSeats)}; this invite needs ${projected}. ` +
          `${tierDisplayName(included)} includes ${seats(seatRuleFor(included).includedSeats)}, ` +
          "available as soon as you switch plans.",
        { ...base, seatsStartOn: included, nextStep: { label: `See ${tierDisplayName(included)}`, href: planLink(included) } },
      );
      return;
    }
    Errors.refusedUntil(
      res,
      "upgrade_required",
      admits
        ? `${planName} can't hold ${projected} seats. ${tierDisplayName(admits)} includes ` +
            `${seats(seatRuleFor(admits).includedSeats)}; seats beyond those are added by support today — ` +
            "contact support to add teammates."
        : `${planName} can't hold ${projected} seats on a self-serve plan — contact support to add teammates.`,
      { ...base, seatsStartOn: admits, nextStep: { label: "Contact support", href: NEXT_STEP_HREF.support } },
    );
    return;
  }

  const needed = projected - seatAllowance;
  Errors.refusedUntil(
    res,
    "seat_purchase_required",
    `Inviting ${inviting} teammate${inviting === 1 ? "" : "s"} needs ${projected} seats and this ` +
      `organization has ${seatAllowance} (${planName} includes ${current.includedSeats}). Seats beyond ` +
      `those are added by support today — contact support to add ${needed === 1 ? "a seat" : `${needed} seats`}.`,
    {
      projected,
      seatAllowance,
      includedSeats: current.includedSeats,
      tier,
      additionalSeatsNeeded: needed,
      nextStep: { label: "Contact support", href: NEXT_STEP_HREF.support },
    },
  );
}

/**
 * 402 for buying seats beyond a plan's included ones: not self-serve today.
 * Nothing in the app fulfils a seat purchase, so seats past the included ones
 * are added by support. Shared by the seat purchase routes and the seat-count
 * route so every self-serve seat path says the same thing.
 */
export function refuseSeatPurchase(res: Response, subscriptionTier: string | null | undefined): void {
  const { includedSeats } = seatRuleFor(subscriptionTier);
  Errors.refusedUntil(
    res,
    "seat_purchase_unavailable",
    `Your plan includes ${includedSeats} seat${includedSeats === 1 ? "" : "s"}. ` +
      "Seats beyond those are added by support today — contact support to add teammates.",
    { includedSeats, nextStep: { label: "Contact support", href: NEXT_STEP_HREF.support } },
  );
}
