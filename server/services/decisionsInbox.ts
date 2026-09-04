import { db } from "../db";
import { unscopedForPlatformOps } from "../utils/orgScopedDb";
import {
  decisionsInboxItems, supportTickets, systemAlerts, featureRequests,
  organizations,
} from "@shared/schema";
import { eq, and, desc, gte, isNull, or, lt, sql } from "drizzle-orm";
import { executeAction, hasExecutor } from "./agentActionExecutors";
import { customerSupportAutoResolver } from "./customerSupportAutoResolver";
import { requireOpenAIClient } from "../utils/openaiClient";
import { arbitrateFounderInterrupt } from "./founderInterruptArbiter";
import {
  attachPrediction,
  OUTCOME_CHECK_IN_OPTIONS,
  type OutcomePrediction,
} from "./outcomeLedger";
import { logger } from "../utils/logger";

/**
 * The per-class "If you do nothing" sentence (founder-trust audit 2026-07-28).
 * Lives in shared/decisions/doNothing.ts — a pure, dependency-free module
 * imported by BOTH this service and founder-decisions.tsx, so the server's
 * truth and the rendered sentence can never drift. Every sentence states
 * verified current behavior only (see the shared module's provenance header);
 * changing behavior for a class means updating BOTH the code and its sentence.
 */
export { doNothingContract, DO_NOTHING_CONTRACTS } from "@shared/decisions/doNothing";

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

/**
 * Jarvis 2.3 — phone-answerable cards. A creator may attach up to
 * DECISION_CARD_MAX_OPTIONS tap-sized options; the founder answers by
 * tapping one instead of typing. Stored inside contextBundle.options —
 * deliberately NOT a new column (no migration).
 */
export interface DecisionCardOption {
  key: string;
  label: string;
  action?: Record<string, any>;
}

export const DECISION_CARD_MAX_OPTIONS = 4;
export const DECISION_CARD_LABEL_MAX_CHARS = 60;

/**
 * Drop malformed entries, enforce the tap-sized constraints (≤ 4 options,
 * labels ≤ 60 chars). Returns undefined when nothing survives so callers
 * can spread-omit the key entirely.
 */
export function sanitizeDecisionOptions(
  options?: DecisionCardOption[],
): DecisionCardOption[] | undefined {
  if (!Array.isArray(options)) return undefined;
  const valid = options
    .filter(
      (o): o is DecisionCardOption =>
        !!o &&
        typeof o.key === "string" &&
        o.key.trim().length > 0 &&
        typeof o.label === "string" &&
        o.label.trim().length > 0 &&
        o.label.length <= DECISION_CARD_LABEL_MAX_CHARS,
    )
    .slice(0, DECISION_CARD_MAX_OPTIONS);
  return valid.length > 0 ? valid : undefined;
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
    options?: DecisionCardOption[];
    prediction?: OutcomePrediction;
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

    // Horizon A1 — every consequential decision carries a prediction at
    // creation (explicit caller prediction overrides the itemType default).
    const pred = attachPrediction({
      itemType: "support_escalation",
      organizationId: ticket.organizationId ?? null,
      prediction: opts?.prediction,
    });

    const options = sanitizeDecisionOptions(opts?.options);
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
        ...(options ? { options } : {}),
        ...(pred ? { outcomePrediction: pred.outcomePrediction } : {}),
      },
      ...(pred ? { expectedOutcome: pred.expectedOutcome, checkInDate: pred.checkInDate } : {}),
      status: arbiter.status,
      deferredUntil: arbiter.deferredUntil,
    }).returning();

    return { autoResolved: false, itemId: item.id };
  },

  /** For critical system alerts only. */
  async createFromAlert(
    alertId: number,
    opts?: { options?: DecisionCardOption[]; prediction?: OutcomePrediction },
  ): Promise<number | null> {
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

    // Horizon A1 — judgment-call default (no machine check): the founder
    // scores this one at the 30-day check-in.
    const pred = attachPrediction({
      itemType: "critical_alert",
      organizationId: null,
      prediction: opts?.prediction,
    });

    const options = sanitizeDecisionOptions(opts?.options);
    const [item] = await db.insert(decisionsInboxItems).values({
      itemType: "critical_alert",
      riskLevel: "critical",
      urgencyScore: 95,
      sophieAnalysis: `Critical alert: ${alert.title}. ${alert.message}`,
      recommendedAction: "Investigate and resolve the system alert.",
      recommendedActionLabel: "Acknowledge Alert",
      actionPayload: { alertId, action: "acknowledge" },
      sourceAlertId: alertId,
      contextBundle: {
        ...(options ? { options } : {}),
        ...(pred ? { outcomePrediction: pred.outcomePrediction } : {}),
      },
      ...(pred ? { expectedOutcome: pred.expectedOutcome, checkInDate: pred.checkInDate } : {}),
      status: arbiter.status,
      deferredUntil: arbiter.deferredUntil,
    }).returning();

    return item.id;
  },

  /** For orgs with churn risk score >= 90. Lower scores auto-handled by revenueProtection. */
  async createFromChurnRisk(
    orgId: number,
    score: number,
    opts?: { options?: DecisionCardOption[]; prediction?: OutcomePrediction },
  ): Promise<number | null> {
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

    // Horizon A1 — retention is machine-checkable: churn_retained at 90 days.
    const pred = attachPrediction({
      itemType: "churn_risk_intervention",
      organizationId: orgId,
      prediction: opts?.prediction,
    });

    const options = sanitizeDecisionOptions(opts?.options);
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
      contextBundle: {
        ...(options ? { options } : {}),
        ...(pred ? { outcomePrediction: pred.outcomePrediction } : {}),
      },
      ...(pred ? { expectedOutcome: pred.expectedOutcome, checkInDate: pred.checkInDate } : {}),
      status: arbiter.status,
      deferredUntil: arbiter.deferredUntil,
    }).returning();

    return item.id;
  },

  /** Analyzes a feature request with OpenAI and surfaces high-value ones. */
  async createFromFeatureRequest(
    requestId: number,
    opts?: { options?: DecisionCardOption[]; prediction?: OutcomePrediction },
  ): Promise<number | null> {
    const request = await db.query.featureRequests.findFirst({
      where: eq(featureRequests.id, requestId),
    });
    if (!request) return null;

    // Use OpenAI to evaluate impact and duplicates
    const response = await requireOpenAIClient().chat.completions.create({
      model: "openai/gpt-4o-mini",
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

    // Horizon A1 — judgment-call default (no machine check): the founder
    // scores this one at the 30-day check-in.
    const pred = attachPrediction({
      itemType: "feature_request_flagged",
      organizationId: request.organizationId ?? null,
      prediction: opts?.prediction,
    });

    const options = sanitizeDecisionOptions(opts?.options);
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
      contextBundle: {
        ...(options ? { options } : {}),
        ...(pred ? { outcomePrediction: pred.outcomePrediction } : {}),
      },
      ...(pred ? { expectedOutcome: pred.expectedOutcome, checkInDate: pred.checkInDate } : {}),
      status: arbiter.status,
      deferredUntil: arbiter.deferredUntil,
    }).returning();

    return item.id;
  },

  /**
   * Horizon A1 — the outcome ledger's founder check-in card for judgment
   * calls (predictions without a machineCheck). One card per original item
   * while a card is OPEN; a resolved card does not block ("too soon to
   * tell" pushes the original's checkInDate forward and legitimately
   * produces a later card). Class B: a check-in is a real founder decision
   * (calibration ground truth) and rides the same interrupt budget as every
   * other founder ask.
   */
  /**
   * 2026-07 cost audit — generic founder decision card, created directly
   * (no source-domain row). For machine-raised PRODUCT decisions that must
   * not auto-execute: actionPayload is always null; the founder's tap
   * records the ruling (founderOverrideAction via chosenOption) for a
   * human-reviewed follow-up. Class B through the arbiter like every
   * machine-initiated insert. Dedupes on an open card with the same
   * contextBundle.directCardSubject.
   */
  async createDirectDecisionCard(card: {
    itemType: string;
    riskLevel: string;
    urgencyScore: number;
    sophieAnalysis: string;
    recommendedAction: string;
    recommendedActionLabel: string;
    subject: string;
    options: DecisionCardOption[];
  }): Promise<{ itemId: number | null; created: boolean }> {
    const existing = await db.query.decisionsInboxItems.findFirst({
      where: and(
        or(
          eq(decisionsInboxItems.status, "pending"),
          eq(decisionsInboxItems.status, "deferred"),
        ),
        sql`${decisionsInboxItems.contextBundle}->>'directCardSubject' = ${card.subject}`,
      ),
    });
    if (existing) return { itemId: existing.id, created: false };

    const arbiter = await arbitrateInboxInsert("B", card.subject, {
      itemType: card.itemType,
      directCardSubject: card.subject,
    });

    const [item] = await db
      .insert(decisionsInboxItems)
      .values({
        itemType: card.itemType,
        riskLevel: card.riskLevel,
        urgencyScore: card.urgencyScore,
        sophieAnalysis: card.sophieAnalysis,
        recommendedAction: card.recommendedAction,
        recommendedActionLabel: card.recommendedActionLabel,
        actionPayload: null,
        organizationId: null,
        ownerAgentCodename: this.inferAgent(card.itemType),
        contextBundle: {
          directCardSubject: card.subject,
          options: sanitizeDecisionOptions(card.options),
        },
        status: arbiter.status,
        deferredUntil: arbiter.deferredUntil,
      })
      .returning();
    return { itemId: item?.id ?? null, created: true };
  },

  async createOutcomeCheckIn(original: {
    id: number;
    itemType: string;
    organizationId: number | null;
    ownerAgentCodename: string | null;
    recommendedActionLabel: string;
    expectedOutcome: string | null;
    resolvedAt: Date | null;
  }): Promise<{ itemId: number | null; created: boolean }> {
    const existing = await db.query.decisionsInboxItems.findFirst({
      where: and(
        eq(decisionsInboxItems.itemType, "outcome_check_in"),
        or(
          eq(decisionsInboxItems.status, "pending"),
          eq(decisionsInboxItems.status, "deferred"),
        ),
        sql`${decisionsInboxItems.contextBundle}->>'outcomeCheckInFor' = ${String(original.id)}`,
      ),
    });
    // Dedupe predicate re-applied in process so unit tests pin the
    // open-card-only semantics independent of the SQL layer.
    if (
      existing &&
      existing.itemType === "outcome_check_in" &&
      (existing.status === "pending" || existing.status === "deferred") &&
      Number(existing.contextBundle?.outcomeCheckInFor) === original.id
    ) {
      return { itemId: existing.id, created: false };
    }

    const arbiter = await arbitrateInboxInsert(
      "B",
      `Outcome check-in: decision #${original.id}`,
      {
        itemType: "outcome_check_in",
        originalItemId: original.id,
        organizationId: original.organizationId ?? undefined,
      },
    );

    const resolvedOn = original.resolvedAt
      ? original.resolvedAt.toISOString().slice(0, 10)
      : "an unrecorded date";
    const [item] = await db.insert(decisionsInboxItems).values({
      itemType: "outcome_check_in",
      riskLevel: "low",
      urgencyScore: 30,
      sophieAnalysis: `Outcome check-in for decision #${original.id} ("${original.recommendedActionLabel}"), resolved ${resolvedOn}. Prediction at creation: ${original.expectedOutcome ?? "none recorded"}`,
      recommendedAction: 'Score this decision against what actually happened. "Too soon to tell" re-asks in 30 days.',
      recommendedActionLabel: "Score Outcome",
      actionPayload: null,
      organizationId: original.organizationId,
      ownerAgentCodename: original.ownerAgentCodename ?? this.inferAgent(original.itemType),
      // The 5-point scale is the ledger's fixed instrument — deliberately
      // NOT run through sanitizeDecisionOptions, whose 4-option cap governs
      // free-form creator options, not this constant.
      contextBundle: {
        options: OUTCOME_CHECK_IN_OPTIONS.map(({ key, label }) => ({ key, label })),
        outcomeCheckInFor: original.id,
      },
      status: arbiter.status,
      deferredUntil: arbiter.deferredUntil,
    }).returning();

    return { itemId: item.id, created: true };
  },

  /**
   * Horizon A2 — the shadow-promotion request card (Sovereign Principle 10:
   * "No agent may unilaterally expand its own authority"; promotions/demotions
   * are Class B decisions). Raised by the autopilot when a domain reaches the
   * clean-cycle threshold WITH sufficient shadow-agreement evidence — the card
   * is the ONLY way the request reaches the founder, and the founder's tap
   * (promotionRequest.applyPromotionAnswer, intercepted in the resolve routes)
   * is the ONLY way the level changes. itemType is a value in the existing
   * text column — deliberately no migration.
   *
   * Dedupe: never a second OPEN (pending/deferred) card for the same
   * domain+targetLevel. Routed through arbitrateInboxInsert as Class B — a
   * machine-initiated interrupt (unlike letter replies, these DO go through
   * the arbiter).
   */
  async createShadowPromotionRequest(input: {
    domain: string;
    fromLevel: string;
    toLevel: string;
    cleanCycleCount: number;
    threshold: number;
    agreement: {
      matched: number;
      total: number;
      pendingPairs: number;
      windowWeeks: number;
      misses: Array<{ when: string | null; moveKind: string; shadowCall: string; actualRuling: string }>;
      sufficient: boolean;
      capabilities: string[];
      caveat: string;
    };
  }): Promise<{ itemId: number | null; created: boolean }> {
    const { SHADOW_PROMOTION_ITEM_TYPE, PROMOTION_OPTION_GRANT, PROMOTION_OPTION_HOLD, buildPromotionCardBody } =
      await import("./autopilot/promotionRequest");

    const existing = await db.query.decisionsInboxItems.findFirst({
      where: and(
        eq(decisionsInboxItems.itemType, SHADOW_PROMOTION_ITEM_TYPE),
        or(
          eq(decisionsInboxItems.status, "pending"),
          eq(decisionsInboxItems.status, "deferred"),
        ),
        sql`${decisionsInboxItems.contextBundle}->'shadowPromotion'->>'domain' = ${input.domain}`,
        sql`${decisionsInboxItems.contextBundle}->'shadowPromotion'->>'toLevel' = ${input.toLevel}`,
      ),
    });
    // Dedupe predicate re-applied in process so unit tests pin the
    // open-card-only semantics independent of the SQL layer (A1 pattern).
    if (
      existing &&
      existing.itemType === SHADOW_PROMOTION_ITEM_TYPE &&
      (existing.status === "pending" || existing.status === "deferred") &&
      existing.contextBundle?.shadowPromotion?.domain === input.domain &&
      existing.contextBundle?.shadowPromotion?.toLevel === input.toLevel
    ) {
      return { itemId: existing.id, created: false };
    }

    const arbiter = await arbitrateInboxInsert(
      "B",
      `Autonomy promotion request: ${input.domain} → ${input.toLevel}`,
      { itemType: SHADOW_PROMOTION_ITEM_TYPE, domain: input.domain, toLevel: input.toLevel },
    );

    const [item] = await db.insert(decisionsInboxItems).values({
      itemType: SHADOW_PROMOTION_ITEM_TYPE,
      // Widening the machine's authority is a real (if reversible) decision.
      riskLevel: "high",
      urgencyScore: 55,
      sophieAnalysis: buildPromotionCardBody({
        domain: input.domain,
        fromLevel: input.fromLevel,
        toLevel: input.toLevel,
        cleanCycleCount: input.cleanCycleCount,
        threshold: input.threshold,
        agreement: input.agreement,
      }),
      recommendedAction:
        "Grant to apply the new autonomy level, or hold to keep earning. Only your tap changes the level; you can pause any domain at any time from the Control Center.",
      recommendedActionLabel: "Review Promotion",
      // Nothing executes on resolve — the level write happens exclusively in
      // the applyPromotionAnswer interception (never via an action executor).
      actionPayload: null,
      organizationId: null,
      ownerAgentCodename: "solene",
      contextBundle: {
        options: [
          { key: PROMOTION_OPTION_GRANT, label: `Promote to ${input.toLevel.replace(/_/g, " ")}` },
          { key: PROMOTION_OPTION_HOLD, label: "Not yet — keep earning" },
        ],
        shadowPromotion: {
          domain: input.domain,
          fromLevel: input.fromLevel,
          toLevel: input.toLevel,
          cleanCycleCount: input.cleanCycleCount,
          threshold: input.threshold,
          agreement: input.agreement,
        },
      },
      status: arbiter.status,
      deferredUntil: arbiter.deferredUntil,
    }).returning();

    return { itemId: item.id, created: true };
  },

  /** Returns pending items sorted by urgencyScore descending. */
  async getPendingItems() {
    // CROSS-ORG BY DESIGN, through the explicit hatch rather than by omission.
    // This is the FOUNDER's decisions inbox — routes-founder-intelligence is
    // its only reader, and `resolvedBy: "founder"` is stamped on every
    // resolution — so a per-org predicate would empty it. What was wrong was
    // that the cross-org read was indistinguishable from a forgotten one: the
    // org-scope lint could not see it at all (Drizzle's relational API had no
    // `.from(` for it to key on), and a reader could not tell design from
    // oversight. unscopedForPlatformOps logs the reason and makes it greppable.
    return unscopedForPlatformOps(
      "founder decisions inbox: the queue is platform-wide by definition; every reader is founder-gated",
    ).query.decisionsInboxItems.findMany({
      where: eq(decisionsInboxItems.status, "pending"),
      orderBy: desc(decisionsInboxItems.urgencyScore),
    });
  },

  /**
   * Approve: mark approved, then EXECUTE the action payload. v3 closes the
   * loop. Jarvis 2.3: `chosenOptionText` records the tapped card option
   * (`option:<key> — <label>`) into founderOverrideAction so the log shows
   * WHICH option answered the card.
   */
  async approve(itemId: number, chosenOptionText?: string): Promise<{ executed: boolean; detail?: string }> {
    // Mark as approved
    await db.update(decisionsInboxItems)
      .set({
        status: "approved",
        resolvedAt: new Date(),
        resolvedBy: "founder",
        updatedAt: new Date(),
        ...(chosenOptionText ? { founderOverrideAction: chosenOptionText } : {}),
      })
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
      outcome_check_in: "sophie_csm",
      // Horizon A3 — the shown-back parse of a founder's letter reply.
      // Solene owns it: the reply is addressed to her and confirms resolve
      // exclusively through letterReply.confirmLetterReply.
      letter_reply_confirm: "solene",
      // Horizon A2 — the autopilot's request to widen its own authority;
      // Solene owns it (Sovereign Principle 10: only the founder's tap grants).
      shadow_promotion_request: "solene",
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

  /**
   * Jarvis 2.3 defect ledger — Class-C arrivals in the trailing window. A
   * suppressed row means something escalated that policy says should have
   * been handled silently: each one is a DEFECT signal, kept verbatim by the
   * arbiter wrapper for exactly this surface. Window/order re-applied in
   * process so unit tests pin the arithmetic independent of the SQL layer;
   * the WHERE clause keeps the scan cheap in production.
   */
  async getSuppressedDefects(days = 30): Promise<{
    items: Array<typeof decisionsInboxItems.$inferSelect>;
    byType: Record<string, number>;
    total: number;
  }> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    // Cross-org for the same reason getPendingItems is, and through the same
    // hatch: this is the founder's own view of what the inbox SUPPRESSED, and
    // a per-org predicate would empty it.
    const rows = await unscopedForPlatformOps(
      "founder decisions inbox: suppressed-defect review is platform-wide by definition; the only reader is founder-gated",
    ).query.decisionsInboxItems.findMany({
      where: and(
        eq(decisionsInboxItems.status, "suppressed"),
        gte(decisionsInboxItems.createdAt, cutoff),
      ),
      orderBy: desc(decisionsInboxItems.createdAt),
    });
    const items = rows
      .filter(
        (r) =>
          r.status === "suppressed" &&
          r.createdAt != null &&
          r.createdAt.getTime() >= cutoff.getTime(),
      )
      .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
    const byType: Record<string, number> = {};
    for (const item of items) {
      byType[item.itemType] = (byType[item.itemType] ?? 0) + 1;
    }
    return { items, byType, total: items.length };
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
