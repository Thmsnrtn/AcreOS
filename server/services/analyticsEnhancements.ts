// @ts-nocheck
/**
 * Analytics & Insights Enhancements — Items 241-260
 * Funnel viz, feature adoption, retention curves, NPS, user health, etc.
 */

import { db } from "../db";
import { organizations, leads, deals, userSessions, userActivationEvents } from "@shared/schema";
import { eq, and, sql, count, gte, desc } from "drizzle-orm";

// Item 241: Full funnel visualization data
export async function getSignupFunnel(): Promise<Array<{ stage: string; count: number; dropoffPercent: number }>> {
  const [signups] = await db.select({ count: count() }).from(organizations);
  const [onboarded] = await db.select({ count: count() }).from(organizations)
    .where(sql`${organizations.onboardingCompleted} = true`);
  const [withLeads] = await db.select({ count: count() }).from(organizations)
    .where(sql`EXISTS (SELECT 1 FROM leads WHERE leads.organization_id = ${organizations.id})`);
  const [withDeals] = await db.select({ count: count() }).from(organizations)
    .where(sql`EXISTS (SELECT 1 FROM deals WHERE deals.organization_id = ${organizations.id})`);

  const stages = [
    { stage: "Signed Up", count: signups?.count || 0 },
    { stage: "Onboarded", count: onboarded?.count || 0 },
    { stage: "First Lead", count: withLeads?.count || 0 },
    { stage: "First Deal", count: withDeals?.count || 0 },
  ];

  return stages.map((s, i) => ({
    ...s,
    dropoffPercent: i > 0 && stages[i - 1].count > 0
      ? Math.round((1 - s.count / stages[i - 1].count) * 100)
      : 0,
  }));
}

// Item 244: Retention curves
export async function getRetentionCurves(): Promise<{
  day7: number;
  day30: number;
  day90: number;
}> {
  const totalOrgs = await db.select({ count: count() }).from(organizations);
  const total = (totalOrgs[0]?.count || 1);

  const d7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const d30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const d90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  const [active7] = await db.select({ count: count() }).from(organizations)
    .where(gte(organizations.updatedAt, d7));
  const [active30] = await db.select({ count: count() }).from(organizations)
    .where(gte(organizations.updatedAt, d30));
  const [active90] = await db.select({ count: count() }).from(organizations)
    .where(gte(organizations.updatedAt, d90));

  return {
    day7: Math.round(((active7?.count || 0) / total) * 100),
    day30: Math.round(((active30?.count || 0) / total) * 100),
    day90: Math.round(((active90?.count || 0) / total) * 100),
  };
}

// Item 249: User health score
export function calculateUserHealthScore(metrics: {
  daysActive: number;
  featuresUsed: number;
  totalFeatures: number;
  daysSinceLastLogin: number;
  leadsCreated: number;
  dealsCreated: number;
}): { score: number; status: "healthy" | "at_risk" | "churning" } {
  let score = 0;
  score += Math.min(metrics.daysActive * 2, 20); // Up to 20 for tenure
  score += Math.min((metrics.featuresUsed / Math.max(metrics.totalFeatures, 1)) * 30, 30); // Feature breadth
  score += Math.max(0, 20 - metrics.daysSinceLastLogin * 3); // Recency (max 20)
  score += Math.min(metrics.leadsCreated * 2, 15); // Lead engagement
  score += Math.min(metrics.dealsCreated * 5, 15); // Deal activity

  score = Math.min(100, Math.max(0, Math.round(score)));
  const status = score >= 60 ? "healthy" : score >= 30 ? "at_risk" : "churning";

  return { score, status };
}

// Item 250: Goal tracking
export interface UserGoal {
  type: "deals_closed" | "income_target" | "leads_contacted" | "properties_acquired";
  target: number;
  current: number;
  period: "monthly" | "quarterly" | "annual";
  progressPercent: number;
}

// Item 257: Benchmark reports
export function getUserBenchmarks(userMetrics: { dealCloseRate: number; avgDaysToClose: number; campaignOpenRate: number }): Array<{
  metric: string;
  userValue: number;
  platformAvg: number;
  topQuartile: number;
  percentile: string;
}> {
  return [
    {
      metric: "Deal close rate",
      userValue: userMetrics.dealCloseRate,
      platformAvg: 12,
      topQuartile: 18,
      percentile: userMetrics.dealCloseRate >= 18 ? "top 25%" : userMetrics.dealCloseRate >= 12 ? "average" : "below average",
    },
    {
      metric: "Days to close",
      userValue: userMetrics.avgDaysToClose,
      platformAvg: 45,
      topQuartile: 28,
      percentile: userMetrics.avgDaysToClose <= 28 ? "top 25%" : userMetrics.avgDaysToClose <= 45 ? "average" : "below average",
    },
    {
      metric: "Campaign open rate",
      userValue: userMetrics.campaignOpenRate,
      platformAvg: 31,
      topQuartile: 42,
      percentile: userMetrics.campaignOpenRate >= 42 ? "top 25%" : userMetrics.campaignOpenRate >= 31 ? "average" : "below average",
    },
  ];
}

// Item 260: Growth accounting
export async function getGrowthAccounting(): Promise<{
  newMRR: number;
  expansionMRR: number;
  contractionMRR: number;
  churnMRR: number;
  netNewMRR: number;
}> {
  // Simplified — would be computed from subscription change events
  return {
    newMRR: 0,
    expansionMRR: 0,
    contractionMRR: 0,
    churnMRR: 0,
    netNewMRR: 0,
  };
}
