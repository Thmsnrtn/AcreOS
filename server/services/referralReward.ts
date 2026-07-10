// Referral reward (S2d) — the missing half of the referral loop.
//
// The five-lens audit found the loop dead end-to-end: POST /api/referral/
// activate ("called when a referred user reaches deal_won") had ZERO callers,
// and organizations.referral_credits was incremented + displayed but never
// redeemed against a bill. This service is the server-side reward path:
//
//   1. fired automatically from the deal-update route when a referred org's
//      deal reaches `closed` (deal_won activation);
//   2. marks the referral converted (idempotent — a converted referral never
//      rewards twice) and credits BOTH orgs' referral_credits ledgers;
//   3. redeems each credit as a real Stripe customer-balance credit when the
//      org has a Stripe customer, so the credit actually discounts the next
//      invoice instead of being a number on a screen. Orgs without a Stripe
//      customer keep the ledger credit for later redemption.
//
// The route at POST /api/referral/activate remains for explicit/manual
// application and is idempotent with this path (same status guard).

import { eq, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { referrals } from "@shared/models/auth";
import { organizations } from "@shared/schema";
import { logger } from "../utils/logger";

/** Cents credited to EACH side on conversion (mirrors the manual route). */
export const REFERRAL_REWARD_CENTS = 100;

/**
 * Apply a Stripe customer-balance credit (negative amount = credit toward the
 * next invoice). Non-fatal: without a Stripe customer or with Stripe down,
 * the ledger credit still stands and can be redeemed later.
 */
async function redeemAsStripeBalance(orgId: number, cents: number, memo: string): Promise<boolean> {
  try {
    const [org] = await db
      .select({ stripeCustomerId: organizations.stripeCustomerId })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);
    if (!org?.stripeCustomerId) return false;

    const { getUncachableStripeClient } = await import("../stripeClient");
    const stripe = await getUncachableStripeClient();
    await stripe.customers.createBalanceTransaction(org.stripeCustomerId, {
      amount: -Math.abs(cents),
      currency: "usd",
      description: memo,
    });
    return true;
  } catch (err) {
    logger.warn("[referral-reward] Stripe balance redemption failed (ledger credit stands)", {
      metadata: { orgId, error: err instanceof Error ? err.message : String(err) },
    });
    return false;
  }
}

/**
 * Reward the referral (if any) behind an org that just hit its deal_won
 * activation moment. Returns whether a reward fired. Never throws.
 */
export async function applyReferralRewardForOrg(orgId: number): Promise<{ rewarded: boolean }> {
  try {
    // The org's users → any non-converted referral where one of them is the referee.
    const userRows = await db.execute<{ id: string }>(
      sql`SELECT id FROM users WHERE organization_id = ${orgId}`,
    );
    const userIds = (Array.isArray(userRows) ? userRows : (userRows as { rows?: Array<{ id: string }> }).rows ?? [])
      .map((r) => r.id)
      .filter(Boolean);
    if (userIds.length === 0) return { rewarded: false };

    const [referral] = await db
      .select()
      .from(referrals)
      .where(inArray(referrals.refereeId, userIds))
      .limit(1);
    if (!referral || referral.status === "converted") return { rewarded: false };

    // Idempotent claim: only ONE caller can flip pending/signed_up → converted.
    const claimed = await db.execute<{ id: number }>(sql`
      UPDATE referrals SET status = 'converted', credit_amount = ${REFERRAL_REWARD_CENTS}, credited_at = now()
      WHERE id = ${referral.id} AND status != 'converted'
      RETURNING id
    `);
    const claimedRows = Array.isArray(claimed) ? claimed : (claimed as { rows?: Array<{ id: number }> }).rows ?? [];
    if (claimedRows.length === 0) return { rewarded: false }; // raced — someone else rewarded

    // Credit the referee's org.
    await db.execute(sql`
      UPDATE organizations SET referral_credits = COALESCE(referral_credits, 0) + ${REFERRAL_REWARD_CENTS}
      WHERE id = ${orgId}
    `);
    await redeemAsStripeBalance(orgId, REFERRAL_REWARD_CENTS, "AcreOS referral reward (you were referred)");

    // Credit the referrer's org.
    const referrerOrgRows = await db.execute<{ organization_id: number }>(
      sql`SELECT organization_id FROM users WHERE id = ${referral.referrerId} LIMIT 1`,
    );
    const referrerOrgId = (Array.isArray(referrerOrgRows)
      ? referrerOrgRows
      : (referrerOrgRows as { rows?: Array<{ organization_id: number }> }).rows ?? [])[0]?.organization_id;
    if (referrerOrgId) {
      await db.execute(sql`
        UPDATE organizations SET referral_credits = COALESCE(referral_credits, 0) + ${REFERRAL_REWARD_CENTS}
        WHERE id = ${referrerOrgId}
      `);
      await redeemAsStripeBalance(referrerOrgId, REFERRAL_REWARD_CENTS, "AcreOS referral reward (your referral converted)");
    }

    logger.info("[referral-reward] referral converted — both sides credited", {
      metadata: { referralId: referral.id, refereeOrgId: orgId, referrerOrgId: referrerOrgId ?? null },
    });
    return { rewarded: true };
  } catch (err) {
    logger.error("[referral-reward] failed (non-fatal)", err instanceof Error ? err : undefined);
    return { rewarded: false };
  }
}
