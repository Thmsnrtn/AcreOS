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
import { deadlineRule, registerRedemptionExpiry } from "../services/tax/taxEvents";
import {
  emitCertRedemptionApproaching,
  emitCertForeclosureEligible,
  type CertEventRow,
} from "../services/certificateEvents";
import { logger } from "../utils/logger";
import { clock } from "../utils/clock";

// "Crosses threshold today" window. Configurable later via founder_settings
// once we add the surface; 7d is the bucket Marcus uses in his head ("if
// it's inside a week I'm in the office calling the redeemer").
const THRESHOLD_DAYS = 7;
// 60-day redemption-approaching workflow window (cert.redemption_period_60d).
const SIXTY_DAY_MS = 60 * 86_400_000;

/**
 * Build the CertEventRow slice the workflow emitters need from a scanned cert
 * row + the freshly recomputed deadline. Real columns only; the emitters never
 * touch redeemed fields on an active cert, so they pass through null.
 */
function jobRowToCertEventRow(
  row: {
    id: string;
    organizationId: number;
    propertyId: number | null;
    state: string;
    county: string;
    apn: string;
    saleType: string;
    bidDownRateBps: number | null;
    status: string;
  },
  saleDate: string,
  redemptionDeadline: string,
): CertEventRow {
  return {
    id: row.id,
    organizationId: row.organizationId,
    propertyId: row.propertyId,
    state: row.state,
    county: row.county,
    apn: row.apn,
    saleType: row.saleType,
    saleDate,
    bidDownRateBps: row.bidDownRateBps,
    redemptionDeadline,
    status: row.status,
    redeemedAt: null,
    redeemedAmountCents: null,
  };
}

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
    county: string;
    apn: string;
    propertyId: number | null;
    saleType: string;
    bidDownRateBps: number | null;
    status: string;
    saleDate: unknown;
    redemptionDeadline: unknown;
    ownerOccupiedAtSale: boolean | null;
    scraTollingApplied: boolean | null;
    deadlineSource: "computed_preliminary" | "operator_entered" | null;
  }>;
  try {
    rows = await db
      .select({
        id: taxCertificates.id,
        organizationId: taxCertificates.organizationId,
        state: taxCertificates.state,
        county: taxCertificates.county,
        apn: taxCertificates.apn,
        propertyId: taxCertificates.propertyId,
        saleType: taxCertificates.saleType,
        bidDownRateBps: taxCertificates.bidDownRateBps,
        status: taxCertificates.status,
        saleDate: taxCertificates.saleDate,
        redemptionDeadline: taxCertificates.redemptionDeadline,
        ownerOccupiedAtSale: taxCertificates.ownerOccupiedAtSale,
        scraTollingApplied: taxCertificates.scraTollingApplied,
        deadlineSource: taxCertificates.deadlineSource,
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
  const today = clock.now();
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

      // A deadline the operator ENTERED from the county's records is never
      // recomputed (V-Tax-1 T2b): until 2026-10-29 this job overwrote it with
      // AcreOS's own preliminary rule every night. Only a deadline AcreOS
      // computed (or one from before deadline_source existed) is refreshed.
      let recomputed: string | null;
      if (row.deadlineSource === "operator_entered") {
        recomputed = storedIso;
      } else {
        recomputed = computeRedemptionDeadline({
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

        // 1. Persist any change, and register it on the tax calendar with
        //    the rule it rests on.
        if (recomputed !== storedIso) {
          const newDeadline = recomputed;
          await db.transaction(async (tx) => {
            await tx
              .update(taxCertificates)
              .set({ redemptionDeadline: newDeadline, deadlineSource: "computed_preliminary", updatedAt: clock.now() })
              .where(eq(taxCertificates.id, row.id));
            await registerRedemptionExpiry(tx, {
              organizationId: row.organizationId,
              certificateId: row.id,
              date: newDeadline,
              ruleCited: deadlineRule(row.state, "computed_preliminary"),
              recordedBy: "system:redemption-clock-refresh",
              detail: { replaced: storedIso },
            });
          });
          result.deadlineChanged += 1;
        }
      }

      // 1b. The 90- and 30-day alerts (V-Tax-1 T2: alerts at 90/30/7 days).
      //     One in-app alert per certificate per deadline per threshold; the
      //     7-day alert below repeats daily inside the last week.
      // Only the tightest threshold crossed fires: a certificate first seen 20
      // days out gets the 30-day alert, not the 90-day one as well.
      const until = Math.ceil((new Date(recomputed).getTime() - today.getTime()) / 86_400_000);
      const tightest = until < 0 ? null : ([30, 90] as const).find((d) => until <= d) ?? null;
      for (const days of tightest === null ? [] : [tightest]) {
        const marker = `redemption_clock_${days}d:${row.id}:${recomputed}`;
        const [seen] = await db
          .select({ id: systemAlerts.id })
          .from(systemAlerts)
          .where(and(eq(systemAlerts.organizationId, row.organizationId), sql`${systemAlerts.message} = ${marker}`))
          .limit(1);
        if (seen) continue;
        await db.insert(systemAlerts).values({
          type: `redemption_clock_${days}d`,
          alertType: `redemption_clock_${days}d`,
          organizationId: row.organizationId,
          severity: "warning",
          title: `Redemption window closes within ${days} days (${until} day(s))`,
          message: marker,
          relatedEntityType: "tax_certificate",
          metadata: {
            certificateId: row.id,
            state: row.state,
            redemptionDeadline: recomputed,
            daysRemaining: until,
            deadlineSource: row.deadlineSource,
            summary: `Redemption window closes in ${until} day(s) (${recomputed}). ${row.deadlineSource === "operator_entered" ? "Deadline as entered from the county's records." : "Deadline computed by AcreOS from its preliminary state rule — confirm it with the county."}`,
          },
        });
        result.alertsEmitted += 1;
      }

      // 2. Threshold-cross alert. Fire when:
      //    - deadline is <= THRESHOLD_DAYS away (counting today as 0)
      //    - deadline has not already passed (overdue is its own surface)
      //    - we haven't already emitted today's alert for this cert
      const deadlineMs = new Date(recomputed).getTime();
      const msUntil = deadlineMs - today.getTime();

      // ── Workflow lanes (audit Wave 1, beta→core) ─────────────────────────
      // These fire the cert.* workflow trigger events for the tax-lien / deed
      // vertical. Each is deduped by a systemAlerts marker that ALSO serves as
      // a genuinely-useful operator alert (same pattern as the 7-day threshold
      // alert below), so the emit happens at most once per cert per recomputed
      // deadline. Rows are already scoped to status = "active", so neither
      // event ever fires for a redeemed / deed-obtained / cancelled cert.

      // 60-day redemption-approaching lane. cert.redemption_period_60d.
      if (msUntil >= 0 && msUntil <= SIXTY_DAY_MS) {
        const marker60 = `cert_redemption_60d_event:${row.id}:${recomputed}`;
        const [existing60] = await db
          .select({ id: systemAlerts.id })
          .from(systemAlerts)
          .where(
            and(
              eq(systemAlerts.organizationId, row.organizationId),
              sql`${systemAlerts.message} = ${marker60}`,
            ),
          )
          .limit(1);
        if (!existing60) {
          const days60 = Math.ceil(msUntil / 86_400_000);
          // Marker and workflow hand-off commit together (DEFECT-0114).
          await db.transaction(async (tx) => {
            await tx.insert(systemAlerts).values({
              type: "cert_redemption_60d",
              alertType: "cert_redemption_60d",
              organizationId: row.organizationId,
              severity: "warning",
              title: `Redemption window closes within 60 days (${days60} day(s))`,
              message: marker60,
              relatedEntityType: "tax_certificate",
              metadata: {
                certificateId: row.id,
                state: row.state,
                redemptionDeadline: recomputed,
                daysRemaining: days60,
                summary: `Redemption window closes in ${days60} day(s) — decide posture: extend (if allowed), accept redemption-in-progress, or prepare the foreclosure filing.`,
              },
            });
            await emitCertRedemptionApproaching(
              jobRowToCertEventRow(row, saleIso, recomputed),
              tx,
            );
          });
          result.alertsEmitted += 1;
        }
      }

      // Foreclosure-eligible lane. cert.foreclosure_eligible, once the
      // redemption deadline has lapsed with the cert still unredeemed.
      if (msUntil < 0) {
        const markerFc = `cert_foreclosure_eligible_event:${row.id}:${recomputed}`;
        const [existingFc] = await db
          .select({ id: systemAlerts.id })
          .from(systemAlerts)
          .where(
            and(
              eq(systemAlerts.organizationId, row.organizationId),
              sql`${systemAlerts.message} = ${markerFc}`,
            ),
          )
          .limit(1);
        if (!existingFc) {
          const daysOver = Math.ceil(-msUntil / 86_400_000);
          // Marker and workflow hand-off commit together (DEFECT-0114).
          await db.transaction(async (tx) => {
            await tx.insert(systemAlerts).values({
              type: "cert_foreclosure_eligible",
              alertType: "cert_foreclosure_eligible",
              organizationId: row.organizationId,
              severity: "critical",
              title: `Redemption window lapsed — foreclosure-eligible`,
              message: markerFc,
              relatedEntityType: "tax_certificate",
              metadata: {
                certificateId: row.id,
                state: row.state,
                redemptionDeadline: recomputed,
                daysSinceDeadline: daysOver,
                summary: `Redemption window closed ${daysOver} day(s) ago with no redemption — file foreclosure, sell the certificate, or write it off.`,
              },
            });
            await emitCertForeclosureEligible(
              jobRowToCertEventRow(row, saleIso, recomputed),
              tx,
            );
          });
          result.alertsEmitted += 1;
        }
      }

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
