/**
 * Frugal Autonomy — Triage Engine
 *
 * Rule-based first gate for the autonomous decision executor. Most
 * inbox items don't need an LLM — they need a deterministic answer
 * based on item_type + payload + signals already in the row. This
 * module resolves ~60-80% of items before any model is consulted.
 *
 * For everything else, returns `escalate-to-llm` and lets the
 * reasoning cascade (intelligence/cascade.ts) take it from there.
 *
 * Add a new item_type rule here, not in the executor. Keep the
 * executor narrow: triage → cascade → execute.
 */

import { logger } from "../../utils/logger";

export type TriageDecision =
  | { kind: "auto-approve"; reason: string; confidence: number }
  | { kind: "auto-reject"; reason: string; confidence: number }
  | { kind: "auto-defer"; reason: string; deferMinutes: number }
  | { kind: "escalate-to-llm"; reason: string };

export interface TriageInput {
  id: number;
  itemType: string;
  riskLevel: string;                       // "low" | "medium" | "high" | "critical"
  urgencyScore: number;                    // 0-100
  estimatedImpactCents: number | null;
  ownerAgentCodename: string | null;
  recommendedAction: string;
  contextBundle: Record<string, any> | null;
  actionPayload: Record<string, any> | null;
}

/**
 * Resolve the right triage decision for an item without calling an LLM.
 * Pure function over the inputs in TriageInput; no side effects.
 */
export function triage(item: TriageInput): TriageDecision {
  switch (item.itemType) {
    case "dlq_poison_job":
      return triageDlqPoisonJob(item);
    case "agent_initiative":
      return triageAgentInitiative(item);
    case "agent_recommendation":
      return triageAgentRecommendation(item);
    case "agent_event":
      return triageAgentEvent(item);
    default:
      // Unknown types always escalate so we never silently miss
      // something that mattered. New item_types should get their
      // own rule here within a release of being introduced.
      return {
        kind: "escalate-to-llm",
        reason: `triage: no rule for item_type=${item.itemType}; escalating`,
      };
  }
}

// ─── Per-type rule sets ─────────────────────────────────────────────────────

/**
 * DLQ poison jobs — outbox / worker failures parked for review.
 *
 * Transient infra errors (timeouts, rate limits, network blips) retry
 * automatically without LLM. Permanent ones (bad payload, denied
 * permission) archive without LLM. Only genuinely ambiguous errors
 * (unknown signature, message we haven't seen) escalate.
 */
function triageDlqPoisonJob(item: TriageInput): TriageDecision {
  const payload = item.actionPayload ?? {};
  const ctx = item.contextBundle ?? {};
  const errorRaw = String(payload.error || ctx.error || ctx.lastError || "").toLowerCase();
  const errorCode = String(payload.errorCode || ctx.errorCode || "").toLowerCase();
  const attempts = Number(payload.attempts || ctx.attempts || 0);

  // Transient signals → retry. The outbox runner has its own backoff;
  // we just unblock it by approving the recommended action (which is
  // "retry").
  const transientPatterns = [
    "etimedout",
    "econnreset",
    "econnrefused",
    "socket hang up",
    "rate limit",
    "rate_limit",
    "429",
    "502 bad gateway",
    "503 service unavailable",
    "504 gateway timeout",
    "upstream timed out",
    "fetch failed",
    "network error",
  ];
  for (const pat of transientPatterns) {
    if (errorRaw.includes(pat) || errorCode.includes(pat)) {
      // Cap the retry-without-LLM path at 5 attempts. Beyond that the
      // human (or LLM) should look at it.
      if (attempts >= 5) {
        return {
          kind: "escalate-to-llm",
          reason: `dlq: transient error but ${attempts} attempts — escalating`,
        };
      }
      return {
        kind: "auto-defer",
        reason: `dlq: transient error (${pat}) — auto-retry`,
        deferMinutes: Math.min(60, 2 ** attempts), // 1, 2, 4, 8, 16, 32 → cap 60
      };
    }
  }

  // Permanent signals → archive (reject the recommended retry).
  const permanentPatterns = [
    "permission denied",
    "unauthorized",
    "forbidden",
    "invalid payload",
    "invalid_request",
    "validation failed",
    "no such",
    "not found",
    "schema mismatch",
    "duplicate key",
  ];
  for (const pat of permanentPatterns) {
    if (errorRaw.includes(pat) || errorCode.includes(pat)) {
      return {
        kind: "auto-reject",
        reason: `dlq: permanent error (${pat}) — archive`,
        confidence: 90,
      };
    }
  }

  // Anything else — let the LLM look.
  return {
    kind: "escalate-to-llm",
    reason: "dlq: unrecognized error class — escalating",
  };
}

/**
 * Agent-proposed initiatives — work an agent wants to do.
 *
 * High-trust agents (trust_score >= 90, encoded by owner agent + risk)
 * doing low-risk small-impact work auto-approve. Anything that touches
 * customers, finance, or carries meaningful impact escalates.
 */
function triageAgentInitiative(item: TriageInput): TriageDecision {
  const impactCents = item.estimatedImpactCents ?? 0;
  const ctx = item.contextBundle ?? {};
  const trustScore = Number(ctx.agentTrustScore || ctx.trustScore || 0);
  const customerFacing = Boolean(ctx.customerFacing || ctx.touchesCustomer);

  // Anything customer-facing or with real impact escalates.
  if (customerFacing) {
    return { kind: "escalate-to-llm", reason: "initiative: customer-facing — escalating" };
  }
  if (impactCents >= 10_000) {
    return { kind: "escalate-to-llm", reason: `initiative: impact $${impactCents / 100} — escalating` };
  }

  // High-trust, low-risk, small-impact initiatives auto-approve.
  if (
    trustScore >= 90 &&
    (item.riskLevel === "low" || item.riskLevel === "medium") &&
    impactCents < 1_000
  ) {
    return {
      kind: "auto-approve",
      reason: `initiative: high-trust agent (${trustScore}/100), ${item.riskLevel} risk, <$10 impact`,
      confidence: 85,
    };
  }

  // Low urgency + low impact → defer to weekly review batch.
  if (item.urgencyScore < 30 && impactCents < 100) {
    return {
      kind: "auto-defer",
      reason: "initiative: low urgency + trivial impact — weekly batch",
      deferMinutes: 60 * 24, // 24h
    };
  }

  return { kind: "escalate-to-llm", reason: "initiative: needs judgment" };
}

/**
 * Agent recommendations — agents suggesting the founder do X.
 *
 * Low-risk recommendations from any agent auto-approve. Higher-risk
 * ones escalate so we can write a proper response to the founder.
 */
function triageAgentRecommendation(item: TriageInput): TriageDecision {
  const impactCents = item.estimatedImpactCents ?? 0;
  if (item.riskLevel === "low" && impactCents < 5_000) {
    return {
      kind: "auto-approve",
      reason: "recommendation: low risk + sub-$50 impact",
      confidence: 80,
    };
  }
  return { kind: "escalate-to-llm", reason: "recommendation: non-trivial — escalating" };
}

/**
 * Agent events — activity notifications. Almost always auto-approve
 * (they're informational); only escalate if marked critical.
 */
function triageAgentEvent(item: TriageInput): TriageDecision {
  if (item.riskLevel === "critical") {
    return { kind: "escalate-to-llm", reason: "event: critical risk — escalating" };
  }
  return {
    kind: "auto-approve",
    reason: `event: ${item.riskLevel} severity — auto-acknowledge`,
    confidence: 95,
  };
}

/**
 * Helper exposed for callers that want to log triage outcomes.
 * Wrapper around triage() with a debug log line.
 */
export function triageWithLog(item: TriageInput): TriageDecision {
  const decision = triage(item);
  logger.debug(`[triage] item=${item.id} type=${item.itemType} -> ${decision.kind}`, {
    metadata: { itemId: item.id, decisionKind: decision.kind, reason: decision.reason },
  });
  return decision;
}
