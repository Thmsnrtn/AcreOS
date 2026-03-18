// @ts-nocheck
/**
 * Agent Authority Gate — Sovereign Company Protocol v2
 *
 * Trust-gated action execution. Every agent action goes through this gate.
 * Trust scores ACTUALLY control what agents can do:
 *
 *   Level 0 (Full Autonomy):    requires trust >= 90
 *   Level 1 (Autonomous+Notify): requires trust >= 70
 *   Level 2 (Recommend+Wait):   requires trust >= 40
 *   Level 3 (Always Escalate):  any trust level — always requires CEO
 *
 * When an agent's trust is too low for the requested level, the action
 * is automatically DOWNGRADED to the next level that their trust allows.
 *
 * Every action (approved or denied) is logged to `agentActionLog`.
 */

import { db } from "../db";
import { companyAgents, agentActionLog, decisionsInboxItems } from "@shared/schema";
import { eq } from "drizzle-orm";

// ─── Trust thresholds per authority level ────────────────────────────────────

const TRUST_THRESHOLDS: Record<number, number> = {
  0: 90,  // Full autonomy
  1: 70,  // Autonomous + notify CEO
  2: 40,  // Recommend and wait for approval
  3: 0,   // Always escalate
};

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AuthorityCheck {
  allowed: boolean;
  effectiveLevel: 0 | 1 | 2 | 3;
  requestedLevel: 0 | 1 | 2 | 3;
  action: string;
  trustRequired: number;
  currentTrust: number;
  reason: string;
  downgraded: boolean;
}

export interface ActionExecution {
  agentCodename: string;
  actionType: "skill" | "goal" | "reaction" | "report" | "chat" | "decision" | "proactive";
  actionName: string;
  input: Record<string, any>;
  output?: any;
  reasoning?: string;
  confidence?: number;
  costCents?: number;
  authorityLevel: number;
  trustScoreAtTime: number;
  outcome: "success" | "failure" | "escalated" | "pending";
  durationMs?: number;
  relatedGoalId?: number;
  relatedDecisionId?: number;
}

// ─── Core Functions ─────────────────────────────────────────────────────────

/**
 * Check what authority level an agent has for a given action.
 */
export async function checkAuthority(codename: string, action: string): Promise<AuthorityCheck> {
  const agent = await db.query.companyAgents.findFirst({
    where: eq(companyAgents.codename, codename),
  });

  if (!agent) {
    return {
      allowed: false,
      effectiveLevel: 3,
      requestedLevel: 3,
      action,
      trustRequired: 0,
      currentTrust: 0,
      reason: `Agent ${codename} not found`,
      downgraded: false,
    };
  }

  if (agent.status !== "active") {
    return {
      allowed: false,
      effectiveLevel: 3,
      requestedLevel: 3,
      action,
      trustRequired: 0,
      currentTrust: agent.trustScore,
      reason: `Agent ${codename} is ${agent.status}`,
      downgraded: false,
    };
  }

  const config = agent.authorityConfig as any;
  if (!config) {
    return {
      allowed: false,
      effectiveLevel: 3,
      requestedLevel: 3,
      action,
      trustRequired: 0,
      currentTrust: agent.trustScore,
      reason: "No authority config for agent",
      downgraded: false,
    };
  }

  // v5: Check for temporary CEO delegation before applying static authority
  try {
    const { checkTemporaryDelegation } = await import("./temporaryDelegation");
    const delegation = checkTemporaryDelegation(codename, action);
    if (delegation.hasDelegation) {
      return {
        allowed: true,
        effectiveLevel: delegation.toLevel as 0 | 1 | 2 | 3,
        requestedLevel,
        action,
        trustRequired: 0,
        currentTrust: agent.trustScore,
        reason: `Temporary delegation active: ${delegation.reason}`,
        downgraded: false,
      };
    }
  } catch {}

  // Determine which level this action is in
  let requestedLevel: 0 | 1 | 2 | 3 = 3;
  if (config.level0Actions?.includes(action)) requestedLevel = 0;
  else if (config.level1Actions?.includes(action)) requestedLevel = 1;
  else if (config.level2Actions?.includes(action)) requestedLevel = 2;
  else if (config.level3Actions?.includes(action)) requestedLevel = 3;
  else {
    // Action not in any level — default to level 2 (recommend + wait)
    requestedLevel = 2;
  }

  // v4: Dynamic trust-based promotion
  // If an agent's trust score exceeds a higher level's threshold,
  // promote the action's level (except safety-critical actions in NEVER_PROMOTE)
  const NEVER_PROMOTE = [
    "refund_customer", "suspend_account", "process_refund_over_500",
    "modify_pricing_plans", "infrastructure_scaling", "database_migration",
    "infrastructure_downgrade", "data_center_migration", "rollback_deployment",
    "legal_document_change", "regulatory_filing", "major_feature_removal",
    "pricing_tier_restructure", "change_payment_processor", "disable_feature_in_production",
  ];

  if (!NEVER_PROMOTE.includes(action) && requestedLevel > 0) {
    if (requestedLevel === 2 && agent.trustScore >= TRUST_THRESHOLDS[1]) {
      requestedLevel = 1; // Promote: recommend+wait → autonomous+notify
    }
    if (requestedLevel === 1 && agent.trustScore >= TRUST_THRESHOLDS[0]) {
      requestedLevel = 0; // Promote: autonomous+notify → full autonomy
    }
  }

  const trustRequired = TRUST_THRESHOLDS[requestedLevel];
  const currentTrust = agent.trustScore;

  // Check if agent's trust meets the threshold
  if (currentTrust >= trustRequired) {
    return {
      allowed: requestedLevel < 3, // Level 3 always needs CEO
      effectiveLevel: requestedLevel,
      requestedLevel,
      action,
      trustRequired,
      currentTrust,
      reason: requestedLevel === 3
        ? "Level 3 actions always require CEO approval"
        : `Trust ${currentTrust} >= ${trustRequired} (level ${requestedLevel} threshold)`,
      downgraded: false,
    };
  }

  // Trust too low — downgrade to the highest level the agent qualifies for
  let effectiveLevel: 0 | 1 | 2 | 3 = 3;
  if (currentTrust >= TRUST_THRESHOLDS[0]) effectiveLevel = 0;
  else if (currentTrust >= TRUST_THRESHOLDS[1]) effectiveLevel = 1;
  else if (currentTrust >= TRUST_THRESHOLDS[2]) effectiveLevel = 2;
  else effectiveLevel = 3;

  // Effective level can't be lower (more autonomous) than requested
  effectiveLevel = Math.max(effectiveLevel, requestedLevel) as 0 | 1 | 2 | 3;

  return {
    allowed: effectiveLevel < 3,
    effectiveLevel,
    requestedLevel,
    action,
    trustRequired,
    currentTrust,
    reason: `Trust ${currentTrust} < ${trustRequired} — downgraded from level ${requestedLevel} to level ${effectiveLevel}`,
    downgraded: effectiveLevel !== requestedLevel,
  };
}

/**
 * Execute an action through the authority gate.
 * Logs all actions regardless of outcome.
 */
export async function executeWithAuthority(
  codename: string,
  action: string,
  executor: () => Promise<any>,
  metadata: Partial<ActionExecution> = {}
): Promise<{ success: boolean; result?: any; escalated?: boolean; logId?: number }> {
  const startTime = Date.now();
  const auth = await checkAuthority(codename, action);

  const baseLog: Partial<ActionExecution> = {
    agentCodename: codename,
    actionName: action,
    authorityLevel: auth.effectiveLevel,
    trustScoreAtTime: auth.currentTrust,
    ...metadata,
  };

  // Level 3 or not allowed — escalate to decisions inbox
  if (!auth.allowed || auth.effectiveLevel === 3) {
    const logId = await logAction({
      ...baseLog,
      outcome: "escalated",
      reasoning: auth.reason,
      durationMs: Date.now() - startTime,
    } as ActionExecution);

    // Create a decisions inbox item
    await db.insert(decisionsInboxItems).values({
      itemType: "agent_escalation",
      riskLevel: "medium",
      urgencyScore: 60,
      sophieAnalysis: `Agent ${codename} wants to execute "${action}" but lacks authority (trust: ${auth.currentTrust}, needs: ${auth.trustRequired}). ${auth.reason}`,
      recommendedAction: `Allow ${codename} to execute: ${action}`,
      recommendedActionLabel: `${codename}: ${action}`,
      ownerAgentCodename: codename,
      status: "pending",
    });

    return { success: false, escalated: true, logId };
  }

  // Level 2 — recommend + wait (create inbox item, don't execute)
  if (auth.effectiveLevel === 2) {
    const logId = await logAction({
      ...baseLog,
      outcome: "pending",
      reasoning: `Level 2: Awaiting CEO approval. ${auth.reason}`,
      durationMs: Date.now() - startTime,
    } as ActionExecution);

    await db.insert(decisionsInboxItems).values({
      itemType: "agent_recommendation",
      riskLevel: "low",
      urgencyScore: 40,
      sophieAnalysis: `Agent ${codename} recommends executing "${action}". Trust: ${auth.currentTrust}/100.`,
      recommendedAction: action,
      recommendedActionLabel: `${codename} recommends: ${action}`,
      ownerAgentCodename: codename,
      status: "pending",
    });

    return { success: false, escalated: true, logId };
  }

  // Level 0 or 1 — execute
  try {
    const result = await executor();
    const durationMs = Date.now() - startTime;

    const logId = await logAction({
      ...baseLog,
      output: typeof result === "object" ? result : { value: result },
      outcome: "success",
      reasoning: auth.downgraded ? `Downgraded: ${auth.reason}` : `Authorized at level ${auth.effectiveLevel}`,
      durationMs,
    } as ActionExecution);

    // Level 1 — notify CEO after execution
    if (auth.effectiveLevel === 1) {
      try {
        const { agentCommsService } = await import("./agentComms");
        await agentCommsService.broadcast({
          from: codename,
          channel: "incidents",
          priority: "low",
          subject: `[Auto-executed] ${codename}: ${action}`,
          body: `Executed autonomously at trust level ${auth.currentTrust}. Duration: ${durationMs}ms.`,
          data: { action, level: 1, trust: auth.currentTrust },
        });
      } catch {}
    }

    return { success: true, result, logId };
  } catch (err: any) {
    const logId = await logAction({
      ...baseLog,
      output: { error: err.message },
      outcome: "failure",
      reasoning: `Execution failed: ${err.message}`,
      durationMs: Date.now() - startTime,
    } as ActionExecution);

    return { success: false, result: err.message, logId };
  }
}

/**
 * Log an action to the audit trail.
 */
async function logAction(execution: ActionExecution): Promise<number> {
  try {
    const [row] = await db.insert(agentActionLog).values({
      agentCodename: execution.agentCodename,
      actionType: execution.actionType || "skill",
      actionName: execution.actionName,
      input: execution.input || {},
      output: execution.output || {},
      reasoning: execution.reasoning || "",
      confidence: execution.confidence || 0,
      costCents: execution.costCents || 0,
      authorityLevel: execution.authorityLevel,
      trustScoreAtTime: execution.trustScoreAtTime,
      outcome: execution.outcome,
      durationMs: execution.durationMs || 0,
      relatedGoalId: execution.relatedGoalId,
      relatedDecisionId: execution.relatedDecisionId,
    }).returning({ id: agentActionLog.id });
    return row?.id || 0;
  } catch {
    return 0;
  }
}

/**
 * Get recent actions for an agent (for audit trail UI).
 */
export async function getAgentActions(codename: string, limit = 50) {
  return db.select()
    .from(agentActionLog)
    .where(eq(agentActionLog.agentCodename, codename))
    .orderBy(agentActionLog.createdAt)
    .limit(limit);
}
