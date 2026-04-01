/**
 * Predictive Orchestration — Sovereign Company Protocol v11
 *
 * The system predicts what needs to happen next:
 * - Pattern: "Revenue dip > 5% → ticket spike 48h later"
 * - Prediction: dip detected → pre-stage Sophie's response BEFORE tickets arrive
 * - "Anticipation queue" — actions staged but not executed
 * - If trigger arrives → instant execution. If not → cancel.
 * - Builds temporal prediction model of organizational cause-and-effect
 */

import { db } from "../db";
import {
  predictiveStagedActions, temporalPredictionPatterns,
  type PredictiveStagedAction, type TemporalPredictionPattern,
} from "@shared/schema";
import { eq, desc, and, lte, gte, sql, count } from "drizzle-orm";
import { routeAITask, TaskComplexity } from "./aiRouter";

class PredictiveOrchestrationService {

  /**
   * Register a temporal prediction pattern (cause → effect with delay).
   */
  async registerPattern(params: {
    causeSignal: string;
    causeAgent: string;
    effectSignal: string;
    effectAgent: string;
    avgDelayHours?: number;
    correlationStrength?: number;
    autoStageEnabled?: boolean;
  }): Promise<TemporalPredictionPattern> {
    const [pattern] = await db.insert(temporalPredictionPatterns).values({
      causeSignal: params.causeSignal,
      causeAgent: params.causeAgent,
      effectSignal: params.effectSignal,
      effectAgent: params.effectAgent,
      avgDelayHours: String(params.avgDelayHours || 48),
      correlationStrength: String(params.correlationStrength || 0.5),
      autoStageEnabled: params.autoStageEnabled || false,
    }).returning();
    return pattern;
  }

  /**
   * Signal that a cause event has occurred. Check patterns and auto-stage.
   */
  async signalCause(causeSignal: string, causeAgent: string): Promise<PredictiveStagedAction[]> {
    // Find matching patterns
    const patterns = await db.select().from(temporalPredictionPatterns)
      .where(and(
        eq(temporalPredictionPatterns.causeSignal, causeSignal),
        eq(temporalPredictionPatterns.causeAgent, causeAgent),
        eq(temporalPredictionPatterns.autoStageEnabled, true),
      ));

    const staged: PredictiveStagedAction[] = [];

    for (const pattern of patterns) {
      const delayHours = Number(pattern.avgDelayHours);
      const triggerFrom = new Date(Date.now() + (delayHours * 0.5) * 3600000);
      const triggerTo = new Date(Date.now() + (delayHours * 1.5) * 3600000);
      const expiresAt = new Date(Date.now() + (delayHours * 2) * 3600000);

      // AI-generate the staged action
      let stagedAction = `Prepare for ${pattern.effectSignal}`;
      let stagedDetails = {};

      try {
        const prompt = `A cause signal "${causeSignal}" from ${causeAgent} has fired.
Historical pattern shows this leads to "${pattern.effectSignal}" at ${pattern.effectAgent} within ~${delayHours} hours.
Correlation: ${Number(pattern.correlationStrength) * 100}% | Accuracy: ${Number(pattern.accuracyRate) * 100}%

What specific action should ${pattern.effectAgent} pre-stage?

Respond in JSON:
{
  "action": "Specific action to pre-stage (1 sentence)",
  "details": { "preparation": "what to prepare", "resources": "what to allocate" }
}`;

        const result = await routeAITask({ task: prompt, complexity: TaskComplexity.SIMPLE, responseFormat: "json" });
        const parsed = JSON.parse(result.response);
        stagedAction = parsed.action || stagedAction;
        stagedDetails = parsed.details || {};
      } catch { /* use defaults */ }

      const [action] = await db.insert(predictiveStagedActions).values({
        predictionSource: `pattern:${pattern.id}`,
        triggerPattern: pattern.effectSignal,
        triggerConfidence: Math.round(Number(pattern.correlationStrength) * 100),
        stagedAgent: pattern.effectAgent,
        stagedAction,
        stagedActionDetails: stagedDetails,
        predictedTriggerWindow: { from: triggerFrom.toISOString(), to: triggerTo.toISOString() },
        expiresAt,
      }).returning();

      staged.push(action);

      // Update pattern tracking
      await db.update(temporalPredictionPatterns)
        .set({ lastTriggeredAt: new Date(), sampleCount: pattern.sampleCount + 1, updatedAt: new Date() })
        .where(eq(temporalPredictionPatterns.id, pattern.id));
    }

    return staged;
  }

  /**
   * Signal that an effect event occurred. Check if we had it pre-staged.
   */
  async signalEffect(effectSignal: string): Promise<PredictiveStagedAction | null> {
    // Find matching staged action
    const [staged] = await db.select().from(predictiveStagedActions)
      .where(and(
        eq(predictiveStagedActions.triggerPattern, effectSignal),
        eq(predictiveStagedActions.status, "staged"),
      ))
      .orderBy(desc(predictiveStagedActions.createdAt))
      .limit(1);

    if (!staged) return null;

    // Execute the pre-staged action
    const [updated] = await db.update(predictiveStagedActions)
      .set({
        status: "triggered",
        triggerDetectedAt: new Date(),
      })
      .where(eq(predictiveStagedActions.id, staged.id))
      .returning();

    // Update pattern accuracy
    const patternIdMatch = staged.predictionSource.match(/pattern:(\d+)/);
    if (patternIdMatch) {
      const patternId = parseInt(patternIdMatch[1]);
      const [pattern] = await db.select().from(temporalPredictionPatterns)
        .where(eq(temporalPredictionPatterns.id, patternId)).limit(1);
      if (pattern) {
        const newAccuracy = ((Number(pattern.accuracyRate) * pattern.sampleCount) + 1) / (pattern.sampleCount);
        await db.update(temporalPredictionPatterns)
          .set({ lastCorrect: true, accuracyRate: String(Math.min(1, newAccuracy)), updatedAt: new Date() })
          .where(eq(temporalPredictionPatterns.id, patternId));
      }
    }

    return updated;
  }

  /**
   * Mark a staged action as executed.
   */
  async markExecuted(actionId: number, result?: Record<string, any>): Promise<void> {
    await db.update(predictiveStagedActions)
      .set({ status: "completed", executedAt: new Date(), executionResult: result || {} })
      .where(eq(predictiveStagedActions.id, actionId));
  }

  /**
   * Cancel a staged action.
   */
  async cancel(actionId: number, reason: string): Promise<void> {
    await db.update(predictiveStagedActions)
      .set({ status: "cancelled", cancelledReason: reason })
      .where(eq(predictiveStagedActions.id, actionId));
  }

  /**
   * Process expired staged actions.
   */
  async processExpirations(): Promise<number> {
    const expired = await db.select().from(predictiveStagedActions)
      .where(and(
        eq(predictiveStagedActions.status, "staged"),
        lte(predictiveStagedActions.expiresAt, new Date()),
      ));

    for (const action of expired) {
      await db.update(predictiveStagedActions)
        .set({ status: "expired", cancelledReason: "Trigger window expired — prediction was incorrect" })
        .where(eq(predictiveStagedActions.id, action.id));

      // Update pattern accuracy (false prediction)
      const patternIdMatch = action.predictionSource.match(/pattern:(\d+)/);
      if (patternIdMatch) {
        const patternId = parseInt(patternIdMatch[1]);
        await db.update(temporalPredictionPatterns)
          .set({ lastCorrect: false, updatedAt: new Date() })
          .where(eq(temporalPredictionPatterns.id, patternId));
      }
    }

    return expired.length;
  }

  async getStagedActions(): Promise<PredictiveStagedAction[]> {
    return db.select().from(predictiveStagedActions)
      .where(eq(predictiveStagedActions.status, "staged"))
      .orderBy(predictiveStagedActions.expiresAt);
  }

  async getRecent(limit = 30): Promise<PredictiveStagedAction[]> {
    return db.select().from(predictiveStagedActions)
      .orderBy(desc(predictiveStagedActions.createdAt)).limit(limit);
  }

  async getPatterns(): Promise<TemporalPredictionPattern[]> {
    return db.select().from(temporalPredictionPatterns)
      .orderBy(desc(temporalPredictionPatterns.correlationStrength));
  }

  async getStats(): Promise<{
    totalPatterns: number;
    autoEnabled: number;
    stagedActions: number;
    triggered: number;
    expired: number;
    avgAccuracy: number;
  }> {
    const patterns = await db.select().from(temporalPredictionPatterns);
    const actions = await db.select().from(predictiveStagedActions);

    return {
      totalPatterns: patterns.length,
      autoEnabled: patterns.filter(p => p.autoStageEnabled).length,
      stagedActions: actions.filter(a => a.status === "staged").length,
      triggered: actions.filter(a => a.status === "triggered" || a.status === "completed").length,
      expired: actions.filter(a => a.status === "expired").length,
      avgAccuracy: patterns.length > 0
        ? Math.round(patterns.reduce((s, p) => s + Number(p.accuracyRate), 0) / patterns.length * 100)
        : 0,
    };
  }
}

export const predictiveOrchestrationService = new PredictiveOrchestrationService();
