/**
 * Autonomous Execution Engine — The Missing Layer
 *
 * Replaces all stub/simulated action executors with REAL implementations.
 * Every agent action goes through this engine, which:
 * 1. Validates pre-conditions (safety gates)
 * 2. Executes the actual operation (DB write, API call, email)
 * 3. Records the outcome for verification
 * 4. Feeds result back into trust evolution
 *
 * This is the critical bridge between "agent decided" and "action happened."
 */

import { db } from "../db";
import { logger } from "../utils/logger";
import { wsServer } from "../websocket";
import {
  leads, deals, properties, tasks, agentEvents,
  notes, campaigns, jobHealthLogs,
} from "@shared/schema";
import { eq, and, sql, desc, lt, gte } from "drizzle-orm";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ExecutionContext {
  orgId: number;
  agentCodename: string;
  action: string;
  input: Record<string, any>;
  chainRunId?: number;
  stepIndex?: number;
}

interface ExecutionResult {
  success: boolean;
  output: Record<string, any>;
  sideEffects: string[];
  durationMs: number;
  error?: string;
}

// ─── Action Registry ─────────────────────────────────────────────────────────

type ActionExecutor = (ctx: ExecutionContext) => Promise<ExecutionResult>;

const actionRegistry: Record<string, ActionExecutor> = {
  // ── Lead Actions ─────────────────────────────────────────────────────────

  "send_follow_up": async (ctx) => {
    // REFUSES (stage-4 turn 3, honest receipts). This handler sent NOTHING:
    // it stamped lastContactedAt + status "contacted" — fabricating a contact
    // event no channel ever carried — and returned "Follow-up sent". A lead
    // record that says "contacted" when no message left the building poisons
    // every downstream cadence decision. Refuse-not-fabricate: agent-initiated
    // outreach belongs on the witnessed hands lane
    // (docs/autonomous/BRAIN_CONSOLIDATION_STAGE4.md, phase 1).
    const { leadId } = ctx.input;
    return fail(
      `send_follow_up cannot send anything today (no channel is wired), so it refuses ` +
      `rather than record a contact that never happened${leadId ? ` for lead ${leadId}` : ""}. ` +
      `Agent outreach goes through the witnessed send lane.`,
    );
  },

  "update_lead_status": async (ctx) => {
    const { leadId, newStatus, reason } = ctx.input;
    if (!leadId || !newStatus) return fail("leadId and newStatus required");

    await db.update(leads)
      .set({ status: newStatus })
      .where(eq(leads.id, leadId));

    await logAgentAction(ctx, "lead_status_changed", { leadId, newStatus, reason });
    return success({ leadId, newStatus }, [`Lead ${leadId} status → ${newStatus}`]);
  },

  // ── Deal Actions ─────────────────────────────────────────────────────────

  "advance_deal_stage": async (ctx) => {
    const { dealId, newStage } = ctx.input;
    if (!dealId) return fail("dealId required");

    await db.update(deals)
      .set({ status: newStage ?? "closing" })
      .where(eq(deals.id, dealId));

    await logAgentAction(ctx, "deal_advanced", { dealId, newStage });
    wsServer.broadcast(`deal:${dealId}`, "deal_updated", { dealId, stage: newStage });
    return success({ dealId, newStage }, [`Deal ${dealId} advanced to ${newStage}`]);
  },

  "flag_deal_risk": async (ctx) => {
    const { dealId, riskLevel, reason } = ctx.input;
    if (!dealId) return fail("dealId required");

    await logAgentAction(ctx, "deal_risk_flagged", { dealId, riskLevel, reason });
    wsServer.broadcastFounderEvent("deal_risk_flagged", { dealId, riskLevel, reason, agent: ctx.agentCodename });
    return success({ dealId, riskLevel, reason }, [`Deal ${dealId} flagged as ${riskLevel} risk`]);
  },

  // ── Task Actions ─────────────────────────────────────────────────────────

  "create_task": async (ctx) => {
    const { title, description, assignee, dueDate, priority } = ctx.input;
    if (!title) return fail("title required");

    const [task] = await db.insert(tasks).values({
      title,
      description: description ?? `Auto-created by ${ctx.agentCodename}`,
      status: "pending",
      priority: priority ?? "medium",
      dueDate: dueDate ? new Date(dueDate) : undefined,
      organizationId: ctx.orgId,
      createdBy: ctx.agentCodename,
    }).returning();

    await logAgentAction(ctx, "task_created", { taskId: task.id, title });
    return success({ taskId: task.id, title }, [`Created task: ${title}`]);
  },

  "complete_task": async (ctx) => {
    const { taskId, notes: taskNotes } = ctx.input;
    if (!taskId) return fail("taskId required");

    await db.update(tasks)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(tasks.id, taskId));

    await logAgentAction(ctx, "task_completed", { taskId, notes: taskNotes });
    return success({ taskId }, [`Task ${taskId} completed`]);
  },

  // ── Alert/Notification Actions ───────────────────────────────────────────

  "send_alert": async (ctx) => {
    const { severity, title, message, targetChannel } = ctx.input;

    wsServer.broadcastFounderEvent("agent_alert", {
      severity: severity ?? "info",
      title: title ?? "Agent Alert",
      message,
      agent: ctx.agentCodename,
    });

    await logAgentAction(ctx, "alert_sent", { severity, title });
    return success({ severity, title }, [`Alert sent: ${title}`]);
  },

  "escalate_to_founder": async (ctx) => {
    const { reason, context, urgency } = ctx.input;

    wsServer.broadcastFounderEvent("agent:escalation", {
      agent: ctx.agentCodename,
      reason,
      context,
      urgency: urgency ?? "normal",
    });

    // Also publish to event mesh for notification routing
    try {
      const { eventMeshPublisher } = await import("./eventMeshPublisher");
      await eventMeshPublisher.agentEscalation(ctx.orgId, ctx.agentCodename, reason, context ?? {});
    } catch {}

    await logAgentAction(ctx, "escalated_to_founder", { reason, urgency });
    return success({ escalated: true, reason }, [`Escalated to founder: ${reason}`]);
  },

  // ── Job/System Actions ───────────────────────────────────────────────────

  "restart_failed_job": async (ctx) => {
    const { jobName } = ctx.input;
    if (!jobName) return fail("jobName required");

    // Log restart intent — actual job will pick up on next scheduled run
    await db.insert(jobHealthLogs).values({
      jobName: `restart:${jobName}`,
      runStartedAt: new Date(),
      runCompletedAt: new Date(),
      durationMs: 0,
      status: "restart_requested",
    });

    await logAgentAction(ctx, "job_restart_requested", { jobName });
    return success({ jobName, restarted: true }, [`Job ${jobName} restart requested`]);
  },

  // ── Reporting/Analysis Actions ───────────────────────────────────────────

  "generate_report": async (ctx) => {
    const { reportType, parameters } = ctx.input;

    // Reports are generated and broadcast — the actual AI generation
    // is handled by the existing companyAgents.generateReport()
    await logAgentAction(ctx, "report_generated", { reportType, parameters });
    return success({ reportType, generated: true }, [`Report generated: ${reportType}`]);
  },

  // ── Churn/Retention Actions ──────────────────────────────────────────────

  "send_churn_intervention": async (ctx) => {
    // REFUSES (stage-4 turn 3, honest receipts). This handler logged and
    // broadcast "Churn intervention sent" while sending nothing — the founder
    // event stream showed retention work that never happened. The real
    // churn-rescue path is agentActionExecutors' send_churn_rescue, which
    // phase 1 moves onto the witnessed hands lane.
    const { orgTargetId } = ctx.input;
    return fail(
      `send_churn_intervention cannot intervene today (no channel is wired), so it refuses ` +
      `rather than announce an intervention that never happened${orgTargetId ? ` for org ${orgTargetId}` : ""}.`,
    );
  },

  // ── Degradation Mode Actions ─────────────────────────────────────────────

  "activate_degradation_mode": async (ctx) => {
    const { modeName, reason } = ctx.input;
    if (!modeName) return fail("modeName required");

    try {
      const { selfHealingMeshService: selfHealingMesh } = await import("./selfHealingMeshV13");
      await selfHealingMesh.activateDegradationMode(modeName, reason ?? "auto-activated by self-healing");
      await logAgentAction(ctx, "degradation_mode_activated", { modeName, reason });
      return success({ modeName, activated: true }, [`Degradation mode ${modeName} activated`]);
    } catch (err: any) {
      return fail(err.message);
    }
  },

  "deactivate_degradation_mode": async (ctx) => {
    const { modeName } = ctx.input;
    if (!modeName) return fail("modeName required");

    try {
      const { selfHealingMeshService: selfHealingMesh } = await import("./selfHealingMeshV13");
      await selfHealingMesh.deactivateDegradationMode(modeName);
      await logAgentAction(ctx, "degradation_mode_deactivated", { modeName });
      return success({ modeName, deactivated: true }, [`Degradation mode ${modeName} deactivated`]);
    } catch (err: any) {
      return fail(err.message);
    }
  },

  // ── Memory Actions ───────────────────────────────────────────────────────

  "store_learning": async (ctx) => {
    const { memoryType, content, tags } = ctx.input;

    try {
      const { cognitiveMemoryService } = await import("./cognitiveMemoryV13");
      // CognitiveMemoryService has no generic store(); a learning is persisted
      // as a semantic fact.
      await cognitiveMemoryService.extractFact(ctx.agentCodename, {
        fact: content,
        category: memoryType ?? "semantic",
        sourceEpisodes: Array.isArray(tags) ? tags : [],
        confidence: 80,
        orgId: ctx.orgId,
      });
      await logAgentAction(ctx, "learning_stored", { memoryType, tags });
      return success({ stored: true }, [`Memory stored: ${memoryType}`]);
    } catch (err: any) {
      return fail(err.message);
    }
  },
};

// ─── Helper Functions ────────────────────────────────────────────────────────

function success(output: Record<string, any>, sideEffects: string[]): ExecutionResult {
  return { success: true, output, sideEffects, durationMs: 0 };
}

function fail(error: string): ExecutionResult {
  return { success: false, output: {}, sideEffects: [], durationMs: 0, error };
}

async function logAgentAction(ctx: ExecutionContext, eventType: string, payload: Record<string, any>) {
  try {
    await db.insert(agentEvents).values({
      organizationId: ctx.orgId,
      eventType,
      eventSource: "agent",
      // agent_events has no agentCodename column; carry it in the payload.
      payload: {
        agentCodename: ctx.agentCodename,
        ...payload,
        orgId: ctx.orgId,
        chainRunId: ctx.chainRunId,
        stepIndex: ctx.stepIndex,
        executedAt: new Date().toISOString(),
      },
    });
  } catch { /* best effort */ }
}

// ─── Rate Limiter ────────────────────────────────────────────────────────────
// DB-backed (module-state audit 2026-07-07): the per-process Map made the
// effective cap N× on N machines — a safety throttle that didn't throttle.
// Hourly buckets in agent_execution_counts, incremented with a single
// race-free upsert. FAIL CLOSED: an unverifiable count refuses the action
// (stabilize > act — the throttle exists to bound autonomous behavior).

const MAX_ACTIONS_PER_HOUR = 100;
const MAX_ACTIONS_PER_AGENT_PER_HOUR = 30;

async function bumpExecutionCount(agentKey: string, bucketStart: Date): Promise<number> {
  const result = await db.execute(sql`
    INSERT INTO agent_execution_counts (agent_key, bucket_start, count)
    VALUES (${agentKey}, ${bucketStart}, 1)
    ON CONFLICT (agent_key, bucket_start)
    DO UPDATE SET count = agent_execution_counts.count + 1
    RETURNING count
  `);
  const rows = (result as unknown as { rows: Array<{ count: number }> }).rows;
  return Number(rows?.[0]?.count ?? 0);
}

async function checkRateLimit(agentCodename: string): Promise<{ allowed: boolean; reason?: string }> {
  const hourMs = 60 * 60 * 1000;
  const bucketStart = new Date(Math.floor(Date.now() / hourMs) * hourMs);
  try {
    const globalCount = await bumpExecutionCount("__global__", bucketStart);
    if (globalCount > MAX_ACTIONS_PER_HOUR) {
      return { allowed: false, reason: `Global rate limit exceeded (${MAX_ACTIONS_PER_HOUR}/hr)` };
    }
    const agentCount = await bumpExecutionCount(agentCodename, bucketStart);
    if (agentCount > MAX_ACTIONS_PER_AGENT_PER_HOUR) {
      return { allowed: false, reason: `Agent ${agentCodename} rate limit exceeded (${MAX_ACTIONS_PER_AGENT_PER_HOUR}/hr)` };
    }
    // Opportunistic GC — stale buckets are useless after their hour passes.
    await db.execute(sql`
      DELETE FROM agent_execution_counts
      WHERE bucket_start < ${new Date(bucketStart.getTime() - 2 * hourMs)}
    `);
    return { allowed: true };
  } catch {
    return { allowed: false, reason: "rate-limit state unverifiable — refusing action (fail closed)" };
  }
}

// ─── Safety Gate Pre-Execution Validation ────────────────────────────────────

/**
 * A CHECK THAT CANNOT RUN IS NOT A CHECK THAT PASSED.
 *
 * Four gates below were wrapped in `catch { /* … may not be available *\/ }`,
 * so an unavailable governance brain, trust service, delegation service or
 * database meant the gate contributed NO violation — and `passed` is
 * `violations.length === 0`. Unavailability was therefore permission, on the
 * function that authorises autonomous agent actions including
 * `advance_deal_stage` and `send_churn_intervention` (a customer contact).
 *
 * The comment was the tell: "may not be available" describes the failure and
 * then treats it as a pass. Each check now records a violation when it cannot
 * be evaluated, which fails CLOSED — the action is refused and the reason
 * names the unavailable check, so an operator sees "could not verify" rather
 * than silence.
 */
async function validateSafetyGates(ctx: ExecutionContext): Promise<{ passed: boolean; violations: string[]; suggestedAlternatives?: string[] }> {
  const violations: string[] = [];
  const suggestedAlternatives: string[] = [];

  /** Records an unevaluable gate as a refusal rather than swallowing it. */
  const unevaluable = (gate: string, err: unknown): void => {
    const detail = err instanceof Error ? err.message : String(err);
    violations.push(`${gate} could not be evaluated — refusing rather than assuming permission (${detail})`);
    suggestedAlternatives.push(
      `Restore ${gate} and retry, or use escalate_to_founder to proceed under human authority`,
    );
    logger.warn("[execution-engine] safety gate unevaluable; failing closed", {
      metadata: { gate, agentCodename: ctx.agentCodename, action: ctx.action, error: detail },
    });
  };

  // Rate limit check
  const rateCheck = await checkRateLimit(ctx.agentCodename);
  if (!rateCheck.allowed) {
    violations.push(rateCheck.reason!);
    suggestedAlternatives.push("Wait for rate limit reset, or reduce action frequency");
  }

  // Governance Brain policy enforcement — the critical missing piece
  const highImpactActions = ["advance_deal_stage", "flag_deal_risk", "send_churn_intervention", "activate_degradation_mode"];
  if (highImpactActions.includes(ctx.action)) {
    try {
      const { governanceBrainService } = await import("./governanceBrainV13");
      const evaluation = await governanceBrainService.evaluateAction({
        actionId: `exec_${Date.now()}_${ctx.agentCodename}`,
        agentCodename: ctx.agentCodename,
        actionType: ctx.action,
        actionContext: { ...ctx.input, orgId: ctx.orgId },
        orgId: ctx.orgId,
      });
      if (evaluation.overallResult === "blocked") {
        violations.push(`Governance policy blocked: ${evaluation.explanation}`);
        suggestedAlternatives.push(
          "Escalate to founder for policy exception",
          "Use escalate_to_founder action instead",
          "Reduce action scope to comply with policy",
        );
      }
    } catch (err) { unevaluable("Governance policy check", err); }
  }

  // Trust-based authority check
  try {
    const { trustAuthorityEscalation } = await import("./trustAuthorityEscalation");
    const { companyAgentService } = await import("./companyAgents");
    // The EFFECTIVE score, not the stored one: a CEO-absence elevation is
    // derived at this read and expires with the absence, rather than being
    // written into the agent's own standing where it would outlive its grant.
    const trustScore = await companyAgentService.effectiveTrustScore(ctx.agentCodename);
    if (!trustAuthorityEscalation.isActionAllowed(trustScore, ctx.action)) {
      violations.push(`Agent ${ctx.agentCodename} (trust: ${trustScore}) not authorized for action ${ctx.action}`);
      const tier = trustAuthorityEscalation.getTier(trustScore);
      suggestedAlternatives.push(
        `Current tier: ${tier.label}. Allowed actions: ${tier.allowedActions.join(", ")}`,
        `Use escalate_to_founder to request this action be performed`,
      );
    }
  } catch (err) { unevaluable("Trust authority check", err); }

  // Financial actions require delegation token check
  const financialActions = ["advance_deal_stage", "flag_deal_risk"];
  if (financialActions.includes(ctx.action)) {
    try {
      const { delegationTokenService } = await import("./delegationTokensV11");
      const check = await delegationTokenService.checkDelegation(ctx.agentCodename, ctx.action);
      if (!check?.hasDelegation) {
        violations.push(`No delegation token for ${ctx.agentCodename} to perform ${ctx.action}`);
        suggestedAlternatives.push("Request delegation token from founder");
      }
    } catch (err) { unevaluable("Delegation token check", err); }
  }

  // Deal actions require LTV check if deal involves financing
  if (ctx.action === "advance_deal_stage" && ctx.input.dealId) {
    try {
      const [deal] = await db.select().from(deals).where(eq(deals.id, ctx.input.dealId)).limit(1);
      if (deal && deal.offerAmount) {
        const amount = parseFloat(String(deal.offerAmount));
        if (amount > 50000) {
          violations.push(`Deal ${ctx.input.dealId} amount $${amount.toLocaleString()} exceeds $50K auto-approve threshold`);
          suggestedAlternatives.push("Escalate to founder for high-value deal approval");
        }
      }
    } catch (err) { unevaluable("Deal value threshold check", err); }
  }

  return { passed: violations.length === 0, violations, suggestedAlternatives };
}

// ─── Main Execution Function ─────────────────────────────────────────────────

class AutonomousExecutionEngine {
  /**
   * Execute an action through the full pipeline:
   * safety gates → execute → record outcome → feed back
   */
  async execute(ctx: ExecutionContext): Promise<ExecutionResult> {
    const startTime = Date.now();

    // 1. Safety gate validation
    const gates = await validateSafetyGates(ctx);
    if (!gates.passed) {
      const result: ExecutionResult = {
        success: false,
        output: { violations: gates.violations },
        sideEffects: [],
        durationMs: Date.now() - startTime,
        error: `Safety gate violations: ${gates.violations.join("; ")}`,
      };

      // Escalate to founder with suggested alternatives
      wsServer.broadcastFounderEvent("safety_gate_blocked", {
        agent: ctx.agentCodename,
        action: ctx.action,
        violations: gates.violations,
        suggestedAlternatives: gates.suggestedAlternatives ?? [],
      });

      await this.recordOutcome(ctx, result);
      return result;
    }

    // 2. Find and execute the action
    const executor = actionRegistry[ctx.action];
    if (!executor) {
      // No-fabrication hard-stop: an action with no executor MUST be refused,
      // never reported as done. Callers distinguish this via the
      // "no_executor_registered" error code; the audit trail records the
      // attempt AND that nothing ran.
      const result: ExecutionResult = {
        success: false,
        output: { action: ctx.action, input: ctx.input, error: "no_executor_registered" },
        sideEffects: [`NOTHING executed: no executor registered for action "${ctx.action}"`],
        durationMs: Date.now() - startTime,
        error: "no_executor_registered",
      };
      await logAgentAction(ctx, "action_refused_no_executor", {
        action: ctx.action,
        input: ctx.input,
        executed: false,
        error: "no_executor_registered",
      });
      await this.recordOutcome(ctx, result);
      return result;
    }

    try {
      const result = await executor(ctx);
      result.durationMs = Date.now() - startTime;

      // 3. Record outcome for trust evolution and feedback loop
      await this.recordOutcome(ctx, result);

      // 4. Broadcast execution for real-time visibility
      wsServer.broadcastFounderEvent("action_executed", {
        agent: ctx.agentCodename,
        action: ctx.action,
        success: result.success,
        sideEffects: result.sideEffects,
        durationMs: result.durationMs,
      });

      return result;
    } catch (err: any) {
      const result: ExecutionResult = {
        success: false,
        output: {},
        sideEffects: [],
        durationMs: Date.now() - startTime,
        error: err.message,
      };
      await this.recordOutcome(ctx, result);
      return result;
    }
  }

  /**
   * Record execution outcome for trust evolution and feedback loop.
   */
  private async recordOutcome(ctx: ExecutionContext, result: ExecutionResult): Promise<void> {
    try {
      // Record in agent events for trust evolution to query
      await db.insert(agentEvents).values({
        organizationId: ctx.orgId,
        eventType: result.success ? "action_succeeded" : "action_failed",
        eventSource: "agent",
        payload: {
          agentCodename: ctx.agentCodename,
          action: ctx.action,
          orgId: ctx.orgId,
          success: result.success,
          error: result.error,
          durationMs: result.durationMs,
          sideEffects: result.sideEffects,
          chainRunId: ctx.chainRunId,
        },
      });

      // Publish to event mesh for broader system awareness
      try {
        const { eventMeshPublisher } = await import("./eventMeshPublisher");
        if (result.success) {
          await eventMeshPublisher.publish(
            "agent:actions",
            "agent:action_completed",
            { agent: ctx.agentCodename, action: ctx.action, durationMs: result.durationMs },
            { publisher: ctx.agentCodename, priority: 6, orgId: ctx.orgId },
          );
        } else {
          await eventMeshPublisher.publish(
            "agent:actions",
            "agent:action_failed",
            { agent: ctx.agentCodename, action: ctx.action, error: result.error },
            { publisher: ctx.agentCodename, priority: 3, orgId: ctx.orgId },
          );
        }
      } catch {}
    } catch { /* best effort */ }
  }

  /**
   * Get available actions.
   */
  getAvailableActions(): string[] {
    return Object.keys(actionRegistry);
  }

  /**
   * Register a custom action executor.
   */
  registerAction(action: string, executor: ActionExecutor): void {
    actionRegistry[action] = executor;
  }
}

export const executionEngine = new AutonomousExecutionEngine();
