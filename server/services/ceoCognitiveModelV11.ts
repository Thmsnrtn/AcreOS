/**
 * CEO Cognitive Model — Sovereign Company Protocol v11
 *
 * Beyond pattern matching — a learned model of the CEO's decision-making:
 * - Tracks not just approve/reject, but WHY
 * - Models risk tolerance, time horizon, agent favoritism, domain expertise
 * - "Shadow mode" — model predicts what CEO would decide. Tracks accuracy.
 * - When shadow accuracy >= 90% for a category → propose autopilot
 * - Model explains its reasoning in CEO's own decision style
 */

import { db } from "../db";
import {
  ceoCognitiveModel, ceoShadowPredictions,
  type CEOCognitiveModelEntry, type CEOShadowPrediction,
} from "@shared/schema";
import { eq, desc, and, sql, count } from "drizzle-orm";
import { routeAITask, TaskComplexity } from "./aiRouter";

const AUTOPILOT_THRESHOLD = 90; // % accuracy needed
const AUTOPILOT_MIN_SAMPLES = 15;

class CEOCognitiveModelService {

  /**
   * Train (or retrain) the cognitive model for a decision category.
   * Analyzes past CEO decisions to extract preferences and patterns.
   */
  async train(decisionCategory: string, recentDecisions: Array<{
    context: Record<string, any>;
    agentRecommendations: Array<{ agentCodename: string; recommendation: string }>;
    ceoChoice: string;
    outcome?: string;
  }>): Promise<CEOCognitiveModelEntry> {
    if (recentDecisions.length < 3) throw new Error("Need at least 3 decisions to train");

    const prompt = `Analyze these CEO decisions to build a cognitive model:

CATEGORY: ${decisionCategory}
DECISIONS (${recentDecisions.length}):
${recentDecisions.map((d, i) => `
Decision ${i + 1}:
  Context: ${JSON.stringify(d.context).slice(0, 300)}
  Agent recommendations: ${d.agentRecommendations.map(r => `${r.agentCodename}: ${r.recommendation}`).join("; ")}
  CEO chose: ${d.ceoChoice}
  Outcome: ${d.outcome || "unknown"}`).join("\n")}

Extract the CEO's cognitive model:

Respond in JSON:
{
  "riskTolerance": 65,
  "timeHorizon": "short|medium|long",
  "agentWeighting": { "agent_name": 0.8 },
  "domainExpertise": { "pricing": 0.9, "legal": 0.3 },
  "patterns": [
    { "pattern": "Always approves retention discounts < 20%", "frequency": 5, "confidence": 90 },
    { "pattern": "Overrides Shield on customer-facing decisions", "frequency": 3, "confidence": 70 }
  ]
}`;

    const result = await routeAITask({ task: prompt, complexity: TaskComplexity.COMPLEX, responseFormat: "json" });
    const parsed = JSON.parse(result.response);

    // Check if model exists for this category
    const [existing] = await db.select().from(ceoCognitiveModel)
      .where(eq(ceoCognitiveModel.decisionCategory, decisionCategory)).limit(1);

    if (existing) {
      const [updated] = await db.update(ceoCognitiveModel)
        .set({
          modelVersion: existing.modelVersion + 1,
          learnedPreferences: {
            riskTolerance: parsed.riskTolerance || 50,
            timeHorizon: parsed.timeHorizon || "medium",
            agentWeighting: parsed.agentWeighting || {},
            domainExpertise: parsed.domainExpertise || {},
          },
          decisionPatterns: parsed.patterns || [],
          lastTrainedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(ceoCognitiveModel.id, existing.id))
        .returning();
      return updated;
    }

    const [created] = await db.insert(ceoCognitiveModel).values({
      decisionCategory,
      learnedPreferences: {
        riskTolerance: parsed.riskTolerance || 50,
        timeHorizon: parsed.timeHorizon || "medium",
        agentWeighting: parsed.agentWeighting || {},
        domainExpertise: parsed.domainExpertise || {},
      },
      decisionPatterns: parsed.patterns || [],
      lastTrainedAt: new Date(),
    }).returning();

    return created;
  }

  /**
   * Make a shadow prediction — what would the CEO decide?
   */
  async shadowPredict(params: {
    decisionCategory: string;
    context: Record<string, any>;
    options: string[];
    agentRecommendations?: Array<{ agentCodename: string; recommendation: string }>;
  }): Promise<CEOShadowPrediction> {
    // Load the model
    const [model] = await db.select().from(ceoCognitiveModel)
      .where(eq(ceoCognitiveModel.decisionCategory, params.decisionCategory)).limit(1);

    const modelContext = model ? `
CEO COGNITIVE MODEL (v${model.modelVersion}):
  Risk tolerance: ${(model.learnedPreferences as any)?.riskTolerance || 50}/100
  Time horizon: ${(model.learnedPreferences as any)?.timeHorizon || "medium"}
  Agent weighting: ${JSON.stringify((model.learnedPreferences as any)?.agentWeighting || {})}
  Known patterns: ${(model.decisionPatterns as any[])?.map((p: any) => p.pattern).join("; ") || "none"}` : "No model trained yet — using general reasoning";

    const prompt = `You are modeling the CEO's decision-making. Predict what they would choose.

${modelContext}

DECISION CATEGORY: ${params.decisionCategory}
CONTEXT: ${JSON.stringify(params.context)}
OPTIONS: ${params.options.join(" | ")}
${params.agentRecommendations ? `AGENT RECOMMENDATIONS:\n${params.agentRecommendations.map(r => `  ${r.agentCodename}: ${r.recommendation}`).join("\n")}` : ""}

Based on the CEO's established patterns and preferences, predict their choice.

Respond in JSON:
{
  "prediction": "The option the CEO would choose",
  "reasoning": "Why the CEO would choose this (in their style, referencing their patterns)",
  "confidence": 75
}`;

    const result = await routeAITask({ task: prompt, complexity: TaskComplexity.MODERATE, responseFormat: "json" });
    const parsed = JSON.parse(result.response);

    const [prediction] = await db.insert(ceoShadowPredictions).values({
      decisionCategory: params.decisionCategory,
      decisionContext: params.context,
      modelPrediction: parsed.prediction || params.options[0],
      modelReasoning: parsed.reasoning || "Prediction based on available patterns",
      modelConfidence: parsed.confidence || 50,
    }).returning();

    return prediction;
  }

  /**
   * Resolve a shadow prediction — compare against CEO's actual decision.
   */
  async resolvePrediction(predictionId: number, ceoDecision: string): Promise<CEOShadowPrediction> {
    const [pred] = await db.select().from(ceoShadowPredictions)
      .where(eq(ceoShadowPredictions.id, predictionId)).limit(1);
    if (!pred) throw new Error("Prediction not found");

    // Determine if correct (fuzzy match via AI)
    const matchPrompt = `Does this CEO decision match the model's prediction?

MODEL PREDICTED: ${pred.modelPrediction}
CEO ACTUALLY CHOSE: ${ceoDecision}

Consider semantic equivalence, not just exact text match.

Respond in JSON:
{ "matches": true, "divergenceReason": "null or why they differ" }`;

    let wasCorrect = pred.modelPrediction.toLowerCase().trim() === ceoDecision.toLowerCase().trim();
    let divergenceReason: string | null = null;

    try {
      const result = await routeAITask({ task: matchPrompt, complexity: TaskComplexity.SIMPLE, responseFormat: "json" });
      const parsed = JSON.parse(result.response);
      wasCorrect = parsed.matches;
      divergenceReason = parsed.divergenceReason || null;
    } catch { /* use string comparison */ }

    const [updated] = await db.update(ceoShadowPredictions)
      .set({
        ceoActualDecision: ceoDecision,
        wasCorrect,
        divergenceReason,
        resolvedAt: new Date(),
      })
      .where(eq(ceoShadowPredictions.id, predictionId))
      .returning();

    // Update model accuracy
    await this.updateModelAccuracy(pred.decisionCategory);

    return updated;
  }

  /**
   * Recalculate model accuracy and autopilot eligibility.
   */
  private async updateModelAccuracy(decisionCategory: string): Promise<void> {
    const resolved = await db.select().from(ceoShadowPredictions)
      .where(and(
        eq(ceoShadowPredictions.decisionCategory, decisionCategory),
        sql`${ceoShadowPredictions.wasCorrect} IS NOT NULL`,
      ));

    if (resolved.length === 0) return;

    const correct = resolved.filter(p => p.wasCorrect).length;
    const accuracy = (correct / resolved.length) * 100;
    const eligible = accuracy >= AUTOPILOT_THRESHOLD && resolved.length >= AUTOPILOT_MIN_SAMPLES;

    await db.update(ceoCognitiveModel)
      .set({
        shadowAccuracy: String(Math.round(accuracy * 10) / 10),
        shadowPredictions: resolved.length,
        shadowCorrect: correct,
        autopilotEligible: eligible,
        updatedAt: new Date(),
      })
      .where(eq(ceoCognitiveModel.decisionCategory, decisionCategory));
  }

  /**
   * Enable/disable autopilot for a category.
   */
  async toggleAutopilot(decisionCategory: string, enabled: boolean): Promise<void> {
    await db.update(ceoCognitiveModel)
      .set({ autopilotEnabled: enabled, updatedAt: new Date() })
      .where(eq(ceoCognitiveModel.decisionCategory, decisionCategory));
  }

  async getModel(category: string): Promise<CEOCognitiveModelEntry | null> {
    const [m] = await db.select().from(ceoCognitiveModel)
      .where(eq(ceoCognitiveModel.decisionCategory, category)).limit(1);
    return m || null;
  }

  async getAllModels(): Promise<CEOCognitiveModelEntry[]> {
    return db.select().from(ceoCognitiveModel).orderBy(desc(ceoCognitiveModel.updatedAt));
  }

  async getAutopilotEligible(): Promise<CEOCognitiveModelEntry[]> {
    return db.select().from(ceoCognitiveModel)
      .where(eq(ceoCognitiveModel.autopilotEligible, true));
  }

  async getRecentPredictions(category?: string, limit = 20): Promise<CEOShadowPrediction[]> {
    const conditions = category ? [eq(ceoShadowPredictions.decisionCategory, category)] : [];
    return db.select().from(ceoShadowPredictions)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(ceoShadowPredictions.createdAt)).limit(limit);
  }
}

export const ceoCognitiveModelService = new CEOCognitiveModelService();
