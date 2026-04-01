/**
 * Delegation Depth — Sovereign Company Protocol v9: The Self-Running Company
 *
 * Agent-to-Agent goal cascading. The CEO sets the WHAT.
 * The agents figure out the HOW and WHO.
 *
 * Example cascade:
 * 1. CEO: "Increase trial-to-paid by 5% this quarter"
 * 2. Oracle breaks it down: "Bottleneck is onboarding step 3 (42% drop-off)"
 * 3. Oracle delegates to Compass: "Redesign onboarding step 3"
 * 4. Oracle delegates to Beacon: "Create targeted email for step 3 dropoffs"
 * 5. Oracle delegates to Sophie: "Proactively reach out to stuck trials"
 * 6. Each agent executes, reports back to Oracle
 * 7. Oracle synthesizes progress and reports to CEO
 *
 * Agents hold each other accountable through the existing performance review system.
 */

import { db } from "../db";
import {
  delegatedGoals,
  type DelegatedGoal,
} from "@shared/schema";
import { eq, desc, and, isNull } from "drizzle-orm";
import { routeAITask, TaskComplexity } from "./aiRouter";
import { companyAgentService } from "./companyAgents";
import { resolveAgentData } from "./agentDataResolvers";
import { logger } from "../utils/logger";

// ─── Service ─────────────────────────────────────────────────────────────────

class DelegationDepthService {

  /**
   * CEO sets a high-level goal. The coordinating agent breaks it down
   * and delegates sub-goals to other agents.
   */
  async setStrategicGoal(input: {
    goal: string;
    coordinatorAgent: string;   // who owns the breakdown
    targetMetric?: string;
    targetValue?: number;
    deadline?: Date;
  }): Promise<number> {
    // Create the top-level goal
    const [topGoal] = await db.insert(delegatedGoals).values({
      goal: input.goal,
      ownerAgent: input.coordinatorAgent,
      delegatedBy: "ceo",
      parentGoalId: null,
      depth: 0,
      targetMetric: input.targetMetric || null,
      targetValue: input.targetValue?.toString() || null,
      deadline: input.deadline || null,
      status: "active",
      progress: 0,
    }).returning({ id: delegatedGoals.id });

    // Run the breakdown asynchronously
    this.breakdownGoal(topGoal.id, input.goal, input.coordinatorAgent).catch(err => {
      logger.error(`[Delegation] Goal ${topGoal.id} breakdown failed`, err);
    });

    return topGoal.id;
  }

  /**
   * Break a goal into sub-goals delegated to specific agents.
   * The coordinating agent analyzes the problem and assigns work.
   */
  private async breakdownGoal(
    parentGoalId: number,
    goal: string,
    coordinatorAgent: string,
  ): Promise<void> {
    const coordinator = await companyAgentService.getByCodename(coordinatorAgent);
    if (!coordinator) return;

    // Gather cross-agent data for context
    const allAgents = await companyAgentService.getAll();
    const agentCapabilities = allAgents.map(a => ({
      codename: a.codename,
      title: a.title,
      wing: a.wing,
      trustScore: a.trustScore,
    }));

    const liveData = await resolveAgentData(coordinatorAgent).catch(() => ({}));

    try {
      const response = await routeAITask({
        taskType: "goal_breakdown",
        complexity: TaskComplexity.COMPLEX,
        messages: [
          {
            role: "system",
            content: `${coordinator.personalityPrompt}

You are breaking down a CEO-assigned goal into actionable sub-goals. Each sub-goal should be:
1. Specific and measurable
2. Assigned to the most appropriate agent based on their domain
3. Achievable within the deadline
4. Independent enough that agents can work in parallel where possible

You are the COORDINATOR — you'll track progress and report back to the CEO.`,
          },
          {
            role: "user",
            content: `CEO GOAL: "${goal}"

Available agents:
${agentCapabilities.map(a => `  - ${a.codename} (${a.title}, trust: ${a.trustScore})`).join("\n")}

Your domain data for context:
${JSON.stringify(liveData, null, 2)}

Break this goal into 3-6 sub-goals. For each, specify which agent should own it.

Respond in JSON:
{
  "analysis": "Brief analysis of the goal and how to approach it",
  "subGoals": [
    {
      "goal": "Specific, actionable sub-goal description",
      "assignedAgent": "agent_codename",
      "rationale": "Why this agent is best for this",
      "targetMetric": "optional metric to track",
      "priority": 1-5,
      "dependencies": []
    }
  ]
}`,
          },
        ],
        responseFormat: { type: "json_object" },
        temperature: 0.3,
      });

      const parsed = JSON.parse(response.content);

      // Create sub-goals
      for (const subGoal of (parsed.subGoals || [])) {
        await db.insert(delegatedGoals).values({
          goal: subGoal.goal,
          ownerAgent: subGoal.assignedAgent,
          delegatedBy: coordinatorAgent,
          parentGoalId,
          depth: 1,
          targetMetric: subGoal.targetMetric || null,
          priority: subGoal.priority || 3,
          status: "active",
          progress: 0,
          rationale: subGoal.rationale,
        });
      }

      // Update parent goal with breakdown analysis
      await db.update(delegatedGoals)
        .set({
          breakdown: parsed.analysis,
          subGoalCount: (parsed.subGoals || []).length,
          updatedAt: new Date(),
        })
        .where(eq(delegatedGoals.id, parentGoalId));

    } catch (err) {
      logger.error(`[Delegation] Breakdown failed for goal ${parentGoalId}`, err);
    }
  }

  /**
   * Agent reports progress on a delegated goal.
   */
  async reportProgress(goalId: number, progress: number, update: string): Promise<void> {
    const goal = await db.query.delegatedGoals.findFirst({
      where: eq(delegatedGoals.id, goalId),
    });
    if (!goal) return;

    const progressLog = [...((goal.progressLog as any[]) || [])];
    progressLog.push({
      timestamp: new Date().toISOString(),
      progress,
      update,
    });

    await db.update(delegatedGoals)
      .set({
        progress: Math.min(100, progress),
        progressLog,
        updatedAt: new Date(),
        ...(progress >= 100 ? { status: "completed", completedAt: new Date() } : {}),
      })
      .where(eq(delegatedGoals.id, goalId));

    // If this sub-goal completed, update parent goal progress
    if (progress >= 100 && goal.parentGoalId) {
      await this.updateParentProgress(goal.parentGoalId);
    }
  }

  /**
   * Recalculate parent goal progress based on sub-goal completion.
   */
  private async updateParentProgress(parentGoalId: number): Promise<void> {
    const subGoals = await db.query.delegatedGoals.findMany({
      where: eq(delegatedGoals.parentGoalId, parentGoalId),
    });

    if (subGoals.length === 0) return;

    const avgProgress = Math.round(
      subGoals.reduce((sum, g) => sum + (g.progress || 0), 0) / subGoals.length
    );

    const allComplete = subGoals.every(g => g.status === "completed");

    await db.update(delegatedGoals)
      .set({
        progress: avgProgress,
        updatedAt: new Date(),
        ...(allComplete ? { status: "completed", completedAt: new Date() } : {}),
      })
      .where(eq(delegatedGoals.id, parentGoalId));
  }

  /**
   * Generate a progress report for a strategic goal (for CEO briefing).
   */
  async generateProgressReport(goalId: number): Promise<{
    goal: string;
    coordinator: string;
    overallProgress: number;
    subGoals: Array<{
      goal: string;
      owner: string;
      progress: number;
      status: string;
      latestUpdate: string;
    }>;
    narrative: string;
  }> {
    const goal = await db.query.delegatedGoals.findFirst({
      where: eq(delegatedGoals.id, goalId),
    });
    if (!goal) throw new Error(`Goal ${goalId} not found`);

    const subGoals = await db.query.delegatedGoals.findMany({
      where: eq(delegatedGoals.parentGoalId, goalId),
      orderBy: [delegatedGoals.priority],
    });

    const subGoalSummaries = subGoals.map(sg => {
      const log = (sg.progressLog as any[]) || [];
      const latestUpdate = log.length > 0 ? log[log.length - 1].update : "No updates yet";
      return {
        goal: sg.goal,
        owner: sg.ownerAgent,
        progress: sg.progress || 0,
        status: sg.status,
        latestUpdate,
      };
    });

    // Generate narrative summary
    let narrative = "";
    try {
      const coordinator = await companyAgentService.getByCodename(goal.ownerAgent);
      const response = await routeAITask({
        taskType: "goal_progress_narrative",
        complexity: TaskComplexity.SIMPLE,
        messages: [
          {
            role: "system",
            content: `${coordinator?.personalityPrompt || "You are a goal coordinator."} Write a brief progress update for the CEO.`,
          },
          {
            role: "user",
            content: `Goal: "${goal.goal}"
Overall progress: ${goal.progress || 0}%
Sub-goals:
${subGoalSummaries.map(s => `  - ${s.owner}: "${s.goal}" — ${s.progress}% (${s.status}). Latest: ${s.latestUpdate}`).join("\n")}

Write a 2-3 sentence progress summary. Be specific with numbers. Highlight blockers.`,
          },
        ],
        maxTokens: 200,
        temperature: 0.3,
      });
      narrative = response.content;
    } catch {
      narrative = `Goal "${goal.goal}" is ${goal.progress || 0}% complete with ${subGoals.length} sub-goals.`;
    }

    return {
      goal: goal.goal,
      coordinator: goal.ownerAgent,
      overallProgress: goal.progress || 0,
      subGoals: subGoalSummaries,
      narrative,
    };
  }

  /** Get strategic goals (top-level, from CEO) */
  async getStrategicGoals(): Promise<DelegatedGoal[]> {
    return db.query.delegatedGoals.findMany({
      where: and(
        eq(delegatedGoals.delegatedBy, "ceo"),
        eq(delegatedGoals.depth, 0),
      ),
      orderBy: [desc(delegatedGoals.createdAt)],
    });
  }

  /** Get sub-goals for a parent goal */
  async getSubGoals(parentGoalId: number): Promise<DelegatedGoal[]> {
    return db.query.delegatedGoals.findMany({
      where: eq(delegatedGoals.parentGoalId, parentGoalId),
      orderBy: [delegatedGoals.priority],
    });
  }

  /** Get active goals for a specific agent */
  async getAgentGoals(codename: string): Promise<DelegatedGoal[]> {
    return db.query.delegatedGoals.findMany({
      where: and(
        eq(delegatedGoals.ownerAgent, codename),
        eq(delegatedGoals.status, "active"),
      ),
      orderBy: [delegatedGoals.priority],
    });
  }
}

export const delegationDepthService = new DelegationDepthService();
