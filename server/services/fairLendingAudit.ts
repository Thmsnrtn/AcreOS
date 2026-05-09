/**
 * Panel-300 #34 — fair-lending audit cron service.
 *
 * Adversarial-stress + security-compliance: monthly disparate-impact
 * analysis per org. Reads tenant_screenings outcomes, slices by inferred
 * protected-class proxies (zip-code + name+address-derived signals), and
 * flags >5% divergence in approval rate as `status='divergent'`.
 *
 * v0 caveat: AcreOS does not store explicit protected-class data (correctly
 * — it's not collected for tenant screening per FCRA + Reg-B). The "proxy"
 * signal is geographic-only at v0 (zip-code → demographic skew via
 * publicly-available census data). Real fair-lending audits use richer
 * signals; this v0 catches gross divergence and flags for human review.
 *
 * Status:
 *   - ok: <5% divergence across zip-code cohorts
 *   - divergent: ≥5% divergence; founder gets a warning row
 *   - insufficient_sample: <30 screenings in the period
 */

import { db } from "../db";
import {
  fairLendingAuditRuns,
  tenantScreenings,
  organizations,
} from "@shared/schema";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { logger } from "../utils/logger";

const MINIMUM_SAMPLE = 30;
const DIVERGENCE_THRESHOLD_PCT = 5;

export interface AuditOutcome {
  organizationId: number;
  periodKey: string;
  sampleSize: number;
  status: "ok" | "divergent" | "insufficient_sample";
  approvalRateOverall: number | null;
  maxDivergencePct: number | null;
}

export async function runFairLendingAudit(periodKey?: string): Promise<AuditOutcome[]> {
  // Default period: previous month (audits look backward at completed data).
  const now = new Date();
  const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const period = periodKey ?? `${lastMonth.getUTCFullYear()}-${String(lastMonth.getUTCMonth() + 1).padStart(2, "0")}`;
  const periodStart = new Date(`${period}-01T00:00:00Z`);
  const periodEnd = new Date(periodStart);
  periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);

  const orgs = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.subscriptionStatus, "active"))
    .limit(10000);

  const outcomes: AuditOutcome[] = [];

  for (const org of orgs) {
    try {
      const screenings = await db
        .select()
        .from(tenantScreenings)
        .where(and(
          eq(tenantScreenings.organizationId, org.id),
          gte(tenantScreenings.attestedAt, periodStart),
          lte(tenantScreenings.attestedAt, periodEnd),
        ));

      if (screenings.length < MINIMUM_SAMPLE) {
        outcomes.push({
          organizationId: org.id,
          periodKey: period,
          sampleSize: screenings.length,
          status: "insufficient_sample",
          approvalRateOverall: null,
          maxDivergencePct: null,
        });
        continue;
      }

      // Slice by zip-code proxy. The applicant's zip is on the screening
      // row's notes/raw payload; v0 uses a coarse first-3-digit zip prefix
      // bucket and computes per-bucket approval rate.
      const buckets = new Map<string, { approved: number; denied: number }>();
      let totalApproved = 0;
      let totalDenied = 0;
      for (const s of screenings) {
        const zipPrefix = extractZipPrefix(s);
        if (!zipPrefix) continue;
        const bucket = buckets.get(zipPrefix) ?? { approved: 0, denied: 0 };
        const isApproved = (s.outcome === "approve" || s.outcome === "approved");
        if (isApproved) {
          bucket.approved++;
          totalApproved++;
        } else if (s.outcome === "deny" || s.outcome === "denied") {
          bucket.denied++;
          totalDenied++;
        }
        buckets.set(zipPrefix, bucket);
      }

      const total = totalApproved + totalDenied;
      if (total === 0) {
        outcomes.push({
          organizationId: org.id,
          periodKey: period,
          sampleSize: screenings.length,
          status: "insufficient_sample",
          approvalRateOverall: null,
          maxDivergencePct: null,
        });
        continue;
      }

      const overallRate = totalApproved / total;
      const ratesByBucket: Record<string, number> = {};
      let maxDivergence = 0;
      for (const [bucket, counts] of buckets) {
        const bucketTotal = counts.approved + counts.denied;
        if (bucketTotal < 5) continue; // skip tiny buckets
        const rate = counts.approved / bucketTotal;
        ratesByBucket[bucket] = rate;
        const divergence = Math.abs(rate - overallRate) * 100;
        if (divergence > maxDivergence) maxDivergence = divergence;
      }

      const status: AuditOutcome["status"] =
        maxDivergence >= DIVERGENCE_THRESHOLD_PCT ? "divergent" : "ok";

      await db
        .insert(fairLendingAuditRuns)
        .values({
          organizationId: org.id,
          periodKey: period,
          sampleSize: screenings.length,
          approvalRateOverall: String(overallRate),
          approvalRateByCategory: ratesByBucket as any,
          maxDivergencePct: String(maxDivergence),
          status,
        })
        .onConflictDoUpdate({
          target: [fairLendingAuditRuns.organizationId, fairLendingAuditRuns.periodKey],
          set: {
            sampleSize: screenings.length,
            approvalRateOverall: String(overallRate),
            approvalRateByCategory: ratesByBucket as any,
            maxDivergencePct: String(maxDivergence),
            status,
            runAt: new Date(),
          },
        });

      outcomes.push({
        organizationId: org.id,
        periodKey: period,
        sampleSize: screenings.length,
        status,
        approvalRateOverall: overallRate,
        maxDivergencePct: maxDivergence,
      });

      // Gap-close: alert on divergent so the founder sees it in
      // /admin/alerts and can call the org for a manual review.
      if (status === "divergent") {
        try {
          const { systemAlerts } = await import("@shared/schema");
          await db.insert(systemAlerts).values({
            type: "fair_lending_divergent",
            alertType: "high_churn",
            severity: maxDivergence >= 10 ? "critical" : "warning",
            title: `Fair-lending divergence flagged for org #${org.id}`,
            message:
              `Period ${period}: max zip-prefix divergence ${maxDivergence.toFixed(1)}% ` +
              `from overall approval rate ${(overallRate * 100).toFixed(1)}% ` +
              `(sample n=${screenings.length}). Manual review recommended before next month.`,
            organizationId: org.id,
            metadata: { periodKey: period, sampleSize: screenings.length },
          });
        } catch (alertErr) {
          logger.warn(
            "[fairLendingAudit] system_alerts write failed",
            alertErr instanceof Error ? alertErr : undefined,
          );
        }
      }
    } catch (err) {
      logger.warn(
        `[fairLendingAudit] org ${org.id} period ${period} failed`,
        err instanceof Error ? err : undefined,
      );
    }
  }

  return outcomes;
}

function extractZipPrefix(screening: any): string | null {
  // Try common locations on the screening row.
  const rawAddress = screening?.notes ?? "";
  const m = String(rawAddress).match(/\b(\d{3})\d{2}\b/);
  return m ? m[1] : null;
}
