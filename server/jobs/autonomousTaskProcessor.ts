/**
 * Autonomous Task Processor
 *
 * Background job that picks up pending agent tasks and either:
 *   1. Auto-executes them (if autonomy engine approves), or
 *   2. Flags them for human review
 *
 * Runs on a configurable interval. Designed to be called by the
 * job scheduler in server/index.ts.
 *
 * Key design principles:
 *   - Never auto-executes irreversible high-risk actions without approval
 *   - Respects per-org per-agent autonomy config
 *   - Records every decision in the DB for auditability
 *   - Fails safely: any unhandled error → task marked "failed" + logged
 */

import { db } from "../db";
import { agentTasks, agentRuns } from "@shared/schema";
import { eq, and, lte, isNull, desc } from "drizzle-orm";
import { autonomousAgentEngine, type ActionRiskProfile, type ActionCategory } from "../services/autonomousAgentEngine";
import { executeAgentTask, type CoreAgentType } from "../services/core-agents";

// ─── Constants ────────────────────────────────────────────────────────────────

const RUN_INTERVAL_MS   = 30_000; // poll every 30 seconds
const BATCH_SIZE        = 10;     // max tasks per run
const MAX_RETRY_COUNT   = 3;

// ─── Task → Risk profile mapping ─────────────────────────────────────────────

function inferRiskProfile(agentType: string, input: Record<string, any>): ActionRiskProfile {
  const action: string = input.action || "";

  // Offer actions are high risk
  if (action.includes("offer") || action.includes("generate_offer")) {
    return {
      category: "offer",
      financialImpact: input.parameters?.offerPrice || 50_000,
      isExternal: true,
      isIrreversible: false, // offers can be rescinded
      description: `Generate purchase offer${input.parameters?.offerPrice ? ` for $${input.parameters.offerPrice.toLocaleString()}` : ""}`,
      relatedLeadId: input.context?.relatedLeadId,
      relatedPropertyId: input.context?.relatedPropertyId,
    };
  }

  // Communication sends
  if (action.includes("compose_email") || action.includes("compose_sms")) {
    return {
      category: "draft", // draft only — actual sending is a separate step
      financialImpact: 0,
      isExternal: false,
      isIrreversible: false,
      description: `Draft ${action.includes("sms") ? "SMS" : "email"} for lead`,
      relatedLeadId: input.context?.relatedLeadId,
    };
  }

  // Lead nurturing
  if (action.includes("nurture_lead")) {
    return {
      category: "draft",
      financialImpact: 0,
      isExternal: false,
      isIrreversible: false,
      description: "Plan lead nurturing touchpoint",
      relatedLeadId: input.context?.relatedLeadId,
    };
  }

  // Research & due diligence — always safe
  if (
    action.includes("due_diligence") ||
    action.includes("research") ||
    action.includes("lookup") ||
    action.includes("enrich")
  ) {
    return {
      category: "research",
      financialImpact: 0,
      isExternal: false,
      isIrreversible: false,
      description: `Run ${action.replace(/_/g, " ")} for property`,
      relatedPropertyId: input.context?.relatedPropertyId,
    };
  }

  // Deal analysis
  if (action.includes("analyze_deal") || action.includes("analyze_investment")) {
    return {
      category: "research",
      financialImpact: 0,
      isExternal: false,
      isIrreversible: false,
      description: "Analyze investment deal",
      relatedDealId: input.context?.relatedDealId,
    };
  }

  // Financial calculations
  if (action.includes("calculate") || action.includes("financing")) {
    return {
      category: "draft",
      financialImpact: 0,
      isExternal: false,
      isIrreversible: false,
      description: "Calculate financing terms",
    };
  }

  // Campaign content
  if (action.includes("campaign") || action.includes("generate_campaign")) {
    return {
      category: "draft",
      financialImpact: 0,
      isExternal: false,
      isIrreversible: false,
      description: "Generate campaign content",
    };
  }

  // Delinquency checks — read-only
  if (action.includes("delinquenc") || action.includes("digest") || action.includes("performance")) {
    return {
      category: "research",
      financialImpact: 0,
      isExternal: false,
      isIrreversible: false,
      description: `Run ${action.replace(/_/g, " ")}`,
    };
  }

  // Default: conservative
  return {
    category: "data_write" as ActionCategory,
    financialImpact: 0,
    isExternal: false,
    isIrreversible: false,
    description: `Execute ${action.replace(/_/g, " ")} for ${agentType} agent`,
  };
}

// ─── Processor ────────────────────────────────────────────────────────────────

async function processBatch(): Promise<{ processed: number; autoExecuted: number; escalated: number; failed: number }> {
  const stats = { processed: 0, autoExecuted: 0, escalated: 0, failed: 0 };

  // Fetch pending tasks that haven't been reviewed/escalated yet
  const tasks = await db
    .select()
    .from(agentTasks)
    .where(
      and(
        eq(agentTasks.status, "pending"),
        eq(agentTasks.requiresReview, false)
      )
    )
    .orderBy(agentTasks.priority, agentTasks.createdAt)
    .limit(BATCH_SIZE);

  for (const task of tasks) {
    stats.processed++;

    try {
      const input = task.input as Record<string, any>;
      const agentType = task.agentType as CoreAgentType;
      const riskProfile = inferRiskProfile(agentType, input);

      // Evaluate autonomy decision
      const decision = await autonomousAgentEngine.evaluate(
        task.organizationId,
        agentType,
        riskProfile
      );

      if (decision.decision === "deny") {
        await db
          .update(agentTasks)
          .set({
            status: "cancelled",
            error: `Denied by autonomy engine: ${decision.reason}`,
            completedAt: new Date(),
          })
          .where(eq(agentTasks.id, task.id));
        stats.failed++;
        continue;
      }

      if (decision.decision === "escalate") {
        // Flag for human review
        await db
          .update(agentTasks)
          .set({
            requiresReview: true,
            status: "pending",
          })
          .where(eq(agentTasks.id, task.id));
        stats.escalated++;
        continue;
      }

      // AUTO EXECUTE
      await db
        .update(agentTasks)
        .set({ status: "processing", startedAt: new Date() })
        .where(eq(agentTasks.id, task.id));

      const startTime = Date.now();

      const result = await executeAgentTask(agentType, {
        action: input.action,
        parameters: input.parameters || {},
        context: {
          organizationId: task.organizationId,
          userId: "autonomous_agent",
          relatedLeadId: task.relatedLeadId ?? undefined,
          relatedPropertyId: task.relatedPropertyId ?? undefined,
          relatedDealId: task.relatedDealId ?? undefined,
        },
      });

      const executionTimeMs = Date.now() - startTime;

      await db
        .update(agentTasks)
        .set({
          status: result.success ? "completed" : "failed",
          output: result as any,
          error: result.success ? null : (result.message || "Unknown error"),
          completedAt: new Date(),
          executionTimeMs,
          // If result requires approval (e.g. offer letter), flag it
          requiresReview: !!result.requiresApproval,
        })
        .where(eq(agentTasks.id, task.id));

      await autonomousAgentEngine.recordAction(task.organizationId, agentType, result.success);

      if (result.success) {
        stats.autoExecuted++;
      } else {
        stats.failed++;
      }
    } catch (err: any) {
      console.error(`[autonomousTaskProcessor] Task ${task.id} failed:`, err.message);
      stats.failed++;

      await db
        .update(agentTasks)
        .set({
          status: "failed",
          error: err.message,
          completedAt: new Date(),
        })
        .where(eq(agentTasks.id, task.id));
    }
  }

  return stats;
}

// ─── Agent Run Tracking ────────────────────────────────────────────────────────

async function updateAgentRunRecord(
  status: "running" | "completed" | "failed",
  stats?: { processed: number; autoExecuted: number; escalated: number; failed: number },
  error?: string
): Promise<void> {
  try {
    const existing = await db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.agentName, "autonomous_task_processor"))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(agentRuns)
        .set({
          status,
          lastRunAt: new Date(),
          processedCount: stats?.processed || 0,
          errorCount: stats?.failed || 0,
          lastError: error || null,
          metadata: stats ? { ...stats } : undefined,
        })
        .where(eq(agentRuns.agentName, "autonomous_task_processor"));
    } else {
      await db.insert(agentRuns).values({
        agentName: "autonomous_task_processor",
        status,
        lastRunAt: new Date(),
        processedCount: stats?.processed || 0,
        errorCount: stats?.failed || 0,
        lastError: error || null,
        metadata: stats ? { ...stats } : undefined,
      });
    }
  } catch (e) {
    console.warn("[autonomousTaskProcessor] Failed to update agent run record:", e);
  }
}

// ─── Public interface ─────────────────────────────────────────────────────────

let runnerInterval: NodeJS.Timeout | null = null;
let isRunning = false;

export async function runOnce(): Promise<void> {
  if (isRunning) {
    console.log("[autonomousTaskProcessor] Already running, skipping");
    return;
  }

  isRunning = true;
  await updateAgentRunRecord("running");

  try {
    const stats = await processBatch();
    console.log(
      `[autonomousTaskProcessor] Batch complete — processed:${stats.processed} auto:${stats.autoExecuted} escalated:${stats.escalated} failed:${stats.failed}`
    );
    await updateAgentRunRecord("completed", stats);
  } catch (err: any) {
    console.error("[autonomousTaskProcessor] Fatal error:", err.message);
    await updateAgentRunRecord("failed", undefined, err.message);
  } finally {
    isRunning = false;
  }
}

export function startAutonomousTaskProcessor(): void {
  if (runnerInterval) return; // already started

  console.log(`[autonomousTaskProcessor] Starting — polling every ${RUN_INTERVAL_MS / 1000}s`);

  // Run immediately on start, then on interval
  runOnce().catch(err => console.error("[autonomousTaskProcessor] Initial run failed:", err));

  runnerInterval = setInterval(() => {
    runOnce().catch(err => console.error("[autonomousTaskProcessor] Interval run failed:", err));
  }, RUN_INTERVAL_MS);
}

export function stopAutonomousTaskProcessor(): void {
  if (runnerInterval) {
    clearInterval(runnerInterval);
    runnerInterval = null;
    console.log("[autonomousTaskProcessor] Stopped");
  }
}

/**
 * Queue a new agent task for autonomous processing.
 * The processor will pick it up on the next poll cycle.
 */
export async function queueAgentTask(
  organizationId: number,
  agentType: CoreAgentType,
  action: string,
  parameters: Record<string, any> = {},
  context: {
    relatedLeadId?: number;
    relatedPropertyId?: number;
    relatedDealId?: number;
  } = {},
  priority: number = 5
): Promise<number> {
  const [task] = await db
    .insert(agentTasks)
    .values({
      organizationId,
      agentType,
      status: "pending",
      priority,
      input: {
        action,
        parameters,
        context: { organizationId, ...context },
      } as any,
      requiresReview: false,
      relatedLeadId: context.relatedLeadId || null,
      relatedPropertyId: context.relatedPropertyId || null,
      relatedDealId: context.relatedDealId || null,
    })
    .returning();

  return task.id;
}

/**
 * Approve a task that was escalated for human review.
 * The processor will execute it on the next cycle.
 */
export async function approveEscalatedTask(taskId: number, reviewedBy: number, notes?: string): Promise<void> {
  await db
    .update(agentTasks)
    .set({
      requiresReview: false,
      reviewedBy,
      reviewedAt: new Date(),
      reviewNotes: notes || "Approved by user",
    })
    .where(eq(agentTasks.id, taskId));
}

/**
 * Reject a task that was escalated for human review.
 */
export async function rejectEscalatedTask(taskId: number, reviewedBy: number, notes?: string): Promise<void> {
  await db
    .update(agentTasks)
    .set({
      status: "cancelled",
      requiresReview: false,
      reviewedBy,
      reviewedAt: new Date(),
      reviewNotes: notes || "Rejected by user",
    })
    .where(eq(agentTasks.id, taskId));
}
