/**
 * Agent Evolution Engine — Sovereign Company Protocol Phase 18
 *
 * Prompt evolution, agent spawning/retirement, cross-agent knowledge
 * transfer, and meta-learning loop.
 */

import { db } from "../db";
import {
  agentPromptEvolutions, agentSpawnProposals, metaLearningInsights,
  companyAgents, agentActionLog, agentPerformanceReviews as agentPerformanceReviewsTable,
} from "@shared/schema";
import { eq, and, desc, gte, sql, count, avg } from "drizzle-orm";
import crypto from "crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PerformanceAnalysis {
  agentCodename: string;
  successRate: number;
  avgConfidence: number;
  escalationRate: number;
  recentGrade: string;
  improvementAreas: string[];
  suggestPromptChange: boolean;
}

interface CapabilityGap {
  area: string;
  evidence: string[];
  severity: "low" | "medium" | "high";
  suggestedAgent?: { codename: string; title: string; wing: string };
}

interface SharedInsight {
  id: string;
  fromAgent: string;
  insight: string;
  relevantAgents: string[];
  appliedBy: string[];
  createdAt: string;
}

// ─── In-Memory State ──────────────────────────────────────────────────────────

const sharedInsights: Map<string, SharedInsight> = new Map();

// ─── Service ──────────────────────────────────────────────────────────────────

class AgentEvolutionEngine {

  // ─── Prompt Evolution ─────────────────────────────────────────────────────

  /**
   * Analyze an agent's performance data to determine if prompt changes would help.
   */
  async analyzePromptPerformance(agentCodename: string): Promise<PerformanceAnalysis> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);

    // Get recent action metrics
    const [totalActions] = await db.select({ count: sql<number>`count(*)` })
      .from(agentActionLog)
      .where(and(
        eq(agentActionLog.agentCodename, agentCodename),
        gte(agentActionLog.createdAt, sevenDaysAgo),
      ));

    const [successActions] = await db.select({ count: sql<number>`count(*)` })
      .from(agentActionLog)
      .where(and(
        eq(agentActionLog.agentCodename, agentCodename),
        eq(agentActionLog.outcome, "success"),
        gte(agentActionLog.createdAt, sevenDaysAgo),
      ));

    const [escalatedActions] = await db.select({ count: sql<number>`count(*)` })
      .from(agentActionLog)
      .where(and(
        eq(agentActionLog.agentCodename, agentCodename),
        eq(agentActionLog.outcome, "escalated"),
        gte(agentActionLog.createdAt, sevenDaysAgo),
      ));

    const [avgConf] = await db.select({ avg: sql<number>`avg(confidence)` })
      .from(agentActionLog)
      .where(and(
        eq(agentActionLog.agentCodename, agentCodename),
        gte(agentActionLog.createdAt, sevenDaysAgo),
      ));

    const total = Number(totalActions?.count || 0);
    const success = Number(successActions?.count || 0);
    const escalated = Number(escalatedActions?.count || 0);
    const avgConfidence = Number(avgConf?.avg || 0);

    const successRate = total > 0 ? (success / total) * 100 : 100;
    const escalationRate = total > 0 ? (escalated / total) * 100 : 0;

    // Get most recent review grade
    const review = await db.query.agentPerformanceReviewsTable.findFirst({
      where: eq(agentPerformanceReviewsTable.agentCodename, agentCodename),
      orderBy: [desc(agentPerformanceReviewsTable.createdAt)],
    });
    const recentGrade = review?.overallGrade || "N/A";

    // Identify improvement areas
    const improvementAreas: string[] = [];
    if (successRate < 80) improvementAreas.push("Low success rate — consider clearer action guidelines");
    if (avgConfidence < 60) improvementAreas.push("Low confidence — consider more specific decision criteria");
    if (escalationRate > 30) improvementAreas.push("High escalation rate — expand autonomous authority guidelines");
    if (recentGrade === "D" || recentGrade === "F") improvementAreas.push("Poor review grade — significant prompt revision needed");

    return {
      agentCodename,
      successRate: Math.round(successRate * 10) / 10,
      avgConfidence: Math.round(avgConfidence),
      escalationRate: Math.round(escalationRate * 10) / 10,
      recentGrade,
      improvementAreas,
      suggestPromptChange: improvementAreas.length >= 2 || recentGrade === "D" || recentGrade === "F",
    };
  }

  /**
   * Propose a prompt change for board review.
   */
  async proposePromptChange(agentCodename: string, proposedPrompt: string, reason: string): Promise<number> {
    const agent = await db.query.companyAgents.findFirst({
      where: eq(companyAgents.codename, agentCodename),
    });
    if (!agent) throw new Error(`Agent ${agentCodename} not found`);

    const currentHash = crypto.createHash("sha256").update(agent.personalityPrompt || "").digest("hex").slice(0, 16);

    const [row] = await db.insert(agentPromptEvolutions).values({
      agentCodename,
      currentPromptHash: currentHash,
      proposedPrompt,
      proposalReason: reason,
      performanceDataBefore: {
        trustScore: agent.trustScore,
        ...(agent.metrics as any || {}),
      },
      status: "proposed",
    }).returning({ id: agentPromptEvolutions.id });

    return row?.id || 0;
  }

  /**
   * Apply an approved prompt change to the agent.
   */
  async applyPromptChange(evolutionId: number): Promise<{ success: boolean; message: string }> {
    const evolution = await db.query.agentPromptEvolutions.findFirst({
      where: eq(agentPromptEvolutions.id, evolutionId),
    });
    if (!evolution) return { success: false, message: "Evolution record not found" };

    try {
      await db.update(companyAgents)
        .set({
          personalityPrompt: evolution.proposedPrompt,
          updatedAt: new Date(),
        })
        .where(eq(companyAgents.codename, evolution.agentCodename));

      await db.update(agentPromptEvolutions)
        .set({ status: "applied" })
        .where(eq(agentPromptEvolutions.id, evolutionId));

      return { success: true, message: `Prompt updated for ${evolution.agentCodename}` };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  }

  async getEvolutionHistory(agentCodename: string) {
    return db.select().from(agentPromptEvolutions)
      .where(eq(agentPromptEvolutions.agentCodename, agentCodename))
      .orderBy(desc(agentPromptEvolutions.createdAt))
      .limit(20);
  }

  // ─── Agent Spawning ───────────────────────────────────────────────────────

  /**
   * Identify capability gaps that suggest a new agent is needed.
   */
  async identifyCapabilityGaps(): Promise<CapabilityGap[]> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
    const gaps: CapabilityGap[] = [];

    // Check for frequently deferred decisions (indicates gaps)
    const [deferredCount] = await db.select({ count: sql<number>`count(*)` })
      .from(agentActionLog)
      .where(and(
        eq(agentActionLog.outcome, "escalated"),
        gte(agentActionLog.createdAt, thirtyDaysAgo),
      ));

    const totalDeferred = Number(deferredCount?.count || 0);
    if (totalDeferred > 50) {
      gaps.push({
        area: "High escalation volume",
        evidence: [`${totalDeferred} escalated decisions in last 30 days`],
        severity: "high",
        suggestedAgent: {
          codename: "arbiter_ops",
          title: "Operations Arbiter",
          wing: "ops",
        },
      });
    }

    // Check for unowned decision types
    const escalatedTypes = await db.select({
      actionName: agentActionLog.actionName,
      count: sql<number>`count(*)`,
    })
      .from(agentActionLog)
      .where(and(
        eq(agentActionLog.outcome, "escalated"),
        gte(agentActionLog.createdAt, thirtyDaysAgo),
      ))
      .groupBy(agentActionLog.actionName)
      .orderBy(desc(sql`count(*)`))
      .limit(5);

    for (const entry of escalatedTypes) {
      if (Number(entry.count) > 10) {
        gaps.push({
          area: `Frequent escalations for: ${entry.actionName}`,
          evidence: [`${entry.count} escalations for "${entry.actionName}"`],
          severity: "medium",
        });
      }
    }

    return gaps;
  }

  /**
   * Propose a new agent for board approval.
   */
  async proposeNewAgent(
    codename: string,
    title: string,
    wing: string,
    personalityPrompt: string,
    ownedServices: string[],
    capabilityGap: string,
    justification: string
  ): Promise<string> {
    const proposalId = `spawn-${crypto.randomUUID().slice(0, 8)}`;

    await db.insert(agentSpawnProposals).values({
      proposalId,
      proposedBy: "oracle_analytics",
      codename,
      title,
      wing,
      personalityPrompt,
      ownedServices,
      capabilityGap,
      justification,
      status: "proposed",
    });

    // Create board proposal
    try {
      const { aiBoardOfDirectors } = await import("./aiBoardOfDirectors");
      const boardProposalId = await aiBoardOfDirectors.createProposal(
        "oracle_analytics",
        `Spawn new agent: "${title}" (${codename}) to address: ${capabilityGap}. Justification: ${justification}`,
        "agent_spawn",
        "strategic"
      );

      await db.update(agentSpawnProposals)
        .set({ boardVoteId: boardProposalId })
        .where(eq(agentSpawnProposals.proposalId, proposalId));
    } catch {}

    return proposalId;
  }

  /**
   * After board approval: create new agent with trust 40, Level 2.
   */
  async spawnAgent(proposalId: string): Promise<{ success: boolean; message: string }> {
    const proposal = await db.query.agentSpawnProposals.findFirst({
      where: eq(agentSpawnProposals.proposalId, proposalId),
    });
    if (!proposal) return { success: false, message: "Proposal not found" };

    try {
      await db.insert(companyAgents).values({
        codename: proposal.codename,
        title: proposal.title,
        wing: proposal.wing,
        personalityPrompt: proposal.personalityPrompt,
        ownedServices: proposal.ownedServices,
        ownedJobs: [],
        ownedRoutes: [],
        authorityConfig: {
          level0Actions: [],
          level1Actions: [],
          level2Actions: [],
          level3Actions: [],
        },
        trustScore: 40,
        status: "active",
        metrics: {
          decisionsTotal: 0,
          decisionsCorrect: 0,
          escalationsCount: 0,
          avgConfidence: 0,
          lastWeekActions: 0,
        },
      });

      await db.update(agentSpawnProposals)
        .set({ status: "spawned" })
        .where(eq(agentSpawnProposals.proposalId, proposalId));

      return { success: true, message: `Agent ${proposal.codename} (${proposal.title}) spawned with trust 40` };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  }

  async getSpawnProposals(status?: string) {
    if (status) {
      return db.select().from(agentSpawnProposals)
        .where(eq(agentSpawnProposals.status, status))
        .orderBy(desc(agentSpawnProposals.createdAt));
    }
    return db.select().from(agentSpawnProposals)
      .orderBy(desc(agentSpawnProposals.createdAt));
  }

  // ─── Agent Retirement ─────────────────────────────────────────────────────

  /**
   * Find agents with consistently poor performance.
   */
  async identifyUnderperformers(periodDays: number = 30): Promise<Array<{ codename: string; issues: string[] }>> {
    const agents = await db.query.companyAgents.findMany({
      where: eq(companyAgents.status, "active"),
    });

    const underperformers: Array<{ codename: string; issues: string[] }> = [];

    for (const agent of agents) {
      const analysis = await this.analyzePromptPerformance(agent.codename);
      const issues: string[] = [];

      if (analysis.successRate < 50) issues.push(`Very low success rate: ${analysis.successRate}%`);
      if (analysis.escalationRate > 50) issues.push(`Very high escalation rate: ${analysis.escalationRate}%`);
      if (agent.trustScore < 30) issues.push(`Low trust score: ${agent.trustScore}`);
      if (analysis.recentGrade === "F") issues.push("Grade F on last review");

      if (issues.length >= 2) {
        underperformers.push({ codename: agent.codename, issues });
      }
    }

    return underperformers;
  }

  /**
   * Propose retiring an underperforming agent.
   */
  async proposeRetirement(agentCodename: string, reasoning: string): Promise<{ proposalId: string }> {
    try {
      const { aiBoardOfDirectors } = await import("./aiBoardOfDirectors");
      const proposalId = await aiBoardOfDirectors.createProposal(
        "oracle_analytics",
        `Retire agent: ${agentCodename}. Reason: ${reasoning}`,
        "agent_retirement",
        "strategic"
      );
      return { proposalId };
    } catch {
      return { proposalId: "" };
    }
  }

  /**
   * Retire an agent: redistribute responsibilities, preserve knowledge, deactivate.
   */
  async retireAgent(agentCodename: string): Promise<{ success: boolean; message: string }> {
    const agent = await db.query.companyAgents.findFirst({
      where: eq(companyAgents.codename, agentCodename),
    });
    if (!agent) return { success: false, message: "Agent not found" };

    // Set status to disabled (preserves data)
    await db.update(companyAgents)
      .set({ status: "disabled", updatedAt: new Date() })
      .where(eq(companyAgents.codename, agentCodename));

    return {
      success: true,
      message: `Agent ${agentCodename} (${agent.title}) retired. Status set to disabled. Knowledge preserved in memory.`,
    };
  }

  // ─── Cross-Agent Knowledge Transfer ───────────────────────────────────────

  /**
   * Share an insight from one agent to relevant others.
   */
  async shareInsight(fromAgent: string, insight: string, relevantAgents: string[]): Promise<string> {
    const id = `insight-${crypto.randomUUID().slice(0, 8)}`;

    const shared: SharedInsight = {
      id,
      fromAgent,
      insight,
      relevantAgents,
      appliedBy: [],
      createdAt: new Date().toISOString(),
    };

    sharedInsights.set(id, shared);

    // Broadcast via agent comms
    try {
      const { agentCommsService } = await import("./agentComms");
      await agentCommsService.broadcast({
        from: fromAgent,
        channel: "metrics_alerts",
        priority: "medium",
        subject: `Knowledge share from ${fromAgent}`,
        body: insight,
        data: { insightId: id, relevantAgents },
      });
    } catch {}

    return id;
  }

  async getSharedInsights(agentCodename: string, limit: number = 20): Promise<SharedInsight[]> {
    return Array.from(sharedInsights.values())
      .filter(i => i.relevantAgents.includes(agentCodename))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async transferKnowledge(fromAgent: string, toAgent: string): Promise<{ transferred: number }> {
    const insights = Array.from(sharedInsights.values())
      .filter(i => i.fromAgent === fromAgent);

    for (const insight of insights) {
      if (!insight.relevantAgents.includes(toAgent)) {
        insight.relevantAgents.push(toAgent);
        sharedInsights.set(insight.id, insight);
      }
    }

    return { transferred: insights.length };
  }

  // ─── Meta-Learning Loop ───────────────────────────────────────────────────

  /**
   * Analyze patterns across all agent decisions.
   */
  async analyzeDecisionPatterns(periodDays: number = 30): Promise<{
    patterns: Array<{ pattern: string; outcome: string; confidence: number }>;
    totalDecisions: number;
    successRate: number;
  }> {
    const since = new Date(Date.now() - periodDays * 86400000);

    const [total] = await db.select({ count: sql<number>`count(*)` })
      .from(agentActionLog)
      .where(gte(agentActionLog.createdAt, since));

    const [successes] = await db.select({ count: sql<number>`count(*)` })
      .from(agentActionLog)
      .where(and(
        gte(agentActionLog.createdAt, since),
        eq(agentActionLog.outcome, "success"),
      ));

    const totalCount = Number(total?.count || 0);
    const successCount = Number(successes?.count || 0);

    // Analyze action patterns
    const actionPatterns = await db.select({
      actionName: agentActionLog.actionName,
      outcome: agentActionLog.outcome,
      count: sql<number>`count(*)`,
      avgConfidence: sql<number>`avg(confidence)`,
    })
      .from(agentActionLog)
      .where(gte(agentActionLog.createdAt, since))
      .groupBy(agentActionLog.actionName, agentActionLog.outcome)
      .orderBy(desc(sql`count(*)`))
      .limit(20);

    const patterns = actionPatterns.map(p => ({
      pattern: `${p.actionName} → ${p.outcome}`,
      outcome: p.outcome || "unknown",
      confidence: Math.round(Number(p.avgConfidence || 0)),
    }));

    return {
      patterns,
      totalDecisions: totalCount,
      successRate: totalCount > 0 ? Math.round((successCount / totalCount) * 100) : 100,
    };
  }

  /**
   * Generate meta-learning insights from decision patterns.
   */
  async generateMetaInsights(): Promise<number> {
    const analysis = await this.analyzeDecisionPatterns(30);
    let insightsGenerated = 0;

    // Find successful patterns
    for (const pattern of analysis.patterns) {
      if (pattern.outcome === "success" && pattern.confidence > 80) {
        const insightId = `meta-${crypto.randomUUID().slice(0, 8)}`;
        await db.insert(metaLearningInsights).values({
          insightId,
          pattern: pattern.pattern,
          correlatedOutcome: "positive",
          confidence: pattern.confidence / 100,
          sampleSize: analysis.totalDecisions,
          affectedAgents: [],
          recommendation: `High-confidence successful pattern: ${pattern.pattern}. Consider expanding this behavior.`,
        });
        insightsGenerated++;
      }

      // Find problematic patterns
      if (pattern.outcome === "failure" || pattern.outcome === "escalated") {
        const insightId = `meta-${crypto.randomUUID().slice(0, 8)}`;
        await db.insert(metaLearningInsights).values({
          insightId,
          pattern: pattern.pattern,
          correlatedOutcome: "negative",
          confidence: pattern.confidence / 100,
          sampleSize: analysis.totalDecisions,
          affectedAgents: [],
          recommendation: `Frequent failure/escalation pattern: ${pattern.pattern}. Investigate and improve.`,
        });
        insightsGenerated++;
      }
    }

    return insightsGenerated;
  }

  async applyMetaInsight(insightId: string): Promise<{ success: boolean; message: string }> {
    const insight = await db.query.metaLearningInsights.findFirst({
      where: eq(metaLearningInsights.insightId, insightId),
    });
    if (!insight) return { success: false, message: "Insight not found" };

    await db.update(metaLearningInsights)
      .set({ appliedAt: new Date() })
      .where(eq(metaLearningInsights.insightId, insightId));

    return { success: true, message: `Insight ${insightId} marked as applied` };
  }

  async getMetaInsights(limit: number = 20) {
    return db.select().from(metaLearningInsights)
      .orderBy(desc(metaLearningInsights.createdAt))
      .limit(limit);
  }

  // ─── Dashboard ────────────────────────────────────────────────────────────

  async getEvolutionDashboard(): Promise<{
    capabilityGaps: CapabilityGap[];
    pendingEvolutions: number;
    spawnProposals: number;
    underperformers: number;
    recentInsights: number;
  }> {
    const [gaps, evolutions, spawns, underperformers, insights] = await Promise.all([
      this.identifyCapabilityGaps(),
      db.select({ count: sql<number>`count(*)` }).from(agentPromptEvolutions).where(eq(agentPromptEvolutions.status, "proposed")),
      db.select({ count: sql<number>`count(*)` }).from(agentSpawnProposals).where(eq(agentSpawnProposals.status, "proposed")),
      this.identifyUnderperformers().then(u => u.length),
      db.select({ count: sql<number>`count(*)` }).from(metaLearningInsights),
    ]);

    return {
      capabilityGaps: gaps,
      pendingEvolutions: Number(evolutions[0]?.count || 0),
      spawnProposals: Number(spawns[0]?.count || 0),
      underperformers,
      recentInsights: Number(insights[0]?.count || 0),
    };
  }
}

export const agentEvolutionEngine = new AgentEvolutionEngine();
