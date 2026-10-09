/**
 * Credit-pool grandfathering — when a grandfathered pool ENDS.
 *
 * Founder decision 2026-10-08 (docs/company/founder-decisions-2026-10-08.md):
 * Scale's included pool is 3,000 credits for new customers; orgs already on
 * Scale keep 8,000 until their next renewal. Migration 0266 marked each such
 * org once (organizations.credit_pool_grandfather) with the end date unknown,
 * because the renewal date lives in Stripe, not in our database. Two webhook
 * moments close that gap. Both are idempotent and only ever move the end
 * EARLIER — a grandfather is never extended:
 *
 *   - a subscription event carrying the current period → the end becomes that
 *     period's end, if it was still unknown;
 *   - a renewal (invoice.paid, billing_reason "subscription_cycle") → the
 *     grandfather ends at the renewal moment.
 *
 * Reads go through creditPool.creditPoolFor(); this module only ends them.
 * Best-effort: a failure is logged and never fails the webhook.
 */
import { and, eq, isNull, isNotNull, or, gt } from "drizzle-orm";
import { db } from "../db";
import { organizations } from "@shared/schema";
import { logger } from "../utils/logger";

/** Stamp the current billing period's end as the grandfather end, if still unknown. */
export async function stampGrandfatherPeriodEnd(organizationId: number, periodEnd: Date | null): Promise<void> {
  if (!periodEnd || !Number.isFinite(periodEnd.getTime())) return;
  try {
    await db
      .update(organizations)
      .set({ creditPoolGrandfatherEndsAt: periodEnd })
      .where(
        and(
          eq(organizations.id, organizationId),
          isNotNull(organizations.creditPoolGrandfather),
          isNull(organizations.creditPoolGrandfatherEndsAt),
        ),
      );
  } catch (err) {
    logger.warn("[credit-pool-grandfather] period-end stamp failed (non-fatal)", {
      metadata: { organizationId, detail: err instanceof Error ? err.message : String(err) },
    });
  }
}

/** A renewal happened: the grandfather ends now (never later than already set). */
export async function endGrandfatherAtRenewal(organizationId: number, renewedAt: Date): Promise<void> {
  try {
    await db
      .update(organizations)
      .set({ creditPoolGrandfatherEndsAt: renewedAt })
      .where(
        and(
          eq(organizations.id, organizationId),
          isNotNull(organizations.creditPoolGrandfather),
          or(isNull(organizations.creditPoolGrandfatherEndsAt), gt(organizations.creditPoolGrandfatherEndsAt, renewedAt)),
        ),
      );
  } catch (err) {
    logger.warn("[credit-pool-grandfather] renewal end failed (non-fatal)", {
      metadata: { organizationId, detail: err instanceof Error ? err.message : String(err) },
    });
  }
}
