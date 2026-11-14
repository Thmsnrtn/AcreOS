/**
 * Best-effort fact gathering for the §5A tail-exposure model (P1-14 / B2).
 *
 * For each organization with a Stripe customer: its first subscription charge
 * (REUSING guaranteeFacts.resolveFirstSubscriptionCharge — the same E2 rule the
 * intake uses, never a second copy) and whether a guarantee refund was already
 * consumed (a `processed` refund_requests row, exactly what E6 reads).
 *
 * DISCIPLINE (mirrors the other advisory billing readers): this NEVER throws and
 * NEVER blocks a customer path. It feeds a founder read surface only.
 *   - HARD BOUND: at most EXPOSURE_MAX_ORGS organizations are scanned, most
 *     recently created first (the ones whose charges can still be in the
 *     window). When more exist the result says `truncated: true` — the tail it
 *     reports is then a floor, not the whole book.
 *   - a per-org failure skips that org (counted in `skippedOrgs`);
 *   - a total failure (org list unreadable, Stripe client unavailable) → null.
 *
 * Interval/tier are the org's CURRENT billing columns (the charge itself does
 * not carry them); a plan change since the first charge makes them approximate.
 * That affects only the month/year split, never tailCents.
 */
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { organizations, refundRequests, creditTransactions } from "@shared/schema";
import { db } from "../../db";
import { logger } from "../../utils/logger";
import { clock } from "../../utils/clock";
import { unscopedForPlatformOps } from "../../utils/orgScopedDb";
import { tierForSubscriptionTier } from "@shared/billing/tier-pricing";
import { resolveFirstSubscriptionCharge, type GuaranteeStripe } from "./guaranteeFacts";
import { computeGuaranteeExposure, type ExposureCharge, type GuaranteeExposure } from "./guaranteeExposure";

/** Orgs scanned per call — each costs several Stripe reads, so the bound is deliberate. */
export const EXPOSURE_MAX_ORGS = 200;

export interface GuaranteeExposureReport extends GuaranteeExposure {
  available: true;
  scannedOrgs: number;
  skippedOrgs: number;
  /** True when more than EXPOSURE_MAX_ORGS organizations have a Stripe customer: the tail is a floor. */
  truncated: boolean;
  maxOrgs: number;
}

export async function gatherGuaranteeExposure(deps: { stripe?: GuaranteeStripe; nowMs?: number } = {}): Promise<GuaranteeExposureReport | null> {
  try {
    const nowMs = deps.nowMs ?? clock.nowMs();
    const orgRows = await unscopedForPlatformOps("guarantee tail exposure (P1-14): platform-wide read of orgs with a Stripe customer, founder-only advisory model")
      .select({
        id: organizations.id,
        stripeCustomerId: organizations.stripeCustomerId,
        stripeSubscriptionId: organizations.stripeSubscriptionId,
        subscriptionTier: organizations.subscriptionTier,
        billingInterval: organizations.billingInterval,
      })
      .from(organizations)
      .where(isNotNull(organizations.stripeCustomerId))
      .orderBy(desc(organizations.id))
      .limit(EXPOSURE_MAX_ORGS + 1);
    const truncated = orgRows.length > EXPOSURE_MAX_ORGS;
    const orgs = orgRows.slice(0, EXPOSURE_MAX_ORGS);

    const stripe =
      deps.stripe ?? ((await (await import("../../stripeClient")).getUncachableStripeClient()) as unknown as GuaranteeStripe);

    // E6's fact, batched: orgs with a processed refund row.
    const ids = orgs.map((o) => o.id);
    const consumedRows = ids.length
      ? await unscopedForPlatformOps("guarantee tail exposure (P1-14): which scanned orgs already consumed a guarantee refund")
          .select({ organizationId: refundRequests.organizationId })
          .from(refundRequests)
          .where(and(inArray(refundRequests.organizationId, ids), eq(refundRequests.status, "processed")))
      : [];
    const consumed = new Set(consumedRows.map((r) => r.organizationId));

    const charges: ExposureCharge[] = [];
    let skippedOrgs = 0;
    for (const org of orgs) {
      if (!org.stripeCustomerId) continue;
      try {
        const purchases = await db
          .select({ pi: creditTransactions.stripePaymentIntentId })
          .from(creditTransactions)
          .where(and(eq(creditTransactions.organizationId, org.id), eq(creditTransactions.type, "purchase"), isNotNull(creditTransactions.stripePaymentIntentId)));
        const creditPurchasePaymentIntentIds = new Set(purchases.map((p) => p.pi).filter((v): v is string => typeof v === "string"));
        const target = await resolveFirstSubscriptionCharge(stripe, {
          customerId: org.stripeCustomerId,
          subscriptionId: org.stripeSubscriptionId,
          creditPurchasePaymentIntentIds,
        });
        if (!target) continue;
        charges.push({
          amountCents: target.charge.amount,
          chargeCreatedAtMs: target.charge.created * 1000,
          interval: org.billingInterval === "yearly" ? "year" : org.billingInterval === "monthly" ? "month" : null,
          tier: tierForSubscriptionTier(org.subscriptionTier),
          guaranteeConsumed: consumed.has(org.id),
        });
      } catch (err) {
        skippedOrgs += 1;
        logger.warn("[GuaranteeExposure] skipped an org (could not resolve its first charge)", { organizationId: org.id, err: String(err) });
      }
    }

    return {
      ...computeGuaranteeExposure(charges, nowMs),
      available: true,
      scannedOrgs: orgs.length,
      skippedOrgs,
      truncated,
      maxOrgs: EXPOSURE_MAX_ORGS,
    };
  } catch (err) {
    logger.error("[GuaranteeExposure] could not gather exposure facts", err instanceof Error ? err : undefined);
    return null;
  }
}
