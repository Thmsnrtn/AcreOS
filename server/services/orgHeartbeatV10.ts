// @ts-nocheck
/**
 * Organizational Heartbeat Monitor — Sovereign Company Protocol v10
 *
 * Not metrics about the business — metrics about THE SYSTEM ITSELF.
 * The organization's vital signs:
 * - Agent response latency
 * - Decision queue depth
 * - Learning velocity
 * - Trust trajectory
 * - Escalation ratio
 * - Feedback loop closure rate
 * - System coherence score
 *
 * When the heartbeat detects dysfunction, it surfaces it as a
 * system health alert, not a business metric.
 */

import { db } from "../db";
import {
  orgHeartbeatSnapshots, agentInitiatives, learningPropagations,
  outcomeCalibrations, agentCalibrationHistory,
  type OrgHeartbeatSnapshot,
} from "@shared/schema";
import { eq, desc, gte, and, count, sql } from "drizzle-orm";
import { companyAgentService } from "./companyAgents";
import { routeAITask, TaskComplexity } from "./aiRouter";

// ─── Health Grading ────────────────────────────────────────────────────────

function computeHealthGrade(metrics: {
  escalationRatio: number;
  learningVelocity: number;
  feedbackClosureRate: number;
  coherenceScore: number;
  anomalyCount: number;
}): string {
  let score = 100;

  // Escalation ratio > 50% is bad (agents aren't autonomous enough)
  if (metrics.escalationRatio > 50) score -= 20;
  else if (metrics.escalationRatio > 30) score -= 10;

  // Learning velocity of 0 means system isn't learning
  if (metrics.learningVelocity === 0) score -= 15;
  else if (metrics.learningVelocity < 3) score -= 5;

  // Feedback closure below 50% means outcomes aren't being measured
  if (metrics.feedbackClosureRate < 30) score -= 20;
  else if (metrics.feedbackClosureRate < 60) score -= 10;

  // Coherence below 70 means agents are drifting from compass
  if (metrics.coherenceScore < 50) score -= 25;
  else if (metrics.coherenceScore < 70) score -= 10;

  // Each anomaly costs points
  score -= metrics.anomalyCount * 5;

  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  if (score >= 40) return "D";
  return "F";
}

// ─── Service ───────────────────────────────────────────────────────────────

class OrgHeartbeatService {

  /**
   * Take a heartbeat snapshot — measure all organizational vital signs.
   */
  async takeSnapshot(type: "hourly" | "daily" | "weekly" = "hourly"): Promise<OrgHeartbeatSnapshot> {
    const now = new Date();
    const agents = await companyAgentService.getAll();

    // 1. Decision queue depth — count pending approvals
    const pendingApprovals = await db.select({ count: count() }).from(agentInitiatives)
      .where(eq(agentInitiatives.status, "pending_approval"));
    const decisionQueueDepth = Number(pendingApprovals[0]?.count || 0);

    // 2. Learning velocity — new learnings in last 7 days
    const recentLearnings = await db.select({ count: count() }).from(learningPropagations)
      .where(gte(learningPropagations.createdAt, sql`NOW() - INTERVAL '7 days'`));
    const learningVelocity = Number(recentLearnings[0]?.count || 0);

    // 3. Escalation ratio — % of recent initiatives that needed CEO
    const totalInitiatives = await db.select({ count: count() }).from(agentInitiatives)
      .where(gte(agentInitiatives.createdAt, sql`NOW() - INTERVAL '7 days'`));
    const escalatedInitiatives = await db.select({ count: count() }).from(agentInitiatives)
      .where(
        and(
          gte(agentInitiatives.createdAt, sql`NOW() - INTERVAL '7 days'`),
          eq(agentInitiatives.actionApprovalNeeded, true),
        )
      );
    const totalInit = Number(totalInitiatives[0]?.count || 0);
    const escalatedInit = Number(escalatedInitiatives[0]?.count || 0);
    const escalationRatio = totalInit > 0 ? (escalatedInit / totalInit) * 100 : 0;

    // 4. Feedback closure rate — % of predictions that got measured
    const totalPredictions = await db.select({ count: count() }).from(outcomeCalibrations)
      .where(gte(outcomeCalibrations.createdAt, sql`NOW() - INTERVAL '30 days'`));
    const measuredPredictions = await db.select({ count: count() }).from(outcomeCalibrations)
      .where(
        and(
          gte(outcomeCalibrations.createdAt, sql`NOW() - INTERVAL '30 days'`),
          eq(outcomeCalibrations.status, "measured"),
        )
      );
    const totalPred = Number(totalPredictions[0]?.count || 0);
    const measuredPred = Number(measuredPredictions[0]?.count || 0);
    const feedbackClosureRate = totalPred > 0 ? (measuredPred / totalPred) * 100 : 0;

    // 5. Agent latencies (simulated — track thinking cycle times)
    const agentLatencies: Record<string, number> = {};
    for (const agent of agents) {
      agentLatencies[agent.codename] = Math.floor(Math.random() * 2000) + 500; // placeholder
    }

    // 6. Trust trajectory — change in trust levels (simulated from calibrations)
    const trustTrajectory: Record<string, number> = {};
    for (const agent of agents) {
      const recentCals = await db.select({ count: count() }).from(agentCalibrationHistory)
        .where(
          and(
            eq(agentCalibrationHistory.agentCodename, agent.codename),
            gte(agentCalibrationHistory.createdAt, sql`NOW() - INTERVAL '7 days'`),
          )
        );
      trustTrajectory[agent.codename] = Number(recentCals[0]?.count || 0) > 0 ? 1 : 0;
    }

    // 7. Coherence score — alignment with compass (AI-assessed)
    let coherenceScore = 85; // default
    try {
      const recentInitiatives = await db.select().from(agentInitiatives)
        .where(gte(agentInitiatives.createdAt, sql`NOW() - INTERVAL '7 days'`))
        .limit(20);

      if (recentInitiatives.length > 5) {
        const prompt = `Rate the coherence of these agent initiatives on a scale of 0-100.
Coherence means: are the agents aligned with each other? Do their actions complement or contradict?

Recent agent initiatives:
${recentInitiatives.map(i => `- [${i.agentCodename}] ${i.summary} (priority: ${i.priority})`).join("\n")}

Respond with just a number 0-100.`;

        const result = await routeAITask({
          task: prompt,
          complexity: TaskComplexity.SIMPLE,
        });
        const parsed = parseInt(result.response.replace(/\D/g, ""));
        if (parsed >= 0 && parsed <= 100) coherenceScore = parsed;
      }
    } catch {
      // use default
    }

    // 8. Detect anomalies
    const anomalies: Array<{ type: string; description: string; severity: string; affectedAgent?: string }> = [];

    if (decisionQueueDepth > 10) {
      anomalies.push({
        type: "queue_overflow",
        description: `Decision queue has ${decisionQueueDepth} items — potential bottleneck`,
        severity: "warning",
      });
    }

    if (escalationRatio > 60) {
      anomalies.push({
        type: "escalation_spike",
        description: `Escalation ratio at ${Math.round(escalationRatio)}% — agents may need more autonomy`,
        severity: "warning",
      });
    }

    if (feedbackClosureRate < 20 && totalPred > 5) {
      anomalies.push({
        type: "feedback_gap",
        description: `Only ${Math.round(feedbackClosureRate)}% of predictions have been measured — learning loop is open`,
        severity: "critical",
      });
    }

    if (learningVelocity === 0) {
      anomalies.push({
        type: "learning_stall",
        description: "No new learnings this week — system may be stagnating",
        severity: "warning",
      });
    }

    // Compute health grade
    const healthGrade = computeHealthGrade({
      escalationRatio,
      learningVelocity,
      feedbackClosureRate,
      coherenceScore,
      anomalyCount: anomalies.length,
    });

    // Store snapshot
    const [snapshot] = await db.insert(orgHeartbeatSnapshots).values({
      snapshotType: type,
      agentLatencies,
      decisionQueueDepth,
      learningVelocity,
      trustTrajectory,
      escalationRatio: String(Math.round(escalationRatio * 10) / 10),
      feedbackClosureRate: String(Math.round(feedbackClosureRate * 10) / 10),
      coherenceScore,
      anomalies,
      healthGrade,
    }).returning();

    return snapshot;
  }

  /**
   * Get the latest heartbeat snapshot.
   */
  async getLatest(): Promise<OrgHeartbeatSnapshot | null> {
    const [s] = await db.select().from(orgHeartbeatSnapshots)
      .orderBy(desc(orgHeartbeatSnapshots.createdAt))
      .limit(1);
    return s || null;
  }

  /**
   * Get recent snapshots for trend analysis.
   */
  async getRecent(limit = 24): Promise<OrgHeartbeatSnapshot[]> {
    return db.select().from(orgHeartbeatSnapshots)
      .orderBy(desc(orgHeartbeatSnapshots.createdAt))
      .limit(limit);
  }

  /**
   * Get snapshots by type.
   */
  async getByType(type: string, limit = 30): Promise<OrgHeartbeatSnapshot[]> {
    return db.select().from(orgHeartbeatSnapshots)
      .where(eq(orgHeartbeatSnapshots.snapshotType, type))
      .orderBy(desc(orgHeartbeatSnapshots.createdAt))
      .limit(limit);
  }

  /**
   * Get health trend — last N snapshots' grades.
   */
  async getHealthTrend(days = 7): Promise<Array<{ date: string; grade: string; score: number }>> {
    const snapshots = await db.select().from(orgHeartbeatSnapshots)
      .where(gte(orgHeartbeatSnapshots.createdAt, sql`NOW() - INTERVAL '${days} days'`))
      .orderBy(orgHeartbeatSnapshots.createdAt);

    const gradeToScore: Record<string, number> = { A: 95, B: 80, C: 65, D: 45, F: 20 };

    return snapshots.map(s => ({
      date: s.createdAt.toISOString(),
      grade: s.healthGrade,
      score: gradeToScore[s.healthGrade] || 50,
    }));
  }

  /**
   * Get active anomalies from recent snapshots.
   */
  async getActiveAnomalies(): Promise<Array<{ type: string; description: string; severity: string; affectedAgent?: string; detectedAt: string }>> {
    const recent = await db.select().from(orgHeartbeatSnapshots)
      .orderBy(desc(orgHeartbeatSnapshots.createdAt))
      .limit(1);

    if (recent.length === 0) return [];

    return (recent[0].anomalies || []).map((a: any) => ({
      ...a,
      detectedAt: recent[0].createdAt.toISOString(),
    }));
  }
}

export const orgHeartbeatService = new OrgHeartbeatService();
