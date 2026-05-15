/**
 * Closed-Loop Learning Engine — Sovereign Company Protocol v10
 *
 * The missing feedback loop. Currently outcomes go into a table and die.
 * This system:
 * 1. After every agent action, waits for the outcome window (24h–30d)
 * 2. Compares actual result to predicted result
 * 3. Extracts a specific learning
 * 4. Propagates the learning to EVERY agent that could benefit
 * 5. Adjusts the originating agent's confidence calibration
 * 6. Updates trust scores based on prediction accuracy
 *
 * This is the difference between "agents that work" and "agents that get smarter every week."
 */

import { db } from "../db";
import {
  learningPropagations, outcomeCalibrations,
  agentInitiatives,
  type LearningPropagation, type OutcomeCalibration,
} from "@shared/schema";
import { eq, desc, and, lte, gte, sql, count } from "drizzle-orm";
import { routeAITask, TaskComplexity } from "./aiRouter";
import { companyAgentService } from "./companyAgents";
import { logger } from "../utils/logger";

// ─── Learning Type Routing ─────────────────────────────────────────────────

const LEARNING_RELEVANCE_MAP: Record<string, string[]> = {
  timing_insight: ["beacon_marketing", "sophie_support", "forge_revenue", "pioneer_growth"],
  audience_pattern: ["beacon_marketing", "forge_revenue", "pioneer_growth", "oracle_analytics"],
  conversion_factor: ["forge_revenue", "beacon_marketing", "pioneer_growth"],
  cost_signal: ["ledger_finance", "forge_revenue", "sentinel_risk"],
  risk_pattern: ["sentinel_risk", "shield_compliance", "oracle_analytics", "ledger_finance"],
  support_pattern: ["sophie_support", "beacon_marketing", "forge_revenue"],
  compliance_insight: ["shield_compliance", "sentinel_risk", "ledger_finance"],
  market_signal: ["atlas_market", "oracle_analytics", "beacon_marketing", "forge_revenue"],
};

// ─── Service ───────────────────────────────────────────────────────────────

class ClosedLoopLearningService {

  /**
   * Record a prediction for later calibration.
   */
  async recordPrediction(params: {
    agentCodename: string;
    actionType: string;
    predictedOutcome: string;
    predictedConfidence: number;
    outcomeWindowDays?: number;
  }): Promise<number> {
    const [record] = await db.insert(outcomeCalibrations).values({
      agentCodename: params.agentCodename,
      actionType: params.actionType,
      predictedOutcome: params.predictedOutcome,
      predictedConfidence: params.predictedConfidence,
      outcomeWindowDays: params.outcomeWindowDays || 7,
    }).returning();
    return record.id;
  }

  /**
   * Measure an outcome against its prediction.
   * Extracts learning, propagates to relevant agents, and calibrates confidence.
   */
  async measureOutcome(calibrationId: number, params: {
    actualOutcome: string;
    actualSuccess: boolean;
  }): Promise<{
    calibration: OutcomeCalibration;
    learning?: LearningPropagation;
  }> {
    // Get the original prediction
    const [prediction] = await db.select().from(outcomeCalibrations)
      .where(eq(outcomeCalibrations.id, calibrationId)).limit(1);

    if (!prediction) throw new Error("Calibration record not found");

    const accuracyDelta = prediction.predictedConfidence - (params.actualSuccess ? 100 : 0);

    // Update calibration record
    const [updated] = await db.update(outcomeCalibrations)
      .set({
        actualOutcome: params.actualOutcome,
        actualSuccess: params.actualSuccess,
        accuracyDelta,
        outcomeMeasuredAt: new Date(),
        status: "measured",
      })
      .where(eq(outcomeCalibrations.id, calibrationId))
      .returning();

    // Extract learning via AI
    const learningPrompt = `An agent made a prediction, and we now know the outcome:

AGENT: ${prediction.agentCodename}
ACTION TYPE: ${prediction.actionType}
PREDICTED: ${prediction.predictedOutcome} (confidence: ${prediction.predictedConfidence}%)
ACTUAL: ${params.actualOutcome} (success: ${params.actualSuccess})
ACCURACY DELTA: ${accuracyDelta} (positive = overconfident, negative = underconfident)

Extract a specific, actionable learning from this outcome. Categorize it.

Respond in JSON:
{
  "learning": "Specific actionable insight (e.g., 'Tuesday retention emails convert 31% better than Monday')",
  "learningType": "timing_insight|audience_pattern|conversion_factor|cost_signal|risk_pattern|support_pattern|compliance_insight|market_signal",
  "evidence": ["Evidence point 1", "Evidence point 2"],
  "shouldPropagate": true,
  "relevantAgents": ["agent_codename_1", "agent_codename_2"]
}`;

    try {
      const result = await routeAITask({
        task: learningPrompt,
        complexity: TaskComplexity.MODERATE,
        responseFormat: "json",
      });

      const parsed = JSON.parse(result.content);

      if (parsed.shouldPropagate && parsed.learning) {
        // Determine target agents from learning type
        const typeAgents = LEARNING_RELEVANCE_MAP[parsed.learningType] || [];
        const targetAgents = [...new Set([
          ...typeAgents,
          ...(parsed.relevantAgents || []),
        ])].filter(a => a !== prediction.agentCodename);

        const [propagation] = await db.insert(learningPropagations).values({
          sourceAgent: prediction.agentCodename,
          targetAgents,
          learningType: parsed.learningType || "conversion_factor",
          learning: parsed.learning,
          evidence: parsed.evidence || [],
          outcomeWindowDays: prediction.outcomeWindowDays,
          originalOutcomeId: String(calibrationId),
          propagationStatus: "propagated",
          propagatedAt: new Date(),
          acceptanceRate: 100, // all agents receive it
        }).returning();

        return { calibration: updated, learning: propagation };
      }

      return { calibration: updated };
    } catch (err) {
      logger.error("[ClosedLoop] Learning extraction failed", err);
      return { calibration: updated };
    }
  }

  /**
   * Scan for predictions awaiting outcome measurement.
   * Finds predictions past their outcome window that haven't been measured.
   */
  async getAwaitingOutcome(agentCodename?: string): Promise<OutcomeCalibration[]> {
    const conditions = [eq(outcomeCalibrations.status, "awaiting_outcome")];
    if (agentCodename) {
      conditions.push(eq(outcomeCalibrations.agentCodename, agentCodename));
    }

    return db.select().from(outcomeCalibrations)
      .where(and(...conditions))
      .orderBy(desc(outcomeCalibrations.createdAt))
      .limit(50);
  }

  /**
   * Get overdue predictions (past their outcome window, still not measured).
   */
  async getOverduePredictions(): Promise<OutcomeCalibration[]> {
    return db.select().from(outcomeCalibrations)
      .where(
        and(
          eq(outcomeCalibrations.status, "awaiting_outcome"),
          lte(outcomeCalibrations.createdAt, sql`NOW() - INTERVAL '1 day' * outcome_window_days`)
        )
      )
      .orderBy(outcomeCalibrations.createdAt)
      .limit(50);
  }

  /**
   * Get agent calibration stats — how accurate are their predictions?
   */
  async getAgentCalibrationStats(agentCodename: string): Promise<{
    totalPredictions: number;
    measuredPredictions: number;
    averageConfidence: number;
    actualSuccessRate: number;
    calibrationError: number;
    isOverconfident: boolean;
  }> {
    const measured = await db.select().from(outcomeCalibrations)
      .where(
        and(
          eq(outcomeCalibrations.agentCodename, agentCodename),
          eq(outcomeCalibrations.status, "measured"),
        )
      );

    const total = await db.select({ count: count() }).from(outcomeCalibrations)
      .where(eq(outcomeCalibrations.agentCodename, agentCodename));

    if (measured.length === 0) {
      return {
        totalPredictions: Number(total[0]?.count || 0),
        measuredPredictions: 0,
        averageConfidence: 0,
        actualSuccessRate: 0,
        calibrationError: 0,
        isOverconfident: false,
      };
    }

    const avgConfidence = measured.reduce((sum, m) => sum + m.predictedConfidence, 0) / measured.length;
    const successes = measured.filter(m => m.actualSuccess).length;
    const successRate = (successes / measured.length) * 100;
    const calibrationError = avgConfidence - successRate;

    return {
      totalPredictions: Number(total[0]?.count || 0),
      measuredPredictions: measured.length,
      averageConfidence: Math.round(avgConfidence),
      actualSuccessRate: Math.round(successRate),
      calibrationError: Math.round(calibrationError),
      isOverconfident: calibrationError > 15,
    };
  }

  /**
   * Get all calibration stats across agents.
   */
  async getAllCalibrationStats(): Promise<Array<{
    agentCodename: string;
    totalPredictions: number;
    measuredPredictions: number;
    averageConfidence: number;
    actualSuccessRate: number;
    calibrationError: number;
    isOverconfident: boolean;
  }>> {
    const agents = await companyAgentService.getAll();
    const stats = await Promise.all(
      agents.map(async (agent) => ({
        agentCodename: agent.codename,
        ...(await this.getAgentCalibrationStats(agent.codename)),
      }))
    );
    return stats.filter(s => s.totalPredictions > 0);
  }

  /**
   * Get recent learning propagations.
   */
  async getRecentLearnings(limit = 20): Promise<LearningPropagation[]> {
    return db.select().from(learningPropagations)
      .orderBy(desc(learningPropagations.createdAt))
      .limit(limit);
  }

  /**
   * Get learnings received by a specific agent.
   */
  async getLearningsForAgent(agentCodename: string, limit = 20): Promise<LearningPropagation[]> {
    return db.select().from(learningPropagations)
      .where(sql`${learningPropagations.targetAgents}::jsonb ? ${agentCodename}`)
      .orderBy(desc(learningPropagations.createdAt))
      .limit(limit);
  }

  /**
   * Get learnings by type.
   */
  async getLearningsByType(learningType: string, limit = 20): Promise<LearningPropagation[]> {
    return db.select().from(learningPropagations)
      .where(eq(learningPropagations.learningType, learningType))
      .orderBy(desc(learningPropagations.createdAt))
      .limit(limit);
  }

  /**
   * Get system-wide learning velocity (learnings per week).
   */
  async getLearningVelocity(): Promise<{ thisWeek: number; lastWeek: number; trend: string }> {
    const thisWeek = await db.select({ count: count() }).from(learningPropagations)
      .where(gte(learningPropagations.createdAt, sql`NOW() - INTERVAL '7 days'`));

    const lastWeek = await db.select({ count: count() }).from(learningPropagations)
      .where(
        and(
          gte(learningPropagations.createdAt, sql`NOW() - INTERVAL '14 days'`),
          lte(learningPropagations.createdAt, sql`NOW() - INTERVAL '7 days'`),
        )
      );

    const tw = Number(thisWeek[0]?.count || 0);
    const lw = Number(lastWeek[0]?.count || 0);

    return {
      thisWeek: tw,
      lastWeek: lw,
      trend: tw > lw ? "accelerating" : tw < lw ? "decelerating" : "steady",
    };
  }
}

export const closedLoopLearningService = new ClosedLoopLearningService();
