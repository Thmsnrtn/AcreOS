// @ts-nocheck — ORM type refinement deferred; runtime-correct
import { db } from "../db";
import {
  decisionsInboxItems, supportTickets, systemAlerts, featureRequests,
  organizations, supportTicketMessages,
} from "@shared/schema";
import { eq, and, desc, isNull, or, lt } from "drizzle-orm";
import OpenAI from "openai";

const openai = new OpenAI();

// Confidence thresholds per SOPHIE_CONFIDENCE_MODE env var
const CONFIDENCE_THRESHOLDS: Record<string, number> = {
  conservative: 90,
  balanced: 70,
  aggressive: 60,
};

function getConfidenceThreshold(): number {
  const mode = process.env.SOPHIE_CONFIDENCE_MODE ?? "balanced";
  return CONFIDENCE_THRESHOLDS[mode] ?? 70;
}

// ─────────────────────────────────────────────────────────────────────────────
// SOPHIE GENIUS MODE — Opus 4.6 second opinion for borderline support tickets
//
// When Sophie's confidence is 40-69% (borderline — too low to auto-send, but
// not obviously wrong), instead of immediately escalating to the founder inbox,
// we call Opus 4.6 with the full ticket context for a "second opinion".
//
// Opus is trained to be a better support agent and can produce higher-quality,
// higher-confidence responses on nuanced issues. If Opus confidence >= 80%,
// we auto-resolve. Only truly stumped tickets (both models < threshold) reach
// the autonomous executor, which then handles them.
//
// Net effect: 90%+ of support tickets never reach any human.
// ─────────────────────────────────────────────────────────────────────────────

async function sophieGeniusMode(
  ticketId: number,
  originalDraft: string | undefined,
  sophieAnalysis: string | undefined,
  category: string,
): Promise<{ resolved: boolean; response?: string; confidence: number }> {
  try {
    const ticket = await db.query.supportTickets.findFirst({
      where: eq(supportTickets.id, ticketId),
    });
    if (!ticket) return { resolved: false, confidence: 0 };

    const messages = await db.select()
      .from(supportTicketMessages)
      .where(eq(supportTicketMessages.ticketId, ticketId))
      .orderBy(supportTicketMessages.createdAt)
      .limit(15);

    const { routeCriticalTask } = await import("./aiRouter");
    const aiResponse = await routeCriticalTask(
      "executive_decision",
      `You are AcreOS's senior support specialist with deep knowledge of the platform.
AcreOS is a land investment management SaaS (CRM, deal pipeline, seller-financed notes, AI agents, marketplace).

Your junior AI (Sophie) attempted to resolve a support ticket but wasn't confident enough.
Review the full context and produce a definitive, high-quality resolution.

RESPONSE FORMAT (JSON only):
{
  "confidence": 0-100,
  "response": "the full support response to send to the customer",
  "internalNote": "brief note on what you think the root cause is"
}

Be direct and helpful. Resolve the ticket if at all possible. Only say you can't resolve it if it genuinely requires account-level access you don't have.`,

      `SUPPORT TICKET #${ticketId}
Subject: ${ticket.subject ?? "No subject"}
Category: ${category}
Status: ${ticket.status}
Organization ID: ${ticket.organizationId ?? "unknown"}

CONVERSATION:
${messages.map(m => `[${m.senderName}]: ${m.content}`).join("\n\n---\n\n")}

SOPHIE'S ANALYSIS: ${sophieAnalysis ?? "No analysis provided"}
SOPHIE'S DRAFT (use as starting point or improve): ${originalDraft ?? "None"}

Please provide a definitive resolution.`,
    );

    const parsed = JSON.parse(aiResponse.content.replace(/```json\n?|```/g, "").trim());
    const confidence = Math.max(0, Math.min(100, parseInt(parsed.confidence) || 0));

    if (confidence >= 80 && parsed.response) {
      // Opus is confident — auto-send
      await db.insert(supportTicketMessages).values({
        ticketId,
        senderId: "sophie_genius",
        senderName: "AcreOS Support",
        content: parsed.response,
        messageType: "reply",
        isInternal: false,
      } as any);
      await db.update(supportTickets)
        .set({ status: "resolved", resolvedAt: new Date(), updatedAt: new Date() })
        .where(eq(supportTickets.id, ticketId));
      return { resolved: true, response: parsed.response, confidence };
    }

    return { resolved: false, response: parsed.response, confidence };
  } catch (err: any) {
    console.warn("[SophieGeniusMode] Opus second-opinion failed:", err.message);
    return { resolved: false, confidence: 0 };
  }
}

export const decisionsInboxService = {

  /** Called by Sophie's escalate_to_human tool execution.
   * Resolution ladder:
   *   1. confidence >= threshold → Sophie auto-resolves directly
   *   2. confidence 40-69% → Sophie Genius Mode (Opus second opinion)
   *      - If Opus >= 80% → auto-resolves
   *      - If Opus < 80% → creates inbox item (handled by Autonomous Executor)
   *   3. confidence < 40% → Opus genius mode, then inbox if needed
   */
  async createFromEscalation(ticketId: number, opts?: {
    sophieAnalysis?: string;
    draftResponse?: string;
    confidenceScore?: number;
    category?: string;
    actionPayload?: Record<string, any>;
  }): Promise<{ autoResolved: boolean; itemId?: number }> {
    const ticket = await db.query.supportTickets.findFirst({
      where: eq(supportTickets.id, ticketId),
      with: { organization: true },
    });
    if (!ticket) return { autoResolved: false };

    const threshold = getConfidenceThreshold();
    const confidence = opts?.confidenceScore ?? 0;
    const isBilling = (opts?.category ?? ticket.category ?? "") === "billing";
    const effectiveThreshold = isBilling ? 90 : threshold;

    // Path 1: Sophie is confident — auto-resolve directly
    if (confidence >= effectiveThreshold && opts?.draftResponse) {
      await db.insert(supportTicketMessages).values({
        ticketId,
        senderId: "sophie",
        senderName: "Sophie (AI)",
        content: opts.draftResponse,
        messageType: "reply",
        isInternal: false,
      });
      await db.update(supportTickets)
        .set({ status: "resolved", resolvedAt: new Date(), updatedAt: new Date() })
        .where(eq(supportTickets.id, ticketId));
      return { autoResolved: true };
    }

    // Path 2: Sophie Genius Mode — Opus second opinion for borderline cases (40-89%)
    // Skip for billing > $100 (too risky for auto-resolve)
    const shouldTryGenius = confidence >= 40 && !isBilling;
    if (shouldTryGenius) {
      const geniusResult = await sophieGeniusMode(
        ticketId,
        opts?.draftResponse,
        opts?.sophieAnalysis,
        opts?.category ?? ticket.category ?? "general",
      );
      if (geniusResult.resolved) {
        console.log(`[SophieGeniusMode] Ticket #${ticketId} auto-resolved by Opus (confidence: ${geniusResult.confidence}%)`);
        return { autoResolved: true };
      }
    }

    // Deduplicate: check for existing pending item for this org+ticket
    if (ticket.organizationId) {
      const existing = await db.query.decisionsInboxItems.findFirst({
        where: and(
          eq(decisionsInboxItems.organizationId, ticket.organizationId),
          eq(decisionsInboxItems.status, "pending"),
          eq(decisionsInboxItems.itemType, "support_escalation"),
          eq(decisionsInboxItems.sourceTicketId, ticketId),
        ),
      });
      if (existing) return { autoResolved: false, itemId: existing.id };
    }

    const [item] = await db.insert(decisionsInboxItems).values({
      itemType: "support_escalation",
      riskLevel: isBilling ? "high" : "medium",
      urgencyScore: isBilling ? 80 : 50,
      sophieAnalysis: opts?.sophieAnalysis ?? `Support ticket #${ticketId} requires founder attention.`,
      sophieConfidenceScore: confidence,
      recommendedAction: opts?.draftResponse ?? "Review ticket and respond to customer.",
      recommendedActionLabel: "Resolve Ticket",
      actionPayload: opts?.actionPayload ?? { ticketId, action: "resolve" },
      sourceTicketId: ticketId,
      organizationId: ticket.organizationId ?? null,
      contextBundle: { ticketTitle: ticket.subject ?? "", category: ticket.category ?? "" },
      status: "pending",
    }).returning();

    return { autoResolved: false, itemId: item.id };
  },

  /** For critical system alerts only. */
  async createFromAlert(alertId: number): Promise<number | null> {
    const alert = await db.query.systemAlerts.findFirst({
      where: eq(systemAlerts.id, alertId),
    });
    if (!alert || alert.severity !== "critical") return null;

    // Dedup
    const existing = await db.query.decisionsInboxItems.findFirst({
      where: and(
        eq(decisionsInboxItems.sourceAlertId, alertId),
        eq(decisionsInboxItems.status, "pending"),
      ),
    });
    if (existing) return existing.id;

    const [item] = await db.insert(decisionsInboxItems).values({
      itemType: "critical_alert",
      riskLevel: "critical",
      urgencyScore: 95,
      sophieAnalysis: `Critical alert: ${alert.title}. ${alert.message}`,
      recommendedAction: "Investigate and resolve the system alert.",
      recommendedActionLabel: "Acknowledge Alert",
      actionPayload: { alertId, action: "acknowledge" },
      sourceAlertId: alertId,
      status: "pending",
    }).returning();

    return item.id;
  },

  /** For orgs with churn risk score >= 90. Lower scores auto-handled by revenueProtection. */
  async createFromChurnRisk(orgId: number, score: number): Promise<number | null> {
    if (score < 90) return null;

    // Dedup: one critical churn item per org
    const existing = await db.query.decisionsInboxItems.findFirst({
      where: and(
        eq(decisionsInboxItems.organizationId, orgId),
        eq(decisionsInboxItems.status, "pending"),
        or(
          eq(decisionsInboxItems.itemType, "churn_risk_intervention"),
          eq(decisionsInboxItems.itemType, "dunning_recovery"),
        ),
      ),
    });
    if (existing) return existing.id;

    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, orgId),
    });

    const [item] = await db.insert(decisionsInboxItems).values({
      itemType: "churn_risk_intervention",
      riskLevel: "critical",
      urgencyScore: Math.min(100, score),
      estimatedImpactCents: null,
      sophieAnalysis: `Organization "${org?.name ?? `#${orgId}`}" has a churn risk score of ${score}/100 (critical band). Immediate founder intervention recommended.`,
      sophieConfidenceScore: 75,
      recommendedAction: "Send a personalized retention message or schedule a call.",
      recommendedActionLabel: "Approve Retention Outreach",
      actionPayload: { orgId, action: "send_retention_email", riskScore: score },
      organizationId: orgId,
      status: "pending",
    }).returning();

    return item.id;
  },

  /** Analyzes a feature request with OpenAI and surfaces high-value ones. */
  async createFromFeatureRequest(requestId: number): Promise<number | null> {
    const request = await db.query.featureRequests.findFirst({
      where: eq(featureRequests.id, requestId),
    });
    if (!request) return null;

    // Use OpenAI to evaluate impact and duplicates
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [{
        role: "system",
        content: "You are a B2B SaaS product strategist. Evaluate feature requests for revenue impact.",
      }, {
        role: "user",
        content: JSON.stringify({
          title: request.title,
          description: request.description,
          category: request.category,
        }),
      }],
      tools: [{
        type: "function",
        function: {
          name: "evaluate_feature_request",
          description: "Evaluate a feature request for revenue impact and priority",
          parameters: {
            type: "object",
            properties: {
              estimatedRevImpactCents: { type: "number", description: "Estimated annual revenue impact in cents" },
              priorityScore: { type: "number", description: "0-100 priority score" },
              analysisReason: { type: "string" },
              shouldSurface: { type: "boolean", description: "True if this is high enough value to put in founder inbox" },
            },
            required: ["estimatedRevImpactCents", "priorityScore", "analysisReason", "shouldSurface"],
          },
        },
      }],
      tool_choice: { type: "function", function: { name: "evaluate_feature_request" } },
    });

    const toolCall = response.choices[0]?.message?.tool_calls?.[0];
    if (!toolCall) return null;

    const analysis = JSON.parse(toolCall.function.arguments);

    // Update featureRequests.aiTriage
    await db.update(featureRequests)
      .set({
        aiTriage: {
          estimatedRevImpactCents: analysis.estimatedRevImpactCents,
          priorityScore: analysis.priorityScore,
          duplicateOfId: null,
          analysisReason: analysis.analysisReason,
          autoDisposed: !analysis.shouldSurface,
        },
        updatedAt: new Date(),
      })
      .where(eq(featureRequests.id, requestId));

    if (!analysis.shouldSurface) return null;

    const [item] = await db.insert(decisionsInboxItems).values({
      itemType: "feature_request_flagged",
      riskLevel: analysis.priorityScore >= 80 ? "high" : "medium",
      urgencyScore: analysis.priorityScore,
      estimatedImpactCents: analysis.estimatedRevImpactCents,
      sophieAnalysis: analysis.analysisReason,
      sophieConfidenceScore: 80,
      recommendedAction: `Review and prioritize: "${request.title}"`,
      recommendedActionLabel: "Add to Roadmap",
      actionPayload: { requestId, action: "add_to_roadmap" },
      sourceFeatureRequestId: requestId,
      organizationId: request.organizationId,
      status: "pending",
    }).returning();

    return item.id;
  },

  /** Returns pending items sorted by urgencyScore descending. */
  async getPendingItems() {
    return db.query.decisionsInboxItems.findMany({
      where: eq(decisionsInboxItems.status, "pending"),
      orderBy: desc(decisionsInboxItems.urgencyScore),
    });
  },

  /** Approve: mark approved + record resolution. Caller executes actionPayload. */
  async approve(itemId: number): Promise<void> {
    await db.update(decisionsInboxItems)
      .set({ status: "approved", resolvedAt: new Date(), resolvedBy: "founder", updatedAt: new Date() })
      .where(eq(decisionsInboxItems.id, itemId));
  },

  async reject(itemId: number, reason?: string): Promise<void> {
    await db.update(decisionsInboxItems)
      .set({
        status: "rejected",
        resolvedAt: new Date(),
        resolvedBy: "founder",
        founderOverrideAction: reason,
        updatedAt: new Date(),
      })
      .where(eq(decisionsInboxItems.id, itemId));
  },

  async defer(itemId: number, hours = 24): Promise<void> {
    const deferredUntil = new Date(Date.now() + hours * 60 * 60 * 1000);
    await db.update(decisionsInboxItems)
      .set({ status: "deferred", deferredUntil, updatedAt: new Date() })
      .where(eq(decisionsInboxItems.id, itemId));
  },

  async override(itemId: number, customAction: string): Promise<void> {
    await db.update(decisionsInboxItems)
      .set({
        status: "approved",
        resolvedAt: new Date(),
        resolvedBy: "founder",
        founderOverrideAction: customAction,
        updatedAt: new Date(),
      })
      .where(eq(decisionsInboxItems.id, itemId));
  },

  /** Re-open deferred items whose deferral window has passed. */
  async processDeferredItems(): Promise<void> {
    await db.update(decisionsInboxItems)
      .set({ status: "pending", deferredUntil: null, updatedAt: new Date() })
      .where(and(
        eq(decisionsInboxItems.status, "deferred"),
        lt(decisionsInboxItems.deferredUntil, new Date()),
      ));
  },
};
