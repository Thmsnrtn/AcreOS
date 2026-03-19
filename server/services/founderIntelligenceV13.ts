// @ts-nocheck
/**
 * Founder Intelligence Layer — Sovereign Company Protocol v13
 *
 * Daily briefings, what-if simulations, strategic recommendations,
 * and interaction tracking for founder oversight of autonomous agents.
 */

import crypto from "crypto";
import { db } from "../db";
import {
  founderBriefings, simulationRuns, strategicRecommendations,
  founderInteractions, trustEnforcementLog, agentStrategies, anomalyDetections,
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

const todayStr = () => new Date().toISOString().slice(0, 10);
const last24h = () => new Date(Date.now() - 86_400_000);
const pf = (v: string) => parseFloat(v) || 0;

// ─── Service ─────────────────────────────────────────────────────────────────

class FounderIntelligenceService {
  private static instance: FounderIntelligenceService;
  private constructor() {}
  static getInstance() {
    if (!this.instance) this.instance = new FounderIntelligenceService();
    return this.instance;
  }

  /** 1. Generate a daily briefing from last 24h of trust, strategy, and anomaly data */
  async generateBriefing(orgId: number, date?: string) {
    const briefingDate = date ?? todayStr();
    const since = last24h();

    const [trustDecisions, strategies, anomalies] = await Promise.all([
      db.select({ decision: trustEnforcementLog.decision, agentCodename: trustEnforcementLog.agentCodename,
        trustDelta: trustEnforcementLog.trustDelta, actionType: trustEnforcementLog.actionType })
        .from(trustEnforcementLog)
        .where(and(eq(trustEnforcementLog.orgId, orgId), gte(trustEnforcementLog.createdAt, since))),
      db.select({ agentCodename: agentStrategies.agentCodename, name: agentStrategies.name,
        successRate: agentStrategies.successRate, trialCount: agentStrategies.trialCount,
        successCount: agentStrategies.successCount, isActive: agentStrategies.isActive })
        .from(agentStrategies).where(eq(agentStrategies.orgId, orgId)),
      db.select({ agentCodename: anomalyDetections.agentCodename, severity: anomalyDetections.severity,
        metric: anomalyDetections.metric, autoResolved: anomalyDetections.autoResolved })
        .from(anomalyDetections)
        .where(and(eq(anomalyDetections.orgId, orgId), gte(anomalyDetections.createdAt, since))),
    ]);

    // Decision counts & per-agent stats
    const decisionCounts: Record<string, number> = {};
    const agentMap: Record<string, { actions: number; totalDelta: number; successes: number }> = {};
    for (const td of trustDecisions) {
      decisionCounts[td.decision] = (decisionCounts[td.decision] || 0) + 1;
      const a = agentMap[td.agentCodename] ??= { actions: 0, totalDelta: 0, successes: 0 };
      a.actions++; a.totalDelta += td.trustDelta ?? 0;
      if (td.decision === "auto_execute") a.successes++;
    }

    // Build agent highlights merging trust + strategy data
    const stratByAgent: Record<string, { successRate: number; trialCount: number }> = {};
    for (const s of strategies) stratByAgent[s.agentCodename] = { successRate: pf(s.successRate), trialCount: s.trialCount };
    const allAgents = new Set([...Object.keys(agentMap), ...Object.keys(stratByAgent)]);
    const agentHighlights: Record<string, AgentHighlight> = {};
    for (const agent of allAgents) {
      const st = agentMap[agent] || { actions: 0, totalDelta: 0, successes: 0 };
      const sr = stratByAgent[agent] || { successRate: 0, trialCount: 0 };
      const rate = st.actions > 0 ? Math.round((st.successes / st.actions) * 100) : Math.round(sr.successRate * 100);
      let noteworthy = "";
      if (st.successes >= 5) noteworthy = `${st.successes} consecutive auto-executions`;
      else if (st.totalDelta < -10) noteworthy = `Significant trust decrease (${st.totalDelta})`;
      else if (sr.successRate > 0.9 && sr.trialCount >= 10) noteworthy = `High performer: ${Math.round(sr.successRate * 100)}% over ${sr.trialCount} trials`;
      agentHighlights[agent] = { actions: st.actions, successRate: rate, trustDelta: st.totalDelta, noteworthy };
    }

    // Insights
    const insights: BriefingInsight[] = [];
    const totalDec = trustDecisions.length;
    if (totalDec > 0) insights.push({ category: "trust", insight: `${totalDec} trust decisions: ${Object.entries(decisionCounts).map(([k, v]) => `${k}=${v}`).join(", ")}`, importance: totalDec > 20 ? 8 : 5 });
    for (const [agent, s] of Object.entries(agentMap)) {
      if (s.successes >= 5) insights.push({ category: "performance", insight: `Agent ${agent} had ${s.successes} consecutive successes`, importance: 7 });
    }
    if (anomalies.length > 0) {
      const sevCounts: Record<string, number> = {};
      for (const a of anomalies) sevCounts[a.severity] = (sevCounts[a.severity] || 0) + 1;
      insights.push({ category: "anomaly", insight: `${anomalies.length} anomalies detected: ${Object.entries(sevCounts).map(([k, v]) => `${v} ${k}`).join(", ")}`, importance: anomalies.some(a => a.severity === "critical") ? 9 : 6 });
      const unresolved = anomalies.filter(a => !a.autoResolved).length;
      if (unresolved > 0) insights.push({ category: "anomaly", insight: `${unresolved} anomalies unresolved, may require manual intervention`, importance: 8 });
    }
    if (strategies.filter(s => pf(s.successRate) > 0.85 && s.trialCount >= 10).length > 0)
      insights.push({ category: "strategy", insight: `${strategies.filter(s => pf(s.successRate) > 0.85 && s.trialCount >= 10).length} strategies above 85% success`, importance: 5 });

    // Recommendations
    const recommendations: BriefingRec[] = [];
    for (const [agent, st] of Object.entries(agentMap)) {
      const sr = stratByAgent[agent];
      if (sr && sr.successRate > 0.9 && sr.trialCount >= 20 && st.totalDelta >= 0)
        recommendations.push({ action: `Consider increasing trust ceiling for agent ${agent}`, rationale: `${Math.round(sr.successRate * 100)}% success over ${sr.trialCount} trials`, impactEstimate: "Reduced escalations, faster execution", priority: 6 });
    }
    const anomByAgent: Record<string, number> = {};
    for (const a of anomalies) anomByAgent[a.agentCodename] = (anomByAgent[a.agentCodename] || 0) + 1;
    for (const [agent, c] of Object.entries(anomByAgent)) {
      if (c >= 3) recommendations.push({ action: `Investigate recurring anomalies for agent ${agent}`, rationale: `${c} anomalies in last 24h`, impactEstimate: "Risk mitigation", priority: 8 });
    }
    for (const s of strategies.filter(s => pf(s.successRate) < 0.5 && s.trialCount >= 10 && s.isActive))
      recommendations.push({ action: `Review strategy "${s.name}" for ${s.agentCodename}`, rationale: `${Math.round(pf(s.successRate) * 100)}% success over ${s.trialCount} trials`, impactEstimate: "Improved effectiveness", priority: 7 });

    const summary = [`${totalDec} trust decisions`, anomalies.length > 0 ? `${anomalies.length} anomalies` : "", `${allAgents.size} agents active`, recommendations.length > 0 ? `${recommendations.length} recommendations` : ""].filter(Boolean).join(". ") + ".";
    const metricsSnapshot = { totalDecisions: totalDec, decisionBreakdown: decisionCounts, anomalyCount: anomalies.length, activeStrategies: strategies.filter(s => s.isActive).length, avgSuccessRate: strategies.length > 0 ? strategies.reduce((s, r) => s + pf(r.successRate), 0) / strategies.length : 0, agentCount: allAgents.size };

    const [briefing] = await db.insert(founderBriefings).values({ orgId, briefingDate, summary, insights, recommendations, agentHighlights, metricsSnapshot }).returning();
    return briefing;
  }

  /** 2. Get briefing for date (default today). Marks as read on first access. */
  async getBriefing(orgId: number, date?: string) {
    const [briefing] = await db.select().from(founderBriefings)
      .where(and(eq(founderBriefings.orgId, orgId), eq(founderBriefings.briefingDate, date ?? todayStr()))).limit(1);
    if (!briefing) return null;
    if (!briefing.isRead) {
      await db.update(founderBriefings).set({ isRead: true, readAt: new Date() }).where(eq(founderBriefings.id, briefing.id));
      briefing.isRead = true; briefing.readAt = new Date();
    }
    return briefing;
  }

  /** 3. Past briefings ordered by date desc */
  async getBriefingHistory(orgId: number, limit = 30) {
    return db.select().from(founderBriefings).where(eq(founderBriefings.orgId, orgId)).orderBy(desc(founderBriefings.briefingDate)).limit(limit);
  }

  /** 4. Run a what-if simulation */
  async runSimulation(orgId: number, data: { scenarioName: string; scenarioConfig: Record<string, any> }) {
    const { scenarioName, scenarioConfig } = data;
    const [strategies, recentTrust] = await Promise.all([
      db.select().from(agentStrategies).where(eq(agentStrategies.orgId, orgId)),
      db.select().from(trustEnforcementLog).where(eq(trustEnforcementLog.orgId, orgId)).orderBy(desc(trustEnforcementLog.createdAt)).limit(100),
    ]);

    let outcomes: SimOutcome[] = [], riskFactors: RiskFactor[] = [], recommendation = "";
    const avgRate = strategies.length > 0 ? strategies.reduce((s, r) => s + pf(r.successRate), 0) / strategies.length : 0;

    if (scenarioName === "full_autonomy") {
      const curAutoRate = recentTrust.length > 0 ? recentTrust.filter(t => t.decision === "auto_execute").length / recentTrust.length : 0;
      const projThroughput = recentTrust.length * (1.0 / Math.max(curAutoRate, 0.01));
      outcomes = [
        { metric: "auto_execution_rate", current: Math.round(curAutoRate * 100), simulated: 100, delta: Math.round((1 - curAutoRate) * 100) },
        { metric: "estimated_daily_throughput", current: recentTrust.length, simulated: Math.round(projThroughput), delta: Math.round(projThroughput - recentTrust.length) },
        { metric: "projected_success_rate", current: Math.round(avgRate * 100), simulated: Math.round(avgRate * 95), delta: Math.round(avgRate * -5) },
      ];
      riskFactors = [{ factor: "Reduced oversight may miss edge cases", probability: 0.3, impact: "medium" }, { factor: "Financial actions without review", probability: 0.15, impact: "high" }];
      const lowAgents = strategies.filter(s => pf(s.successRate) < 0.7);
      if (lowAgents.length > 0) riskFactors.push({ factor: `${lowAgents.length} agents below 70% would run unsupervised`, probability: 0.6, impact: "high" });
      recommendation = avgRate > 0.85 ? "Full autonomy viable with monitoring safeguards." : "Phased approach recommended. Full autonomy only for agents above 85%.";
    } else if (scenarioName === "trust_adjustment") {
      const target = scenarioConfig.agentCodename as string | undefined;
      const delta = (scenarioConfig.trustDelta as number) ?? 10;
      const escCount = recentTrust.filter(t => t.decision === "escalate" && (!target || t.agentCodename === target)).length;
      const reduction = Math.min(escCount, Math.round(escCount * (delta / 100) * 0.6));
      outcomes = [
        { metric: "escalation_count", current: escCount, simulated: Math.max(0, escCount - reduction), delta: -reduction },
        { metric: "trust_level_change", current: 0, simulated: delta, delta },
        { metric: "projected_auto_execute_increase", current: 0, simulated: reduction, delta: reduction },
      ];
      riskFactors = [{ factor: "Increased trust may allow riskier actions", probability: delta > 20 ? 0.4 : 0.15, impact: delta > 20 ? "high" : "medium" }];
      const relRate = target ? strategies.filter(s => s.agentCodename === target) : strategies;
      const rAvg = relRate.length > 0 ? relRate.reduce((s, r) => s + pf(r.successRate), 0) / relRate.length : 0;
      recommendation = rAvg > 0.8 ? `Trust adjustment of +${delta} supported by performance data.` : `Proceed with caution — success rate is ${Math.round(rAvg * 100)}%.`;
    } else if (scenarioName === "strategy_change") {
      const target = scenarioConfig.strategyName as string | undefined;
      const cur = target ? strategies.find(s => s.name === target) : null;
      const curRate = cur ? pf(cur.successRate) : avgRate;
      const projRate = Math.min(1, curRate + 0.05);
      outcomes = [
        { metric: "success_rate", current: Math.round(curRate * 100), simulated: Math.round(projRate * 100), delta: Math.round((projRate - curRate) * 100) },
        { metric: "estimated_trial_period", current: 0, simulated: 50, delta: 50 },
      ];
      riskFactors = [{ factor: "Ramp-up period needed for stable performance", probability: 0.7, impact: "low" }, { factor: "Temporary performance dip during transition", probability: 0.5, impact: "medium" }];
      recommendation = curRate < 0.5 ? "Change recommended with close monitoring." : "Current strategy adequate. Test new strategy in sandbox first.";
    } else {
      riskFactors = [{ factor: `Unknown scenario: ${scenarioName}`, probability: 1, impact: "unknown" }];
      recommendation = `Scenario "${scenarioName}" not recognized. Supported: full_autonomy, trust_adjustment, strategy_change.`;
    }

    const [sim] = await db.insert(simulationRuns).values({ simulationId: crypto.randomUUID(), orgId, scenarioName, scenarioConfig, outcomes, confidenceInterval: "0.95", riskFactors, recommendation }).returning();
    return sim;
  }

  /** 5. Past simulation runs */
  async getSimulationHistory(orgId: number, limit = 20) {
    return db.select().from(simulationRuns).where(eq(simulationRuns.orgId, orgId)).orderBy(desc(simulationRuns.createdAt)).limit(limit);
  }

  /** 6. Create a strategic recommendation */
  async createRecommendation(orgId: number, data: { category: string; recommendation: string; evidence: Array<{ source: string; dataPoint: string; significance: string }>; impactEstimate: string; priority?: number }) {
    const [rec] = await db.insert(strategicRecommendations).values({ orgId, category: data.category, recommendation: data.recommendation, evidence: data.evidence, impactEstimate: data.impactEstimate, priority: data.priority ?? 5 }).returning();
    return rec;
  }

  /** 7. Acknowledge or dismiss a recommendation */
  async acknowledgeRecommendation(recommendationId: number, status: "implementing" | "dismissed") {
    const [updated] = await db.update(strategicRecommendations).set({ status, acknowledgedAt: new Date() }).where(eq(strategicRecommendations.id, recommendationId)).returning();
    return updated ?? null;
  }

  /** 8. List recommendations with optional status/category filters */
  async getRecommendations(orgId: number, status?: string, category?: string) {
    const conds = [eq(strategicRecommendations.orgId, orgId)];
    if (status) conds.push(eq(strategicRecommendations.status, status));
    if (category) conds.push(eq(strategicRecommendations.category, category));
    return db.select().from(strategicRecommendations).where(and(...conds)).orderBy(desc(strategicRecommendations.priority));
  }

  /** 9. Log a founder interaction for learning path analysis */
  async trackInteraction(orgId: number, data: { featureUsed: string; section?: string; engagementDepth?: string; sessionDurationMs?: number }) {
    const [interaction] = await db.insert(founderInteractions).values({ orgId, featureUsed: data.featureUsed, section: data.section ?? null, engagementDepth: data.engagementDepth ?? "glance", sessionDurationMs: data.sessionDurationMs ?? null }).returning();
    return interaction;
  }

  /** 10. Analyze founder usage patterns and suggest underutilized features */
  async getEngagementReport(orgId: number): Promise<EngagementReport> {
    const interactions = await db.select().from(founderInteractions).where(eq(founderInteractions.orgId, orgId));
    if (interactions.length === 0) return { mostUsed: [], leastUsed: [], suggestions: ["Start exploring the agent dashboard to see autonomous actions in real time"], totalInteractions: 0, avgSessionDuration: 0 };

    const featureCounts: Record<string, number> = {};
    let totalDur = 0, durCount = 0;
    for (const i of interactions) {
      featureCounts[i.featureUsed] = (featureCounts[i.featureUsed] || 0) + 1;
      if (i.sessionDurationMs) { totalDur += i.sessionDurationMs; durCount++; }
    }
    const sorted = Object.entries(featureCounts).map(([feature, c]) => ({ feature, count: c })).sort((a, b) => b.count - a.count);
    const mostUsed = sorted.slice(0, 5);
    const leastUsed = sorted.slice(-5).reverse();

    const usedSections = new Set(interactions.map(i => i.section).filter(Boolean));
    const unexplored = ["memory", "strategy", "collaboration", "healing", "governance", "intelligence"].filter(s => !usedSections.has(s));
    const suggestions: string[] = [];
    if (unexplored.length > 0) suggestions.push(`Explore unused sections: ${unexplored.join(", ")}`);

    const depthCounts: Record<string, number> = {};
    for (const i of interactions) depthCounts[i.engagementDepth] = (depthCounts[i.engagementDepth] || 0) + 1;
    if ((depthCounts["glance"] || 0) / interactions.length > 0.6) suggestions.push("Most interactions are glances. Try deeper agent configuration.");
    if (!depthCounts["configure"]) suggestions.push("Customize agent behavior — you haven't configured any settings yet.");
    if (leastUsed.length > 0 && leastUsed[0].count <= 2) suggestions.push(`"${leastUsed[0].feature}" is underutilized — it could provide additional value.`);

    return { mostUsed, leastUsed, suggestions, totalInteractions: interactions.length, avgSessionDuration: durCount > 0 ? Math.round(totalDur / durCount) : 0 };
  }

  /** 11. Aggregate stats: briefings, simulations, recommendations by status, interactions, depth distribution */
  async getStats(orgId: number) {
    const [briefingCount, simCount, interactionCount] = await Promise.all([
      db.select({ n: count() }).from(founderBriefings).where(eq(founderBriefings.orgId, orgId)).then(r => Number(r[0]?.n ?? 0)),
      db.select({ n: count() }).from(simulationRuns).where(eq(simulationRuns.orgId, orgId)).then(r => Number(r[0]?.n ?? 0)),
      db.select({ n: count() }).from(founderInteractions).where(eq(founderInteractions.orgId, orgId)).then(r => Number(r[0]?.n ?? 0)),
    ]);

    const recRows = await db.select({ status: strategicRecommendations.status, n: count() }).from(strategicRecommendations).where(eq(strategicRecommendations.orgId, orgId)).groupBy(strategicRecommendations.status);
    const recommendations: Record<string, number> = {};
    for (const r of recRows) recommendations[r.status] = Number(r.n);

    const depthRows = await db.select({ depth: founderInteractions.engagementDepth, n: count() }).from(founderInteractions).where(eq(founderInteractions.orgId, orgId)).groupBy(founderInteractions.engagementDepth);
    const engagementDepthDistribution: Record<string, number> = {};
    for (const d of depthRows) engagementDepthDistribution[d.depth] = Number(d.n);

    return { briefingsGenerated: briefingCount, simulationsRun: simCount, recommendations, interactionCount, engagementDepthDistribution };
  }
}

export const founderIntelligenceService = FounderIntelligenceService.getInstance();
