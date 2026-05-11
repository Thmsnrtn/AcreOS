/**
 * Per-seat add-on Stripe sync — Phase 5 §5 Part A (team readiness).
 *
 * When an admin changes seatCount, the org's Stripe subscription must
 * grow / shrink the per-seat line item to match. This module is the
 * single place that talks to Stripe for per-seat billing so checkout,
 * the billing UI, and the invite-preflight upgrade flow share one path.
 *
 * Behavior contract:
 *   • If org has no Stripe subscription → no-op (free tier / dev env).
 *   • If tier is starter → throw, since starter cannot have additional seats.
 *   • If extraSeats === 0 → remove the per-seat line item (or skip if absent).
 *   • Otherwise upsert a subscription item on the per-seat Price, quantity =
 *     seatCount - 1. Idempotent on repeat calls.
 *
 * In dev / CI where Stripe price IDs are unset, this becomes a structured
 * log-only operation so tests don't depend on a live Stripe account.
 */

import { db } from "../../storage";
import { organizations } from "@shared/schema";
import { eq } from "drizzle-orm";
import { logger } from "../../utils/logger";
import {
  TIER_PRICES_CENTS,
  tierForSubscriptionTier,
  type Tier,
  type BillingInterval,
} from "@shared/billing/tier-pricing";

export interface SeatSyncResult {
  ok: boolean;
  reason?: string;
  subscriptionItemId?: string;
  quantity?: number;
}

export async function syncSeatAddon(
  organizationId: number,
  seatCount: number,
): Promise<SeatSyncResult> {
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  if (!org) {
    return { ok: false, reason: "org_not_found" };
  }

  const tier = tierForSubscriptionTier(org.subscriptionTier);
  if (!tier) {
    return { ok: false, reason: "free_tier" };
  }
  if (tier === "starter" && seatCount > 1) {
    throw new Error("Starter tier does not support additional seats — upgrade first.");
  }

  const subscriptionId = org.stripeSubscriptionId;
  if (!subscriptionId) {
    logger.info("syncSeatAddon: no stripe subscription, skipping", {
      organizationId,
      tier,
      seatCount,
    });
    return { ok: true, reason: "no_stripe_subscription" };
  }

  const interval: BillingInterval = (org.billingInterval as BillingInterval) || "monthly";
  const seatPriceId = pickSeatPriceId(tier, interval);
  if (!seatPriceId) {
    logger.info("syncSeatAddon: per-seat price ID not configured, logging only", {
      organizationId,
      tier,
      interval,
      seatCount,
    });
    return { ok: true, reason: "price_id_unset" };
  }

  const extraSeats = Math.max(0, seatCount - 1);

  try {
    const { getUncachableStripeClient } = await import("../../stripeClient");
    const stripe = await getUncachableStripeClient();
    const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ["items.data.price"],
    });
    const existing = subscription.items.data.find(
      (item) => (item.price as any)?.id === seatPriceId,
    );

    if (extraSeats === 0) {
      if (existing) {
        await stripe.subscriptionItems.del(existing.id, {
          proration_behavior: "create_prorations",
        });
        return { ok: true, quantity: 0, subscriptionItemId: existing.id };
      }
      return { ok: true, quantity: 0 };
    }

    if (existing) {
      const updated = await stripe.subscriptionItems.update(existing.id, {
        quantity: extraSeats,
        proration_behavior: "create_prorations",
      });
      return { ok: true, subscriptionItemId: updated.id, quantity: extraSeats };
    }

    const created = await stripe.subscriptionItems.create({
      subscription: subscriptionId,
      price: seatPriceId,
      quantity: extraSeats,
      proration_behavior: "create_prorations",
    });
    return { ok: true, subscriptionItemId: created.id, quantity: extraSeats };
  } catch (err) {
    logger.error("syncSeatAddon failed", {
      organizationId,
      error: (err as Error).message,
    });
    return { ok: false, reason: (err as Error).message };
  }
}

function pickSeatPriceId(tier: Tier, interval: BillingInterval): string | undefined {
  const pricing = TIER_PRICES_CENTS[tier];
  return interval === "yearly"
    ? pricing.stripePriceIdSeatYearly
    : pricing.stripePriceIdSeatMonthly;
}
