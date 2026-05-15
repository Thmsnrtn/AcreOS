/**
 * CEO Decision Replay + Bias Detection — Sovereign Company Protocol v10
 *
 * Every CEO decision is recorded with full context. Periodically the system:
 * 1. Replays past decisions with current knowledge
 * 2. Identifies systematic biases ("You override Sophie 3x more than others.
 *    Her success rate when NOT overridden is 87%. Trust her more.")
 * 3. Tracks decision quality score over time
 * 4. Detects decision fatigue patterns
 * 5. Feeds into Founder Wellbeing with actionable data
 */

import { db } from "../db";
import {
  ceoDecisionReplays, agentInitiatives,
  type CEODecisionReplay,
} from "@shared/schema";
import { eq, desc, gte, and, count, sql } from "drizzle-orm";
import { routeAITask, TaskComplexity } from "./aiRouter";

// ─── Bias Types ────────────────────────────────────────────────────────────

type BiasType =
  | "agent_favoritism"     // consistently favoring one agent's recommendations
  | "agent_distrust"       // consistently overriding a specific agent
  | "recency_bias"         // over-weighting recent events
  | "confirmation_bias"    // choosing options that confirm existing beliefs
  | "loss_aversion"        // avoiding risks even when upside justifies them
  | "decision_fatigue"     // quality degrades after many decisions
  | "anchoring"            // over-relying on first piece of information
  | "sunk_cost"            // continuing commitments due to past investment
  ;

// ─── Service ───────────────────────────────────────────────────────────────

class CEODecisionReplayService {

  /**
   * Record a CEO decision for future replay.
   */
  async recordDecision(params: {
    decisionType: string;
    decisionSummary: string;
    context: Record<string, any>;
    agentRecommendations: Array<{ agentCodename: string; recommendation: string; confidence: number }>;
    ceoChoice: string;
  }): Promise<number> {
    const [record] = await db.insert(ceoDecisionReplays).values({
      originalDecisionId: `dec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      decisionType: params.decisionType,
      decisionSummary: params.decisionSummary,
      originalContext: params.context,
      agentRecommendations: params.agentRecommendations,
      ceoChoice: params.ceoChoice,
      originalDate: new Date(),
    }).returning();

    return record.id;
  }

  /**
   * Replay a past decision with the benefit of hindsight.
   * Uses current outcome data to assess whether the decision was optimal.
   */
  async replayDecision(decisionId: number, outcomeData: Record<string, any>): Promise<CEODecisionReplay> {
    const [decision] = await db.select().from(ceoDecisionReplays)
      .where(eq(ceoDecisionReplays.id, decisionId)).limit(1);

    if (!decision) throw new Error("Decision not found");

    const prompt = `You are the CEO Decision Replay system. Analyze this past decision:

DECISION: ${decision.decisionSummary}
TYPE: ${decision.decisionType}
DATE: ${decision.originalDate}

CONTEXT AT DECISION TIME:
${JSON.stringify(decision.originalContext, null, 2)}

AGENT RECOMMENDATIONS:
${decision.agentRecommendations.map((r: any) =>
  `- ${r.agentCodename}: ${r.recommendation} (confidence: ${r.confidence}%)`
).join("\n")}

CEO'S CHOICE: ${decision.ceoChoice}

ACTUAL OUTCOME:
${JSON.stringify(outcomeData, null, 2)}

Analyze:
1. Was this the right call given what we know now?
2. Quality score 0-100
3. Any decision biases detected?

Respond in JSON:
{
  "hindsightAssessment": "Detailed assessment (2-3 sentences)",
  "wasOptimal": true,
  "qualityScore": 75,
  "biasFlags": [
    {
      "biasType": "agent_distrust",
      "description": "Sophie recommended X but was overridden. Her recommendation would have been better.",
      "frequency": 3,
      "severity": "moderate"
    }
  ]
}`;

    const result = await routeAITask({
      task: prompt,
      complexity: TaskComplexity.COMPLEX,
      responseFormat: "json",
    });

    const parsed = JSON.parse(result.content);

    const [updated] = await db.update(ceoDecisionReplays)
      .set({
        outcomeData,
        hindsightAssessment: parsed.hindsightAssessment,
        wasOptimal: parsed.wasOptimal,
        qualityScore: parsed.qualityScore,
        biasFlags: parsed.biasFlags || [],
        replayDate: new Date(),
      })
      .where(eq(ceoDecisionReplays.id, decisionId))
      .returning();

    return updated;
  }

  /**
   * Run a comprehensive bias analysis across all replayed decisions.
   */
  async analyzeBiases(days = 90): Promise<{
    overallQuality: number;
    totalDecisions: number;
    replayedDecisions: number;
    optimalRate: number;
    biases: Array<{
      biasType: string;
      frequency: number;
      severity: string;
      description: string;
      recommendation: string;
    }>;
    agentTrustInsights: Array<{
      agentCodename: string;
      timesOverridden: number;
      overrideWasWrong: number;
      recommendation: string;
    }>;
  }> {
    const safeDays = Math.max(1, Math.min(3650, Number(days) || 90));
    const replayed = await db.select().from(ceoDecisionReplays)
      .where(
        and(
          gte(ceoDecisionReplays.originalDate, sql.raw(`NOW() - INTERVAL '${safeDays} days'`)),
          sql`${ceoDecisionReplays.qualityScore} IS NOT NULL`,
        )
      );

    const total = await db.select({ count: count() }).from(ceoDecisionReplays)
      .where(gte(ceoDecisionReplays.originalDate, sql.raw(`NOW() - INTERVAL '${safeDays} days'`)));

    if (replayed.length === 0) {
      return {
        overallQuality: 0,
        totalDecisions: Number(total[0]?.count || 0),
        replayedDecisions: 0,
        optimalRate: 0,
        biases: [],
        agentTrustInsights: [],
      };
    }

    const avgQuality = replayed.reduce((sum, d) => sum + (d.qualityScore || 0), 0) / replayed.length;
    const optimalCount = replayed.filter(d => d.wasOptimal).length;
    const optimalRate = (optimalCount / replayed.length) * 100;

    // Aggregate bias flags
    const biasMap = new Map<string, { count: number; descriptions: string[]; severities: string[] }>();
    for (const decision of replayed) {
      for (const flag of (decision.biasFlags || []) as Array<{ biasType: string; description: string; severity: string }>) {
        const existing = biasMap.get(flag.biasType) || { count: 0, descriptions: [], severities: [] };
        existing.count++;
        existing.descriptions.push(flag.description);
        existing.severities.push(flag.severity);
        biasMap.set(flag.biasType, existing);
      }
    }

    const biases = Array.from(biasMap.entries()).map(([biasType, data]) => ({
      biasType,
      frequency: data.count,
      severity: data.severities.includes("high") ? "high" : data.severities.includes("moderate") ? "moderate" : "low",
      description: data.descriptions[0],
      recommendation: this.getBiasRecommendation(biasType, data.count),
    })).sort((a, b) => b.frequency - a.frequency);

    // Agent trust insights — who gets overridden and shouldn't be?
    const agentOverrides = new Map<string, { overridden: number; wrongOverrides: number }>();
    for (const decision of replayed) {
      for (const rec of (decision.agentRecommendations || []) as Array<{ agentCodename: string; recommendation: string }>) {
        if (rec.recommendation !== decision.ceoChoice) {
          const existing = agentOverrides.get(rec.agentCodename) || { overridden: 0, wrongOverrides: 0 };
          existing.overridden++;
          if (!decision.wasOptimal) existing.wrongOverrides++;
          agentOverrides.set(rec.agentCodename, existing);
        }
      }
    }

    const agentTrustInsights = Array.from(agentOverrides.entries())
      .filter(([_, data]) => data.overridden >= 2)
      .map(([agentCodename, data]) => ({
        agentCodename,
        timesOverridden: data.overridden,
        overrideWasWrong: data.wrongOverrides,
        recommendation: data.wrongOverrides > data.overridden * 0.5
          ? `Consider trusting ${agentCodename} more — your overrides were wrong ${Math.round(data.wrongOverrides / data.overridden * 100)}% of the time`
          : `Override pattern seems justified`,
      }))
      .sort((a, b) => b.overrideWasWrong - a.overrideWasWrong);

    return {
      overallQuality: Math.round(avgQuality),
      totalDecisions: Number(total[0]?.count || 0),
      replayedDecisions: replayed.length,
      optimalRate: Math.round(optimalRate),
      biases,
      agentTrustInsights,
    };
  }

  /**
   * Get decisions awaiting replay (have context but no outcome yet).
   */
  async getAwaitingReplay(): Promise<CEODecisionReplay[]> {
    return db.select().from(ceoDecisionReplays)
      .where(sql`${ceoDecisionReplays.qualityScore} IS NULL`)
      .orderBy(desc(ceoDecisionReplays.originalDate))
      .limit(30);
  }

  /**
   * Get recent replayed decisions.
   */
  async getRecentReplays(limit = 20): Promise<CEODecisionReplay[]> {
    return db.select().from(ceoDecisionReplays)
      .where(sql`${ceoDecisionReplays.qualityScore} IS NOT NULL`)
      .orderBy(desc(ceoDecisionReplays.replayDate))
      .limit(limit);
  }

  /**
   * Get decision quality trend over time.
   */
  async getQualityTrend(days = 90): Promise<Array<{ week: string; avgQuality: number; count: number }>> {
    const safeDays = Math.max(1, Math.min(3650, Number(days) || 90));
    const decisions = await db.select().from(ceoDecisionReplays)
      .where(
        and(
          gte(ceoDecisionReplays.originalDate, sql.raw(`NOW() - INTERVAL '${safeDays} days'`)),
          sql`${ceoDecisionReplays.qualityScore} IS NOT NULL`,
        )
      )
      .orderBy(ceoDecisionReplays.originalDate);

    // Group by week
    const weekMap = new Map<string, { total: number; count: number }>();
    for (const d of decisions) {
      const weekStart = new Date(d.originalDate);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      const key = weekStart.toISOString().split("T")[0];
      const existing = weekMap.get(key) || { total: 0, count: 0 };
      existing.total += d.qualityScore || 0;
      existing.count++;
      weekMap.set(key, existing);
    }

    return Array.from(weekMap.entries()).map(([week, data]) => ({
      week,
      avgQuality: Math.round(data.total / data.count),
      count: data.count,
    }));
  }

  private getBiasRecommendation(biasType: string, frequency: number): string {
    const recs: Record<string, string> = {
      agent_favoritism: "Diversify decision inputs — you may be relying too heavily on one agent's perspective",
      agent_distrust: "Review the overridden agent's actual track record before dismissing their recommendations",
      recency_bias: "Consider longer time horizons — recent events may not represent the full picture",
      confirmation_bias: "Actively seek contradicting evidence before confirming your initial direction",
      loss_aversion: "Calculate the expected value of risky options — you may be leaving upside on the table",
      decision_fatigue: "Batch important decisions for morning hours and limit to 5 significant decisions per day",
      anchoring: "Seek multiple independent estimates before forming your position",
      sunk_cost: "Evaluate each decision on future expected value, not past investment",
    };
    return recs[biasType] || "Review this pattern and consider how it affects your decision quality";
  }
}

export const ceoDecisionReplayService = new CEODecisionReplayService();
