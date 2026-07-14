import { db } from "../db";
import {
  decisionsInboxItems, supportTickets, systemAlerts, featureRequests,
  organizations,
} from "@shared/schema";
import { eq, and, desc, isNull, or, lt } from "drizzle-orm";
import { executeAction, hasExecutor } from "./agentActionExecutors";
import { customerSupportAutoResolver } from "./customerSupportAutoResolver";
import { requireOpenAIClient } from "../utils/openaiClient";
import { arbitrateFounderInterrupt } from "./founderInterruptArbiter";
import { logger } from "../utils/logger";

/**
 * Jarvis 2.2 — route a would-be founder inbox item through the interrupt
 * arbiter BEFORE it lands in the founder's pending queue. The row is always
 * written (never dropped); the arbiter only decides which status it lands in:
 *
 *   deliver         → status "pending"    (today's behavior — surfaces now)
 *   defer_*         → status "deferred"   + deferredUntil (processDeferredItems
 *                     re-opens it; the Letter batches it)
 *   suppress (C)    → status "suppressed" (kept verbatim for the audit trail
 *                     and the 2.3 defect ledger; never surfaced as pending,
 *                     never re-opened — a Class-C arrival is a defect signal)
 *
 * Never throws: arbiter unavailability fails CLOSED-quiet per the binding
 * design — B defers, C suppresses.
 */
async function arbitrateInboxInsert(
  interruptClass: "B" | "C",
  subject: string,
  metadata: Record<string, unknown>,
): Promise<{ status: "pending" | "deferred" | "suppressed"; deferredUntil: Date | null }> {
  try {
    const decision = await arbitrateFounderInterrupt({
      source: "decisions_inbox",
      interruptClass,
      channel: "inbox_pending_item",
      subject,
      metadata,
    });
    if (decision.outcome === "deliver") return { status: "pending", deferredUntil: null };
    if (decision.outcome === "suppress") return { status: "suppressed", deferredUntil: null };
    return {
      status: "deferred",
      deferredUntil: decision.deferUntil ?? new Date(Date.now() + 24 * 60 * 60 * 1000),
    };
  } catch (err) {
    logger.error(
      "[decisionsInbox] interrupt arbiter threw — failing CLOSED-quiet at the wrapper",
      err instanceof Error ? err : undefined,
    );
    return interruptClass === "B"
      ? { status: "deferred", deferredUntil: new Date(Date.now() + 24 * 60 * 60 * 1000) }
      : { status: "suppressed", deferredUntil: null };
  }
}

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

    // Jarvis 2.2 explicit class mapping for THIS call site: riskLevel high
    // (billing — the customer's money) → Class B; medium → Class C (an
    // unresolved medium-risk escalation should be answerable inside earned
    // autonomy — its arrival here is a logged defect signal, and the ticket
    // itself stays open in supportTickets either way).
    const arbiter = await arbitrateInboxInsert(
      isBilling ? "B" : "C",
      `Support escalation: ticket #${ticketId}`,
      { itemType: "support_escalation", ticketId, organizationId: ticket.organizationId ?? undefined },
    );

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
      status: arbiter.status,
      deferredUntil: arbiter.deferredUntil,
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

    // Jarvis 2.2 explicit class mapping for THIS call site: riskLevel critical
    // → Class B. The inbox row is the batched decision surface; the PROMPT
    // channel for the same incident is the alertSpine pager, which maps to
    // Class A on its own path — so deferring this row never silences a fire.
    const arbiter = await arbitrateInboxInsert(
      "B",
      `Critical alert: ${alert.title}`,
      { itemType: "critical_alert", alertId },
    );

    const [item] = await db.insert(decisionsInboxItems).values({
      itemType: "critical_alert",
      riskLevel: "critical",
      urgencyScore: 95,
      sophieAnalysis: `Critical alert: ${alert.title}. ${alert.message}`,
      recommendedAction: "Investigate and resolve the system alert.",
      recommendedActionLabel: "Acknowledge Alert",
      actionPayload: { alertId, action: "acknowledge" },
      sourceAlertId: alertId,
      status: arbiter.status,
      deferredUntil: arbiter.deferredUntil,
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

    // Jarvis 2.2 explicit class mapping for THIS call site: riskLevel critical
    // (churn of a paying customer — retention risk, rank 2 in the ranking
    // function) → Class B: interrupt while budget allows, batch to the Letter
    // when consumed.
    const arbiter = await arbitrateInboxInsert(
      "B",
      `Churn risk ${score}/100 for org #${orgId}`,
      { itemType: "churn_risk_intervention", organizationId: orgId, score },
    );

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
      status: arbiter.status,
      deferredUntil: arbiter.deferredUntil,
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
    const response = await requireOpenAIClient().chat.completions.create({
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
    if (!toolCall || toolCall.type !== "function") return null;

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

    // Jarvis 2.2 explicit class mapping for THIS call site: riskLevel high
    // (priorityScore >= 80) → Class B; medium → Class C (a routine feature
    // request should be triaged inside earned autonomy, not interrupt the
    // founder — the row is kept as a suppressed defect-signal record).
    const isHigh = analysis.priorityScore >= 80;
    const arbiter = await arbitrateInboxInsert(
      isHigh ? "B" : "C",
      `Feature request flagged: ${request.title}`,
      { itemType: "feature_request_flagged", requestId, organizationId: request.organizationId ?? undefined },
    );

    const [item] = await db.insert(decisionsInboxItems).values({
      itemType: "feature_request_flagged",
      riskLevel: isHigh ? "high" : "medium",
      urgencyScore: analysis.priorityScore,
      estimatedImpactCents: analysis.estimatedRevImpactCents,
      sophieAnalysis: analysis.analysisReason,
      sophieConfidenceScore: 80,
      recommendedAction: `Review and prioritize: "${request.title}"`,
      recommendedActionLabel: "Add to Roadmap",
      actionPayload: { requestId, action: "add_to_roadmap" },
      sourceFeatureRequestId: requestId,
      organizationId: request.organizationId,
      status: arbiter.status,
      deferredUntil: arbiter.deferredUntil,
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
