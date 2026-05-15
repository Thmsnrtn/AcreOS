/**
 * Agent Self-Calibration Protocol — Sovereign Company Protocol v10
 *
 * Agents modify their own operating parameters based on performance data:
 * - If Oracle's anomaly detection has too many false positives, tighten thresholds
 * - If Sophie's outreach timing is suboptimal, shift send windows
 * - If Beacon's content gets overridden >60%, request personality recalibration
 * - Personality prompts evolve over time — tracked with full version history
 *
 * CEO sees: "Atlas self-calibrated: reduced escalation sensitivity after 12 false positives.
 *            New false positive rate: 8%. [Revert] [Approve]"
 */

import { db } from "../db";
import {
  agentCalibrationHistory, outcomeCalibrations,
  type AgentCalibrationHistoryEntry,
} from "@shared/schema";
import { eq, desc, and, gte, count, sql } from "drizzle-orm";
import { routeAITask, TaskComplexity } from "./aiRouter";
import { companyAgentService } from "./companyAgents";
import { logger } from "../utils/logger";

// ─── Calibration Rules ─────────────────────────────────────────────────────

interface CalibrationRule {
  agentCodename: string;
  parameterName: string;
  calibrationType: string;
  condition: string; // human-readable condition
  evaluate: (metrics: Record<string, any>) => { shouldCalibrate: boolean; reason: string; suggestedValue: string };
}

const CALIBRATION_RULES: CalibrationRule[] = [
  {
    agentCodename: "oracle_analytics",
    parameterName: "anomaly_detection_threshold",
    calibrationType: "threshold_adjust",
    condition: "False positive rate exceeds 30%",
    evaluate: (metrics) => {
      const fpRate = metrics.falsePositiveRate || 0;
      return {
        shouldCalibrate: fpRate > 30,
        reason: `False positive rate at ${fpRate}% (threshold: 30%)`,
        suggestedValue: fpRate > 50 ? "strict" : "moderate",
      };
    },
  },
  {
    agentCodename: "sophie_support",
    parameterName: "outreach_timing_window",
    calibrationType: "timing_shift",
    condition: "Email open rates below 15%",
    evaluate: (metrics) => {
      const openRate = metrics.emailOpenRate || 20;
      return {
        shouldCalibrate: openRate < 15,
        reason: `Email open rate at ${openRate}% — timing may be suboptimal`,
        suggestedValue: "shift_to_optimal_window",
      };
    },
  },
  {
    agentCodename: "beacon_marketing",
    parameterName: "content_style_preference",
    calibrationType: "personality_evolve",
    condition: "CEO overrides content suggestions >60% of the time",
    evaluate: (metrics) => {
      const overrideRate = metrics.overrideRate || 0;
      return {
        shouldCalibrate: overrideRate > 60,
        reason: `CEO overrides ${overrideRate}% of content suggestions — recalibration needed`,
        suggestedValue: "realign_to_ceo_preference",
      };
    },
  },
  {
    agentCodename: "sentinel_risk",
    parameterName: "risk_sensitivity_level",
    calibrationType: "threshold_adjust",
    condition: "Risk alerts that turn out to be non-issues exceed 40%",
    evaluate: (metrics) => {
      const falseAlarmRate = metrics.falseAlarmRate || 0;
      return {
        shouldCalibrate: falseAlarmRate > 40,
        reason: `${falseAlarmRate}% of risk alerts are false alarms — reducing sensitivity`,
        suggestedValue: falseAlarmRate > 60 ? "low" : "moderate",
      };
    },
  },
  {
    agentCodename: "forge_revenue",
    parameterName: "deal_confidence_calibration",
    calibrationType: "confidence_recalibrate",
    condition: "Revenue predictions consistently off by >25%",
    evaluate: (metrics) => {
      const predictionError = metrics.predictionError || 0;
      return {
        shouldCalibrate: predictionError > 25,
        reason: `Revenue predictions off by ${predictionError}% — recalibrating confidence`,
        suggestedValue: `deflate_${Math.round(predictionError / 2)}pct`,
      };
    },
  },
];

// ─── Service ───────────────────────────────────────────────────────────────

class AgentSelfCalibrationService {

  /**
   * Run the self-calibration cycle for all agents.
   * Evaluates each rule against current metrics and auto-calibrates where needed.
   */
  async runCalibrationCycle(): Promise<AgentCalibrationHistoryEntry[]> {
    const results: AgentCalibrationHistoryEntry[] = [];
    const agents = await companyAgentService.getAll();

    for (const rule of CALIBRATION_RULES) {
      try {
        // Get agent's performance metrics
        const metrics = await this.getAgentMetrics(rule.agentCodename);
        const evaluation = rule.evaluate(metrics);

        if (evaluation.shouldCalibrate) {
          // Get current parameter value
          const currentValue = await this.getCurrentParameterValue(rule.agentCodename, rule.parameterName);

          // Record the calibration
          const [entry] = await db.insert(agentCalibrationHistory).values({
            agentCodename: rule.agentCodename,
            calibrationType: rule.calibrationType,
            parameterName: rule.parameterName,
            oldValue: currentValue,
            newValue: evaluation.suggestedValue,
            triggerReason: evaluation.reason,
            performanceBefore: metrics,
            status: "applied",
          }).returning();

          results.push(entry);
        }
      } catch (err) {
        logger.error(`[SelfCalibration] Rule evaluation failed for ${rule.agentCodename}`, err);
      }
    }

    return results;
  }

  /**
   * Run AI-driven calibration analysis for a specific agent.
   */
  async analyzeAndCalibrate(agentCodename: string): Promise<AgentCalibrationHistoryEntry | null> {
    const metrics = await this.getAgentMetrics(agentCodename);
    const agent = (await companyAgentService.getAll()).find(a => a.codename === agentCodename);
    if (!agent) return null;

    const recentHistory = await this.getAgentHistory(agentCodename, 10);

    const prompt = `You are analyzing agent ${agentCodename} (${agent.title}) for self-calibration.

CURRENT METRICS:
${JSON.stringify(metrics, null, 2)}

RECENT CALIBRATION HISTORY:
${recentHistory.map(h => `- [${h.calibrationType}] ${h.parameterName}: ${h.oldValue} → ${h.newValue} (${h.triggerReason})`).join("\n") || "None"}

Should this agent self-calibrate any parameters? If yes, what specifically?

Respond in JSON:
{
  "shouldCalibrate": true,
  "calibrationType": "threshold_adjust|timing_shift|confidence_recalibrate|personality_evolve",
  "parameterName": "parameter to adjust",
  "currentValue": "current value",
  "suggestedValue": "new value",
  "reason": "why this calibration is needed"
}

If no calibration needed, respond: { "shouldCalibrate": false }`;

    try {
      const result = await routeAITask({
        task: prompt,
        complexity: TaskComplexity.MODERATE,
        responseFormat: "json",
      });

      const parsed = JSON.parse(result.content);

      if (parsed.shouldCalibrate) {
        const [entry] = await db.insert(agentCalibrationHistory).values({
          agentCodename,
          calibrationType: parsed.calibrationType || "threshold_adjust",
          parameterName: parsed.parameterName || "general",
          oldValue: parsed.currentValue || "default",
          newValue: parsed.suggestedValue || "adjusted",
          triggerReason: parsed.reason || "AI-detected calibration need",
          performanceBefore: metrics,
          status: "applied",
        }).returning();

        return entry;
      }

      return null;
    } catch (err) {
      logger.error(`[SelfCalibration] AI analysis failed for ${agentCodename}`, err);
      return null;
    }
  }

  /**
   * Revert a calibration (CEO decided it was wrong).
   */
  async revert(calibrationId: number): Promise<void> {
    await db.update(agentCalibrationHistory)
      .set({ status: "reverted", ceoAction: "reverted" })
      .where(eq(agentCalibrationHistory.id, calibrationId));
  }

  /**
   * Approve a calibration (CEO confirms it's good).
   */
  async approve(calibrationId: number): Promise<void> {
    await db.update(agentCalibrationHistory)
      .set({ status: "approved", ceoAction: "approved" })
      .where(eq(agentCalibrationHistory.id, calibrationId));
  }

  /**
   * Get calibration history for an agent.
   */
  async getAgentHistory(agentCodename: string, limit = 20): Promise<AgentCalibrationHistoryEntry[]> {
    return db.select().from(agentCalibrationHistory)
      .where(eq(agentCalibrationHistory.agentCodename, agentCodename))
      .orderBy(desc(agentCalibrationHistory.createdAt))
      .limit(limit);
  }

  /**
   * Get all recent calibrations.
   */
  async getRecent(limit = 30): Promise<AgentCalibrationHistoryEntry[]> {
    return db.select().from(agentCalibrationHistory)
      .orderBy(desc(agentCalibrationHistory.createdAt))
      .limit(limit);
  }

  /**
   * Get pending calibrations (applied but not yet approved/reverted).
   */
  async getPending(): Promise<AgentCalibrationHistoryEntry[]> {
    return db.select().from(agentCalibrationHistory)
      .where(eq(agentCalibrationHistory.status, "applied"))
      .orderBy(desc(agentCalibrationHistory.createdAt));
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  private async getAgentMetrics(agentCodename: string): Promise<Record<string, any>> {
    // Get outcome calibration data
    const calibrations = await db.select().from(outcomeCalibrations)
      .where(
        and(
          eq(outcomeCalibrations.agentCodename, agentCodename),
          eq(outcomeCalibrations.status, "measured"),
          gte(outcomeCalibrations.createdAt, sql`NOW() - INTERVAL '30 days'`),
        )
      );

    const totalPredictions = calibrations.length;
    const correctPredictions = calibrations.filter(c => c.actualSuccess).length;
    const avgConfidence = totalPredictions > 0
      ? calibrations.reduce((sum, c) => sum + c.predictedConfidence, 0) / totalPredictions
      : 50;
    const successRate = totalPredictions > 0 ? (correctPredictions / totalPredictions) * 100 : 50;
    const predictionError = Math.abs(avgConfidence - successRate);

    // Simulated metrics (in production, would pull from real data)
    return {
      totalPredictions,
      correctPredictions,
      avgConfidence: Math.round(avgConfidence),
      successRate: Math.round(successRate),
      predictionError: Math.round(predictionError),
      falsePositiveRate: totalPredictions > 0 ? Math.round((1 - correctPredictions / totalPredictions) * 100) : 0,
      falseAlarmRate: Math.round(Math.random() * 30), // placeholder
      emailOpenRate: 15 + Math.round(Math.random() * 20), // placeholder
      overrideRate: Math.round(Math.random() * 50), // placeholder
    };
  }

  private async getCurrentParameterValue(agentCodename: string, parameterName: string): Promise<string> {
    const [latest] = await db.select().from(agentCalibrationHistory)
      .where(
        and(
          eq(agentCalibrationHistory.agentCodename, agentCodename),
          eq(agentCalibrationHistory.parameterName, parameterName),
        )
      )
      .orderBy(desc(agentCalibrationHistory.createdAt))
      .limit(1);

    return latest?.newValue || "default";
  }
}

export const agentSelfCalibrationService = new AgentSelfCalibrationService();
