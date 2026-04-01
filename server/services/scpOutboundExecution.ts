/**
 * SCP v3 Outbound Execution Framework — Sovereign Company Protocol
 *
 * Formal execution pipeline layered on top of existing executionEngine and
 * agentActionExecutors. Adds:
 *   - Authority-level gating (0-3) per action
 *   - Confirmation queue for high-authority actions
 *   - Execution audit trail with full context
 *   - Evolution feedback (outcomes → agent learning)
 *   - Integration fabric bridge (outbound actions via integrations)
 *   - Rollback/undo registry
 */

import { logger } from "../utils/logger";
import crypto from "crypto";
import {
  isAuthorizedForAction,
  checkRateLimit,
  getIntegration,
} from "./scpIntegrationFabric";

// ─── Types ─────────────────────────────────────────────────────────────────

export type AuthorityLevel = 0 | 1 | 2 | 3;

/**
 * Authority levels:
 * 0 = Read-only / no side effects (auto-approved)
 * 1 = Low-impact write (auto-approved for trusted agents)
 * 2 = Significant write (requires confirmation unless agent trust > threshold)
 * 3 = Critical / financial / irreversible (always requires CEO confirmation)
 */
export const AUTHORITY_DESCRIPTIONS: Record<AuthorityLevel, string> = {
  0: "Read-only, no side effects",
  1: "Low-impact write, auto-approved for trusted agents",
  2: "Significant write, may require confirmation",
  3: "Critical/financial/irreversible, always requires CEO confirmation",
};

export interface ExecutionRequest {
  id: string;
  agent: string;
  integration_id: string;
  action: string;
  parameters: Record<string, unknown>;
  authority_level: AuthorityLevel;
  reason: string;
  session_id: string;
  created_at: string;
  status: "pending_confirmation" | "approved" | "executing" | "completed" | "failed" | "rejected" | "rolled_back";
  confirmation_required: boolean;
  confirmed_by?: string;
  confirmed_at?: string;
}

export interface ExecutionOutcome {
  request_id: string;
  success: boolean;
  output: Record<string, unknown>;
  duration_ms: number;
  error?: string;
  side_effects: string[];
  rollback_available: boolean;
  completed_at: string;
}

export interface ConfirmationRequest {
  execution_id: string;
  agent: string;
  action: string;
  integration_id: string;
  authority_level: AuthorityLevel;
  reason: string;
  parameters: Record<string, unknown>;
  created_at: string;
  expires_at: string;
}

// ─── Agent Trust Thresholds ───────────────────────────────────────────────

/**
 * Trust scores per agent (0-1). In production these come from the evolution engine.
 * Actions at authority_level <= agent's auto-approve threshold pass without confirmation.
 */
const agentTrustScores = new Map<string, number>();

export function setAgentTrust(agent: string, score: number): void {
  agentTrustScores.set(agent, Math.max(0, Math.min(1, score)));
}

export function getAgentTrust(agent: string): number {
  return agentTrustScores.get(agent) ?? 0.5; // Default moderate trust
}

/**
 * Determine if an action requires confirmation based on authority level and trust.
 */
export function requiresConfirmation(authorityLevel: AuthorityLevel, agent: string): boolean {
  if (authorityLevel === 0) return false;
  if (authorityLevel === 3) return true; // Always confirm critical actions

  const trust = getAgentTrust(agent);

  if (authorityLevel === 1) {
    return trust < 0.3; // Only low-trust agents need confirmation for level 1
  }

  // Level 2: needs confirmation unless high trust
  return trust < 0.8;
}

// ─── Execution Pipeline ───────────────────────────────────────────────────

const executionLog: ExecutionRequest[] = [];
const outcomeLog: ExecutionOutcome[] = [];
const confirmationQueue: ConfirmationRequest[] = [];
const rollbackRegistry = new Map<string, () => Promise<void>>();

/**
 * Submit an execution request through the formal pipeline.
 * Returns immediately — the request may be queued for confirmation.
 */
export function submitExecution(request: {
  agent: string;
  integration_id: string;
  action: string;
  parameters: Record<string, unknown>;
  reason: string;
  session_id: string;
}): {
  success: boolean;
  execution_id?: string;
  status?: ExecutionRequest["status"];
  confirmation_required?: boolean;
  rejection_reason?: string;
} {
  // Check agent authorization
  const authCheck = isAuthorizedForAction(request.agent, request.integration_id, request.action);
  if (!authCheck.authorized) {
    return { success: false, rejection_reason: authCheck.reason };
  }

  const authorityLevel = (authCheck.authority_level ?? 0) as AuthorityLevel;

  // Check rate limits
  const rateCheck = checkRateLimit(request.integration_id, request.action);
  if (!rateCheck.allowed) {
    return {
      success: false,
      rejection_reason: `Rate limit exceeded. Resets at ${rateCheck.reset_at}`,
    };
  }

  const needsConfirmation = requiresConfirmation(authorityLevel, request.agent);

  const execRequest: ExecutionRequest = {
    id: crypto.randomUUID(),
    agent: request.agent,
    integration_id: request.integration_id,
    action: request.action,
    parameters: request.parameters,
    authority_level: authorityLevel,
    reason: request.reason,
    session_id: request.session_id,
    created_at: new Date().toISOString(),
    status: needsConfirmation ? "pending_confirmation" : "approved",
    confirmation_required: needsConfirmation,
  };

  executionLog.push(execRequest);

  if (needsConfirmation) {
    const confirmation: ConfirmationRequest = {
      execution_id: execRequest.id,
      agent: request.agent,
      action: request.action,
      integration_id: request.integration_id,
      authority_level: authorityLevel,
      reason: request.reason,
      parameters: request.parameters,
      created_at: execRequest.created_at,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24h expiry
    };
    confirmationQueue.push(confirmation);

    logger.info("Execution queued for confirmation", {
      id: execRequest.id,
      agent: request.agent,
      action: request.action,
      authority_level: authorityLevel,
    });
  }

  return {
    success: true,
    execution_id: execRequest.id,
    status: execRequest.status,
    confirmation_required: needsConfirmation,
  };
}

/**
 * Approve a pending execution request (CEO confirmation).
 */
export function approveExecution(executionId: string, approvedBy: string = "ceo"): {
  success: boolean;
  reason?: string;
} {
  const request = executionLog.find((r) => r.id === executionId);
  if (!request) return { success: false, reason: "Execution request not found" };
  if (request.status !== "pending_confirmation") {
    return { success: false, reason: `Cannot approve request in status: ${request.status}` };
  }

  request.status = "approved";
  request.confirmed_by = approvedBy;
  request.confirmed_at = new Date().toISOString();

  // Remove from confirmation queue
  const qIdx = confirmationQueue.findIndex((c) => c.execution_id === executionId);
  if (qIdx >= 0) confirmationQueue.splice(qIdx, 1);

  logger.info("Execution approved", { id: executionId, by: approvedBy });

  return { success: true };
}

/**
 * Reject a pending execution request.
 */
export function rejectExecution(executionId: string, rejectedBy: string = "ceo"): {
  success: boolean;
  reason?: string;
} {
  const request = executionLog.find((r) => r.id === executionId);
  if (!request) return { success: false, reason: "Execution request not found" };
  if (request.status !== "pending_confirmation") {
    return { success: false, reason: `Cannot reject request in status: ${request.status}` };
  }

  request.status = "rejected";
  request.confirmed_by = rejectedBy;
  request.confirmed_at = new Date().toISOString();

  const qIdx = confirmationQueue.findIndex((c) => c.execution_id === executionId);
  if (qIdx >= 0) confirmationQueue.splice(qIdx, 1);

  logger.info("Execution rejected", { id: executionId, by: rejectedBy });

  return { success: true };
}

/**
 * Record the outcome of an executed action.
 * This feeds back into evolution — agents learn from outcomes.
 */
export function recordOutcome(outcome: {
  request_id: string;
  success: boolean;
  output: Record<string, unknown>;
  duration_ms: number;
  error?: string;
  side_effects: string[];
  rollback_fn?: () => Promise<void>;
}): ExecutionOutcome {
  const request = executionLog.find((r) => r.id === outcome.request_id);
  if (request) {
    request.status = outcome.success ? "completed" : "failed";
  }

  const hasRollback = !!outcome.rollback_fn;
  if (outcome.rollback_fn) {
    rollbackRegistry.set(outcome.request_id, outcome.rollback_fn);
  }

  const entry: ExecutionOutcome = {
    request_id: outcome.request_id,
    success: outcome.success,
    output: outcome.output,
    duration_ms: outcome.duration_ms,
    error: outcome.error,
    side_effects: outcome.side_effects,
    rollback_available: hasRollback,
    completed_at: new Date().toISOString(),
  };

  outcomeLog.push(entry);

  // Update integration metrics
  if (request) {
    const integration = getIntegration(request.integration_id);
    if (integration) {
      integration.total_outbound_actions++;
      if (!outcome.success) {
        integration.error_count_trailing_7d++;
      }
    }
  }

  logger.info("Execution outcome recorded", {
    request_id: outcome.request_id,
    success: outcome.success,
    duration_ms: outcome.duration_ms,
  });

  return entry;
}

/**
 * Attempt to rollback a completed action.
 */
export async function rollbackExecution(requestId: string): Promise<{
  success: boolean;
  reason?: string;
}> {
  const fn = rollbackRegistry.get(requestId);
  if (!fn) return { success: false, reason: "No rollback available for this execution" };

  try {
    await fn();
    const request = executionLog.find((r) => r.id === requestId);
    if (request) request.status = "rolled_back";
    rollbackRegistry.delete(requestId);
    logger.info("Execution rolled back", { request_id: requestId });
    return { success: true };
  } catch (error) {
    logger.error("Rollback failed", { request_id: requestId, error });
    return { success: false, reason: `Rollback failed: ${error}` };
  }
}

// ─── Query & Stats ────────────────────────────────────────────────────────

/**
 * Get pending confirmation requests.
 */
export function getPendingConfirmations(): ConfirmationRequest[] {
  const now = Date.now();
  return confirmationQueue.filter(
    (c) => new Date(c.expires_at).getTime() > now
  );
}

/**
 * Get execution history for an agent.
 */
export function getAgentExecutionHistory(agent: string, limit: number = 50): ExecutionRequest[] {
  return executionLog
    .filter((r) => r.agent === agent)
    .slice(-limit);
}

/**
 * Get execution stats summary.
 */
export function getExecutionStats(): {
  total_requests: number;
  by_status: Record<string, number>;
  by_agent: Record<string, { total: number; success: number; failure: number }>;
  avg_duration_ms: number;
  pending_confirmations: number;
  rollbacks_available: number;
} {
  const byStatus: Record<string, number> = {};
  const byAgent: Record<string, { total: number; success: number; failure: number }> = {};

  for (const req of executionLog) {
    byStatus[req.status] = (byStatus[req.status] ?? 0) + 1;

    if (!byAgent[req.agent]) byAgent[req.agent] = { total: 0, success: 0, failure: 0 };
    byAgent[req.agent].total++;
  }

  let totalDuration = 0;
  for (const outcome of outcomeLog) {
    totalDuration += outcome.duration_ms;
    const req = executionLog.find((r) => r.id === outcome.request_id);
    if (req && byAgent[req.agent]) {
      if (outcome.success) byAgent[req.agent].success++;
      else byAgent[req.agent].failure++;
    }
  }

  return {
    total_requests: executionLog.length,
    by_status: byStatus,
    by_agent: byAgent,
    avg_duration_ms: outcomeLog.length > 0 ? totalDuration / outcomeLog.length : 0,
    pending_confirmations: confirmationQueue.length,
    rollbacks_available: rollbackRegistry.size,
  };
}

/**
 * Get recent outcomes for evolution feedback.
 * The evolution engine calls this to learn from action outcomes.
 */
export function getRecentOutcomes(agent: string, limit: number = 20): Array<ExecutionOutcome & { action: string; integration_id: string }> {
  const agentRequests = new Map(
    executionLog.filter((r) => r.agent === agent).map((r) => [r.id, r])
  );

  return outcomeLog
    .filter((o) => agentRequests.has(o.request_id))
    .slice(-limit)
    .map((o) => {
      const req = agentRequests.get(o.request_id)!;
      return { ...o, action: req.action, integration_id: req.integration_id };
    });
}

// ─── Exported Service ──────────────────────────────────────────────────────

export const scpOutboundExecution = {
  // Pipeline
  submitExecution,
  approveExecution,
  rejectExecution,
  recordOutcome,
  rollbackExecution,
  // Trust
  setAgentTrust,
  getAgentTrust,
  requiresConfirmation,
  // Queries
  getPendingConfirmations,
  getAgentExecutionHistory,
  getExecutionStats,
  getRecentOutcomes,
};
