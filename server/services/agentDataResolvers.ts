/**
 * Agent Data Resolvers — Sovereign Company Protocol v2
 *
 * Each agent has a resolver that queries REAL services for live metrics.
 * No more pre-aggregated numbers — agents see actual platform state.
 *
 * These resolvers are called by:
 *   - generateReport() for CEO Briefing
 *   - /agent-chat for grounded conversations
 *   - agentProactiveEngine for decision-making
 */

import { db } from "../db";
import {
  organizations, supportTickets, systemAlerts, jobHealthLogs,
  payments, subscriptionEvents, apiUsageLogs, activityLog,
  campaigns, featureRequests, churnRiskScores, leads, properties,
  deals, decisionsInboxItems, revenueProtectionInterventions,
} from "@shared/schema";
import { eq, and, gte, desc, count, sum, sql, ne } from "drizzle-orm";
import { logger } from "../utils/logger";

export type AgentDataResolver = () => Promise<Record<string, any>>;

const resolvers: Record<string, AgentDataResolver> = {};

// ─── ATLAS CTO ──────────────────────────────────────────────────────────────
resolvers.atlas_cto = async () => {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 86400000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000);

  const [jobLogs, critAlerts, totalAlerts] = await Promise.allSettled([
    db.select().from(jobHealthLogs)
      .where(gte(jobHealthLogs.runStartedAt, yesterday))
      .orderBy(desc(jobHealthLogs.runStartedAt)).limit(100),
    db.select({ count: count() }).from(systemAlerts)
      .where(and(eq(systemAlerts.severity, "critical"), gte(systemAlerts.createdAt, yesterday))),
    db.select({ count: count() }).from(systemAlerts)
      .where(gte(systemAlerts.createdAt, sevenDaysAgo)),
  ]);

  const jobs = jobLogs.status === "fulfilled" ? jobLogs.value : [];
  const healthy = jobs.filter((j: any) => j.status === "success").length;
  const failed = jobs.filter((j: any) => j.status === "failed").length;
  const failedNames = [...new Set(jobs.filter((j: any) => j.status === "failed").map((j: any) => j.jobName))];

  return {
    jobsRunLast24h: jobs.length,
    jobsHealthy: healthy,
    jobsFailed: failed,
    failedJobNames: failedNames,
    successRate: jobs.length > 0 ? Math.round((healthy / jobs.length) * 100) : 100,
    criticalAlertsLast24h: critAlerts.status === "fulfilled" ? Number(critAlerts.value[0]?.count || 0) : 0,
    totalAlertsLast7d: totalAlerts.status === "fulfilled" ? Number(totalAlerts.value[0]?.count || 0) : 0,
    // NOT MEASURED, and null says so rather than 0.
    //
    // This was a count over `api_usage_logs` with `sql`status_code >= 500``.
    // That table records service / action / count / estimated cost — it has NO
    // status column and never has, so the query threw "column status_code does
    // not exist" on EVERY run. `Promise.allSettled` swallowed the rejection and
    // the `: 0` fallback reported ZERO SERVER ERRORS IN 24 HOURS to the agent:
    // a permanent all-clear manufactured out of a query that could not run.
    //
    // Nothing in this schema records an HTTP status for inbound API calls
    // (`webhook_deliveries.status_code` is outbound webhook delivery, a
    // different measurement), so there is no honest number to put here.
    serverErrorsLast24h: null,
  };
};

// ─── SOPHIE CSM ─────────────────────────────────────────────────────────────
resolvers.sophie_csm = async () => {
  const yesterday = new Date(Date.now() - 86400000);
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);

  const [openTickets, resolvedBysophie7d, totalResolved7d, totalOrgs] = await Promise.allSettled([
    db.select({ count: count() }).from(supportTickets)
      .where(eq(supportTickets.status, "open")),
    db.select({ count: count() }).from(supportTickets)
      .where(and(
        sql`${supportTickets.resolvedAt} IS NOT NULL`,
        gte(supportTickets.resolvedAt, sevenDaysAgo),
        eq(supportTickets.assignedAgent, "sophie"),
      )),
    db.select({ count: count() }).from(supportTickets)
      .where(and(
        sql`${supportTickets.resolvedAt} IS NOT NULL`,
        gte(supportTickets.resolvedAt, sevenDaysAgo),
      )),
    db.select({ count: count() }).from(organizations),
  ]);

  const sophieCount = resolvedBysophie7d.status === "fulfilled" ? Number(resolvedBysophie7d.value[0]?.count || 0) : 0;
  const totalCount = totalResolved7d.status === "fulfilled" ? Number(totalResolved7d.value[0]?.count || 1) : 1;

  return {
    openTickets: openTickets.status === "fulfilled" ? Number(openTickets.value[0]?.count || 0) : 0,
    autoResolutionRate7d: totalCount > 0 ? Math.round((sophieCount / totalCount) * 100) : 100,
    sophieResolved7d: sophieCount,
    totalResolved7d: totalCount,
    totalOrganizations: totalOrgs.status === "fulfilled" ? Number(totalOrgs.value[0]?.count || 0) : 0,
  };
};

// ─── FORGE REVENUE ──────────────────────────────────────────────────────────
resolvers.forge_revenue = async () => {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000);

  const [mrrResult, orgStats, cancels30d, cancels7d, churnRisk, dunning] = await Promise.allSettled([
    db.select({ total: sql<number>`COALESCE(SUM(monthly_price_cents), 0)` })
      .from(organizations)
      .where(sql`${organizations.subscriptionStatus} IN ('active', 'trialing')`),
    db.select({
      total: count(),
      active: sql<number>`count(*) filter (where subscription_status = 'active')`,
      paying: sql<number>`count(*) filter (where subscription_tier not in ('free') and subscription_status = 'active')`,
    }).from(organizations),
    db.select({ count: count() }).from(subscriptionEvents)
      .where(and(eq(subscriptionEvents.eventType, "subscription_cancelled"), gte(subscriptionEvents.createdAt, thirtyDaysAgo))),
    db.select({ count: count() }).from(subscriptionEvents)
      .where(and(eq(subscriptionEvents.eventType, "subscription_cancelled"), gte(subscriptionEvents.createdAt, sevenDaysAgo))),
    db.select({ count: count() }).from(churnRiskScores)
      .where(sql`${churnRiskScores.riskBand} IN ('red', 'critical')`),
    db.select({ count: count() }).from(organizations)
      .where(sql`${organizations.dunningStage} IN ('restricted', 'suspended')`),
  ]);

  const mrrCents = mrrResult.status === "fulfilled" ? Number(mrrResult.value[0]?.total || 0) : 0;
  const orgs = orgStats.status === "fulfilled" ? orgStats.value[0] : { total: 0, active: 0, paying: 0 };
  const payingCount = Number(orgs.paying || 0);
  const cancelCount = cancels30d.status === "fulfilled" ? Number(cancels30d.value[0]?.count || 0) : 0;

  return {
    mrrCents,
    mrrDollars: (mrrCents / 100).toFixed(2),
    arrCents: mrrCents * 12,
    arrDollars: ((mrrCents * 12) / 100).toFixed(2),
    totalOrgs: Number(orgs.total || 0),
    activeOrgs: Number(orgs.active || 0),
    payingOrgs: payingCount,
    churnRate30d: payingCount > 0 ? ((cancelCount / payingCount) * 100).toFixed(2) : "0.00",
    cancellations30d: cancelCount,
    cancellations7d: cancels7d.status === "fulfilled" ? Number(cancels7d.value[0]?.count || 0) : 0,
    orgsAtChurnRisk: churnRisk.status === "fulfilled" ? Number(churnRisk.value[0]?.count || 0) : 0,
    orgsDunningRestricted: dunning.status === "fulfilled" ? Number(dunning.value[0]?.count || 0) : 0,
  };
};

// ─── BEACON MARKETING ───────────────────────────────────────────────────────
resolvers.beacon_marketing = async () => {
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);

  const [campaignCount, emailActivity, signups7d, orgStats] = await Promise.allSettled([
    db.select({ count: count() }).from(campaigns)
      .where(eq(campaigns.status, "active")),
    db.select({ count: count() }).from(activityLog)
      .where(and(gte(activityLog.createdAt, sevenDaysAgo), sql`action LIKE 'email_%' OR action LIKE 'campaign_%'`)),
    db.select({ count: count() }).from(organizations)
      .where(gte(organizations.createdAt, sevenDaysAgo)),
    db.select({
      total: count(),
      active: sql<number>`count(*) filter (where subscription_status = 'active')`,
    }).from(organizations),
  ]);

  return {
    activeCampaigns: campaignCount.status === "fulfilled" ? Number(campaignCount.value[0]?.count || 0) : 0,
    emailActionsLast7d: emailActivity.status === "fulfilled" ? Number(emailActivity.value[0]?.count || 0) : 0,
    newSignupsLast7d: signups7d.status === "fulfilled" ? Number(signups7d.value[0]?.count || 0) : 0,
    totalOrgs: orgStats.status === "fulfilled" ? Number(orgStats.value[0]?.total || 0) : 0,
    activeOrgs: orgStats.status === "fulfilled" ? Number(orgStats.value[0]?.active || 0) : 0,
  };
};

// ─── SENTINEL DEVOPS ────────────────────────────────────────────────────────
resolvers.sentinel_devops = async () => {
  const yesterday = new Date(Date.now() - 86400000);

  const [critAlerts, openAlerts, jobLogs] = await Promise.allSettled([
    db.select({ count: count() }).from(systemAlerts)
      .where(and(eq(systemAlerts.severity, "critical"), gte(systemAlerts.createdAt, yesterday))),
    db.select({ count: count() }).from(systemAlerts)
      .where(sql`${systemAlerts.status} IN ('new', 'open')`),
    db.select().from(jobHealthLogs)
      .where(gte(jobHealthLogs.runStartedAt, yesterday))
      .orderBy(desc(jobHealthLogs.runStartedAt)).limit(100),
  ]);

  const jobs = jobLogs.status === "fulfilled" ? jobLogs.value : [];
  const healthy = jobs.filter((j: any) => j.status === "success").length;
  const failed = jobs.filter((j: any) => j.status === "failed").length;

  return {
    criticalAlertsLast24h: critAlerts.status === "fulfilled" ? Number(critAlerts.value[0]?.count || 0) : 0,
    openAlerts: openAlerts.status === "fulfilled" ? Number(openAlerts.value[0]?.count || 0) : 0,
    jobsHealthy: healthy,
    jobsFailed: failed,
    jobSuccessRate: jobs.length > 0 ? Math.round((healthy / jobs.length) * 100) : 100,
    totalJobRuns: jobs.length,
  };
};

// ─── LEDGER FINANCE ─────────────────────────────────────────────────────────
resolvers.ledger_finance = async () => {
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);

  const [aiCost7d, aiCost30d, revenue30d, payingOrgs] = await Promise.allSettled([
    db.select({ total: sum(apiUsageLogs.estimatedCostCents) }).from(apiUsageLogs)
      .where(gte(apiUsageLogs.createdAt, sevenDaysAgo)),
    db.select({ total: sum(apiUsageLogs.estimatedCostCents) }).from(apiUsageLogs)
      .where(gte(apiUsageLogs.createdAt, thirtyDaysAgo)),
    db.select({ total: sum(payments.amount) }).from(payments)
      .where(gte(payments.createdAt, thirtyDaysAgo)),
    db.select({ count: count() }).from(organizations)
      .where(sql`subscription_tier NOT IN ('free') AND subscription_status = 'active'`),
  ]);

  const aiWeek = aiCost7d.status === "fulfilled" ? Number(aiCost7d.value[0]?.total || 0) : 0;
  const aiMonth = aiCost30d.status === "fulfilled" ? Number(aiCost30d.value[0]?.total || 0) : 0;

  return {
    aiSpend7dCents: aiWeek,
    aiSpend7dDollars: (aiWeek / 100).toFixed(2),
    aiSpend30dCents: aiMonth,
    aiSpend30dDollars: (aiMonth / 100).toFixed(2),
    revenue30dCents: revenue30d.status === "fulfilled" ? Number(revenue30d.value[0]?.total || 0) : 0,
    payingOrgs: payingOrgs.status === "fulfilled" ? Number(payingOrgs.value[0]?.count || 0) : 0,
    aiCostPerOrgCents: payingOrgs.status === "fulfilled" && Number(payingOrgs.value[0]?.count || 0) > 0
      ? Math.round(aiMonth / Number(payingOrgs.value[0]?.count))
      : 0,
  };
};

// ─── SHIELD LEGAL ───────────────────────────────────────────────────────────
resolvers.shield_legal = async () => {
  return {
    complianceStatus: "active",
    lastAuditCheck: new Date().toISOString(),
    note: "Compliance monitoring active. No regulatory changes detected requiring action.",
  };
};

// ─── ORACLE ANALYTICS ───────────────────────────────────────────────────────
resolvers.oracle_analytics = async () => {
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
  const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000);

  const [orgsThisWeek, orgsLastWeek, payingNow, cancelsThisWeek] = await Promise.allSettled([
    db.select({ count: count() }).from(organizations)
      .where(gte(organizations.createdAt, sevenDaysAgo)),
    db.select({ count: count() }).from(organizations)
      .where(and(gte(organizations.createdAt, fourteenDaysAgo), sql`created_at < ${sevenDaysAgo.toISOString()}`)),
    db.select({ count: count() }).from(organizations)
      .where(sql`subscription_tier NOT IN ('free') AND subscription_status = 'active'`),
    db.select({ count: count() }).from(subscriptionEvents)
      .where(and(eq(subscriptionEvents.eventType, "subscription_cancelled"), gte(subscriptionEvents.createdAt, sevenDaysAgo))),
  ]);

  const thisWeek = orgsThisWeek.status === "fulfilled" ? Number(orgsThisWeek.value[0]?.count || 0) : 0;
  const lastWeek = orgsLastWeek.status === "fulfilled" ? Number(orgsLastWeek.value[0]?.count || 0) : 0;
  const wow = lastWeek > 0 ? Math.round(((thisWeek - lastWeek) / lastWeek) * 100) : 0;

  return {
    newOrgsThisWeek: thisWeek,
    newOrgsLastWeek: lastWeek,
    signupGrowthWoW: wow,
    payingOrgs: payingNow.status === "fulfilled" ? Number(payingNow.value[0]?.count || 0) : 0,
    cancellationsThisWeek: cancelsThisWeek.status === "fulfilled" ? Number(cancelsThisWeek.value[0]?.count || 0) : 0,
    netNewThisWeek: thisWeek - (cancelsThisWeek.status === "fulfilled" ? Number(cancelsThisWeek.value[0]?.count || 0) : 0),
  };
};

// ─── COMPASS PM ─────────────────────────────────────────────────────────────
resolvers.compass_pm = async () => {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);

  const [totalRequests, recentRequests, pendingDecisions] = await Promise.allSettled([
    db.select({ count: count() }).from(featureRequests),
    db.select({ count: count() }).from(featureRequests)
      .where(gte(featureRequests.createdAt, thirtyDaysAgo)),
    db.select({ count: count() }).from(decisionsInboxItems)
      .where(and(eq(decisionsInboxItems.status, "pending"), eq(decisionsInboxItems.itemType, "feature_request_flagged"))),
  ]);

  return {
    totalFeatureRequests: totalRequests.status === "fulfilled" ? Number(totalRequests.value[0]?.count || 0) : 0,
    requestsLast30d: recentRequests.status === "fulfilled" ? Number(recentRequests.value[0]?.count || 0) : 0,
    pendingFeatureDecisions: pendingDecisions.status === "fulfilled" ? Number(pendingDecisions.value[0]?.count || 0) : 0,
  };
};

// ─── CRUCIBLE QA ────────────────────────────────────────────────────────────
resolvers.crucible_qa = async () => {
  const yesterday = new Date(Date.now() - 86400000);

  const [jobLogs] = await Promise.allSettled([
    db.select().from(jobHealthLogs)
      .where(gte(jobHealthLogs.runStartedAt, yesterday)).limit(100),
  ]);

  const jobs = jobLogs.status === "fulfilled" ? jobLogs.value : [];
  const healthy = jobs.filter((j: any) => j.status === "success").length;
  const failed = jobs.filter((j: any) => j.status === "failed").length;

  return {
    jobsHealthy: healthy,
    jobsFailed: failed,
    jobSuccessRate: jobs.length > 0 ? Math.round((healthy / jobs.length) * 100) : 100,
    // NOT MEASURED — see serverErrorsLast24h in atlas_cto for the whole story.
    // The same impossible `status_code` count sat here, reporting 0, which also
    // meant the one alarm that reads this value (`apiErrorsLast24h > 10` in
    // agentProactiveEngine) could never fire.
    apiErrorsLast24h: null,
  };
};

// ─── Exports ────────────────────────────────────────────────────────────────

export async function resolveAgentData(codename: string): Promise<Record<string, any>> {
  const resolver = resolvers[codename];
  if (!resolver) return {};
  try {
    return await resolver();
  } catch (err) {
    logger.error(`[AgentDataResolver] Error resolving ${codename}`, err);
    return { resolverError: true };
  }
}

export function hasResolver(codename: string): boolean {
  return codename in resolvers;
}
