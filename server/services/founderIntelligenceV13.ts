/**
 * Founder Intelligence Layer — Sovereign Company Protocol v13
 * Daily briefings, what-if simulations, strategic recommendations,
 * and interaction tracking for founder oversight of autonomous agents.
 */

import crypto from "crypto";
import { db } from "../db";
import {
  founderBriefings,
  simulationRuns,
  strategicRecommendations,
  founderInteractions,
  trustEnforcementLog,
  agentStrategies,
  anomalyDetections,
} from "@shared/schema";
import { eq, and, desc, gte, count } from "drizzle-orm";

// ─── Types ───────────────────────────────────────────────────────────────────

interface BriefingInsight { category: string; insight: string; importance: number }
interface BriefingRec { action: string; rationale: string; impactEstimate: string; priority: number }
interface AgentHighlight { actions: number; successRate: number; trustDelta: number; noteworthy: string }
interface SimOutcome { metric: string; current: number; simulated: number; delta: number }
interface RiskFactor { factor: string; probability: number; impact: string }

interface EngagementReport {
  mostUsed: Array<{ feature: string; count: number }>;
  leastUsed: Array<{ feature: string; count: number }>;
  suggestions: string[];
  totalInteractions: number;
  avgSessionDuration: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const todayStr = () => new Date().toISOString().slice(0, 10);
const last24h = () => new Date(Date.now() - 86_400_000);
const pf = (v: string) => parseFloat(v) || 0;

function countBy<T>(items: T[], keyFn: (item: T) => string): Record<string, number> {
  const r: Record<string, number> = {};
  for (const item of items) { const k = keyFn(item); r[k] = (r[k] || 0) + 1; }
  return r;
}

// ─── Service ─────────────────────────────────────────────────────────────────

class FounderIntelligenceService {
  private static instance: FounderIntelligenceService;
  private constructor() {}
  static getInstance() {
    if (!this.instance) this.instance = new FounderIntelligenceService();
    return this.instance;
  }

  // ── 1. Generate Briefing ─────────────────────────────────────────────────

  async generateBriefing(orgId: number, date?: string) {
    const briefingDate = date ?? todayStr();
    const since = last24h();

    const [trustDecisions, strategies, anomalies] = await Promise.all([
      db.select({ decision: trustEnforcementLog.decision, agentCodename: trustEnforcementLog.agentCodename,
        trustDelta: trustEnforcementLog.trustDelta, actionType: trustEnforcementLog.actionType,
      }).from(trustEnforcementLog).where(and(eq(trustEnforcementLog.orgId, orgId), gte(trustEnforcementLog.createdAt, since))),
      db.select({ agentCodename: agentStrategies.agentCodename, name: agentStrategies.name,
        successRate: agentStrategies.successRate, trialCount: agentStrategies.trialCount,
        successCount: agentStrategies.successCount, isActive: agentStrategies.isActive,
      }).from(agentStrategies).where(eq(agentStrategies.orgId, orgId)),
      db.select({ agentCodename: anomalyDetections.agentCodename, severity: anomalyDetections.severity,
        metric: anomalyDetections.metric, autoResolved: anomalyDetections.autoResolved,
      }).from(anomalyDetections).where(and(eq(anomalyDetections.orgId, orgId), gte(anomalyDetections.createdAt, since))),
    ]);

    const decisionCounts = countBy(trustDecisions, (t) => t.decision);
    const agentMap: Record<string, { actions: number; totalDelta: number; successes: number }> = {};
    for (const td of trustDecisions) {
      const a = agentMap[td.agentCodename] ??= { actions: 0, totalDelta: 0, successes: 0 };
      a.actions++; a.totalDelta += td.trustDelta ?? 0;
      if (td.decision === "auto_execute") a.successes++;
    }

    const stratByAgent: Record<string, { successRate: number; trialCount: number }> = {};
    for (const s of strategies) stratByAgent[s.agentCodename] = { successRate: pf(s.successRate), trialCount: s.trialCount };
    const allAgents = new Set([...Object.keys(agentMap), ...Object.keys(stratByAgent)]);
    const agentHighlights: Record<string, AgentHighlight> = {};
    for (const agent of allAgents) {
      const st = agentMap[agent] || { actions: 0, totalDelta: 0, successes: 0 };
      const sr = stratByAgent[agent] || { successRate: 0, trialCount: 0 };
      const rate = st.actions > 0
        ? Math.round((st.successes / st.actions) * 100)
        : Math.round(sr.successRate * 100);

      let noteworthy = "";
      if (st.successes >= 5) noteworthy = `${st.successes} consecutive auto-executions`;
      else if (st.totalDelta < -10) noteworthy = `Significant trust decrease (${st.totalDelta})`;
      else if (sr.successRate > 0.9 && sr.trialCount >= 10)
        noteworthy = `High performer: ${Math.round(sr.successRate * 100)}% over ${sr.trialCount} trials`;

      agentHighlights[agent] = { actions: st.actions, successRate: rate, trustDelta: st.totalDelta, noteworthy };
    }

    // Build insights array
    const insights: BriefingInsight[] = [];
    const totalDec = trustDecisions.length;

    if (totalDec > 0) {
      insights.push({
        category: "trust",
        insight: `${totalDec} trust decisions: ${Object.entries(decisionCounts).map(([k, v]) => `${k}=${v}`).join(", ")}`,
        importance: totalDec > 20 ? 8 : 5,
      });
    }

    for (const [agent, s] of Object.entries(agentMap)) {
      if (s.successes >= 5) {
        insights.push({ category: "performance", insight: `Agent ${agent} had ${s.successes} consecutive successes`, importance: 7 });
      }
    }

    if (anomalies.length > 0) {
      const sevCounts = countBy(anomalies, (a) => a.severity);
      insights.push({
        category: "anomaly",
        insight: `${anomalies.length} anomalies detected: ${Object.entries(sevCounts).map(([k, v]) => `${v} ${k}`).join(", ")}`,
        importance: anomalies.some((a) => a.severity === "critical") ? 9 : 6,
      });
      const unresolved = anomalies.filter((a) => !a.autoResolved).length;
      if (unresolved > 0) {
        insights.push({ category: "anomaly", insight: `${unresolved} anomalies unresolved, may need manual intervention`, importance: 8 });
      }
    }

    const highPerformers = strategies.filter((s) => pf(s.successRate) > 0.85 && s.trialCount >= 10);
    if (highPerformers.length > 0) {
      insights.push({ category: "strategy", insight: `${highPerformers.length} strategies above 85% success rate`, importance: 5 });
    }

    // Build recommendations
    const recommendations: BriefingRec[] = [];

    for (const [agent, st] of Object.entries(agentMap)) {
      const sr = stratByAgent[agent];
      if (sr && sr.successRate > 0.9 && sr.trialCount >= 20 && st.totalDelta >= 0) {
        recommendations.push({
          action: `Consider increasing trust ceiling for agent ${agent}`,
          rationale: `${Math.round(sr.successRate * 100)}% success over ${sr.trialCount} trials with positive trust delta`,
          impactEstimate: "Reduced escalations, faster execution",
          priority: 6,
        });
      }
    }

    const anomByAgent = countBy(anomalies, (a) => a.agentCodename);
    for (const [agent, c] of Object.entries(anomByAgent)) {
      if (c >= 3) {
        recommendations.push({
          action: `Investigate recurring anomalies for agent ${agent}`,
          rationale: `${c} anomalies detected in last 24 hours`,
          impactEstimate: "Risk mitigation, system stability",
          priority: 8,
        });
      }
    }

    for (const s of strategies.filter((s) => pf(s.successRate) < 0.5 && s.trialCount >= 10 && s.isActive)) {
      recommendations.push({
        action: `Review strategy "${s.name}" for ${s.agentCodename}`,
        rationale: `${Math.round(pf(s.successRate) * 100)}% success over ${s.trialCount} trials`,
        impactEstimate: "Improved agent effectiveness",
        priority: 7,
      });
    }

    const summary = [
      `${totalDec} trust decisions processed`,
      anomalies.length > 0 ? `${anomalies.length} anomalies detected` : "",
      `${allAgents.size} agents active`,
      recommendations.length > 0 ? `${recommendations.length} recommendations` : "",
    ].filter(Boolean).join(". ") + ".";

    const metricsSnapshot = { totalDecisions: totalDec, decisionBreakdown: decisionCounts,
      anomalyCount: anomalies.length, activeStrategies: strategies.filter((s) => s.isActive).length,
      avgSuccessRate: strategies.length > 0 ? strategies.reduce((sum, s) => sum + pf(s.successRate), 0) / strategies.length : 0,
      agentCount: allAgents.size };

    const [briefing] = await db.insert(founderBriefings)
      .values({ orgId, briefingDate, summary, insights, recommendations, agentHighlights, metricsSnapshot }).returning();
    return briefing;
  }

  // ── 2. Get Briefing ──────────────────────────────────────────────────────

  async getBriefing(orgId: number, date?: string) {
    const briefingDate = date ?? todayStr();
    const [briefing] = await db.select().from(founderBriefings)
      .where(and(eq(founderBriefings.orgId, orgId), eq(founderBriefings.briefingDate, briefingDate)))
      .limit(1);

    if (!briefing) return null;

    // Mark as read on first access
    if (!briefing.isRead) {
      await db.update(founderBriefings)
        .set({ isRead: true, readAt: new Date() })
        .where(eq(founderBriefings.id, briefing.id));
      briefing.isRead = true;
      briefing.readAt = new Date();
    }
    return briefing;
  }

  // ── 3. Briefing History ──────────────────────────────────────────────────

  async getBriefingHistory(orgId: number, limit = 30) {
    return db.select().from(founderBriefings)
      .where(eq(founderBriefings.orgId, orgId))
      .orderBy(desc(founderBriefings.briefingDate))
      .limit(limit);
  }

  // ── 4. Run Simulation ────────────────────────────────────────────────────

  async runSimulation(
    orgId: number,
    data: { scenarioName: string; scenarioConfig: Record<string, any> },
  ) {
    const { scenarioName, scenarioConfig } = data;

    const [strategies, recentTrust] = await Promise.all([
      db.select().from(agentStrategies).where(eq(agentStrategies.orgId, orgId)),
      db.select().from(trustEnforcementLog)
        .where(eq(trustEnforcementLog.orgId, orgId))
        .orderBy(desc(trustEnforcementLog.createdAt))
        .limit(100),
    ]);

    let outcomes: SimOutcome[] = [];
    let riskFactors: RiskFactor[] = [];
    let recommendation = "";
    const avgRate = strategies.length > 0
      ? strategies.reduce((s, r) => s + pf(r.successRate), 0) / strategies.length : 0;

    if (scenarioName === "full_autonomy") {
      // Project what happens if all agents go to full auto
      const curAutoRate = recentTrust.length > 0
        ? recentTrust.filter((t) => t.decision === "auto_execute").length / recentTrust.length : 0;
      const projThroughput = recentTrust.length * (1.0 / Math.max(curAutoRate, 0.01));

      // Data-driven projection: success rate decays proportionally to current oversight gap
      const oversightGap = 1 - curAutoRate; // How much is currently human-reviewed
      const projectedSuccessRate = avgRate * (1 - oversightGap * 0.05); // ~5% degradation per unit of oversight removed
      const projectedThroughputMultiplier = Math.min(curAutoRate > 0 ? 1 / curAutoRate : 10, 10);
      const realProjThroughput = Math.round(recentTrust.length * projectedThroughputMultiplier);

      outcomes = [
        { metric: "auto_execution_rate", current: Math.round(curAutoRate * 100), simulated: 100, delta: Math.round((1 - curAutoRate) * 100) },
        { metric: "estimated_daily_throughput", current: recentTrust.length, simulated: realProjThroughput, delta: realProjThroughput - recentTrust.length },
        { metric: "projected_success_rate", current: Math.round(avgRate * 100), simulated: Math.round(projectedSuccessRate * 100), delta: Math.round((projectedSuccessRate - avgRate) * 100) },
      ];

      riskFactors = [
        { factor: "Reduced oversight may miss edge cases", probability: 0.3, impact: "medium" },
        { factor: "Financial actions without review", probability: 0.15, impact: "high" },
      ];
      const lowAgents = strategies.filter((s) => pf(s.successRate) < 0.7);
      if (lowAgents.length > 0) {
        riskFactors.push({ factor: `${lowAgents.length} agents below 70% would run unsupervised`, probability: 0.6, impact: "high" });
      }

      recommendation = avgRate > 0.85
        ? "System shows strong performance. Full autonomy is viable with monitoring safeguards."
        : "Current success rates suggest a phased approach. Full autonomy only for agents above 85%.";

    } else if (scenarioName === "trust_adjustment") {
      // Project effect of changing trust levels
      const targetAgent = scenarioConfig.agentCodename as string | undefined;
      const trustDelta = (scenarioConfig.trustDelta as number) ?? 10;
      const escalations = recentTrust.filter(
        (t) => t.decision === "escalate" && (!targetAgent || t.agentCodename === targetAgent),
      ).length;
      const reduction = Math.min(escalations, Math.round(escalations * (trustDelta / 100) * 0.6));

      outcomes = [
        { metric: "escalation_count", current: escalations, simulated: Math.max(0, escalations - reduction), delta: -reduction },
        { metric: "trust_level_change", current: 0, simulated: trustDelta, delta: trustDelta },
        { metric: "projected_auto_execute_increase", current: 0, simulated: reduction, delta: reduction },
      ];

      riskFactors = [{
        factor: "Increased trust may allow riskier actions through",
        probability: trustDelta > 20 ? 0.4 : 0.15,
        impact: trustDelta > 20 ? "high" : "medium",
      }];

      const relevant = targetAgent ? strategies.filter((s) => s.agentCodename === targetAgent) : strategies;
      const relAvg = relevant.length > 0 ? relevant.reduce((s, r) => s + pf(r.successRate), 0) / relevant.length : 0;
      recommendation = relAvg > 0.8
        ? `Trust adjustment of +${trustDelta} is supported by performance data.`
        : `Proceed with caution — current success rate is ${Math.round(relAvg * 100)}%.`;

    } else if (scenarioName === "strategy_change") {
      // Project effect of switching strategies
      const targetName = scenarioConfig.strategyName as string | undefined;
      const current = targetName ? strategies.find((s) => s.name === targetName) : null;
      const curRate = current ? pf(current.successRate) : avgRate;
      const projRate = Math.min(1, curRate + 0.05);

      outcomes = [
        { metric: "success_rate", current: Math.round(curRate * 100), simulated: Math.round(projRate * 100), delta: Math.round((projRate - curRate) * 100) },
        { metric: "estimated_trial_period", current: 0, simulated: 50, delta: 50 },
      ];

      riskFactors = [
        { factor: "New strategy needs ramp-up period for stable performance", probability: 0.7, impact: "low" },
        { factor: "Temporary performance dip during transition", probability: 0.5, impact: "medium" },
      ];

      recommendation = curRate < 0.5
        ? "Current strategy underperforms. Change recommended with close monitoring."
        : "Current strategy adequate. Ensure new strategy is tested in sandbox first.";

    } else {
      riskFactors = [{ factor: `Unknown scenario: ${scenarioName}`, probability: 1, impact: "unknown" }];
      recommendation = `Scenario "${scenarioName}" not recognized. Supported: full_autonomy, trust_adjustment, strategy_change.`;
    }

    const [sim] = await db.insert(simulationRuns).values({
      simulationId: crypto.randomUUID(), orgId, scenarioName, scenarioConfig,
      outcomes, confidenceInterval: "0.95", riskFactors, recommendation,
    }).returning();

    return sim;
  }

  // ── 5. Simulation History ────────────────────────────────────────────────

  async getSimulationHistory(orgId: number, limit = 20) {
    return db.select().from(simulationRuns)
      .where(eq(simulationRuns.orgId, orgId))
      .orderBy(desc(simulationRuns.createdAt))
      .limit(limit);
  }

  // ── 6. Create Recommendation ─────────────────────────────────────────────

  async createRecommendation(
    orgId: number,
    data: {
      category: string;
      recommendation: string;
      evidence: Array<{ source: string; dataPoint: string; significance: string }>;
      impactEstimate: string;
      priority?: number;
    },
  ) {
    const [rec] = await db.insert(strategicRecommendations).values({
      orgId,
      category: data.category,
      recommendation: data.recommendation,
      evidence: data.evidence,
      impactEstimate: data.impactEstimate,
      priority: data.priority ?? 5,
    }).returning();

    return rec;
  }

  // ── 7. Acknowledge Recommendation ────────────────────────────────────────

  async acknowledgeRecommendation(recommendationId: number, status: "implementing" | "dismissed") {
    const [updated] = await db.update(strategicRecommendations)
      .set({ status, acknowledgedAt: new Date() })
      .where(eq(strategicRecommendations.id, recommendationId))
      .returning();

    return updated ?? null;
  }

  // ── 8. Get Recommendations ───────────────────────────────────────────────

  async getRecommendations(orgId: number, status?: string, category?: string) {
    const conditions = [eq(strategicRecommendations.orgId, orgId)];
    if (status) conditions.push(eq(strategicRecommendations.status, status));
    if (category) conditions.push(eq(strategicRecommendations.category, category));

    return db.select().from(strategicRecommendations)
      .where(and(...conditions))
      .orderBy(desc(strategicRecommendations.priority));
  }

  // ── 9. Track Interaction ─────────────────────────────────────────────────

  async trackInteraction(
    orgId: number,
    data: { featureUsed: string; section?: string; engagementDepth?: string; sessionDurationMs?: number },
  ) {
    const [interaction] = await db.insert(founderInteractions).values({
      orgId,
      featureUsed: data.featureUsed,
      section: data.section ?? null,
      engagementDepth: data.engagementDepth ?? "glance",
      sessionDurationMs: data.sessionDurationMs ?? null,
    }).returning();

    return interaction;
  }

  // ── 10. Engagement Report ────────────────────────────────────────────────

  async getEngagementReport(orgId: number): Promise<EngagementReport> {
    const interactions = await db.select().from(founderInteractions)
      .where(eq(founderInteractions.orgId, orgId));

    if (interactions.length === 0) {
      return {
        mostUsed: [],
        leastUsed: [],
        suggestions: ["Start exploring the agent dashboard to see autonomous actions in real time"],
        totalInteractions: 0,
        avgSessionDuration: 0,
      };
    }

    const featureCounts: Record<string, number> = {};
    let totalDuration = 0, durationCount = 0;
    for (const i of interactions) {
      featureCounts[i.featureUsed] = (featureCounts[i.featureUsed] || 0) + 1;
      if (i.sessionDurationMs) { totalDuration += i.sessionDurationMs; durationCount++; }
    }
    const sorted = Object.entries(featureCounts).map(([feature, c]) => ({ feature, count: c })).sort((a, b) => b.count - a.count);
    const mostUsed = sorted.slice(0, 5);
    const leastUsed = sorted.slice(-5).reverse();

    const usedSections = new Set(interactions.map((i) => i.section).filter(Boolean));
    const unexplored = ["memory", "strategy", "collaboration", "healing", "governance", "intelligence"].filter((s) => !usedSections.has(s));

    const suggestions: string[] = [];
    if (unexplored.length > 0) {
      suggestions.push(`Explore these unused sections: ${unexplored.join(", ")}`);
    }

    const depthCounts = countBy(interactions, (i) => i.engagementDepth);
    if ((depthCounts["glance"] || 0) / interactions.length > 0.6) suggestions.push("Most interactions are quick glances. Try deeper agent configuration for more control.");
    if (!depthCounts["configure"]) suggestions.push("You haven't configured any agent settings yet. Customize behavior to match your workflow.");
    if (leastUsed.length > 0 && leastUsed[0].count <= 2) suggestions.push(`The "${leastUsed[0].feature}" feature is underutilized — it could provide additional value.`);

    return { mostUsed, leastUsed, suggestions, totalInteractions: interactions.length,
      avgSessionDuration: durationCount > 0 ? Math.round(totalDuration / durationCount) : 0 };
  }

  // ── 11. Stats ────────────────────────────────────────────────────────────

  async getStats(orgId: number) {
    const [briefingsGenerated, simulationsRun, interactionCount] = await Promise.all([
      db.select({ n: count() }).from(founderBriefings).where(eq(founderBriefings.orgId, orgId)).then((r) => Number(r[0]?.n ?? 0)),
      db.select({ n: count() }).from(simulationRuns).where(eq(simulationRuns.orgId, orgId)).then((r) => Number(r[0]?.n ?? 0)),
      db.select({ n: count() }).from(founderInteractions).where(eq(founderInteractions.orgId, orgId)).then((r) => Number(r[0]?.n ?? 0)),
    ]);
    const recRows = await db.select({ status: strategicRecommendations.status, n: count() })
      .from(strategicRecommendations).where(eq(strategicRecommendations.orgId, orgId)).groupBy(strategicRecommendations.status);
    const recommendations: Record<string, number> = {};
    for (const r of recRows) recommendations[r.status] = Number(r.n);

    const depthRows = await db.select({ depth: founderInteractions.engagementDepth, n: count() })
      .from(founderInteractions).where(eq(founderInteractions.orgId, orgId)).groupBy(founderInteractions.engagementDepth);
    const engagementDepthDistribution: Record<string, number> = {};
    for (const d of depthRows) engagementDepthDistribution[d.depth] = Number(d.n);

    return { briefingsGenerated, simulationsRun, recommendations, interactionCount, engagementDepthDistribution };
  }
}

// ─── Singleton Export ────────────────────────────────────────────────────────

export const founderIntelligenceService = FounderIntelligenceService.getInstance();
