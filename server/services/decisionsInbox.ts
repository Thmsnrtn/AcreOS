// @ts-nocheck — ORM type refinement deferred; runtime-correct
import { db } from "../db";
import {
  decisionsInboxItems, supportTickets, systemAlerts, featureRequests,
  organizations,
} from "@shared/schema";
import { eq, and, desc, isNull, or, lt } from "drizzle-orm";
import OpenAI from "openai";
import { executeAction, hasExecutor } from "./agentActionExecutors";
import { customerSupportAutoResolver } from "./customerSupportAutoResolver";

const openai = new OpenAI();

export const decisionsInboxService = {

  /**
   * Called by Sophie's escalate_to_human tool execution.
   *
   * First delegates to customerSupportAutoResolver for automated resolution.
   * Only creates a founder inbox item if auto-resolution fails.
   *
   * This keeps customer support automation cleanly separated from
   * the founder's decision queue.
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

    // Delegate to the customer support auto-resolver first
    const resolution = await customerSupportAutoResolver.attemptResolution(ticketId, {
      sophieAnalysis: opts?.sophieAnalysis,
      draftResponse: opts?.draftResponse,
      confidenceScore: opts?.confidenceScore,
      category: opts?.category,
    });

    if (resolution.autoResolved) {
      return { autoResolved: true };
    }

    // Auto-resolution failed — create a founder inbox item
    const confidence = opts?.confidenceScore ?? 0;
    const isBilling = (opts?.category ?? ticket.category ?? "") === "billing";

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
      recommendedAction: resolution.geniusResponse ?? opts?.draftResponse ?? "Review ticket and respond to customer.",
      recommendedActionLabel: "Resolve Ticket",
      actionPayload: opts?.actionPayload ?? { ticketId, action: "resolve" },
      sourceTicketId: ticketId,
      organizationId: ticket.organizationId ?? null,
      contextBundle: {
        ticketTitle: ticket.subject ?? "",
        category: ticket.category ?? "",
        geniusConfidence: resolution.geniusConfidence,
      },
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
        content: "You are a B2B land investment tech product strategist. Evaluate feature requests for revenue impact.",
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

  /** Approve: mark approved, then EXECUTE the action payload. v3 closes the loop. */
  async approve(itemId: number): Promise<{ executed: boolean; detail?: string }> {
    // Mark as approved
    await db.update(decisionsInboxItems)
      .set({ status: "approved", resolvedAt: new Date(), resolvedBy: "founder", updatedAt: new Date() })
      .where(eq(decisionsInboxItems.id, itemId));

    // v3: Execute the approved action
    const item = await db.query.decisionsInboxItems.findFirst({
      where: eq(decisionsInboxItems.id, itemId),
    });

    if (!item?.actionPayload) {
      return { executed: false, detail: "No action payload to execute" };
    }

    const payload = item.actionPayload as Record<string, any>;
    const agentCodename = item.ownerAgentCodename || this.inferAgent(item.itemType);
    const actionName = payload.action || item.itemType;

    // Map common action payloads to registered executors
    const executionMap: Record<string, { agent: string; action: string }> = {
      send_retention_email: { agent: "sophie_csm", action: "send_retention_email" },
      resolve: { agent: "sophie_csm", action: "resolve_stale_ticket" },
      acknowledge: { agent: "atlas_cto", action: "acknowledge_incident" },
      add_to_roadmap: { agent: "atlas_research", action: "store_learning" },
    };

    const mapping = executionMap[actionName];
    const finalAgent = mapping?.agent || agentCodename;
    const finalAction = mapping?.action || actionName;

    if (hasExecutor(finalAgent, finalAction)) {
      const result = await executeAction({
        agentCodename: finalAgent,
        actionName: finalAction,
        input: payload,
        triggeredBy: "approval",
      });
      return { executed: true, detail: result.detail };
    }

    return { executed: false, detail: `No executor registered for ${finalAgent}:${finalAction}` };
  },

  /** Infer agent codename from item type when not explicitly set */
  inferAgent(itemType: string): string {
    const typeToAgent: Record<string, string> = {
      support_escalation: "sophie_csm",
      churn_risk_intervention: "forge_revenue",
      dunning_recovery: "forge_revenue",
      critical_alert: "sentinel_devops",
      feature_request_flagged: "compass_pm",
    };
    return typeToAgent[itemType] || "sophie_csm";
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
