// @ts-nocheck
/**
 * Agent Self-Improvement — Sovereign Company Protocol v7
 *
 * After a performance review, agents create improvement plans
 * and track progress. Sophie scored C on resolution time?
 * She creates: "Pre-compute diagnostics, cache KB results,
 * target 2.5min avg." Next week: measured against the plan.
 *
 * Agents can also request new skills:
 * "I'm handling 30% billing tickets but can't access Stripe.
 * Requesting: Stripe read access for balance lookups."
 * CEO approves → agent evolves.
 */

import { db } from "../db";
import {
  agentImprovementPlans, agentPerformanceReviews,
  type AgentImprovementPlan,
} from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { routeAITask, TaskComplexity } from "./aiRouter";
import { companyAgentService } from "./companyAgents";
import { performanceReviewService } from "./agentPerformanceReviews";

// ─── Service ─────────────────────────────────────────────────────────────────

class AgentSelfImprovementService {

  /** Generate an improvement plan from the latest review */
  async generatePlan(agentCodename: string): Promise<number | null> {
    const review = await performanceReviewService.getLatestReview(agentCodename);
    if (!review) return null;

    const agent = await companyAgentService.getByCodename(agentCodename);
    if (!agent) return null;

    // Supersede any existing active plan
    await db.update(agentImprovementPlans)
      .set({ status: "superseded", updatedAt: new Date() })
      .where(and(
        eq(agentImprovementPlans.agentCodename, agentCodename),
        eq(agentImprovementPlans.status, "active"),
      ));

    try {
      const response = await routeAITask({
        taskType: "improvement_plan",
        complexity: TaskComplexity.MODERATE,
        messages: [
          {
            role: "system",
            content: `${agent.personalityPrompt}\n\nYou just received your performance review. Create a specific, measurable improvement plan. Be honest about your weaknesses and ambitious about growth.`,
          },
          {
            role: "user",
            content: `Your performance review:
Grade: ${review.overallGrade}
Summary: ${review.summary}
Strengths: ${(review.strengths as string[]).join(", ")}
Areas to improve: ${(review.improvements as string[]).join(", ")}
Metrics: ${JSON.stringify(review.metrics)}

Create an improvement plan. Respond in JSON:
{
  "goals": [
    {
      "description": "What you'll improve",
      "metric": "How you'll measure it (e.g. 'avg_resolution_time_ms', 'success_rate', 'escalation_rate')",
      "baselineValue": current_value,
      "targetValue": target_value,
      "status": "in_progress"
    }
  ],
  "skillRequests": [
    {
      "skill": "Name of capability you need",
      "reason": "Why it would help you perform better",
      "status": "requested"
    }
  ]
}

Create 2-4 goals and 0-2 skill requests. Be specific with numbers.`,
          },
        ],
        responseFormat: { type: "json_object" },
        temperature: 0.3,
      });

      const parsed = JSON.parse(response.content);

      const [plan] = await db.insert(agentImprovementPlans).values({
        agentCodename,
        reviewId: review.id,
        status: "active",
        goals: parsed.goals || [],
        skillRequests: parsed.skillRequests || [],
        weeklyProgress: [],
      }).returning({ id: agentImprovementPlans.id });

      return plan.id;
    } catch {
      return null;
    }
  }

  /** Generate improvement plans for all agents that have reviews */
  async generateAllPlans(): Promise<number[]> {
    const agents = await companyAgentService.getAll();
    const ids: number[] = [];

    for (const agent of agents) {
      const id = await this.generatePlan(agent.codename);
      if (id) ids.push(id);
    }

    return ids;
  }

  /** Record weekly progress on an improvement plan */
  async recordProgress(planId: number): Promise<void> {
    const plan = await this.getById(planId);
    if (!plan) return;

    const agent = await companyAgentService.getByCodename(plan.agentCodename);
    if (!agent) return;

    try {
      // Get current metrics for the agent
      const review = await performanceReviewService.getLatestReview(plan.agentCodename);

      const response = await routeAITask({
        taskType: "progress_update",
        complexity: TaskComplexity.SIMPLE,
        messages: [
          {
            role: "system",
            content: `${agent.personalityPrompt}\n\nProvide a brief progress update on your improvement plan. Be honest.`,
          },
          {
            role: "user",
            content: `Your improvement goals: ${JSON.stringify(plan.goals)}
Current metrics: ${JSON.stringify(review?.metrics || {})}

Write a 1-2 sentence progress update and estimate current values for each goal metric. Respond in JSON:
{
  "notes": "Brief progress update",
  "metricsSnapshot": { "metric_name": current_value }
}`,
          },
        ],
        responseFormat: { type: "json_object" },
        maxTokens: 150,
        temperature: 0.2,
      });

      const parsed = JSON.parse(response.content);

      const weeklyProgress = [...((plan.weeklyProgress as any[]) || [])];
      weeklyProgress.push({
        week: new Date().toISOString().slice(0, 10),
        notes: parsed.notes,
        metricsSnapshot: parsed.metricsSnapshot || {},
      });

      // Update goal current values
      const goals = [...((plan.goals as any[]) || [])];
      for (const goal of goals) {
        if (parsed.metricsSnapshot?.[goal.metric] !== undefined) {
          goal.currentValue = parsed.metricsSnapshot[goal.metric];
          // Check if achieved
          if (goal.metric.includes("rate") || goal.metric.includes("score")) {
            goal.status = goal.currentValue >= goal.targetValue ? "achieved" : "in_progress";
          } else {
            // For time-based metrics, lower is better
            goal.status = goal.currentValue <= goal.targetValue ? "achieved" : "in_progress";
          }
        }
      }

      const allAchieved = goals.every(g => g.status === "achieved");

      await db.update(agentImprovementPlans)
        .set({
          goals,
          weeklyProgress,
          status: allAchieved ? "completed" : "active",
          updatedAt: new Date(),
        })
        .where(eq(agentImprovementPlans.id, planId));

    } catch {}
  }

  /** CEO approves a skill request */
  async approveSkillRequest(planId: number, skillIndex: number): Promise<void> {
    const plan = await this.getById(planId);
    if (!plan) return;

    const skillRequests = [...((plan.skillRequests as any[]) || [])];
    if (skillRequests[skillIndex]) {
      skillRequests[skillIndex].status = "approved";
      skillRequests[skillIndex].approvedAt = new Date().toISOString();
    }

    await db.update(agentImprovementPlans)
      .set({ skillRequests, updatedAt: new Date() })
      .where(eq(agentImprovementPlans.id, planId));
  }

  /** CEO denies a skill request */
  async denySkillRequest(planId: number, skillIndex: number): Promise<void> {
    const plan = await this.getById(planId);
    if (!plan) return;

    const skillRequests = [...((plan.skillRequests as any[]) || [])];
    if (skillRequests[skillIndex]) {
      skillRequests[skillIndex].status = "denied";
    }

    await db.update(agentImprovementPlans)
      .set({ skillRequests, updatedAt: new Date() })
      .where(eq(agentImprovementPlans.id, planId));
  }

  /** Get active plans */
  async getActivePlans(): Promise<AgentImprovementPlan[]> {
    return db.query.agentImprovementPlans.findMany({
      where: eq(agentImprovementPlans.status, "active"),
      orderBy: [desc(agentImprovementPlans.updatedAt)],
    });
  }

  /** Get plan by ID */
  async getById(id: number): Promise<AgentImprovementPlan | undefined> {
    return db.query.agentImprovementPlans.findFirst({
      where: eq(agentImprovementPlans.id, id),
    });
  }

  /** Get plan for a specific agent */
  async getAgentPlan(agentCodename: string): Promise<AgentImprovementPlan | undefined> {
    return db.query.agentImprovementPlans.findFirst({
      where: and(
        eq(agentImprovementPlans.agentCodename, agentCodename),
        eq(agentImprovementPlans.status, "active"),
      ),
    });
  }
}

export const agentSelfImprovementService = new AgentSelfImprovementService();
