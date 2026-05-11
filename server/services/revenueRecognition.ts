/**
 * FW-MARISOL-2 (push-forward 2026-05-08): ASC 606 revenue recognition.
 *
 * Marisol-Vega + Ashok-Bhatt + Harlowe-Stone + Bryn-Halliday + Tegan-Russo
 * converged on this as the most-cited fix in the corpus. Without ratable
 * recognition of annual subscriptions, the MRR / NRR / GAAP-compliance
 * story to investors and acquirers is unrecoverable.
 *
 * Algorithm (idempotent per period_key):
 *   For every active organization, read subscription tier + billingInterval
 *   from the canonical `organizations` row, then:
 *     - monthly  → 100% of monthlyRevenueCentsFor(tier, "monthly") recognized
 *     - yearly   → recognize 1/12 of priceYearlyCents per month for 12 months;
 *                  the 11/12 unrecognized balance goes into deferred_cents
 *
 * Idempotency:
 *   ON CONFLICT (organization_id, period_key, source) DO UPDATE — re-runs
 *   for the same period overwrite the row rather than duplicate it. So
 *   the cron can run nightly without producing 30× rows for May.
 *
 * Authoritative source for prices: shared/billing/tier-pricing.ts.
 */

import { db } from "../db";
import { organizations, revenueRecognitionPeriods } from "@shared/schema";
import { and, eq, sql } from "drizzle-orm";
import {
  monthlyRevenueCentsFor,
  tierForSubscriptionTier,
  TIER_PRICES_CENTS,
} from "@shared/billing/tier-pricing";
import { logger } from "../utils/logger";

export interface RecognitionResult {
  periodKey: string;
  rowsWritten: number;
  totalRecognizedCents: number;
  totalDeferredCents: number;
}

/**
 * Run recognition for a single period. periodKey format: "YYYY-MM".
 * Idempotent — re-running for the same period updates existing rows.
 */
export async function runMonthlyRecognition(periodKey: string): Promise<RecognitionResult> {
  // Validate period key shape so a typo doesn't write garbage rows.
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodKey)) {
    throw new Error(`Invalid period_key (expected YYYY-MM): ${periodKey}`);
  }
  const [yearStr, monthStr] = periodKey.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr); // 1-12
  const periodStart = new Date(Date.UTC(year, month - 1, 1));
  const periodEnd = new Date(Date.UTC(year, month, 1));

  const orgs = await db
    .select({
      id: organizations.id,
      tier: organizations.subscriptionTier,
      billingInterval: organizations.billingInterval,
      status: organizations.subscriptionStatus,
    })
    .from(organizations);

  let rowsWritten = 0;
  let totalRecognizedCents = 0;
  let totalDeferredCents = 0;

  for (const org of orgs) {
    if (org.status !== "active") continue;
    // org.tier (the organizations.subscription_tier column) may still
    // carry legacy solo/operator/empire values for grandfathered rows —
    // fold through the alias map so both label sets resolve correctly.
    const tier = tierForSubscriptionTier(org.tier);
    if (!tier) continue; // free / unknown tier → no revenue recognised

    const interval = (org.billingInterval === "yearly" ? "yearly" : "monthly") as
      | "monthly"
      | "yearly";

    let recognizedCents = 0;
    let deferredCents = 0;
    let source: "monthly_sub" | "annual_sub";
    if (interval === "yearly") {
      // 1/12 of the annual price recognized this month.
      recognizedCents = monthlyRevenueCentsFor(tier, "yearly");
      // Unrecognized: 11/12 of the annual price (assumes ratable across
      // 12 months from the start of the subscription; this is the steady-
      // state form — for partial-year stubs we'd need start-date awareness.)
      const yearlyCents = TIER_PRICES_CENTS[tier].priceYearlyCents;
      deferredCents = Math.max(0, yearlyCents - recognizedCents);
      source = "annual_sub";
    } else {
      recognizedCents = monthlyRevenueCentsFor(tier, "monthly");
      deferredCents = 0;
      source = "monthly_sub";
    }

    try {
      await db
        .insert(revenueRecognitionPeriods)
        .values({
          organizationId: org.id,
          periodKey,
          periodStart,
          periodEnd,
          source,
          tier,
          billingInterval: interval,
          recognizedCents,
          deferredCents,
        })
        .onConflictDoUpdate({
          target: [
            revenueRecognitionPeriods.organizationId,
            revenueRecognitionPeriods.periodKey,
            revenueRecognitionPeriods.source,
          ],
          set: {
            recognizedCents,
            deferredCents,
            tier,
            billingInterval: interval,
          },
        });
      rowsWritten++;
      totalRecognizedCents += recognizedCents;
      totalDeferredCents += deferredCents;
    } catch (err) {
      logger.warn(
        `[revenueRecognition] write failed for org ${org.id} period ${periodKey}`,
        err instanceof Error ? err : undefined,
      );
    }
  }

  logger.info(
    `[revenueRecognition] ${periodKey}: wrote ${rowsWritten} rows, recognized $${(totalRecognizedCents / 100).toFixed(2)}, deferred $${(totalDeferredCents / 100).toFixed(2)}`,
  );

  return { periodKey, rowsWritten, totalRecognizedCents, totalDeferredCents };
}

/**
 * Aggregate recognition for a period range — feeds /founder/financials.
 * Returns total recognized + deferred cents across all orgs in the window.
 */
export async function getPeriodTotals(periodKeyFrom: string, periodKeyTo: string) {
  const [row] = await db
    .select({
      recognized: sql<string>`COALESCE(SUM(${revenueRecognitionPeriods.recognizedCents}), 0)`,
      deferred: sql<string>`COALESCE(SUM(${revenueRecognitionPeriods.deferredCents}), 0)`,
      orgCount: sql<string>`COUNT(DISTINCT ${revenueRecognitionPeriods.organizationId})`,
      rowCount: sql<string>`COUNT(*)`,
    })
    .from(revenueRecognitionPeriods)
    .where(
      and(
        sql`${revenueRecognitionPeriods.periodKey} >= ${periodKeyFrom}`,
        sql`${revenueRecognitionPeriods.periodKey} <= ${periodKeyTo}`,
      ),
    );
  return {
    periodKeyFrom,
    periodKeyTo,
    recognizedCents: Number(row?.recognized ?? 0),
    deferredCents: Number(row?.deferred ?? 0),
    distinctOrgCount: Number(row?.orgCount ?? 0),
    rowCount: Number(row?.rowCount ?? 0),
  };
}

export function currentPeriodKey(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}
