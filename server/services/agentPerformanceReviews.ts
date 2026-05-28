/**
 * Agent Performance Reviews — Sovereign Company Protocol v6
 *
 * Weekly AI-generated evaluations for each agent.
 * The CEO reads these like manager self-reviews:
 *   "Atlas took 47 actions this week. Success rate: 94%.
 *    Strength: Fast incident response. Improvement: Too many escalations on minor issues."
 *
 * Reviews include peer feedback — agents evaluate each other.
 * Grades are earned, not assigned.
 */

import { db } from "../db";
import {
  agentPerformanceReviews, agentActionLog, agentOverrideLearnings,
  agentGoals, companyAgents,
  type AgentPerformanceReview,
} from "@shared/schema";
import { eq, and, gte, lte, desc, count, avg, sql } from "drizzle-orm";
import { routeAITask, TaskComplexity } from "./aiRouter";
import { companyAgentService } from "./companyAgents";

// ─── Service ─────────────────────────────────────────────────────────────────

class PerformanceReviewService {

  /** Generate a performance review for a single agent */
  async generateReview(agentCodename: string, periodDays = 7): Promise<number | null> {
    const agent = await companyAgentService.getByCodename(agentCodename);
    if (!agent) return null;

    const periodEnd = new Date();
    const periodStart = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);

    // Gather metrics from action log
    const actions = await db.select({
      outcome: agentActionLog.outcome,
      n: count(),
    })
      .from(agentActionLog)
      .where(and(
        eq(agentActionLog.agentCodename, agentCodename),
        gte(agentActionLog.createdAt, periodStart),
      ))
      .groupBy(agentActionLog.outcome);

    const totalActions = actions.reduce((sum, a) => sum + Number(a.n), 0);
    const successCount = Number(actions.find(a => a.outcome === "success")?.n || 0);
    const escalatedCount = Number(actions.find(a => a.outcome === "escalated")?.n || 0);
    const successRate = totalActions > 0 ? Math.round((successCount / totalActions) * 100) : 0;
    const escalationRate = totalActions > 0 ? Math.round((escalatedCount / totalActions) * 100) : 0;

    // Get avg confidence
    const [confResult] = await db.select({
      avgConf: avg(agentActionLog.confidence),
    })
      .from(agentActionLog)
      .where(and(
        eq(agentActionLog.agentCodename, agentCodename),
        gte(agentActionLog.createdAt, periodStart),
      ));
    const avgConfidence = Math.round(Number(confResult?.avgConf || 0));

    // Get override/learning count
    const [overrideResult] = await db.select({ n: count() })
      .from(agentOverrideLearnings)
      .where(and(
        eq(agentOverrideLearnings.agentCodename, agentCodename),
        gte(agentOverrideLearnings.createdAt, periodStart),
      ));
    const overridesReceived = Number(overrideResult?.n || 0);

    // Get goal completion
    const [goalsAssignedResult] = await db.select({ n: count() })
      .from(agentGoals)
      .where(and(
        eq(agentGoals.assignedAgent, agentCodename),
        gte(agentGoals.createdAt, periodStart),
      ));
    const goalsAssigned = Number(goalsAssignedResult?.n || 0);

    const [goalsCompletedResult] = await db.select({ n: count() })
      .from(agentGoals)
      .where(and(
        eq(agentGoals.assignedAgent, agentCodename),
        eq(agentGoals.status, "completed"),
        gte(agentGoals.createdAt, periodStart),
      ));
    const goalsCompleted = Number(goalsCompletedResult?.n || 0);

    // Get trust score trajectory
    const trustScoreEnd = agent.trustScore;
    // Estimate trust at start of period based on delta (simplified)
    const trustScoreStart = trustScoreEnd; // Would need trust history for exact number

    const metrics = {
      totalActions,
      successRate,
      escalationRate,
      avgConfidence,
      avgResponseTimeMs: 0, // Would need action log timing
      trustScoreStart,
      trustScoreEnd,
      trustDelta: trustScoreEnd - trustScoreStart,
      overridesReceived,
      goalsCompleted,
      goalsAssigned,
    };

    // Generate peer feedback from 2-3 related agents
    const peerFeedback = await this.generatePeerFeedback(agentCodename, metrics);

    // Generate the narrative review using AI
    try {
      const response = await routeAITask({
        taskType: "performance_review",
        complexity: TaskComplexity.COMPLEX,
        messages: [
          {
            role: "system",
            content: `You are an objective performance reviewer for AI agents. Write a brief, honest review.

Grading scale:
- A: Exceptional. High success rate, low escalations, completed goals, learned from overrides.
- B: Good. Solid performance with minor areas for improvement.
- C: Adequate. Meeting expectations but not excelling.
- D: Below expectations. Too many failures, escalations, or overrides.
- F: Critical issues. Agent needs recalibration.

Be specific with numbers. Be fair but honest. The CEO reads these.`,
          },
          {
            role: "user",
            content: `Generate a performance review for ${agent.title} (${agentCodename}).

Period: ${periodStart.toLocaleDateString()} to ${periodEnd.toLocaleDateString()}

Metrics:
- Total actions: ${totalActions}
- Success rate: ${successRate}%
- Escalation rate: ${escalationRate}%
- Average confidence: ${avgConfidence}%
- Trust score: ${trustScoreEnd}/100
- CEO overrides received: ${overridesReceived}
- Goals assigned: ${goalsAssigned}, completed: ${goalsCompleted}

Peer feedback:
${peerFeedback.map(p => `- ${p.fromAgent}: ${p.feedback}`).join("\n") || "No peer feedback available."}

Respond in JSON:
{
  "overallGrade": "A|B|C|D|F",
  "summary": "2-3 sentence narrative review",
  "strengths": ["strength 1", "strength 2"],
  "improvements": ["area 1", "area 2"],
  "learnings": ["what this agent learned this period"]
}`,
          },
        ],
        responseFormat: "json",
        temperature: 0.3,
      });

      const parsed = JSON.parse(response.content);

      const [review] = await db.insert(agentPerformanceReviews).values({
        agentCodename,
        periodStart,
        periodEnd,
        metrics,
        strengths: parsed.strengths || [],
        improvements: parsed.improvements || [],
        learnings: parsed.learnings || [],
        peerFeedback,
        overallGrade: parsed.overallGrade || "C",
        summary: parsed.summary || "Review generation failed.",
      }).returning({ id: agentPerformanceReviews.id });

      return review.id;
    } catch {
      return null;
    }
  }

  /** Generate peer feedback for an agent */
  private async generatePeerFeedback(
    agentCodename: string,
    metrics: Record<string, any>,
  ): Promise<Array<{ fromAgent: string; feedback: string }>> {
    // Select 2 agents that work closely with this one
    const peerMap: Record<string, string[]> = {
      atlas_cto: ["sentinel_devops", "crucible_qa"],
      sophie_csm: ["forge_revenue", "compass_pm"],
      forge_revenue: ["sophie_csm", "oracle_analytics"],
      beacon_marketing: ["forge_revenue", "compass_pm"],
      sentinel_devops: ["atlas_cto", "crucible_qa"],
      ledger_finance: ["forge_revenue", "shield_legal"],
      shield_legal: ["ledger_finance", "atlas_cto"],
      oracle_analytics: ["forge_revenue", "compass_pm"],
      compass_pm: ["atlas_cto", "sophie_csm"],
      crucible_qa: ["atlas_cto", "sentinel_devops"],
    };

    const peers = peerMap[agentCodename] || [];
    const feedback: Array<{ fromAgent: string; feedback: string }> = [];

    for (const peerCodename of peers.slice(0, 2)) {
      try {
        const peer = await companyAgentService.getByCodename(peerCodename);
        if (!peer) continue;

        const response = await routeAITask({
          taskType: "peer_feedback",
          complexity: TaskComplexity.SIMPLE,
          messages: [
            {
              role: "system",
              content: `${peer.personalityPrompt}\n\nGive brief, constructive peer feedback about a colleague. One sentence only. Be specific.`,
            },
            {
              role: "user",
              content: `Give your peer feedback for ${agentCodename}. Their metrics this week: ${metrics.totalActions} actions, ${metrics.successRate}% success rate, ${metrics.escalationRate}% escalation rate.`,
            },
          ],
          maxTokens: 60,
          temperature: 0.4,
        });

        feedback.push({ fromAgent: peerCodename, feedback: response.content });
      } catch {}
    }

    return feedback;
  }

  /** Generate reviews for ALL agents (run weekly) */
  async generateAllReviews(): Promise<number[]> {
    const agents = await companyAgentService.getAll();
    const ids: number[] = [];

    for (const agent of agents) {
      const id = await this.generateReview(agent.codename);
      if (id) ids.push(id);
    }

    return ids;
  }

  /** Get most recent review for an agent */
  async getLatestReview(agentCodename: string): Promise<AgentPerformanceReview | undefined> {
    return db.query.agentPerformanceReviews.findFirst({
      where: eq(agentPerformanceReviews.agentCodename, agentCodename),
      orderBy: [desc(agentPerformanceReviews.createdAt)],
    });
  }

  /** Get all recent reviews */
  async getRecentReviews(): Promise<AgentPerformanceReview[]> {
    // Get the latest review for each agent
    const allAgents = await companyAgentService.getAll();
    const reviews: AgentPerformanceReview[] = [];

    for (const agent of allAgents) {
      const review = await this.getLatestReview(agent.codename);
      if (review) reviews.push(review);
    }

    return reviews.sort((a, b) => {
      const gradeOrder: Record<string, number> = { A: 0, B: 1, C: 2, D: 3, F: 4 };
      return (gradeOrder[a.overallGrade] || 5) - (gradeOrder[b.overallGrade] || 5);
    });
  }

  /** CEO adds comments to a review */
  async addCEOComments(reviewId: number, comments: string): Promise<void> {
    await db.update(agentPerformanceReviews)
      .set({ ceoComments: comments })
      .where(eq(agentPerformanceReviews.id, reviewId));
  }
}

export const performanceReviewService = new PerformanceReviewService();
