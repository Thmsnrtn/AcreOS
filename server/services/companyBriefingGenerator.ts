// @ts-nocheck
/**
 * Company Briefing Generator — Sovereign Company Protocol
 *
 * Pre-generates the CEO briefing daily at 6:45am CT so it's ready
 * when the founder opens the dashboard at 7am.
 *
 * Also callable on-demand via the /company-briefing endpoint.
 */

import { db } from "../db";
import {
  companyBriefingCache, companyAgents, decisionsInboxItems,
  supportTickets, systemAlerts, jobHealthLogs, organizations,
} from "@shared/schema";
import { eq, and, gte, desc, count, sql } from "drizzle-orm";
import { companyAgentService } from "./companyAgents";
import { agentCommsService } from "./agentComms";
import { logger } from "../utils/logger";

/**
 * Generate and cache a CEO briefing.
 * Called by the daily 6:45am job and by the API endpoint.
 */
export async function generateCompanyBriefing(): Promise<any> {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 86400000);

  // 1. Fetch all agents
  const agents = await companyAgentService.getAllIncludingPaused();

  // 2. Gather platform-wide metrics
  const [orgStats, ticketStats, alertStats, jobStats] = await Promise.allSettled([
    db.select({
      total: count(),
      active: sql<number>`count(*) filter (where subscription_status = 'active')`,
      paying: sql<number>`count(*) filter (where subscription_tier not in ('free') and subscription_status = 'active')`,
    }).from(organizations),

    db.select({ count: count() })
      .from(supportTickets)
      .where(eq(supportTickets.status, "open")),

    db.select({ count: count() })
      .from(systemAlerts)
      .where(and(eq(systemAlerts.severity, "critical"), gte(systemAlerts.createdAt, yesterday))),

    db.select()
      .from(jobHealthLogs)
      .where(gte(jobHealthLogs.runStartedAt, yesterday))
      .orderBy(desc(jobHealthLogs.runStartedAt))
      .limit(100),
  ]);

  const orgData = orgStats.status === "fulfilled" ? orgStats.value[0] : { total: 0, active: 0, paying: 0 };
  const openTickets = ticketStats.status === "fulfilled" ? ticketStats.value[0]?.count || 0 : 0;
  const criticalAlerts = alertStats.status === "fulfilled" ? alertStats.value[0]?.count || 0 : 0;
  const jobLogs = jobStats.status === "fulfilled" ? jobStats.value : [];

  const jobsHealthy = jobLogs.filter((j: any) => j.status === "success").length;
  const jobsFailed = jobLogs.filter((j: any) => j.status === "failed").length;

  // 3. Context data per agent
  const contextByAgent: Record<string, Record<string, any>> = {
    atlas_cto: { jobsHealthy, jobsFailed, totalJobs: jobLogs.length },
    sophie_csm: { openTickets, totalOrgs: orgData.total },
    forge_revenue: { payingOrgs: orgData.paying, activeOrgs: orgData.active, totalOrgs: orgData.total },
    beacon_marketing: { totalOrgs: orgData.total, activeOrgs: orgData.active },
    sentinel_devops: { jobsHealthy, jobsFailed, criticalAlerts },
    ledger_finance: { payingOrgs: orgData.paying },
    shield_legal: {},
    oracle_analytics: { totalOrgs: orgData.total, payingOrgs: orgData.paying },
    compass_pm: {},
    crucible_qa: { jobsHealthy, jobsFailed },
  };

  // 4. Generate reports (in parallel, with fallback)
  const agentReports = await Promise.allSettled(
    agents
      .filter(a => a.status === "active")
      .map(agent =>
        companyAgentService.generateReport(agent.codename, contextByAgent[agent.codename] || {})
      )
  );

  const reports = agentReports
    .filter((r): r is PromiseFulfilledResult<any> => r.status === "fulfilled")
    .map(r => r.value);

  // 5. Pending decisions
  const decisions = await db.select()
    .from(decisionsInboxItems)
    .where(eq(decisionsInboxItems.status, "pending"))
    .orderBy(desc(decisionsInboxItems.urgencyScore))
    .limit(10);

  const decisionsNeeded = decisions.map((d: any) => ({
    id: d.id,
    fromAgent: d.ownerAgentCodename || companyAgentService.getOwnerForDecisionType(d.itemType) || "unknown",
    title: d.recommendedActionLabel,
    context: d.sophieAnalysis,
    recommendation: d.recommendedAction,
    options: [
      { label: "Approve", action: "approve", tradeoff: "Execute recommended action" },
      { label: "Reject", action: "reject", tradeoff: "Dismiss this recommendation" },
      { label: "Discuss", action: "defer", tradeoff: "Defer for further analysis" },
    ],
    urgency: d.riskLevel === "critical" ? "critical" : d.riskLevel === "high" ? "high" : d.urgencyScore > 70 ? "medium" : "low",
  }));

  // 6. Health score
  const agentHealthScores = reports.map(r => r.healthScore);
  const healthScore = agentHealthScores.length > 0
    ? Math.round(agentHealthScores.reduce((a: number, b: number) => a + b, 0) / agentHealthScores.length)
    : 80;

  const mood = healthScore >= 80 ? "green" : healthScore >= 60 ? "yellow" : "red";

  // 7. Overnight agent messages
  const recentMessages = await agentCommsService.getRecentMessages(yesterday, 50);
  const overnightActivity = agents
    .filter(a => a.status === "active")
    .map(agent => ({
      agent: agent.title,
      codename: agent.codename,
      actions: recentMessages
        .filter((m: any) => m.fromAgent === agent.codename)
        .map((m: any) => ({
          description: m.subject,
          autonomous: true,
          timestamp: m.createdAt?.toISOString() || now.toISOString(),
        })),
    }))
    .filter(a => a.actions.length > 0);

  const briefing = {
    generatedAt: now.toISOString(),
    healthScore,
    mood,
    overnightActivity,
    agentReports: reports,
    decisionsNeeded,
    wins: reports
      .flatMap(r => (r.alerts || []).filter((a: any) => a.level === "info"))
      .map((a: any) => a.message)
      .slice(0, 5),
    upcoming: [],
    agentTeam: agents.map(a => ({
      codename: a.codename,
      title: a.title,
      wing: a.wing,
      trustScore: a.trustScore,
      status: a.status,
      lastActivityAt: a.lastActivityAt?.toISOString(),
      metrics: a.metrics,
    })),
  };

  // 8. Cache the briefing
  await db.insert(companyBriefingCache).values({
    briefingData: briefing,
    healthScore,
    mood,
  });

  logger.info(`[CompanyBriefing] Generated at ${now.toISOString()} | Health: ${healthScore} | Mood: ${mood} | Agents: ${reports.length}`);

  return briefing;
}
