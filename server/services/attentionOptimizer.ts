/**
 * Attention Optimizer — Sovereign Company Protocol v7
 *
 * Tracks where the founder spends time on the dashboard.
 * Then tells them where their time actually matters.
 *
 * "You spent 40 minutes in war rooms this week. 90% resolved
 * without your input. Meanwhile, 3 initiatives sat unreviewed
 * for 5 days — two had +15% projected impact."
 *
 * Output: a daily "Here's where you matter today" focus card.
 */

import { db } from "../db";
import {
  attentionInsights,
  type AttentionInsight,
} from "@shared/schema";
import { eq, desc, gte, and } from "drizzle-orm";
import { routeAITask, TaskComplexity } from "./aiRouter";
import { agentInitiativeService } from "./agentInitiatives";
import { warRoomService } from "./warRoomService";
import { decisionAutopilotService } from "./decisionAutopilot";

// ─── Service ─────────────────────────────────────────────────────────────────

class AttentionOptimizerService {

  /** Record time spent in an area (called from frontend events) */
  async recordTimeSpent(area: string, durationMinutes: number): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Find or create today's insight
    let insight = await db.query.attentionInsights.findFirst({
      where: and(
        gte(attentionInsights.periodStart, today),
      ),
      orderBy: [desc(attentionInsights.createdAt)],
    });

    if (!insight) {
      const [created] = await db.insert(attentionInsights).values({
        periodStart: today,
        periodEnd: tomorrow,
        timeSpent: {},
        interventionImpact: [],
        recommendations: [],
      }).returning();
      insight = created;
    }

    // Update time spent
    const timeSpent = { ...((insight.timeSpent as Record<string, number>) || {}) };
    timeSpent[area] = (timeSpent[area] || 0) + durationMinutes;

    await db.update(attentionInsights)
      .set({ timeSpent })
      .where(eq(attentionInsights.id, insight.id));
  }

  /** Record whether a CEO intervention actually changed an outcome */
  async recordIntervention(input: {
    area: string;
    ceoIntervened: boolean;
    outcomeWithout: string;
    outcomeWith: string;
    impactDelta: number; // -1 to +1
  }): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const insight = await db.query.attentionInsights.findFirst({
      where: gte(attentionInsights.periodStart, today),
      orderBy: [desc(attentionInsights.createdAt)],
    });
    if (!insight) return;

    const impacts = [...((insight.interventionImpact as any[]) || []), input];

    await db.update(attentionInsights)
      .set({ interventionImpact: impacts })
      .where(eq(attentionInsights.id, insight.id));
  }

  /** Generate the daily "here's where you matter" focus card */
  async generateFocusCard(): Promise<string> {
    // Gather signals from across the system
    const [pendingInitiatives, activeWarRooms, autopilotSuggestions] = await Promise.all([
      agentInitiativeService.getPendingCount(),
      warRoomService.getActiveRooms(),
      decisionAutopilotService.getSuggestions(),
    ]);

    // Get recent time spent data
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recentInsights = await db.query.attentionInsights.findMany({
      where: gte(attentionInsights.periodStart, weekAgo),
      orderBy: [desc(attentionInsights.periodStart)],
    });

    // Aggregate time spent this week
    const weekTimeSpent: Record<string, number> = {};
    for (const insight of recentInsights) {
      const ts = (insight.timeSpent as Record<string, number>) || {};
      for (const [area, mins] of Object.entries(ts)) {
        weekTimeSpent[area] = (weekTimeSpent[area] || 0) + mins;
      }
    }

    // Calculate intervention impact
    const allImpacts: any[] = [];
    for (const insight of recentInsights) {
      allImpacts.push(...((insight.interventionImpact as any[]) || []));
    }

    const impactByArea: Record<string, { interventions: number; avgDelta: number }> = {};
    for (const imp of allImpacts) {
      if (!impactByArea[imp.area]) impactByArea[imp.area] = { interventions: 0, avgDelta: 0 };
      impactByArea[imp.area].interventions++;
      impactByArea[imp.area].avgDelta = (impactByArea[imp.area].avgDelta * (impactByArea[imp.area].interventions - 1) + imp.impactDelta) / impactByArea[imp.area].interventions;
    }

    try {
      const response = await routeAITask({
        taskType: "focus_card",
        complexity: TaskComplexity.MODERATE,
        messages: [
          {
            role: "system",
            content: `You are the CEO's attention optimizer. Your job: tell them where their time matters TODAY. Be direct, specific, and actionable. One focus card, 3-4 bullet points max. No fluff.`,
          },
          {
            role: "user",
            content: `Generate today's focus card.

Current state:
- ${pendingInitiatives} initiative proposals awaiting CEO review
- ${activeWarRooms.length} active war rooms
- ${autopilotSuggestions.length} autopilot patterns ready for CEO opt-in

This week's CEO time allocation:
${Object.entries(weekTimeSpent).map(([area, mins]) => `- ${area}: ${Math.round(mins)}min`).join("\n") || "No time tracking data yet."}

CEO intervention impact by area:
${Object.entries(impactByArea).map(([area, data]) => `- ${area}: ${data.interventions} interventions, avg impact ${(data.avgDelta * 100).toFixed(0)}%`).join("\n") || "No intervention data yet."}

Write a concise focus card. Start with the single most important thing. Format:
"Today: [most important thing]
- [action 1]
- [action 2]
- [optional action 3]
[one sentence on what to skip/delegate today]"`,
          },
        ],
        maxTokens: 150,
        temperature: 0.3,
      });

      const focusCard = response.content;

      // Save to today's insight
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const insight = await db.query.attentionInsights.findFirst({
        where: gte(attentionInsights.periodStart, today),
        orderBy: [desc(attentionInsights.createdAt)],
      });

      if (insight) {
        await db.update(attentionInsights)
          .set({ focusCard })
          .where(eq(attentionInsights.id, insight.id));
      }

      return focusCard;
    } catch {
      // Fallback focus card
      const items: string[] = [];
      if (pendingInitiatives > 0) items.push(`Review ${pendingInitiatives} agent initiative proposals`);
      if (activeWarRooms.length > 0) items.push(`${activeWarRooms.length} war room${activeWarRooms.length > 1 ? "s" : ""} need attention`);
      if (autopilotSuggestions.length > 0) items.push(`${autopilotSuggestions.length} decision patterns ready for autopilot`);
      if (items.length === 0) items.push("All clear. Your team is handling things.");

      return `Today: ${items[0]}\n${items.map(i => `- ${i}`).join("\n")}`;
    }
  }

  /** Generate weekly attention recommendations */
  async generateWeeklyRecommendations(): Promise<Array<{
    action: string;
    area: string;
    reason: string;
    projectedTimeSaved: number;
  }>> {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const insights = await db.query.attentionInsights.findMany({
      where: gte(attentionInsights.periodStart, weekAgo),
    });

    const weekTimeSpent: Record<string, number> = {};
    const weekImpacts: any[] = [];

    for (const insight of insights) {
      const ts = (insight.timeSpent as Record<string, number>) || {};
      for (const [area, mins] of Object.entries(ts)) {
        weekTimeSpent[area] = (weekTimeSpent[area] || 0) + mins;
      }
      weekImpacts.push(...((insight.interventionImpact as any[]) || []));
    }

    const recommendations: Array<{ action: string; area: string; reason: string; projectedTimeSaved: number }> = [];

    // Find areas with high time spent but low impact
    for (const [area, mins] of Object.entries(weekTimeSpent)) {
      const areaImpacts = weekImpacts.filter(i => i.area === area);
      const avgDelta = areaImpacts.length > 0
        ? areaImpacts.reduce((sum, i) => sum + (i.impactDelta || 0), 0) / areaImpacts.length
        : 0;

      if (mins > 30 && avgDelta < 0.2) {
        recommendations.push({
          action: "delegate",
          area,
          reason: `You spent ${Math.round(mins)}min here this week but your interventions had minimal impact (${(avgDelta * 100).toFixed(0)}% avg change).`,
          projectedTimeSaved: Math.round(mins * 0.7),
        });
      } else if (mins < 5 && avgDelta > 0.5) {
        recommendations.push({
          action: "focus_more",
          area,
          reason: `Your brief time here had high impact (${(avgDelta * 100).toFixed(0)}% avg change). More attention could amplify results.`,
          projectedTimeSaved: 0,
        });
      }
    }

    return recommendations;
  }

  /** Get the latest focus card */
  async getLatestFocusCard(): Promise<string | null> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const insight = await db.query.attentionInsights.findFirst({
      where: gte(attentionInsights.periodStart, today),
      orderBy: [desc(attentionInsights.createdAt)],
    });

    return (insight?.focusCard as string) || null;
  }

  /** Get recent insights */
  async getRecent(limit = 7): Promise<AttentionInsight[]> {
    return db.query.attentionInsights.findMany({
      orderBy: [desc(attentionInsights.periodStart)],
      limit,
    });
  }
}

export const attentionOptimizerService = new AttentionOptimizerService();
