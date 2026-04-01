/**
 * Agent Goal Manager — Sovereign Company Protocol v2
 *
 * CEO can assign goals to agents with priority, deadline, and success criteria.
 * Agents can also delegate sub-goals to each other.
 *
 * Flow:
 *   1. CEO creates goal → stored in agentGoals
 *   2. Agent receives goal → queues a Director Agent task
 *   3. Director breaks into sub-steps → updates progressLog
 *   4. On completion → marks goal as completed with result
 *
 * The CEO can track all goals, cancel them, reprioritize, or add context.
 */

import { db } from "../db";
import { agentGoals } from "@shared/schema";
import { eq, and, desc, ne } from "drizzle-orm";
import { companyAgentService } from "./companyAgents";
import { agentCommsService } from "./agentComms";
import { logger } from "../utils/logger";

// ─── Goal CRUD ──────────────────────────────────────────────────────────────

/**
 * Create a new goal assigned to an agent.
 */
export async function createGoal(params: {
  assignedAgent: string;
  assignedBy: string; // 'ceo' or agent codename
  goal: string;
  successCriteria?: string;
  priority?: string;
  deadline?: Date;
}): Promise<number> {
  const agent = await companyAgentService.getByCodename(params.assignedAgent);
  if (!agent) throw new Error(`Agent ${params.assignedAgent} not found`);

  const [row] = await db.insert(agentGoals).values({
    assignedAgent: params.assignedAgent,
    assignedBy: params.assignedBy,
    goal: params.goal,
    successCriteria: params.successCriteria,
    priority: params.priority || "medium",
    deadline: params.deadline,
    status: "pending",
    progressLog: [{ timestamp: new Date().toISOString(), update: "Goal created" }],
  }).returning({ id: agentGoals.id });

  // Notify the agent via comms
  await agentCommsService.broadcast({
    from: params.assignedBy,
    channel: "incidents",
    priority: params.priority === "critical" ? "critical" : "medium",
    subject: `New goal assigned to ${params.assignedAgent}: ${params.goal.slice(0, 80)}`,
    body: `${params.assignedBy === "ceo" ? "CEO" : params.assignedBy} assigned a new goal. Priority: ${params.priority || "medium"}.`,
    data: { goalId: row.id, assignedAgent: params.assignedAgent },
  });

  // Try to kick off the goal via the Director Agent
  try {
    const result = await companyAgentService.queueGoal(
      params.assignedAgent,
      params.goal,
      { organizationId: 0 },
      params.priority === "critical" ? 90 : params.priority === "high" ? 70 : 50
    );

    if (result.success && result.result) {
      await updateGoalProgress(row.id, "Director Agent task queued", { directorTaskId: result.result });
      await db.update(agentGoals)
        .set({ directorTaskId: result.result, status: "in_progress" })
        .where(eq(agentGoals.id, row.id));

      // v4: Actually complete the goal when director finishes
      try {
        const { directorAgent } = await import("./directorAgent");
        const directorResult = await directorAgent.processGoal({
          goal: params.goal,
          context: { organizationId: 0 } as any,
        });

        if (directorResult.goalAchieved) {
          await completeGoal(row.id, {
            synthesis: directorResult.finalSynthesis,
            steps: directorResult.steps.length,
            iterationsUsed: directorResult.iterationsUsed,
          });
        } else if (directorResult.iterationsUsed >= 8) {
          await updateGoalProgress(row.id, "Goal stalled after max iterations");
          await db.update(agentGoals)
            .set({ status: "failed" })
            .where(eq(agentGoals.id, row.id));
        }
      } catch (dirErr) {
        await updateGoalProgress(row.id, `Director execution error: ${(dirErr as any).message}`);
      }
    }
  } catch (err) {
    await updateGoalProgress(row.id, "Director Agent task could not be queued — goal pending manual execution");
  }

  return row.id;
}

/**
 * Get all goals, optionally filtered by agent or status.
 */
export async function getGoals(filters?: {
  agentCodename?: string;
  status?: string;
  limit?: number;
}) {
  let query = db.select().from(agentGoals);

  const conditions = [];
  if (filters?.agentCodename) conditions.push(eq(agentGoals.assignedAgent, filters.agentCodename));
  if (filters?.status) conditions.push(eq(agentGoals.status, filters.status));

  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as any;
  }

  return query
    .orderBy(desc(agentGoals.createdAt))
    .limit(filters?.limit || 50);
}

/**
 * Get active goals (not completed/cancelled/failed).
 */
export async function getActiveGoals() {
  return db.select()
    .from(agentGoals)
    .where(and(
      ne(agentGoals.status, "completed"),
      ne(agentGoals.status, "cancelled"),
      ne(agentGoals.status, "failed"),
    ))
    .orderBy(desc(agentGoals.createdAt))
    .limit(50);
}

/**
 * Update a goal's progress log.
 */
export async function updateGoalProgress(
  goalId: number,
  update: string,
  metrics?: Record<string, any>
): Promise<void> {
  const goal = await db.query.agentGoals.findFirst({ where: eq(agentGoals.id, goalId) });
  if (!goal) return;

  const currentLog = (goal.progressLog as any[]) || [];
  currentLog.push({
    timestamp: new Date().toISOString(),
    update,
    ...(metrics ? { metrics } : {}),
  });

  await db.update(agentGoals)
    .set({ progressLog: currentLog })
    .where(eq(agentGoals.id, goalId));
}

/**
 * Complete a goal with a result.
 */
export async function completeGoal(goalId: number, result: Record<string, any>): Promise<void> {
  await updateGoalProgress(goalId, "Goal completed");
  await db.update(agentGoals)
    .set({
      status: "completed",
      result,
      completedAt: new Date(),
    })
    .where(eq(agentGoals.id, goalId));
}

/**
 * Cancel a goal.
 */
export async function cancelGoal(goalId: number, reason?: string): Promise<void> {
  await updateGoalProgress(goalId, `Goal cancelled${reason ? `: ${reason}` : ""}`);
  await db.update(agentGoals)
    .set({ status: "cancelled" })
    .where(eq(agentGoals.id, goalId));
}

/**
 * Update goal priority.
 */
export async function reprioritizeGoal(goalId: number, priority: string): Promise<void> {
  await updateGoalProgress(goalId, `Priority changed to ${priority}`);
  await db.update(agentGoals)
    .set({ priority })
    .where(eq(agentGoals.id, goalId));
}

/**
 * v4: Check for stale goals and mark them as failed.
 * Called by a background job to prevent goals from staying "in_progress" forever.
 */
export async function checkStaleGoals(): Promise<number> {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const staleGoals = await db.select()
    .from(agentGoals)
    .where(and(
      eq(agentGoals.status, "in_progress"),
      // Goals that haven't been updated in 24+ hours are stale
    ))
    .limit(20);

  let failed = 0;
  for (const goal of staleGoals) {
    const progressLog = (goal.progressLog as any[]) || [];
    const lastUpdate = progressLog.length > 0
      ? new Date(progressLog[progressLog.length - 1].timestamp)
      : goal.createdAt ? new Date(goal.createdAt) : new Date(0);

    if (lastUpdate < oneDayAgo) {
      await updateGoalProgress(goal.id, "Goal timed out — no progress in 24 hours");
      await db.update(agentGoals)
        .set({ status: "failed" })
        .where(eq(agentGoals.id, goal.id));
      failed++;
    }
  }

  if (failed > 0) {
    logger.info(`[GoalManager] Marked ${failed} stale goals as failed`);
  }

  return failed;
}
