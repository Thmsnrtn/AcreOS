/**
 * SCP Golden Suite & Auto-Rollback — Sovereign Company Protocol v2
 *
 * Golden Suite: When the CEO corrects an agent and the corrected session
 * succeeds, that correction is promoted to a golden case — a permanent
 * regression test that prevents the system from forgetting hard-won lessons.
 *
 * Auto-Rollback: If an agent's performance metrics degrade after an evolution,
 * the engine automatically rolls back to the previous version.
 *
 * Enhanced Metrics: Per-agent tracking of total_sessions, success_rate,
 * correction_rate, override_rate, escalation_accuracy, golden_suite_size.
 */

import { db } from "../db";
import { scpGoldenCases, scpEvolutionMetrics, companyAgents } from "@shared/schema";
import { eq, and, sql, count } from "drizzle-orm";
import { logger } from "../utils/logger";
import crypto from "crypto";
import {
  getAgentVersion,
  getAgentMetrics,
  updateMetrics,
  readGoldenSuite,
  appendGoldenCase,
  readEvolutionLog,
  type AgentCodename,
  AGENT_CODENAMES,
} from "./scpConfigVersioning";
import { getEvolutionCadence } from "./scpEvolutionEngine";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface GoldenCase {
  id: string;
  agent: string;
  description: string;
  lesson: string;
  session_id: string;
  created_at: string;
}

export interface MetricSnapshot {
  total_sessions: number;
  success_rate: number;
  correction_rate: number;
  override_rate: number;
  escalation_accuracy: number;
  golden_suite_size: number;
}

export interface RollbackResult {
  rolled_back: boolean;
  agent: string;
  from_version: number;
  to_version: number;
  reason: string;
  metrics_before: MetricSnapshot;
  metrics_after: MetricSnapshot;
}

export interface AutoRollbackConfig {
  threshold: number; // Percentage drop that triggers rollback (default: 10)
  window: number; // Number of sessions to evaluate (default: 5)
}

const DEFAULT_ROLLBACK_CONFIG: AutoRollbackConfig = {
  threshold: 10,
  window: 5,
};

// ─── Golden Case Promotion ─────────────────────────────────────────────────

/**
 * Detect if a session should promote a golden case.
 * Conditions:
 *   1. CEO corrected the agent during the session
 *   2. The corrected session ended successfully
 */
export function shouldPromoteGoldenCase(interaction: {
  outcome: "success" | "failure" | "partial" | "overridden";
  ceo_corrections?: string[];
}): boolean {
  return (
    interaction.outcome === "success" &&
    (interaction.ceo_corrections?.length ?? 0) > 0
  );
}

/**
 * Promote a correction to a golden case.
 * Stores both in the agent's golden-suite.jsonl and in the DB.
 */
export async function promoteToGoldenCase(
  agent: AgentCodename,
  correction: string,
  sessionId: string,
  context?: Record<string, unknown>
): Promise<GoldenCase> {
  const goldenCase: GoldenCase = {
    id: crypto.randomUUID(),
    agent,
    description: `CEO correction in session ${sessionId}`,
    lesson: correction,
    session_id: sessionId,
    created_at: new Date().toISOString(),
  };

  // Store in file-based golden suite
  appendGoldenCase(agent, goldenCase);

  // Store in DB for querying
  await db.insert(scpGoldenCases).values({
    caseId: goldenCase.id,
    agentCodename: agent,
    description: goldenCase.description,
    lesson: goldenCase.lesson,
    sessionId: sessionId,
    context: context ?? {},
  });

  // Update golden suite size in metrics
  const currentMetrics = getAgentMetrics(agent);
  updateMetrics(agent, {
    golden_suite_size: (currentMetrics?.golden_suite_size ?? 0) + 1,
  });

  logger.info("Golden case promoted", {
    agent,
    caseId: goldenCase.id,
    lesson: goldenCase.lesson,
  });

  return goldenCase;
}

/**
 * Get all golden cases for an agent from the DB.
 */
export async function getGoldenCases(agent: string): Promise<typeof scpGoldenCases.$inferSelect[]> {
  return db.query.scpGoldenCases.findMany({
    where: eq(scpGoldenCases.agentCodename, agent),
    orderBy: [sql`created_at DESC`],
  });
}

/**
 * Get golden cases across all agents.
 */
export async function getAllGoldenCases(): Promise<{
  total: number;
  byAgent: Record<string, number>;
  recentCases: typeof scpGoldenCases.$inferSelect[];
}> {
  const allCases = await db.query.scpGoldenCases.findMany({
    orderBy: [sql`created_at DESC`],
  });

  const byAgent: Record<string, number> = {};
  for (const c of allCases) {
    byAgent[c.agentCodename] = (byAgent[c.agentCodename] ?? 0) + 1;
  }

  return {
    total: allCases.length,
    byAgent,
    recentCases: allCases.slice(0, 10),
  };
}

// ─── Enhanced Metric Tracking ──────────────────────────────────────────────

/**
 * Record a session outcome and update all relevant metrics.
 */
export function recordSessionMetrics(
  agent: AgentCodename,
  session: {
    outcome: "success" | "failure" | "partial" | "overridden";
    had_corrections: boolean;
    had_overrides: boolean;
    escalation_warranted?: boolean; // Was the escalation appropriate?
  }
): MetricSnapshot {
  const metrics = getAgentMetrics(agent);
  const totalSessions = (metrics?.total_sessions ?? 0) + 1;

  // Running average calculation
  const prevSuccess = (metrics?.success_rate ?? 0) / 100;
  const prevCorrection = (metrics?.correction_rate ?? 0) / 100;
  const prevOverride = (metrics?.ceo_override_rate ?? 0) / 100;
  const prevEscalation = (metrics?.escalation_accuracy ?? 0) / 100;

  const newSuccess = session.outcome === "success" ? 1 : 0;
  const newCorrection = session.had_corrections ? 1 : 0;
  const newOverride = session.had_overrides ? 1 : 0;
  const newEscalation = session.escalation_warranted !== undefined
    ? (session.escalation_warranted ? 1 : 0)
    : prevEscalation; // Keep previous if not applicable

  const successRate = ((prevSuccess * (totalSessions - 1) + newSuccess) / totalSessions) * 100;
  const correctionRate = ((prevCorrection * (totalSessions - 1) + newCorrection) / totalSessions) * 100;
  const overrideRate = ((prevOverride * (totalSessions - 1) + newOverride) / totalSessions) * 100;
  const escalationAccuracy = session.escalation_warranted !== undefined
    ? ((prevEscalation * (totalSessions - 1) + newEscalation) / totalSessions) * 100
    : (metrics?.escalation_accuracy ?? 0);

  const snapshot: MetricSnapshot = {
    total_sessions: totalSessions,
    success_rate: Math.round(successRate),
    correction_rate: Math.round(correctionRate),
    override_rate: Math.round(overrideRate),
    escalation_accuracy: Math.round(escalationAccuracy),
    golden_suite_size: metrics?.golden_suite_size ?? 0,
  };

  updateMetrics(agent, {
    total_sessions: snapshot.total_sessions,
    success_rate: snapshot.success_rate / 100,
    correction_rate: snapshot.correction_rate / 100,
    ceo_override_rate: snapshot.override_rate / 100,
    escalation_accuracy: snapshot.escalation_accuracy / 100,
    golden_suite_size: snapshot.golden_suite_size,
  });

  return snapshot;
}

// ─── Auto-Rollback ─────────────────────────────────────────────────────────

/**
 * Check if an agent should be rolled back based on metric degradation.
 * Compares recent window against pre-evolution baseline.
 */
export function checkAutoRollback(
  agent: AgentCodename,
  config: AutoRollbackConfig = DEFAULT_ROLLBACK_CONFIG
): RollbackResult | null {
  const version = getAgentVersion(agent);
  if (!version || version.version <= 1) return null; // Nothing to roll back to

  const metrics = getAgentMetrics(agent);
  if (!metrics || metrics.total_sessions < config.window) return null; // Not enough data

  const currentMetrics: MetricSnapshot = {
    total_sessions: metrics.total_sessions,
    success_rate: Math.round((metrics.success_rate ?? 0) * 100),
    correction_rate: Math.round((metrics.correction_rate ?? 0) * 100),
    override_rate: Math.round((metrics.ceo_override_rate ?? 0) * 100),
    escalation_accuracy: Math.round((metrics.escalation_accuracy ?? 0) * 100),
    golden_suite_size: metrics.golden_suite_size ?? 0,
  };

  const baselineMetrics = version.metrics_snapshot;
  if (!baselineMetrics) return null;

  const baselineSuccess = Math.round((baselineMetrics.success_rate ?? 0) * 100);
  const successDrop = baselineSuccess - currentMetrics.success_rate;

  const baselineCorrectionRate = Math.round((baselineMetrics.correction_rate ?? 0) * 100);
  const correctionIncrease = currentMetrics.correction_rate - baselineCorrectionRate;

  // Trigger rollback if success rate dropped OR correction rate spiked
  if (successDrop >= config.threshold || correctionIncrease >= config.threshold) {
    const reason = successDrop >= config.threshold
      ? `Success rate dropped from ${baselineSuccess}% to ${currentMetrics.success_rate}% (${successDrop}% drop)`
      : `Correction rate increased from ${baselineCorrectionRate}% to ${currentMetrics.correction_rate}% (${correctionIncrease}% increase)`;

    return {
      rolled_back: true,
      agent,
      from_version: version.version,
      to_version: version.parent ?? 1,
      reason,
      metrics_before: {
        total_sessions: baselineMetrics.total_sessions ?? 0,
        success_rate: baselineSuccess,
        correction_rate: baselineCorrectionRate,
        override_rate: Math.round((baselineMetrics.ceo_override_rate ?? 0) * 100),
        escalation_accuracy: 0,
        golden_suite_size: 0,
      },
      metrics_after: currentMetrics,
    };
  }

  return null;
}

/**
 * Execute an auto-rollback by reverting the agent's config files.
 * In v2, this means reverting the version.json to the parent version.
 * The actual file content rollback would require git or file snapshots —
 * for now, we flag the rollback and notify the CEO.
 */
export function executeRollback(
  agent: AgentCodename,
  fromVersion: number,
  toVersion: number,
  reason: string
): void {
  // Update version.json to reflect rollback
  const currentVersion = getAgentVersion(agent);
  if (currentVersion) {
    // We can't fully revert file contents without git snapshots,
    // but we mark the rollback in the evolution log and version metadata
    const { bumpVersion, appendEvolutionLog } = require("./scpConfigVersioning");

    // Create a rollback version entry
    bumpVersion(agent, `rollback-${crypto.randomUUID().slice(0, 8)}`, ["ROLLBACK"], {
      total_sessions: currentVersion.metrics_snapshot?.total_sessions ?? 0,
      success_rate: currentVersion.metrics_snapshot?.success_rate ?? 0,
      correction_rate: currentVersion.metrics_snapshot?.correction_rate ?? 0,
      ceo_override_rate: currentVersion.metrics_snapshot?.ceo_override_rate ?? 0,
    });

    appendEvolutionLog(agent, {
      timestamp: new Date().toISOString(),
      version: fromVersion,
      session_id: `rollback-${fromVersion}-to-${toVersion}`,
      changes: ["ROLLBACK"],
      deltas: [{
        file: "ROLLBACK",
        type: "remove" as const,
        rationale: reason,
        confidence: 1.0,
      }],
      gates_passed: [],
      gates_failed: ["auto_rollback"],
    });
  }

  logger.warn("Agent auto-rolled back", {
    agent,
    fromVersion,
    toVersion,
    reason,
  });
}

// ─── Trust Promotion Suggestions ───────────────────────────────────────────

export interface TrustPromotionSuggestion {
  agent: string;
  current_trust: number;
  suggested_trust: number;
  reason: string;
  metrics: MetricSnapshot;
}

/**
 * Check if any agents qualify for trust promotions.
 * Based on v2 spec: high success rate, low correction rate, sufficient history.
 */
export async function checkTrustPromotions(): Promise<TrustPromotionSuggestion[]> {
  const suggestions: TrustPromotionSuggestion[] = [];

  for (const agent of AGENT_CODENAMES) {
    const metrics = getAgentMetrics(agent);
    if (!metrics || metrics.total_sessions < 20) continue; // Need history

    const successRate = Math.round((metrics.success_rate ?? 0) * 100);
    const correctionRate = Math.round((metrics.correction_rate ?? 0) * 100);

    // Fetch current trust score from DB
    try {
      const dbAgent = await db.query.companyAgents.findFirst({
        where: eq(companyAgents.codename, agent.includes("_") ? agent : `${agent}_cto`),
      });

      if (!dbAgent) continue;

      const currentTrust = dbAgent.trustScore ?? 50;

      // Promotion thresholds (from v2 spec)
      if (currentTrust < 75 && successRate >= 90 && correctionRate <= 5 && metrics.total_sessions >= 50) {
        suggestions.push({
          agent,
          current_trust: currentTrust,
          suggested_trust: 80,
          reason: `${successRate}% success rate across ${metrics.total_sessions} sessions with only ${correctionRate}% corrections`,
          metrics: {
            total_sessions: metrics.total_sessions,
            success_rate: successRate,
            correction_rate: correctionRate,
            override_rate: Math.round((metrics.ceo_override_rate ?? 0) * 100),
            escalation_accuracy: Math.round((metrics.escalation_accuracy ?? 0) * 100),
            golden_suite_size: metrics.golden_suite_size ?? 0,
          },
        });
      } else if (currentTrust < 90 && successRate >= 95 && correctionRate <= 2 && metrics.total_sessions >= 80) {
        suggestions.push({
          agent,
          current_trust: currentTrust,
          suggested_trust: 92,
          reason: `${successRate}% success rate across ${metrics.total_sessions} sessions with only ${correctionRate}% corrections. Eligible for full autonomy.`,
          metrics: {
            total_sessions: metrics.total_sessions,
            success_rate: successRate,
            correction_rate: correctionRate,
            override_rate: Math.round((metrics.ceo_override_rate ?? 0) * 100),
            escalation_accuracy: Math.round((metrics.escalation_accuracy ?? 0) * 100),
            golden_suite_size: metrics.golden_suite_size ?? 0,
          },
        });
      }
    } catch {
      // Agent may not be in DB yet
    }
  }

  return suggestions;
}

// ─── Evolution Status Summary ──────────────────────────────────────────────

/**
 * Get a summary of overnight evolution activity for the CEO briefing.
 */
export function getEvolutionSummary(): Array<{
  agent: string;
  version: number;
  cadence: string;
  total_sessions: number;
  golden_suite_size: number;
  last_evolved: string | null;
  recent_changes: string[];
}> {
  return AGENT_CODENAMES.map((agent) => {
    const version = getAgentVersion(agent);
    const metrics = getAgentMetrics(agent);
    const log = readEvolutionLog(agent);
    const recentChanges = log.slice(-3).map((e) =>
      `v${e.version}: ${e.changes.join(", ")} (${e.deltas.length} delta(s))`
    );

    return {
      agent,
      version: version?.version ?? 1,
      cadence: getEvolutionCadence(metrics?.total_sessions ?? 0),
      total_sessions: metrics?.total_sessions ?? 0,
      golden_suite_size: metrics?.golden_suite_size ?? 0,
      last_evolved: metrics?.last_evolution_at ?? null,
      recent_changes: recentChanges,
    };
  });
}

// ─── Exported Service ──────────────────────────────────────────────────────

export const scpGoldenSuite = {
  shouldPromoteGoldenCase,
  promoteToGoldenCase,
  getGoldenCases,
  getAllGoldenCases,
  recordSessionMetrics,
  checkAutoRollback,
  executeRollback,
  checkTrustPromotions,
  getEvolutionSummary,
};
