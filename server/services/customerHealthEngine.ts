/**
 * Pillar E / E4 + E9 — Customer health scoring.
 *
 * Distinct from churn risk. Churn asks "how likely to leave"; health
 * asks "how much value is this customer extracting".
 *
 * Score breakdown (0–100):
 *   usage_velocity      0–25  events-per-week trend over last 4 weeks
 *   feature_breadth     0–25  # of distinct modules with data
 *   nps_signal          0–20  most-recent NPS bucket
 *   data_quality        0–15  % of records with complete required fields
 *   pax_engagement      0–15  Pax conversations or nudges accepted in last 30d
 *
 * Bands:
 *   healthy            ≥ 70
 *   watch              50..69
 *   silent_disengaged  30..49  (low usage but not actively churning)
 *   struggling         < 30
 */

import { db } from "../db";
import {
  customerHealthScores,
  organizations,
  leads,
  properties,
  deals,
  notes,
  npsMicroSurveys,
  paxNudges,
  lifecycleEvents,
  type HealthBand,
  type InsertCustomerHealthScore,
} from "@shared/schema";
import { and, eq, gte, sql, desc } from "drizzle-orm";
import { logger } from "../utils/logger";

const POINTS = {
  usageVelocity: 25,
  featureBreadth: 25,
  npsSignal: 20,
  dataQuality: 15,
  paxEngagement: 15,
} as const;

const BAND_THRESHOLDS: Array<[number, HealthBand]> = [
  [70, "healthy"],
  [50, "watch"],
  [30, "silent_disengaged"],
  [0, "struggling"],
];

function classifyBand(score: number): HealthBand {
  for (const [floor, band] of BAND_THRESHOLDS) {
    if (score >= floor) return band;
  }
  return "struggling";
}

async function scoreUsageVelocity(orgId: number): Promise<{ pts: number; signals: Record<string, unknown> }> {
  // 4-week event count (lifecycle_events) trending +/-. If we have <2
  // weeks of data, neutral score (50%). Otherwise compare last 14d vs
  // prior 14d; +50%/0%/-50% maps to full/half/zero points.
  const now = new Date();
  const fourWeeksAgo = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  const [recent] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(lifecycleEvents)
    .where(
      and(
        eq(lifecycleEvents.organizationId, orgId),
        gte(lifecycleEvents.occurredAt, twoWeeksAgo),
      ),
    );
  const [prior] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(lifecycleEvents)
    .where(
      and(
        eq(lifecycleEvents.organizationId, orgId),
        gte(lifecycleEvents.occurredAt, fourWeeksAgo),
        sql`${lifecycleEvents.occurredAt} < ${twoWeeksAgo}`,
      ),
    );

  const recentN = Number(recent?.n ?? 0);
  const priorN = Number(prior?.n ?? 0);
  if (priorN === 0 && recentN === 0) {
    return { pts: Math.floor(POINTS.usageVelocity * 0.4), signals: { recentN, priorN, note: "no events yet" } };
  }
  if (priorN === 0) {
    return { pts: POINTS.usageVelocity, signals: { recentN, priorN, growth: "new-activity" } };
  }
  const growth = (recentN - priorN) / priorN;
  const normalized = Math.max(0, Math.min(1, 0.5 + growth));
  return {
    pts: Math.round(POINTS.usageVelocity * normalized),
    signals: { recentN, priorN, growthPct: Math.round(growth * 100) },
  };
}

async function scoreFeatureBreadth(orgId: number): Promise<{ pts: number; signals: Record<string, unknown> }> {
  // Count distinct modules that have any data. Cap at 5 modules → full
  // points; 0 modules → zero points.
  const counts = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(leads).where(eq(leads.organizationId, orgId)),
    db.select({ n: sql<number>`count(*)::int` }).from(properties).where(eq(properties.organizationId, orgId)),
    db.select({ n: sql<number>`count(*)::int` }).from(deals).where(eq(deals.organizationId, orgId)),
    db.select({ n: sql<number>`count(*)::int` }).from(notes).where(eq(notes.organizationId, orgId)),
  ]);
  const modulesWithData = counts.filter(([row]) => Number(row?.n ?? 0) > 0).length;
  // Bonus for orgs using all four modules — adoption breadth is the
  // strongest correlate with retention in early data.
  const ratio = Math.min(1, modulesWithData / 4);
  return {
    pts: Math.round(POINTS.featureBreadth * ratio),
    signals: { modulesWithData, leads: Number(counts[0][0]?.n ?? 0), properties: Number(counts[1][0]?.n ?? 0), deals: Number(counts[2][0]?.n ?? 0), notes: Number(counts[3][0]?.n ?? 0) },
  };
}

async function scoreNpsSignal(orgId: number): Promise<{ pts: number; signals: Record<string, unknown> }> {
  const [recent] = await db
    .select({ score: npsMicroSurveys.score })
    .from(npsMicroSurveys)
    .where(eq(npsMicroSurveys.organizationId, orgId))
    .orderBy(desc(npsMicroSurveys.submittedAt))
    .limit(1);
  if (!recent || recent.score == null) {
    return { pts: Math.floor(POINTS.npsSignal * 0.5), signals: { note: "no NPS responses" } };
  }
  const score = Number(recent.score);
  if (score >= 9) return { pts: POINTS.npsSignal, signals: { lastNps: score, bucket: "promoter" } };
  if (score >= 7) return { pts: Math.floor(POINTS.npsSignal * 0.6), signals: { lastNps: score, bucket: "passive" } };
  return { pts: 0, signals: { lastNps: score, bucket: "detractor" } };
}

async function scoreDataQuality(orgId: number): Promise<{ pts: number; signals: Record<string, unknown> }> {
  // For leads: % with both firstName + email/phone populated. Cheap proxy
  // for "the user is actually filling out records vs ghosting fields".
  const [stats] = await db
    .select({
      total: sql<number>`count(*)::int`,
      complete: sql<number>`sum(case when ${leads.firstName} is not null and (${leads.email} is not null or ${leads.phone} is not null) then 1 else 0 end)::int`,
    })
    .from(leads)
    .where(eq(leads.organizationId, orgId));
  const total = Number(stats?.total ?? 0);
  const complete = Number(stats?.complete ?? 0);
  if (total === 0) {
    return { pts: Math.floor(POINTS.dataQuality * 0.5), signals: { note: "no leads yet" } };
  }
  const ratio = complete / total;
  return {
    pts: Math.round(POINTS.dataQuality * ratio),
    signals: { totalLeads: total, completeLeads: complete, completionPct: Math.round(ratio * 100) },
  };
}

async function scorePaxEngagement(orgId: number): Promise<{ pts: number; signals: Record<string, unknown> }> {
  // Count Pax nudges that the org engaged with (clicked-through, not just
  // dismissed) in the last 30d. Proxy via dismissedAt IS NULL on recent
  // nudges as a soft signal — full implementation would query a
  // separate click-through log.
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [stats] = await db
    .select({
      total: sql<number>`count(*)::int`,
      live: sql<number>`sum(case when ${paxNudges.dismissedAt} is null then 1 else 0 end)::int`,
    })
    .from(paxNudges)
    .where(
      and(
        eq(paxNudges.organizationId, orgId),
        gte(paxNudges.createdAt, thirtyDaysAgo),
      ),
    );
  const total = Number(stats?.total ?? 0);
  if (total === 0) {
    return { pts: Math.floor(POINTS.paxEngagement * 0.5), signals: { note: "no recent Pax surface" } };
  }
  const live = Number(stats?.live ?? 0);
  const engagementRatio = live / total;
  return {
    pts: Math.round(POINTS.paxEngagement * engagementRatio),
    signals: { totalNudges30d: total, liveNudges: live, engagementPct: Math.round(engagementRatio * 100) },
  };
}

export async function scoreOrgHealth(orgId: number): Promise<InsertCustomerHealthScore> {
  const [usage, breadth, nps, quality, pax] = await Promise.all([
    scoreUsageVelocity(orgId),
    scoreFeatureBreadth(orgId),
    scoreNpsSignal(orgId),
    scoreDataQuality(orgId),
    scorePaxEngagement(orgId),
  ]);

  const score = usage.pts + breadth.pts + nps.pts + quality.pts + pax.pts;
  const band = classifyBand(score);

  return {
    organizationId: orgId,
    score,
    band,
    usageVelocityPoints: usage.pts,
    featureBreadthPoints: breadth.pts,
    npsSignalPoints: nps.pts,
    dataQualityPoints: quality.pts,
    paxEngagementPoints: pax.pts,
    signals: {
      usage: usage.signals,
      breadth: breadth.signals,
      nps: nps.signals,
      quality: quality.signals,
      pax: pax.signals,
    },
  };
}

export interface HealthEngineResult {
  scored: number;
  bandsCount: Record<HealthBand, number>;
}

export async function runHealthForAllOrgs(): Promise<HealthEngineResult> {
  const orgs = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(sql`${organizations.subscriptionStatus} != 'canceled' OR ${organizations.subscriptionStatus} IS NULL`);

  const bandsCount: Record<HealthBand, number> = {
    healthy: 0,
    watch: 0,
    silent_disengaged: 0,
    struggling: 0,
  };
  let scored = 0;

  for (const { id } of orgs) {
    try {
      const row = await scoreOrgHealth(id);
      await db.insert(customerHealthScores).values(row);
      bandsCount[row.band as HealthBand]++;
      scored++;
    } catch (err) {
      logger.warn("[customer-health] org scoring failed", {
        source: "customer-health",
        metadata: { orgId: id, error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  logger.info("[customer-health] cycle complete", {
    source: "customer-health",
    metadata: { scored, ...bandsCount },
  });

  return { scored, bandsCount };
}
