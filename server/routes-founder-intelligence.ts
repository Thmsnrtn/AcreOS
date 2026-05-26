/**
 * Founder Intelligence API
 *
 * The founder's command center for passive platform management.
 * Philosophy: The founder should be able to know everything critical
 * in a 5-minute daily scan — and ideally not need to look at all.
 *
 * Endpoints:
 * GET /api/founder/intelligence/pulse        — Daily health pulse (5-min scan)
 * GET /api/founder/intelligence/mrr          — MRR trends & forecasting
 * GET /api/founder/intelligence/churn        — Churn risk signals
 * GET /api/founder/intelligence/automation   — Automation health (what's running autonomously)
 * GET /api/founder/intelligence/growth       — Growth signals & opportunities
 * GET /api/founder/intelligence/ai-cost      — AI cost efficiency tracking
 * POST /api/founder/intelligence/digest      — Generate daily AI digest email for founder
 */

import { Router, type Request, type Response } from "express";
import type { AuthenticatedRequest } from "./types/request";
import { Errors } from "./utils/errors";
import { db } from "./db";
import { dbForReads } from "./db-replica";
import {
  organizations, users, payments, deals, leads, properties,
  supportTickets, subscriptionEvents, systemAlerts, activityLog,
  notes, campaigns, apiUsageLogs,
  decisionsInboxItems, jobHealthLogs, churnRiskScores, revenueProtectionInterventions,
  founderDigestHistory, companyAgents, agentMessages, companyBriefingCache,
  agentConversations, agentActionLog, agentGoals, trustEvolutionLog,
  agentActionUndoLog,
} from "@shared/schema";
import { sql, desc, eq, and, gte, lte, lt, count, sum, avg, ne, isNull } from "drizzle-orm";
import { isFounderEmail } from "./services/founder";
import { decisionsInboxService } from "./services/decisionsInbox";
import { founderDigestService } from "./services/founderDigest";
import { companyAgentService } from "./services/companyAgents";
import { agentCommsService } from "./services/agentComms";
import { routeAITask, TaskComplexity } from "./services/aiRouter";
import { resolveAgentData } from "./services/agentDataResolvers";
import { executeUndo } from "./services/undoRegistry";
import { getWeeklyTrends, getMonthlyTrends } from "./services/trendAnalyzer";
import { getActivePriorities, createPriority, deactivatePriority } from "./services/strategicCompass";
import { getQuietHoursConfig, setQuietHours } from "./services/quietHours";
import { learnFromOverride } from "./services/overrideLearner";
import { generateBriefingUpdates, generateHeadlineInsight } from "./services/aiBriefingWriter";
import { logger } from "./utils/logger";
import { addMonths } from "./utils/dateUtils";

const router = Router();

// ── Auth guard ─────────────────────────────────────────────────────────────

function requireFounder(req: any, res: any, next: any) {
  const userEmail = req.user?.email || req.user?.email;
  if (!isFounderEmail(userEmail)) {
    return Errors.forbidden(res, "Founder access required");
  }
  next();
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/founder/intelligence/morning-briefing — v3 Conversational Briefing
//
// The CEO's one-screen morning summary. Each agent "speaks" their update
// in character. Consolidates the 3 competing digest systems into one voice.
// ─────────────────────────────────────────────────────────────────────────────

router.get("/morning-briefing", requireFounder, async (req: Request, res: Response) => {
  try {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const hour = now.getHours();

    // Greeting based on time of day
    const timeGreeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

    // ── Gather data from all agent resolvers in parallel ──────────────
    const [
      forgeData,
      sentinelData,
      sophieData,
      oracleData,
      ledgerData,
    ] = await Promise.all([
      resolveAgentData("forge_revenue").catch(() => ({})),
      resolveAgentData("sentinel_devops").catch(() => ({})),
      resolveAgentData("sophie_csm").catch(() => ({})),
      resolveAgentData("oracle_analytics").catch(() => ({})),
      resolveAgentData("ledger_finance").catch(() => ({})),
    ]);

    // ── Count pending decisions ────────────────────────────────────────
    const dailyReader = await dbForReads("founder.intelligence.daily");
    const pendingResult = await dailyReader.select({ c: count() })
      .from(decisionsInboxItems)
      .where(eq(decisionsInboxItems.status, "pending"));
    const pendingDecisions = Number(pendingResult[0]?.c || 0);

    // ── Get recent agent actions (last 24h) ───────────────────────────
    const recentActions = await dailyReader.select({
      agentCodename: agentActionLog.agentCodename,
      total: count(),
      succeeded: sql<number>`count(*) filter (where outcome = 'success')`,
    })
      .from(agentActionLog)
      .where(gte(agentActionLog.createdAt, yesterday))
      .groupBy(agentActionLog.agentCodename);

    const actionsByAgent = Object.fromEntries(
      recentActions.map(a => [a.agentCodename, { total: Number(a.total), succeeded: Number(a.succeeded) }])
    );

    // ── Get trust changes ─────────────────────────────────────────────
    const trustChanges = await dailyReader.select()
      .from(trustEvolutionLog)
      .where(and(
        gte(trustEvolutionLog.createdAt, yesterday),
        sql`${trustEvolutionLog.promotionSuggested} = true`,
      ))
      .orderBy(desc(trustEvolutionLog.createdAt))
      .limit(3);

    // ── Build agent-voiced updates (v5: AI-generated with template fallback) ──
    const agents = await companyAgentService.getAllIncludingPaused();
    let agentUpdates: any[];

    try {
      // v5: Use AI to generate agent briefings in their authentic voice
      const briefingInputs = agents
        .filter(a => ["forge_revenue", "sentinel_devops", "sophie_csm", "oracle_analytics", "ledger_finance"].includes(a.codename))
        .map(a => ({
          codename: a.codename,
          title: a.title,
          role: a.title,
          personalityPrompt: a.personalityPrompt || "",
          metrics: {
            forge_revenue: forgeData,
            sentinel_devops: sentinelData,
            sophie_csm: sophieData,
            oracle_analytics: oracleData,
            ledger_finance: ledgerData,
          }[a.codename] || {},
          recentActions: actionsByAgent[a.codename] || { total: 0, succeeded: 0 },
          trustScore: a.trustScore,
        }));
      agentUpdates = await generateBriefingUpdates(briefingInputs);
    } catch {
      // Fallback: template strings (v3 style)
      agentUpdates = [];
      const mrrDollars = ((forgeData as any).mrrCents || 0) / 100;
      const mrrGrowth = (forgeData as any).mrrGrowthPct;
      const atRisk = (forgeData as any).criticalChurnOrgs || 0;
      const forgeActions = actionsByAgent["forge_revenue"];
      let forgeMsg = mrrDollars > 0 ? `MRR is $${mrrDollars.toLocaleString()}` : "Revenue data loading";
      if (mrrGrowth) { forgeMsg += `, ${mrrGrowth > 0 ? "up" : "down"} ${Math.abs(mrrGrowth).toFixed(1)}%`; }
      forgeMsg += ". ";
      if (atRisk > 0) { forgeMsg += `${atRisk} account${atRisk > 1 ? "s" : ""} at churn risk.`; }
      else { forgeMsg += "No accounts at risk."; }
      agentUpdates.push({ agent: "forge_revenue", role: "Revenue Lead", message: forgeMsg, hasActivity: !!forgeActions?.total });

      const jobsHealthy = (sentinelData as any).healthyJobs || 0;
      const jobsFailed = (sentinelData as any).failedJobs || 0;
      agentUpdates.push({ agent: "sentinel_devops", role: "Infrastructure", message: jobsFailed === 0 ? `All ${jobsHealthy} jobs healthy.` : `${jobsFailed} job issues detected.`, hasActivity: !!actionsByAgent["sentinel_devops"]?.total });

      const ticketsOpen = (sophieData as any).openTickets || 0;
      agentUpdates.push({ agent: "sophie_csm", role: "Customer Success", message: ticketsOpen > 0 ? `${ticketsOpen} open tickets.` : "Support inbox clear.", hasActivity: !!actionsByAgent["sophie_csm"]?.total });

      agentUpdates.push({ agent: "oracle_analytics", role: "Analytics", message: "Metrics trending normally.", hasActivity: false });
      agentUpdates.push({ agent: "ledger_finance", role: "Finance", message: "Financials on track.", hasActivity: false });
    }

    // ── Build trust change messages ───────────────────────────────────
    const agentNames = Object.fromEntries(agents.map(a => [a.codename, a.title]));

    const trustUpdates = trustChanges.map(tc => {
      const name = agentNames[tc.agentCodename] || tc.agentCodename;
      if (tc.promotionAction?.includes("Level 0")) {
        return { agent: tc.agentCodename, message: `${name} has been flawless. Ready to let them handle everything independently?` };
      }
      return { agent: tc.agentCodename, message: `${name} is ready for more responsibility. Promote them?` };
    });

    // ── Determine headline (v5: AI-generated with fallback) ─────────
    const mrrDollars = ((forgeData as any).mrrCents || 0) / 100;
    const atRisk = (forgeData as any).criticalChurnOrgs || 0;
    const totalActions = Object.values(actionsByAgent).reduce((sum: number, a: any) => sum + (a.total || 0), 0);
    let headline: string;
    try {
      headline = await generateHeadlineInsight({ mrrDollars, pendingDecisions, totalAgentActions: totalActions, atRiskAccounts: atRisk });
    } catch {
      // Fallback
      const allClear = pendingDecisions === 0;
      headline = allClear ? "Your company is running smoothly." : `${pendingDecisions} decision${pendingDecisions > 1 ? "s" : ""} need your attention.`;
    }
    const jobsFailed = (sentinelData as any).failedJobs || 0;
    const allClear = pendingDecisions === 0 && jobsFailed === 0 && atRisk === 0;

    // ── Compute company health score (0-100) ──────────────────────────
    const ticketsOpen = (sophieData as any).openTickets || 0;
    let healthScore = 100;
    if (jobsFailed > 0) healthScore -= 10 * Math.min(jobsFailed, 3);
    if (atRisk > 0) healthScore -= 5 * Math.min(atRisk, 4);
    if (pendingDecisions > 3) healthScore -= 10;
    if (ticketsOpen > 5) healthScore -= 5;
    healthScore = Math.max(0, healthScore);

    // ── Full 12-agent activity roll-up ────────────────────────────────
    // The primary agentUpdates[] above only covers the 5 agents the
    // AI-voiced briefing speaks for. But the company has 12 agents,
    // and a silent agent could mean "nothing to do" (fine) or
    // "broken" (not fine). Surface all 12 so the founder can see who
    // worked and who didn't.
    const fullAgentActivity = agents.map((a) => {
      const actions = actionsByAgent[a.codename];
      return {
        codename: a.codename,
        title: a.title,
        wing: (a as any).wing ?? null,
        trustScore: a.trustScore,
        status: a.status,
        actionsToday: actions?.total ?? 0,
        actionsSucceeded: actions?.succeeded ?? 0,
        silent: !actions || actions.total === 0,
      };
    });

    // ── Budget health roll-up ────────────────────────────────────────
    // Layperson summary: how much has the system spent this month,
    // any agents near their cap, any unreviewed spend anomalies.
    let budgetHealth: {
      totalSpentCents: number;
      totalBudgetCents: number;
      utilizationPct: number;
      nearCap: Array<{ agentCodename: string; utilizationPct: number }>;
      pendingAnomalies: number;
      hardCapCents: number;
    } | null = null;
    try {
      const { financialAuthorityGate } = await import("./services/financialAuthorityGate");
      const summary = await financialAuthorityGate.getBudgetSummary();
      const totalBudgetCents = summary.envelopes.reduce((s, e) => s + e.budgetCents, 0);
      const totalSpentCents = summary.envelopes.reduce((s, e) => s + e.spentCents, 0);
      budgetHealth = {
        totalSpentCents,
        totalBudgetCents,
        utilizationPct: totalBudgetCents > 0 ? Math.round((totalSpentCents / totalBudgetCents) * 100) : 0,
        nearCap: summary.envelopes
          .filter((e) => e.warningLevel !== "ok")
          .map((e) => ({ agentCodename: e.agentCodename, utilizationPct: e.utilizationPct })),
        pendingAnomalies: summary.pendingAnomalies,
        hardCapCents: summary.hardCapCents,
      };
    } catch {
      /* budget rollup non-fatal — briefing still ships */
    }

    res.json({
      greeting: `${timeGreeting}, Thomas.`,
      headline,
      healthScore,
      allClear,
      agentUpdates,
      fullAgentActivity,
      budgetHealth,
      pendingDecisions,
      trustUpdates,
      generatedAt: now.toISOString(),
    });
  } catch (err: any) {
    logger.error("[MorningBriefing] Error", err);
    Errors.internal(res, err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/founder/intelligence/pulse
// The 5-minute daily scan — everything critical in one response
// ─────────────────────────────────────────────────────────────────────────────

router.get("/pulse", requireFounder, async (req: Request, res: Response) => {
  try {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 86400000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);

    // Pillar 8.6 — route the pulse aggregation block to the read replica.
    const reader = await dbForReads("founder.intelligence.pulse");

    const [
      orgStats,
      revenueToday,
      revenueLast7d,
      revenueLast30d,
      newOrgsToday,
      newOrgsLast7d,
      cancelledLast7d,
      openTickets,
      criticalAlerts,
      aiCostLast7d,
      activeAutomations,
      topGrowthOrgs,
    ] = await Promise.allSettled([
      // Org stats
      reader.select({
        total: count(),
        active: sql<number>`count(*) filter (where subscription_status = 'active')`,
        paying: sql<number>`count(*) filter (where subscription_tier not in ('free') and subscription_status = 'active')`,
      }).from(organizations),

      // Revenue today
      reader.select({ total: sum(payments.amount) })
        .from(payments)
        .where(gte(payments.createdAt, yesterday)),

      // Revenue last 7d
      reader.select({ total: sum(payments.amount) })
        .from(payments)
        .where(gte(payments.createdAt, sevenDaysAgo)),

      // Revenue last 30d
      reader.select({ total: sum(payments.amount) })
        .from(payments)
        .where(gte(payments.createdAt, thirtyDaysAgo)),

      // New orgs today
      reader.select({ count: count() })
        .from(organizations)
        .where(gte(organizations.createdAt, yesterday)),

      // New orgs last 7d
      reader.select({ count: count() })
        .from(organizations)
        .where(gte(organizations.createdAt, sevenDaysAgo)),

      // Cancellations last 7d
      reader.select({ count: count() })
        .from(subscriptionEvents)
        .where(
          and(
            eq(subscriptionEvents.eventType, "subscription_cancelled"),
            gte(subscriptionEvents.createdAt, sevenDaysAgo)
          )
        ),

      // Open support tickets
      reader.select({ count: count() })
        .from(supportTickets)
        .where(eq(supportTickets.status, "open")),

      // Critical alerts
      reader.select({ count: count() })
        .from(systemAlerts)
        .where(
          and(
            eq(systemAlerts.severity, "critical"),
            eq(systemAlerts.status, "open")
          )
        ),

      // AI cost last 7d
      reader.select({ total: sum(apiUsageLogs.estimatedCostCents) })
        .from(apiUsageLogs)
        .where(gte(apiUsageLogs.createdAt, sevenDaysAgo)),

      // Count of active automated jobs (by checking recent activity)
      reader.select({ count: count() })
        .from(activityLog)
        .where(
          and(
            gte(activityLog.createdAt, sevenDaysAgo),
            sql`metadata->>'automated' = 'true'`
          )
        ),

      // Top growth orgs (most active this week)
      reader.select({
        id: organizations.id,
        name: organizations.name,
        tier: organizations.subscriptionTier,
        activityCount: count(activityLog.id),
      })
        .from(organizations)
        .leftJoin(activityLog, and(
          eq(activityLog.organizationId, organizations.id),
          gte(activityLog.createdAt, sevenDaysAgo)
        ))
        .groupBy(organizations.id, organizations.name, organizations.subscriptionTier)
        .orderBy(desc(count(activityLog.id)))
        .limit(5),
    ]);

    const orgData = orgStats.status === "fulfilled" ? orgStats.value[0] : { total: 0, active: 0, paying: 0 };
    const todayRev = revenueToday.status === "fulfilled" ? Number(revenueToday.value[0]?.total || 0) : 0;
    const last7dRev = revenueLast7d.status === "fulfilled" ? Number(revenueLast7d.value[0]?.total || 0) : 0;
    const last30dRev = revenueLast30d.status === "fulfilled" ? Number(revenueLast30d.value[0]?.total || 0) : 0;
    const newToday = newOrgsToday.status === "fulfilled" ? Number(newOrgsToday.value[0]?.count || 0) : 0;
    const newLast7d = newOrgsLast7d.status === "fulfilled" ? Number(newOrgsLast7d.value[0]?.count || 0) : 0;
    const cancels7d = cancelledLast7d.status === "fulfilled" ? Number(cancelledLast7d.value[0]?.count || 0) : 0;
    const openTicketCount = openTickets.status === "fulfilled" ? Number(openTickets.value[0]?.count || 0) : 0;
    const criticalAlertCount = criticalAlerts.status === "fulfilled" ? Number(criticalAlerts.value[0]?.count || 0) : 0;
    const aiCost7d = aiCostLast7d.status === "fulfilled" ? Number(aiCostLast7d.value[0]?.total || 0) : 0;
    const automationCount = activeAutomations.status === "fulfilled" ? Number(activeAutomations.value[0]?.count || 0) : 0;
    const growthOrgs = topGrowthOrgs.status === "fulfilled" ? topGrowthOrgs.value : [];

    // Calculate MRR estimate (recurring subscription revenue)
    // Simplified: paying orgs × avg revenue per org
    const estimatedMrr = last30dRev; // Payments in last 30d as proxy for MRR

    // Net new this week (signups - cancels)
    const netNew7d = newLast7d - cancels7d;

    // Platform health score (0-100)
    let healthScore = 100;
    if (criticalAlertCount > 0) healthScore -= criticalAlertCount * 10;
    if (openTicketCount > 20) healthScore -= 5;
    if (cancels7d > newLast7d) healthScore -= 15; // Losing more than gaining
    healthScore = Math.max(0, Math.min(100, healthScore));

    // Founder attention items (things that actually need eyes on)
    const attentionItems: Array<{ priority: "critical" | "high" | "medium"; item: string; action: string }> = [];

    if (criticalAlertCount > 0) {
      attentionItems.push({
        priority: "critical",
        item: `${criticalAlertCount} critical system alert(s) open`,
        action: "Review and resolve in Admin > Alerts",
      });
    }
    if (openTicketCount > 10) {
      attentionItems.push({
        priority: "high",
        item: `${openTicketCount} support tickets open (Sophie may need help)`,
        action: "Review escalations in Founder Dashboard > Support",
      });
    }
    if (cancels7d > 3) {
      attentionItems.push({
        priority: "high",
        item: `${cancels7d} cancellations this week`,
        action: "Review exit reasons and consider outreach",
      });
    }
    if (aiCost7d > 5000) { // $50 in AI costs = worth reviewing
      attentionItems.push({
        priority: "medium",
        item: `$${(aiCost7d / 100).toFixed(2)} in AI costs last 7 days`,
        action: "Review AI cost breakdown in Founder Dashboard > AI Costs",
      });
    }

    // ── Traffic light computations for ThePulse component ──────────────────
    const pendingInboxItems = await reader.select({ c: count() })
      .from(decisionsInboxItems)
      .where(eq(decisionsInboxItems.status, "pending"));
    const pendingInboxCount = Number(pendingInboxItems[0]?.c ?? 0);

    // Job health: count unhealthy jobs
    const recentJobFailures = await reader.select({ jobName: jobHealthLogs.jobName })
      .from(jobHealthLogs)
      .where(and(eq(jobHealthLogs.status, "failed"), gte(jobHealthLogs.runStartedAt, sevenDaysAgo)));
    const failingJobNames = new Set(recentJobFailures.map((r: any) => r.jobName));

    // Sophie auto-resolution rate (last 7d)
    const sophieResolved7d = await reader.select({ c: count() })
      .from(supportTickets)
      .where(and(
        sql`${supportTickets.resolvedAt} IS NOT NULL`,
        gte(supportTickets.resolvedAt, sevenDaysAgo),
        eq(supportTickets.assignedAgent, "sophie"),
      ));
    const totalResolved7d = await reader.select({ c: count() })
      .from(supportTickets)
      .where(and(
        sql`${supportTickets.resolvedAt} IS NOT NULL`,
        gte(supportTickets.resolvedAt, sevenDaysAgo),
      ));
    const sophieResolvedCount = Number(sophieResolved7d[0]?.c ?? 0);
    const totalResolvedCount = Number(totalResolved7d[0]?.c ?? 1);
    const sophieAutoResolutionRate = totalResolvedCount > 0 ? (sophieResolvedCount / totalResolvedCount) * 100 : 100;

    // Churn: orgs in red/critical band
    const criticalChurnOrgs = await reader.select({ c: count() })
      .from(churnRiskScores)
      .where(sql`${churnRiskScores.riskBand} IN ('red', 'critical')`);
    const criticalChurnCount = Number(criticalChurnOrgs[0]?.c ?? 0);

    // Dunning restricted+ orgs
    const restrictedOrgs = await reader.select({ c: count() })
      .from(organizations)
      .where(sql`${organizations.dunningStage} IN ('restricted', 'suspended')`);
    const restrictedCount = Number(restrictedOrgs[0]?.c ?? 0);

    const pulseStatus = {
      revenueHealth: {
        green: netNew7d >= 0 && restrictedCount === 0,
        label: netNew7d >= 0 && restrictedCount === 0 ? "Healthy" : "Attention",
        detail: `Net ${netNew7d >= 0 ? "+" : ""}${netNew7d} orgs this week${restrictedCount > 0 ? `, ${restrictedCount} restricted` : ""}`,
      },
      systemHealth: {
        green: criticalAlertCount === 0 && failingJobNames.size === 0,
        label: criticalAlertCount === 0 && failingJobNames.size === 0 ? "All Clear" : "Issues Detected",
        detail: `${criticalAlertCount} critical alerts, ${failingJobNames.size} failing jobs`,
      },
      sophieHealth: {
        green: sophieAutoResolutionRate >= 80 && pendingInboxCount <= 3,
        label: sophieAutoResolutionRate >= 80 && pendingInboxCount <= 3 ? "Operating Well" : "Needs Review",
        detail: `${Math.round(sophieAutoResolutionRate)}% auto-resolution rate, ${pendingInboxCount} inbox items`,
      },
      churnRisk: {
        green: criticalChurnCount === 0,
        label: criticalChurnCount === 0 ? "Low Risk" : `${criticalChurnCount} At Risk`,
        detail: `${criticalChurnCount} org(s) in red/critical churn band`,
      },
      allClear: criticalAlertCount === 0 && pendingInboxCount === 0 && failingJobNames.size === 0 && criticalChurnCount === 0,
      decisionsInboxCount: pendingInboxCount,
    };

    res.json({
      generatedAt: new Date().toISOString(),
      pulseStatus,
      platformHealth: {
        score: healthScore,
        status: healthScore >= 90 ? "excellent" : healthScore >= 70 ? "good" : healthScore >= 50 ? "fair" : "needs_attention",
        totalOrgs: Number(orgData.total || 0),
        activeOrgs: Number(orgData.active || 0),
        payingOrgs: Number(orgData.paying || 0),
      },
      revenue: {
        todayCents: todayRev,
        last7dCents: last7dRev,
        last30dCents: last30dRev,
        estimatedMrrCents: estimatedMrr,
        // Annualized run rate
        arrCents: estimatedMrr * 12,
      },
      growth: {
        newOrgsToday: newToday,
        newOrgsLast7d: newLast7d,
        cancellationsLast7d: cancels7d,
        netNewLast7d: netNew7d,
        netGrowthPositive: netNew7d > 0,
        topActiveOrgs: growthOrgs,
      },
      operations: {
        openSupportTickets: openTicketCount,
        criticalAlerts: criticalAlertCount,
        automatedActionsLast7d: automationCount,
        aiCostLast7dCents: aiCost7d,
        // Passive score: 0-100, how passive is this platform running?
        passiveScore: calculatePassiveScore(criticalAlertCount, openTicketCount, automationCount),
      },
      attentionItems,
      dailyVibe: attentionItems.length === 0
        ? "🟢 Platform running passively — no action required today."
        : attentionItems[0].priority === "critical"
        ? "🔴 Critical items need your attention."
        : "🟡 A few items worth reviewing when you have time.",
    });
  } catch (err: any) {
    logger.error("[FounderIntelligence] Pulse error", undefined, { metadata: { detail: err.message } });
    res.json({
      pulseStatus: { allClear: true, revenueHealth: { green: true }, systemHealth: { green: true }, churnRisk: { green: true } },
      summary: "Pulse data temporarily unavailable",
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/founder/intelligence/mrr
// MRR trends, cohort retention, forecast
// ─────────────────────────────────────────────────────────────────────────────

router.get("/mrr", requireFounder, async (req: Request, res: Response) => {
  try {
    const months = parseInt(req.query.months as string) || 12;
    const mrrByMonth: Array<{ month: string; revenueCents: number; newOrgs: number; churned: number; net: number }> = [];

    // Pillar 8.6 — MRR roll-up is pure analytics, route to replica.
    const reader = await dbForReads("founder.intelligence.mrr");

    for (let i = months - 1; i >= 0; i--) {
      const start = addMonths(new Date(), -i);
      start.setDate(1);
      start.setHours(0, 0, 0, 0);

      const end = addMonths(new Date(start), 1);

      const [revResult, newOrgsResult, churnResult] = await Promise.all([
        reader.select({ total: sum(payments.amount) })
          .from(payments)
          .where(and(gte(payments.createdAt, start), lt(payments.createdAt, end))),
        reader.select({ count: count() })
          .from(organizations)
          .where(and(gte(organizations.createdAt, start), lt(organizations.createdAt, end))),
        reader.select({ count: count() })
          .from(subscriptionEvents)
          .where(and(
            eq(subscriptionEvents.eventType, "subscription_cancelled"),
            gte(subscriptionEvents.createdAt, start),
            lt(subscriptionEvents.createdAt, end)
          )),
      ]);

      const revenue = Number(revResult[0]?.total || 0);
      const newOrgs = Number(newOrgsResult[0]?.count || 0);
      const churned = Number(churnResult[0]?.count || 0);

      mrrByMonth.push({
        month: start.toISOString().slice(0, 7),
        revenueCents: revenue,
        newOrgs,
        churned,
        net: newOrgs - churned,
      });
    }

    // Simple linear regression forecast for next 3 months
    const revenues = mrrByMonth.map(m => m.revenueCents);
    const forecast = forecastLinear(revenues, 3);

    // Month-over-month growth
    const lastMonth = mrrByMonth[mrrByMonth.length - 1]?.revenueCents || 0;
    const prevMonth = mrrByMonth[mrrByMonth.length - 2]?.revenueCents || 0;
    const momGrowth = prevMonth > 0 ? ((lastMonth - prevMonth) / prevMonth) * 100 : 0;

    res.json({
      history: mrrByMonth,
      forecast: forecast.map((v, i) => ({
        month: getFutureMonth(i + 1),
        projectedRevenueCents: Math.max(0, Math.round(v)),
        confidence: Math.max(0.3, 0.9 - i * 0.15), // Decreasing confidence over time
      })),
      summary: {
        currentMrrCents: lastMonth,
        prevMrrCents: prevMonth,
        momGrowthPct: momGrowth,
        arrCents: lastMonth * 12,
        totalRevenueAllTimeCents: revenues.reduce((a, b) => a + b, 0),
      },
    });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/founder/intelligence/automation
// What's running autonomously — the platform's "passive engine"
// ─────────────────────────────────────────────────────────────────────────────

router.get("/automation", requireFounder, async (req: Request, res: Response) => {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
    const oneDayAgo = new Date(Date.now() - 86400000);

    // Pillar 8.6 — automation roll-up is pure analytics, route to replica.
    const reader = await dbForReads("founder.intelligence.automation");

    // Check automation activity by querying activity logs for automated events
    const [
      leadNurturerActivity,
      campaignActivity,
      scoreActivity,
      sophieActivity,
      enrichmentActivity,
      sentinelActivity,
      workflowActivity,
      dealProgressionActivity,
    ] = await Promise.allSettled([
      reader.select({ count: count() }).from(activityLog)
        .where(and(
          gte(activityLog.createdAt, sevenDaysAgo),
          sql`action = 'lead_nurtured' or action = 'follow_up_sent'`
        )),
      reader.select({ count: count() }).from(activityLog)
        .where(and(
          gte(activityLog.createdAt, sevenDaysAgo),
          sql`action like 'campaign_%'`
        )),
      reader.select({ count: count() }).from(activityLog)
        .where(and(
          gte(activityLog.createdAt, sevenDaysAgo),
          sql`action = 'lead_scored' or action = 'score_updated'`
        )),
      reader.select({ count: count() }).from(supportTickets)
        .where(and(
          gte(supportTickets.createdAt, sevenDaysAgo),
          eq(supportTickets.aiHandled, true)
        )),
      reader.select({ count: count() }).from(activityLog)
        .where(and(
          gte(activityLog.createdAt, sevenDaysAgo),
          sql`action like 'enrich%'`
        )),
      reader.select({ count: count() }).from(activityLog)
        .where(and(
          gte(activityLog.createdAt, sevenDaysAgo),
          sql`action like 'sentinel%' or action like 'portfolio_monitor%'`
        )),
      reader.select({ count: count() }).from(activityLog)
        .where(and(
          gte(activityLog.createdAt, sevenDaysAgo),
          sql`action like 'workflow_%' or action like 'automation_%'`
        )),
      reader.select({ count: count() }).from(activityLog)
        .where(and(
          gte(activityLog.createdAt, sevenDaysAgo),
          sql`action like 'deal_%' or action like 'offer_%'`
        )),
    ]);

    // Check credential health to factor into score (missing creds = lower automation capability)
    const env = process.env;
    const hasAI = !!(env.AI_INTEGRATIONS_OPENROUTER_API_KEY || env.OPENAI_API_KEY);
    const hasEmail = !!(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY);
    const hasStripe = !!(env.STRIPE_SECRET_KEY);
    const hasMaps = !!(env.VITE_MAPBOX_ACCESS_TOKEN || env.MAPBOX_PUBLIC_TOKEN);
    const hasDirectMail = !!(env.LOB_API_KEY);
    const hasSMS = !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN);
    const hasRedis = !!(env.REDIS_URL);

    // Credential penalties — services can't be "active" without creds
    const credScore = (
      (hasAI ? 25 : 0) +
      (hasEmail ? 20 : 0) +
      (hasStripe ? 15 : 0) +
      (hasMaps ? 10 : 0) +
      (hasDirectMail ? 10 : 0) +
      (hasSMS ? 10 : 0) +
      (hasRedis ? 10 : 0)
    ); // max 100

    // Open decisions: founder manual action needed reduces passive score
    const openDecisions = await reader.select({ count: count() }).from(decisionsInboxItems)
      .where(eq(decisionsInboxItems.status, "pending"))
      .catch(() => [{ count: 0 }]);
    const pendingDecisions = Number(openDecisions[0]?.count || 0);

    // Job failures reduce score
    const recentJobFailures = await reader.select({ count: count() }).from(jobHealthLogs)
      .where(and(
        gte(jobHealthLogs.runStartedAt, oneDayAgo),
        eq(jobHealthLogs.status, "failed")
      )).catch(() => [{ count: 0 }]);
    const jobFailures = Number(recentJobFailures[0]?.count || 0);

    function derivePassiveScore(actionsLast7d: number, credActive: boolean, weight: number): number {
      if (!credActive) return 30; // Creds missing — cannot be truly passive
      const activityBonus = Math.min(30, actionsLast7d > 0 ? Math.log10(actionsLast7d + 1) * 15 : 0);
      return Math.round(Math.min(100, 70 + activityBonus)); // floor 70 if creds present, up to 100
    }

    const automationStatus = [
      {
        name: "Lead Nurturer",
        description: "Follows up with seller leads automatically based on behavior and timeline",
        actionsLast7d: leadNurturerActivity.status === "fulfilled" ? Number(leadNurturerActivity.value[0]?.count || 0) : 0,
        status: hasAI && hasEmail ? "active" : "degraded",
        icon: "users",
        passiveScore: derivePassiveScore(
          leadNurturerActivity.status === "fulfilled" ? Number(leadNurturerActivity.value[0]?.count || 0) : 0,
          hasAI && hasEmail, 1),
        note: (!hasAI || !hasEmail) ? "Requires AI + email credentials" : undefined,
      },
      {
        name: "Campaign Engine",
        description: "Deploys email, SMS, and direct mail campaigns on schedule",
        actionsLast7d: campaignActivity.status === "fulfilled" ? Number(campaignActivity.value[0]?.count || 0) : 0,
        status: hasEmail || hasSMS || hasDirectMail ? "active" : "degraded",
        icon: "target",
        passiveScore: derivePassiveScore(
          campaignActivity.status === "fulfilled" ? Number(campaignActivity.value[0]?.count || 0) : 0,
          hasEmail || hasSMS || hasDirectMail, 1),
        note: (!hasEmail && !hasSMS && !hasDirectMail) ? "Configure email, SMS, or direct mail" : undefined,
      },
      {
        name: "AcreScore Engine",
        description: "Scores and ranks seller leads by investment opportunity automatically",
        actionsLast7d: scoreActivity.status === "fulfilled" ? Number(scoreActivity.value[0]?.count || 0) : 0,
        status: hasAI ? "active" : "degraded",
        icon: "zap",
        passiveScore: derivePassiveScore(
          scoreActivity.status === "fulfilled" ? Number(scoreActivity.value[0]?.count || 0) : 0,
          hasAI, 1),
        note: !hasAI ? "Requires AI credentials (OpenRouter)" : undefined,
      },
      {
        name: "Sophie AI Support",
        description: "Handles support tickets and user onboarding without human intervention",
        actionsLast7d: sophieActivity.status === "fulfilled" ? Number(sophieActivity.value[0]?.count || 0) : 0,
        status: hasAI ? "active" : "degraded",
        icon: "message-circle",
        passiveScore: derivePassiveScore(
          sophieActivity.status === "fulfilled" ? Number(sophieActivity.value[0]?.count || 0) : 0,
          hasAI, 1),
        note: hasAI ? "Escalates only when genuinely stuck" : "Requires AI credentials",
      },
      {
        name: "Property Enrichment",
        description: "Enriches parcels with flood zones, soil types, and comparable sales data",
        actionsLast7d: enrichmentActivity.status === "fulfilled" ? Number(enrichmentActivity.value[0]?.count || 0) : 0,
        status: hasAI ? "active" : "degraded",
        icon: "database",
        passiveScore: derivePassiveScore(
          enrichmentActivity.status === "fulfilled" ? Number(enrichmentActivity.value[0]?.count || 0) : 0,
          hasAI, 1),
      },
      {
        name: "Portfolio Sentinel",
        description: "Monitors note performance and default risk around the clock",
        actionsLast7d: sentinelActivity.status === "fulfilled" ? Number(sentinelActivity.value[0]?.count || 0) : 0,
        status: "active",
        icon: "shield",
        passiveScore: derivePassiveScore(
          sentinelActivity.status === "fulfilled" ? Number(sentinelActivity.value[0]?.count || 0) : 0,
          true, 1),
      },
      {
        name: "Workflow Automations",
        description: "Triggers deal stage updates, tasks, and notifications automatically",
        actionsLast7d: workflowActivity.status === "fulfilled" ? Number(workflowActivity.value[0]?.count || 0) : 0,
        status: hasRedis ? "active" : "limited",
        icon: "workflow",
        passiveScore: derivePassiveScore(
          workflowActivity.status === "fulfilled" ? Number(workflowActivity.value[0]?.count || 0) : 0,
          true, 1),
        note: !hasRedis ? "Redis recommended for reliable job scheduling" : undefined,
      },
      {
        name: "Deal Progression AI",
        description: "Generates offer letters, comps, and next-action guidance automatically",
        actionsLast7d: dealProgressionActivity.status === "fulfilled" ? Number(dealProgressionActivity.value[0]?.count || 0) : 0,
        status: hasAI ? "active" : "degraded",
        icon: "briefcase",
        passiveScore: derivePassiveScore(
          dealProgressionActivity.status === "fulfilled" ? Number(dealProgressionActivity.value[0]?.count || 0) : 0,
          hasAI, 1),
      },
    ];

    const totalAutomatedActions = automationStatus.reduce((sum, a) => sum + a.actionsLast7d, 0);
    const avgAutomationScore = automationStatus.reduce((sum, a) => sum + a.passiveScore, 0) / automationStatus.length;

    // Composite passive score:
    // 40% from credential readiness (can the automations even run?)
    // 40% from automation scores (are they producing output?)
    // 20% from operational health (open decisions, job failures)
    const operationalHealth = Math.max(0, 100 - (pendingDecisions * 5) - (jobFailures * 10));
    const overallPassiveScore = Math.round(
      (credScore * 0.4) +
      (avgAutomationScore * 0.4) +
      (Math.min(100, operationalHealth) * 0.2)
    );

    const scoreLabel =
      overallPassiveScore >= 90 ? "Fully passive — platform running itself"
      : overallPassiveScore >= 75 ? "Highly automated — minimal daily intervention"
      : overallPassiveScore >= 60 ? "Partially automated — some services need configuration"
      : overallPassiveScore >= 40 ? "Degraded — key credentials missing"
      : "Manual mode — configure services to enable automation";

    const missingCreds = [
      !hasAI && "AI (OpenRouter)",
      !hasEmail && "Email (AWS SES)",
      !hasStripe && "Stripe Billing",
      !hasMaps && "Mapbox",
    ].filter(Boolean);

    res.json({
      overallPassiveScore,
      totalAutomatedActionsLast7d: totalAutomatedActions,
      humanActionsRequiredLast7d: pendingDecisions,
      automations: automationStatus,
      credentialHealth: {
        score: credScore,
        hasAI, hasEmail, hasStripe, hasMaps, hasDirectMail, hasSMS, hasRedis,
        missingCreds,
      },
      operationalHealth: {
        score: Math.min(100, operationalHealth),
        pendingDecisions,
        jobFailures24h: jobFailures,
      },
      passiveIncomeStatement: overallPassiveScore >= 70
        ? `Platform completed ${totalAutomatedActions.toLocaleString()} automated actions last 7 days. ${scoreLabel}.`
        : `${scoreLabel}. Configure missing services to reach full automation: ${missingCreds.join(", ") || "all credentials set"}.`,
    });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/founder/intelligence/churn
// Churn risk signals and at-risk accounts
// ─────────────────────────────────────────────────────────────────────────────

router.get("/churn", requireFounder, async (req: Request, res: Response) => {
  try {
    const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);

    // Pillar 8.6 — churn analytics is pure-read, route to replica.
    const reader = await dbForReads("founder.intelligence.churn");

    // Find organizations that were active before but not recently
    const atRiskOrgs = await reader
      .select({
        id: organizations.id,
        name: organizations.name,
        tier: organizations.subscriptionTier,
        createdAt: organizations.createdAt,
        lastActiveAt: organizations.lastActiveAt,
      })
      .from(organizations)
      .where(
        and(
          sql`subscription_tier not in ('free')`,
          sql`subscription_status = 'active'`,
          // Active > 14 days ago but not recently
          lte(organizations.lastActiveAt, fourteenDaysAgo),
        )
      )
      .orderBy(organizations.lastActiveAt)
      .limit(20);

    // Recent cancellations with tier data
    const recentCancels = await reader
      .select({
        organizationId: subscriptionEvents.organizationId,
        fromTier: subscriptionEvents.fromTier,
        toTier: subscriptionEvents.toTier,
        createdAt: subscriptionEvents.createdAt,
      })
      .from(subscriptionEvents)
      .where(
        and(
          eq(subscriptionEvents.eventType, "subscription_cancelled"),
          gte(subscriptionEvents.createdAt, thirtyDaysAgo)
        )
      )
      .orderBy(desc(subscriptionEvents.createdAt))
      .limit(20);

    // Calculate churn rate
    const [totalPayingResult, cancelCountResult] = await Promise.all([
      reader.select({ count: count() }).from(organizations)
        .where(sql`subscription_tier not in ('free') and subscription_status = 'active'`),
      reader.select({ count: count() }).from(subscriptionEvents)
        .where(and(
          eq(subscriptionEvents.eventType, "subscription_cancelled"),
          gte(subscriptionEvents.createdAt, thirtyDaysAgo)
        )),
    ]);

    const totalPaying = Number(totalPayingResult[0]?.count || 0);
    const cancelCount30d = Number(cancelCountResult[0]?.count || 0);
    const monthlyChurnRate = totalPaying > 0 ? (cancelCount30d / totalPaying) * 100 : 0;

    res.json({
      churnMetrics: {
        monthlyChurnRate: monthlyChurnRate.toFixed(2),
        totalPayingOrgs: totalPaying,
        cancellationsLast30d: cancelCount30d,
        industryBenchmark: 2.5, // SaaS average monthly churn %
        status: monthlyChurnRate <= 2.5 ? "healthy" : monthlyChurnRate <= 5 ? "watch" : "critical",
      },
      atRiskOrgs: atRiskOrgs.map(org => ({
        ...org,
        daysSinceLastActive: org.lastActiveAt
          ? Math.round((Date.now() - new Date(org.lastActiveAt).getTime()) / 86400000)
          : null,
        churnSignal: getRiskLevel(org.lastActiveAt),
      })),
      recentCancellations: recentCancels,
      recommendations: generateChurnRecommendations(monthlyChurnRate, atRiskOrgs.length),
    });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/founder/intelligence/growth
// Growth signals, conversion funnel, expansion revenue
// ─────────────────────────────────────────────────────────────────────────────

router.get("/growth", requireFounder, async (req: Request, res: Response) => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);

    // Pillar 8.6 — growth roll-up is pure analytics, route to replica.
    const reader = await dbForReads("founder.intelligence.growth");

    const [
      tierDistribution,
      upgrades30d,
      downgrades30d,
      freeToAnyConversions,
    ] = await Promise.allSettled([
      // Current tier distribution
      reader.select({
        tier: organizations.subscriptionTier,
        count: count(),
      })
        .from(organizations)
        .where(eq(organizations.subscriptionStatus, "active"))
        .groupBy(organizations.subscriptionTier)
        .orderBy(desc(count())),

      // Upgrades in last 30d
      reader.select({ count: count() })
        .from(subscriptionEvents)
        .where(and(
          eq(subscriptionEvents.eventType, "subscription_upgraded"),
          gte(subscriptionEvents.createdAt, thirtyDaysAgo)
        )),

      // Downgrades in last 30d
      reader.select({ count: count() })
        .from(subscriptionEvents)
        .where(and(
          eq(subscriptionEvents.eventType, "subscription_downgraded"),
          gte(subscriptionEvents.createdAt, thirtyDaysAgo)
        )),

      // Free → any paid conversion in 30d
      reader.select({ count: count() })
        .from(subscriptionEvents)
        .where(and(
          eq(subscriptionEvents.fromTier, "free"),
          gte(subscriptionEvents.createdAt, thirtyDaysAgo)
        )),
    ]);

    const tiers = tierDistribution.status === "fulfilled" ? tierDistribution.value : [];
    const totalOrgs = tiers.reduce((sum, t) => sum + Number(t.count), 0);
    const upgradeCount = upgrades30d.status === "fulfilled" ? Number(upgrades30d.value[0]?.count || 0) : 0;
    const downgradeCount = downgrades30d.status === "fulfilled" ? Number(downgrades30d.value[0]?.count || 0) : 0;
    const freeConversions = freeToAnyConversions.status === "fulfilled" ? Number(freeToAnyConversions.value[0]?.count || 0) : 0;

    const freeOrgs = tiers.find(t => t.tier === "free");
    const freeToPayConversionRate = freeOrgs && Number(freeOrgs.count) > 0
      ? (freeConversions / Number(freeOrgs.count)) * 100
      : 0;

    res.json({
      tierDistribution: tiers.map(t => ({
        tier: t.tier,
        count: Number(t.count),
        percentage: totalOrgs > 0 ? Math.round((Number(t.count) / totalOrgs) * 100) : 0,
      })),
      expansionSignals: {
        upgrades30d: upgradeCount,
        downgrades30d: downgradeCount,
        netExpansion: upgradeCount - downgradeCount,
        freeToPayConversions30d: freeConversions,
        freeToPayConversionRate: freeToPayConversionRate.toFixed(1),
      },
      growthOpportunities: [
        freeOrgs && Number(freeOrgs.count) > 50 ? `${Number(freeOrgs.count)} free accounts ready to convert — consider targeted in-app upgrade prompts` : null,
        upgradeCount > downgradeCount ? `Net positive expansion: ${upgradeCount - downgradeCount} more upgrades than downgrades` : null,
        "Consider in-app feature announcement for Sprout tier to accelerate free → paid conversion",
      ].filter(Boolean),
    });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

function calculatePassiveScore(criticalAlerts: number, openTickets: number, automatedActions: number): number {
  let score = 70; // Base score
  if (automatedActions > 100) score += 15;
  else if (automatedActions > 50) score += 10;
  else if (automatedActions > 10) score += 5;

  if (criticalAlerts === 0) score += 10;
  else score -= criticalAlerts * 5;

  if (openTickets <= 3) score += 5;
  else if (openTickets > 20) score -= 10;

  return Math.max(0, Math.min(100, score));
}

function forecastLinear(values: number[], periods: number): number[] {
  if (values.length < 2) return Array(periods).fill(values[values.length - 1] || 0);

  const n = values.length;
  const sumX = values.reduce((_, __, i) => _ + i, 0);
  const sumY = values.reduce((a, b) => a + b, 0);
  const sumXY = values.reduce((acc, y, i) => acc + i * y, 0);
  const sumX2 = values.reduce((acc, _, i) => acc + i * i, 0);

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  return Array.from({ length: periods }, (_, i) => intercept + slope * (n + i));
}

function getFutureMonth(offset: number): string {
  const d = addMonths(new Date(), offset);
  return d.toISOString().slice(0, 7);
}

function getRiskLevel(lastActiveAt: Date | string | null): "high" | "medium" | "low" {
  if (!lastActiveAt) return "high";
  const days = (Date.now() - new Date(lastActiveAt).getTime()) / 86400000;
  if (days > 60) return "high";
  if (days > 30) return "medium";
  return "low";
}

function generateChurnRecommendations(churnRate: number, atRiskCount: number): string[] {
  const recs: string[] = [];
  if (churnRate > 5) recs.push("High churn: consider in-app success check-ins for new users in their first 30 days");
  if (churnRate > 3) recs.push("Review onboarding sequence — early activation drives long-term retention");
  if (atRiskCount > 5) recs.push(`${atRiskCount} accounts inactive 14+ days — Sophie can send proactive check-in messages`);
  recs.push("Feature announcement emails to re-engage dormant accounts consistently reduce churn");
  return recs;
}

// ─────────────────────────────────────────────────────────────────────────────
// DECISIONS INBOX
// ─────────────────────────────────────────────────────────────────────────────

router.get("/decisions-inbox", requireFounder, async (req: Request, res: Response) => {
  try {
    // Re-open any deferred items whose deferral window has passed
    await decisionsInboxService.processDeferredItems();

    const items = await decisionsInboxService.getPendingItems();
    const totalPending = items.length;
    const byType = items.reduce((acc: any, item: any) => {
      acc[item.itemType] = (acc[item.itemType] ?? 0) + 1;
      return acc;
    }, {});

    res.json({ items, totalPending, stats: { byType } });
  } catch (err: any) {
    logger.error("[decisions-inbox] Error fetching inbox", undefined, { metadata: { detail: err.message } });
    res.json({ items: [], totalPending: 0, stats: { byType: {} } });
  }
});

router.post("/decisions-inbox/:id/approve", requireFounder, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const result = await decisionsInboxService.approve(id);
    res.json({ success: true, ...result });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

router.post("/decisions-inbox/:id/reject", requireFounder, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const { reason } = req.body;

    // Fetch the decision item before rejecting so we can learn from it
    const item = await decisionsInboxService.getById?.(id) ??
      (await db.select().from(decisionsInboxItems).where(eq(decisionsInboxItems.id, id)).limit(1))[0];

    await decisionsInboxService.reject(id, reason);

    // v4: Learn from the override so agents improve over time
    if (item) {
      try {
        await learnFromOverride({
          agentCodename: item.ownerAgentCodename || "unknown",
          actionName: item.itemType || "decision",
          originalRecommendation: item.recommendedActionLabel || item.sophieAnalysis || "",
          ceoOverrideAction: "reject",
          ceoOverrideNotes: reason,
          decisionId: id,
        });
      } catch (learnErr: any) {
        logger.error("[decisions-inbox] Override learning failed (non-blocking)", undefined, { metadata: { detail: learnErr.message } });
      }

      // Phase B-2: also record into the cross-agent rejection notes table so
      // the next time this agent generates LLM-driven content it sees the
      // founder's feedback in its system prompt. Best-effort — never block
      // the reject path on rejection-context bookkeeping.
      try {
        const { recordRejection } = await import("./services/agentRejectionContext");
        await recordRejection({
          agentCodename: item.ownerAgentCodename || "unknown",
          decisionsInboxItemId: id,
          tags: [],
          note: reason,
          rejectedBy: (req.user?.email as string | undefined) ?? "founder",
        });
      } catch (rejErr: any) {
        logger.warn(`[decisions-inbox] agent_rejection_notes mirror failed: ${rejErr?.message ?? rejErr}`);
      }
    }

    res.json({ success: true });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

router.post("/decisions-inbox/:id/defer", requireFounder, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const { hours } = req.body;
    await decisionsInboxService.defer(id, hours ?? 24);
    res.json({ success: true });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

router.post("/decisions-inbox/:id/override", requireFounder, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const { customAction } = req.body;
    if (!customAction) return Errors.badRequest(res, "customAction required");

    // Fetch the decision item before overriding so we can learn from it
    const item = await decisionsInboxService.getById?.(id) ??
      (await db.select().from(decisionsInboxItems).where(eq(decisionsInboxItems.id, id)).limit(1))[0];

    await decisionsInboxService.override(id, customAction);

    // v4: Learn from the override so agents improve over time
    if (item) {
      try {
        await learnFromOverride({
          agentCodename: item.ownerAgentCodename || "unknown",
          actionName: item.itemType || "decision",
          originalRecommendation: item.recommendedActionLabel || item.sophieAnalysis || "",
          ceoOverrideAction: customAction,
          ceoOverrideNotes: customAction,
          decisionId: id,
        });
      } catch (learnErr: any) {
        logger.error("[decisions-inbox] Override learning failed (non-blocking)", undefined, { metadata: { detail: learnErr.message } });
      }
    }

    res.json({ success: true });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

/**
 * Bulk purge for the decisions inbox. Founder-only escape hatch — wipes
 * stale items that built up during dev or before triage was tightened.
 *
 * Body shape (all optional):
 *   olderThanDays: number  // default 7 — only items older than this
 *   statuses: string[]     // default ["pending","deferred"]
 *   itemTypes: string[]    // optional filter
 *   hardDelete: boolean    // default false — by default we mark as
 *                          // 'rejected' with a "purged" reason, preserving
 *                          // history. Pass true to actually DELETE rows.
 *
 * Returns { purged: number }.
 */
router.post("/decisions-inbox/purge", requireFounder, async (req: Request, res: Response) => {
  try {
    const olderThanDays = Number(req.body?.olderThanDays ?? 7);
    const statuses: string[] = Array.isArray(req.body?.statuses)
      ? req.body.statuses
      : ["pending", "deferred"];
    const itemTypes: string[] | null = Array.isArray(req.body?.itemTypes) && req.body.itemTypes.length > 0
      ? req.body.itemTypes
      : null;
    const hardDelete = Boolean(req.body?.hardDelete);
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);

    const { inArray, lte, and } = await import("drizzle-orm");
    const whereClauses = [
      inArray(decisionsInboxItems.status, statuses),
      lte(decisionsInboxItems.createdAt, cutoff),
    ];
    if (itemTypes) whereClauses.push(inArray(decisionsInboxItems.itemType, itemTypes));

    if (hardDelete) {
      const deleted = await db
        .delete(decisionsInboxItems)
        .where(and(...whereClauses))
        .returning({ id: decisionsInboxItems.id });
      logger.info(`[decisions-inbox] purged ${deleted.length} rows (hard delete)`, {
        metadata: { olderThanDays, statuses, itemTypes },
      });
      return res.json({ purged: deleted.length, mode: "hard_delete" });
    }

    const updated = await db
      .update(decisionsInboxItems)
      .set({
        status: "rejected",
        resolvedAt: new Date(),
        resolvedBy: "founder:purge",
        founderModification: `Purged: stale ${statuses.join("/")} item ≥${olderThanDays}d old`,
        updatedAt: new Date(),
      })
      .where(and(...whereClauses))
      .returning({ id: decisionsInboxItems.id });
    logger.info(`[decisions-inbox] purged ${updated.length} rows (soft, status=rejected)`, {
      metadata: { olderThanDays, statuses, itemTypes },
    });
    res.json({ purged: updated.length, mode: "soft_reject" });
  } catch (err: any) {
    logger.error("[decisions-inbox] purge failed", undefined, { metadata: { detail: err.message } });
    Errors.internal(res, err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DECISION LOG — audit trail of every autonomous-executor decision
//
// /decisions-inbox returns PENDING items only. This endpoint returns
// the full history — approved, rejected, deferred, auto-resolved,
// and pending — so the founder can see *what the system has been
// deciding in their absence*.
//
// Bucketed for human consumption, layperson framing:
//
//   needsYou         — pending + high urgency/risk
//   autoHandled      — resolved by autonomous_executor without asking
//   guardrailStopped — rejected by executor (blocked by hard guardrail)
//   youReviewed      — resolved by a human (override/approve/reject)
//   deferred         — snoozed for later
//
// Every entry includes the AI reasoning, estimated impact, and — if
// available — the outcome score once it's been graded.
// ─────────────────────────────────────────────────────────────────────────────

router.get("/decision-log", requireFounder, async (req: Request, res: Response) => {
  try {
    const days = Math.min(Math.max(parseInt((req.query.days as string) ?? "30", 10), 1), 90);
    const limit = Math.min(Math.max(parseInt((req.query.limit as string) ?? "200", 10), 10), 500);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rows = await db
      .select()
      .from(decisionsInboxItems)
      .where(sql`${decisionsInboxItems.createdAt} >= ${since}`)
      .orderBy(desc(decisionsInboxItems.createdAt))
      .limit(limit);

    // Bucket + summarize for the founder UI.
    const needsYou: typeof rows = [];
    const autoHandled: typeof rows = [];
    const guardrailStopped: typeof rows = [];
    const youReviewed: typeof rows = [];
    const deferred: typeof rows = [];
    for (const r of rows) {
      const resolvedByExecutor = r.resolvedBy === "autonomous_executor" || r.resolvedBy === "hard_guardrail";
      if (r.status === "pending") {
        // Pending rows with critical risk or urgency >= 80 bubble up as "needs you"
        if (r.riskLevel === "critical" || (r.urgencyScore ?? 0) >= 80) {
          needsYou.push(r);
        } else {
          // Low-urgency pending still goes to needsYou so nothing gets silently lost.
          needsYou.push(r);
        }
      } else if (r.status === "deferred") {
        deferred.push(r);
      } else if (r.status === "rejected" && r.resolvedBy === "hard_guardrail") {
        guardrailStopped.push(r);
      } else if (r.status === "auto_resolved" || (r.status === "approved" && resolvedByExecutor)) {
        autoHandled.push(r);
      } else if (r.resolvedBy && r.resolvedBy !== "autonomous_executor" && r.resolvedBy !== "hard_guardrail") {
        youReviewed.push(r);
      } else {
        // Fall-through bucket: resolved but unclear who did it.
        youReviewed.push(r);
      }
    }

    // Outcome rollup for the "auto-handled" bucket — the honest answer
    // to "have the decisions the system made turned out well?"
    const scored = autoHandled.filter((r) => typeof r.outcomeScore === "number");
    const avgOutcome = scored.length
      ? scored.reduce((s, r) => s + (r.outcomeScore ?? 0), 0) / scored.length
      : null;

    // Spend exposure: total $ impact of auto-handled decisions. The
    // founder should know how much money the system moved in their
    // absence, even if no single decision was dramatic.
    const autoHandledImpactCents = autoHandled.reduce(
      (s, r) => s + Math.abs(r.estimatedImpactCents ?? 0),
      0
    );

    res.json({
      windowDays: days,
      generatedAt: new Date().toISOString(),
      summary: {
        total: rows.length,
        needsYou: needsYou.length,
        autoHandled: autoHandled.length,
        guardrailStopped: guardrailStopped.length,
        youReviewed: youReviewed.length,
        deferred: deferred.length,
        autoHandledImpactCents,
        avgOutcomeScore: avgOutcome,
      },
      buckets: {
        needsYou: needsYou.slice(0, 50),
        autoHandled: autoHandled.slice(0, 100),
        guardrailStopped: guardrailStopped.slice(0, 50),
        youReviewed: youReviewed.slice(0, 50),
        deferred: deferred.slice(0, 50),
      },
    });
  } catch (err: any) {
    logger.error("[decision-log] Error fetching log", undefined, { metadata: { detail: err.message } });
    Errors.internal(res, err);
  }
});

// Scenario harness — founder-facing trigger for the seeded cohort.
// Calls the same code path as scripts/founder-autonomy/seed-scenario.ts
// so the founder can inject a situation from the browser without
// SSHing into the prod host. Hard-gated: only works when
// SIMULATION_MODE is on, and only for orgs tagged simulationMode=true.
router.post("/scenario/run", requireFounder, async (req: Request, res: Response) => {
  try {
    const { isGlobalSimulationMode } = await import("./utils/simulationMode");
    if (!isGlobalSimulationMode()) {
      return Errors.badRequest(res, "Scenario harness requires SIMULATION_MODE=true. Flip the env flag before firing scenarios.");
    }
    const { scenario, slug, allAtRisk } = req.body as {
      scenario?: string;
      slug?: string;
      allAtRisk?: boolean;
    };
    if (!scenario) return Errors.badRequest(res, "scenario is required");
    // Shell out to the seed-scenario script so the harness logic lives
    // in one place. Safe because SIMULATION_MODE is on and the script
    // refuses any non-sim-* target.
    const { spawn } = await import("node:child_process");
    const args = ["tsx", "scripts/founder-autonomy/seed-scenario.ts", "--scenario", scenario];
    if (slug) args.push("--slug", slug);
    if (allAtRisk) args.push("--all-at-risk");
    const proc = spawn("npx", args, {
      env: { ...process.env, SIMULATION_MODE: "true" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    const exitCode: number = await new Promise((resolve) => proc.on("close", resolve));
    res.json({
      scenario,
      slug: slug ?? null,
      allAtRisk: !!allAtRisk,
      exitCode,
      stdout: stdout.slice(-4000),
      stderr: stderr.slice(-4000),
    });
  } catch (err: any) {
    logger.error("[scenario/run] Error", undefined, { metadata: { detail: err.message } });
    Errors.internal(res, err);
  }
});

// Per-agent activity drill-down for the founder briefing. Returns
// recent actions, outcome mix (success / failed / escalated), and a
// "did this agent do anything in the window" signal for each of the
// 12 registered company agents. The morning briefing summarizes this
// data; /founder/decisions can expand an agent's row to see it.
router.get("/agent-activity", requireFounder, async (req: Request, res: Response) => {
  try {
    const hours = Math.min(Math.max(parseInt((req.query.hours as string) ?? "24", 10), 1), 24 * 30);
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const agents = await companyAgentService.getAllIncludingPaused();
    const recent = await db
      .select()
      .from(agentActionLog)
      .where(gte(agentActionLog.createdAt, since))
      .orderBy(desc(agentActionLog.createdAt))
      .limit(500);

    const byAgent = new Map<string, typeof recent>();
    for (const r of recent) {
      const bucket = byAgent.get(r.agentCodename) ?? [];
      bucket.push(r);
      byAgent.set(r.agentCodename, bucket);
    }

    const perAgent = agents.map((agent) => {
      const actions = byAgent.get(agent.codename) ?? [];
      const successCount = actions.filter((a) => a.outcome === "success").length;
      const failedCount = actions.filter((a) => a.outcome === "failure").length;
      const escalatedCount = actions.filter((a) => a.outcome === "escalated").length;
      const pendingCount = actions.filter((a) => a.outcome === "pending").length;
      return {
        codename: agent.codename,
        title: agent.title,
        wing: (agent as any).wing ?? null,
        trustScore: agent.trustScore,
        status: agent.status,
        totalActions: actions.length,
        successCount,
        failedCount,
        escalatedCount,
        pendingCount,
        hasActivity: actions.length > 0,
        recentActions: actions.slice(0, 5).map((a) => ({
          id: a.id,
          actionType: a.actionType,
          actionName: a.actionName,
          outcome: a.outcome,
          reasoning: a.reasoning?.slice(0, 300) ?? null,
          confidence: a.confidence,
          costCents: a.costCents,
          createdAt: a.createdAt,
        })),
      };
    });

    res.json({
      windowHours: hours,
      generatedAt: new Date().toISOString(),
      totalAgents: perAgent.length,
      agentsWithActivity: perAgent.filter((a) => a.hasActivity).length,
      silentAgents: perAgent.filter((a) => !a.hasActivity).map((a) => a.codename),
      perAgent,
    });
  } catch (err: any) {
    logger.error("[agent-activity] Error", undefined, { metadata: { detail: err.message } });
    Errors.internal(res, err);
  }
});

// Founder-facing financial-authority roll-up: per-agent budget
// utilization, pending anomalies, current hard-cap value, and how
// many pending approvals are about to TTL out. Sweeps stale
// approvals on the way in so the response reflects a clean queue.
router.get("/budget-summary", requireFounder, async (_req: Request, res: Response) => {
  try {
    const { financialAuthorityGate } = await import("./services/financialAuthorityGate");
    const swept = await financialAuthorityGate.sweepStaleApprovals();
    const summary = await financialAuthorityGate.getBudgetSummary();
    res.json({ ...summary, swept: swept.expired });
  } catch (err: any) {
    logger.error("[budget-summary] Error", undefined, { metadata: { detail: err.message } });
    Errors.internal(res, err);
  }
});

// The "1 hour per month" signal — a single green/yellow/red light
// rolled up from 5 dimensions (queue depth, intervention rate, avg
// outcome score, agent health, safety-rail trip rate). The founder
// should glance at this and know if they need to touch the system.
router.get("/autonomy-health", requireFounder, async (_req: Request, res: Response) => {
  try {
    const { getAutonomyHealth } = await import("./services/autonomyHealth");
    const report = await getAutonomyHealth();
    res.json(report);
  } catch (err: any) {
    logger.error("[autonomy-health] Error", undefined, { metadata: { detail: err.message } });
    Errors.internal(res, err);
  }
});

// Manual trigger for the outcome grader — useful for first-run bootstrap
// and for re-grading after a schema change. The daily cron calls the
// same function.
router.post("/autonomy-health/grade-outcomes", requireFounder, async (_req: Request, res: Response) => {
  try {
    const { gradeRecentDecisions } = await import("./services/autonomyHealth");
    const result = await gradeRecentDecisions();
    res.json(result);
  } catch (err: any) {
    logger.error("[grade-outcomes] Error", undefined, { metadata: { detail: err.message } });
    Errors.internal(res, err);
  }
});

// ── Prompt evolution — the monthly learning loop ────────────────────

router.get("/prompt-evolutions", requireFounder, async (_req: Request, res: Response) => {
  try {
    const { listProposedPromptChanges } = await import("./services/promptEvolutionMetaAgent");
    const rows = await listProposedPromptChanges();
    res.json({ proposals: rows });
  } catch (err: any) {
    logger.error("[prompt-evolutions] Error", undefined, { metadata: { detail: err.message } });
    Errors.internal(res, err);
  }
});

// Prompt history — all versions for a given agent, newest first.
// Powers the per-agent prompt timeline + version-to-version diff viewer.
router.get("/prompt-history", requireFounder, async (req: Request, res: Response) => {
  try {
    const agentCodename = (req.query.agent as string | undefined)?.trim();
    if (!agentCodename) return Errors.badRequest(res, "agent query param required");
    const { db } = await import("./db");
    const { agentVersions } = await import("@shared/schema");
    const { eq, desc } = await import("drizzle-orm");
    const rows = await db
      .select({
        id: agentVersions.id,
        versionNumber: agentVersions.versionNumber,
        personalityPrompt: agentVersions.personalityPrompt,
        changeDescription: agentVersions.changeDescription,
        isActive: agentVersions.isActive,
        canaryWeight: agentVersions.canaryWeight,
        deployedAt: agentVersions.deployedAt,
        rolledBackAt: agentVersions.rolledBackAt,
        createdBy: agentVersions.createdBy,
        createdAt: agentVersions.createdAt,
      })
      .from(agentVersions)
      .where(eq(agentVersions.agentCodename, agentCodename))
      .orderBy(desc(agentVersions.versionNumber))
      .limit(50);
    res.json({ agentCodename, versions: rows });
  } catch (err: any) {
    logger.error("[prompt-history] Error", undefined, { metadata: { detail: err.message } });
    Errors.internal(res, err);
  }
});

// List of agents that have at least one version on file — powers the
// agent selector on the prompt-history page.
router.get("/prompt-history/agents", requireFounder, async (_req: Request, res: Response) => {
  try {
    const { db } = await import("./db");
    const { agentVersions } = await import("@shared/schema");
    const { sql } = await import("drizzle-orm");
    const rows = await db.execute(sql`
      SELECT agent_codename AS "agentCodename",
             COUNT(*)::int AS "versionCount",
             MAX(version_number)::int AS "latestVersion"
      FROM ${agentVersions}
      GROUP BY agent_codename
      ORDER BY agent_codename ASC
    `);
    res.json({ agents: (rows as any).rows ?? [] });
  } catch (err: any) {
    logger.error("[prompt-history agents] Error", undefined, { metadata: { detail: err.message } });
    Errors.internal(res, err);
  }
});

router.get("/prompt-evolutions/:id", requireFounder, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return Errors.badRequest(res, "Invalid id");
    const { getPromptChange } = await import("./services/promptEvolutionMetaAgent");
    const row = await getPromptChange(id);
    if (!row) return Errors.notFound(res, "Proposal");
    // Attach the currently-active prompt so the client can render a diff.
    let currentPrompt: string | null = null;
    try {
      const { agentVersionControlService } = await import("./services/agentVersionControlV12");
      const active = await agentVersionControlService.getActiveVersion(row.agentCodename);
      currentPrompt = active?.personalityPrompt ?? null;
    } catch (_e) {
      currentPrompt = null;
    }
    res.json({ proposal: row, currentPrompt });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

router.post("/prompt-evolutions/:id/approve", requireFounder, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return Errors.badRequest(res, "Invalid id");
    const { agentEvolutionEngine } = await import("./services/agentEvolutionEngine");
    const result = await agentEvolutionEngine.applyPromptChange(id);
    if (!result.success) return Errors.badRequest(res, result.message);
    res.json(result);
  } catch (err: any) {
    logger.error("[prompt-evolutions approve] Error", undefined, { metadata: { detail: err.message } });
    Errors.internal(res, err);
  }
});

router.post("/prompt-evolutions/:id/reject", requireFounder, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return Errors.badRequest(res, "Invalid id");
    const { rejectPromptChange } = await import("./services/promptEvolutionMetaAgent");
    await rejectPromptChange(id);
    res.json({ ok: true });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// Manual trigger for the monthly meta-agent — useful for first-run
// and after a series of known-bad decisions the founder wants to
// learn from immediately.
router.post("/prompt-evolutions/run-now", requireFounder, async (_req: Request, res: Response) => {
  try {
    const { runMonthlyPromptEvolution } = await import("./services/promptEvolutionMetaAgent");
    const result = await runMonthlyPromptEvolution();
    res.json(result);
  } catch (err: any) {
    logger.error("[prompt-evolutions run] Error", undefined, { metadata: { detail: err.message } });
    Errors.internal(res, err);
  }
});

// ── Monthly Founder Letter — narrative interface ────────────────────

router.get("/letter/current", requireFounder, async (_req: Request, res: Response) => {
  try {
    const { getCurrentLetter } = await import("./services/founderNarrative");
    const letter = await getCurrentLetter();
    res.json({ letter });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

router.get("/letter/archive", requireFounder, async (_req: Request, res: Response) => {
  try {
    const { listLetterArchive } = await import("./services/founderNarrative");
    const letters = await listLetterArchive();
    res.json({ letters });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

router.get("/letter/:monthKey", requireFounder, async (req: Request, res: Response) => {
  try {
    const { getLetterByMonth } = await import("./services/founderNarrative");
    const letter = await getLetterByMonth(req.params.monthKey);
    if (!letter) return Errors.notFound(res, "Letter not found for that month");
    res.json({ letter });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

router.post("/letter/generate", requireFounder, async (req: Request, res: Response) => {
  try {
    const { generateMonthlyLetter } = await import("./services/founderNarrative");
    const result = await generateMonthlyLetter(req.body?.monthKey);
    res.json(result);
  } catch (err: any) {
    logger.error("[letter generate] Error", undefined, { metadata: { detail: err.message } });
    Errors.internal(res, err);
  }
});

router.post("/letter/:monthKey/mark-delivered", requireFounder, async (req: Request, res: Response) => {
  try {
    const { markLetterDelivered } = await import("./services/founderNarrative");
    await markLetterDelivered(req.params.monthKey);
    res.json({ ok: true });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// ── Strategic proposals (proactive layer) ───────────────────────────

router.get("/strategic-proposals", requireFounder, async (_req: Request, res: Response) => {
  try {
    const { listPendingProposals } = await import("./services/strategicProposals");
    const proposals = await listPendingProposals();
    res.json({ proposals });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

router.get("/strategic-proposals/month/:monthKey", requireFounder, async (req: Request, res: Response) => {
  try {
    const { listSynthesizedForMonth } = await import("./services/strategicProposals");
    const proposals = await listSynthesizedForMonth(req.params.monthKey);
    res.json({ proposals });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

async function handleStrategicProposalAction(
  req: any,
  res: Response,
  action: "approved" | "rejected",
) {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    return Errors.badRequest(res, "Invalid id");
  }
  try {
    const { resolveProposal } = await import("./services/strategicProposals");
    const { db } = await import("./db");
    const { strategicProposals } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");

    // Pre-flight: confirm the proposal exists so we return 404 instead of
    // an opaque 500 when the founder clicks an approve button after the
    // row was archived in a prior run.
    const [existing] = await db
      .select({ id: strategicProposals.id, status: strategicProposals.status })
      .from(strategicProposals)
      .where(eq(strategicProposals.id, id))
      .limit(1);
    if (!existing) {
      return Errors.notFound(res, `Strategic proposal #${id}`);
    }

    const feedback = (typeof req.body?.feedback === "string" ? req.body.feedback : "") || undefined;
    const userId = req.permissionContext?.userId ?? req.user?.email ?? "founder";
    await resolveProposal(id, action, feedback, userId);
    res.json({ ok: true, id, previousStatus: existing.status, newStatus: action });
  } catch (err: any) {
    logger.error("[strategic-proposals] action failed", err, {
      metadata: { action, id, userId: req.user?.email ?? null, msg: err?.message ?? String(err) },
    });
    Errors.internal(res, err);
  }
}

router.post("/strategic-proposals/:id/approve", requireFounder, async (req: any, res: Response) => {
  await handleStrategicProposalAction(req, res, "approved");
});

router.post("/strategic-proposals/:id/reject", requireFounder, async (req: any, res: Response) => {
  await handleStrategicProposalAction(req, res, "rejected");
});

router.post("/strategic-proposals/run-weekly", requireFounder, async (_req: Request, res: Response) => {
  try {
    const { runWeeklyProposals } = await import("./services/strategicProposals");
    const result = await runWeeklyProposals();
    res.json(result);
  } catch (err: any) {
    logger.error("[strategic-proposals weekly] Error", undefined, { metadata: { detail: err.message } });
    Errors.internal(res, err);
  }
});

router.post("/strategic-proposals/run-synthesis", requireFounder, async (req: Request, res: Response) => {
  try {
    const { runMonthlySynthesis } = await import("./services/strategicProposals");
    const result = await runMonthlySynthesis(req.body?.monthKey);
    res.json(result);
  } catch (err: any) {
    logger.error("[strategic-proposals synth] Error", undefined, { metadata: { detail: err.message } });
    Errors.internal(res, err);
  }
});

// ── Calibration (self-awareness) ────────────────────────────────────

router.get("/calibration", requireFounder, async (req: Request, res: Response) => {
  try {
    const { computeCalibration } = await import("./services/calibration");
    const windowDays = parseInt((req.query.windowDays as string) ?? "60", 10);
    const report = await computeCalibration("all", Number.isFinite(windowDays) ? windowDays : 60);
    res.json(report);
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

router.get("/calibration/:agentCodename", requireFounder, async (req: Request, res: Response) => {
  try {
    const { computeCalibration } = await import("./services/calibration");
    const windowDays = parseInt((req.query.windowDays as string) ?? "60", 10);
    const report = await computeCalibration(
      req.params.agentCodename,
      Number.isFinite(windowDays) ? windowDays : 60,
    );
    res.json(report);
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// ── Founder settings (customization center) ─────────────────────────

router.get("/settings", requireFounder, async (_req: Request, res: Response) => {
  try {
    const { listSettings } = await import("./services/founderSettings");
    const settings = await listSettings();
    res.json({ settings });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

router.post("/settings/:key", requireFounder, async (req: any, res: Response) => {
  try {
    const { setSetting } = await import("./services/founderSettings");
    const value = String(req.body?.value ?? "");
    const userId = req.permissionContext?.userId ?? "founder";
    await setSetting(req.params.key, value, userId);
    res.json({ ok: true });
  } catch (err: any) {
    Errors.badRequest(res, err.message);
  }
});

// ── Tool proposals (capability growth) ──────────────────────────────

router.get("/tool-proposals", requireFounder, async (req: Request, res: Response) => {
  try {
    const { listToolProposals } = await import("./services/toolProposals");
    const status = req.query.status as any;
    const proposals = await listToolProposals(status);
    res.json({ proposals });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

router.post("/tool-proposals/:id/resolve", requireFounder, async (req: any, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return Errors.badRequest(res, "Invalid id");
    const { resolveToolProposal } = await import("./services/toolProposals");
    const status = req.body?.status as "approved" | "rejected" | "building" | "shipped";
    if (!["approved", "rejected", "building", "shipped"].includes(status))
      return Errors.badRequest(res, "Invalid status");
    const userId = req.permissionContext?.userId ?? "founder";
    await resolveToolProposal(id, status, req.body?.notes, userId);
    res.json({ ok: true });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// ── Action previews (supervise-in-real-time) ────────────────────────

router.get("/action-previews", requireFounder, async (_req: Request, res: Response) => {
  try {
    const { listPendingPreviews, listRecentPreviews } = await import("./services/actionPreview");
    const [pending, recent] = await Promise.all([listPendingPreviews(), listRecentPreviews()]);
    res.json({ pending, recent });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

router.post("/action-previews/:id/cancel", requireFounder, async (req: any, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return Errors.badRequest(res, "Invalid id");
    const { cancelPreview } = await import("./services/actionPreview");
    const userId = req.permissionContext?.userId ?? "founder";
    await cancelPreview(id, userId, req.body?.reason);
    res.json({ ok: true });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// ── Onboarding autonomy ─────────────────────────────────────────────

router.get("/onboarding/journeys", requireFounder, async (_req: Request, res: Response) => {
  try {
    const { listJourneys, getActivationStats } = await import("./services/onboardingAutonomy");
    const [journeys, stats] = await Promise.all([listJourneys(), getActivationStats()]);
    res.json({ journeys, stats });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

router.get("/onboarding/journeys/:orgId", requireFounder, async (req: Request, res: Response) => {
  try {
    const orgId = parseInt(req.params.orgId, 10);
    if (!Number.isFinite(orgId)) return Errors.badRequest(res, "Invalid orgId");
    const { getJourneyDetail } = await import("./services/onboardingAutonomy");
    const detail = await getJourneyDetail(orgId);
    if (!detail) return Errors.notFound(res, "No journey for that org");
    res.json(detail);
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

router.post("/onboarding/sweep-now", requireFounder, async (_req: Request, res: Response) => {
  try {
    const { sweepAndFireDueSteps } = await import("./services/onboardingAutonomy");
    const result = await sweepAndFireDueSteps();
    res.json(result);
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// ── Expansion radar ─────────────────────────────────────────────────

router.get("/expansion", requireFounder, async (req: Request, res: Response) => {
  try {
    const { listExpansionCandidates } = await import("./services/expansionRadar");
    const status = req.query.status as string | undefined;
    const candidates = await listExpansionCandidates(status);
    res.json({ candidates });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

router.post("/expansion/run-now", requireFounder, async (_req: Request, res: Response) => {
  try {
    const { runWeeklyExpansionScan } = await import("./services/expansionRadar");
    const result = await runWeeklyExpansionScan();
    res.json(result);
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

router.post("/expansion/:id/resolve", requireFounder, async (req: any, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return Errors.badRequest(res, "Invalid id");
    const status = req.body?.status as any;
    if (!["approved", "rejected", "offered", "converted", "declined"].includes(status))
      return Errors.badRequest(res, "Invalid status");
    const { resolveExpansionCandidate } = await import("./services/expansionRadar");
    const userId = req.permissionContext?.userId ?? "founder";
    await resolveExpansionCandidate(id, status, req.body?.notes, userId);
    res.json({ ok: true });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// ── Unified founder todo ────────────────────────────────────────────

router.get("/todo", requireFounder, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { getFounderTodos } = await import("./services/founderTodo");
    // Cascade-aware annotations need an orgId. Founder is org-scoped via
    // their session — use it if present so the feed surfaces autoResolveCandidate
    // hints; falls back gracefully to plain feed if missing.
    const orgId = req.organization?.id ?? req.organizationId;
    const limit = req.query.limit ? Math.min(200, Number(req.query.limit)) : 100;
    const report = await getFounderTodos(orgId, limit);

    // F-D #3 — merge action-queue items into the unified feed with
    // `source: 'action-queue' | 'todo'` provenance tags so the founder
    // sees a single ranked list. The legacy /api/founder/action-queue
    // endpoint stays live for one release while client-side merges
    // settle.
    try {
      const { getActionQueueAsTodos } = await import("./services/founderActionQueue");
      const actionQueueItems = await getActionQueueAsTodos();
      const taggedTodoItems = report.items.map((it) => ({ ...it, source: "todo" as const }));
      const merged = [...taggedTodoItems, ...actionQueueItems].sort((a, b) => b.urgency - a.urgency);
      const limited = merged.slice(0, limit);
      const acByType = actionQueueItems.reduce<Record<string, number>>((acc, it) => {
        acc[it.type] = (acc[it.type] ?? 0) + 1;
        return acc;
      }, {});
      res.json({
        ...report,
        items: limited,
        total: limited.length,
        sources: {
          todo: taggedTodoItems.length,
          actionQueue: actionQueueItems.length,
        },
        byType: { ...report.byType, ...acByType },
      });
      return;
    } catch (err: any) {
      // Don't let action-queue failures block the todo feed.
      logger.warn("[founder-todo] Action-queue merge failed", { metadata: { detail: err.message } });
      res.json(report);
      return;
    }
  } catch (err: any) {
    logger.error("[founder-todo] Error", undefined, { metadata: { detail: err.message } });
    Errors.internal(res, err);
  }
});

// ── Agent LLM traces — action-replay ────────────────────────────────

// GET /traces?agent=pax&limit=50 — list recent traces (metadata only)
router.get("/traces", requireFounder, async (req: Request, res: Response) => {
  try {
    const agent = typeof req.query.agent === "string" ? req.query.agent : undefined;
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 50;
    const { listRecentTraces } = await import("./services/agentLlmTraces");
    const rows = await listRecentTraces({
      agentCodename: agent,
      limit: Number.isFinite(limit) ? limit : 50,
    });
    res.json({ traces: rows });
  } catch (err: any) {
    logger.error("[traces list] Error", undefined, { metadata: { detail: err.message } });
    Errors.internal(res, err);
  }
});

// GET /traces/:id — full trace including prompt + response text
router.get("/traces/:id", requireFounder, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return Errors.badRequest(res, "Invalid id");
    const { getTraceById } = await import("./services/agentLlmTraces");
    const trace = await getTraceById(id);
    if (!trace) return Errors.notFound(res, "Trace");
    res.json({ trace });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// ── Agent memory consolidation ──────────────────────────────────────

router.get("/agent-memory", requireFounder, async (_req: Request, res: Response) => {
  try {
    const { listAllNotes } = await import("./services/agentMemoryConsolidation");
    const notes = await listAllNotes();
    res.json({ notes });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

router.post("/agent-memory/run-now", requireFounder, async (_req: Request, res: Response) => {
  try {
    const { runWeeklyMemoryConsolidation } = await import("./services/agentMemoryConsolidation");
    const result = await runWeeklyMemoryConsolidation();
    res.json(result);
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// ── Provider intelligence ───────────────────────────────────────────

router.get("/providers", requireFounder, async (req: Request, res: Response) => {
  try {
    const { getProviderSummary } = await import("./services/providerIntelligence");
    const windowDays = parseInt((req.query.windowDays as string) ?? "30", 10);
    const summary = await getProviderSummary(Number.isFinite(windowDays) ? windowDays : 30);
    res.json(summary);
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// ── Decision experiments ────────────────────────────────────────────

router.get("/experiments", requireFounder, async (_req: Request, res: Response) => {
  try {
    const { listExperiments } = await import("./services/decisionExperiments");
    const experiments = await listExperiments();
    res.json({ experiments });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

router.get("/experiments/:id", requireFounder, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return Errors.badRequest(res, "Invalid id");
    const { analyzeExperiment } = await import("./services/decisionExperiments");
    const analysis = await analyzeExperiment(id);
    if (!analysis) return Errors.notFound(res, "Not found");
    res.json(analysis);
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

router.post("/experiments", requireFounder, async (req: Request, res: Response) => {
  try {
    const { createExperiment } = await import("./services/decisionExperiments");
    const id = await createExperiment(req.body);
    res.json({ id });
  } catch (err: any) {
    Errors.badRequest(res, err.message);
  }
});

router.post("/experiments/:id/start", requireFounder, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return Errors.badRequest(res, "Invalid id");
    const { startExperiment } = await import("./services/decisionExperiments");
    await startExperiment(id);
    res.json({ ok: true });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

router.post("/experiments/:id/pause", requireFounder, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { pauseExperiment } = await import("./services/decisionExperiments");
    await pauseExperiment(id);
    res.json({ ok: true });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

router.post("/experiments/:id/complete", requireFounder, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { completeExperiment } = await import("./services/decisionExperiments");
    if (!req.body?.winningVariant) return Errors.badRequest(res, "winningVariant required");
    await completeExperiment(id, req.body.winningVariant, req.body.notes);
    res.json({ ok: true });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

router.post("/experiments/:id/abort", requireFounder, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { abortExperiment } = await import("./services/decisionExperiments");
    await abortExperiment(id, req.body?.notes);
    res.json({ ok: true });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

router.post("/experiments/sweep-now", requireFounder, async (_req: Request, res: Response) => {
  try {
    const { sweepAndAutoComplete } = await import("./services/decisionExperiments");
    const result = await sweepAndAutoComplete();
    res.json(result);
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// ── System trends (meta-observability) ──────────────────────────────

router.get("/system-trends", requireFounder, async (req: Request, res: Response) => {
  try {
    const { computeSystemTrends } = await import("./services/systemTrends");
    const windowDays = parseInt((req.query.windowDays as string) ?? "90", 10);
    const report = await computeSystemTrends(Number.isFinite(windowDays) ? windowDays : 90);
    res.json(report);
  } catch (err: any) {
    logger.error("[system-trends] Error", undefined, { metadata: { detail: err.message } });
    Errors.internal(res, err);
  }
});

// ── Global search (command palette) ─────────────────────────────────
// One endpoint backs the ⌘K palette across every founder-side entity.

router.get("/search", requireFounder, async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q ?? "").trim();
    if (q.length < 1) return res.json({ groups: [] });
    const like = `%${q}%`;

    const [decisions, agents, orgs, letters, proposals] = await Promise.all([
      db
        .select({
          id: decisionsInboxItems.id,
          label: decisionsInboxItems.recommendedActionLabel,
          itemType: decisionsInboxItems.itemType,
          status: decisionsInboxItems.status,
          agent: decisionsInboxItems.ownerAgentCodename,
          organizationId: decisionsInboxItems.organizationId,
          urgencyScore: decisionsInboxItems.urgencyScore,
          createdAt: decisionsInboxItems.createdAt,
        })
        .from(decisionsInboxItems)
        .where(
          sql`${decisionsInboxItems.recommendedActionLabel} ILIKE ${like}
            OR ${decisionsInboxItems.ownerAgentCodename} ILIKE ${like}
            OR ${decisionsInboxItems.itemType} ILIKE ${like}`,
        )
        .orderBy(desc(decisionsInboxItems.createdAt))
        .limit(8),
      db
        .select({
          codename: companyAgents.codename,
          title: companyAgents.title,
          wing: companyAgents.wing,
          trustScore: companyAgents.trustScore,
        })
        .from(companyAgents)
        .where(
          sql`${companyAgents.codename} ILIKE ${like}
            OR ${companyAgents.title} ILIKE ${like}
            OR ${companyAgents.wing} ILIKE ${like}`,
        )
        .limit(6),
      db
        .select({
          id: organizations.id,
          name: organizations.name,
          slug: organizations.slug,
          subscriptionTier: organizations.subscriptionTier,
          subscriptionStatus: organizations.subscriptionStatus,
        })
        .from(organizations)
        .where(
          sql`${organizations.name} ILIKE ${like} OR ${organizations.slug} ILIKE ${like}`,
        )
        .limit(6),
      (async () => {
        const { founderLetters } = await import("@shared/schema");
        return db
          .select({
            monthKey: founderLetters.monthKey,
            status: founderLetters.status,
            generatedAt: founderLetters.generatedAt,
          })
          .from(founderLetters)
          .where(sql`${founderLetters.monthKey} ILIKE ${like} OR ${founderLetters.letterMarkdown} ILIKE ${like}`)
          .orderBy(desc(founderLetters.generatedAt))
          .limit(4);
      })(),
      (async () => {
        const { strategicProposals } = await import("@shared/schema");
        return db
          .select({
            id: strategicProposals.id,
            title: strategicProposals.title,
            category: strategicProposals.category,
            status: strategicProposals.status,
            proposedBy: strategicProposals.proposedBy,
            monthKey: strategicProposals.monthKey,
          })
          .from(strategicProposals)
          .where(
            sql`${strategicProposals.title} ILIKE ${like} OR ${strategicProposals.rationale} ILIKE ${like}`,
          )
          .orderBy(desc(strategicProposals.createdAt))
          .limit(5);
      })(),
    ]);

    res.json({
      groups: [
        { key: "decisions", label: "Decisions", items: decisions },
        { key: "agents", label: "Agents", items: agents },
        { key: "organizations", label: "Organizations", items: orgs },
        { key: "letters", label: "Founder letters", items: letters },
        { key: "proposals", label: "Strategic proposals", items: proposals },
      ].filter((g) => g.items.length > 0),
    });
  } catch (err: any) {
    logger.error("[search] Error", undefined, { metadata: { detail: err.message } });
    Errors.internal(res, err);
  }
});

// Single-decision detail fetch with full contextBundle, for the
// "expand row" interaction on the founder decisions page.
router.get("/decision-log/:id", requireFounder, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return Errors.badRequest(res, "Invalid id");
    const [row] = await db
      .select()
      .from(decisionsInboxItems)
      .where(eq(decisionsInboxItems.id, id))
      .limit(1);
    if (!row) return Errors.notFound(res, "Decision");
    res.json({ decision: row });
  } catch (err: any) {
    logger.error("[decision-log detail] Error", undefined, { metadata: { detail: err.message } });
    Errors.internal(res, err);
  }
});

// Reverse an auto-handled decision — flips its status to rejected
// and records a founder_override_action so the learning loop can
// pick it up. The underlying action may not be reversible (a Stripe
// charge is a Stripe charge) — that's why the endpoint is named
// "reverse": it records your objection, so the executor stops doing
// the same thing, not that it rolls back the side effect.
router.post("/decision-log/:id/reverse", requireFounder, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return Errors.badRequest(res, "Invalid id");
    const { reason } = req.body as { reason?: string };
    const [row] = await db
      .select()
      .from(decisionsInboxItems)
      .where(eq(decisionsInboxItems.id, id))
      .limit(1);
    if (!row) return Errors.notFound(res, "Decision");
    await db
      .update(decisionsInboxItems)
      .set({
        status: "rejected",
        founderOverrideAction: "reverse",
        founderModification: reason?.slice(0, 1000) || "founder reversed an auto-handled decision",
        resolvedAt: new Date(),
        resolvedBy: "founder",
        updatedAt: new Date(),
      })
      .where(eq(decisionsInboxItems.id, id));
    // Feed the reversal back into the learning loop.
    try {
      await learnFromOverride({
        agentCodename: row.ownerAgentCodename || "autonomous_executor",
        actionName: row.itemType || "decision",
        originalRecommendation: row.recommendedActionLabel || row.sophieAnalysis || "",
        ceoOverrideAction: "reverse",
        ceoOverrideNotes: reason || "",
        decisionId: id,
      });
    } catch {
      /* non-fatal */
    }
    res.json({ success: true });
  } catch (err: any) {
    logger.error("[decision-log reverse] Error", undefined, { metadata: { detail: err.message } });
    Errors.internal(res, err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SOPHIE ACTIVITY LOG
// ─────────────────────────────────────────────────────────────────────────────

router.get("/sophie-activity", requireFounder, async (req: Request, res: Response) => {
  try {
    const hours = parseInt((req.query.hours as string) ?? "24");
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const autoResolved = await db.query.supportTickets.findMany({
      where: and(
        sql`${supportTickets.resolvedAt} IS NOT NULL`,
        gte(supportTickets.resolvedAt, since),
        eq(supportTickets.assignedAgent, "sophie"),
      ),
      orderBy: desc(supportTickets.resolvedAt),
      limit: 50,
    });

    res.json({
      autoResolutions: autoResolved,
      count: autoResolved.length,
      windowHours: hours,
    });
  } catch (err: any) {
    logger.error("[sophie-activity] Error", undefined, { metadata: { detail: err.message } });
    res.json({ autoResolutions: [], count: 0, windowHours: 24 });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// JOB QUEUE HEALTH
// ─────────────────────────────────────────────────────────────────────────────

const KNOWN_JOBS = [
  { name: "lead_nurturing", displayName: "Lead Nurturing", expectedIntervalMs: 5 * 60 * 1000 },
  { name: "campaign_optimizer", displayName: "Campaign Optimizer", expectedIntervalMs: 5 * 60 * 1000 },
  { name: "finance_agent", displayName: "Finance Agent", expectedIntervalMs: 5 * 60 * 1000 },
  { name: "api_queue", displayName: "API Queue", expectedIntervalMs: 10 * 1000 },
  { name: "alerting", displayName: "Alerting", expectedIntervalMs: 60 * 1000 },
  { name: "digest", displayName: "Customer Digest", expectedIntervalMs: 60 * 60 * 1000 },
  { name: "sequences", displayName: "Sequences", expectedIntervalMs: 5 * 60 * 1000 },
  { name: "scheduled_tasks", displayName: "Scheduled Tasks", expectedIntervalMs: 60 * 1000 },
  { name: "job_queue_worker", displayName: "Job Queue Worker", expectedIntervalMs: 60 * 1000 },
  { name: "deal_hunter_scraping", displayName: "Deal Hunter Scraping", expectedIntervalMs: 60 * 60 * 1000 },
  { name: "distress_recalculation", displayName: "Distress Recalculation", expectedIntervalMs: 60 * 60 * 1000 },
  { name: "voice_learning_refresh", displayName: "Voice Learning Refresh", expectedIntervalMs: 12 * 60 * 60 * 1000 },
  { name: "realtime_alert_sync", displayName: "Realtime Alert Sync", expectedIntervalMs: 5 * 60 * 1000 },
  { name: "county_assessor_ingest", displayName: "County Assessor Ingest", expectedIntervalMs: 24 * 60 * 60 * 1000 },
  { name: "autonomous_deal_machine", displayName: "Autonomous Deal Machine", expectedIntervalMs: 60 * 60 * 1000 },
  { name: "revenue_protection", displayName: "Revenue Protection", expectedIntervalMs: 6 * 60 * 60 * 1000 },
];

router.get("/job-health", requireFounder, async (req: Request, res: Response) => {
  try {
    const now = Date.now();

    const jobs = await Promise.all(KNOWN_JOBS.map(async (job) => {
      const lastSuccess = await db.query.jobHealthLogs.findFirst({
        where: and(eq(jobHealthLogs.jobName, job.name), eq(jobHealthLogs.status, "success")),
        orderBy: desc(jobHealthLogs.runStartedAt),
      });
      const lastFailure = await db.query.jobHealthLogs.findFirst({
        where: and(eq(jobHealthLogs.jobName, job.name), eq(jobHealthLogs.status, "failed")),
        orderBy: desc(jobHealthLogs.runStartedAt),
      });
      const consecutiveFailures = await db.select({ c: count() })
        .from(jobHealthLogs)
        .where(and(
          eq(jobHealthLogs.jobName, job.name),
          eq(jobHealthLogs.status, "failed"),
          lastSuccess ? gte(jobHealthLogs.runStartedAt, lastSuccess.runStartedAt) : sql`1=1`,
        ));

      const failCount = Number(consecutiveFailures[0]?.c ?? 0);
      const lastSuccessMs = lastSuccess?.runStartedAt ? new Date(lastSuccess.runStartedAt).getTime() : null;
      const overdue = lastSuccessMs ? (now - lastSuccessMs) > 2 * job.expectedIntervalMs : true;
      const minutesSinceLastRun = lastSuccessMs ? Math.floor((now - lastSuccessMs) / 60000) : null;

      let status: "healthy" | "warning" | "failing" | "overdue" | "unknown" = "unknown";
      if (failCount >= 3) status = "failing";
      else if (failCount >= 1) status = "warning";
      else if (overdue && lastSuccessMs !== null) status = "overdue";
      else if (!overdue && failCount === 0) status = "healthy";

      return {
        jobName: job.name,
        displayName: job.displayName,
        status,
        lastSuccessAt: lastSuccess?.runStartedAt ?? null,
        lastFailureAt: lastFailure?.runStartedAt ?? null,
        minutesSinceLastRun,
        consecutiveFailures: failCount,
        lastErrorMessage: lastFailure?.errorMessage ?? null,
        expectedIntervalMs: job.expectedIntervalMs,
        overdue,
      };
    }));

    const unhealthyCount = jobs.filter(j => j.status !== "healthy" && j.status !== "unknown").length;
    const overallStatus = unhealthyCount === 0 ? "healthy" : unhealthyCount <= 2 ? "degraded" : "critical";

    res.json({ jobs, overallStatus, unhealthyCount, totalJobs: jobs.length });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

router.post("/job-health/:jobName/restart", requireFounder, async (req: Request, res: Response) => {
  // Async stub — actual restart logic would depend on job infrastructure
  const { jobName } = req.params;
  res.status(202).json({ accepted: true, jobName, message: "Restart signal queued (manual restart via PM2 or Fly.io restart command required)" });
});

// ─────────────────────────────────────────────────────────────────────────────
// REVENUE PROTECTION
// ─────────────────────────────────────────────────────────────────────────────

router.get("/revenue-protection", requireFounder, async (req: Request, res: Response) => {
  try {
    // Pillar 8.6 — revenue protection roll-up is pure-read, route to replica.
    const reader = await dbForReads("founder.intelligence.revenue-protection");

    const riskDistribution = await reader.select({
      band: churnRiskScores.riskBand,
      count: count(),
    })
      .from(churnRiskScores)
      .groupBy(churnRiskScores.riskBand);

    const recentInterventions = await db.query.revenueProtectionInterventions.findMany({
      orderBy: desc(revenueProtectionInterventions.createdAt),
      limit: 20,
    });

    // MRR at risk = sum of monthly_price_cents for orgs in red/critical
    const atRiskOrgIds = await reader.select({ orgId: churnRiskScores.organizationId })
      .from(churnRiskScores)
      .where(sql`${churnRiskScores.riskBand} IN ('red', 'critical')`);
    const mrrAtRiskCents = atRiskOrgIds.length > 0
      ? await reader.select({ total: sum(organizations.monthlyPriceCents) })
          .from(organizations)
          .where(sql`${organizations.id} IN (${atRiskOrgIds.map((r: any) => r.orgId).join(",") || "NULL"})`)
          .then((r: any) => Number(r[0]?.total ?? 0))
      : 0;

    res.json({ riskDistribution, recentInterventions, mrrAtRiskCents });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// FOUNDER DIGEST
// ─────────────────────────────────────────────────────────────────────────────

router.post("/digest/generate", requireFounder, async (req: Request, res: Response) => {
  try {
    const result = await founderDigestService.generate();
    res.json(result);
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

router.get("/digest/history", requireFounder, async (req: Request, res: Response) => {
  try {
    const history = await founderDigestService.getRecentHistory(30);
    res.json(history);
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// BUSINESS INTELLIGENCE
// ─────────────────────────────────────────────────────────────────────────────

router.get("/business-intelligence", requireFounder, async (req: Request, res: Response) => {
  try {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    // Pillar 8.6 — BI roll-up is pure analytics, route to replica.
    const reader = await dbForReads("founder.intelligence.business");

    // ARR: MRR × 12
    const mrrResult = await reader.select({ total: sql<number>`COALESCE(SUM(monthly_price_cents), 0)` })
      .from(organizations)
      .where(sql`${organizations.subscriptionStatus} IN ('active', 'trialing')`);
    const mrrCents = Number(mrrResult[0]?.total ?? 0);
    const arrCents = mrrCents * 12;

    // Churn rate: cancellations last 30d / active orgs
    const activeLast30 = await reader.select({ c: count() })
      .from(organizations)
      .where(sql`${organizations.subscriptionStatus} IN ('active', 'trialing')`);
    const cancellationsLast30 = await reader.select({ c: count() })
      .from(subscriptionEvents)
      .where(and(
        eq(subscriptionEvents.eventType, "subscription_cancelled"),
        gte(subscriptionEvents.createdAt, thirtyDaysAgo),
      ));
    const activeCount = Number(activeLast30[0]?.c ?? 1);
    const cancelCount = Number(cancellationsLast30[0]?.c ?? 0);
    const churnRate = activeCount > 0 ? (cancelCount / activeCount) * 100 : 0;

    // NRR: (revenue end of period) / (revenue start of period) from subscription events
    const upgrades = await reader.select({ total: sum(subscriptionEvents.amountCents) })
      .from(subscriptionEvents)
      .where(and(
        eq(subscriptionEvents.eventType, "subscription_upgraded"),
        gte(subscriptionEvents.createdAt, thirtyDaysAgo),
      ));
    const downgrades = await reader.select({ total: sum(subscriptionEvents.amountCents) })
      .from(subscriptionEvents)
      .where(and(
        eq(subscriptionEvents.eventType, "subscription_downgraded"),
        gte(subscriptionEvents.createdAt, thirtyDaysAgo),
      ));
    const churnRevenue = cancelCount * (mrrCents / (activeCount || 1));
    const nrr = mrrCents > 0
      ? ((mrrCents + Number(upgrades[0]?.total ?? 0) - Number(downgrades[0]?.total ?? 0) - churnRevenue) / mrrCents) * 100
      : 100;

    // Customer health distribution from churnRiskScores
    const healthDist = await reader.select({ band: churnRiskScores.riskBand, count: count() })
      .from(churnRiskScores)
      .groupBy(churnRiskScores.riskBand);

    res.set("Cache-Control", "max-age=3600");
    res.json({
      arrCents,
      mrrCents,
      churnRate: Math.round(churnRate * 100) / 100,
      nrr: Math.round(nrr * 10) / 10,
      customerHealthDistribution: healthDist,
      // LTV:CAC requires founder-entered CAC — return placeholder
      ltvCac: { ltv: null, cac: null, ratio: null, note: "Enter CAC in org settings to enable LTV:CAC" },
    });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/founder/intelligence/company-briefing
// The Sovereign Company Protocol — CEO Briefing
// Aggregates all agent reports into a single synthesized company status
// ─────────────────────────────────────────────────────────────────────────────

router.post("/company-briefing", requireFounder, async (req: Request, res: Response) => {
  try {
    // Check for cached briefing (generated within last 2 hours)
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const cached = await db.select()
      .from(companyBriefingCache)
      .where(gte(companyBriefingCache.generatedAt, twoHoursAgo))
      .orderBy(desc(companyBriefingCache.generatedAt))
      .limit(1);

    if (cached.length > 0 && !req.body?.forceRefresh) {
      return res.json(cached[0].briefingData);
    }

    const now = new Date();
    const yesterday = new Date(now.getTime() - 86400000);

    // 1. Fetch all agents
    const agents = await companyAgentService.getAllIncludingPaused();

    // 2. Gather platform-wide context data in parallel
    const [
      orgStats,
      openTickets,
      criticalAlerts,
      pendingDecisions,
      recentJobHealth,
      recentMessages,
    ] = await Promise.allSettled([
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
        .where(and(
          eq(systemAlerts.severity, "critical"),
          gte(systemAlerts.createdAt, yesterday),
        )),

      db.select()
        .from(decisionsInboxItems)
        .where(eq(decisionsInboxItems.status, "pending"))
        .orderBy(desc(decisionsInboxItems.urgencyScore))
        .limit(10),

      db.select()
        .from(jobHealthLogs)
        .where(gte(jobHealthLogs.runStartedAt, yesterday))
        .orderBy(desc(jobHealthLogs.runStartedAt))
        .limit(50),

      agentCommsService.getRecentMessages(yesterday, 50),
    ]);

    const orgData = orgStats.status === "fulfilled" ? orgStats.value[0] : { total: 0, active: 0, paying: 0 };
    const ticketCount = openTickets.status === "fulfilled" ? openTickets.value[0]?.count || 0 : 0;
    const alertCount = criticalAlerts.status === "fulfilled" ? criticalAlerts.value[0]?.count || 0 : 0;
    const decisions = pendingDecisions.status === "fulfilled" ? pendingDecisions.value : [];
    const jobLogs = recentJobHealth.status === "fulfilled" ? recentJobHealth.value : [];
    const commsMessages = recentMessages.status === "fulfilled" ? recentMessages.value : [];

    // Count job health
    const jobsHealthy = jobLogs.filter((j: any) => j.status === "success").length;
    const jobsFailed = jobLogs.filter((j: any) => j.status === "failed").length;

    // 3. Generate reports for each agent with relevant context
    const contextByAgent: Record<string, Record<string, any>> = {
      atlas_cto: { jobsHealthy, jobsFailed, totalJobs: jobLogs.length },
      sophie_csm: { openTickets: ticketCount, totalOrgs: orgData.total },
      forge_revenue: { payingOrgs: orgData.paying, activeOrgs: orgData.active, totalOrgs: orgData.total },
      beacon_marketing: { totalOrgs: orgData.total, activeOrgs: orgData.active },
      sentinel_devops: { jobsHealthy, jobsFailed, criticalAlerts: alertCount },
      ledger_finance: { payingOrgs: orgData.paying },
      shield_legal: {},
      oracle_analytics: { totalOrgs: orgData.total, payingOrgs: orgData.paying, activeOrgs: orgData.active },
      compass_pm: {},
      crucible_qa: { jobsHealthy, jobsFailed },
    };

    const agentReports = await Promise.allSettled(
      agents
        .filter(a => a.status === "active")
        .map(agent =>
          companyAgentService.generateReport(
            agent.codename,
            contextByAgent[agent.codename] || {}
          )
        )
    );

    const reports = agentReports
      .filter((r): r is PromiseFulfilledResult<any> => r.status === "fulfilled")
      .map(r => r.value);

    // 4. Build overnight activity from agent messages
    const overnightActivity = agents
      .filter(a => a.status === "active")
      .map(agent => ({
        agent: agent.title,
        codename: agent.codename,
        actions: commsMessages
          .filter((m: any) => m.fromAgent === agent.codename)
          .map((m: any) => ({
            description: m.subject,
            autonomous: true,
            timestamp: m.createdAt?.toISOString() || new Date().toISOString(),
          })),
      }))
      .filter(a => a.actions.length > 0);

    // 5. Format pending decisions with agent attribution
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
      deadline: d.deferredUntil?.toISOString(),
    }));

    // 6. Compute composite health score
    const agentHealthScores = reports.map(r => r.healthScore);
    const healthScore = agentHealthScores.length > 0
      ? Math.round(agentHealthScores.reduce((a: number, b: number) => a + b, 0) / agentHealthScores.length)
      : 80;

    const mood = healthScore >= 80 ? "green" : healthScore >= 60 ? "yellow" : "red";

    // 7. Extract wins and upcoming items
    const wins = reports
      .flatMap(r => (r.alerts || []).filter((a: any) => a.level === "info"))
      .map((a: any) => a.message)
      .slice(0, 5);

    // 8. Build the full briefing
    const briefing = {
      generatedAt: now.toISOString(),
      healthScore,
      mood,
      overnightActivity,
      agentReports: reports,
      decisionsNeeded,
      wins,
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

    // 9. Cache the briefing
    await db.insert(companyBriefingCache).values({
      briefingData: briefing,
      healthScore,
      mood,
    });

    res.json(briefing);
  } catch (err: any) {
    logger.error("[company-briefing] Error", undefined, { metadata: { detail: err.message } });
    res.json({
      healthScore: 0,
      mood: "yellow",
      headline: "Briefing temporarily unavailable",
      summary: "Unable to generate company briefing at this time.",
      decisions: [],
      reports: [],
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/founder/intelligence/company-agents
// List all company agents with their current state
// ─────────────────────────────────────────────────────────────────────────────

router.get("/company-agents", requireFounder, async (req: Request, res: Response) => {
  try {
    const agents = await companyAgentService.getAllIncludingPaused();
    res.json(agents);
  } catch (err: any) {
    logger.error("[company-agents] Error", undefined, { metadata: { detail: err.message } });
    res.json([]);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/founder/intelligence/company-agents/:codename/status
// Pause/resume an agent — CEO override
// ─────────────────────────────────────────────────────────────────────────────

router.patch("/company-agents/:codename/status", requireFounder, async (req: Request, res: Response) => {
  try {
    const { codename } = req.params;
    const { status } = req.body;

    if (!["active", "paused", "disabled"].includes(status)) {
      return Errors.badRequest(res, "Status must be active, paused, or disabled");
    }

    await companyAgentService.setStatus(codename, status);

    // Broadcast the status change
    await agentCommsService.broadcast({
      from: "ceo",
      channel: "incidents",
      priority: "high",
      subject: `Agent ${codename} ${status === "paused" ? "paused" : status === "active" ? "resumed" : "disabled"} by CEO`,
      body: `The CEO has set ${codename} to ${status}.`,
    });

    res.json({ success: true, codename, status });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/founder/intelligence/agent-chat
// Talk to your company — direct agent chat
// ─────────────────────────────────────────────────────────────────────────────

router.post("/agent-chat", requireFounder, async (req: Request, res: Response) => {
  try {
    const { message, targetAgent, conversationId: clientConvId } = req.body;

    if (!message) {
      return Errors.badRequest(res, "Message is required");
    }

    // v6: Route CEO commands through the command bridge FIRST
    // Commands like "pause marketing", "show forecast", "how is Acme" get executed immediately
    // Only falls through to agent chat if it's not a recognized command
    try {
      const { processCEOCommand } = await import("./services/ceoCommandBridge");
      const commandResult = await processCEOCommand(message);

      if (commandResult.understood) {
        // Save command + result to conversation history
        const conversationId = clientConvId || `cmd_${Date.now()}`;
        try {
          await db.insert(agentConversations).values([
            { conversationId, agentCodename: "system", role: "user", content: message },
            { conversationId, agentCodename: "system", role: "assistant", content: commandResult.result },
          ] as any);
        } catch {}

        return res.json({
          response: commandResult.result,
          agent: "system",
          agentTitle: "Command",
          conversationId,
          isCommand: true,
          commandAction: commandResult.action,
          commandData: commandResult.data,
        });
      }
    } catch (cmdErr) {
      // Command bridge failed — fall through to normal agent chat
      logger.warn("[agent-chat] Command bridge error, falling through", { metadata: { detail: (cmdErr as any).message } });
    }

    // Agent lookup table
    const AGENT_NAMES: Record<string, string> = {
      atlas: "atlas_cto", sophie: "sophie_csm", forge: "forge_revenue",
      beacon: "beacon_marketing", sentinel: "sentinel_devops", ledger: "ledger_finance",
      shield: "shield_legal", oracle: "oracle_analytics", compass: "compass_pm", crucible: "crucible_qa",
    };

    let agentCodename = targetAgent;
    if (!agentCodename) {
      // v4: AI-based agent routing — classify intent with DeepSeek instead of regex matching
      try {
        const classificationResult = await routeAITask({
          taskType: "agent_routing",
          complexity: TaskComplexity.SIMPLE,
          taskTier: "background", // internal classification
          preferredModel: "deepseek",
          messages: [
            {
              role: "system" as const,
              content: `You are a message router for an AI executive team. Given a CEO's message, determine which agent should handle it based on the message's INTENT, not just keywords.

Available agents and their domains:
- atlas_cto: Engineering, architecture, technical decisions, code, deployments, infrastructure strategy
- sophie_csm: Customer support, tickets, user issues, onboarding, customer satisfaction
- forge_revenue: Revenue, sales, deals, pricing, MRR, pipeline, conversion
- beacon_marketing: Marketing, campaigns, email, SMS, brand, content, growth marketing
- sentinel_devops: DevOps, monitoring, uptime, jobs, alerts, server health, CI/CD
- ledger_finance: Finance, costs, billing, AI spend, budgets, accounting, invoices
- shield_legal: Legal, compliance, terms of service, privacy, contracts
- oracle_analytics: Analytics, metrics, reports, data trends, dashboards, KPIs
- compass_pm: Product management, roadmap, features, prioritization, user stories
- crucible_qa: Quality assurance, testing, bugs, regression, test coverage

Respond with ONLY the agent codename (e.g. "forge_revenue") or "team" if the message is general and doesn't map to a specific agent. Nothing else.`,
            },
            { role: "user" as const, content: message },
          ],
        });

        const routedAgent = classificationResult.content?.trim().toLowerCase();
        if (routedAgent && routedAgent !== "team" && Object.values(AGENT_NAMES).includes(routedAgent)) {
          agentCodename = routedAgent;
        }
      } catch (routingErr: any) {
        // Fallback to simple name-prefix matching if AI routing fails
        logger.error("[agent-chat] AI routing failed, falling back to prefix match", undefined, { metadata: { detail: routingErr.message } });
        const lowerMsg = message.toLowerCase();
        for (const [name, code] of Object.entries(AGENT_NAMES)) {
          if (lowerMsg.startsWith(name + ",") || lowerMsg.startsWith(name + " ")) {
            agentCodename = code;
            break;
          }
        }
      }
    }

    // CEO override commands
    const lowerMsg = message.toLowerCase().trim();
    for (const cmd of ["pause", "resume"] as const) {
      if (lowerMsg.startsWith(cmd + " ")) {
        const name = lowerMsg.replace(cmd + " ", "").trim();
        const code = AGENT_NAMES[name];
        if (code) {
          await companyAgentService.setStatus(code, cmd === "pause" ? "paused" : "active");
          return res.json({
            response: `${name.charAt(0).toUpperCase() + name.slice(1)} has been ${cmd === "pause" ? "paused" : "resumed"}.`,
            agent: code, action: cmd === "pause" ? "paused" : "resumed",
          });
        }
      }
    }

    // v2: Resolve LIVE data for grounded conversations
    let liveDataStr = "";
    let systemPrompt = "You are a member of the AcreOS AI executive team. Answer the CEO's question helpfully and in character.";
    let agentTitle = "AI Team";

    if (agentCodename) {
      const agent = await companyAgentService.getByCodename(agentCodename);
      if (agent) {
        systemPrompt = agent.personalityPrompt || systemPrompt;
        agentTitle = agent.title;
        await companyAgentService.recordActivity(agentCodename);

        // Resolve live data from agent's owned services
        try {
          const { resolveAgentData } = await import("./agentDataResolvers");
          const liveData = await resolveAgentData(agentCodename);
          liveDataStr = Object.entries(liveData)
            .map(([k, v]) => `${k}: ${v}`)
            .join("\n");
        } catch {}
      }
    }

    // v2: Load conversation history for persistence
    const conversationId = clientConvId || `chat_${Date.now()}`;
    let historyMessages: Array<{ role: string; content: string }> = [];
    if (clientConvId) {
      try {
        const history = await db.select()
          .from(agentConversations)
          .where(eq(agentConversations.conversationId, clientConvId))
          .orderBy(agentConversations.createdAt)
          .limit(20);
        historyMessages = history.map((h: any) => ({ role: h.role, content: h.content }));
      } catch {}
    }

    // Build the full prompt with live data context
    const dataSection = liveDataStr ? `\n\nYOUR LIVE METRICS (real-time from your services):\n${liveDataStr}\n` : "";

    const messages = [
      { role: "system" as const, content: systemPrompt + dataSection },
      ...historyMessages,
      {
        role: "user" as const,
        content: `The CEO is asking you directly. Respond in character as ${agentTitle}. Use your live metrics to answer with real numbers. Be concise but thorough.\n\nCEO: ${message}`,
      },
    ];

    const aiResponse = await routeAITask({
      taskType: "agent_chat",
      complexity: TaskComplexity.MODERATE,
      taskTier: "standard", // founder-internal agent chat
      messages,
    });

    // v2: Save conversation for persistence
    try {
      await db.insert(agentConversations).values([
        { conversationId, agentCodename, role: "user", content: message },
        { conversationId, agentCodename, role: "assistant", content: aiResponse.content },
      ] as any);
    } catch {}

    res.json({
      response: aiResponse.content,
      agent: agentCodename || "team",
      agentTitle,
      conversationId,
      dataUsed: !!liveDataStr,
    });
  } catch (err: any) {
    logger.error("[agent-chat] Error", err);
    Errors.internal(res, err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/founder/intelligence/agent-messages
// View inter-agent communication feed
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// AGENT GOALS — CEO task delegation
// ─────────────────────────────────────────────────────────────────────────────

router.post("/agent-goals", requireFounder, async (req: Request, res: Response) => {
  try {
    const { assignedAgent, goal, successCriteria, priority, deadline } = req.body;
    if (!assignedAgent || !goal) return Errors.badRequest(res, "assignedAgent and goal required");

    const { createGoal } = await import("./services/agentGoalManager");
    const goalId = await createGoal({
      assignedAgent,
      assignedBy: "ceo",
      goal,
      successCriteria,
      priority,
      deadline: deadline ? new Date(deadline) : undefined,
    });
    res.json({ success: true, goalId });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

router.get("/agent-goals", requireFounder, async (req: Request, res: Response) => {
  try {
    const { agent, status } = req.query;
    const { getGoals } = await import("./services/agentGoalManager");
    const goals = await getGoals({
      agentCodename: agent as string,
      status: status as string,
    });
    res.json(goals);
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

router.patch("/agent-goals/:id", requireFounder, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const { action, priority, reason } = req.body;

    if (action === "cancel") {
      const { cancelGoal } = await import("./services/agentGoalManager");
      await cancelGoal(id, reason);
    } else if (action === "reprioritize" && priority) {
      const { reprioritizeGoal } = await import("./services/agentGoalManager");
      await reprioritizeGoal(id, priority);
    } else {
      return Errors.badRequest(res, "Valid action required: cancel or reprioritize");
    }
    res.json({ success: true });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// AGENT ACTION LOG — audit trail
// ─────────────────────────────────────────────────────────────────────────────

router.get("/agent-actions/:codename", requireFounder, async (req: Request, res: Response) => {
  try {
    const { codename } = req.params;
    const limit = parseInt(req.query.limit as string) || 50;
    const actions = await db.select()
      .from(agentActionLog)
      .where(eq(agentActionLog.agentCodename, codename))
      .orderBy(desc(agentActionLog.createdAt))
      .limit(limit);
    res.json(actions);
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// AGENT TRUST HISTORY — for charts
// ─────────────────────────────────────────────────────────────────────────────

router.get("/agent-trust-history/:codename", requireFounder, async (req: Request, res: Response) => {
  try {
    const { codename } = req.params;
    const history = await db.select()
      .from(trustEvolutionLog)
      .where(eq(trustEvolutionLog.agentCodename, codename))
      .orderBy(desc(trustEvolutionLog.createdAt))
      .limit(52); // 1 year of weekly data
    res.json(history);
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// AGENT DETAIL — full agent profile data
// ─────────────────────────────────────────────────────────────────────────────

router.get("/company-agents/:codename/detail", requireFounder, async (req: Request, res: Response) => {
  try {
    const { codename } = req.params;
    const agent = await companyAgentService.getByCodename(codename);
    if (!agent) return Errors.notFound(res, "Agent");

    // Resolve live data
    const { resolveAgentData } = await import("./services/agentDataResolvers");
    const liveData = await resolveAgentData(codename);

    // Get recent actions
    const recentActions = await db.select()
      .from(agentActionLog)
      .where(eq(agentActionLog.agentCodename, codename))
      .orderBy(desc(agentActionLog.createdAt))
      .limit(20);

    // Get active goals
    const { getGoals } = await import("./services/agentGoalManager");
    const goals = await getGoals({ agentCodename: codename, limit: 10 });

    // Get trust history
    const trustHistory = await db.select()
      .from(trustEvolutionLog)
      .where(eq(trustEvolutionLog.agentCodename, codename))
      .orderBy(desc(trustEvolutionLog.createdAt))
      .limit(20);

    // Get attributed decisions
    const decisions = await db.select()
      .from(decisionsInboxItems)
      .where(eq(decisionsInboxItems.ownerAgentCodename, codename))
      .orderBy(desc(decisionsInboxItems.createdAt))
      .limit(20);

    res.json({
      agent,
      liveData,
      recentActions,
      goals,
      trustHistory,
      decisions,
    });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/founder/intelligence/agent-messages
// View inter-agent communication feed
// ─────────────────────────────────────────────────────────────────────────────

router.get("/agent-messages", requireFounder, async (req: Request, res: Response) => {
  try {
    const hoursBack = parseInt(req.query.hours as string) || 24;
    const channel = req.query.channel as string;

    const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000);

    let messages;
    if (channel) {
      messages = await agentCommsService.getMessages(channel as any, since);
    } else {
      messages = await agentCommsService.getRecentMessages(since);
    }

    const channelActivity = await agentCommsService.getChannelActivity(hoursBack);

    res.json({ messages, channelActivity });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// v4 API ROUTES
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/founder/intelligence/activity-timeline
// Full activity timeline across all agents with undo availability
// ─────────────────────────────────────────────────────────────────────────────

router.get("/activity-timeline", requireFounder, async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const agentFilter = req.query.agent as string;
    const cursor = req.query.cursor ? parseInt(req.query.cursor as string) : null;

    // Build query conditions
    const conditions = [];
    if (agentFilter) {
      conditions.push(eq(agentActionLog.agentCodename, agentFilter));
    }
    if (cursor) {
      conditions.push(lt(agentActionLog.id, cursor));
    }

    // Query agent actions with left join to undo log.
    // The select previously referenced agentActionLog.description and
    // agentActionLog.metadata — neither exists on the schema (real
    // columns are reasoning, input, output, confidence, …). Drizzle's
    // prepare phase ran Object.entries() over the projection object and
    // hit the undefined column references, throwing "Cannot convert
    // undefined or null to object" on every call. Mapped to the actual
    // columns; the response below derives description and metadata from
    // reasoning + output so the API contract stays the same.
    const baseSelect = db
      .select({
        id: agentActionLog.id,
        agentCodename: agentActionLog.agentCodename,
        actionName: agentActionLog.actionName,
        actionType: agentActionLog.actionType,
        reasoning: agentActionLog.reasoning,
        output: agentActionLog.output,
        outcome: agentActionLog.outcome,
        createdAt: agentActionLog.createdAt,
        undoAvailable: agentActionUndoLog.undoAvailable,
        undoExpiry: agentActionUndoLog.undoExpiry,
        undoExecutedAt: agentActionUndoLog.undoExecutedAt,
      })
      .from(agentActionLog)
      .leftJoin(agentActionUndoLog, eq(agentActionUndoLog.actionLogId, agentActionLog.id));

    const entries = conditions.length > 0
      ? await baseSelect
          .where(and(...conditions))
          .orderBy(desc(agentActionLog.createdAt))
          .limit(limit + 1)
      : await baseSelect
          .orderBy(desc(agentActionLog.createdAt))
          .limit(limit + 1);

    const hasMore = entries.length > limit;
    const results = entries.slice(0, limit);

    // Get agent display names
    const agents = await companyAgentService.getAllIncludingPaused();
    const agentNames = Object.fromEntries(agents.map(a => [a.codename, a.title]));

    // Group entries by time blocks (today, yesterday, this week, older)
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterdayStart = new Date(todayStart.getTime() - 86400000);
    const weekStart = new Date(todayStart.getTime() - 7 * 86400000);

    const grouped: Record<string, any[]> = { today: [], yesterday: [], thisWeek: [], older: [] };

    for (const entry of results) {
      const entryDate = new Date(entry.createdAt);
      const canUndo = entry.undoAvailable && !entry.undoExecutedAt &&
        (!entry.undoExpiry || new Date(entry.undoExpiry) > now);

      const formatted = {
        id: entry.id,
        agentCodename: entry.agentCodename,
        agentName: agentNames[entry.agentCodename] || entry.agentCodename,
        actionName: entry.actionName,
        actionType: entry.actionType,
        // description was a missing column on the schema; derive from
        // reasoning so the client contract stays the same.
        description: entry.reasoning,
        outcome: entry.outcome,
        // metadata was a missing column too; surface the action's output
        // jsonb, which carries the per-action details.
        metadata: entry.output,
        createdAt: entry.createdAt,
        canUndo,
        undoExpiry: entry.undoExpiry,
      };

      if (entryDate >= todayStart) grouped.today.push(formatted);
      else if (entryDate >= yesterdayStart) grouped.yesterday.push(formatted);
      else if (entryDate >= weekStart) grouped.thisWeek.push(formatted);
      else grouped.older.push(formatted);
    }

    const nextCursor = hasMore ? results[results.length - 1]?.id : null;

    res.json({
      entries: results.map(entry => {
        const entryDate = new Date(entry.createdAt);
        const canUndo = entry.undoAvailable && !entry.undoExecutedAt &&
          (!entry.undoExpiry || new Date(entry.undoExpiry) > now);
        return {
          id: entry.id,
          agentCodename: entry.agentCodename,
          agentName: agentNames[entry.agentCodename] || entry.agentCodename,
          actionName: entry.actionName,
          actionType: entry.actionType,
          description: entry.reasoning,
          outcome: entry.outcome,
          metadata: entry.output,
          createdAt: entry.createdAt,
          canUndo,
          undoExpiry: entry.undoExpiry,
        };
      }),
      grouped,
      nextCursor,
      hasMore,
    });
  } catch (err: any) {
    logger.error("[activity-timeline] Error", err);
    Errors.internal(res, err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/founder/intelligence/undo/:actionLogId
// Undo a specific agent action
// ─────────────────────────────────────────────────────────────────────────────

router.post("/undo/:actionLogId", requireFounder, async (req: Request, res: Response) => {
  try {
    const actionLogId = parseInt(req.params.actionLogId);
    if (isNaN(actionLogId)) {
      return Errors.badRequest(res, "Invalid actionLogId");
    }
    const result = await executeUndo(actionLogId);
    res.json(result);
  } catch (err: any) {
    logger.error("[undo] Error", err);
    Errors.internal(res, err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/founder/intelligence/trends
// Weekly or monthly trend analysis
// ─────────────────────────────────────────────────────────────────────────────

router.get("/trends", requireFounder, async (req: Request, res: Response) => {
  try {
    const period = (req.query.period as string) || "week";
    const trends = period === "month"
      ? await getMonthlyTrends()
      : await getWeeklyTrends();
    res.json({ period, trends });
  } catch (err: any) {
    logger.error("[trends] Error", err);
    Errors.internal(res, err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// STRATEGIC PRIORITIES — CRUD
// ─────────────────────────────────────────────────────────────────────────────

router.get("/priorities", requireFounder, async (req: Request, res: Response) => {
  try {
    const priorities = await getActivePriorities();
    res.json(priorities);
  } catch (err: any) {
    logger.error("[priorities] Error", err);
    Errors.internal(res, err);
  }
});

router.post("/priorities", requireFounder, async (req: Request, res: Response) => {
  try {
    const { priority, description, weight } = req.body;
    if (!priority) {
      return Errors.badRequest(res, "priority is required");
    }
    const result = await createPriority({ priority, description, weight });
    res.json({ success: true, ...result });
  } catch (err: any) {
    logger.error("[priorities] Error", err);
    Errors.internal(res, err);
  }
});

router.delete("/priorities/:id", requireFounder, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return Errors.badRequest(res, "Invalid priority id");
    }
    await deactivatePriority(id);
    res.json({ success: true });
  } catch (err: any) {
    logger.error("[priorities] Error", err);
    Errors.internal(res, err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// QUIET HOURS — configuration
// ─────────────────────────────────────────────────────────────────────────────

router.get("/quiet-hours", requireFounder, async (req: Request, res: Response) => {
  try {
    const config = await getQuietHoursConfig();
    res.json(config);
  } catch (err: any) {
    logger.error("[quiet-hours] Error", err);
    Errors.internal(res, err);
  }
});

router.put("/quiet-hours", requireFounder, async (req: Request, res: Response) => {
  try {
    const { startHour, endHour, timezone, isActive } = req.body;
    if (startHour === undefined || endHour === undefined) {
      return Errors.badRequest(res, "startHour and endHour are required");
    }
    await setQuietHours({ startHour, endHour, timezone, isActive });
    res.json({ success: true });
  } catch (err: any) {
    logger.error("[quiet-hours] Error", err);
    Errors.internal(res, err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/founder/intelligence/chat-history
// Retrieve agent conversation history
// ─────────────────────────────────────────────────────────────────────────────

router.get("/chat-history", requireFounder, async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const conversationId = req.query.conversationId as string;

    // Get agent display names for metadata
    const agents = await companyAgentService.getAllIncludingPaused();
    const agentNames = Object.fromEntries(agents.map(a => [a.codename, { title: a.title, wing: a.wing }]));

    if (conversationId) {
      // Return messages for a specific conversation
      const messages = await db.select()
        .from(agentConversations)
        .where(eq(agentConversations.conversationId, conversationId))
        .orderBy(agentConversations.createdAt)
        .limit(limit);

      res.json({
        conversationId,
        messages: messages.map((m: any) => ({
          ...m,
          agentMeta: m.agentCodename ? agentNames[m.agentCodename] || null : null,
        })),
      });
    } else {
      // Return recent conversations grouped by conversationId
      const recentMessages = await db.select()
        .from(agentConversations)
        .orderBy(desc(agentConversations.createdAt))
        .limit(limit);

      // Group by conversationId and pick latest message per conversation
      const conversationMap = new Map<string, any>();
      for (const msg of recentMessages) {
        const convId = (msg as any).conversationId;
        if (!conversationMap.has(convId)) {
          conversationMap.set(convId, {
            conversationId: convId,
            agentCodename: (msg as any).agentCodename,
            agentMeta: (msg as any).agentCodename ? agentNames[(msg as any).agentCodename] || null : null,
            lastMessage: msg,
            createdAt: (msg as any).createdAt,
          });
        }
      }

      res.json({
        conversations: Array.from(conversationMap.values()),
        total: conversationMap.size,
      });
    }
  } catch (err: any) {
    logger.error("[chat-history] Error", err);
    Errors.internal(res, err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/founder/intelligence/command — v5 CEO Natural Language Commands
// CEO says "pause all marketing" and it actually happens.
// ─────────────────────────────────────────────────────────────────────────────

router.post("/command", requireFounder, async (req: Request, res: Response) => {
  try {
    const { input } = req.body;
    if (!input || typeof input !== "string") {
      return Errors.badRequest(res, "Missing 'input' string in request body");
    }

    const { processCEOCommand } = await import("./services/ceoCommandBridge");
    const result = await processCEOCommand(input);

    res.json(result);
  } catch (err: any) {
    logger.error("[command] Error", err);
    Errors.internal(res, err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/founder/intelligence/forecast — v5 MRR Projections & Runway
// ─────────────────────────────────────────────────────────────────────────────

router.get("/forecast", requireFounder, async (req: Request, res: Response) => {
  try {
    const { projectMRR, calculateRunway, calculateUnitEconomics } = await import("./services/financialForecaster");

    const [mrrProjection, runway, unitEconomics] = await Promise.all([
      projectMRR(),
      calculateRunway(),
      calculateUnitEconomics(),
    ]);

    res.json({
      mrr: mrrProjection,
      runway,
      unitEconomics,
    });
  } catch (err: any) {
    logger.error("[forecast] Error", err);
    Errors.internal(res, err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/founder/intelligence/customer-health — v5 Customer Health Scores
// ─────────────────────────────────────────────────────────────────────────────

router.get("/customer-health", requireFounder, async (req: Request, res: Response) => {
  try {
    const { getAllCustomerHealth, getHealthSummary } = await import("./services/customerHealthScoring");
    const limit = parseInt(req.query.limit as string) || 20;

    const [customers, summary] = await Promise.all([
      getAllCustomerHealth(limit),
      getHealthSummary(),
    ]);

    res.json({ customers, summary });
  } catch (err: any) {
    logger.error("[customer-health] Error", err);
    Errors.internal(res, err);
  }
});

// GET /api/founder/intelligence/customer-health/:orgId — Single customer health
router.get("/customer-health/:orgId", requireFounder, async (req: Request, res: Response) => {
  try {
    const orgId = parseInt(req.params.orgId);
    if (isNaN(orgId)) return Errors.badRequest(res, "Invalid org ID");

    const { getCustomerHealth } = await import("./services/customerHealthScoring");
    const health = await getCustomerHealth(orgId);

    if (!health) return Errors.notFound(res, "Customer");
    res.json(health);
  } catch (err: any) {
    logger.error("[customer-health] Error", err);
    Errors.internal(res, err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/founder/intelligence/delegations — v5 Active Delegations
// POST /api/founder/intelligence/delegations — Grant temporary authority
// DELETE /api/founder/intelligence/delegations/:id — Revoke delegation
// ─────────────────────────────────────────────────────────────────────────────

router.get("/delegations", requireFounder, async (req: Request, res: Response) => {
  try {
    const { getActiveDelegations } = await import("./services/temporaryDelegation");
    res.json({ delegations: getActiveDelegations() });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

router.post("/delegations", requireFounder, async (req: Request, res: Response) => {
  try {
    const { agentCodename, actions, toLevel, durationHours, reason } = req.body;
    if (!agentCodename || !durationHours) {
      return Errors.badRequest(res, "agentCodename and durationHours required");
    }

    const { grantTemporaryAuthority } = await import("./services/temporaryDelegation");
    const delegation = grantTemporaryAuthority({
      agentCodename,
      actions,
      toLevel,
      durationHours,
      reason: reason || "CEO delegation",
    });

    res.json({ delegation });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

router.delete("/delegations/:id", requireFounder, async (req: Request, res: Response) => {
  try {
    const { revokeDelegation } = await import("./services/temporaryDelegation");
    const success = revokeDelegation(req.params.id);
    res.json({ success, message: success ? "Delegation revoked" : "Delegation not found" });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// v6: CEO Reminders
router.get("/reminders", requireFounder, async (req: Request, res: Response) => {
  try {
    const { getPendingReminders, getDueReminders } = await import("./services/ceoReminders");
    const [pending, due] = await Promise.all([getPendingReminders(), getDueReminders()]);
    res.json({ pending, due });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

router.delete("/reminders/:id", requireFounder, async (req: Request, res: Response) => {
  try {
    const { dismissReminder } = await import("./services/ceoReminders");
    const success = await dismissReminder(req.params.id);
    res.json({ success });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

export default router;
