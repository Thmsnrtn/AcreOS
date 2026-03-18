// @ts-nocheck
/**
 * Customer Health Scoring — Sovereign Company Protocol v5
 *
 * Beyond churn risk: a holistic health score for each customer.
 * CEO sees "Acme Corp: Health 87/100, declining. Uses 4 features."
 *
 * Components:
 * - Activity score: login frequency, feature usage depth
 * - Payment health: on-time payments, plan tier
 * - Engagement score: support interactions, feature adoption
 * - Trend: improving, stable, or declining
 */

import { db } from "../db";
import {
  organizations, supportTickets, deals, leads,
  churnRiskScores, activityLog,
} from "@shared/schema";
import { eq, and, gte, desc, count, sql } from "drizzle-orm";

export interface CustomerHealth {
  orgId: number;
  orgName: string;
  healthScore: number;        // 0-100
  trend: "improving" | "stable" | "declining";
  churnRisk: number;          // 0-100
  components: {
    activityScore: number;    // 0-100
    paymentHealth: number;    // 0-100
    engagementScore: number;  // 0-100
  };
  details: {
    lastLogin: string | null;
    daysSinceLastLogin: number;
    plan: string;
    customerSince: string;
    customerMonths: number;
    openTickets: number;
    totalDeals: number;
    totalLeads: number;
  };
  summary: string;
}

/**
 * Calculate health score for a single organization.
 */
export async function getCustomerHealth(orgId: number): Promise<CustomerHealth | null> {
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
  });
  if (!org) return null;

  const now = new Date();

  // Activity Score (0-100): based on login recency
  const lastLogin = org.lastLoginAt ? new Date(org.lastLoginAt) : null;
  const daysSinceLogin = lastLogin
    ? Math.floor((now.getTime() - lastLogin.getTime()) / (1000 * 60 * 60 * 24))
    : 999;

  let activityScore = 100;
  if (daysSinceLogin > 30) activityScore = 10;
  else if (daysSinceLogin > 14) activityScore = 30;
  else if (daysSinceLogin > 7) activityScore = 50;
  else if (daysSinceLogin > 3) activityScore = 70;
  else if (daysSinceLogin > 1) activityScore = 85;

  // Payment Health (0-100): based on plan and status
  let paymentHealth = 50;
  const plan = org.plan || "free";
  if (plan === "free" || plan === "") paymentHealth = 20;
  else if (plan.includes("annual") || plan.includes("pro")) paymentHealth = 95;
  else if (plan.includes("starter") || plan.includes("basic")) paymentHealth = 60;
  else paymentHealth = 75;

  // Engagement Score (0-100): based on support tickets and data volume
  const [ticketCount] = await db.select({ c: count() })
    .from(supportTickets)
    .where(eq(supportTickets.organizationId, orgId));
  const [dealCount] = await db.select({ c: count() })
    .from(deals)
    .where(eq(deals.organizationId, orgId));
  const [leadCount] = await db.select({ c: count() })
    .from(leads)
    .where(eq(leads.organizationId, orgId));

  const openTickets = Number(ticketCount?.c || 0);
  const totalDeals = Number(dealCount?.c || 0);
  const totalLeads = Number(leadCount?.c || 0);

  // More data = more engaged. But too many tickets = problems.
  let engagementScore = 30; // Base
  if (totalLeads > 0) engagementScore += 20;
  if (totalLeads > 10) engagementScore += 10;
  if (totalDeals > 0) engagementScore += 20;
  if (totalDeals > 5) engagementScore += 10;
  if (openTickets > 3) engagementScore -= 15; // Many tickets = friction
  engagementScore = Math.max(0, Math.min(100, engagementScore));

  // Churn risk from existing engine
  const riskData = await db.select()
    .from(churnRiskScores)
    .where(eq(churnRiskScores.orgId, orgId))
    .orderBy(desc(churnRiskScores.calculatedAt))
    .limit(1);
  const churnRisk = riskData[0]?.riskScore || 50;

  // Combined health score
  const healthScore = Math.round(
    activityScore * 0.35 +
    paymentHealth * 0.25 +
    engagementScore * 0.25 +
    (100 - Number(churnRisk)) * 0.15
  );

  // Trend (compare activity to 30 days ago)
  let trend: "improving" | "stable" | "declining" = "stable";
  if (daysSinceLogin > 14) trend = "declining";
  else if (daysSinceLogin <= 2 && totalDeals > 0) trend = "improving";

  // Customer tenure
  const createdAt = org.createdAt ? new Date(org.createdAt) : now;
  const customerMonths = Math.max(1, Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24 * 30)));

  // Summary
  const trendEmoji = trend === "improving" ? "trending up" : trend === "declining" ? "declining" : "stable";
  const summary = `${org.name}: Health ${healthScore}/100 (${trendEmoji}). ${plan} plan, customer for ${customerMonths} month${customerMonths > 1 ? "s" : ""}. ${totalLeads} leads, ${totalDeals} deals. Last login: ${daysSinceLogin === 999 ? "never" : `${daysSinceLogin} day${daysSinceLogin !== 1 ? "s" : ""} ago`}.`;

  return {
    orgId,
    orgName: org.name || `Org #${orgId}`,
    healthScore,
    trend,
    churnRisk: Number(churnRisk),
    components: { activityScore, paymentHealth, engagementScore },
    details: {
      lastLogin: lastLogin?.toISOString() || null,
      daysSinceLastLogin: daysSinceLogin,
      plan,
      customerSince: createdAt.toLocaleDateString(),
      customerMonths,
      openTickets,
      totalDeals,
      totalLeads,
    },
    summary,
  };
}

/**
 * Get health scores for all paying customers, sorted by health (worst first).
 */
export async function getAllCustomerHealth(limit = 20): Promise<CustomerHealth[]> {
  const orgs = await db.select({ id: organizations.id })
    .from(organizations)
    .where(sql`${organizations.plan} IS NOT NULL AND ${organizations.plan} != 'free' AND ${organizations.plan} != ''`)
    .limit(limit);

  const results: CustomerHealth[] = [];
  for (const org of orgs) {
    const health = await getCustomerHealth(org.id);
    if (health) results.push(health);
  }

  // Sort by health score ascending (worst health first)
  results.sort((a, b) => a.healthScore - b.healthScore);
  return results;
}

/**
 * Get a summary for the CEO: how many customers are healthy vs at risk.
 */
export async function getHealthSummary(): Promise<{
  total: number;
  healthy: number;
  atRisk: number;
  critical: number;
  summary: string;
}> {
  const allHealth = await getAllCustomerHealth(100);
  const total = allHealth.length;
  const healthy = allHealth.filter(h => h.healthScore >= 70).length;
  const atRisk = allHealth.filter(h => h.healthScore >= 40 && h.healthScore < 70).length;
  const critical = allHealth.filter(h => h.healthScore < 40).length;

  let summary: string;
  if (total === 0) {
    summary = "No paying customers to evaluate.";
  } else if (critical > 0) {
    summary = `${critical} customer${critical > 1 ? "s" : ""} need${critical === 1 ? "s" : ""} immediate attention. ${healthy} of ${total} are healthy.`;
  } else if (atRisk > 0) {
    summary = `${healthy} of ${total} customers are healthy. ${atRisk} need monitoring.`;
  } else {
    summary = `All ${total} customers are healthy. Nice work.`;
  }

  return { total, healthy, atRisk, critical, summary };
}
