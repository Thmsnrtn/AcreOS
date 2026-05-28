/**
 * Founder Wellbeing Monitor — Sovereign Company Protocol v8
 *
 * The system watches the founder, not just the business.
 *
 * "You've overridden 14 decisions this week — 3x your average.
 * This usually means stress. Your agents' success rate hasn't dropped.
 * Consider stepping back."
 *
 * Decision fatigue. Override frequency. Time-on-platform.
 * Win celebrations. Burnout signals. Not therapy — operational awareness.
 */

import { db } from "../db";
import {
  founderWellbeing, agentActionLog,
  type FounderWellbeing,
} from "@shared/schema";
import { eq, desc, gte, and, count, avg, sql } from "drizzle-orm";
import { routeAITask, TaskComplexity } from "./aiRouter";
import { ceoAbsenceService } from "./ceoAbsenceMode";

// ─── Service ─────────────────────────────────────────────────────────────────

class FounderWellbeingService {

  /** Generate today's wellbeing assessment */
  async assess(): Promise<number> {
    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Count CEO overrides this week
    const [overrideResult] = await db.select({ n: count() })
      .from(agentActionLog)
      .where(and(
        eq(agentActionLog.outcome, "escalated"),
        gte(agentActionLog.createdAt, weekAgo),
      ));
    const overrideCount = Number(overrideResult?.n || 0);

    // Monthly average for comparison
    const [monthOverrideResult] = await db.select({ n: count() })
      .from(agentActionLog)
      .where(and(
        eq(agentActionLog.outcome, "escalated"),
        gte(agentActionLog.createdAt, monthAgo),
      ));
    const monthOverrides = Number(monthOverrideResult?.n || 0);
    const overrideAvgWeekly = Math.round(monthOverrides / 4);

    // Agent success rate without CEO intervention
    const [successResult] = await db.select({ n: count() })
      .from(agentActionLog)
      .where(and(
        eq(agentActionLog.outcome, "success"),
        gte(agentActionLog.createdAt, weekAgo),
      ));
    const [totalResult] = await db.select({ n: count() })
      .from(agentActionLog)
      .where(gte(agentActionLog.createdAt, weekAgo));
    const successCount = Number(successResult?.n || 0);
    const totalCount = Number(totalResult?.n || 0);
    const agentSuccessRateWithoutCEO = totalCount > 0 ? Math.round((successCount / totalCount) * 100) : 0;

    // Days since last break
    const lastAbsence = await ceoAbsenceService.getLatest();
    const daysSinceLastBreak = lastAbsence?.startedAt
      ? Math.round((Date.now() - new Date(lastAbsence.startedAt).getTime()) / (1000 * 60 * 60 * 24))
      : 999;

    const metrics = {
      overrideCount,
      overrideAvgWeekly,
      decisionsToday: 0,
      avgDecisionTimeMs: 0,
      timeOnPlatformMinutes: 0,
      daysSinceLastBreak,
      warRoomInterventions: 0,
      agentSuccessRateWithoutCEO,
      winCount: successCount,
      stressSignals: [] as string[],
    };

    // Detect stress signals
    if (overrideCount > overrideAvgWeekly * 2 && overrideAvgWeekly > 0) {
      metrics.stressSignals.push("override_spike");
    }
    if (daysSinceLastBreak > 30) {
      metrics.stressSignals.push("no_break_30d");
    }
    if (daysSinceLastBreak > 60) {
      metrics.stressSignals.push("no_break_60d");
    }

    // Generate insights
    const insights = await this.generateInsights(metrics);

    // Estimate energy score
    let energyScore = 80;
    if (metrics.stressSignals.includes("override_spike")) energyScore -= 20;
    if (metrics.stressSignals.includes("no_break_30d")) energyScore -= 15;
    if (metrics.stressSignals.includes("no_break_60d")) energyScore -= 25;
    if (agentSuccessRateWithoutCEO > 85) energyScore += 10; // team is strong
    energyScore = Math.max(10, Math.min(100, energyScore));

    const [record] = await db.insert(founderWellbeing).values({
      date: today,
      metrics,
      insights,
      energyScore,
    }).returning({ id: founderWellbeing.id });

    return record.id;
  }

  /** Generate AI insights from metrics */
  private async generateInsights(metrics: any): Promise<Array<{ type: "warning" | "celebration" | "nudge" | "milestone"; message: string; severity?: "low" | "medium" | "high" }>> {
    const insights: Array<{ type: "warning" | "celebration" | "nudge" | "milestone"; message: string; severity?: "low" | "medium" | "high" }> = [];

    // Rule-based insights
    if (metrics.overrideCount > metrics.overrideAvgWeekly * 2 && metrics.overrideAvgWeekly > 0) {
      insights.push({
        type: "warning",
        message: `You've overridden ${metrics.overrideCount} agent decisions this week — ${Math.round(metrics.overrideCount / Math.max(1, metrics.overrideAvgWeekly))}x your average. Your agents' success rate is ${metrics.agentSuccessRateWithoutCEO}%. If they're performing well, consider letting more decisions flow through.`,
        severity: "medium",
      });
    }

    if (metrics.daysSinceLastBreak > 45) {
      insights.push({
        type: "nudge",
        message: `It's been ${metrics.daysSinceLastBreak} days since your last break. Decision quality tends to degrade after 30 days of continuous work. Your team can handle a 48-hour absence — they've proven it.`,
        severity: "medium",
      });
    } else if (metrics.daysSinceLastBreak > 30) {
      insights.push({
        type: "nudge",
        message: `${metrics.daysSinceLastBreak} days since your last break. Consider a short absence — your team's success rate is ${metrics.agentSuccessRateWithoutCEO}% without you.`,
        severity: "low",
      });
    }

    if (metrics.agentSuccessRateWithoutCEO > 90) {
      insights.push({
        type: "celebration",
        message: `Your AI team is running at ${metrics.agentSuccessRateWithoutCEO}% success rate without your intervention. Six months ago this wasn't possible. The system is working.`,
      });
    }

    if (metrics.winCount > 10) {
      insights.push({
        type: "celebration",
        message: `${metrics.winCount} successful agent actions this week. Your team is executing.`,
      });
    }

    if (metrics.overrideCount === 0 && metrics.overrideAvgWeekly > 0) {
      insights.push({
        type: "milestone",
        message: `Zero overrides this week. You're trusting your team more — and they're delivering.`,
      });
    }

    return insights;
  }

  /** Get the latest wellbeing assessment */
  async getLatest(): Promise<FounderWellbeing | null> {
    return db.query.founderWellbeing.findFirst({
      orderBy: [desc(founderWellbeing.date)],
    }) as any;
  }

  /** Get recent assessments */
  async getRecent(limit = 7): Promise<FounderWellbeing[]> {
    return db.query.founderWellbeing.findMany({
      orderBy: [desc(founderWellbeing.date)],
      limit,
    });
  }

  // ─── Proactive Monitoring ───────────────────────────────────────────────────

  /** Real-time stress detection — designed to be called every hour */
  async monitorRealTime(): Promise<{
    alerts: Array<{
      type: string;
      message: string;
      severity: "low" | "medium" | "high" | "critical";
      suggestedAction?: string;
    }>;
  }> {
    const alerts: Array<{
      type: string;
      message: string;
      severity: "low" | "medium" | "high" | "critical";
      suggestedAction?: string;
    }> = [];

    const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);

    // Count overrides in the last 4 hours
    const [recentOverrideResult] = await db.select({ n: count() })
      .from(agentActionLog)
      .where(and(
        eq(agentActionLog.outcome, "escalated"),
        gte(agentActionLog.createdAt, fourHoursAgo),
      ));
    const recentOverrides = Number(recentOverrideResult?.n || 0);

    // Days since last break
    const lastAbsence = await ceoAbsenceService.getLatest();
    const daysSinceLastBreak = lastAbsence?.startedAt
      ? Math.round((Date.now() - new Date(lastAbsence.startedAt).getTime()) / (1000 * 60 * 60 * 24))
      : 999;

    if (recentOverrides > 5) {
      alerts.push({
        type: "stress_spike",
        message: `You've overridden ${recentOverrides} decisions in the last 4 hours. This is significantly above normal. Step back and let your agents handle things for a bit.`,
        severity: "high",
        suggestedAction: "Take a 30-minute break and review whether these overrides were necessary.",
      });

      // Compound alert: override spike + no break in 14+ days
      if (daysSinceLastBreak > 14) {
        alerts.push({
          type: "burnout_warning",
          message: `Override spike detected AND it's been ${daysSinceLastBreak} days since your last break. This combination is a strong burnout signal.`,
          severity: "critical",
          suggestedAction: "Activate absence mode for at least 24 hours. Your agents can handle it.",
        });
      }
    }

    return { alerts };
  }

  /** Suggest absence mode when the system is performing well enough */
  async suggestAbsenceMode(): Promise<string | null> {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // Agent success rate over last 7 days
    const [successResult] = await db.select({ n: count() })
      .from(agentActionLog)
      .where(and(
        eq(agentActionLog.outcome, "success"),
        gte(agentActionLog.createdAt, weekAgo),
      ));
    const [totalResult] = await db.select({ n: count() })
      .from(agentActionLog)
      .where(gte(agentActionLog.createdAt, weekAgo));
    const successCount = Number(successResult?.n || 0);
    const totalCount = Number(totalResult?.n || 0);
    const successRate = totalCount > 0 ? Math.round((successCount / totalCount) * 100) : 0;

    // Days since last break
    const lastAbsence = await ceoAbsenceService.getLatest();
    const daysSinceLastBreak = lastAbsence?.startedAt
      ? Math.round((Date.now() - new Date(lastAbsence.startedAt).getTime()) / (1000 * 60 * 60 * 24))
      : 999;

    if (successRate > 85 && daysSinceLastBreak > 21) {
      return `Your team's success rate is ${successRate}%. You haven't taken a break in ${daysSinceLastBreak} days. Consider activating absence mode for 48 hours.`;
    }

    return null;
  }

  /** Predict burnout trajectory from recent energy scores */
  async predictBurnoutTrajectory(): Promise<{
    trajectory: "stable" | "improving" | "declining" | "critical";
    avgEnergy: number;
    trend: number[];
    recommendation: string;
  }> {
    const assessments = await this.getRecent(7);

    // Extract energy scores in chronological order (oldest first)
    const trend: number[] = assessments
      .map((a) => a.energyScore ?? 0)
      .reverse();

    // Average energy over the period
    const avgEnergy = trend.length > 0
      ? Math.round(trend.reduce((sum, v) => sum + v, 0) / trend.length)
      : 0;

    // Determine trajectory
    let trajectory: "stable" | "improving" | "declining" | "critical" = "stable";
    let recommendation = "Your energy levels are steady. Keep up the current pace.";

    // Check for critical average first
    if (avgEnergy < 50 && trend.length > 0) {
      trajectory = "critical";
      recommendation = "Your average energy is critically low. Strongly consider activating absence mode and taking genuine time off. Delegate everything possible.";
    } else if (trend.length >= 3) {
      // Check for 3+ consecutive days of decline
      let consecutiveDeclines = 0;
      let consecutiveIncreases = 0;

      for (let i = 1; i < trend.length; i++) {
        if (trend[i] < trend[i - 1]) {
          consecutiveDeclines++;
          consecutiveIncreases = 0;
        } else if (trend[i] > trend[i - 1]) {
          consecutiveIncreases++;
          consecutiveDeclines = 0;
        } else {
          consecutiveDeclines = 0;
          consecutiveIncreases = 0;
        }
      }

      if (consecutiveDeclines >= 3) {
        trajectory = "declining";
        recommendation = "Your energy has been declining for multiple consecutive days. Reduce override activity, trust your agents more, and schedule a break soon.";
      } else if (consecutiveIncreases >= 3) {
        trajectory = "improving";
        recommendation = "Your energy trend is positive. Whatever you changed recently is working — keep it up.";
      }
    }

    return { trajectory, avgEnergy, trend, recommendation };
  }

  /** Analyze decision quality by hour of day to detect fatigue patterns */
  async getDecisionQualityByHour(): Promise<{
    hourlyOverrides: Record<number, number>;
    peakOverrideHour: number;
    recommendation: string;
  }> {
    const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Query overrides grouped by hour of day
    const rows = await db.select({
      hour: sql<number>`extract(hour from ${agentActionLog.createdAt})`.as("hour"),
      n: count(),
    })
      .from(agentActionLog)
      .where(and(
        eq(agentActionLog.outcome, "escalated"),
        gte(agentActionLog.createdAt, monthAgo),
      ))
      .groupBy(sql`extract(hour from ${agentActionLog.createdAt})`);

    // Build hourly map (0-23)
    const hourlyOverrides: Record<number, number> = {};
    for (let h = 0; h < 24; h++) {
      hourlyOverrides[h] = 0;
    }
    let peakOverrideHour = 0;
    let peakCount = 0;

    for (const row of rows) {
      const h = Number(row.hour);
      const c = Number(row.n);
      hourlyOverrides[h] = c;
      if (c > peakCount) {
        peakCount = c;
        peakOverrideHour = h;
      }
    }

    // Generate recommendation based on peak hour
    let recommendation: string;
    if (peakCount === 0) {
      recommendation = "Not enough override data to detect hourly patterns yet.";
    } else if (peakOverrideHour >= 22 || peakOverrideHour <= 4) {
      recommendation = `Most overrides happen at ${peakOverrideHour}:00 — late night. This is a strong fatigue signal. Avoid making decisions after 10 PM; let your agents handle overnight operations.`;
    } else if (peakOverrideHour >= 17 && peakOverrideHour < 22) {
      recommendation = `Override activity peaks at ${peakOverrideHour}:00 — end of day. Consider wrapping up decision-making earlier and letting agents handle evening tasks.`;
    } else {
      recommendation = `Override activity peaks at ${peakOverrideHour}:00. This appears to be during normal working hours — no fatigue concern detected.`;
    }

    return { hourlyOverrides, peakOverrideHour, recommendation };
  }

  /**
   * Detect decision fatigue based on resolution time and override patterns.
   */
  async detectDecisionFatigue(): Promise<{
    fatigueDetected: boolean;
    signals: string[];
    recommendation: string;
  }> {
    try {
      const { decisionsInboxItems } = await import("@shared/schema");
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      // Count decisions resolved in last 7 days
      const recentDecisions = await db.select()
        .from(decisionsInboxItems)
        .where(and(
          gte(decisionsInboxItems.resolvedAt, sevenDaysAgo),
          sql`${decisionsInboxItems.status} != 'pending'`,
        ))
        .limit(100);

      const signals: string[] = [];

      // Signal 1: High rejection rate without opening details
      const rejections = recentDecisions.filter(d => d.status === "rejected");
      if (rejections.length > recentDecisions.length * 0.6) {
        signals.push("rejecting_everything");
      }

      // Signal 2: Override spike (>5 per day average)
      const overrides = recentDecisions.filter(d => d.founderOverrideAction);
      if (overrides.length > 5 * 7) {
        signals.push("override_spike");
      }

      // Signal 3: Deferred decisions accumulating
      const deferred = recentDecisions.filter(d => d.status === "deferred");
      if (deferred.length > 10) {
        signals.push("deferred_accumulation");
      }

      const fatigueDetected = signals.length >= 2;

      return {
        fatigueDetected,
        signals,
        recommendation: fatigueDetected
          ? "You seem busier than usual. Only P0/P1 decisions are being shown. Your agents will auto-handle routine decisions."
          : "Decision load is normal.",
      };
    } catch {
      return { fatigueDetected: false, signals: [], recommendation: "" };
    }
  }

  /**
   * Track wins for celebration.
   */
  async getRecentWins(): Promise<string[]> {
    try {
      const { agentActionLog } = await import("@shared/schema");
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

      const wins = await db.select()
        .from(agentActionLog)
        .where(and(
          eq(agentActionLog.outcome, "success"),
          gte(agentActionLog.createdAt, threeDaysAgo),
        ))
        .orderBy(desc(agentActionLog.createdAt))
        .limit(5);

      return wins.map(w => `${w.agentCodename.replace(/_/g, " ")}: ${w.actionName.replace(/_/g, " ")}`);
    } catch {
      return [];
    }
  }

  /**
   * Generate weekly wellbeing summary for the digest.
   */
  async generateWeeklySummary(): Promise<{
    decisionsMade: number;
    overrideRate: number;
    agentSuccessRate: number;
    wins: string[];
    recommendation: string;
  }> {
    try {
      const { decisionsInboxItems, agentActionLog } = await import("@shared/schema");
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const [decisionCount] = await db.select({ count: count() })
        .from(decisionsInboxItems)
        .where(and(
          gte(decisionsInboxItems.resolvedAt, sevenDaysAgo),
          sql`${decisionsInboxItems.status} != 'pending'`,
        ));

      const [overrideCount] = await db.select({ count: count() })
        .from(decisionsInboxItems)
        .where(and(
          gte(decisionsInboxItems.resolvedAt, sevenDaysAgo),
          sql`${decisionsInboxItems.founderOverrideAction} IS NOT NULL`,
        ));

      const [successActions] = await db.select({ count: count() })
        .from(agentActionLog)
        .where(and(
          eq(agentActionLog.outcome, "success"),
          gte(agentActionLog.createdAt, sevenDaysAgo),
        ));

      const [totalActions] = await db.select({ count: count() })
        .from(agentActionLog)
        .where(gte(agentActionLog.createdAt, sevenDaysAgo));

      const decisionsMade = decisionCount?.count || 0;
      const overrideRate = decisionsMade > 0 ? Math.round(((overrideCount?.count || 0) / decisionsMade) * 100) : 0;
      const agentSuccessRate = (totalActions?.count || 0) > 0
        ? Math.round(((successActions?.count || 0) / (totalActions?.count || 1)) * 100)
        : 0;

      const wins = await this.getRecentWins();

      let recommendation = "";
      if (agentSuccessRate > 90) recommendation = "Your agents are performing excellently. Consider increasing autonomy.";
      else if (agentSuccessRate > 75) recommendation = "Agent performance is solid. Keep current autonomy levels.";
      else recommendation = "Agent performance dipped this week. Review recent failures.";

      return { decisionsMade, overrideRate, agentSuccessRate, wins, recommendation };
    } catch {
      return { decisionsMade: 0, overrideRate: 0, agentSuccessRate: 0, wins: [], recommendation: "" };
    }
  }
}

export const founderWellbeingService = new FounderWellbeingService();
