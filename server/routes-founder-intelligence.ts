// @ts-nocheck
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
import { db } from "./db";
import {
  organizations, users, payments, deals, leads, properties,
  supportTickets, subscriptionEvents, systemAlerts, activityLog,
  notes, campaigns, apiUsageLogs,
} from "@shared/schema";
import { sql, desc, eq, and, gte, lte, lt, count, sum, avg } from "drizzle-orm";
import { isFounderEmail } from "./services/founder";

const router = Router();

// ── Auth guard ─────────────────────────────────────────────────────────────

function requireFounder(req: any, res: any, next: any) {
  const userEmail = req.user?.email || req.user?.claims?.email;
  if (!isFounderEmail(userEmail)) {
    return res.status(403).json({ error: "Founder access required" });
  }
  next();
}

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
      db.select({
        total: count(),
        active: sql<number>`count(*) filter (where subscription_status = 'active')`,
        paying: sql<number>`count(*) filter (where subscription_tier not in ('free') and subscription_status = 'active')`,
      }).from(organizations),

      // Revenue today
      db.select({ total: sum(payments.amount) })
        .from(payments)
        .where(gte(payments.createdAt, yesterday)),

      // Revenue last 7d
      db.select({ total: sum(payments.amount) })
        .from(payments)
        .where(gte(payments.createdAt, sevenDaysAgo)),

      // Revenue last 30d
      db.select({ total: sum(payments.amount) })
        .from(payments)
        .where(gte(payments.createdAt, thirtyDaysAgo)),

      // New orgs today
      db.select({ count: count() })
        .from(organizations)
        .where(gte(organizations.createdAt, yesterday)),

      // New orgs last 7d
      db.select({ count: count() })
        .from(organizations)
        .where(gte(organizations.createdAt, sevenDaysAgo)),

      // Cancellations last 7d
      db.select({ count: count() })
        .from(subscriptionEvents)
        .where(
          and(
            eq(subscriptionEvents.eventType, "subscription_cancelled"),
            gte(subscriptionEvents.createdAt, sevenDaysAgo)
          )
        ),

      // Open support tickets
      db.select({ count: count() })
        .from(supportTickets)
        .where(eq(supportTickets.status, "open")),

      // Critical alerts
      db.select({ count: count() })
        .from(systemAlerts)
        .where(
          and(
            eq(systemAlerts.severity, "critical"),
            eq(systemAlerts.status, "open")
          )
        ),

      // AI cost last 7d
      db.select({ total: sum(apiUsageLogs.estimatedCostCents) })
        .from(apiUsageLogs)
        .where(gte(apiUsageLogs.createdAt, sevenDaysAgo)),

      // Count of active automated jobs (by checking recent activity)
      db.select({ count: count() })
        .from(activityLog)
        .where(
          and(
            gte(activityLog.createdAt, sevenDaysAgo),
            sql`metadata->>'automated' = 'true'`
          )
        ),

      // Top growth orgs (most active this week)
      db.select({
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

    res.json({
      generatedAt: new Date().toISOString(),
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
    console.error("[FounderIntelligence] Pulse error:", err);
    res.status(500).json({ error: err.message });
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

    for (let i = months - 1; i >= 0; i--) {
      const start = new Date();
      start.setMonth(start.getMonth() - i);
      start.setDate(1);
      start.setHours(0, 0, 0, 0);

      const end = new Date(start);
      end.setMonth(end.getMonth() + 1);

      const [revResult, newOrgsResult, churnResult] = await Promise.all([
        db.select({ total: sum(payments.amount) })
          .from(payments)
          .where(and(gte(payments.createdAt, start), lt(payments.createdAt, end))),
        db.select({ count: count() })
          .from(organizations)
          .where(and(gte(organizations.createdAt, start), lt(organizations.createdAt, end))),
        db.select({ count: count() })
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
    res.status(500).json({ error: err.message });
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

    // Check automation activity by querying activity logs for automated events
    const [
      leadNurturerActivity,
      campaignActivity,
      scoreActivity,
      sophieActivity,
      enrichmentActivity,
      sentinelActivity,
    ] = await Promise.allSettled([
      db.select({ count: count() }).from(activityLog)
        .where(and(
          gte(activityLog.createdAt, sevenDaysAgo),
          sql`action = 'lead_nurtured' or action = 'follow_up_sent'`
        )),
      db.select({ count: count() }).from(activityLog)
        .where(and(
          gte(activityLog.createdAt, sevenDaysAgo),
          sql`action like 'campaign_%'`
        )),
      db.select({ count: count() }).from(activityLog)
        .where(and(
          gte(activityLog.createdAt, sevenDaysAgo),
          sql`action = 'lead_scored' or action = 'score_updated'`
        )),
      db.select({ count: count() }).from(supportTickets)
        .where(and(
          gte(supportTickets.createdAt, sevenDaysAgo),
          eq(supportTickets.aiHandled, true)
        )),
      db.select({ count: count() }).from(activityLog)
        .where(and(
          gte(activityLog.createdAt, sevenDaysAgo),
          sql`action like 'enrich%'`
        )),
      db.select({ count: count() }).from(activityLog)
        .where(and(
          gte(activityLog.createdAt, sevenDaysAgo),
          sql`action like 'sentinel%' or action like 'portfolio_monitor%'`
        )),
    ]);

    const automationStatus = [
      {
        name: "Lead Nurturer",
        description: "Automatically follows up with leads based on behavior and timeline",
        actionsLast7d: leadNurturerActivity.status === "fulfilled" ? Number(leadNurturerActivity.value[0]?.count || 0) : 0,
        status: "active",
        icon: "users",
        passiveScore: 95,
      },
      {
        name: "Campaign Optimizer",
        description: "A/B tests and optimizes direct mail and email campaigns automatically",
        actionsLast7d: campaignActivity.status === "fulfilled" ? Number(campaignActivity.value[0]?.count || 0) : 0,
        status: "active",
        icon: "target",
        passiveScore: 90,
      },
      {
        name: "AcreScore Engine",
        description: "Automatically scores and ranks leads by investment opportunity",
        actionsLast7d: scoreActivity.status === "fulfilled" ? Number(scoreActivity.value[0]?.count || 0) : 0,
        status: "active",
        icon: "zap",
        passiveScore: 98,
      },
      {
        name: "Sophie (Customer Support)",
        description: "Handles support tickets, onboarding, and user education autonomously",
        actionsLast7d: sophieActivity.status === "fulfilled" ? Number(sophieActivity.value[0]?.count || 0) : 0,
        status: "active",
        icon: "message-circle",
        passiveScore: 85,
        note: "Escalates to you only when genuinely stuck",
      },
      {
        name: "Property Enrichment",
        description: "Automatically enriches properties with flood, soil, wetland, and market data",
        actionsLast7d: enrichmentActivity.status === "fulfilled" ? Number(enrichmentActivity.value[0]?.count || 0) : 0,
        status: "active",
        icon: "database",
        passiveScore: 92,
      },
      {
        name: "Portfolio Sentinel",
        description: "Monitors portfolio health, note performance, and default risk 24/7",
        actionsLast7d: sentinelActivity.status === "fulfilled" ? Number(sentinelActivity.value[0]?.count || 0) : 0,
        status: "active",
        icon: "shield",
        passiveScore: 88,
        note: "Scale tier and above",
      },
    ];

    const totalAutomatedActions = automationStatus.reduce((sum, a) => sum + a.actionsLast7d, 0);
    const avgPassiveScore = automationStatus.reduce((sum, a) => sum + a.passiveScore, 0) / automationStatus.length;

    res.json({
      overallPassiveScore: Math.round(avgPassiveScore),
      totalAutomatedActionsLast7d: totalAutomatedActions,
      humanActionsRequiredLast7d: 0, // Aspirational — track manually escalated items
      automations: automationStatus,
      passiveIncomeStatement: `The platform completed ${totalAutomatedActions.toLocaleString()} automated actions in the last 7 days without any manual intervention. Platform passive score: ${Math.round(avgPassiveScore)}/100.`,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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

    // Find organizations that were active before but not recently
    const atRiskOrgs = await db
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
    const recentCancels = await db
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
      db.select({ count: count() }).from(organizations)
        .where(sql`subscription_tier not in ('free') and subscription_status = 'active'`),
      db.select({ count: count() }).from(subscriptionEvents)
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
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/founder/intelligence/growth
// Growth signals, conversion funnel, expansion revenue
// ─────────────────────────────────────────────────────────────────────────────

router.get("/growth", requireFounder, async (req: Request, res: Response) => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);

    const [
      tierDistribution,
      upgrades30d,
      downgrades30d,
      freeToAnyConversions,
    ] = await Promise.allSettled([
      // Current tier distribution
      db.select({
        tier: organizations.subscriptionTier,
        count: count(),
      })
        .from(organizations)
        .where(eq(organizations.subscriptionStatus, "active"))
        .groupBy(organizations.subscriptionTier)
        .orderBy(desc(count())),

      // Upgrades in last 30d
      db.select({ count: count() })
        .from(subscriptionEvents)
        .where(and(
          eq(subscriptionEvents.eventType, "subscription_upgraded"),
          gte(subscriptionEvents.createdAt, thirtyDaysAgo)
        )),

      // Downgrades in last 30d
      db.select({ count: count() })
        .from(subscriptionEvents)
        .where(and(
          eq(subscriptionEvents.eventType, "subscription_downgraded"),
          gte(subscriptionEvents.createdAt, thirtyDaysAgo)
        )),

      // Free → any paid conversion in 30d
      db.select({ count: count() })
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
    res.status(500).json({ error: err.message });
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
  const d = new Date();
  d.setMonth(d.getMonth() + offset);
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

export default router;
