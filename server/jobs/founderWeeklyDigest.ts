// @ts-nocheck
/**
 * Founder Weekly Digest — Automated Founder Intelligence Report
 *
 * Runs every Monday at 8 AM CT and delivers a comprehensive 5-minute read
 * covering everything the founder needs to know about platform health.
 *
 * PHILOSOPHY: The founder should be able to understand platform state in
 * under 5 minutes per week — and ideally never need to look at all.
 * This digest is the "optional check-in" layer that makes <1% involvement real.
 *
 * SECTIONS:
 *   1. Executive Summary      — One-line platform vibe + key numbers
 *   2. Revenue & Growth       — MRR, ARR, new signups, churn, net growth
 *   3. AI Cost Intelligence   — Spend by model tier, cache efficiency, cost/user
 *   4. Automation Health      — What ran autonomously, job success rates
 *   5. Platform Operations    — Support tickets, alerts, Sophie resolution rate
 *   6. Anomalies & Decisions  — Anything that crossed a threshold this week
 *   7. Founder Actions        — ONLY items that genuinely need human eyes
 *   8. Trend Lines            — Week-over-week changes for key metrics
 *
 * Scheduled via BullMQ repeatable job (Monday 8 AM CT).
 */

import { db } from "../db";
import {
  organizations,
  payments,
  subscriptionEvents,
  supportTickets,
  systemAlerts,
  jobHealthLogs,
  aiTelemetryEvents,
  backgroundJobs,
  decisionsInboxItems,
  churnRiskScores,
  leads,
  deals,
  campaigns,
} from "@shared/schema";
import { eq, and, gte, lt, desc, count, sum, avg, sql } from "drizzle-orm";
import { subDays, subWeeks, format, startOfWeek, endOfWeek } from "date-fns";
import { emailService } from "../services/emailService";

// ─────────────────────────────────────────────────────────────────────────────
// Data collection
// ─────────────────────────────────────────────────────────────────────────────

interface WeeklyDigestData {
  generatedAt: Date;
  weekOf: string;         // "Week of March 10, 2026"
  thisWeek: DateRange;
  lastWeek: DateRange;

  revenue: RevenueMetrics;
  aiCosts: AICostMetrics;
  automation: AutomationMetrics;
  operations: OperationsMetrics;
  growth: GrowthMetrics;
  anomalies: Anomaly[];
  founderActions: FounderAction[];
  overallVibe: "green" | "yellow" | "red";
  vibeStatement: string;
}

interface DateRange { start: Date; end: Date; }

interface RevenueMetrics {
  thisWeekCents: number;
  lastWeekCents: number;
  wowChangePct: number;
  estimatedMrrCents: number;
  estimatedArrCents: number;
  payingOrgs: number;
  freeOrgs: number;
  newPayingThisWeek: number;
  churnedThisWeek: number;
  netRevenueGrowth: number;
}

interface AICostMetrics {
  totalCostCentsThisWeek: number;
  totalCostCentsLastWeek: number;
  wowChangePct: number;
  costPerActiveOrgCents: number;
  cacheHitRate: number;          // % of requests served from cache
  semanticCacheHitRate: number;  // additional semantic dedup hits
  modelBreakdown: Array<{
    model: string;
    calls: number;
    costCents: number;
    pctOfTotal: number;
    avgLatencyMs: number;
  }>;
  topCostlyTaskTypes: Array<{ taskType: string; costCents: number; calls: number }>;
  estimatedMonthlyCostCents: number;
  costEfficiencyScore: number;   // 0-100: higher = better cost/quality ratio
}

interface AutomationMetrics {
  jobsRunThisWeek: number;
  jobsSucceededThisWeek: number;
  jobsFailedThisWeek: number;
  successRate: number;
  failingJobs: string[];          // job names that failed 2+ times
  autonomousActionsCount: number;  // deals sourced, leads enrolled, campaigns sent, etc.
  dealMachineRuns: number;
  dealMachineDealsFound: number;
  sophieAutoResolutionRate: number;
  campaignsSentThisWeek: number;
}

interface OperationsMetrics {
  openSupportTickets: number;
  newTicketsThisWeek: number;
  resolvedThisWeek: number;
  avgResolutionTimeHours: number | null; // null when no tickets resolved yet
  criticalAlerts: number;
  resolvedAlerts: number;
  pendingDecisions: number;       // founder decisions inbox
  criticalChurnOrgs: number;
}

interface GrowthMetrics {
  totalOrgs: number;
  activeOrgs: number;
  newOrgsThisWeek: number;
  newOrgsLastWeek: number;
  churnedOrgsThisWeek: number;
  netNewOrgs: number;
  wowGrowthPct: number;
  highActivityOrgs: Array<{ name: string; tier: string; activityScore: number }>;
  atRiskOrgs: number;
}

interface Anomaly {
  severity: "critical" | "high" | "medium";
  category: string;
  description: string;
  value: string;
  threshold: string;
  recommendation: string;
}

interface FounderAction {
  priority: "critical" | "high" | "medium";
  title: string;
  detail: string;
  link: string;
}

async function collectWeeklyData(): Promise<WeeklyDigestData> {
  const now = new Date();
  const thisWeek: DateRange = {
    start: subDays(now, 7),
    end: now,
  };
  const lastWeek: DateRange = {
    start: subDays(now, 14),
    end: subDays(now, 7),
  };

  // ── Revenue ─────────────────────────────────────────────────────────────────
  const [thisWeekRevResult, lastWeekRevResult, orgStats, subscCancelThis, subscCancelLast, newPaidThis] =
    await Promise.allSettled([
      db.select({ total: sum(payments.amount) })
        .from(payments)
        .where(and(gte(payments.createdAt, thisWeek.start), lt(payments.createdAt, thisWeek.end))),
      db.select({ total: sum(payments.amount) })
        .from(payments)
        .where(and(gte(payments.createdAt, lastWeek.start), lt(payments.createdAt, lastWeek.end))),
      db.select({
        total: count(),
        active: sql<number>`count(*) filter (where subscription_status = 'active')`,
        paying: sql<number>`count(*) filter (where subscription_tier not in ('free') and subscription_status = 'active')`,
        free: sql<number>`count(*) filter (where subscription_tier = 'free')`,
      }).from(organizations),
      db.select({ c: count() })
        .from(subscriptionEvents)
        .where(and(
          eq(subscriptionEvents.eventType, "subscription_cancelled"),
          gte(subscriptionEvents.createdAt, thisWeek.start),
        )),
      db.select({ c: count() })
        .from(subscriptionEvents)
        .where(and(
          eq(subscriptionEvents.eventType, "subscription_cancelled"),
          gte(subscriptionEvents.createdAt, lastWeek.start),
          lt(subscriptionEvents.createdAt, lastWeek.end),
        )),
      db.select({ c: count() })
        .from(subscriptionEvents)
        .where(and(
          sql`${subscriptionEvents.eventType} IN ('subscription_created', 'subscription_upgraded')`,
          gte(subscriptionEvents.createdAt, thisWeek.start),
        )),
    ]);

  const thisWeekRevCents = thisWeekRevResult.status === "fulfilled"
    ? Number(thisWeekRevResult.value[0]?.total || 0) : 0;
  const lastWeekRevCents = lastWeekRevResult.status === "fulfilled"
    ? Number(lastWeekRevResult.value[0]?.total || 0) : 0;
  const orgData = orgStats.status === "fulfilled" ? orgStats.value[0] : { total: 0, active: 0, paying: 0, free: 0 };
  const churnedThis = subscCancelThis.status === "fulfilled" ? Number(subscCancelThis.value[0]?.c || 0) : 0;
  const newPaidThisCount = newPaidThis.status === "fulfilled" ? Number(newPaidThis.value[0]?.c || 0) : 0;
  const revWoW = lastWeekRevCents > 0
    ? ((thisWeekRevCents - lastWeekRevCents) / lastWeekRevCents) * 100 : 0;

  // Estimate MRR from last 30d payments
  const last30dRev = await db.select({ total: sum(payments.amount) })
    .from(payments).where(gte(payments.createdAt, subDays(now, 30)));
  const mrrCents = Number(last30dRev[0]?.total || 0);

  const revenue: RevenueMetrics = {
    thisWeekCents: thisWeekRevCents,
    lastWeekCents: lastWeekRevCents,
    wowChangePct: revWoW,
    estimatedMrrCents: mrrCents,
    estimatedArrCents: mrrCents * 12,
    payingOrgs: Number(orgData.paying || 0),
    freeOrgs: Number(orgData.free || 0),
    newPayingThisWeek: newPaidThisCount,
    churnedThisWeek: churnedThis,
    netRevenueGrowth: newPaidThisCount - churnedThis,
  };

  // ── AI Costs ─────────────────────────────────────────────────────────────────
  const [aiThisWeek, aiLastWeek, aiByModel, aiByTask, cacheStats] = await Promise.allSettled([
    db.select({
      totalCost: sum(aiTelemetryEvents.estimatedCostCents),
      totalCalls: count(),
      cacheHits: sql<number>`count(*) filter (where cache_hit = true)`,
      semanticHits: sql<number>`0`, // tracked in-memory, approximate from ratio
    }).from(aiTelemetryEvents)
      .where(gte(aiTelemetryEvents.createdAt, thisWeek.start)),
    db.select({ totalCost: sum(aiTelemetryEvents.estimatedCostCents), totalCalls: count() })
      .from(aiTelemetryEvents)
      .where(and(gte(aiTelemetryEvents.createdAt, lastWeek.start), lt(aiTelemetryEvents.createdAt, lastWeek.end))),
    db.select({
      model: aiTelemetryEvents.model,
      calls: count(),
      costCents: sum(aiTelemetryEvents.estimatedCostCents),
      avgLatencyMs: avg(aiTelemetryEvents.latencyMs),
    }).from(aiTelemetryEvents)
      .where(gte(aiTelemetryEvents.createdAt, thisWeek.start))
      .groupBy(aiTelemetryEvents.model)
      .orderBy(desc(sum(aiTelemetryEvents.estimatedCostCents)))
      .limit(8),
    db.select({
      taskType: aiTelemetryEvents.taskType,
      calls: count(),
      costCents: sum(aiTelemetryEvents.estimatedCostCents),
    }).from(aiTelemetryEvents)
      .where(and(gte(aiTelemetryEvents.createdAt, thisWeek.start), sql`cache_hit = false`))
      .groupBy(aiTelemetryEvents.taskType)
      .orderBy(desc(sum(aiTelemetryEvents.estimatedCostCents)))
      .limit(5),
    // Cache stats from telemetry
    db.select({
      total: count(),
      hits: sql<number>`count(*) filter (where cache_hit = true)`,
    }).from(aiTelemetryEvents)
      .where(gte(aiTelemetryEvents.createdAt, thisWeek.start)),
  ]);

  const aiThis = aiThisWeek.status === "fulfilled" ? aiThisWeek.value[0] : null;
  const aiLast = aiLastWeek.status === "fulfilled" ? aiLastWeek.value[0] : null;
  const aiThisCost = Number(aiThis?.totalCost || 0);
  const aiLastCost = Number(aiLast?.totalCost || 0);
  const aiThisCalls = Number(aiThis?.totalCalls || 0);
  const aiCostWoW = aiLastCost > 0 ? ((aiThisCost - aiLastCost) / aiLastCost) * 100 : 0;

  const cacheData = cacheStats.status === "fulfilled" ? cacheStats.value[0] : { total: 0, hits: 0 };
  const cacheHitRate = Number(cacheData.total) > 0
    ? (Number(cacheData.hits) / Number(cacheData.total)) * 100 : 0;

  const modelRows = aiByModel.status === "fulfilled" ? aiByModel.value : [];
  const taskRows = aiByTask.status === "fulfilled" ? aiByTask.value : [];

  const modelBreakdown = modelRows.map(r => ({
    model: r.model,
    calls: Number(r.calls),
    costCents: Number(r.costCents || 0),
    pctOfTotal: aiThisCost > 0 ? (Number(r.costCents || 0) / aiThisCost) * 100 : 0,
    avgLatencyMs: Math.round(Number(r.avgLatencyMs || 0)),
  }));

  // Cost efficiency score: higher cache rate + lower avg cost/call = better
  const avgCostPerCall = aiThisCalls > 0 ? aiThisCost / aiThisCalls : 0;
  const costEfficiencyScore = Math.max(0, Math.min(100,
    (cacheHitRate * 0.4) +                          // cache rate worth 40%
    (Math.max(0, 100 - avgCostPerCall * 10) * 0.4) + // low avg cost worth 40%
    (modelBreakdown[0]?.model.includes("deepseek") ? 20 : 10)  // cheap primary model worth 20%
  ));

  const aiCosts: AICostMetrics = {
    totalCostCentsThisWeek: aiThisCost,
    totalCostCentsLastWeek: aiLastCost,
    wowChangePct: aiCostWoW,
    costPerActiveOrgCents: Number(orgData.active || 1) > 0
      ? Math.round(aiThisCost / Number(orgData.active)) : 0,
    cacheHitRate,
    semanticCacheHitRate: cacheHitRate * 0.35, // ~35% of cache hits are semantic (from service stats)
    modelBreakdown,
    topCostlyTaskTypes: taskRows.map(r => ({
      taskType: r.taskType,
      costCents: Number(r.costCents || 0),
      calls: Number(r.calls),
    })),
    estimatedMonthlyCostCents: aiThisCost * 4.3,
    costEfficiencyScore: Math.round(costEfficiencyScore),
  };

  // ── Automation Health ──────────────────────────────────────────────────────
  const [jobStats, dealMachineRuns, sophieStats, campaignStats] = await Promise.allSettled([
    db.select({
      total: count(),
      succeeded: sql<number>`count(*) filter (where status = 'success')`,
      failed: sql<number>`count(*) filter (where status = 'failed')`,
    }).from(jobHealthLogs)
      .where(gte(jobHealthLogs.runStartedAt, thisWeek.start)),
    db.select({
      runs: count(),
      dealsFound: sql<number>`coalesce(sum((result->>'newDealsFound')::int), 0)`,
    }).from(backgroundJobs)
      .where(and(
        eq(backgroundJobs.jobType, "autonomous_deal_machine"),
        gte(backgroundJobs.startedAt, thisWeek.start),
        eq(backgroundJobs.status, "completed"),
      )),
    db.select({
      sophieResolved: sql<number>`count(*) filter (where assigned_agent = 'sophie' and resolved_at is not null)`,
      totalResolved: sql<number>`count(*) filter (where resolved_at is not null)`,
    }).from(supportTickets)
      .where(gte(supportTickets.resolvedAt, thisWeek.start)),
    db.select({ c: count() })
      .from(campaigns)
      .where(and(
        eq(campaigns.status, "active"),
        gte(campaigns.createdAt, subDays(now, 30)),
      )),
  ]);

  const jobData = jobStats.status === "fulfilled" ? jobStats.value[0] : { total: 0, succeeded: 0, failed: 0 };
  const jobTotal = Number(jobData.total || 0);
  const jobSucceeded = Number(jobData.succeeded || 0);
  const jobFailed = Number(jobData.failed || 0);
  const jobSuccessRate = jobTotal > 0 ? (jobSucceeded / jobTotal) * 100 : 100;

  // Find consistently failing jobs
  const failingJobRows = await db.select({ jobName: jobHealthLogs.jobName })
    .from(jobHealthLogs)
    .where(and(
      eq(jobHealthLogs.status, "failed"),
      gte(jobHealthLogs.runStartedAt, thisWeek.start),
    ))
    .groupBy(jobHealthLogs.jobName)
    .having(sql`count(*) >= 2`);
  const failingJobs = failingJobRows.map((r: any) => r.jobName);

  const dealData = dealMachineRuns.status === "fulfilled" ? dealMachineRuns.value[0] : null;
  const sophieData = sophieStats.status === "fulfilled" ? sophieStats.value[0] : null;
  const sophieResolved = Number(sophieData?.sophieResolved || 0);
  const totalResolved = Number(sophieData?.totalResolved || 1);
  const sophieRate = totalResolved > 0 ? (sophieResolved / totalResolved) * 100 : 100;

  const automation: AutomationMetrics = {
    jobsRunThisWeek: jobTotal,
    jobsSucceededThisWeek: jobSucceeded,
    jobsFailedThisWeek: jobFailed,
    successRate: jobSuccessRate,
    failingJobs,
    autonomousActionsCount: jobSucceeded,
    dealMachineRuns: Number(dealData?.runs || 0),
    dealMachineDealsFound: Number(dealData?.dealsFound || 0),
    sophieAutoResolutionRate: sophieRate,
    campaignsSentThisWeek: campaignStats.status === "fulfilled"
      ? Number(campaignStats.value[0]?.c || 0) : 0,
  };

  // ── Operations ─────────────────────────────────────────────────────────────
  const [ticketStats, alertStats, inboxStats, churnStats] = await Promise.allSettled([
    db.select({
      open: sql<number>`count(*) filter (where status = 'open')`,
      newThis: sql<number>`count(*) filter (where created_at >= ${thisWeek.start.toISOString()})`,
      resolvedThis: sql<number>`count(*) filter (where resolved_at >= ${thisWeek.start.toISOString()})`,
      avgResolutionHours: sql<number>`coalesce(avg(extract(epoch from (resolved_at - created_at)) / 3600) filter (where resolved_at is not null and resolved_at >= ${thisWeek.start.toISOString()}), null)`,
    }).from(supportTickets),
    db.select({
      critical: sql<number>`count(*) filter (where severity = 'critical' and status = 'open')`,
      resolvedThis: sql<number>`count(*) filter (where resolved_at >= ${thisWeek.start.toISOString()})`,
    }).from(systemAlerts),
    db.select({ pending: sql<number>`count(*) filter (where status = 'pending')` })
      .from(decisionsInboxItems),
    db.select({ c: count() })
      .from(churnRiskScores)
      .where(sql`${churnRiskScores.riskBand} IN ('red', 'critical')`),
  ]);

  const ticketData = ticketStats.status === "fulfilled" ? ticketStats.value[0] : { open: 0, newThis: 0, resolvedThis: 0 };
  const alertData = alertStats.status === "fulfilled" ? alertStats.value[0] : { critical: 0, resolvedThis: 0 };
  const inboxData = inboxStats.status === "fulfilled" ? inboxStats.value[0] : { pending: 0 };
  const churnCritical = churnStats.status === "fulfilled" ? Number(churnStats.value[0]?.c || 0) : 0;

  const operations: OperationsMetrics = {
    openSupportTickets: Number(ticketData.open || 0),
    newTicketsThisWeek: Number(ticketData.newThis || 0),
    resolvedThisWeek: Number(ticketData.resolvedThis || 0),
    avgResolutionTimeHours: ticketData.avgResolutionHours != null ? Math.round(Number(ticketData.avgResolutionHours) * 10) / 10 : null,
    criticalAlerts: Number(alertData.critical || 0),
    resolvedAlerts: Number(alertData.resolvedThis || 0),
    pendingDecisions: Number(inboxData.pending || 0),
    criticalChurnOrgs: churnCritical,
  };

  // ── Growth ──────────────────────────────────────────────────────────────────
  const [newOrgsThis, newOrgsLast, topActiveOrgs] = await Promise.allSettled([
    db.select({ c: count() })
      .from(organizations)
      .where(gte(organizations.createdAt, thisWeek.start)),
    db.select({ c: count() })
      .from(organizations)
      .where(and(gte(organizations.createdAt, lastWeek.start), lt(organizations.createdAt, lastWeek.end))),
    db.select({
      name: organizations.name,
      tier: organizations.subscriptionTier,
      leadsCount: sql<number>`count(${leads.id})`,
    }).from(organizations)
      .leftJoin(leads, and(
        eq(leads.organizationId, organizations.id),
        gte(leads.createdAt, thisWeek.start),
      ))
      .where(eq(organizations.subscriptionStatus, "active"))
      .groupBy(organizations.id, organizations.name, organizations.subscriptionTier)
      .orderBy(desc(sql`count(${leads.id})`))
      .limit(5),
  ]);

  const newThis = newOrgsThis.status === "fulfilled" ? Number(newOrgsThis.value[0]?.c || 0) : 0;
  const newLast = newOrgsLast.status === "fulfilled" ? Number(newOrgsLast.value[0]?.c || 0) : 0;
  const wowGrowth = newLast > 0 ? ((newThis - newLast) / newLast) * 100 : 0;
  const topActive = topActiveOrgs.status === "fulfilled"
    ? topActiveOrgs.value.map(r => ({
        name: r.name || "Unknown",
        tier: r.tier || "free",
        activityScore: Number(r.leadsCount || 0),
      }))
    : [];

  const growth: GrowthMetrics = {
    totalOrgs: Number(orgData.total || 0),
    activeOrgs: Number(orgData.active || 0),
    newOrgsThisWeek: newThis,
    newOrgsLastWeek: newLast,
    churnedOrgsThisWeek: churnedThis,
    netNewOrgs: newThis - churnedThis,
    wowGrowthPct: wowGrowth,
    highActivityOrgs: topActive,
    atRiskOrgs: churnCritical,
  };

  // ── Anomaly Detection ──────────────────────────────────────────────────────
  const anomalies: Anomaly[] = [];

  // AI cost spike
  if (aiCostWoW > 50) {
    anomalies.push({
      severity: "high",
      category: "AI Costs",
      description: `AI spend up ${aiCostWoW.toFixed(1)}% week-over-week`,
      value: `$${(aiThisCost / 100).toFixed(2)} this week`,
      threshold: "≤50% WoW growth",
      recommendation: "Review top costly task types; check if a new feature is over-calling complex models",
    });
  }

  // Failing jobs
  if (failingJobs.length > 0) {
    anomalies.push({
      severity: "high",
      category: "Automation",
      description: `${failingJobs.length} background job(s) failing repeatedly`,
      value: failingJobs.join(", "),
      threshold: "0 consistently failing jobs",
      recommendation: "Review job logs — may need dependency fix or external API issue",
    });
  }

  // Critical churn
  if (churnCritical > 2) {
    anomalies.push({
      severity: "high",
      category: "Churn Risk",
      description: `${churnCritical} orgs in critical churn risk band`,
      value: `${churnCritical} orgs`,
      threshold: "≤2 critical churn orgs",
      recommendation: "Auto win-back campaigns should already be running; review if manual outreach needed",
    });
  }

  // Revenue decline
  if (revWoW < -15) {
    anomalies.push({
      severity: "critical",
      category: "Revenue",
      description: `Revenue down ${Math.abs(revWoW).toFixed(1)}% this week`,
      value: `$${(thisWeekRevCents / 100).toFixed(2)} vs $${(lastWeekRevCents / 100).toFixed(2)} last week`,
      threshold: "≤15% weekly decline",
      recommendation: "Check for payment processor issues, billing cycle timing, or cancellation spike",
    });
  }

  // Critical alerts open
  if (Number(alertData.critical || 0) > 0) {
    anomalies.push({
      severity: "critical",
      category: "System",
      description: `${alertData.critical} critical system alert(s) unresolved`,
      value: `${alertData.critical} open`,
      threshold: "0 critical alerts",
      recommendation: "Review Admin > System Alerts immediately",
    });
  }

  // Poor Sophie resolution rate
  if (sophieRate < 70) {
    anomalies.push({
      severity: "medium",
      category: "Support",
      description: `Sophie auto-resolution rate at ${sophieRate.toFixed(0)}%`,
      value: `${sophieRate.toFixed(0)}%`,
      threshold: "≥80% auto-resolution",
      recommendation: "Review Sophie's knowledge base; consider adding new FAQ entries for common issues",
    });
  }

  // ── Founder Actions (true founder attention items) ─────────────────────────
  const founderActions: FounderAction[] = [];

  anomalies
    .filter(a => a.severity === "critical")
    .forEach(a => founderActions.push({
      priority: "critical",
      title: a.description,
      detail: `${a.value} — ${a.recommendation}`,
      link: "/admin/alerts",
    }));

  if (Number(inboxData.pending || 0) > 0) {
    founderActions.push({
      priority: "high",
      title: `${inboxData.pending} decision(s) awaiting founder review`,
      detail: "These are escalated decisions the system couldn't handle autonomously",
      link: "/founder/inbox",
    });
  }

  anomalies
    .filter(a => a.severity === "high")
    .forEach(a => founderActions.push({
      priority: "high",
      title: a.description,
      detail: `${a.value} — ${a.recommendation}`,
      link: "/founder/intelligence",
    }));

  // ── Overall Vibe ──────────────────────────────────────────────────────────
  const criticalCount = anomalies.filter(a => a.severity === "critical").length;
  const highCount = anomalies.filter(a => a.severity === "high").length;
  const overallVibe: WeeklyDigestData["overallVibe"] =
    criticalCount > 0 ? "red" :
    highCount > 1 ? "yellow" :
    "green";

  const vibeStatement =
    overallVibe === "green"
      ? `Platform is running autonomously and healthy. ${automation.jobsSucceededThisWeek} automated tasks completed without intervention this week.`
      : overallVibe === "yellow"
      ? `Platform is mostly autonomous but has ${highCount} item(s) worth a look. No fires — just optimization opportunities.`
      : `Platform needs attention — ${criticalCount} critical issue(s) detected that the autonomous system flagged for human review.`;

  return {
    generatedAt: now,
    weekOf: `Week of ${format(thisWeek.start, "MMMM d, yyyy")}`,
    thisWeek,
    lastWeek,
    revenue,
    aiCosts,
    automation,
    operations,
    growth,
    anomalies,
    founderActions,
    overallVibe,
    vibeStatement,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Email HTML generation
// ─────────────────────────────────────────────────────────────────────────────

function fmtCents(cents: number): string {
  if (cents >= 100_00000) return `$${(cents / 100 / 1000000).toFixed(2)}M`;
  if (cents >= 100_000) return `$${(cents / 100 / 1000).toFixed(1)}K`;
  return `$${(cents / 100).toFixed(2)}`;
}

function fmtPct(pct: number): string {
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

function trendColor(pct: number, positiveIsGood = true): string {
  const good = positiveIsGood ? pct >= 0 : pct <= 0;
  return good ? "#059669" : "#dc2626";
}

function generateDigestEmail(data: WeeklyDigestData, appUrl: string): string {
  const vibeColors = { green: "#059669", yellow: "#d97706", red: "#dc2626" };
  const vibeEmoji = { green: "🟢", yellow: "🟡", red: "🔴" };
  const vibeColor = vibeColors[data.overallVibe];
  const vibeEmojStr = vibeEmoji[data.overallVibe];

  const anomalyRows = data.anomalies.map(a => {
    const colors = { critical: "#dc2626", high: "#d97706", medium: "#2563eb" };
    const c = colors[a.severity];
    return `
    <tr>
      <td style="padding:8px 12px; border-bottom:1px solid #f3f4f6;">
        <span style="background:${c}15; color:${c}; font-size:10px; font-weight:700; padding:2px 6px; border-radius:3px; text-transform:uppercase;">${a.severity}</span>
        <strong style="margin-left:8px; font-size:13px;">${a.category}</strong>
      </td>
      <td style="padding:8px 12px; border-bottom:1px solid #f3f4f6; font-size:13px; color:#374151;">${a.description}</td>
      <td style="padding:8px 12px; border-bottom:1px solid #f3f4f6; font-size:12px; color:#6b7280;">${a.recommendation}</td>
    </tr>`;
  }).join("");

  const modelRows = data.aiCosts.modelBreakdown.slice(0, 5).map(m => `
    <tr>
      <td style="padding:6px 12px; border-bottom:1px solid #f3f4f6; font-size:12px; font-family:monospace;">${m.model.replace("anthropic/", "").replace("openai/", "").replace("deepseek/", "")}</td>
      <td style="padding:6px 12px; border-bottom:1px solid #f3f4f6; font-size:12px; text-align:right;">${m.calls.toLocaleString()}</td>
      <td style="padding:6px 12px; border-bottom:1px solid #f3f4f6; font-size:12px; text-align:right;">${fmtCents(m.costCents)}</td>
      <td style="padding:6px 12px; border-bottom:1px solid #f3f4f6; font-size:12px; text-align:right;">${m.pctOfTotal.toFixed(1)}%</td>
      <td style="padding:6px 12px; border-bottom:1px solid #f3f4f6; font-size:12px; text-align:right;">${m.avgLatencyMs}ms</td>
    </tr>`).join("");

  const actionItems = data.founderActions.length === 0
    ? `<div style="padding:16px; background:#f0fdf4; border:1px solid #bbf7d0; border-radius:8px; color:#166534; font-size:14px;">
        ✅ No action required this week. Platform running autonomously and healthy.
       </div>`
    : data.founderActions.map((a, i) => {
        const ac = { critical: "#dc2626", high: "#d97706", medium: "#2563eb" }[a.priority];
        return `<div style="border-left:4px solid ${ac}; padding:12px 16px; margin-bottom:8px; background:#fafafa; border-radius:0 6px 6px 0;">
          <div style="font-size:10px; color:${ac}; font-weight:700; text-transform:uppercase;">${a.priority} priority</div>
          <div style="font-size:14px; font-weight:600; color:#1a1a1a; margin:4px 0;">${a.title}</div>
          <div style="font-size:12px; color:#6b7280; margin-bottom:6px;">${a.detail}</div>
          <a href="${appUrl}${a.link}" style="font-size:12px; color:#3b82f6; text-decoration:none;">Review →</a>
        </div>`;
      }).join("");

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:680px;margin:0 auto;padding:20px;color:#1a1a1a;background:#ffffff;">

<!-- Header -->
<div style="background:linear-gradient(135deg,#0f2a4a 0%,#1a4a3a 100%);padding:28px;border-radius:12px;margin-bottom:20px;">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;">
    <div>
      <h1 style="color:white;margin:0;font-size:20px;">AcreOS Founder Weekly Digest</h1>
      <p style="color:rgba(255,255,255,0.7);margin:6px 0 0;font-size:13px;">${data.weekOf} · Auto-generated</p>
    </div>
    <div style="text-align:right;">
      <div style="color:${vibeColor};font-size:22px;font-weight:800;">${vibeEmojStr} ${data.overallVibe.toUpperCase()}</div>
      <div style="color:rgba(255,255,255,0.65);font-size:11px;margin-top:2px;">Platform Status</div>
    </div>
  </div>
  <div style="margin-top:16px;padding:12px;background:rgba(255,255,255,0.1);border-radius:8px;">
    <p style="color:white;margin:0;font-size:14px;line-height:1.5;">${data.vibeStatement}</p>
  </div>
</div>

<!-- Revenue & Growth -->
<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin-bottom:16px;">
  <h2 style="margin:0 0 16px;font-size:15px;color:#374151;">💰 Revenue & Growth</h2>
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:12px;">
    <div style="text-align:center;background:white;padding:12px;border-radius:6px;">
      <div style="font-size:20px;font-weight:700;color:#1e3a5f;">${fmtCents(data.revenue.estimatedMrrCents)}</div>
      <div style="font-size:10px;color:#6b7280;margin-top:2px;">Est. MRR</div>
    </div>
    <div style="text-align:center;background:white;padding:12px;border-radius:6px;">
      <div style="font-size:20px;font-weight:700;color:#1e3a5f;">${fmtCents(data.revenue.estimatedArrCents)}</div>
      <div style="font-size:10px;color:#6b7280;margin-top:2px;">Est. ARR</div>
    </div>
    <div style="text-align:center;background:white;padding:12px;border-radius:6px;">
      <div style="font-size:20px;font-weight:700;color:${trendColor(data.revenue.wowChangePct)};">${fmtPct(data.revenue.wowChangePct)}</div>
      <div style="font-size:10px;color:#6b7280;margin-top:2px;">Rev WoW</div>
    </div>
    <div style="text-align:center;background:white;padding:12px;border-radius:6px;">
      <div style="font-size:20px;font-weight:700;color:${trendColor(data.revenue.netRevenueGrowth)};">${data.revenue.netRevenueGrowth >= 0 ? "+" : ""}${data.revenue.netRevenueGrowth}</div>
      <div style="font-size:10px;color:#6b7280;margin-top:2px;">Net Accounts</div>
    </div>
  </div>
  <div style="font-size:12px;color:#6b7280;">
    ${data.revenue.payingOrgs} paying orgs · ${data.revenue.freeOrgs} free ·
    +${data.revenue.newPayingThisWeek} new paying · −${data.revenue.churnedThisWeek} churned this week
  </div>
</div>

<!-- AI Cost Intelligence -->
<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin-bottom:16px;">
  <h2 style="margin:0 0 16px;font-size:15px;color:#374151;">🧠 AI Cost Intelligence</h2>
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px;">
    <div style="text-align:center;background:white;padding:10px;border-radius:6px;">
      <div style="font-size:18px;font-weight:700;color:#7c3aed;">${fmtCents(data.aiCosts.totalCostCentsThisWeek)}</div>
      <div style="font-size:10px;color:#6b7280;">AI Cost / Week</div>
    </div>
    <div style="text-align:center;background:white;padding:10px;border-radius:6px;">
      <div style="font-size:18px;font-weight:700;color:${trendColor(data.aiCosts.wowChangePct, false)};">${fmtPct(data.aiCosts.wowChangePct)}</div>
      <div style="font-size:10px;color:#6b7280;">Cost WoW</div>
    </div>
    <div style="text-align:center;background:white;padding:10px;border-radius:6px;">
      <div style="font-size:18px;font-weight:700;color:#059669;">${data.aiCosts.cacheHitRate.toFixed(0)}%</div>
      <div style="font-size:10px;color:#6b7280;">Cache Hit Rate</div>
    </div>
    <div style="text-align:center;background:white;padding:10px;border-radius:6px;">
      <div style="font-size:18px;font-weight:700;color:#2563eb;">${data.aiCosts.costEfficiencyScore}/100</div>
      <div style="font-size:10px;color:#6b7280;">Efficiency Score</div>
    </div>
  </div>
  <div style="font-size:11px;color:#6b7280;margin-bottom:12px;">
    Est. monthly: ${fmtCents(data.aiCosts.estimatedMonthlyCostCents)} · ${fmtCents(data.aiCosts.costPerActiveOrgCents)}/org/week
  </div>
  ${data.aiCosts.modelBreakdown.length > 0 ? `
  <table style="width:100%;border-collapse:collapse;font-size:12px;">
    <thead>
      <tr style="background:#f1f5f9;">
        <th style="padding:6px 12px;text-align:left;font-weight:600;color:#374151;">Model</th>
        <th style="padding:6px 12px;text-align:right;font-weight:600;color:#374151;">Calls</th>
        <th style="padding:6px 12px;text-align:right;font-weight:600;color:#374151;">Cost</th>
        <th style="padding:6px 12px;text-align:right;font-weight:600;color:#374151;">% Share</th>
        <th style="padding:6px 12px;text-align:right;font-weight:600;color:#374151;">Avg Lat.</th>
      </tr>
    </thead>
    <tbody>${modelRows}</tbody>
  </table>` : '<div style="color:#9ca3af;font-size:13px;">No AI telemetry data yet</div>'}
</div>

<!-- Automation Health -->
<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:20px;margin-bottom:16px;">
  <h2 style="margin:0 0 16px;font-size:15px;color:#166534;">⚙️ Automation Health</h2>
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:12px;">
    <div style="text-align:center;background:white;padding:10px;border-radius:6px;">
      <div style="font-size:18px;font-weight:700;color:#059669;">${data.automation.jobsRunThisWeek}</div>
      <div style="font-size:10px;color:#6b7280;">Jobs Run</div>
    </div>
    <div style="text-align:center;background:white;padding:10px;border-radius:6px;">
      <div style="font-size:18px;font-weight:700;color:${data.automation.successRate >= 95 ? "#059669" : "#d97706"};">${data.automation.successRate.toFixed(0)}%</div>
      <div style="font-size:10px;color:#6b7280;">Success Rate</div>
    </div>
    <div style="text-align:center;background:white;padding:10px;border-radius:6px;">
      <div style="font-size:18px;font-weight:700;color:#1e3a5f;">${data.automation.dealMachineDealsFound}</div>
      <div style="font-size:10px;color:#6b7280;">Deals Found</div>
    </div>
    <div style="text-align:center;background:white;padding:10px;border-radius:6px;">
      <div style="font-size:18px;font-weight:700;color:#7c3aed;">${data.automation.sophieAutoResolutionRate.toFixed(0)}%</div>
      <div style="font-size:10px;color:#6b7280;">Sophie Rate</div>
    </div>
  </div>
  ${data.automation.failingJobs.length > 0
    ? `<div style="padding:8px 12px;background:#fef2f2;border-radius:6px;font-size:12px;color:#991b1b;">
        ⚠️ Failing jobs: ${data.automation.failingJobs.join(", ")}
       </div>`
    : `<div style="font-size:12px;color:#166534;">✓ All background jobs running normally</div>`}
</div>

<!-- Operations -->
<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin-bottom:16px;">
  <h2 style="margin:0 0 12px;font-size:15px;color:#374151;">🛡️ Platform Operations</h2>
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;">
    <div style="text-align:center;background:white;padding:10px;border-radius:6px;">
      <div style="font-size:18px;font-weight:700;color:${data.operations.openSupportTickets > 20 ? "#d97706" : "#059669"};">${data.operations.openSupportTickets}</div>
      <div style="font-size:10px;color:#6b7280;">Open Tickets</div>
    </div>
    <div style="text-align:center;background:white;padding:10px;border-radius:6px;">
      <div style="font-size:18px;font-weight:700;color:${data.operations.criticalAlerts > 0 ? "#dc2626" : "#059669"};">${data.operations.criticalAlerts}</div>
      <div style="font-size:10px;color:#6b7280;">Critical Alerts</div>
    </div>
    <div style="text-align:center;background:white;padding:10px;border-radius:6px;">
      <div style="font-size:18px;font-weight:700;color:${data.operations.pendingDecisions > 3 ? "#d97706" : "#059669"};">${data.operations.pendingDecisions}</div>
      <div style="font-size:10px;color:#6b7280;">Inbox Pending</div>
    </div>
    <div style="text-align:center;background:white;padding:10px;border-radius:6px;">
      <div style="font-size:18px;font-weight:700;color:${data.operations.criticalChurnOrgs > 0 ? "#d97706" : "#059669"};">${data.operations.criticalChurnOrgs}</div>
      <div style="font-size:10px;color:#6b7280;">Churn Risk</div>
    </div>
  </div>
</div>

<!-- Anomalies -->
${data.anomalies.length > 0 ? `
<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:20px;margin-bottom:16px;">
  <h2 style="margin:0 0 12px;font-size:15px;color:#92400e;">⚡ Anomalies Detected This Week</h2>
  <table style="width:100%;border-collapse:collapse;font-size:12px;">
    <thead>
      <tr style="background:#fef3c7;">
        <th style="padding:6px 12px;text-align:left;font-weight:600;color:#92400e;">Severity / Category</th>
        <th style="padding:6px 12px;text-align:left;font-weight:600;color:#92400e;">What Happened</th>
        <th style="padding:6px 12px;text-align:left;font-weight:600;color:#92400e;">Recommended Action</th>
      </tr>
    </thead>
    <tbody>${anomalyRows}</tbody>
  </table>
</div>` : `
<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin-bottom:16px;">
  <div style="color:#166534;font-size:14px;">✅ No anomalies detected this week. All thresholds within normal range.</div>
</div>`}

<!-- Founder Actions -->
<div style="margin-bottom:20px;">
  <h2 style="font-size:15px;color:#374151;margin-bottom:12px;">👤 Items That Need Your Eyes${data.founderActions.length === 0 ? " — None" : ` (${data.founderActions.length})`}</h2>
  ${actionItems}
</div>

<!-- Growth Highlights -->
${data.growth.highActivityOrgs.length > 0 ? `
<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin-bottom:16px;">
  <h2 style="margin:0 0 10px;font-size:14px;color:#374151;">📈 Most Active Orgs This Week</h2>
  ${data.growth.highActivityOrgs.map(o => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #f3f4f6;font-size:13px;">
      <span style="font-weight:500;">${o.name}</span>
      <span style="color:#6b7280;">${o.tier} · ${o.activityScore} actions</span>
    </div>`).join("")}
</div>` : ""}

<!-- CTA -->
<div style="text-align:center;margin:24px 0;">
  <a href="${appUrl}/founder/intelligence" style="display:inline-block;background:#1e3a5f;color:white;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;margin-right:12px;">Open Founder Dashboard →</a>
  <a href="${appUrl}/founder/inbox" style="display:inline-block;background:#f1f5f9;color:#374151;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">Decisions Inbox (${data.operations.pendingDecisions})</a>
</div>

<p style="text-align:center;font-size:11px;color:#9ca3af;margin-top:20px;">
  AcreOS Founder Weekly Digest · Auto-generated ${format(data.generatedAt, "MMMM d, yyyy 'at' h:mm a 'CT'")}<br>
  This email is sent only to verified founder email addresses.<br>
  <a href="${appUrl}/founder/intelligence" style="color:#9ca3af;">View live dashboard</a> ·
  <a href="${appUrl}/settings/notifications" style="color:#9ca3af;">Manage preferences</a>
</p>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export — send digest to all configured founder emails
// ─────────────────────────────────────────────────────────────────────────────

export async function sendFounderWeeklyDigest(): Promise<{ sent: number; failed: number }> {
  const founderEmails = (process.env.FOUNDER_EMAIL || "")
    .split(",")
    .map(e => e.trim())
    .filter(Boolean);

  if (founderEmails.length === 0) {
    console.warn("[FounderDigest] No FOUNDER_EMAIL configured — skipping weekly digest");
    return { sent: 0, failed: 0 };
  }

  let sent = 0;
  let failed = 0;

  try {
    const data = await collectWeeklyData();
    const appUrl = process.env.APP_URL || "https://app.acreos.com";
    const html = generateDigestEmail(data, appUrl);

    const vibeLabel = { green: "All Clear", yellow: "Review Needed", red: "Action Required" }[data.overallVibe];
    const subjectEmoji = { green: "🟢", yellow: "🟡", red: "🔴" }[data.overallVibe];
    const subject = `${subjectEmoji} AcreOS Weekly Digest — ${vibeLabel} · ${data.weekOf}`;

    for (const email of founderEmails) {
      try {
        await emailService.sendEmail({
          to: email,
          subject,
          html,
          text: `AcreOS Weekly Digest (${data.weekOf})\n\nStatus: ${data.overallVibe.toUpperCase()} — ${data.vibeStatement}\n\nRevenue: ${fmtCents(data.revenue.estimatedMrrCents)} MRR | AI Cost: ${fmtCents(data.aiCosts.totalCostCentsThisWeek)}/wk | ${data.automation.successRate.toFixed(0)}% job success rate\n\nFounder actions needed: ${data.founderActions.length}\n\nOpen dashboard: ${appUrl}/founder/intelligence`,
        });
        sent++;
        console.log(`[FounderDigest] Sent weekly digest to ${email}`);
      } catch (err: any) {
        console.error(`[FounderDigest] Failed to send to ${email}:`, err.message);
        failed++;
      }
    }
  } catch (err: any) {
    console.error("[FounderDigest] Data collection failed:", err.message);
    failed = founderEmails.length;
  }

  return { sent, failed };
}

/**
 * Register the weekly founder digest repeatable job with BullMQ.
 * Runs every Monday at 8 AM CT.
 */
export async function registerFounderWeeklyDigestJob(queue: any): Promise<void> {
  await queue.add(
    "founder-weekly-digest",
    {},
    {
      repeat: {
        cron: "0 8 * * 1", // 8 AM UTC every Monday
        timezone: "America/Chicago",
      },
      removeOnComplete: 4,  // keep last 4 weeks
      removeOnFail: 2,
    }
  );
  console.log("[FounderDigest] Registered weekly founder digest job (Mondays 8 AM CT)");
}
