// @ts-nocheck
/**
 * Compass Auto-Recommendation — Sovereign Company Protocol v9: The Self-Running Company
 *
 * The Strategic Compass stops being CEO-only. Agents can RECOMMEND mode changes
 * based on compound signals from the business.
 *
 * When multiple data signals converge (MRR dropping + churn rising + error rates up),
 * the system doesn't wait for the CEO to notice. It recommends switching to Crisis Mode
 * with full evidence.
 *
 * The CEO still decides. But the system NOTICES before you do.
 */

import { db } from "../db";
import {
  compassRecommendations, strategicCompass,
  type CompassRecommendation,
} from "@shared/schema";
import { eq, desc, and, gte } from "drizzle-orm";
import { routeAITask, TaskComplexity } from "./aiRouter";
import { resolveAgentData } from "./agentDataResolvers";
import { strategicCompassV8Service } from "./strategicCompassV8";

// ─── Compound Signal Triggers ────────────────────────────────────────────────

interface CompassTriggerRule {
  targetMode: string;
  conditions: Array<{
    metric: string;
    operator: ">" | "<" | ">=" | "<=";
    value: number;
    source: string;       // which agent's data to check
    description: string;
  }>;
  requiredMatches: number;   // how many conditions must be true
  urgency: "immediate" | "daily_briefing" | "weekly_review";
  rationale: string;
}

const COMPASS_TRIGGERS: CompassTriggerRule[] = [
  {
    targetMode: "crisis",
    conditions: [
      { metric: "mrrChangePercent30d", operator: "<", value: -15, source: "forge_revenue", description: "MRR dropped >15% in 30 days" },
      { metric: "churnRate30d", operator: ">", value: 8, source: "forge_revenue", description: "Churn rate exceeded 8% in 30 days" },
      { metric: "errorRate24h", operator: ">", value: 2, source: "sentinel_devops", description: "Error rate exceeded 2% in 24 hours" },
      { metric: "criticalAlertsActive", operator: ">", value: 3, source: "sentinel_devops", description: "More than 3 critical alerts active" },
    ],
    requiredMatches: 2,
    urgency: "immediate",
    rationale: "Multiple crisis signals detected. Cash preservation and stability should take priority.",
  },
  {
    targetMode: "growth",
    conditions: [
      { metric: "mrrChangePercent30d", operator: ">", value: 15, source: "forge_revenue", description: "MRR grew >15% in 30 days" },
      { metric: "cashRunwayMonths", operator: ">", value: 18, source: "ledger_finance", description: "Cash runway exceeds 18 months" },
      { metric: "npsTrailing", operator: ">", value: 50, source: "sophie_csm", description: "NPS score above 50" },
      { metric: "churnRate30d", operator: "<", value: 3, source: "forge_revenue", description: "Churn rate below 3%" },
    ],
    requiredMatches: 2,
    urgency: "daily_briefing",
    rationale: "Strong growth signals with healthy fundamentals. This is the time to invest in acquisition.",
  },
  {
    targetMode: "efficiency",
    conditions: [
      { metric: "burnRatePercent", operator: ">", value: 40, source: "ledger_finance", description: "Burn rate exceeds 40% of revenue" },
      { metric: "cashRunwayMonths", operator: "<", value: 12, source: "ledger_finance", description: "Cash runway below 12 months" },
      { metric: "mrrChangePercent30d", operator: "<", value: 5, source: "forge_revenue", description: "MRR growth stalled (<5%)" },
    ],
    requiredMatches: 2,
    urgency: "daily_briefing",
    rationale: "High burn with slow growth signals. Margin improvement should take priority over acquisition.",
  },
  {
    targetMode: "exploration",
    conditions: [
      { metric: "mrrChangePercent30d", operator: ">", value: 0, source: "forge_revenue", description: "MRR is positive/stable" },
      { metric: "churnRate30d", operator: "<", value: 3, source: "forge_revenue", description: "Churn is healthy (<3%)" },
      { metric: "featureRequestsUnaddressed", operator: ">", value: 20, source: "compass_pm", description: "20+ unaddressed feature requests" },
      { metric: "competitorNewFeatures", operator: ">", value: 3, source: "oracle_analytics", description: "Competitors shipping more features" },
    ],
    requiredMatches: 3,
    urgency: "weekly_review",
    rationale: "Stable business with growing competitive pressure. Time to experiment and find the next growth lever.",
  },
];

// ─── Service ─────────────────────────────────────────────────────────────────

class CompassAutoRecommendService {

  /**
   * Evaluate all compass triggers against current data.
   * Returns any mode change recommendations.
   */
  async evaluate(): Promise<CompassRecommendation[]> {
    const compass = await strategicCompassV8Service.getActive();
    const currentMode = compass?.mode || "balanced";

    const recommendations: CompassRecommendation[] = [];

    for (const trigger of COMPASS_TRIGGERS) {
      // Don't recommend current mode
      if (trigger.targetMode === currentMode) continue;

      // Check cooldown — don't recommend same mode change within 7 days
      const recentRec = await db.query.compassRecommendations.findFirst({
        where: and(
          eq(compassRecommendations.recommendedMode, trigger.targetMode),
          gte(compassRecommendations.createdAt, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)),
        ),
      });
      if (recentRec) continue;

      // Evaluate conditions
      const matchedConditions: typeof trigger.conditions = [];
      const failedConditions: typeof trigger.conditions = [];

      for (const condition of trigger.conditions) {
        try {
          const data = await resolveAgentData(condition.source).catch(() => ({}));
          const value = this.extractMetric(data, condition.metric);

          if (value !== null && this.evaluateCondition(value, condition.operator, condition.value)) {
            matchedConditions.push(condition);
          } else {
            failedConditions.push(condition);
          }
        } catch {
          failedConditions.push(condition);
        }
      }

      if (matchedConditions.length >= trigger.requiredMatches) {
        // Trigger matched — create recommendation
        const [rec] = await db.insert(compassRecommendations).values({
          currentMode,
          recommendedMode: trigger.targetMode,
          urgency: trigger.urgency,
          rationale: trigger.rationale,
          matchedConditions: matchedConditions.map(c => ({
            metric: c.metric,
            description: c.description,
            source: c.source,
          })),
          failedConditions: failedConditions.map(c => ({
            metric: c.metric,
            description: c.description,
            source: c.source,
          })),
          confidence: Math.round((matchedConditions.length / trigger.conditions.length) * 100),
          status: "pending",
        }).returning();

        recommendations.push(rec);
      }
    }

    return recommendations;
  }

  /**
   * CEO accepts a compass recommendation — switch mode.
   */
  async accept(recommendationId: number): Promise<void> {
    const rec = await db.query.compassRecommendations.findFirst({
      where: eq(compassRecommendations.id, recommendationId),
    });
    if (!rec) return;

    await strategicCompassV8Service.switchMode(
      rec.recommendedMode,
      `Auto-recommended: ${rec.rationale}`
    );

    await db.update(compassRecommendations)
      .set({ status: "accepted", resolvedAt: new Date(), updatedAt: new Date() })
      .where(eq(compassRecommendations.id, recommendationId));
  }

  /**
   * CEO dismisses a recommendation.
   */
  async dismiss(recommendationId: number, reason?: string): Promise<void> {
    await db.update(compassRecommendations)
      .set({
        status: "dismissed",
        ceoResponse: reason,
        resolvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(compassRecommendations.id, recommendationId));
  }

  /** Get pending recommendations */
  async getPending(): Promise<CompassRecommendation[]> {
    return db.query.compassRecommendations.findMany({
      where: eq(compassRecommendations.status, "pending"),
      orderBy: [desc(compassRecommendations.createdAt)],
    });
  }

  /** Get recent recommendations */
  async getRecent(limit = 10): Promise<CompassRecommendation[]> {
    return db.query.compassRecommendations.findMany({
      orderBy: [desc(compassRecommendations.createdAt)],
      limit,
    });
  }

  /** Extract a metric value from agent data (supports nested paths) */
  private extractMetric(data: Record<string, any>, metric: string): number | null {
    const parts = metric.split(".");
    let current: any = data;
    for (const part of parts) {
      if (current == null) return null;
      current = current[part];
    }
    return typeof current === "number" ? current : null;
  }

  /** Evaluate a numeric condition */
  private evaluateCondition(value: number, operator: string, threshold: number): boolean {
    switch (operator) {
      case ">": return value > threshold;
      case "<": return value < threshold;
      case ">=": return value >= threshold;
      case "<=": return value <= threshold;
      default: return false;
    }
  }
}

export const compassAutoRecommendService = new CompassAutoRecommendService();
