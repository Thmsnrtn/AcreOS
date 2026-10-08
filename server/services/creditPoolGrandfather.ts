/**
 * Credit-pool grandfathering — when a grandfathered pool ENDS.
 *
 * Founder decision 2026-10-08 (docs/company/founder-decisions-2026-10-08.md):
 * Scale's included pool is 3,000 credits for new customers; orgs already on
 * Scale keep 8,000 until their next renewal. Migration 0266 recorded each such
 * org once, with `ends_at` NULL because the renewal date lives in Stripe, not
 * in our database. Two webhook moments close the gap, both idempotent and both
 * only ever moving `ends_at` EARLIER (never extending a grandfather):
 *
 *   - a subscription event that carries the current period → `ends_at` is set
 *     to that period's end, if it was still unknown;
 *   - a renewal (invoice.paid, billing_reason "subscription_cycle") → the
 *     grandfather ends at the renewal moment.
 *
 * Reads go through creditPool.resolveCreditPool(); this module only ends rows.
 * Best-effort: a failure here is logged and never fails the webhook.
 */
import { and, eq, isNull, or, gt } from "drizzle-orm";
import { db } from "../db";
import { creditPoolGrandfathers } from "@shared/schema";
import { logger } from "../utils/logger";

/** Stamp the current billing period's end as the grandfather end, if still unknown. */
export async function stampGrandfatherPeriodEnd(organizationId: number, periodEnd: Date | null): Promise<void> {
  if (!periodEnd || !Number.isFinite(periodEnd.getTime())) return;
  try {
    await db
      .update(creditPoolGrandfathers)
      .set({ endsAt: periodEnd })
      .where(and(eq(creditPoolGrandfathers.organizationId, organizationId), isNull(creditPoolGrandfathers.endsAt)));
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
      .update(creditPoolGrandfathers)
      .set({ endsAt: renewedAt })
      .where(
        and(
          eq(creditPoolGrandfathers.organizationId, organizationId),
          or(isNull(creditPoolGrandfathers.endsAt), gt(creditPoolGrandfathers.endsAt, renewedAt)),
        ),
      );
  } catch (err) {
    logger.warn("[credit-pool-grandfather] renewal end failed (non-fatal)", {
      metadata: { organizationId, detail: err instanceof Error ? err.message : String(err) },
    });
  }
}
