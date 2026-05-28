/**
 * Autonomy Final Mile — The last ~15% toward 100% autonomous operation
 *
 * 1. Daily Autonomous Summary — founder sees everything the system did
 * 2. Delegation Auto-Completion — tasks don't stay pending forever
 * 3. Proactive Engine Retry Queue — failed actions get retried
 * 4. Consensus Auto-Execution — consensus decisions execute automatically
 * 5. Founder Intent Chain Creation — intents create real reaction chains
 */

import { db } from "../db";
import { agentEvents, agentMessages } from "@shared/schema";
import { eq, and, sql, desc, gte, lt, inArray } from "drizzle-orm";
import { wsServer } from "../websocket";
import { logger } from "../utils/logger";

// ─── 1. Daily Autonomous Summary ─────────────────────────────────────────────

export async function generateDailyAutonomousSummary(): Promise<{
  totalActions: number;
  autoExecuted: number;
  escalated: number;
  blocked: number;
  topAgents: Array<{ agent: string; actions: number }>;
  summary: string;
}> {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Count autonomous actions
  const actionCounts = await db
    .select({
      eventType: agentEvents.eventType,
      count: sql<number>`count(*)::int`,
    })
    .from(agentEvents)
    .where(and(
      gte(agentEvents.createdAt, dayAgo),
      inArray(agentEvents.eventType, [
        "action_succeeded", "action_failed", "initiative_auto_executed",
        "initiative_proposal", "outcome_verified", "authority_promotion",
        "founder_override", "safety_gate_blocked",
      ]),
    ))
    .groupBy(agentEvents.eventType);

  const counts: Record<string, number> = {};
  for (const row of actionCounts) {
    counts[row.eventType] = row.count;
  }

  const autoExecuted = (counts["action_succeeded"] ?? 0) + (counts["initiative_auto_executed"] ?? 0);
  const escalated = counts["initiative_proposal"] ?? 0;
  const blocked = (counts["safety_gate_blocked"] ?? 0) + (counts["action_failed"] ?? 0);
  const totalActions = autoExecuted + escalated + blocked;

  // Top agents by action count
  const topAgentRows = await db
    .select({
      agent: sql<string>`${agentEvents.payload}->>'agentCodename'`,
      count: sql<number>`count(*)::int`,
    })
    .from(agentEvents)
    .where(and(
      gte(agentEvents.createdAt, dayAgo),
      eq(agentEvents.eventType, "action_succeeded"),
    ))
    .groupBy(sql`${agentEvents.payload}->>'agentCodename'`)
    .orderBy(sql`count(*) desc`)
    .limit(5);

  const topAgents = topAgentRows.map((r) => ({ agent: r.agent, actions: r.count }));

  // Build human-readable summary
  const lines = [
    `Daily Autonomous Summary (last 24h):`,
    `• ${totalActions} total actions processed`,
    `• ${autoExecuted} auto-executed successfully`,
    `• ${escalated} escalated to founder for review`,
    `• ${blocked} blocked by safety gates or governance`,
  ];
  if (topAgents.length > 0) {
    lines.push(`• Top agents: ${topAgents.map((a) => `${a.agent} (${a.actions})`).join(", ")}`);
  }
  if (counts["authority_promotion"]) {
    lines.push(`• ${counts["authority_promotion"]} trust promotions`);
  }
  if (counts["founder_override"]) {
    lines.push(`• ${counts["founder_override"]} founder overrides (learning applied)`);
  }

  const summary = lines.join("\n");

  // Broadcast summary via WebSocket
  wsServer.broadcastFounderEvent("daily_summary", {
    totalActions,
    autoExecuted,
    escalated,
    blocked,
    topAgents,
    summary,
  });

  // Also publish to event mesh for notification delivery
  try {
    const { eventMeshPublisher } = await import("./eventMeshPublisher");
    await eventMeshPublisher.briefingReady(0, {
      type: "daily_autonomous_summary",
      totalActions,
      autoExecuted,
      escalated,
      blocked,
      summary,
    });
  } catch {}

  logger.info(`[daily-summary] ${summary}`);
  return { totalActions, autoExecuted, escalated, blocked, topAgents, summary };
}

// ─── 2. Delegation Auto-Completion Check ─────────────────────────────────────

export async function checkDelegationCompletions(): Promise<{ completed: number; escalated: number }> {
  let completed = 0;
  let escalated = 0;

  try {
    const { collaborationProtocolService } = await import("./collaborationProtocolV13");
    const { agentDelegations } = await import("@shared/schema");

    // Find pending delegations
    const pendingDelegations = await db
      .select()
      .from(agentDelegations)
      .where(eq(agentDelegations.status, "pending"))
      .limit(50);

    for (const delegation of pendingDelegations) {
      // Check if the delegated agent has completed relevant actions
      const recentActions = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(agentEvents)
        .where(and(
          sql`${agentEvents.payload}->>'agentCodename' = ${delegation.toAgent}`,
          eq(agentEvents.eventType, "action_succeeded"),
          gte(agentEvents.createdAt, delegation.createdAt),
        ));

      if (recentActions[0]?.count > 0) {
        // Agent has completed actions since delegation — mark as completed
        try {
          await collaborationProtocolService.updateDelegation(delegation.delegationId, {
            status: "completed",
            qualityScore: 0.8,
            result: { notes: "Auto-completed: agent performed relevant actions" },
          });
          completed++;
        } catch {}
      }

      // Check SLA deadline
      if (delegation.slaDeadline && new Date(delegation.slaDeadline) < new Date()) {
        // SLA breached — escalate to founder
        try {
          wsServer.broadcastFounderEvent("delegation_sla_breach", {
            delegationId: delegation.delegationId,
            fromAgent: delegation.fromAgent,
            toAgent: delegation.toAgent,
            task: delegation.task,
            deadline: delegation.slaDeadline,
          });

          // Also create an escalation event
          await db.insert(agentEvents).values({
            organizationId: delegation.orgId ?? 0,
            eventType: "delegation_sla_breach",
            eventSource: "autonomy_final_mile",
            payload: {
              agentCodename: delegation.toAgent,
              delegationId: delegation.delegationId,
              task: delegation.task,
              deadline: delegation.slaDeadline,
            },
          });
          escalated++;
        } catch {}
      }
    }
  } catch (err: any) {
    logger.info(`[delegation-check] Skipped: ${err.message}`);
  }

  if (completed > 0 || escalated > 0) {
    logger.info(`[delegation-check] ${completed} auto-completed, ${escalated} SLA escalations`);
  }

  return { completed, escalated };
}

// ─── 3. Proactive Retry Queue ────────────────────────────────────────────────

export async function retryFailedActions(): Promise<{ retried: number; succeeded: number }> {
  let retried = 0;
  let succeeded = 0;

  try {
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Find actions that failed in the last hour but not older than 24h
    const failedActions = await db
      .select()
      .from(agentEvents)
      .where(and(
        eq(agentEvents.eventType, "action_failed"),
        gte(agentEvents.createdAt, dayAgo),
        lt(agentEvents.createdAt, hourAgo), // Give at least 1 hour before retry
      ))
      .orderBy(desc(agentEvents.createdAt))
      .limit(10);

    for (const failedAction of failedActions) {
      const payload = failedAction.payload as Record<string, any>;
      const action = payload?.action;
      const retryCount = payload?._retryCount ?? 0;

      // Max 3 retries
      if (!action || retryCount >= 3) continue;

      try {
        const { executionEngine } = await import("./executionEngine");
        const result = await executionEngine.execute({
          orgId: payload?.orgId ?? 0,
          agentCodename: payload?.agentCodename,
          action,
          input: payload?.actionInput ?? payload?.input ?? {},
        });

        retried++;
        if (result.success) {
          succeeded++;
          // Record retry success
          await db.insert(agentEvents).values({
            organizationId: failedAction.organizationId,
            eventType: "action_retry_succeeded",
            eventSource: "autonomy_final_mile",
            payload: {
              agentCodename: payload?.agentCodename,
              originalEventId: failedAction.id,
              action,
              retryCount: retryCount + 1,
            },
          });
        }
      } catch {}
    }
  } catch (err: any) {
    logger.info(`[retry-queue] Skipped: ${err.message}`);
  }

  if (retried > 0) {
    logger.info(`[retry-queue] Retried ${retried}, succeeded ${succeeded}`);
  }

  return { retried, succeeded };
}

// ─── 4. Consensus Auto-Execution ─────────────────────────────────────────────

export async function executeResolvedConsensus(): Promise<{ executed: number }> {
  let executed = 0;

  try {
    const { agentDialogues } = await import("@shared/schema");

    // TODO(tsc): agent_dialogues has no `metadata`/`consensus` jsonb columns in
    // the frozen schema. The "not yet executed" gate previously relied on a
    // metadata flag; we now gate on status === "consensus_reached" and flip the
    // row to "closed" after execution. Consensus payload is stored as JSON text
    // in the `resolution` column.
    const resolved = await db
      .select()
      .from(agentDialogues)
      .where(eq(agentDialogues.status, "consensus_reached"))
      .limit(10);

    for (const dialogue of resolved) {
      let consensus: Record<string, any> = {};
      if (dialogue.resolution) {
        try {
          consensus = JSON.parse(dialogue.resolution) as Record<string, any>;
        } catch {
          consensus = {};
        }
      }
      const resolution = consensus?.resolution ?? consensus?.decision;

      if (resolution) {
        try {
          // Execute the consensus resolution
          const { executionEngine } = await import("./executionEngine");
          await executionEngine.execute({
            orgId: 0,
            agentCodename: "system",
            action: resolution.action ?? "send_alert",
            input: resolution.input ?? { title: "Consensus Decision", message: `Consensus reached on: ${dialogue.topic}` },
          });

          // Mark as executed by closing the dialogue.
          await db.update(agentDialogues)
            .set({ status: "closed", resolvedAt: new Date() })
            .where(eq(agentDialogues.id, dialogue.id));

          executed++;
        } catch {}
      }
    }
  } catch (err: any) {
    logger.info(`[consensus-exec] Skipped: ${err.message}`);
  }

  if (executed > 0) {
    logger.info(`[consensus-exec] Executed ${executed} consensus decisions`);
  }

  return { executed };
}
