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
import { routeAITask, routeCriticalTask, TaskComplexity } from "./aiRouter";

// ─────────────────────────────────────────────────────────────────────────────
// Cost-tier routing for inbox items (added 2026-05-25 — see commit log).
//
// Prior to this, every item flowing through the executor was sent to
// Opus 4.6 via routeCriticalTask("executive_decision", …). That was
// the platform's #1 AI cost driver — ~940 calls/day @ $30/day on a
// no-customer platform — because ~98% of items are routine agent
// housekeeping (initiatives, DLQ replays, agent recommendations)
// that don't need Opus-tier reasoning.
//
// The new policy: route by item_type + risk_level + estimated impact,
// not by a blanket label. Opus is reserved for items that genuinely
// touch money, legal exposure, or the customer surface. Everything
// else gets Haiku (MODERATE) or Sonnet (COMPLEX).
//
// Founder can still force a specific complexity via item.metadata.forceComplexity.
// ─────────────────────────────────────────────────────────────────────────────
function inferExecutorComplexity(item: {
  itemType: string;
  riskLevel: string;
  estimatedImpactCents: number | null;
  contextBundle?: Record<string, any> | null;
}): TaskComplexity {
  // Honor explicit override (e.g. founder marked an item "use Opus").
  // Lives in contextBundle since decisions_inbox_items has no metadata col.
  const forced = item.contextBundle?.forceComplexity;
  if (forced === "critical") return TaskComplexity.CRITICAL;
  if (forced === "complex") return TaskComplexity.COMPLEX;
  if (forced === "moderate") return TaskComplexity.MODERATE;
  if (forced === "simple") return TaskComplexity.SIMPLE;

  // Hard Opus triggers — these item types touch real-world consequences.
  const HARD_OPUS_TYPES = new Set([
    "capital_allocation",
    "refund_decision",
    "regulatory_filing",
    "legal_action",
    "customer_retention_at_risk_high_value",
    "security_incident_response",
  ]);
  if (HARD_OPUS_TYPES.has(item.itemType)) return TaskComplexity.CRITICAL;

  // Financial impact triggers — anything where a wrong call costs >$1k.
  const impactCents = item.estimatedImpactCents ?? 0;
  if (impactCents >= 100_000) return TaskComplexity.CRITICAL;   // ≥$1,000
  if (impactCents >= 10_000) return TaskComplexity.COMPLEX;     // $100-$1,000

  // Risk-level escalation for ambiguous types.
  if (item.riskLevel === "critical") return TaskComplexity.CRITICAL;

  // Per-itemType defaults — the 98% of routine work.
  switch (item.itemType) {
    case "dlq_poison_job":
      // Replaying dead-letter jobs — simple categorize-and-retry.
      return TaskComplexity.SIMPLE;
    case "agent_event":
      // Activity notifications — usually auto-approve.
      return TaskComplexity.SIMPLE;
    case "agent_initiative":
    case "agent_recommendation":
      // Agent-proposed work scored against priorities — Haiku is plenty.
      // Sonnet only when the risk_level signals it could matter more.
      return item.riskLevel === "high"
        ? TaskComplexity.COMPLEX
        : TaskComplexity.MODERATE;
    default:
      // Unknown item types lean conservative but never to Opus by default.
      return TaskComplexity.MODERATE;
  }
}

/**
 * Phase 2.3 — Reasoning Cascade.
 *
 * Routes the executor's LLM call through the Haiku→Sonnet→Opus
 * confidence cascade in intelligence/cascade.ts. Triage has already
 * decided that this item needs a model; the cascade now picks the
 * cheapest model that's confident enough at the item's stakes.
 *
 * `inferExecutorComplexity` is still used to pre-pin the tier when
 * the item type / impact warrants it (e.g. capital_allocation skips
 * straight to Opus); otherwise we let the cascade self-escalate.
 */
async function routeExecutorDecision(
  item: {
    itemType: string;
    riskLevel: string;
    estimatedImpactCents: number | null;
    contextBundle?: Record<string, any> | null;
  },
  systemPrompt: string,
  userPrompt: string,
) {
  const complexity = inferExecutorComplexity(item);
  // Pin the cascade when triage's tier inference says "this needs
  // Opus / Sonnet outright" — saves a wasted Haiku call on items we
  // know the cheap model can't handle.
  let forceTier: "haiku" | "sonnet" | "opus" | null = null;
  if (complexity === TaskComplexity.CRITICAL) forceTier = "opus";
  else if (complexity === TaskComplexity.COMPLEX) forceTier = "sonnet";

  const { cascade } = await import("./intelligence/cascade");
  const decision = await cascade({
    taskType: "executor_inbox_decision",
    systemPrompt,
    userPrompt,
    impactCents: item.estimatedImpactCents ?? 0,
    forceTier,
  });
  // Return an AIResponse-shaped object so existing callers can JSON-parse
  // the content as before. The downstream parser strips fences + extracts
  // {action, confidence, reasoning} — feed it our cascade's raw JSON.
  // Lens 46: also expose tiersTried + tierUsed + raw model JSON so the
  // caller can persist them into agent_action_log for trust-loop legibility.
  return {
    content: JSON.stringify({
      action: decision.action,
      confidence: decision.confidence,
      reasoning: `[tier:${decision.tierUsed}] ${decision.reasoning}`,
      // Surfaced for trust-loop legibility; ignored by the existing parser.
      alternativesConsidered:
        (decision.raw as any)?.alternativesConsidered ?? null,
    }),
    // Best-effort additional metadata; downstream code only reads .content.
    model: `cascade:${decision.tierUsed}`,
    raw: decision,
    tiersTried: decision.tiersTried,
    tierUsed: decision.tierUsed,
  };
}
import { getCrossWingContext } from "./companyMind";
import { emailService } from "./emailService";
import { format } from "date-fns";
import { companyAgentService } from "./companyAgents";
import { logger } from "../utils/logger";
import { AUTONOMOUS_SPEND_CEILING_CENTS } from "./financialAuthorityGate";

// ─────────────────────────────────────────────────────────────────────────────
// Configuration — all controlled via env vars (founder owns these, system cannot change)
// ─────────────────────────────────────────────────────────────────────────────

const EXECUTOR_CONFIG = {
  // Confidence threshold to auto-execute (0-100). Below this → defer 24h, then re-evaluate.
  AUTO_EXECUTE_THRESHOLD: parseInt(process.env.AUTONOMOUS_CONFIDENCE_THRESHOLD || "75"),

  // v11: Graduated financial authority replaces flat cap.
  // Tier 1: $0-$500 (single agent), Tier 2: $500-$2,500 (multi-agent), Tier 3: $2,500-$10K,
  // Tier 4: $10K-$50K (quorum), Tier 5: $50K+ (founder required).
  // The old flat MAX_FINANCIAL_IMPACT_CENTS is kept as Tier 5 hard stop.
  MAX_FINANCIAL_IMPACT_CENTS: parseInt(process.env.AUTONOMOUS_MAX_FINANCIAL_IMPACT || "5000000"), // $50,000 — Tier 5 hard stop
  GRADUATED_FINANCIAL_AUTHORITY_ENABLED: process.env.GRADUATED_FINANCIAL_AUTHORITY !== "false",

  // Hard-stop item types that NEVER auto-execute regardless of confidence.
  HARD_STOP_TYPES: (process.env.AUTONOMOUS_HARD_STOP_TYPES || "").split(",").filter(Boolean),

  // Whether executor is enabled (default: false — founder must opt in)
  // Previously defaulted to true, sending customer emails without approval
  ENABLED: process.env.AUTONOMOUS_EXECUTOR_ENABLED === "true",

  // Founder emails for daily summary
  FOUNDER_EMAILS: (process.env.FOUNDER_EMAIL || "").split(",").map(e => e.trim()).filter(Boolean),

  APP_URL: process.env.APP_URL || "https://app.acreos.io",
};

// ─────────────────────────────────────────────────────────────────────────────
// Financial-authority gate status routing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map a FinancialAuthorityGate.requestSpend() status onto an executor
 * disposition. The gate returns exactly one of:
 *   "approved"         — Tier 1 auto-approved, safe to execute
 *   "pending"          — Tier 2-4, multi-agent consensus record created but
 *                        NOT yet gathered
 *   "awaiting_founder" — Tier 5 (>$50K) founder hard stop
 *   "blocked"          — absolute hard-cap exceeded, no approval flow runs
 *   "expired"          — a pending request that aged out without consensus
 *
 * ONLY "approved" may execute. Everything else — including any future or
 * unrecognized status — fails safe. The prior executor branched on
 * "founder_required" / "pending_approval", statuses the gate never emits, so
 * every non-Tier-1 spend fell through to execution. This pure function is the
 * single source of truth for that mapping and is exhaustively unit-tested so
 * the mismatch cannot silently return.
 */
export type SpendGateDisposition = "execute" | "hard_stop" | "defer";
export function classifySpendGateStatus(status: string): SpendGateDisposition {
  if (status === "approved") return "execute";
  if (status === "awaiting_founder" || status === "blocked") return "hard_stop";
  // "pending", "expired", or anything unrecognized → defer, never execute.
  return "defer";
}

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
  // Lens 46 — alternatives the model weighed before choosing this action.
  // Captured into agent_action_log so the founder can retroactively endorse
  // or reject the reasoning, not just the outcome.
  alternativesConsidered?: Array<{
    action: string;
    rejectedBecause: string;
    confidence?: number;
  }>;
  // Cascade trail — which model tiers were tried before answering.
  tiersTried?: Array<"haiku" | "sonnet" | "opus">;
  modelUsed?: string;
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
AcreOS serves real estate professionals who buy/sell rural land using seller-financed notes. Key workflows: lead sourcing, deal analysis, note servicing, CRM, marketplace. Customers pay $99-$999/mo.

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
  "executionNotes": "what should be logged as the action taken",
  "alternativesConsidered": [
    { "action": "the other option you weighed", "rejectedBecause": "why you didn't pick it", "confidence": 0-100 }
  ]
}

Always populate alternativesConsidered with 1-3 plausible alternative actions you weighed. The founder reviews these to spot blind spots — listing only the action you chose makes it impossible to retroactively endorse your reasoning.

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
${messages.map(m => `[${m.agentName ?? m.role}]: ${m.content}`).join("\n\n")}

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
Alert Description: ${alert?.message ?? "No details"}
Alert Severity: ${alert?.severity ?? "critical"}
Alert Category: ${alert?.alertType ?? "unknown"}
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

  // Stage-4 turn 10: through the canonical writer. The old inline insert
  // wrote senderId/senderName/messageType/isInternal behind `as any` — none
  // of those columns exist, NOT NULL `role` went unfilled, and every insert
  // THREW: this approval flow has never successfully posted a reply.
  if (!item.organizationId) return { success: false, detail: "No organization ID in item" };
  const { postAgentSupportReply } = await import("./customerComms/supportReply");
  const result = await postAgentSupportReply({
    ticketId: item.sourceTicketId,
    organizationId: item.organizationId,
    content: decision.draftResponse,
    agentName: "AcreOS Support (AI)",
    resolveTicket: true,
  });
  return result.posted
    ? { success: true, detail: `Ticket #${item.sourceTicketId} resolved with AI response (${decision.draftResponse.length} chars)` }
    : { success: false, detail: result.detail };
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
    await emailService.sendEmail({
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
// Hard guardrails — code-level blocks checked BEFORE AI is consulted
// ─────────────────────────────────────────────────────────────────────────────

// The >$500 founder hard stop, imported rather than retyped.
//
// This was its own `50_000` literal, making it the THIRD independent copy of
// one constitutional boundary — alongside financialAuthorityGate's Tier 1
// ceiling and Tier 2 floor. The constitution's own note calls these "two
// independent enforcements", which is the argument FOR sharing the number: two
// enforcements of one rule are a safety property, two spellings of one number
// are a drift waiting to happen. financialAuthorityGate.ts is the owner.
const HARD_GUARDRAIL_AMOUNT_LIMIT = AUTONOMOUS_SPEND_CEILING_CENTS; // cents ($500)
const HARD_GUARDRAIL_RECIPIENT_LIMIT = 100;

const BILLING_SUBSCRIPTION_ACTIONS = [
  "billing_modification",
  "subscription_change",
  "plan_upgrade",
  "plan_downgrade",
  "pricing_change",
  "payment_method_update",
  "invoice_adjustment",
  "subscription_cancel",
];

const DATA_DELETION_ACTIONS = [
  "data_deletion",
  "bulk_delete",
  "account_deletion",
  "record_purge",
  "permanent_delete",
];

const LEGAL_SIGNING_ACTIONS = [
  "legal_signing",
  "contract_execute",
  "contract_sign",
  "document_sign",
  "esign",
  "envelope_send",
  "agreement_execute",
];

// ─── Hard-stop intent classifier (unit 118) ─────────────────────────────────
//
// The lists above used to be the WHOLE enforcement, matched with
// `actionType.includes(t)` — a substring deny-list guarding a rule the
// constitution states as "NEVER autonomous, forever". An enforcement audit
// bypassed all four hard-stops with trivially varied strings: `execute_agreement`
// (word order), `countersign`, `gdpr_erasure`, `discount_apply`, `promo_code_create`,
// `credit_grant`, `trial_extend`, `comp_account`, `waive_fee`, `set_price` — every
// one returned blocked:false while the constitution's registry cited this very
// function as the enforcement for pricing, legal-signing, data-deletion and
// money-custody hard-stops.
//
// A deny-list of exact strings can never enforce a "never" — the attacker (or
// merely the next well-meaning agent) picks the string. This classifier matches
// INTENT TOKENS instead: the action/category/item strings are split on
// underscores, dashes and camelCase, and a category blocks on either a
// single-token trigger (`countersign`, `gdpr`, `purge`) or a noun+verb pair
// (`agreement` + `execute`, in either order). The exact-string lists above are
// kept as fast paths with better messages.
//
// DIRECTION OF ERROR, chosen deliberately: a false BLOCK routes an action to
// founder review (status "deferred") — mild friction. A false PASS executes a
// hard-stop-class action autonomously — the thing the constitution forbids
// forever. So collisions err closed: `payment_reminder_send` defers to the
// founder even though a reminder is benign, because "payment"+"send" is not a
// pattern this executor should wave through on its own authority. (The
// legitimate dunning path runs as itemType "dunning_recovery", which carries
// none of these tokens.)
//
// STATED LIMIT: a purely novel euphemism ("tidy_documents" meaning erasure) can
// still pass — token classification is not semantics. The payload bulk-scope
// rule below narrows that (destructive verb + "all_leads"-shaped scope blocks
// regardless of noun), and the execution switch no longer fabricates success
// for unknown item types, so a euphemism that slips through executes nothing
// and is recorded as unexecuted.

function intentTokens(...parts: Array<string | null | undefined>): Set<string> {
  const out = new Set<string>();
  for (const p of parts) {
    if (!p) continue;
    for (const t of String(p)
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .split(/[^a-z0-9]+/)) {
      if (t) out.add(t);
    }
  }
  return out;
}

interface HardStopIntent {
  name: string;
  /** Any single token blocks on its own. */
  singles: string[];
  /** One noun AND one verb, in any order, block together. */
  nouns: string[];
  verbs: string[];
  reason: string;
}

const HARD_STOP_INTENTS: HardStopIntent[] = [
  {
    name: "billing/pricing",
    singles: ["pricing", "reprice", "repricing", "discount", "discounts", "promo", "promos", "coupon", "coupons", "chargeback", "refund", "refunds", "waive", "waiver"],
    nouns: ["price", "prices", "tier", "tiers", "plan", "plans", "subscription", "subscriptions", "billing", "invoice", "invoices", "allowance", "allowances", "quota", "quotas", "seat", "seats", "trial", "trials", "fee", "fees", "credit", "credits", "rate", "rates", "account"],
    verbs: ["change", "modify", "update", "set", "adjust", "apply", "create", "grant", "upgrade", "downgrade", "cancel", "extend", "bump", "raise", "increase", "decrease", "lower", "override", "waive", "comp", "issue", "revoke"],
    reason: "billing/pricing change — pricing is a founder-only hard stop",
  },
  {
    name: "data deletion",
    singles: ["delete", "deletes", "deletion", "deletions", "erase", "erasure", "purge", "purges", "wipe", "wipes", "truncate", "destroy", "expunge", "shred", "forgotten", "anonymize", "anonymise", "gdpr", "ccpa"],
    nouns: ["record", "records", "data", "account", "accounts", "org", "orgs", "organization", "organizations", "lead", "leads", "customer", "customers", "table", "tables", "row", "rows"],
    verbs: ["remove", "drop", "clear", "prune", "scrub", "clean", "cleanup"],
    reason: "customer-data deletion — a founder-only hard stop",
  },
  {
    name: "legal signing",
    singles: ["sign", "signing", "signed", "signature", "signatures", "esign", "countersign", "notarize", "notarization", "loi", "docusign"],
    nouns: ["contract", "contracts", "agreement", "agreements", "envelope", "envelopes", "document", "documents", "terms", "addendum", "lease", "deed"],
    verbs: ["execute", "send", "accept", "bind", "countersign", "finalize", "ratify", "deliver"],
    reason: "legally binding act — legal signing is founder-only forever",
  },
  {
    name: "money movement",
    singles: ["payout", "payouts", "disburse", "disbursement", "disbursements", "wire", "ach", "remit", "remittance"],
    nouns: ["payment", "payments", "funds", "money", "balance", "escrow"],
    verbs: ["transfer", "send", "move", "initiate", "execute", "release", "capture", "charge"],
    reason: "money movement — customer money never moves autonomously",
  },
];

function classifyHardStopIntent(tokens: Set<string>): HardStopIntent | null {
  for (const intent of HARD_STOP_INTENTS) {
    if (intent.singles.some((t) => tokens.has(t))) return intent;
    const noun = intent.nouns.some((t) => tokens.has(t));
    const verb = intent.verbs.some((t) => tokens.has(t));
    if (noun && verb) return intent;
  }
  return null;
}

/** Destructive verb + an "all X"-shaped scope anywhere in the payload. */
const BULK_SCOPE_RE = /"(?:all|entire|every)[_ ]?(?:leads|customers|records|orgs|organizations|accounts|data|notes|deals|properties)"/;
const DESTRUCTIVE_VERB_TOKENS = ["remove", "archive", "clear", "prune", "clean", "cleanup", "scrub", "drop", "delete", "purge", "wipe"];

export function checkHardGuardrails(action: {
  itemType?: string;
  actionPayload?: Record<string, any>;
}): { blocked: boolean; reason: string } {
  const payload = action.actionPayload ?? {};

  // 1. Financial amount exceeds hard limit
  if (typeof payload.amount === "number" && payload.amount > HARD_GUARDRAIL_AMOUNT_LIMIT) {
    return {
      blocked: true,
      reason: `Hard block: actionPayload.amount (${payload.amount}) exceeds hard limit of ${HARD_GUARDRAIL_AMOUNT_LIMIT} cents ($${(HARD_GUARDRAIL_AMOUNT_LIMIT / 100).toFixed(0)}). Requires founder approval.`,
    };
  }

  // 2. Recipient count exceeds hard limit
  if (Array.isArray(payload.recipients) && payload.recipients.length > HARD_GUARDRAIL_RECIPIENT_LIMIT) {
    return {
      blocked: true,
      reason: `Hard block: recipients list (${payload.recipients.length}) exceeds hard limit of ${HARD_GUARDRAIL_RECIPIENT_LIMIT}. Mass actions require founder approval.`,
    };
  }

  // 3. Billing/subscription modification
  const actionType = (payload.actionType ?? action.itemType ?? "").toLowerCase();
  if (BILLING_SUBSCRIPTION_ACTIONS.some((t) => actionType.includes(t) || (payload.category ?? "").toLowerCase().includes(t))) {
    return {
      blocked: true,
      reason: `Hard block: billing/subscription modification detected (${actionType}). All billing changes require founder approval.`,
    };
  }

  // 4. Data deletion
  if (DATA_DELETION_ACTIONS.some((t) => actionType.includes(t) || (payload.category ?? "").toLowerCase().includes(t))) {
    return {
      blocked: true,
      reason: `Hard block: data deletion action detected (${actionType}). All data deletions require founder approval.`,
    };
  }

  // 5. Legal signing / contract execution — "legal signing is founder-only forever"
  if (LEGAL_SIGNING_ACTIONS.some((t) => actionType.includes(t) || (payload.category ?? "").toLowerCase().includes(t))) {
    return {
      blocked: true,
      reason: `Hard block: legal signing/contract execution detected (${actionType}). All legally binding acts require the founder.`,
    };
  }

  // Also check for delete-related flags in the payload itself
  if (payload.delete === true || payload.permanent === true || payload.purge === true) {
    return {
      blocked: true,
      reason: `Hard block: destructive action flag detected in payload (delete/permanent/purge). Requires founder approval.`,
    };
  }

  // Also check for signing/execution flags in the payload itself
  if (payload.sign === true || payload.execute_contract === true) {
    return {
      blocked: true,
      reason: `Hard block: legal signing/contract execution detected (payload flag sign/execute_contract). All legally binding acts require the founder.`,
    };
  }

  // 6. Token-level intent classification — the fail-closed layer (unit 118).
  // The exact-string checks above are fast paths; this is the enforcement.
  const tokens = intentTokens(
    payload.actionType,
    action.itemType,
    payload.category,
    payload.action,
    payload.operation,
  );
  const intent = classifyHardStopIntent(tokens);
  if (intent) {
    return {
      blocked: true,
      reason: `Hard block: ${intent.reason} (matched intent "${intent.name}" in "${payload.actionType ?? action.itemType ?? ""}"). Requires founder approval.`,
    };
  }

  // 7. Bulk destructive scope: a destructive verb anywhere in the action tokens
  // plus an "all_<entities>"-shaped scope anywhere in the payload. Catches
  // `archive_and_remove` + scope:"all_leads", which names no protected noun in
  // its action type.
  if (
    DESTRUCTIVE_VERB_TOKENS.some((t) => tokens.has(t)) &&
    BULK_SCOPE_RE.test(JSON.stringify(payload).toLowerCase())
  ) {
    return {
      blocked: true,
      reason: `Hard block: destructive action with an all-records scope. Bulk destructive operations against customer data are a founder-only hard stop.`,
    };
  }

  return { blocked: false, reason: "" };
}

// ─────────────────────────────────────────────────────────────────────────────
// Core executor — processes a single inbox item
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pillar R — capture a pre-merge telemetry snapshot for the post-merge
 * retract cron to compare against. Numbers are tiny (counts over the
 * trailing 24h); the cron in agentRetractCron.ts reads agentProposalObservations
 * and compares this baseline to the current snapshot each day.
 *
 * Kept intentionally minimal: error rate, recent job failures. More
 * sophisticated signals (route-sweep pass rate, customer health delta,
 * Pax quality) can be added without changing the schema since the field
 * is jsonb.
 */
async function captureTelemetryBaseline(): Promise<Record<string, number>> {
  try {
    const { auditEvents, jobHealthLogs, customerHealthScores, supportCases } = await import("@shared/schema");
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [errorRow] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(auditEvents)
      .where(
        and(
          sql`${auditEvents.action} LIKE '%error%'`,
          sql`${auditEvents.createdAt} >= ${dayAgo}`,
        ),
      );
    const [jobFailRow] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(jobHealthLogs)
      .where(
        and(
          sql`${jobHealthLogs.status} != 'success'`,
          sql`${jobHealthLogs.runStartedAt} >= ${dayAgo}`,
        ),
      );
    // Customer-outcome baseline (paired with agentRetractCron's regression
    // check on the same signals).
    const [healthRow] = await db
      .select({ avg: sql<number>`coalesce(avg(${customerHealthScores.score})::float, 0)` })
      .from(customerHealthScores)
      .where(sql`${customerHealthScores.calculatedAt} >= ${dayAgo}`);
    const [escalatedRow] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(supportCases)
      .where(
        and(
          sql`${supportCases.escalatedAt} >= ${dayAgo}`,
          sql`${supportCases.escalatedAt} IS NOT NULL`,
        ),
      );
    return {
      errors24h: Number(errorRow?.c ?? 0),
      jobFailures24h: Number(jobFailRow?.c ?? 0),
      customerHealthAvg: Number(healthRow?.avg ?? 0),
      supportEscalations24h: Number(escalatedRow?.c ?? 0),
      capturedAtMs: Date.now(),
    };
  } catch {
    return { capturedAtMs: Date.now() };
  }
}

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

  // ── Pax pause kill-switch (Workstream A honesty) ────────────────────────
  // pax.pausedUntil (written by /settings/pax, org-level semantics — see
  // server/services/paxPause.ts) pauses ALL autonomous action for the org.
  // Org-scoped items are deferred until the pause lifts, with the skip
  // reason logged — never silently. Checked BEFORE triage/LLM/execution so
  // a paused org's item can neither auto-approve nor auto-execute.
  if (item.organizationId != null) {
    const { getPaxPauseState } = await import("./paxPause");
    const pause = await getPaxPauseState(item.organizationId);
    if (pause.paused) {
      const resumeAt =
        pause.pausedUntil ?? new Date(Date.now() + 4 * 60 * 60 * 1000);
      result.decision = {
        action: "defer",
        confidence: 100,
        reasoning: pause.checkFailed
          ? `Pax pause state for org #${item.organizationId} could not be verified — failing closed and deferring.`
          : `Pax is paused for org #${item.organizationId} until ${pause.pausedUntil!.toISOString()} (pax.pausedUntil kill switch). Deferred until the pause lifts.`,
      };
      result.executedAction = "skipped_pax_paused";
      result.executionSuccess = true;
      await db
        .update(decisionsInboxItems)
        .set({ status: "deferred", deferredUntil: resumeAt, updatedAt: new Date() })
        .where(eq(decisionsInboxItems.id, item.id));
      logger.info(
        `[AutonomousExecutor] Skipping item #${item.id} — Pax is paused for org ${item.organizationId}` +
          (pause.checkFailed
            ? " (pause-state read failed; failing closed)"
            : ` until ${pause.pausedUntil!.toISOString()}`),
      );
      return result;
    }
  }

  // ── Agent Attribution (Sovereign Company Protocol) ──
  const ownerAgent = companyAgentService.getOwnerForDecisionType(item.itemType);
  if (ownerAgent && !item.ownerAgentCodename) {
    try {
      await db.update(decisionsInboxItems)
        .set({ ownerAgentCodename: ownerAgent })
        .where(eq(decisionsInboxItems.id, item.id));
    } catch {}
  }

  // ── Frugal Autonomy: rule-based triage gate ─────────────────────────────────
  // Most inbox items can be resolved without consulting an LLM. The triage
  // engine returns auto-approve / auto-reject / auto-defer for ~60-80% of
  // items; only "escalate-to-llm" outcomes fall through to the cascade below.
  // This is the single biggest lever for keeping AI cost in line with real
  // intelligence demand.
  try {
    const { triageWithLog } = await import("./intelligence/triage");
    const triageDecision = triageWithLog({
      id: item.id,
      itemType: item.itemType,
      riskLevel: item.riskLevel ?? "medium",
      urgencyScore: item.urgencyScore ?? 50,
      estimatedImpactCents: item.estimatedImpactCents ?? null,
      ownerAgentCodename: item.ownerAgentCodename ?? null,
      recommendedAction: item.recommendedAction ?? "",
      contextBundle: item.contextBundle ?? null,
      actionPayload: item.actionPayload ?? null,
    });

    if (triageDecision.kind === "auto-approve") {
      result.decision = {
        action: "approve",
        confidence: triageDecision.confidence,
        reasoning: `Triage auto-approve: ${triageDecision.reason}`,
      };
      result.executedAction = "auto_approved_via_triage";
      result.executionSuccess = true;
      await db.update(decisionsInboxItems)
        .set({
          status: "approved",
          resolvedAt: new Date(),
          resolvedBy: "intelligence/triage",
          updatedAt: new Date(),
        })
        .where(eq(decisionsInboxItems.id, item.id));
      return result;
    }
    if (triageDecision.kind === "auto-reject") {
      result.decision = {
        action: "reject",
        confidence: triageDecision.confidence,
        reasoning: `Triage auto-reject: ${triageDecision.reason}`,
      };
      result.executedAction = "auto_rejected_via_triage";
      result.executionSuccess = true;
      await db.update(decisionsInboxItems)
        .set({
          status: "rejected",
          resolvedAt: new Date(),
          resolvedBy: "intelligence/triage",
          updatedAt: new Date(),
        })
        .where(eq(decisionsInboxItems.id, item.id));
      return result;
    }
    if (triageDecision.kind === "auto-defer") {
      result.decision = {
        action: "defer",
        confidence: 60,
        reasoning: `Triage auto-defer: ${triageDecision.reason}`,
      };
      result.executedAction = "auto_deferred_via_triage";
      result.executionSuccess = true;
      const until = new Date(Date.now() + triageDecision.deferMinutes * 60_000);
      await db.update(decisionsInboxItems)
        .set({ status: "deferred", deferredUntil: until, updatedAt: new Date() })
        .where(eq(decisionsInboxItems.id, item.id));
      return result;
    }
    // Else: kind === "escalate-to-llm" — fall through to the cascade.
  } catch (err) {
    logger.warn("[AutonomousExecutor] triage failed — falling through to LLM", {
      itemId: item.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // v11: Graduated financial authority — route through tiered approval system
  const impactCents = item.estimatedImpactCents ?? 0;
  if (impactCents > 0 && EXECUTOR_CONFIG.GRADUATED_FINANCIAL_AUTHORITY_ENABLED) {
    try {
      const { financialAuthorityGate } = await import("./financialAuthorityGate");
      const spendResult = await financialAuthorityGate.requestSpend(
        ownerAgent || "atlas_cto",
        impactCents,
        `Autonomous decision: ${item.itemType} (item #${item.id})`,
        item.itemType
      );
      // Route on the gate's ACTUAL status. Only "approved" may execute; every
      // other status fails safe. The prior code branched on "founder_required"
      // and "pending_approval" — statuses the gate NEVER returns — so every
      // non-Tier-1 result fell through to execution, letting $500-$50K spends
      // fire before consensus and even hard-cap-blocked spends go through.
      const disposition = classifySpendGateStatus(spendResult.status);
      if (disposition === "hard_stop") {
        result.decision = {
          action: "hard_stop",
          confidence: 100,
          reasoning: spendResult.status === "blocked"
            ? `Financial impact $${(impactCents / 100).toFixed(2)} exceeds the absolute hard cap. ${spendResult.message} Founder decision required.`
            : `Financial impact $${(impactCents / 100).toFixed(2)} is Tier 5 (>$50K). Requires founder approval.`,
        };
        result.executedAction = spendResult.status === "blocked" ? "hard_stop_hard_cap" : "hard_stop_deferred_tier5";
        result.executionSuccess = true;
        result.executed = false;
        await db.update(decisionsInboxItems)
          .set({ status: "deferred", deferredUntil: new Date(Date.now() + 72 * 60 * 60 * 1000), updatedAt: new Date() })
          .where(eq(decisionsInboxItems.id, item.id));
        return result;
      }
      if (disposition === "defer") {
        // "pending" (Tier 2-4 awaiting consensus), "expired", or any
        // unrecognized status: the spend has NOT been approved, so executing
        // it now would bypass the gate entirely. Defer instead.
        result.decision = {
          action: "defer",
          confidence: 80,
          reasoning: `Financial impact $${(impactCents / 100).toFixed(2)} is Tier ${spendResult.tier} and not yet approved (gate status "${spendResult.status}"). Approval request ${spendResult.requestId} created; execution withheld until consensus is reached.`,
        };
        result.executedAction = `deferred_multi_agent_approval_tier${spendResult.tier}`;
        result.executionSuccess = true;
        result.executed = false;
        await db.update(decisionsInboxItems)
          .set({ status: "deferred", deferredUntil: new Date(Date.now() + 4 * 60 * 60 * 1000), updatedAt: new Date() })
          .where(eq(decisionsInboxItems.id, item.id));
        return result;
      }
      // disposition === "execute" (status === "approved") — proceed
    } catch {
      // Fallback to legacy flat cap if graduated authority fails
    }
  }

  // Legacy hard stop: financial impact above absolute threshold (Tier 5 fallback).
  // Reads the live founder-settings value so the founder can raise/lower
  // the per-decision cap without a deploy.
  const { getNumberSetting } = await import("./founderSettings");
  const maxImpactCents = await getNumberSetting(
    "MAX_FINANCIAL_IMPACT_CENTS",
    EXECUTOR_CONFIG.MAX_FINANCIAL_IMPACT_CENTS,
  );
  if (impactCents > maxImpactCents) {
    result.decision = {
      action: "hard_stop",
      confidence: 100,
      reasoning: `Financial impact $${(impactCents / 100).toFixed(2)} exceeds autonomous execution limit of $${(maxImpactCents / 100).toFixed(2)}. Requires founder review.`,
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

  // Hard guardrails — code-level blocks checked BEFORE AI is consulted
  const guardrailCheck = checkHardGuardrails({
    itemType: item.itemType,
    actionPayload: item.actionPayload,
  });
  if (guardrailCheck.blocked) {
    result.decision = {
      action: "hard_stop",
      confidence: 100,
      reasoning: guardrailCheck.reason,
    };
    result.executedAction = "hard_guardrail_blocked";
    result.executionSuccess = true;
    result.executed = false;

    await db.update(decisionsInboxItems)
      .set({
        status: "deferred",
        deferredUntil: new Date(Date.now() + 72 * 60 * 60 * 1000),
        updatedAt: new Date(),
      })
      .where(eq(decisionsInboxItems.id, item.id));

    logger.info(`[AutonomousExecutor] Hard guardrail blocked item #${item.id}: ${guardrailCheck.reason}`);
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

  // Prepend cross-wing context so the agent decides with a company
  // view rather than a siloed one. Cheap additional tokens (~$0.0015)
  // that materially reduce founder-override risk.
  const crossWing = await getCrossWingContext({
    agentCodename: item.ownerAgentCodename ?? "executor",
    itemType: item.itemType,
    organizationId: item.organizationId ?? null,
  });

  // Consult the experiments registry. If any running experiment is
  // hooked into this itemType, the org gets assigned a variant
  // (deterministic by hash) and the variant config is spliced into
  // the LLM context so the agent's reasoning is variant-aware. The
  // variant assignment is stamped into contextBundle for traceability
  // and for the outcome grader to pair back with the experiment.
  let experimentContext = "";
  if (item.organizationId != null) {
    try {
      const { assignVariant } = await import("./decisionExperiments");
      const assigned = await assignVariant(item.itemType, item.organizationId);
      if (assigned) {
        experimentContext = `ACTIVE EXPERIMENT VARIANT: "${assigned.variantKey}"\nFollow variant config: ${JSON.stringify(assigned.config)}\n`;
        // Stamp the assignment on the decision for later pairing.
        await db
          .update(decisionsInboxItems)
          .set({
            contextBundle: {
              ...(item.contextBundle as Record<string, any> ?? {}),
              experimentId: assigned.experimentId,
              experimentVariant: assigned.variantKey,
            },
            updatedAt: new Date(),
          })
          .where(eq(decisionsInboxItems.id, item.id));
      }
    } catch {
      // experiments are best-effort — never block a decision on them
    }
  }

  const contextWithMind = [crossWing, experimentContext, context]
    .filter(Boolean)
    .join("\n\n---\n\n");

  // Tier-route the model by item type + risk + impact through the
  // reasoning cascade. Most items resolve at Haiku; Sonnet/Opus only
  // fire when confidence is low at the cheaper tier AND stakes warrant.
  let aiDecision: ExecutionDecision;
  try {
    const aiResponse = await routeExecutorDecision(
      item,
      EXECUTOR_SYSTEM_PROMPT,
      contextWithMind,
    );

    const parsed = JSON.parse(aiResponse.content.replace(/```json\n?|```/g, "").trim());
    aiDecision = {
      action: parsed.action || "defer",
      confidence: Math.max(0, Math.min(100, parseInt(parsed.confidence) || 0)),
      reasoning: parsed.reasoning || "No reasoning provided",
      draftResponse: parsed.draftResponse,
      retentionMessage: parsed.retentionMessage,
      executionNotes: parsed.executionNotes,
      // Lens 46 — capture the legibility fields for the audit/explain endpoint.
      alternativesConsidered: Array.isArray(parsed.alternativesConsidered)
        ? parsed.alternativesConsidered
        : undefined,
      tiersTried: (aiResponse as any).tiersTried,
      modelUsed: aiResponse.model,
    };
  } catch (err: any) {
    // Budget exhausted for today — defer the item to the start of
    // tomorrow (UTC) so it gets picked back up under the fresh cap.
    if (err?.name === "BudgetExceededError") {
      const tomorrowMidnightUtc = new Date();
      tomorrowMidnightUtc.setUTCHours(24, 0, 0, 0);
      result.decision = {
        action: "defer",
        confidence: 100,
        reasoning: `AI budget exhausted (category=${err.category}, cap=${err.capCents}¢, spent=${err.spentCents}¢). Deferred until 00:00 UTC.`,
      };
      result.executedAction = "deferred_budget_exhausted";
      result.executionSuccess = true;
      await db.update(decisionsInboxItems)
        .set({ status: "deferred", deferredUntil: tomorrowMidnightUtc, updatedAt: new Date() })
        .where(eq(decisionsInboxItems.id, item.id));
      return result;
    }
    // Any other AI failure — defer safely for 4h.
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

  // Below confidence threshold → defer 24 hours. Threshold is founder-tunable
  // via /founder/settings (AUTO_EXECUTE_THRESHOLD) so the founder can raise
  // it if the calibration report flags overconfidence.
  //
  // Pillar R — trust-graduation override. Before applying the static
  // threshold, consult the (agent, action_category) graduation tier:
  //   - silent: bypass threshold entirely (proven category)
  //   - notify_only: bypass threshold; surface as one-line in digest
  //   - suspended: force defer regardless of confidence
  //   - manual: fall through to the threshold check below
  // Once Pillar R earns trust in a category, the static threshold stops
  // being load-bearing and trust calibration takes over.
  const autoExecuteThreshold = await getNumberSetting(
    "AUTO_EXECUTE_THRESHOLD",
    EXECUTOR_CONFIG.AUTO_EXECUTE_THRESHOLD,
  );

  let graduationTier: string = "manual";
  try {
    const { shouldAutoExecute } = await import("./trustGraduation");
    const decision = await shouldAutoExecute(
      ownerAgent ?? "executor",
      item.itemType,
    );
    graduationTier = decision.tier;

    if (decision.tier === "suspended") {
      await db.update(decisionsInboxItems)
        .set({
          status: "deferred",
          deferredUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          updatedAt: new Date(),
        })
        .where(eq(decisionsInboxItems.id, item.id));
      result.executedAction = `deferred_suspended (agent=${ownerAgent} category=${item.itemType})`;
      result.executionSuccess = true;
      return result;
    }

    // Silent / notify_only categories bypass the confidence threshold.
    // They've earned the trust to act on lower-confidence calls without
    // founder approval. Hard-stops still apply (line 395+).
    if (decision.tier === "silent" || decision.tier === "notify_only") {
      // No-op: fall through to execution.
    } else if (aiDecision.confidence < autoExecuteThreshold) {
      await db.update(decisionsInboxItems)
        .set({
          status: "deferred",
          deferredUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
          updatedAt: new Date(),
        })
        .where(eq(decisionsInboxItems.id, item.id));
      result.executedAction = `deferred_low_confidence (${aiDecision.confidence}% < ${autoExecuteThreshold}% threshold, tier=${decision.tier})`;
      result.executionSuccess = true;
      return result;
    }
  } catch (err) {
    // Trust graduation read failed — fall back to the static threshold.
    logger.warn("[autonomous-executor] trust graduation read failed; falling back to static threshold", err as Error);
    if (aiDecision.confidence < autoExecuteThreshold) {
      await db.update(decisionsInboxItems)
        .set({
          status: "deferred",
          deferredUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
          updatedAt: new Date(),
        })
        .where(eq(decisionsInboxItems.id, item.id));
      result.executedAction = `deferred_low_confidence (${aiDecision.confidence}% < ${autoExecuteThreshold}% threshold)`;
      result.executionSuccess = true;
      return result;
    }
  }

  // Execute the action
  if (aiDecision.action === "approve") {
    let execResult: { success: boolean; detail: string } = { success: false, detail: "Unknown item type" };

    // Open an action preview — writes a record of what's about to
    // happen and waits ACTION_PREVIEW_WINDOW_SECONDS (founder setting,
    // default 0) for a founder cancellation.
    const { beginActionPreview } = await import("./actionPreview");
    const preview = await beginActionPreview({
      decisionId: item.id,
      agentCodename: item.ownerAgentCodename ?? "executor",
      itemType: item.itemType,
      actionSummary: item.recommendedActionLabel,
      actionReasoning: aiDecision.reasoning,
      actionPayload: (item.actionPayload as Record<string, any>) ?? null,
      estimatedImpactCents: item.estimatedImpactCents ?? null,
      confidence: aiDecision.confidence,
    });

    if (!(await preview.shouldProceed())) {
      // Founder cancelled during the preview window.
      await preview.recordResult("failed", "cancelled by founder");
      await db.update(decisionsInboxItems)
        .set({
          status: "deferred",
          deferredUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
          updatedAt: new Date(),
        })
        .where(eq(decisionsInboxItems.id, item.id));
      result.executed = false;
      result.executionSuccess = true;
      result.executedAction = "cancelled_by_founder_preview";
      return result;
    }

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
          // Refuse-not-fabricate (unit 118). This used to return success:true
          // with a generic-approval detail string — a "committed" preview record and an audit
          // row for an action NOTHING executed. An unknown item type reaching
          // an approved state must be recorded as NOT run, or the audit trail
          // manufactures activity — the defect class the no-fabrication
          // hard-stop exists for.
          execResult = {
            success: false,
            detail: `No executor is registered for item type "${item.itemType}" — nothing was executed. The approval is recorded, the action is not.`,
          };
      }
    } catch (err: any) {
      execResult = { success: false, detail: err.message };
    }

    await preview.recordResult(
      execResult.success ? "committed" : "failed",
      execResult.detail,
    );

    result.executed = true;
    result.executionSuccess = execResult.success;
    result.executedAction = execResult.detail;

    if (execResult.success) {
      // Lens 46 — record the resolving action in agent_action_log with the
      // full trust-loop legibility shape so /audit-log/explain can rebuild
      // the decision trail later. Best-effort; never block the user-facing
      // resolution path on the audit write.
      let actionLogId: number | undefined;
      try {
        const { agentActionLog } = await import("@shared/schema");
        const [logged] = await db
          .insert(agentActionLog)
          .values({
            agentCodename: ownerAgent ?? "autonomous_executor",
            actionType: "decision",
            actionName: item.itemType,
            input: { itemId: item.id, contextBundle: item.contextBundle ?? null },
            output: { detail: execResult.detail, executedAction: result.executedAction },
            reasoning: aiDecision.reasoning,
            confidence: aiDecision.confidence,
            outcome: "success",
            relatedDecisionId: item.id,
            alternativesConsidered: aiDecision.alternativesConsidered ?? null,
            tiersTried: aiDecision.tiersTried ?? null,
            modelUsed: aiDecision.modelUsed ?? null,
            correlationId: `inbox-${item.id}`,
          })
          .returning({ id: agentActionLog.id });
        actionLogId = logged?.id;
      } catch (err) {
        logger.warn("[autonomous-executor] action_log insert failed (non-blocking)", err as Error);
      }

      await db.update(decisionsInboxItems)
        .set({
          status: "approved",
          resolvedAt: new Date(),
          resolvedBy: "autonomous_executor",
          resolvedByActionLogId: actionLogId ?? null,
          founderOverrideAction: `[AUTO] ${aiDecision.reasoning.slice(0, 200)}`,
          contextBundle: {
            ...(item.contextBundle as Record<string, any> ?? {}),
            executorConfidence: aiDecision.confidence,
            executorAction: aiDecision.action,
            graduationTier,
          },
          updatedAt: new Date(),
        })
        .where(eq(decisionsInboxItems.id, item.id));

      // Pillar R — open a 7-day observation window + bump the streak.
      // The retract cron walks observations daily; if telemetry regresses
      // it calls recordRetract() which demotes the tier.
      try {
        const { agentProposalObservations } = await import("@shared/schema");
        const { recordAcceptance } = await import("./trustGraduation");
        const observationEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        await db.insert(agentProposalObservations).values({
          agentCodename: ownerAgent ?? "executor",
          actionCategory: item.itemType,
          shippedRef: String(item.id),
          shippedRefType: "decision_id",
          shippedAt: new Date(),
          observationEndsAt: observationEnd,
          telemetryBaseline: await captureTelemetryBaseline(),
          status: "observing",
        });
        await recordAcceptance(ownerAgent ?? "executor", item.itemType);
      } catch (err) {
        logger.warn("[autonomous-executor] failed to open observation window", err as Error);
      }
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

  // ── Update owning agent metrics (Sovereign Company Protocol) ──
  if (ownerAgent) {
    try {
      await companyAgentService.recordActivity(ownerAgent);
      const isCorrect = result.executionSuccess && aiDecision.action !== "defer";
      if (isCorrect) {
        const agent = await companyAgentService.getByCodename(ownerAgent);
        const currentMetrics = (agent?.metrics as any) || { decisionsTotal: 0, decisionsCorrect: 0, escalationsCount: 0, avgConfidence: 0, lastWeekActions: 0 };
        await companyAgentService.updateMetrics(ownerAgent, {
          decisionsTotal: (currentMetrics.decisionsTotal || 0) + 1,
          decisionsCorrect: (currentMetrics.decisionsCorrect || 0) + (result.executionSuccess ? 1 : 0),
          avgConfidence: Math.round(((currentMetrics.avgConfidence || 0) * (currentMetrics.decisionsTotal || 0) + aiDecision.confidence) / ((currentMetrics.decisionsTotal || 0) + 1)),
          lastWeekActions: (currentMetrics.lastWeekActions || 0) + 1,
        });
      }
    } catch {}
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
    logger.info("[AutonomousExecutor] Disabled via AUTONOMOUS_EXECUTOR_ENABLED=false");
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
      logger.info(`[AutonomousExecutor] Processing item #${item.id} (${item.itemType}, urgency: ${item.urgencyScore})`);
      const result = await processInboxItem(item);
      results.push(result);

      if (result.decision.action === "approve") approved++;
      else if (result.decision.action === "reject") rejected++;
      else if (result.decision.action === "hard_stop") hardStopped++;
      else deferred++;

      if (result.executionSuccess) successes++;
      if (result.executed && !result.executionSuccess) failures++;
    } catch (err: any) {
      logger.error(`[AutonomousExecutor] Failed to process item #${item.id}`, err);
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
    logger.info(`[AutonomousExecutor] Complete: ${pendingItems.length} items — ` +
      `${approved} approved, ${rejected} rejected, ${deferred} deferred, ${hardStopped} hard-stopped | ` +
      `${successes} executed successfully, ${failures} failed`);
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
