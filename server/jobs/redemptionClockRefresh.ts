/**
 * Nightly redemption-clock refresh (Marcus, Lens 17, 2026-05-27).
 *
 * `server/services/redemptionClock.ts` documents (top of file, §2): "The
 * clock recalculates nightly and surfaces exceptions (holiday-extended
 * deadlines, owner-occupied vs vacant, SCRA tolling)." Lens 17 caught
 * that the docstring was a lie — nothing was scheduled to re-run the
 * math. So the redemption-deadline column was a snapshot taken at
 * insert time and never refreshed, even though:
 *
 *   - rule rows can be attorney-reviewed (changing math)
 *   - ownerOccupiedAtSale / scraTollingApplied can flip post-sale
 *   - clerks publish corrections to sale_date weeks later
 *
 * And worse: the morning-brief never had a place to source "3 certs
 * cross redemption threshold today" because that bucket was computed
 * client-side only when /redemption-clock was open.
 *
 * What this job does, every night, per org:
 *   1. Pulls every active cert.
 *   2. Re-computes redemptionDeadline using the live rule table +
 *      current owner-occupied/SCRA flags.
 *   3. UPDATEs only when the recomputed deadline ≠ the stored one.
 *   4. Emits a `redemption_clock_alert` system event for each cert
 *      whose redemption window now closes within the threshold the
 *      morning-brief surfaces (default 7 days).
 *
 * Idempotent — re-running mid-day is safe; writes only happen when
 * the recomputed deadline differs from the stored one or when the
 * threshold-cross alert hasn't been emitted yet today.
 *
 * Future (Lens 17 follow-up): pull deedRecordationDate from the
 * quiet-title case row when the cert has graduated to deed_obtained,
 * so AL "first Monday after sale" → "recordation_anchor" can flip
 * without manual data entry.
 */

import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { taxCertificates, systemAlerts } from "@shared/schema";
import { computeRedemptionDeadline } from "../services/redemptionClock";
import { logger } from "../utils/logger";

// "Crosses threshold today" window. Configurable later via founder_settings
// once we add the surface; 7d is the bucket Marcus uses in his head ("if
// it's inside a week I'm in the office calling the redeemer").
const THRESHOLD_DAYS = 7;

export interface RefreshResult {
  certsScanned: number;
  deadlineChanged: number;
  alertsEmitted: number;
  errors: number;
}

export async function runRedemptionClockRefresh(): Promise<RefreshResult> {
  const result: RefreshResult = {
    certsScanned: 0,
    deadlineChanged: 0,
    alertsEmitted: 0,
    errors: 0,
  };

  // Scope to active certs only. Redeemed / deed_obtained / expired_to_deed
  // / cancelled have no redemption window left to track.
  let rows: Array<{
    id: string;
    organizationId: number;
    state: string;
    saleDate: unknown;
    redemptionDeadline: unknown;
    ownerOccupiedAtSale: boolean | null;
    scraTollingApplied: boolean | null;
  }>;
  try {
    rows = await db
      .select({
        id: taxCertificates.id,
        organizationId: taxCertificates.organizationId,
        state: taxCertificates.state,
        saleDate: taxCertificates.saleDate,
        redemptionDeadline: taxCertificates.redemptionDeadline,
        ownerOccupiedAtSale: taxCertificates.ownerOccupiedAtSale,
        scraTollingApplied: taxCertificates.scraTollingApplied,
      })
      .from(taxCertificates)
      .where(eq(taxCertificates.status, "active"));
  } catch (err) {
    logger.error(
      "redemptionClockRefresh: query failed",
      err instanceof Error ? err : undefined,
    );
    result.errors += 1;
    return result;
  }

  result.certsScanned = rows.length;
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const thresholdMs = THRESHOLD_DAYS * 86_400_000;

  for (const row of rows) {
    try {
      const saleIso =
        typeof row.saleDate === "string"
          ? row.saleDate
          : (row.saleDate as Date)?.toISOString?.().slice(0, 10);
      const storedIso =
        typeof row.redemptionDeadline === "string"
          ? row.redemptionDeadline
          : (row.redemptionDeadline as Date)?.toISOString?.().slice(0, 10);
      if (!saleIso || !storedIso) continue;

      const recomputed = computeRedemptionDeadline({
        state: row.state,
        saleDate: saleIso,
        ownerOccupied: row.ownerOccupiedAtSale ?? undefined,
        scraTolling: row.scraTollingApplied ?? undefined,
      });
      // No-redemption states return null; if we'd previously stored
      // a non-null deadline and now the rule says "no redemption", we
      // don't touch the date column (the status column is what
      // disambiguates, and it should already be deed_obtained).
      if (recomputed === null) continue;

      // 1. Persist any change.
      if (recomputed !== storedIso) {
        await db
          .update(taxCertificates)
          .set({ redemptionDeadline: recomputed, updatedAt: new Date() })
          .where(eq(taxCertificates.id, row.id));
        result.deadlineChanged += 1;
      }

      // 2. Threshold-cross alert. Fire when:
      //    - deadline is <= THRESHOLD_DAYS away (counting today as 0)
      //    - deadline has not already passed (overdue is its own surface)
      //    - we haven't already emitted today's alert for this cert
      const deadlineMs = new Date(recomputed).getTime();
      const msUntil = deadlineMs - today.getTime();
      const crossesThreshold = msUntil >= 0 && msUntil <= thresholdMs;
      if (!crossesThreshold) continue;

      // Idempotent emit: use a synthetic dedupe key in the message body
      // (alertType + cert id + today). One alert per cert per UTC day.
      const dedupeMarker = `redemption_clock_alert:${row.id}:${todayIso}`;
      const [existing] = await db
        .select({ id: systemAlerts.id })
        .from(systemAlerts)
        .where(
          and(
            eq(systemAlerts.organizationId, row.organizationId),
            sql`${systemAlerts.message} = ${dedupeMarker}`,
          ),
        )
        .limit(1);
      if (existing) continue;

      const daysRemaining = Math.ceil(msUntil / 86_400_000);
      await db.insert(systemAlerts).values({
        type: "redemption_clock_threshold",
        alertType: "redemption_clock_threshold",
        organizationId: row.organizationId,
        // severity vocabulary is info | warning | critical (see
        // systemAlerts schema). <=1d remaining is critical, otherwise warning.
        severity: msUntil <= 86_400_000 ? "critical" : "warning",
        title: `Redemption window closes in ${daysRemaining} day(s)`,
        // Stash the dedupe marker AS the message so the lookup above is
        // a cheap equality test. The UI prefers `metadata.summary` so the
        // raw marker stays invisible to users.
        message: dedupeMarker,
        relatedEntityType: "tax_certificate",
        metadata: {
          certificateId: row.id,
          state: row.state,
          redemptionDeadline: recomputed,
          daysRemaining,
          summary: `Redemption window closes in ${daysRemaining} day(s).`,
        },
      });
      result.alertsEmitted += 1;
    } catch (err) {
      result.errors += 1;
      logger.error(
        `redemptionClockRefresh: cert ${row.id} failed`,
        err instanceof Error ? err : undefined,
      );
    }
  }

  logger.info(
    `redemptionClockRefresh: scanned=${result.certsScanned} changed=${result.deadlineChanged} alerts=${result.alertsEmitted} errors=${result.errors}`,
  );
  return result;
}
