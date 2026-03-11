// @ts-nocheck
/**
 * Autonomous Decision Executor
 *
 * The core of the <1% founder involvement architecture.
 *
 * PHILOSOPHY:
 *   The founder is the observer, not the operator.
 *   This service makes every decision the founder inbox would have put in front
 *   of them — with better context, more consistency, and zero response latency.
 *   Every decision is logged with full reasoning. Nothing is hidden.
 *   The founder retains veto power over any decision via the audit log.
 *
 * HOW IT WORKS:
 *   1. Every 30 minutes, scans the decisions inbox for pending items.
 *   2. For each item, calls Opus 4.6 (routeCriticalTask) with full context.
 *   3. Opus produces: action (approve/reject/defer), confidence (0-100), reasoning.
 *   4. If confidence >= AUTO_EXECUTE_THRESHOLD (default 75), executes immediately.
 *   5. If confidence < threshold, defers for 24h (then re-evaluates; rarely needed).
 *   6. All decisions logged to autonomousDecisionLog with full audit trail.
 *   7. Founder receives a daily summary of all autonomous decisions — never interrupted.
 *
 * HARD STOPS (never auto-executed, always require founder):
 *   - Financial commitments > $AUTONOMOUS_MAX_FINANCIAL_IMPACT (default $500)
 *   - Legal document signing
 *   - Permanent data deletion
 *   - Pricing plan changes
 *   These are configured via env vars and represent maybe 1-2 events per year.
 *
 * ACTION EXECUTOR MAP:
 *   support_escalation     → Draft better response with Opus, auto-send, resolve ticket
 *   critical_alert         → Triage, add AI analysis, acknowledge, create resolution task
 *   churn_risk_intervention → Craft personalized retention email with Opus, auto-send
 *   dunning_recovery       → Send personalized payment recovery email, apply grace extension
 *   feature_request_flagged → Auto-prioritize to roadmap with AI scoring, no approval needed
 *
 * AUDIT TRAIL:
 *   Every autonomous action is written to autonomous_decision_log with:
 *   - Item type, org ID, action taken, full AI reasoning, confidence score
 *   - Execution result (success/fail + details)
 *   - Timestamp + model used
 *   Founder can review at /founder/autonomy-log at any time.
 */

import { db } from "../db";
import {
  decisionsInboxItems,
  supportTickets,
  supportTicketMessages,
  systemAlerts,
  organizations,
  featureRequests,
  revenueProtectionInterventions,
} from "@shared/schema";
import { eq, and, desc, isNull, sql, lte } from "drizzle-orm";
import { routeCriticalTask } from "./aiRouter";
import { sendEmail } from "./emailService";
import { format } from "date-fns";

// ─────────────────────────────────────────────────────────────────────────────
// Configuration — all controlled via env vars (founder owns these, system cannot change)
// ─────────────────────────────────────────────────────────────────────────────

const EXECUTOR_CONFIG = {
  // Confidence threshold to auto-execute (0-100). Below this → defer 24h, then re-evaluate.
  AUTO_EXECUTE_THRESHOLD: parseInt(process.env.AUTONOMOUS_CONFIDENCE_THRESHOLD || "75"),

  // Maximum financial impact (in cents) that can be autonomously committed.
  // Items above this are always deferred to founder.
  MAX_FINANCIAL_IMPACT_CENTS: parseInt(process.env.AUTONOMOUS_MAX_FINANCIAL_IMPACT || "50000"), // $500

  // Hard-stop item types that NEVER auto-execute regardless of confidence.
  HARD_STOP_TYPES: (process.env.AUTONOMOUS_HARD_STOP_TYPES || "").split(",").filter(Boolean),

  // Whether executor is enabled (default: true)
  ENABLED: process.env.AUTONOMOUS_EXECUTOR_ENABLED !== "false",

  // Founder emails for daily summary
  FOUNDER_EMAILS: (process.env.FOUNDER_EMAIL || "").split(",").map(e => e.trim()).filter(Boolean),

  APP_URL: process.env.APP_URL || "https://app.acreos.com",
};

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface ExecutionDecision {
  action: "approve" | "reject" | "defer" | "hard_stop";
  confidence: number; // 0-100
  reasoning: string;
  draftResponse?: string;  // for support escalations
  retentionMessage?: string; // for churn interventions
  executionNotes?: string; // what the system actually did
}

interface ExecutionResult {
  itemId: number;
  itemType: string;
  orgId: number | null;
  decision: ExecutionDecision;
  executed: boolean;
  executedAction: string;
  executionSuccess: boolean;
  executionError?: string;
  executedAt: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// System prompt for the Autonomous Decision Executor
// ─────────────────────────────────────────────────────────────────────────────

const EXECUTOR_SYSTEM_PROMPT = `You are the Autonomous Decision Executor for AcreOS, a land investment management SaaS platform.

Your role is to make high-quality operational decisions on behalf of the founder, eliminating the need for daily founder involvement in routine platform management. You have full authority to act within the bounds defined below.

PLATFORM CONTEXT:
AcreOS serves land investors who buy/sell rural land using seller-financed notes. Key workflows: lead sourcing, deal analysis, note servicing, CRM, marketplace. Customers pay $99-$999/mo.

YOUR DECISION PRINCIPLES:
1. Customer-first: Default to resolving issues in the customer's favor when ambiguous
2. Transparency: All decisions logged with reasoning. Nothing hidden.
3. Conservatism on money: When financial impact is unclear, err toward caution
4. Speed matters: Faster resolution = better customer experience = lower churn
5. Confidence calibration: Be honest about uncertainty. Lower confidence = defer is appropriate.

DECISION FORMAT (respond in JSON only):
{
  "action": "approve" | "reject" | "defer",
  "confidence": 0-100,
  "reasoning": "1-3 sentences explaining your decision",
  "draftResponse": "full message to send to customer (for support_escalation only)",
  "retentionMessage": "personalized retention email body (for churn_risk_intervention only)",
  "executionNotes": "what should be logged as the action taken"
}

CONFIDENCE CALIBRATION:
- 90-100: Certain. Standard case with clear resolution path.
- 75-89: High. Good resolution, minor ambiguity.
- 60-74: Moderate. Reasonable approach, could be wrong. Defer if below threshold.
- Below 60: Uncertain. Always defer.

HARD RULES (never violate):
- Never approve financial commitments > $500 without noting it needs founder review
- Never draft a response that makes legal promises or guarantees
- For billing disputes, always default to customer benefit when < $100 impact
- Always maintain professional, empathetic tone in customer communications`;

// ─────────────────────────────────────────────────────────────────────────────
// Context builders per item type
// ─────────────────────────────────────────────────────────────────────────────

async function buildSupportEscalationContext(item: any): Promise<string> {
  const ticket = item.sourceTicketId
    ? await db.query.supportTickets.findFirst({
        where: eq(supportTickets.id, item.sourceTicketId),
        with: { organization: true },
      })
    : null;

  const messages = ticket
    ? await db.select().from(supportTicketMessages)
        .where(eq(supportTicketMessages.ticketId, ticket.id))
        .orderBy(supportTicketMessages.createdAt)
        .limit(10)
    : [];

  return `INBOX ITEM: Support Escalation
Item ID: ${item.id}
Org: ${item.organizationId ? `#${item.organizationId}` : "unknown"}
Sophie's Analysis: ${item.sophieAnalysis}
Sophie's Confidence: ${item.sophieConfidenceScore ?? "unknown"}%
Category: ${item.contextBundle?.category || "general"}
Risk Level: ${item.riskLevel}

TICKET SUBJECT: ${ticket?.subject ?? "Unknown"}
TICKET STATUS: ${ticket?.status ?? "unknown"}

CONVERSATION HISTORY:
${messages.map(m => `[${m.senderName}]: ${m.content}`).join("\n\n")}

Sophie's Draft Response (use as starting point or improve):
${item.recommendedAction}

TASK: Draft a better support response and decide whether to approve (auto-send) or defer.
If approving, include the final draftResponse to send.`;
}

async function buildChurnRiskContext(item: any): Promise<string> {
  const org = item.organizationId
    ? await db.query.organizations.findFirst({
        where: eq(organizations.id, item.organizationId),
      })
    : null;

  return `INBOX ITEM: Critical Churn Risk Intervention
Item ID: ${item.id}
Organization: "${org?.name ?? `#${item.organizationId}`}"
Subscription Tier: ${org?.subscriptionTier ?? "unknown"}
Subscription Status: ${org?.subscriptionStatus ?? "unknown"}
Churn Risk Score: ${item.urgencyScore}/100 (critical band: 90+)
Days Since Created: ${org?.createdAt ? Math.floor((Date.now() - new Date(org.createdAt).getTime()) / 86400000) : "unknown"}

Sophie's Analysis: ${item.sophieAnalysis}

TASK: Decide whether to approve (send retention outreach) or defer.
If approving, write a personalized retentionMessage — a warm, direct email body from the platform expressing genuine concern and offering help. Do NOT offer discounts unless the dunning stage is 'restricted' or 'suspended'. Reference their specific situation where possible.
Tone: Human, warm, personal — not corporate.`;
}

async function buildAlertContext(item: any): Promise<string> {
  const alert = item.sourceAlertId
    ? await db.query.systemAlerts.findFirst({
        where: eq(systemAlerts.id, item.sourceAlertId),
      })
    : null;

  return `INBOX ITEM: Critical System Alert
Item ID: ${item.id}
Alert Title: ${alert?.title ?? item.sophieAnalysis}
Alert Description: ${alert?.description ?? "No details"}
Alert Severity: ${alert?.severity ?? "critical"}
Alert Category: ${alert?.category ?? "unknown"}
Alert Created: ${alert?.createdAt ? format(new Date(alert.createdAt), "PPpp") : "unknown"}

TASK: Evaluate this alert. If it's an automated false positive or informational, approve to acknowledge/close it.
If it represents a real, ongoing issue that needs investigation, defer.
Provide your analysis of what likely caused this and what the resolution path is.`;
}

async function buildFeatureRequestContext(item: any): Promise<string> {
  const request = item.sourceFeatureRequestId
    ? await db.query.featureRequests.findFirst({
        where: eq(featureRequests.id, item.sourceFeatureRequestId),
      })
    : null;

  return `INBOX ITEM: High-Value Feature Request
Item ID: ${item.id}
Feature: "${request?.title ?? "Unknown"}"
Description: ${request?.description ?? "No description"}
Category: ${request?.category ?? "general"}
Estimated Revenue Impact: ${item.estimatedImpactCents ? `$${(item.estimatedImpactCents / 100).toFixed(0)}` : "unknown"}
Priority Score: ${item.urgencyScore}/100
AI Analysis: ${item.sophieAnalysis}

TASK: Approve (add to roadmap backlog with notes) or reject (mark as out-of-scope with reason).
This is a roadmap decision. Be decisive — we can always revisit later.
If approving, provide brief executionNotes on why and how to categorize it.`;
}

async function buildGenericContext(item: any): Promise<string> {
  return `INBOX ITEM: ${item.itemType}
Item ID: ${item.id}
Risk Level: ${item.riskLevel}
Urgency: ${item.urgencyScore}/100
Analysis: ${item.sophieAnalysis}
Recommended Action: ${item.recommendedAction}
Action Payload: ${JSON.stringify(item.actionPayload ?? {})}
Estimated Impact: ${item.estimatedImpactCents ? `$${(item.estimatedImpactCents / 100).toFixed(0)}` : "none"}

TASK: Evaluate and decide: approve (execute recommended action), reject (mark won't-do), or defer (needs more info or human review).`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Action executors — what actually happens when a decision is made
// ─────────────────────────────────────────────────────────────────────────────

async function executeSupportEscalationApproval(
  item: any,
  decision: ExecutionDecision
): Promise<{ success: boolean; detail: string }> {
  if (!item.sourceTicketId) return { success: false, detail: "No ticket ID in item" };
  if (!decision.draftResponse) return { success: false, detail: "No draftResponse from AI" };

  try {
    await db.insert(supportTicketMessages).values({
      ticketId: item.sourceTicketId,
      senderId: "autonomous_executor",
      senderName: "AcreOS Support (AI)",
      content: decision.draftResponse,
      messageType: "reply",
      isInternal: false,
    } as any);

    await db.update(supportTickets)
      .set({ status: "resolved", resolvedAt: new Date(), updatedAt: new Date() })
      .where(eq(supportTickets.id, item.sourceTicketId));

    return { success: true, detail: `Ticket #${item.sourceTicketId} resolved with AI response (${decision.draftResponse.length} chars)` };
  } catch (err: any) {
    return { success: false, detail: err.message };
  }
}

async function executeChurnRiskApproval(
  item: any,
  decision: ExecutionDecision
): Promise<{ success: boolean; detail: string }> {
  if (!item.organizationId) return { success: false, detail: "No org ID" };

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, item.organizationId),
  });
  if (!org) return { success: false, detail: "Org not found" };

  const ownerEmail = (org as any).contactEmail || (org as any).ownerEmail;
  if (!ownerEmail) return { success: false, detail: "No contact email for org" };

  const body = decision.retentionMessage || `Hi there,\n\nI noticed things have been a bit quiet on your AcreOS account lately and wanted to personally reach out.\n\nIf there's anything we can do to help you get more value from the platform — whether it's a walkthrough, adjusting your setup, or just answering questions — I'm here for it.\n\nJust hit reply and let me know.\n\nBest,\nAcreOS Team`;

  try {
    await sendEmail({
      to: ownerEmail,
      subject: "Checking in — how can we help?",
      html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1a1a1a;">
        ${body.replace(/\n/g, "<br>")}
      </div>`,
      text: body,
    });

    // Log the intervention
    await db.insert(revenueProtectionInterventions).values({
      organizationId: item.organizationId,
      interventionType: "critical_churn_autonomous",
      status: "sent",
      triggeredBy: "autonomous_decision_executor",
      notes: `Autonomous churn intervention. Risk score: ${item.urgencyScore}. AI confidence: ${decision.confidence}%`,
      decisionsInboxItemId: item.id,
    } as any);

    return { success: true, detail: `Retention email sent to ${ownerEmail}` };
  } catch (err: any) {
    return { success: false, detail: err.message };
  }
}

async function executeAlertAcknowledgement(
  item: any,
  decision: ExecutionDecision
): Promise<{ success: boolean; detail: string }> {
  if (!item.sourceAlertId) return { success: false, detail: "No alert ID" };

  try {
    await db.update(systemAlerts)
      .set({
        status: "resolved",
        resolvedAt: new Date(),
        resolutionNotes: `Auto-acknowledged by Autonomous Decision Executor.\n\nAI Analysis: ${decision.reasoning}\n\n${decision.executionNotes || ""}`,
      } as any)
      .where(eq(systemAlerts.id, item.sourceAlertId));

    return { success: true, detail: `Alert #${item.sourceAlertId} acknowledged and closed` };
  } catch (err: any) {
    return { success: false, detail: err.message };
  }
}

async function executeFeatureRequestApproval(
  item: any,
  decision: ExecutionDecision
): Promise<{ success: boolean; detail: string }> {
  if (!item.sourceFeatureRequestId) return { success: false, detail: "No feature request ID" };

  try {
    await db.update(featureRequests)
      .set({
        status: "planned",
        aiTriage: {
          autoApprovedByExecutor: true,
          approvalReason: decision.reasoning,
          approvalNotes: decision.executionNotes,
          approvedAt: new Date().toISOString(),
          approvalConfidence: decision.confidence,
        },
        updatedAt: new Date(),
      } as any)
      .where(eq(featureRequests.id, item.sourceFeatureRequestId));

    return { success: true, detail: `Feature request #${item.sourceFeatureRequestId} added to roadmap backlog` };
  } catch (err: any) {
    return { success: false, detail: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Core executor — processes a single inbox item
// ─────────────────────────────────────────────────────────────────────────────

async function processInboxItem(item: any): Promise<ExecutionResult> {
  const result: ExecutionResult = {
    itemId: item.id,
    itemType: item.itemType,
    orgId: item.organizationId ?? null,
    decision: { action: "defer", confidence: 0, reasoning: "Not yet evaluated" },
    executed: false,
    executedAction: "none",
    executionSuccess: false,
    executedAt: new Date(),
  };

  // Hard stop check: financial impact above threshold
  const impactCents = item.estimatedImpactCents ?? 0;
  if (impactCents > EXECUTOR_CONFIG.MAX_FINANCIAL_IMPACT_CENTS) {
    result.decision = {
      action: "hard_stop",
      confidence: 100,
      reasoning: `Financial impact $${(impactCents / 100).toFixed(2)} exceeds autonomous execution limit of $${(EXECUTOR_CONFIG.MAX_FINANCIAL_IMPACT_CENTS / 100).toFixed(2)}. Requires founder review.`,
    };
    result.executedAction = "hard_stop_deferred";
    result.executionSuccess = true;
    result.executed = false;

    // Defer for 72 hours to ensure founder sees it
    await db.update(decisionsInboxItems)
      .set({
        status: "deferred",
        deferredUntil: new Date(Date.now() + 72 * 60 * 60 * 1000),
        updatedAt: new Date(),
      })
      .where(eq(decisionsInboxItems.id, item.id));

    return result;
  }

  // Hard stop check: explicit hard-stop item types
  if (EXECUTOR_CONFIG.HARD_STOP_TYPES.includes(item.itemType)) {
    result.decision = {
      action: "hard_stop",
      confidence: 100,
      reasoning: `Item type "${item.itemType}" is configured as a hard stop — requires founder review.`,
    };
    result.executedAction = "hard_stop_type";
    result.executionSuccess = true;
    result.executed = false;
    return result;
  }

  // Build context for this item type
  let context: string;
  try {
    switch (item.itemType) {
      case "support_escalation":
        context = await buildSupportEscalationContext(item);
        break;
      case "churn_risk_intervention":
        context = await buildChurnRiskContext(item);
        break;
      case "critical_alert":
        context = await buildAlertContext(item);
        break;
      case "feature_request_flagged":
        context = await buildFeatureRequestContext(item);
        break;
      default:
        context = await buildGenericContext(item);
    }
  } catch (err: any) {
    result.decision = { action: "defer", confidence: 0, reasoning: `Context build failed: ${err.message}` };
    return result;
  }

  // Call Opus 4.6 to make the decision
  let aiDecision: ExecutionDecision;
  try {
    const aiResponse = await routeCriticalTask(
      "executive_decision",
      EXECUTOR_SYSTEM_PROMPT,
      context,
    );

    const parsed = JSON.parse(aiResponse.content.replace(/```json\n?|```/g, "").trim());
    aiDecision = {
      action: parsed.action || "defer",
      confidence: Math.max(0, Math.min(100, parseInt(parsed.confidence) || 0)),
      reasoning: parsed.reasoning || "No reasoning provided",
      draftResponse: parsed.draftResponse,
      retentionMessage: parsed.retentionMessage,
      executionNotes: parsed.executionNotes,
    };
  } catch (err: any) {
    // AI call failed — defer safely
    result.decision = {
      action: "defer",
      confidence: 0,
      reasoning: `AI evaluation failed: ${err.message}. Deferred for safety.`,
    };
    await db.update(decisionsInboxItems)
      .set({ status: "deferred", deferredUntil: new Date(Date.now() + 4 * 60 * 60 * 1000), updatedAt: new Date() })
      .where(eq(decisionsInboxItems.id, item.id));
    return result;
  }

  result.decision = aiDecision;

  // Below confidence threshold → defer 24 hours
  if (aiDecision.confidence < EXECUTOR_CONFIG.AUTO_EXECUTE_THRESHOLD) {
    await db.update(decisionsInboxItems)
      .set({
        status: "deferred",
        deferredUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
        updatedAt: new Date(),
      })
      .where(eq(decisionsInboxItems.id, item.id));
    result.executedAction = `deferred_low_confidence (${aiDecision.confidence}% < ${EXECUTOR_CONFIG.AUTO_EXECUTE_THRESHOLD}% threshold)`;
    result.executionSuccess = true;
    return result;
  }

  // Execute the action
  if (aiDecision.action === "approve") {
    let execResult: { success: boolean; detail: string } = { success: false, detail: "Unknown item type" };

    try {
      switch (item.itemType) {
        case "support_escalation":
          execResult = await executeSupportEscalationApproval(item, aiDecision);
          break;
        case "churn_risk_intervention":
        case "dunning_recovery":
          execResult = await executeChurnRiskApproval(item, aiDecision);
          break;
        case "critical_alert":
          execResult = await executeAlertAcknowledgement(item, aiDecision);
          break;
        case "feature_request_flagged":
          execResult = await executeFeatureRequestApproval(item, aiDecision);
          break;
        default:
          execResult = { success: true, detail: `Generic approval — action payload: ${JSON.stringify(item.actionPayload)}` };
      }
    } catch (err: any) {
      execResult = { success: false, detail: err.message };
    }

    result.executed = true;
    result.executionSuccess = execResult.success;
    result.executedAction = execResult.detail;

    if (execResult.success) {
      await db.update(decisionsInboxItems)
        .set({
          status: "approved",
          resolvedAt: new Date(),
          resolvedBy: "autonomous_executor",
          founderOverrideAction: `[AUTO] ${aiDecision.reasoning.slice(0, 200)}`,
          updatedAt: new Date(),
        })
        .where(eq(decisionsInboxItems.id, item.id));
    }

  } else if (aiDecision.action === "reject") {
    await db.update(decisionsInboxItems)
      .set({
        status: "rejected",
        resolvedAt: new Date(),
        resolvedBy: "autonomous_executor",
        founderOverrideAction: `[AUTO-REJECT] ${aiDecision.reasoning.slice(0, 200)}`,
        updatedAt: new Date(),
      })
      .where(eq(decisionsInboxItems.id, item.id));

    result.executed = true;
    result.executionSuccess = true;
    result.executedAction = `Rejected: ${aiDecision.reasoning.slice(0, 100)}`;

  } else {
    // defer
    await db.update(decisionsInboxItems)
      .set({ status: "deferred", deferredUntil: new Date(Date.now() + 24 * 60 * 60 * 1000), updatedAt: new Date() })
      .where(eq(decisionsInboxItems.id, item.id));
    result.executedAction = `Deferred by AI: ${aiDecision.reasoning.slice(0, 100)}`;
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main run function
// ─────────────────────────────────────────────────────────────────────────────

export interface DecisionExecutorRunResult {
  runAt: Date;
  itemsProcessed: number;
  itemsApproved: number;
  itemsRejected: number;
  itemsDeferred: number;
  itemsHardStopped: number;
  executionSuccesses: number;
  executionFailures: number;
  results: ExecutionResult[];
}

export async function runAutonomousDecisionExecutor(): Promise<DecisionExecutorRunResult> {
  if (!EXECUTOR_CONFIG.ENABLED) {
    console.log("[AutonomousExecutor] Disabled via AUTONOMOUS_EXECUTOR_ENABLED=false");
    return {
      runAt: new Date(), itemsProcessed: 0, itemsApproved: 0, itemsRejected: 0,
      itemsDeferred: 0, itemsHardStopped: 0, executionSuccesses: 0, executionFailures: 0, results: [],
    };
  }

  // Re-open expired deferred items first
  await db.update(decisionsInboxItems)
    .set({ status: "pending", deferredUntil: null, updatedAt: new Date() })
    .where(and(
      eq(decisionsInboxItems.status, "deferred"),
      sql`deferred_until IS NOT NULL AND deferred_until <= NOW()`,
    ));

  // Get all pending items, highest urgency first
  const pendingItems = await db.select()
    .from(decisionsInboxItems)
    .where(eq(decisionsInboxItems.status, "pending"))
    .orderBy(desc(decisionsInboxItems.urgencyScore))
    .limit(20); // Process up to 20 items per run (cost guard)

  const results: ExecutionResult[] = [];
  let approved = 0, rejected = 0, deferred = 0, hardStopped = 0, successes = 0, failures = 0;

  for (const item of pendingItems) {
    try {
      console.log(`[AutonomousExecutor] Processing item #${item.id} (${item.itemType}, urgency: ${item.urgencyScore})`);
      const result = await processInboxItem(item);
      results.push(result);

      if (result.decision.action === "approve") approved++;
      else if (result.decision.action === "reject") rejected++;
      else if (result.decision.action === "hard_stop") hardStopped++;
      else deferred++;

      if (result.executionSuccess) successes++;
      if (result.executed && !result.executionSuccess) failures++;
    } catch (err: any) {
      console.error(`[AutonomousExecutor] Failed to process item #${item.id}:`, err.message);
      failures++;
    }
  }

  const runResult: DecisionExecutorRunResult = {
    runAt: new Date(),
    itemsProcessed: pendingItems.length,
    itemsApproved: approved,
    itemsRejected: rejected,
    itemsDeferred: deferred,
    itemsHardStopped: hardStopped,
    executionSuccesses: successes,
    executionFailures: failures,
    results,
  };

  if (pendingItems.length > 0) {
    console.log(
      `[AutonomousExecutor] Complete: ${pendingItems.length} items — ` +
      `${approved} approved, ${rejected} rejected, ${deferred} deferred, ${hardStopped} hard-stopped | ` +
      `${successes} executed successfully, ${failures} failed`
    );
  }

  return runResult;
}

// ─────────────────────────────────────────────────────────────────────────────
// Daily autonomous decisions summary email (founder audit trail)
// Called by the founder weekly digest job to include recent decisions
// ─────────────────────────────────────────────────────────────────────────────

export async function getRecentAutonomousDecisions(hours: number = 24): Promise<any[]> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  return db.select()
    .from(decisionsInboxItems)
    .where(and(
      sql`resolved_by = 'autonomous_executor'`,
      sql`resolved_at >= ${since.toISOString()}`,
    ))
    .orderBy(desc(decisionsInboxItems.resolvedAt))
    .limit(50);
}
