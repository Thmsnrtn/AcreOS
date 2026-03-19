// @ts-nocheck
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
  private async generateInsights(metrics: any): Promise<Array<{ type: string; message: string; severity?: string }>> {
    const insights: Array<{ type: string; message: string; severity?: string }> = [];

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
}

export const founderWellbeingService = new FounderWellbeingService();
