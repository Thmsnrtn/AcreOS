// Referral reward — MARKET-MATCH terms (founder decision, picker 2026-09-01,
// after verified competitor research: DealMachine 20-50% lifetime revshare,
// Carrot 20-30% recurring, InvestorLift 10%+10%, SMB-SaaS norm of 1-3 months
// of product value per side, triggered on PAID conversion).
//
// The program ("give a month, get a month"):
//   - REFEREE: $49 account credit when their org's FIRST paid invoice lands
//     (immediate at payment — the "your first month is on us" promise).
//   - REFERRER: $49 account credit when the referred org has stayed an
//     active subscriber 30 days past that first payment ($98 when the
//     referee is on annual billing), plus milestone bonuses: +$100 at the
//     referrer's 5th lifetime conversion, +$250 at the 10th.
//   - All credits redeem only against AcreOS invoices (Stripe customer
//     balance); no cash out. Self-referral blocked upstream.
//
// WHY THE TRIGGER MOVED (2026-09-01): the old trigger was the referred
// org's first WON DEAL, at $1 a side. At real reward sizes deal_won alone
// is gameable — a trial org can fabricate a closed-won deal for $0 — so
// payment is the gate and retention is the hold: pending → signed_up →
// paid (referee credited; 30-day clock starts) → converted (referrer
// credited) | voided (subscription died inside the hold). deal_won no
// longer rewards; the deal route logs it as the natural share moment.
//
// State machine columns: referrals.status + paid_at (clock start) +
// credited_at (conversion). Idempotency is per-transition: markReferralPaid
// claims signed_up/pending → paid; matureReferralRewards claims paid →
// converted. Each claim is a single guarded UPDATE … RETURNING, so races
// (webhook redelivery, overlapping job runs) resolve to exactly one winner.

import { eq, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { referrals } from "@shared/models/auth";
import { organizations } from "@shared/schema";
import { logger } from "../utils/logger";

/** Cents credited to EACH side (the "a month each" denomination, Pro ≈ $49). */
export const REFERRAL_REWARD_CENTS = 4_900;
/** Extra referrer cents when the referee pays annually ($98 total). */
export const REFERRAL_ANNUAL_BONUS_CENTS = 4_900;
/** Days the referred org must stay an active subscriber after first payment. */
export const REFERRAL_RETENTION_HOLD_DAYS = 30;
/** Milestone bonuses at the referrer's Nth lifetime conversion (cents). */
export const REFERRAL_MILESTONES: Record<number, number> = {
  5: 10_000,
  10: 25_000,
};

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

async function creditOrg(orgId: number, cents: number, memo: string): Promise<void> {
  await db.execute(sql`
    UPDATE organizations SET referral_credits = COALESCE(referral_credits, 0) + ${cents}
    WHERE id = ${orgId}
  `);
  await redeemAsStripeBalance(orgId, cents, memo);
}

/** The non-terminal referral (if any) whose referee belongs to this org. */
async function referralForOrg(orgId: number) {
  const userRows = await db.execute<{ id: string }>(
    sql`SELECT id FROM users WHERE organization_id = ${orgId}`,
  );
  const userIds = (Array.isArray(userRows) ? userRows : (userRows as { rows?: Array<{ id: string }> }).rows ?? [])
    .map((r) => r.id)
    .filter(Boolean);
  if (userIds.length === 0) return null;
  const [referral] = await db
    .select()
    .from(referrals)
    .where(inArray(referrals.refereeId, userIds))
    .limit(1);
  return referral ?? null;
}

/**
 * First paid invoice for a referred org: claim signed_up/pending → paid,
 * start the 30-day retention clock, and credit the REFEREE immediately.
 * Called from the Stripe invoice.paid webhook. Idempotent — Stripe
 * redelivery or duplicate invoices credit exactly once. Never throws.
 */
export async function markReferralPaid(orgId: number): Promise<{ marked: boolean }> {
  try {
    const referral = await referralForOrg(orgId);
    if (!referral) return { marked: false };
    if (referral.status !== "pending" && referral.status !== "signed_up") return { marked: false };

    const claimed = await db.execute<{ id: number }>(sql`
      UPDATE referrals SET status = 'paid', paid_at = now()
      WHERE id = ${referral.id} AND status IN ('pending', 'signed_up')
      RETURNING id
    `);
    const rows = Array.isArray(claimed) ? claimed : (claimed as { rows?: Array<{ id: number }> }).rows ?? [];
    if (rows.length === 0) return { marked: false }; // raced

    await creditOrg(orgId, REFERRAL_REWARD_CENTS, "AcreOS referral — your first month is on us");
    logger.info("[referral-reward] referred org paid — referee credited, retention clock started", {
      metadata: { referralId: referral.id, refereeOrgId: orgId },
    });
    return { marked: true };
  } catch (err) {
    logger.error("[referral-reward] markReferralPaid failed (non-fatal)", err instanceof Error ? err : undefined);
    return { marked: false };
  }
}

/**
 * Daily sweep: referrals 'paid' more than REFERRAL_RETENTION_HOLD_DAYS ago
 * either convert (referee org still an active subscriber → referrer credited,
 * annual bonus, milestone bonuses) or void (subscription died in the hold).
 * Returns counts for job-health logging. Safe to run concurrently — each
 * transition is a guarded claim.
 */
export async function matureReferralRewards(): Promise<{ converted: number; voided: number }> {
  let converted = 0;
  let voided = 0;
  const dueRows = await db.execute<{
    id: number; referrer_id: string; referee_id: string | null;
  }>(sql`
    SELECT id, referrer_id, referee_id FROM referrals
    WHERE status = 'paid' AND paid_at <= now() - make_interval(days => ${REFERRAL_RETENTION_HOLD_DAYS})
  `);
  const due = Array.isArray(dueRows)
    ? dueRows
    : (dueRows as { rows?: Array<{ id: number; referrer_id: string; referee_id: string | null }> }).rows ?? [];

  for (const row of due) {
    try {
      // The referee's org and its live billing state.
      const orgRows = await db.execute<{ id: number; subscription_status: string; billing_interval: string }>(sql`
        SELECT o.id, o.subscription_status, o.billing_interval
        FROM organizations o JOIN users u ON u.organization_id = o.id
        WHERE u.id = ${row.referee_id} LIMIT 1
      `);
      const org = (Array.isArray(orgRows)
        ? orgRows
        : (orgRows as { rows?: Array<{ id: number; subscription_status: string; billing_interval: string }> }).rows ?? [])[0];

      const retained = org && org.subscription_status === "active";
      const targetStatus = retained ? "converted" : "voided";
      const referrerCents = retained
        ? REFERRAL_REWARD_CENTS + (org.billing_interval === "yearly" ? REFERRAL_ANNUAL_BONUS_CENTS : 0)
        : 0;

      const claimed = await db.execute<{ id: number }>(sql`
        UPDATE referrals SET status = ${targetStatus}, credit_amount = ${referrerCents}, credited_at = now()
        WHERE id = ${row.id} AND status = 'paid'
        RETURNING id
      `);
      const rows = Array.isArray(claimed) ? claimed : (claimed as { rows?: Array<{ id: number }> }).rows ?? [];
      if (rows.length === 0) continue; // raced

      if (!retained) {
        voided += 1;
        logger.info("[referral-reward] referral voided — subscription not active at maturity", {
          metadata: { referralId: row.id },
        });
        continue;
      }

      const referrerOrgRows = await db.execute<{ organization_id: number }>(
        sql`SELECT organization_id FROM users WHERE id = ${row.referrer_id} LIMIT 1`,
      );
      const referrerOrgId = (Array.isArray(referrerOrgRows)
        ? referrerOrgRows
        : (referrerOrgRows as { rows?: Array<{ organization_id: number }> }).rows ?? [])[0]?.organization_id;

      if (referrerOrgId) {
        await creditOrg(referrerOrgId, referrerCents, "AcreOS referral reward — your referral converted");

        // Milestone bonuses, granted exactly at the crossing conversion.
        const countRows = await db.execute<{ n: string }>(sql`
          SELECT count(*)::text AS n FROM referrals
          WHERE referrer_id = ${row.referrer_id} AND status = 'converted'
        `);
        const n = Number((Array.isArray(countRows)
          ? countRows
          : (countRows as { rows?: Array<{ n: string }> }).rows ?? [])[0]?.n ?? 0);
        const bonus = REFERRAL_MILESTONES[n];
        if (bonus) {
          await creditOrg(referrerOrgId, bonus, `AcreOS referral milestone — ${n} conversions`);
          logger.info("[referral-reward] milestone bonus granted", {
            metadata: { referrerOrgId, conversions: n, bonusCents: bonus },
          });
        }
      }
      converted += 1;
      logger.info("[referral-reward] referral converted — referrer credited", {
        metadata: { referralId: row.id, referrerOrgId: referrerOrgId ?? null, cents: referrerCents },
      });
    } catch (err) {
      logger.error("[referral-reward] maturity claim failed for one referral (continuing)", err instanceof Error ? err : undefined, {
        metadata: { referralId: row.id },
      });
    }
  }
  return { converted, voided };
}

/**
 * The deal_won moment no longer rewards (see header). It is still the
 * natural in-product share moment; the deal route calls this to log it.
 * Kept exported so the old call site has a truthful successor. Never throws.
 */
export async function recordReferralShareMoment(orgId: number): Promise<void> {
  try {
    const referral = await referralForOrg(orgId);
    logger.info("[referral-reward] deal_won share moment", {
      metadata: { orgId, referredOrg: Boolean(referral) },
    });
  } catch {
    /* best-effort telemetry only */
  }
}
