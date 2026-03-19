// @ts-nocheck
/**
 * Autonomy Score — Sovereign Company Protocol v14: The Self-Running Company
 *
 * Tracks and minimizes founder dependency. The goal: the company runs itself.
 * The founder should be able to take a week off and nothing breaks.
 *
 * Core metric: "What percentage of decisions did the system handle autonomously?"
 *
 * Sub-metrics:
 *   - Autonomous decisions / total decisions
 *   - Cascade resolution rate (resolved without founder)
 *   - Founder time spent (ms) — should trend toward zero
 *   - Average decision latency — autonomous decisions are instant
 *   - Override frequency — fewer overrides = better alignment
 *   - Agent-level autonomy — which agents still need hand-holding?
 */

import { db } from "../db";
import {
  autonomyScoreSnapshots,
  founderDependencyEvents,
  cascadeResolutions,
  founderOverrides,
  reactionChainRuns,
  type AutonomyScoreSnapshotEntry,
  type FounderDependencyEventEntry,
} from "@shared/schema";
import { eq, and, desc, gte, lte, sql, count } from "drizzle-orm";
import crypto from "crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DailyScoreInput {
  totalDecisions: number;
  autonomousDecisions: number;
  cascadeResolved: number;
  founderEscalations: number;
  founderOverrideCount: number;
  founderTimeSpentMs: number;
  avgDecisionLatencyMs: number;
  breakdownByCategory: Record<string, { autonomous: number; total: number }>;
  breakdownByAgent: Record<string, { autonomous: number; total: number }>;
}

interface WeeklyScore {
  weekStart: string;
  weekEnd: string;
  avgAutonomyScore: number;
  avgTrustScore: number;
  totalDecisions: number;
  autonomousDecisions: number;
  founderTimeMs: number;
  founderEscalations: number;
  overrides: number;
  trend: "improving" | "stable" | "declining";
  dailySnapshots: AutonomyScoreSnapshotEntry[];
}

interface FounderFreeSimulation {
  simulationDays: number;
  overallReadiness: number;
  wouldSucceed: boolean;
  criticalGaps: Array<{ category: string; description: string; severity: "critical" | "high" | "medium" }>;
  agentReadiness: Array<{ agent: string; readiness: number; gaps: string[] }>;
  estimatedBlockers: number;
  recommendation: string;
}

// ─── Service ──────────────────────────────────────────────────────────────────

class AutonomyScoreService {

  // ── 1. Record Dependency Event ──────────────────────────────────────────────

  async recordDependencyEvent(orgId: number, data: {
    eventType: string;
    agentCodename?: string;
    category: string;
    description: string;
    wasPreventable?: boolean;
    preventionSuggestion?: string;
  }): Promise<FounderDependencyEventEntry> {
    const eventId = crypto.randomUUID();

    const [event] = await db.insert(founderDependencyEvents).values({
      eventId, orgId,
      eventType: data.eventType,
      agentCodename: data.agentCodename || null,
      category: data.category,
      description: data.description,
      wasPreventable: data.wasPreventable ?? false,
      preventionSuggestion: data.preventionSuggestion || null,
    }).returning();

    return event;
  }

  // ── 2. Resolve Dependency Event ─────────────────────────────────────────────

  async resolveDependencyEvent(eventId: string): Promise<FounderDependencyEventEntry> {
    const [event] = await db.select().from(founderDependencyEvents)
      .where(eq(founderDependencyEvents.eventId, eventId));

    if (!event) throw new Error(`Dependency event ${eventId} not found`);

    const blockedDuration = event.createdAt
      ? Date.now() - new Date(event.createdAt).getTime()
      : 0;

    const [updated] = await db.update(founderDependencyEvents).set({
      resolvedAt: new Date(),
      blockedDurationMs: blockedDuration,
    }).where(eq(founderDependencyEvents.eventId, eventId)).returning();

    return updated;
  }

  // ── 3. Get Dependency Events ────────────────────────────────────────────────

  async getDependencyEvents(orgId: number, filters?: {
    eventType?: string;
    category?: string;
    resolved?: string;
  }): Promise<FounderDependencyEventEntry[]> {
    const conditions = [eq(founderDependencyEvents.orgId, orgId)];

    if (filters?.eventType) {
      conditions.push(eq(founderDependencyEvents.eventType, filters.eventType));
    }
    if (filters?.category) {
      conditions.push(eq(founderDependencyEvents.category, filters.category));
    }

    const events = await db.select().from(founderDependencyEvents)
      .where(and(...conditions))
      .orderBy(desc(founderDependencyEvents.createdAt));

    if (filters?.resolved === "true") {
      return events.filter(e => e.resolvedAt !== null);
    }
    if (filters?.resolved === "false") {
      return events.filter(e => e.resolvedAt === null);
    }

    return events;
  }

  // ── 4. Calculate Daily Score ────────────────────────────────────────────────

  async calculateDailyScore(orgId: number, date?: string): Promise<AutonomyScoreSnapshotEntry> {
    const targetDate = date || new Date().toISOString().split("T")[0];

    // Gather metrics from cascade resolutions, overrides, and chain runs
    const metrics = await this.gatherDailyMetrics(orgId, targetDate);

    // Calculate core autonomy score (0-100)
    const autonomyScore = metrics.totalDecisions > 0
      ? Math.round((metrics.autonomousDecisions / metrics.totalDecisions) * 100)
      : 100; // No decisions needed = fully autonomous

    // Trust score: how often does the system get it right without override?
    const trustScore = metrics.totalDecisions > 0
      ? Math.round(((metrics.totalDecisions - metrics.founderOverrideCount) / metrics.totalDecisions) * 100)
      : 100;

    // Founder confidence: inverse of escalation rate
    const founderConfidenceScore = metrics.totalDecisions > 0
      ? Math.round(((metrics.totalDecisions - metrics.founderEscalations) / metrics.totalDecisions) * 100)
      : 100;

    // Get previous week's score for delta
    const weekAgo = new Date(new Date(targetDate).getTime() - 7 * 86400000).toISOString().split("T")[0];
    const [prevSnapshot] = await db.select().from(autonomyScoreSnapshots)
      .where(and(eq(autonomyScoreSnapshots.orgId, orgId), eq(autonomyScoreSnapshots.date, weekAgo)));

    const weekOverWeekDelta = prevSnapshot ? autonomyScore - prevSnapshot.autonomyScore : null;

    // Generate recommendations
    const recommendations = this.generateRecommendations(metrics, autonomyScore);

    const [snapshot] = await db.insert(autonomyScoreSnapshots).values({
      orgId,
      date: targetDate,
      totalDecisions: metrics.totalDecisions,
      autonomousDecisions: metrics.autonomousDecisions,
      cascadeResolved: metrics.cascadeResolved,
      founderEscalations: metrics.founderEscalations,
      founderOverrideCount: metrics.founderOverrideCount,
      founderTimeSpentMs: metrics.founderTimeSpentMs,
      avgDecisionLatencyMs: metrics.avgDecisionLatencyMs,
      autonomyScore,
      trustScore,
      founderConfidenceScore,
      breakdownByCategory: metrics.breakdownByCategory as any,
      breakdownByAgent: metrics.breakdownByAgent as any,
      weekOverWeekDelta,
      recommendations: recommendations as any,
    }).returning();

    return snapshot;
  }

  // ── 5. Calculate Weekly Score ───────────────────────────────────────────────

  async calculateWeeklyScore(orgId: number): Promise<WeeklyScore> {
    const now = new Date();
    const weekStart = new Date(now.getTime() - 7 * 86400000);
    const weekStartStr = weekStart.toISOString().split("T")[0];
    const weekEndStr = now.toISOString().split("T")[0];

    const snapshots = await db.select().from(autonomyScoreSnapshots)
      .where(and(
        eq(autonomyScoreSnapshots.orgId, orgId),
        gte(autonomyScoreSnapshots.date, weekStartStr),
        lte(autonomyScoreSnapshots.date, weekEndStr),
      ))
      .orderBy(autonomyScoreSnapshots.date);

    if (snapshots.length === 0) {
      return {
        weekStart: weekStartStr,
        weekEnd: weekEndStr,
        avgAutonomyScore: 0,
        avgTrustScore: 0,
        totalDecisions: 0,
        autonomousDecisions: 0,
        founderTimeMs: 0,
        founderEscalations: 0,
        overrides: 0,
        trend: "stable",
        dailySnapshots: [],
      };
    }

    const totals = snapshots.reduce((acc, s) => ({
      autonomyScore: acc.autonomyScore + s.autonomyScore,
      trustScore: acc.trustScore + s.trustScore,
      totalDecisions: acc.totalDecisions + s.totalDecisions,
      autonomousDecisions: acc.autonomousDecisions + s.autonomousDecisions,
      founderTimeMs: acc.founderTimeMs + s.founderTimeSpentMs,
      founderEscalations: acc.founderEscalations + s.founderEscalations,
      overrides: acc.overrides + s.founderOverrideCount,
    }), { autonomyScore: 0, trustScore: 0, totalDecisions: 0, autonomousDecisions: 0, founderTimeMs: 0, founderEscalations: 0, overrides: 0 });

    const n = snapshots.length;
    const avgAutonomyScore = Math.round(totals.autonomyScore / n);

    // Determine trend from first half vs second half
    const mid = Math.floor(n / 2);
    const firstHalf = snapshots.slice(0, mid || 1);
    const secondHalf = snapshots.slice(mid || 1);
    const firstAvg = firstHalf.reduce((s, x) => s + x.autonomyScore, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((s, x) => s + x.autonomyScore, 0) / secondHalf.length;
    const trend = secondAvg - firstAvg > 3 ? "improving" : secondAvg - firstAvg < -3 ? "declining" : "stable";

    return {
      weekStart: weekStartStr,
      weekEnd: weekEndStr,
      avgAutonomyScore,
      avgTrustScore: Math.round(totals.trustScore / n),
      totalDecisions: totals.totalDecisions,
      autonomousDecisions: totals.autonomousDecisions,
      founderTimeMs: totals.founderTimeMs,
      founderEscalations: totals.founderEscalations,
      overrides: totals.overrides,
      trend,
      dailySnapshots: snapshots,
    };
  }

  // ── 6. Founder-Free Simulation ──────────────────────────────────────────────

  async runFounderFreeSimulation(orgId: number, days: number = 7): Promise<FounderFreeSimulation> {
    // Get recent dependency events to understand what needs the founder
    const recentEvents = await db.select().from(founderDependencyEvents)
      .where(eq(founderDependencyEvents.orgId, orgId))
      .orderBy(desc(founderDependencyEvents.createdAt))
      .limit(100);

    // Get recent scores
    const recentScores = await db.select().from(autonomyScoreSnapshots)
      .where(eq(autonomyScoreSnapshots.orgId, orgId))
      .orderBy(desc(autonomyScoreSnapshots.date))
      .limit(30);

    // Analyze dependency patterns
    const categoryDeps: Record<string, number> = {};
    const agentDeps: Record<string, number> = {};
    let preventableCount = 0;

    for (const event of recentEvents) {
      categoryDeps[event.category] = (categoryDeps[event.category] || 0) + 1;
      if (event.agentCodename) {
        agentDeps[event.agentCodename] = (agentDeps[event.agentCodename] || 0) + 1;
      }
      if (event.wasPreventable) preventableCount++;
    }

    // Calculate per-agent readiness
    const agentReadiness = Object.entries(agentDeps).map(([agent, depCount]) => {
      const readiness = Math.max(0, 100 - depCount * 5);
      const gaps: string[] = [];
      const agentEvents = recentEvents.filter(e => e.agentCodename === agent);
      const categories = [...new Set(agentEvents.map(e => e.category))];
      for (const cat of categories) {
        gaps.push(`Needs founder for ${cat} decisions`);
      }
      return { agent, readiness, gaps };
    });

    // Add agents with no dependencies as fully ready
    const knownAgents = ["compass_pm", "forge_revenue", "scout_lead", "sophie_csm", "atlas_research", "pulse_marketing", "sentinel_compliance"];
    for (const agent of knownAgents) {
      if (!agentDeps[agent]) {
        agentReadiness.push({ agent, readiness: 100, gaps: [] });
      }
    }
    agentReadiness.sort((a, b) => a.readiness - b.readiness);

    // Critical gaps
    const criticalGaps: FounderFreeSimulation["criticalGaps"] = [];
    for (const [category, count] of Object.entries(categoryDeps).sort(([, a], [, b]) => b - a)) {
      const severity = count > 10 ? "critical" : count > 5 ? "high" : "medium";
      criticalGaps.push({
        category,
        description: `${count} founder dependencies in "${category}" over recent period`,
        severity,
      });
    }

    // Overall readiness
    const avgScore = recentScores.length > 0
      ? recentScores.reduce((s, x) => s + x.autonomyScore, 0) / recentScores.length
      : 50;

    const estimatedBlockers = Math.round((recentEvents.length / 30) * days);
    const overallReadiness = Math.round(avgScore);
    const wouldSucceed = overallReadiness >= 80 && criticalGaps.filter(g => g.severity === "critical").length === 0;

    let recommendation: string;
    if (wouldSucceed) {
      recommendation = `System is ready for a ${days}-day founder-free period. Autonomy score of ${overallReadiness}% with no critical gaps.`;
    } else if (overallReadiness >= 60) {
      recommendation = `Almost ready. Address ${criticalGaps.filter(g => g.severity === "critical").length} critical gaps before attempting a ${days}-day founder-free period.`;
    } else {
      recommendation = `Not yet ready for founder-free operation. Score of ${overallReadiness}% — focus on reducing dependency in: ${criticalGaps.slice(0, 3).map(g => g.category).join(", ")}.`;
    }

    return {
      simulationDays: days,
      overallReadiness,
      wouldSucceed,
      criticalGaps,
      agentReadiness,
      estimatedBlockers,
      recommendation,
    };
  }

  // ── 7. Score History ────────────────────────────────────────────────────────

  async getScoreHistory(orgId: number, days: number = 30): Promise<AutonomyScoreSnapshotEntry[]> {
    const startDate = new Date(Date.now() - days * 86400000).toISOString().split("T")[0];

    return db.select().from(autonomyScoreSnapshots)
      .where(and(
        eq(autonomyScoreSnapshots.orgId, orgId),
        gte(autonomyScoreSnapshots.date, startDate),
      ))
      .orderBy(autonomyScoreSnapshots.date);
  }

  // ── 8. Autonomy Trend ──────────────────────────────────────────────────────

  async getAutonomyTrend(orgId: number): Promise<{
    current: number;
    previous: number;
    delta: number;
    direction: "improving" | "stable" | "declining";
    milestones: Array<{ date: string; score: number; event: string }>;
    projectedDaysTo90: number | null;
  }> {
    const snapshots = await db.select().from(autonomyScoreSnapshots)
      .where(eq(autonomyScoreSnapshots.orgId, orgId))
      .orderBy(desc(autonomyScoreSnapshots.date))
      .limit(60);

    if (snapshots.length === 0) {
      return { current: 0, previous: 0, delta: 0, direction: "stable", milestones: [], projectedDaysTo90: null };
    }

    const current = snapshots[0].autonomyScore;
    const weekAgoIdx = Math.min(7, snapshots.length - 1);
    const previous = snapshots[weekAgoIdx].autonomyScore;
    const delta = current - previous;
    const direction = delta > 3 ? "improving" : delta < -3 ? "declining" : "stable";

    // Find milestones (significant changes)
    const milestones: Array<{ date: string; score: number; event: string }> = [];
    for (let i = 1; i < snapshots.length; i++) {
      const change = snapshots[i - 1].autonomyScore - snapshots[i].autonomyScore;
      if (Math.abs(change) >= 5) {
        milestones.push({
          date: snapshots[i - 1].date,
          score: snapshots[i - 1].autonomyScore,
          event: change > 0 ? `+${change}pt jump` : `${change}pt drop`,
        });
      }
    }

    // Project days to 90% autonomy
    let projectedDaysTo90: number | null = null;
    if (current < 90 && delta > 0 && snapshots.length >= 7) {
      const dailyRate = delta / 7;
      projectedDaysTo90 = Math.round((90 - current) / dailyRate);
    }

    return { current, previous, delta, direction, milestones: milestones.slice(0, 10), projectedDaysTo90 };
  }

  // ── 9. Agent Autonomy Ranking ──────────────────────────────────────────────

  async getAgentAutonomyRanking(orgId: number): Promise<Array<{
    agent: string;
    autonomyPct: number;
    totalDecisions: number;
    escalations: number;
    overrides: number;
    trend: "improving" | "stable" | "declining";
  }>> {
    // Get recent snapshots for agent breakdown
    const snapshots = await db.select().from(autonomyScoreSnapshots)
      .where(eq(autonomyScoreSnapshots.orgId, orgId))
      .orderBy(desc(autonomyScoreSnapshots.date))
      .limit(14);

    const agentStats: Record<string, { autonomous: number; total: number; escalations: number; overrides: number; recentScores: number[] }> = {};

    for (const snap of snapshots) {
      const byAgent = (snap.breakdownByAgent || {}) as Record<string, { autonomous: number; total: number; escalations?: number; overrides?: number }>;
      for (const [agent, stats] of Object.entries(byAgent)) {
        if (!agentStats[agent]) {
          agentStats[agent] = { autonomous: 0, total: 0, escalations: 0, overrides: 0, recentScores: [] };
        }
        agentStats[agent].autonomous += stats.autonomous || 0;
        agentStats[agent].total += stats.total || 0;
        agentStats[agent].escalations += stats.escalations || 0;
        agentStats[agent].overrides += stats.overrides || 0;
        const pct = stats.total > 0 ? Math.round((stats.autonomous / stats.total) * 100) : 100;
        agentStats[agent].recentScores.push(pct);
      }
    }

    return Object.entries(agentStats)
      .map(([agent, stats]) => {
        const autonomyPct = stats.total > 0 ? Math.round((stats.autonomous / stats.total) * 100) : 100;
        const scores = stats.recentScores;
        const firstHalf = scores.slice(Math.floor(scores.length / 2));
        const secondHalf = scores.slice(0, Math.floor(scores.length / 2));
        const firstAvg = firstHalf.length > 0 ? firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length : 0;
        const secondAvg = secondHalf.length > 0 ? secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length : 0;
        const trend = secondAvg - firstAvg > 3 ? "improving" : secondAvg - firstAvg < -3 ? "declining" : "stable";
        return {
          agent,
          autonomyPct,
          totalDecisions: stats.total,
          escalations: stats.escalations,
          overrides: stats.overrides,
          trend,
        };
      })
      .sort((a, b) => b.autonomyPct - a.autonomyPct);
  }

  // ── 10. Category Breakdown ─────────────────────────────────────────────────

  async getCategoryBreakdown(orgId: number): Promise<Array<{
    category: string;
    autonomyPct: number;
    totalDecisions: number;
    founderRequired: number;
    avgLatencyMs: number;
    trend: "improving" | "stable" | "declining";
  }>> {
    const snapshots = await db.select().from(autonomyScoreSnapshots)
      .where(eq(autonomyScoreSnapshots.orgId, orgId))
      .orderBy(desc(autonomyScoreSnapshots.date))
      .limit(14);

    const catStats: Record<string, { autonomous: number; total: number; recentScores: number[] }> = {};

    for (const snap of snapshots) {
      const byCat = (snap.breakdownByCategory || {}) as Record<string, { autonomous: number; total: number }>;
      for (const [cat, stats] of Object.entries(byCat)) {
        if (!catStats[cat]) {
          catStats[cat] = { autonomous: 0, total: 0, recentScores: [] };
        }
        catStats[cat].autonomous += stats.autonomous || 0;
        catStats[cat].total += stats.total || 0;
        const pct = stats.total > 0 ? Math.round((stats.autonomous / stats.total) * 100) : 100;
        catStats[cat].recentScores.push(pct);
      }
    }

    return Object.entries(catStats)
      .map(([category, stats]) => {
        const autonomyPct = stats.total > 0 ? Math.round((stats.autonomous / stats.total) * 100) : 100;
        const founderRequired = stats.total - stats.autonomous;
        const scores = stats.recentScores;
        const mid = Math.floor(scores.length / 2);
        const firstAvg = scores.slice(mid).reduce((a, b) => a + b, 0) / (scores.length - mid || 1);
        const secondAvg = scores.slice(0, mid).reduce((a, b) => a + b, 0) / (mid || 1);
        const trend = secondAvg - firstAvg > 3 ? "improving" : secondAvg - firstAvg < -3 ? "declining" : "stable";
        return { category, autonomyPct, totalDecisions: stats.total, founderRequired, avgLatencyMs: 0, trend };
      })
      .sort((a, b) => a.autonomyPct - b.autonomyPct);
  }

  // ── 11. Bottlenecks ────────────────────────────────────────────────────────

  async getBottlenecks(orgId: number): Promise<Array<{
    type: "agent" | "category" | "pattern";
    name: string;
    impact: number;
    frequency: number;
    description: string;
    suggestion: string;
  }>> {
    const events = await db.select().from(founderDependencyEvents)
      .where(eq(founderDependencyEvents.orgId, orgId))
      .orderBy(desc(founderDependencyEvents.createdAt))
      .limit(200);

    const bottlenecks: Array<{ type: "agent" | "category" | "pattern"; name: string; impact: number; frequency: number; description: string; suggestion: string }> = [];

    // Agent bottlenecks
    const agentCounts: Record<string, { count: number; totalBlockMs: number; preventable: number }> = {};
    for (const e of events) {
      const agent = e.agentCodename || "unknown";
      if (!agentCounts[agent]) agentCounts[agent] = { count: 0, totalBlockMs: 0, preventable: 0 };
      agentCounts[agent].count++;
      agentCounts[agent].totalBlockMs += e.blockedDurationMs || 0;
      if (e.wasPreventable) agentCounts[agent].preventable++;
    }

    for (const [agent, stats] of Object.entries(agentCounts)) {
      if (stats.count >= 3) {
        bottlenecks.push({
          type: "agent",
          name: agent,
          impact: Math.round(stats.totalBlockMs / 60000), // minutes blocked
          frequency: stats.count,
          description: `${agent} created ${stats.count} founder dependencies (${stats.preventable} preventable)`,
          suggestion: stats.preventable > stats.count / 2
            ? `${stats.preventable} of ${stats.count} events were preventable — add rules to handle these automatically`
            : `Review ${agent}'s escalation thresholds — may be too conservative`,
        });
      }
    }

    // Category bottlenecks
    const catCounts: Record<string, number> = {};
    for (const e of events) {
      catCounts[e.category] = (catCounts[e.category] || 0) + 1;
    }

    for (const [cat, count] of Object.entries(catCounts)) {
      if (count >= 5) {
        bottlenecks.push({
          type: "category",
          name: cat,
          impact: count * 2, // estimated minutes
          frequency: count,
          description: `"${cat}" decisions frequently require founder input`,
          suggestion: `Create governance policies for common "${cat}" patterns to automate routine decisions`,
        });
      }
    }

    // Pattern bottlenecks (recurring event types)
    const typeCounts: Record<string, number> = {};
    for (const e of events) {
      typeCounts[e.eventType] = (typeCounts[e.eventType] || 0) + 1;
    }

    for (const [type, count] of Object.entries(typeCounts)) {
      if (count >= 5) {
        bottlenecks.push({
          type: "pattern",
          name: type,
          impact: count,
          frequency: count,
          description: `"${type}" events repeatedly cause founder dependency`,
          suggestion: `Add a reaction chain or confidence cascade rule for "${type}" events`,
        });
      }
    }

    return bottlenecks.sort((a, b) => b.frequency - a.frequency);
  }

  // ── 12. Targets ────────────────────────────────────────────────────────────

  async getTargets(orgId: number): Promise<{
    currentScore: number;
    targets: Array<{
      name: string;
      target: number;
      current: number;
      onTrack: boolean;
      projectedDate: string | null;
    }>;
    founderFreeReadiness: number;
  }> {
    const [latestSnapshot] = await db.select().from(autonomyScoreSnapshots)
      .where(eq(autonomyScoreSnapshots.orgId, orgId))
      .orderBy(desc(autonomyScoreSnapshots.date))
      .limit(1);

    const currentScore = latestSnapshot?.autonomyScore || 0;
    const trustScore = latestSnapshot?.trustScore || 0;
    const confidenceScore = latestSnapshot?.founderConfidenceScore || 0;

    const trend = await this.getAutonomyTrend(orgId);
    const dailyImprovement = trend.delta > 0 ? trend.delta / 7 : 0;

    const makeTarget = (name: string, target: number, current: number) => {
      const gap = target - current;
      const projectedDate = gap > 0 && dailyImprovement > 0
        ? new Date(Date.now() + (gap / dailyImprovement) * 86400000).toISOString().split("T")[0]
        : null;
      return { name, target, current, onTrack: current >= target || dailyImprovement > 0, projectedDate };
    };

    return {
      currentScore,
      targets: [
        makeTarget("Autonomy Score", 90, currentScore),
        makeTarget("Trust Score", 95, trustScore),
        makeTarget("Founder Confidence", 95, confidenceScore),
        makeTarget("Zero Escalation Days/Week", 5, Math.round((7 - (latestSnapshot?.founderEscalations || 7)) * 1)),
        makeTarget("Avg Decision Latency < 1s", 1000, latestSnapshot?.avgDecisionLatencyMs || 5000),
      ],
      founderFreeReadiness: currentScore >= 80 ? currentScore : Math.round(currentScore * 0.9),
    };
  }

  // ── 13. Stats ──────────────────────────────────────────────────────────────

  async getStats(orgId: number): Promise<{
    latestScore: number;
    latestTrustScore: number;
    totalDecisionsToday: number;
    autonomousToday: number;
    founderTimeToday: number;
    escalationsToday: number;
    overridesToday: number;
    weeklyAvg: number;
    allTimeDecisions: number;
    allTimeAutonomous: number;
    topAgent: string | null;
    worstAgent: string | null;
  }> {
    const today = new Date().toISOString().split("T")[0];
    const [todaySnapshot] = await db.select().from(autonomyScoreSnapshots)
      .where(and(eq(autonomyScoreSnapshots.orgId, orgId), eq(autonomyScoreSnapshots.date, today)));

    const weekly = await this.calculateWeeklyScore(orgId);
    const ranking = await this.getAgentAutonomyRanking(orgId);

    return {
      latestScore: todaySnapshot?.autonomyScore || 0,
      latestTrustScore: todaySnapshot?.trustScore || 0,
      totalDecisionsToday: todaySnapshot?.totalDecisions || 0,
      autonomousToday: todaySnapshot?.autonomousDecisions || 0,
      founderTimeToday: todaySnapshot?.founderTimeSpentMs || 0,
      escalationsToday: todaySnapshot?.founderEscalations || 0,
      overridesToday: todaySnapshot?.founderOverrideCount || 0,
      weeklyAvg: weekly.avgAutonomyScore,
      allTimeDecisions: weekly.totalDecisions,
      allTimeAutonomous: weekly.autonomousDecisions,
      topAgent: ranking.length > 0 ? ranking[0].agent : null,
      worstAgent: ranking.length > 0 ? ranking[ranking.length - 1].agent : null,
    };
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────

  private async gatherDailyMetrics(orgId: number, date: string): Promise<DailyScoreInput> {
    const dayStart = new Date(`${date}T00:00:00Z`);
    const dayEnd = new Date(`${date}T23:59:59Z`);

    // Count cascade resolutions for the day
    let cascadeResolved = 0;
    let founderEscalations = 0;
    let totalCascade = 0;

    try {
      const cascades = await db.select().from(cascadeResolutions)
        .where(and(
          eq(cascadeResolutions.orgId, orgId),
          gte(cascadeResolutions.createdAt, dayStart),
          lte(cascadeResolutions.createdAt, dayEnd),
        ));

      totalCascade = cascades.length;
      cascadeResolved = cascades.filter((c: any) => c.resolvedBy !== "founder").length;
      founderEscalations = cascades.filter((c: any) => c.resolvedBy === "founder" || c.status === "escalated").length;
    } catch { /* table may not exist yet */ }

    // Count overrides for the day
    let founderOverrideCount = 0;
    try {
      const overrides = await db.select().from(founderOverrides)
        .where(and(
          eq(founderOverrides.orgId, orgId),
          gte(founderOverrides.createdAt, dayStart),
          lte(founderOverrides.createdAt, dayEnd),
        ));
      founderOverrideCount = overrides.length;
    } catch { /* table may not exist yet */ }

    // Count chain runs (autonomous decisions)
    let autonomousRuns = 0;
    try {
      const runs = await db.select().from(reactionChainRuns)
        .where(and(
          eq(reactionChainRuns.orgId, orgId),
          gte(reactionChainRuns.startedAt, dayStart),
          lte(reactionChainRuns.startedAt, dayEnd),
        ));
      autonomousRuns = runs.filter((r: any) => r.status === "completed").length;
    } catch { /* table may not exist yet */ }

    // Dependency events for founder time
    let founderTimeSpentMs = 0;
    const depEvents = await db.select().from(founderDependencyEvents)
      .where(and(
        eq(founderDependencyEvents.orgId, orgId),
        gte(founderDependencyEvents.createdAt, dayStart),
        lte(founderDependencyEvents.createdAt, dayEnd),
      ));

    for (const e of depEvents) {
      founderTimeSpentMs += e.blockedDurationMs || 0;
    }

    const totalDecisions = totalCascade + autonomousRuns;
    const autonomousDecisions = cascadeResolved + autonomousRuns;

    const avgDecisionLatencyMs = totalDecisions > 0
      ? Math.round(founderTimeSpentMs / Math.max(founderEscalations, 1))
      : 0;

    return {
      totalDecisions,
      autonomousDecisions,
      cascadeResolved,
      founderEscalations,
      founderOverrideCount,
      founderTimeSpentMs,
      avgDecisionLatencyMs,
      breakdownByCategory: {},
      breakdownByAgent: {},
    };
  }

  private generateRecommendations(metrics: DailyScoreInput, score: number): string[] {
    const recs: string[] = [];

    if (metrics.founderEscalations > 5) {
      recs.push("High escalation count — review cascade thresholds and add more rules for common patterns");
    }
    if (metrics.founderOverrideCount > 3) {
      recs.push("Multiple overrides today — extract learnings from overrides to prevent recurrence");
    }
    if (metrics.founderTimeSpentMs > 30 * 60 * 1000) {
      recs.push("Founder spent >30 minutes on decisions — identify which categories consumed the most time");
    }
    if (score < 50) {
      recs.push("Autonomy score below 50% — focus on the top 3 bottleneck categories for quick wins");
    }
    if (score >= 80 && score < 90) {
      recs.push("Approaching 90% autonomy — run a founder-free simulation to identify remaining gaps");
    }
    if (score >= 90) {
      recs.push("Excellent autonomy! Consider extending the founder-free test to 2 weeks");
    }
    if (metrics.totalDecisions === 0) {
      recs.push("No decisions recorded today — ensure event processing and cascade are wired up");
    }

    return recs;
  }
}

export const autonomyScoreService = new AutonomyScoreService();
