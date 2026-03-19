// @ts-nocheck
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

function generatePatternKey(agentCodename: string, category: string, context?: Record<string, any>): string {
  // Create a pattern key that groups similar decisions
  // e.g. "forge:pricing_under_5k" or "sophie:churn_response"
  let key = `${agentCodename}:${category}`;
  if (context?.amount && context.amount < 5000) key += "_under_5k";
  else if (context?.amount && context.amount >= 5000) key += "_over_5k";
  return key;
}

// ─── Service ─────────────────────────────────────────────────────────────────

class DecisionAutopilotService {

  /** Record a CEO decision and update patterns */
  async recordDecision(input: {
    agentCodename: string;
    decisionCategory: string;
    action: "approved" | "rejected" | "modified" | "shelved";
    context: Record<string, any>;
    decisionId?: number;
  }): Promise<void> {
    const patternKey = generatePatternKey(input.agentCodename, input.decisionCategory, input.context);

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

    // Calculate prediction confidence using beta distribution approximation
    const dominantCount = Math.max(approvedCount, rejectedCount);
    const predictionConfidence = totalDecisions >= 5
      ? Math.min(0.99, dominantCount / totalDecisions * (1 - 1 / (totalDecisions + 1)))
      : 0;

    // Eligible for autopilot: confidence > 0.9 AND 15+ decisions AND one action dominates
    const isAutopilotEligible = predictionConfidence > 0.9 && totalDecisions >= 15 && predictedAction !== "uncertain";

    // Shadow mode: record what autopilot WOULD have done
    if (recentDecisions.length > 0) {
      const lastDecision = recentDecisions[recentDecisions.length - 1];
      lastDecision.wouldHaveAutoed = predictedAction;
      lastDecision.autopilotCorrect = (predictedAction === input.action);
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
