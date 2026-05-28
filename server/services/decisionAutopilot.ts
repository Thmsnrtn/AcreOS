/**
 * Decision Autopilot — Sovereign Company Protocol v7
 *
 * The system watches every CEO decision: approve, reject, override, shelve.
 * Over time it learns patterns:
 *   "You always approve Forge's pricing under $5k."
 *   "You always reject Sophie's discount offers over 20%."
 *
 * Graduated rollout:
 * 1. Shadow mode: logs what it WOULD have decided, alongside your real decision
 * 2. Suggestion mode: "I'd approve this — same as your last 14 similar decisions"
 * 3. Autopilot mode: auto-decides, you review the batch weekly
 *
 * This makes the founder's judgment scalable.
 */

import { db } from "../db";
import { decisionPatterns, type DecisionPattern } from "@shared/schema";
import { eq, and, desc, gte, sql } from "drizzle-orm";
import { routeAITask, TaskComplexity } from "./aiRouter";

// ─── Pattern Key Generation ──────────────────────────────────────────────────

function generatePatternKey(agentCodename: string, category: string, context?: Record<string, any>, riskLevel?: string): string {
  // Create a pattern key that groups similar decisions
  // e.g. "forge:pricing_under_5k:medium_risk" or "sophie:churn_response:enterprise"
  let key = `${agentCodename}:${category}`;
  if (context?.amount && context.amount < 5000) key += "_under_5k";
  else if (context?.amount && context.amount >= 5000) key += "_over_5k";
  if (riskLevel || context?.riskLevel) key += `:${riskLevel || context?.riskLevel}`;
  if (context?.orgPlan) key += `:${context.orgPlan}`;
  return key;
}

// ─── Service ─────────────────────────────────────────────────────────────────

class DecisionAutopilotService {

  /** Calculate Bayesian confidence using Beta distribution with Laplace smoothing and recency weighting */
  calculateBayesianConfidence(pattern: {
    totalDecisions: number | null;
    approvedCount: number | null;
    rejectedCount: number | null;
    recentDecisions: any;
  }): number {
    const recentDecisions = (pattern.recentDecisions as any[]) || [];
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Count successes (dominant action matches) with recency weighting
    // "Success" = the decision matched the dominant action pattern
    const dominantAction = (pattern.approvedCount || 0) >= (pattern.rejectedCount || 0) ? "approved" : "rejected";
    let weightedSuccesses = 0;
    let weightedTotal = 0;

    for (const d of recentDecisions) {
      const weight = d.timestamp >= sevenDaysAgo ? 2 : 1;
      weightedTotal += weight;
      if (d.action === dominantAction) {
        weightedSuccesses += weight;
      }
    }

    // For decisions not in recentDecisions (older ones trimmed), use raw counts
    const trackedCount = recentDecisions.length;
    const total = pattern.totalDecisions || 0;
    const untrackedCount = Math.max(0, total - trackedCount);
    if (untrackedCount > 0) {
      const dominantCount = dominantAction === "approved" ? (pattern.approvedCount || 0) : (pattern.rejectedCount || 0);
      const untrackedSuccesses = Math.max(0, dominantCount - recentDecisions.filter((d: any) => d.action === dominantAction).length);
      weightedSuccesses += untrackedSuccesses;
      weightedTotal += untrackedCount;
    }

    // Beta distribution with Laplace smoothing: (successes + 1) / (total + 2)
    const confidence = (weightedSuccesses + 1) / (weightedTotal + 2);
    return Math.min(1, Math.max(0, confidence));
  }

  /** Get category-specific autopilot thresholds */
  getAutopilotThreshold(category: string): { confidence: number; minDecisions: number } {
    const lower = category.toLowerCase();
    if (lower.includes("pricing") || lower.includes("financial")) {
      return { confidence: 0.95, minDecisions: 25 };
    }
    if (lower.includes("support") || lower.includes("churn")) {
      return { confidence: 0.90, minDecisions: 15 };
    }
    return { confidence: 0.85, minDecisions: 10 };
  }

  /** Record a CEO decision and update patterns */
  async recordDecision(input: {
    agentCodename: string;
    decisionCategory: string;
    action: "approved" | "rejected" | "modified" | "shelved";
    context: Record<string, any>;
    decisionId?: number;
  }): Promise<void> {
    const patternKey = generatePatternKey(input.agentCodename, input.decisionCategory, input.context, input.context?.riskLevel);

    // Find or create pattern
    let pattern = await db.query.decisionPatterns.findFirst({
      where: eq(decisionPatterns.patternKey, patternKey),
    });

    if (!pattern) {
      // Create new pattern — generate description
      const description = await this.generatePatternDescription(input.agentCodename, input.decisionCategory, input.context);

      const [created] = await db.insert(decisionPatterns).values({
        patternKey,
        agentCodename: input.agentCodename,
        decisionCategory: input.decisionCategory,
        description,
        totalDecisions: 0,
        approvedCount: 0,
        rejectedCount: 0,
        overriddenCount: 0,
        recentDecisions: [],
      }).returning();
      pattern = created;
    }

    // Update counts
    const totalDecisions = (pattern.totalDecisions || 0) + 1;
    const approvedCount = (pattern.approvedCount || 0) + (input.action === "approved" ? 1 : 0);
    const rejectedCount = (pattern.rejectedCount || 0) + (input.action === "rejected" ? 1 : 0);
    const overriddenCount = (pattern.overriddenCount || 0) + (input.action === "modified" ? 1 : 0);

    // Update recent decisions (keep last 30)
    const recentDecisions = [...((pattern.recentDecisions as any[]) || [])];
    recentDecisions.push({
      decisionId: input.decisionId,
      action: input.action,
      context: input.context,
      timestamp: new Date().toISOString(),
    });
    if (recentDecisions.length > 30) recentDecisions.shift();

    // Calculate auto-approve rate and predicted action
    const autoApproveRate = totalDecisions > 0 ? (approvedCount / totalDecisions) : 0;
    const predictedAction = autoApproveRate > 0.7 ? "approve"
      : (rejectedCount / totalDecisions) > 0.7 ? "reject"
      : "uncertain";

    // Calculate prediction confidence using Bayesian method with recency weighting
    const predictionConfidence = totalDecisions >= 5
      ? this.calculateBayesianConfidence({
          totalDecisions,
          approvedCount,
          rejectedCount,
          recentDecisions,
        })
      : 0;

    // Use category-specific thresholds for autopilot eligibility
    const threshold = this.getAutopilotThreshold(input.decisionCategory);
    const isAutopilotEligible = predictionConfidence > threshold.confidence
      && totalDecisions >= threshold.minDecisions
      && predictedAction !== "uncertain";

    // Shadow mode: record what autopilot WOULD have done
    if (recentDecisions.length > 0) {
      const lastDecision = recentDecisions[recentDecisions.length - 1];
      lastDecision.wouldHaveAutoed = predictedAction;
      // predictedAction uses approve/reject vocabulary; input.action uses approved/rejected.
      lastDecision.autopilotCorrect =
        (predictedAction === "approve" && input.action === "approved") ||
        (predictedAction === "reject" && input.action === "rejected");
    }

    await db.update(decisionPatterns)
      .set({
        totalDecisions,
        approvedCount,
        rejectedCount,
        overriddenCount,
        autoApproveRate: autoApproveRate.toFixed(3),
        predictedAction,
        predictionConfidence: predictionConfidence.toFixed(3),
        isAutopilotEligible,
        recentDecisions,
        updatedAt: new Date(),
      })
      .where(eq(decisionPatterns.id, pattern.id));
  }

  /** Check if a decision can be auto-handled */
  async checkAutopilot(agentCodename: string, category: string, context: Record<string, any>): Promise<{
    canAutoDecide: boolean;
    predictedAction: string | null;
    confidence: number;
    patternDescription: string | null;
    basis: string;
  }> {
    const patternKey = generatePatternKey(agentCodename, category, context);
    const pattern = await db.query.decisionPatterns.findFirst({
      where: and(
        eq(decisionPatterns.patternKey, patternKey),
        eq(decisionPatterns.isAutopilotActive, true),
      ),
    });

    if (!pattern) {
      return { canAutoDecide: false, predictedAction: null, confidence: 0, patternDescription: null, basis: "No pattern found" };
    }

    // Check condition rules
    const rules = pattern.conditionRules as any;
    if (rules) {
      if (rules.maxAmount && context.amount > rules.maxAmount) {
        return {
          canAutoDecide: false,
          predictedAction: pattern.predictedAction,
          confidence: Number(pattern.predictionConfidence || 0),
          patternDescription: pattern.description,
          basis: `Amount ${context.amount} exceeds autopilot limit of ${rules.maxAmount}`,
        };
      }
    }

    return {
      canAutoDecide: true,
      predictedAction: pattern.predictedAction,
      confidence: Number(pattern.predictionConfidence || 0),
      patternDescription: pattern.description,
      basis: `Based on ${pattern.totalDecisions} similar decisions (${pattern.autoApproveRate ? (Number(pattern.autoApproveRate) * 100).toFixed(0) : 0}% approve rate)`,
    };
  }

  /** CEO enables autopilot for a pattern */
  async enableAutopilot(patternId: number, conditionRules?: Record<string, any>): Promise<void> {
    await db.update(decisionPatterns)
      .set({
        isAutopilotActive: true,
        conditionRules: conditionRules || null,
        updatedAt: new Date(),
      })
      .where(eq(decisionPatterns.id, patternId));
  }

  /** CEO disables autopilot for a pattern */
  async disableAutopilot(patternId: number): Promise<void> {
    await db.update(decisionPatterns)
      .set({ isAutopilotActive: false, updatedAt: new Date() })
      .where(eq(decisionPatterns.id, patternId));
  }

  /** Get all patterns with autopilot eligibility info */
  async getPatterns(): Promise<DecisionPattern[]> {
    return db.query.decisionPatterns.findMany({
      orderBy: [desc(decisionPatterns.totalDecisions)],
    });
  }

  /** Get eligible-but-not-yet-enabled patterns (suggestions for CEO) */
  async getSuggestions(): Promise<DecisionPattern[]> {
    return db.query.decisionPatterns.findMany({
      where: and(
        eq(decisionPatterns.isAutopilotEligible, true),
        eq(decisionPatterns.isAutopilotActive, false),
      ),
      orderBy: [desc(decisionPatterns.predictionConfidence)],
    });
  }

  /** Get autopilot accuracy stats */
  async getAccuracyStats(): Promise<{
    totalPatterns: number;
    activeAutopilots: number;
    eligibleNotActive: number;
    overallAccuracy: number;
  }> {
    const all = await this.getPatterns();
    const active = all.filter(p => p.isAutopilotActive);
    const eligible = all.filter(p => p.isAutopilotEligible && !p.isAutopilotActive);

    // Calculate accuracy from shadow predictions
    let correctPredictions = 0;
    let totalPredictions = 0;
    for (const pattern of all) {
      const recent = (pattern.recentDecisions as any[]) || [];
      for (const d of recent) {
        if (d.wouldHaveAutoed !== undefined) {
          totalPredictions++;
          if (d.autopilotCorrect) correctPredictions++;
        }
      }
    }

    return {
      totalPatterns: all.length,
      activeAutopilots: active.length,
      eligibleNotActive: eligible.length,
      overallAccuracy: totalPredictions > 0 ? Math.round((correctPredictions / totalPredictions) * 100) : 0,
    };
  }

  /** Analyze shadow mode accuracy across all patterns */
  async analyzeShadowAccuracy(): Promise<{
    overallAccuracy: number;
    byCategory: Record<string, { accuracy: number; total: number; readyForAutopilot: boolean }>;
    recommendations: string[];
  }> {
    const all = await this.getPatterns();

    let totalCorrect = 0;
    let totalPredictions = 0;
    const categoryStats: Record<string, { correct: number; total: number }> = {};

    for (const pattern of all) {
      const recent = (pattern.recentDecisions as any[]) || [];
      const category = pattern.decisionCategory || "unknown";
      if (!categoryStats[category]) categoryStats[category] = { correct: 0, total: 0 };

      for (const d of recent) {
        if (d.wouldHaveAutoed !== undefined) {
          totalPredictions++;
          categoryStats[category].total++;
          if (d.autopilotCorrect) {
            totalCorrect++;
            categoryStats[category].correct++;
          }
        }
      }
    }

    const overallAccuracy = totalPredictions > 0 ? totalCorrect / totalPredictions : 0;
    const byCategory: Record<string, { accuracy: number; total: number; readyForAutopilot: boolean }> = {};
    const recommendations: string[] = [];

    for (const [category, stats] of Object.entries(categoryStats)) {
      const accuracy = stats.total > 0 ? stats.correct / stats.total : 0;
      const threshold = this.getAutopilotThreshold(category);
      const ready = accuracy >= threshold.confidence && stats.total >= threshold.minDecisions;
      byCategory[category] = { accuracy, total: stats.total, readyForAutopilot: ready };

      if (ready) {
        recommendations.push(
          `${category.charAt(0).toUpperCase() + category.slice(1)} decisions are ${(accuracy * 100).toFixed(0)}% accurate over ${stats.total} predictions — ready for autopilot`
        );
      } else if (stats.total >= 5 && accuracy >= 0.8) {
        const remaining = threshold.minDecisions - stats.total;
        recommendations.push(
          `${category.charAt(0).toUpperCase() + category.slice(1)} decisions are ${(accuracy * 100).toFixed(0)}% accurate but need ${remaining > 0 ? `${remaining} more decisions` : "higher accuracy"} for autopilot`
        );
      }
    }

    return { overallAccuracy, byCategory, recommendations };
  }

  /** Record the real-world outcome of a decision to track not just prediction accuracy but decision quality */
  async recordOutcome(decisionId: number, outcome: "positive" | "negative" | "neutral"): Promise<void> {
    const all = await this.getPatterns();

    for (const pattern of all) {
      const recentDecisions = (pattern.recentDecisions as any[]) || [];
      let found = false;

      for (const d of recentDecisions) {
        if (d.decisionId === decisionId) {
          d.outcome = outcome;
          d.outcomeRecordedAt = new Date().toISOString();
          found = true;
          break;
        }
      }

      if (found) {
        // Calculate outcome success rate for this pattern
        const withOutcomes = recentDecisions.filter((d: any) => d.outcome !== undefined);
        const positiveOutcomes = withOutcomes.filter((d: any) => d.outcome === "positive").length;
        const outcomeSuccessRate = withOutcomes.length > 0 ? positiveOutcomes / withOutcomes.length : 0;

        await db.update(decisionPatterns)
          .set({
            recentDecisions,
            updatedAt: new Date(),
          })
          .where(eq(decisionPatterns.id, pattern.id));

        return;
      }
    }
  }

  /** Generate a weekly summary report for the CEO briefing */
  async generateWeeklyReport(): Promise<string> {
    const all = await this.getPatterns();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    let totalThisWeek = 0;
    let autopilotSaves = 0;
    let shadowCorrect = 0;
    let shadowTotal = 0;
    const newlyEligible: string[] = [];

    for (const pattern of all) {
      const recent = (pattern.recentDecisions as any[]) || [];
      const weekDecisions = recent.filter((d: any) => d.timestamp >= sevenDaysAgo);
      totalThisWeek += weekDecisions.length;

      if (pattern.isAutopilotActive) {
        autopilotSaves += weekDecisions.length;
      }

      for (const d of weekDecisions) {
        if (d.wouldHaveAutoed !== undefined) {
          shadowTotal++;
          if (d.autopilotCorrect) shadowCorrect++;
        }
      }

      if (pattern.isAutopilotEligible && !pattern.isAutopilotActive) {
        newlyEligible.push(pattern.description || pattern.patternKey);
      }
    }

    const shadowAccuracy = shadowTotal > 0 ? ((shadowCorrect / shadowTotal) * 100).toFixed(1) : "N/A";

    const lines: string[] = [
      "=== Decision Autopilot Weekly Report ===",
      "",
      `Total decisions this week: ${totalThisWeek}`,
      `Autopilot saves (handled without founder): ${autopilotSaves}`,
      `Shadow prediction accuracy: ${shadowAccuracy}${shadowTotal > 0 ? `% (${shadowCorrect}/${shadowTotal})` : ""}`,
      "",
    ];

    if (newlyEligible.length > 0) {
      lines.push(`New patterns eligible for autopilot (${newlyEligible.length}):`);
      for (const name of newlyEligible) {
        lines.push(`  - ${name}`);
      }
    } else {
      lines.push("No new patterns eligible for autopilot this week.");
    }

    lines.push("");
    lines.push(`Active autopilot patterns: ${all.filter(p => p.isAutopilotActive).length}`);
    lines.push(`Total tracked patterns: ${all.length}`);

    return lines.join("\n");
  }

  /** Generate a human-readable description for a pattern */
  private async generatePatternDescription(agent: string, category: string, context: Record<string, any>): Promise<string> {
    try {
      const response = await routeAITask({
        taskType: "pattern_description",
        complexity: TaskComplexity.SIMPLE,
        messages: [
          { role: "system", content: "Generate a short, human-readable description (one sentence) for a CEO decision pattern. Be specific." },
          { role: "user", content: `Agent: ${agent}, Category: ${category}, Context sample: ${JSON.stringify(context)}` },
        ],
        maxTokens: 50,
        temperature: 0.2,
      });
      return response.content;
    } catch {
      return `${agent} ${category} decisions`;
    }
  }
}

export const decisionAutopilotService = new DecisionAutopilotService();
