import { db } from "../db";
import {
  decisionsInboxItems, supportTickets, systemAlerts, featureRequests,
  organizations, paxDecisionAppeals, paxRefusalPayloads, recourseDrafts,
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
import { wrapUntrusted } from "../ai/untrustedEnvelope";
import {
  classifySupportSeverity,
  slaDeadlineFor,
} from "./autopilot/measurementLoops";
/**
 * S5 — the conflict memo's shape. TYPE-ONLY on purpose: conflictMemo.ts imports
 * this module's VALUES (the item type + the service), so a value import back
 * the other way would close a runtime cycle. A type import erases at compile
 * time and cannot.
 */
import type { ConflictMemo as ConflictMemoRow } from "./autopilot/conflictMemo";

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

/**
 * F2 slice 1 (handoff P6 §3 — "one decision queue") — MIRROR CARDS.
 *
 * Two founder decision inflows that previously lived ONLY on their deep
 * surfaces are mirrored into the decisions door as cards with links back:
 *
 *   appeal_review   ← pax_decision_appeals   (/founder/appeals — a customer
 *                     is waiting on an upheld/reversed verdict)
 *   recourse_draft  ← recourse_drafts        (/founder/recourse — a drafted
 *                     personal reply to a negative signal, same-hour doctrine)
 *
 * Deliberately an ADAPTER, not a data migration: the deep stores stay the
 * system of record and their surfaces keep the full disposition forms
 * (verdict + reviewNotes + customerMessage; edit-and-send). The mirror card
 * carries presence + ranking + a deep link; it never executes anything
 * (actionPayload is always null) and it resolves ITSELF when the deep
 * surface disposes the source row (see resolveMirrorItem + the hooks in
 * routes-founder-appeals.ts / routes-founder-recourse.ts). The door's
 * generic approve/reject/override refuse mirror cards and point at the deep
 * surface (routes-founder-intelligence.ts).
 */
export const MIRRORED_QUEUE_ITEM_TYPES = {
  appeal_review: {
    deepLink: "/founder/appeals",
    surfaceName: "Appeals",
    bundleKey: "sourceAppealId",
  },
  recourse_draft: {
    deepLink: "/founder/recourse",
    surfaceName: "Recourse",
    bundleKey: "sourceRecourseDraftId",
  },
} as const;
export type MirroredQueueItemType = keyof typeof MIRRORED_QUEUE_ITEM_TYPES;

export function isMirroredQueueItemType(
  itemType: string,
): itemType is MirroredQueueItemType {
  return Object.prototype.hasOwnProperty.call(MIRRORED_QUEUE_ITEM_TYPES, itemType);
}

/**
 * Reasons-on-disposition (P6 §3: "reasons captured on 100% of dispositions").
 * The founder's optional one-line reason rides EVERY disposition verb into
 * the existing founder_modification text column (no migration — the column
 * already carries founder notes on the rosy-river and reverse paths).
 * founderOverrideAction keeps its exact legacy semantics (reject reason /
 * override action / chosen-option text) so every learning-loop reader is
 * untouched.
 */
export const DISPOSITION_REASON_MAX_CHARS = 2000;

export function normalizeDispositionReason(reason?: unknown): string | undefined {
  if (typeof reason !== "string") return undefined;
  const trimmed = reason.trim();
  if (!trimmed) return undefined;
  return trimmed.length > DISPOSITION_REASON_MAX_CHARS
    ? trimmed.slice(0, DISPOSITION_REASON_MAX_CHARS)
    : trimmed;
}

/**
 * X-A slice 1 — the portal "Report this page" affordance files a NATIVE
 * decisions-door item of this type (riskLevel high). NOT a mirror: there is
 * no deep-surface system of record — the queue row IS the record — so it is
 * deliberately absent from MIRRORED_QUEUE_ITEM_TYPES and every disposition
 * verb works on it directly.
 */
export const ABUSE_REPORT_ITEM_TYPE = "abuse_report";
export const ABUSE_REPORT_REASON_MAX_CHARS = 2000;
export const ABUSE_REPORT_PAGE_PATH_MAX_CHARS = 300;

/**
 * Wave S · S5 — a cross-charter CONFLICT MEMO. Also NATIVE (same reasoning as
 * abuse_report: the queue row IS the record, so every disposition verb works
 * on it directly and it is deliberately absent from MIRRORED_QUEUE_ITEM_TYPES).
 *
 * Two charters wanted opposite things and the council split; the memo carries
 * BOTH positions with their cost and risk reads plus a default. It executes
 * nothing — actionPayload is always null — so the founder's tap IS the action,
 * and their optional reason rides the same founderModification column every
 * other disposition writes to (see normalizeDispositionReason above). The
 * builder and the negotiability rules live in
 * server/services/autopilot/conflictMemo.ts; this module only files the row.
 */
export const CONFLICT_MEMO_ITEM_TYPE = "conflict_memo";

const RECOURSE_SIGNAL_CARD_META: Record<string, { label: string; urgencyScore: number }> = {
  cancellation: { label: "A cancellation", urgencyScore: 85 },
  detractor_nps: { label: "A detractor NPS score", urgencyScore: 75 },
  low_support_rating: { label: "A low support rating", urgencyScore: 70 },
};

/**
 * Thrown when a terminal disposition verb is invoked on a MIRROR card. The
 * door routes catch it (refuseMirrorDisposition renders the deep-link
 * refusal); any other caller (founder-chat tools, future executors) gets an
 * error instead of silently hiding a waiting customer behind an approved
 * mirror while the real row stays open.
 */
export class MirrorDispositionError extends Error {
  constructor(
    public readonly itemType: MirroredQueueItemType,
    verb: string,
  ) {
    super(
      `Cannot ${verb} a mirror card (${itemType}) — dispose it on its deep surface: ` +
        MIRRORED_QUEUE_ITEM_TYPES[itemType].deepLink,
    );
    this.name = "MirrorDispositionError";
  }
}

export const decisionsInboxService = {

  /**
   * Terminal-verb guard for mirror cards, at the SERVICE altitude so every
   * caller inherits it (the fleet-5 audit proved the route-only guard was
   * bypassable via founder-chat's approve_decision/reject_decision tools).
   * `defer` stays exempt — deferring a mirror is presence management, not a
   * verdict, and resolveMirrorItem covers deferred cards.
   */
  async refuseIfMirror(itemId: number, verb: string): Promise<void> {
    const item = await db.query.decisionsInboxItems.findFirst({
      where: eq(decisionsInboxItems.id, itemId),
      columns: { itemType: true },
    });
    if (item && isMirroredQueueItemType(item.itemType)) {
      throw new MirrorDispositionError(item.itemType, verb);
    }
  },

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

    // O5 — severity-class SLA (handoff P5 §4): classify the ticket so the
    // founder queue carries the clock. The clock starts at ticket CREATION
    // (escalating late must never reset it); the deadline is stamped into
    // contextBundle — deliberately NOT a new column (no migration), mirroring
    // the Jarvis 2.3 options pattern. P0 rides riskLevel critical; its PROMPT
    // channel is the alertSpine page fired at ticket creation (routes seam) —
    // deferring this row never silences that page.
    const severity = classifySupportSeverity({
      category: opts?.category ?? ticket.category,
      priority: ticket.priority,
      subject: ticket.subject,
      description: ticket.description,
    });
    const ticketCreatedAt = ticket.createdAt ?? new Date();
    const slaDeadline = slaDeadlineFor(severity.severityClass, ticketCreatedAt);
    const isP0 = severity.severityClass === "P0";
    const isP1 = severity.severityClass === "P1";

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
    // O5 overlay: a P0 (broken money/send) is critical → Class B; a P1
    // (blocked workflow, same-day doctrine) must actually surface → Class B.
    // Only a P2 non-billing question stays Class C.
    const arbiter = await arbitrateInboxInsert(
      isP0 || isP1 || isBilling ? "B" : "C",
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
      // O5 severity overlay on the historical billing mapping: P0 → critical,
      // P1 → high (same-day), P2 keeps billing-high / general-medium.
      riskLevel: isP0 ? "critical" : isP1 || isBilling ? "high" : "medium",
      urgencyScore: isP0 ? 95 : isBilling ? 80 : isP1 ? 70 : 50,
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
        // O5 — the visible SLA clock for the Decisions queue card.
        supportSla: {
          severityClass: severity.severityClass,
          reason: severity.reason,
          slaDeadline: slaDeadline.toISOString(),
          ticketCreatedAt: ticketCreatedAt.toISOString(),
        },
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
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [{
        role: "system",
        content: "You are a B2B land investment tech product strategist. Evaluate feature requests for revenue impact.",
      }, {
        role: "user",
        // Guard totality (audit P-2): title/description are customer-typed
        // and this message drives an auto-surfacing function call — envelope
        // them so planted instructions read as data, not directives.
        // `category` is wrapped too: the schema's enum exists only as a
        // comment (shared/schema.ts featureRequests.category is plain text
        // and the insert schema does not constrain it), so it is
        // customer-typed free text like the other two fields.
        content: JSON.stringify({
          title: wrapUntrusted(request.title, "customer:feature_request.title"),
          description: wrapUntrusted(request.description, "customer:feature_request.description"),
          category: wrapUntrusted(request.category, "customer:feature_request.category"),
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

  /**
   * F2 slice 1 — mirror a filed customer appeal (pax_decision_appeals) into
   * the decisions door. Called best-effort from routes-pax-appeals.ts right
   * after the appeal row is written; a mirror failure must never fail the
   * customer's filing. Class B through the arbiter (a customer is actively
   * waiting on a founder verdict). Dedupe: one OPEN (pending/deferred) card
   * per appeal via contextBundle.sourceAppealId.
   *
   * Deliberately NO customer free text in sophieAnalysis — the appeal reason
   * is customer-typed and this row's text feeds model-read surfaces
   * (decisionLogRag, companyMind); the verbatim lives on the deep surface.
   */
  async createFromAppeal(appealId: number): Promise<{ itemId: number | null; created: boolean }> {
    const appeal = await db.query.paxDecisionAppeals.findFirst({
      where: eq(paxDecisionAppeals.id, appealId),
    });
    if (!appeal) return { itemId: null, created: false };
    // Only an open/under-review appeal earns a card — mirroring an already-
    // ruled appeal would resurrect a decided item.
    if (appeal.status !== "open" && appeal.status !== "under_review") {
      return { itemId: null, created: false };
    }

    const meta = MIRRORED_QUEUE_ITEM_TYPES.appeal_review;
    const existing = await db.query.decisionsInboxItems.findFirst({
      where: and(
        eq(decisionsInboxItems.itemType, "appeal_review"),
        or(
          eq(decisionsInboxItems.status, "pending"),
          eq(decisionsInboxItems.status, "deferred"),
        ),
        sql`${decisionsInboxItems.contextBundle}->>'sourceAppealId' = ${String(appealId)}`,
      ),
    });
    // Dedupe predicate re-applied in process so unit tests pin the
    // open-card-only semantics independent of the SQL layer (A1 pattern).
    if (
      existing &&
      existing.itemType === "appeal_review" &&
      (existing.status === "pending" || existing.status === "deferred") &&
      Number(existing.contextBundle?.sourceAppealId) === appealId
    ) {
      return { itemId: existing.id, created: false };
    }

    const refusal = appeal.refusalPayloadId
      ? await db.query.paxRefusalPayloads.findFirst({
          where: eq(paxRefusalPayloads.id, appeal.refusalPayloadId),
        })
      : null;
    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, appeal.organizationId),
    });
    const orgLabel = org?.name ?? `org #${appeal.organizationId}`;

    const arbiter = await arbitrateInboxInsert(
      "B",
      `Customer appeal #${appealId} awaiting verdict`,
      { itemType: "appeal_review", appealId, organizationId: appeal.organizationId },
    );

    const [item] = await db.insert(decisionsInboxItems).values({
      itemType: "appeal_review",
      riskLevel: "high",
      urgencyScore: 75,
      sophieAnalysis:
        `Customer appeal #${appealId} from "${orgLabel}" against a Pax refusal` +
        `${refusal?.citedImmutableId ? ` (cited rule: ${refusal.citedImmutableId})` : ""}. ` +
        "The customer is waiting on your verdict — read their reason and rule " +
        "upheld or reversed on the Appeals queue.",
      recommendedAction:
        "Open the Appeals queue, read the customer's reason with the full refusal " +
        "context, and rule upheld or reversed. This card clears itself when you do.",
      recommendedActionLabel: "Review Appeal",
      // Nothing executes from this card — the verdict form (decision +
      // rationale + customer message) lives on the deep surface only.
      actionPayload: null,
      organizationId: appeal.organizationId,
      ownerAgentCodename: this.inferAgent("appeal_review"),
      contextBundle: {
        sourceAppealId: appealId,
        deepLink: meta.deepLink,
        deepLinkLabel: "Review on the Appeals queue",
        orgName: org?.name ?? null,
        ...(refusal?.citedImmutableId ? { citedImmutableId: refusal.citedImmutableId } : {}),
        ...(refusal?.severity ? { refusalSeverity: refusal.severity } : {}),
      },
      status: arbiter.status,
      deferredUntil: arbiter.deferredUntil,
    }).returning();

    return { itemId: item?.id ?? null, created: true };
  },

  /**
   * F2 slice 1 — mirror a recourse draft (recourse_drafts: a drafted personal
   * reply to a detractor NPS / low support rating / cancellation) into the
   * decisions door. Called best-effort from the aggregation sweep
   * (recourseDrafter.aggregateRecourseSignals) when a NEW draft row lands.
   * Class B (the same-hour-reply doctrine is the whole point of the loop).
   * Dedupe: one OPEN card per draft via contextBundle.sourceRecourseDraftId.
   */
  async createFromRecourseDraft(draftId: number): Promise<{ itemId: number | null; created: boolean }> {
    const draft = await db.query.recourseDrafts.findFirst({
      where: eq(recourseDrafts.id, draftId),
    });
    if (!draft) return { itemId: null, created: false };
    // Only an open draft earns a card.
    if (draft.status !== "draft") return { itemId: null, created: false };

    const meta = MIRRORED_QUEUE_ITEM_TYPES.recourse_draft;
    const existing = await db.query.decisionsInboxItems.findFirst({
      where: and(
        eq(decisionsInboxItems.itemType, "recourse_draft"),
        or(
          eq(decisionsInboxItems.status, "pending"),
          eq(decisionsInboxItems.status, "deferred"),
        ),
        sql`${decisionsInboxItems.contextBundle}->>'sourceRecourseDraftId' = ${String(draftId)}`,
      ),
    });
    if (
      existing &&
      existing.itemType === "recourse_draft" &&
      (existing.status === "pending" || existing.status === "deferred") &&
      Number(existing.contextBundle?.sourceRecourseDraftId) === draftId
    ) {
      return { itemId: existing.id, created: false };
    }

    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, draft.organizationId),
    });
    const orgLabel = org?.name ?? `org #${draft.organizationId}`;
    const signalMeta = RECOURSE_SIGNAL_CARD_META[draft.signalType] ?? {
      label: "A negative customer signal",
      urgencyScore: 70,
    };

    const arbiter = await arbitrateInboxInsert(
      "B",
      `Recourse reply waiting: draft #${draftId}`,
      { itemType: "recourse_draft", draftId, organizationId: draft.organizationId },
    );

    const [item] = await db.insert(decisionsInboxItems).values({
      itemType: "recourse_draft",
      riskLevel: "high",
      urgencyScore: signalMeta.urgencyScore,
      sophieAnalysis:
        `${signalMeta.label} from "${orgLabel}" — a personal reply is drafted and ` +
        "waiting. The recourse doctrine is a same-hour human reply: review, edit, " +
        "and send it (or dismiss it) on the Recourse queue.",
      recommendedAction:
        "Open the Recourse queue, read the customer's own words, edit the drafted " +
        "reply, and send or dismiss it. This card clears itself when you do.",
      recommendedActionLabel: "Reply to Customer",
      // Nothing executes from this card — the send (with the founder's edited
      // body) happens exclusively on the deep surface.
      actionPayload: null,
      organizationId: draft.organizationId,
      ownerAgentCodename: this.inferAgent("recourse_draft"),
      contextBundle: {
        sourceRecourseDraftId: draftId,
        deepLink: meta.deepLink,
        deepLinkLabel: "Open the Recourse queue",
        orgName: org?.name ?? null,
        signalType: draft.signalType,
      },
      status: arbiter.status,
      deferredUntil: arbiter.deferredUntil,
    }).returning();

    return { itemId: item?.id ?? null, created: true };
  },

  /**
   * X-A slice 1 — file a portal abuse report as a NATIVE decisions-door item
   * (one event hop: the portal's report POST → this row). Class B through the
   * arbiter like every machine-initiated insert; riskLevel high — a person on
   * an external portal surface is telling the founder something is wrong with
   * a page a customer org put in front of them.
   *
   * Free-text discipline (same as createFromAppeal): the reporter's verbatim
   * reason is REPORTER-TYPED and this row's sophieAnalysis feeds model-read
   * surfaces (decisionLogRag, companyMind) — so the verbatim lives ONLY in
   * contextBundle.reporterReason (bounded), never in the analysis text.
   *
   * Dedupe: one OPEN (pending/deferred) abuse_report per (organizationId,
   * pagePath) — repeat reports of the same page return the existing card
   * (created: false) instead of stacking rows; the endpoint's rate limiter
   * caps velocity so the report path cannot itself become a spam vector.
   */
  async createFromAbuseReport(input: {
    /** Portal path being reported, e.g. "/portal/<token-prefix…>". */
    pagePath: string | null;
    /** Reporter-supplied reason — verbatim, bounded, contextBundle-only. */
    reason: string;
    /** Lender org the reported page belongs to, when resolvable. */
    organizationId: number | null;
    /** Note behind the portal page, when resolvable. */
    noteId: number | null;
    /** The reported org's trust tier at filing time (triage context). */
    orgTrustTier?: string | null;
    reporterIp?: string | null;
    reporterUserAgent?: string | null;
  }): Promise<{ itemId: number | null; created: boolean }> {
    const reason = (input.reason ?? "").trim().slice(0, ABUSE_REPORT_REASON_MAX_CHARS);
    if (!reason) return { itemId: null, created: false };
    const pagePath = input.pagePath
      ? input.pagePath.slice(0, ABUSE_REPORT_PAGE_PATH_MAX_CHARS)
      : null;

    const existing = await db.query.decisionsInboxItems.findFirst({
      where: and(
        eq(decisionsInboxItems.itemType, ABUSE_REPORT_ITEM_TYPE),
        or(
          eq(decisionsInboxItems.status, "pending"),
          eq(decisionsInboxItems.status, "deferred"),
        ),
        // NULL-safe: `->>'pagePath' = 'null'` would never match SQL NULL, so
        // null-page reports would never dedupe (fleet-6 verifier catch).
        pagePath == null
          ? sql`${decisionsInboxItems.contextBundle}->>'pagePath' IS NULL`
          : sql`${decisionsInboxItems.contextBundle}->>'pagePath' = ${pagePath}`,
        input.organizationId == null
          ? isNull(decisionsInboxItems.organizationId)
          : eq(decisionsInboxItems.organizationId, input.organizationId),
      ),
    });
    // Dedupe predicate re-applied in process so unit tests pin the
    // open-card-only semantics independent of the SQL layer (A1 pattern).
    if (
      existing &&
      existing.itemType === ABUSE_REPORT_ITEM_TYPE &&
      (existing.status === "pending" || existing.status === "deferred") &&
      (existing.contextBundle?.pagePath ?? null) === (pagePath ?? null) &&
      (existing.organizationId ?? null) === (input.organizationId ?? null)
    ) {
      return { itemId: existing.id, created: false };
    }

    const orgLabel =
      input.organizationId != null ? `org #${input.organizationId}` : "an unresolved org";
    const arbiter = await arbitrateInboxInsert(
      "B",
      `Portal abuse report: ${pagePath ?? "unknown page"}`,
      {
        itemType: ABUSE_REPORT_ITEM_TYPE,
        pagePath: pagePath ?? undefined,
        organizationId: input.organizationId ?? undefined,
      },
    );

    const [item] = await db.insert(decisionsInboxItems).values({
      itemType: ABUSE_REPORT_ITEM_TYPE,
      riskLevel: "high",
      urgencyScore: 80,
      // NO reporter free text here — see the free-text discipline above.
      sophieAnalysis:
        `A visitor on an external portal page reported it as suspicious or abusive ` +
        `(page belongs to ${orgLabel}). Their reason is quoted verbatim on this card's ` +
        `context — read it and decide whether this is customer misconduct, a phishing ` +
        `attempt, or a false alarm.`,
      recommendedAction:
        "Read the reporter's reason, inspect the reported page and the owning org, " +
        "and decide: no action, contact the org, or start the (founder-only) " +
        "suspension conversation.",
      recommendedActionLabel: "Review Abuse Report",
      // Nothing auto-executes from an abuse report — suspensions and every
      // other consequence stay founder-only decisions.
      actionPayload: null,
      organizationId: input.organizationId,
      ownerAgentCodename: this.inferAgent(ABUSE_REPORT_ITEM_TYPE),
      contextBundle: {
        pagePath,
        reporterReason: reason,
        ...(input.noteId != null ? { noteId: input.noteId } : {}),
        ...(input.orgTrustTier ? { orgTrustTier: input.orgTrustTier } : {}),
        ...(input.reporterIp ? { reporterIp: input.reporterIp } : {}),
        ...(input.reporterUserAgent
          ? { reporterUserAgent: input.reporterUserAgent.slice(0, 300) }
          : {}),
      },
      status: arbiter.status,
      deferredUntil: arbiter.deferredUntil,
    }).returning();

    return { itemId: item?.id ?? null, created: true };
  },

  /**
   * Wave S · S5 — file a cross-charter CONFLICT MEMO as a NATIVE decisions-door
   * item. The memo object arrives fully built and already vetted by
   * conflictMemo.evaluateContention: the safety ladder does not decide it, the
   * council was genuinely divided, and the contention is a registered one.
   * This method's whole job is the row.
   *
   * Class C through the arbiter, riskLevel medium: a contention is a
   * CONSIDERED decision, not an emergency. Anything that IS an emergency was
   * refused upstream by the ladder guard and never reached here — routing a
   * memo at Class B would mean the machine interrupts the founder for a
   * negotiation as loudly as for a fire.
   *
   * Two invariants this row exists to hold:
   *   • actionPayload is ALWAYS null — a memo can never execute, so adopting
   *     a position is something the founder does, not something a tap triggers.
   *   • ONE open memo per fingerprint — the same fight never stacks two cards.
   */
  async createFromConflictMemo(
    memo: ConflictMemoRow,
  ): Promise<{ itemId: number | null; created: boolean }> {
    const existing = await db.query.decisionsInboxItems.findFirst({
      where: and(
        eq(decisionsInboxItems.itemType, CONFLICT_MEMO_ITEM_TYPE),
        or(
          eq(decisionsInboxItems.status, "pending"),
          eq(decisionsInboxItems.status, "deferred"),
        ),
        sql`${decisionsInboxItems.contextBundle}->>'fingerprint' = ${memo.fingerprint}`,
      ),
    });
    // Open-card-only re-check in process so unit tests pin the semantics
    // independent of the SQL layer (the A1 / abuse_report pattern).
    if (
      existing &&
      existing.itemType === CONFLICT_MEMO_ITEM_TYPE &&
      (existing.status === "pending" || existing.status === "deferred") &&
      existing.contextBundle?.fingerprint === memo.fingerprint
    ) {
      return { itemId: existing.id, created: false };
    }

    const arbiter = await arbitrateInboxInsert("C", `Conflict memo: ${memo.label}`, {
      itemType: CONFLICT_MEMO_ITEM_TYPE,
      contention: memo.contention,
      fingerprint: memo.fingerprint,
    });

    const sides = memo.positions
      .map((p) => `${p.charter} wants: ${p.recommendation}`)
      .join(" ");
    const [item] = await db.insert(decisionsInboxItems).values({
      itemType: CONFLICT_MEMO_ITEM_TYPE,
      riskLevel: "medium",
      urgencyScore: 55,
      sophieAnalysis:
        `${memo.label} — two charters want opposite things and the council split ` +
        `${Math.round(memo.council.agreement * 100)}/${Math.round(memo.council.disagreement * 100)} ` +
        `across ${memo.council.votes} voice(s). ${sides} Both positions, with their cost and ` +
        `risk reads, are on this card. Neither position is a stabilize move, so the ` +
        `safety ladder did not decide this one — that check reads the two positions' ` +
        `move kinds, not live incident or envelope state.`,
      // The panel's measured agreement IS the confidence — never a stronger
      // claim. Scaled to the column's 0-100 integer convention: storing the
      // raw 0..1 fraction would truncate to 0 and make a 3-of-4 council read
      // "not sure" on the card (naturalConfidence bands at 85/60), which is a
      // badge claiming weaker evidence than the derivation supports.
      sophieConfidenceScore: Math.round(memo.council.agreement * 100),
      recommendedAction: memo.question,
      recommendedActionLabel: "Rule on this contention",
      // A memo executes NOTHING. Adopting a position is the founder's act.
      actionPayload: null,
      ownerAgentCodename: this.inferAgent(CONFLICT_MEMO_ITEM_TYPE),
      contextBundle: {
        conflictMemo: memo,
        fingerprint: memo.fingerprint,
        // Built by the memo, not here: the `adopt_<charter>` key is what the
        // repeat-resolution reader matches on, so it gets exactly one author.
        options: memo.options,
        ...(memo.standingOrderProposal
          ? { standingOrderProposal: memo.standingOrderProposal }
          : {}),
      },
      status: arbiter.status,
      deferredUntil: arbiter.deferredUntil,
    }).returning();

    return { itemId: item?.id ?? null, created: true };
  },

  /**
   * F2 slice 1 — close a mirror card because its DEEP SURFACE disposed the
   * source row (verdict rendered / reply sent / draft dismissed). The founder
   * acted on the system of record, so the card resolves with resolvedBy
   * "founder_deep_surface" (→ the "You reviewed" bucket, never
   * "Auto-handled") and the deep surface's reason line lands in
   * founderModification — the same column every door disposition writes its
   * reason to. Best-effort by contract: callers never fail their disposition
   * on a mirror-resolution failure.
   */
  async resolveMirrorItem(input: {
    itemType: MirroredQueueItemType;
    sourceId: number;
    status: "approved" | "rejected";
    detail: string;
  }): Promise<{ resolved: boolean; itemId: number | null }> {
    const meta = MIRRORED_QUEUE_ITEM_TYPES[input.itemType];
    const existing = await db.query.decisionsInboxItems.findFirst({
      where: and(
        eq(decisionsInboxItems.itemType, input.itemType),
        or(
          eq(decisionsInboxItems.status, "pending"),
          eq(decisionsInboxItems.status, "deferred"),
        ),
        sql`${decisionsInboxItems.contextBundle}->>${meta.bundleKey} = ${String(input.sourceId)}`,
      ),
    });
    // Open-card-only re-check in process (A1 pattern) — a resolved mirror is
    // never overwritten.
    if (
      !existing ||
      existing.itemType !== input.itemType ||
      (existing.status !== "pending" && existing.status !== "deferred") ||
      Number(existing.contextBundle?.[meta.bundleKey]) !== input.sourceId
    ) {
      return { resolved: false, itemId: null };
    }

    await db.update(decisionsInboxItems)
      .set({
        status: input.status,
        resolvedAt: new Date(),
        resolvedBy: "founder_deep_surface",
        founderModification: normalizeDispositionReason(input.detail) ?? null,
        updatedAt: new Date(),
      })
      .where(eq(decisionsInboxItems.id, existing.id));
    return { resolved: true, itemId: existing.id };
  },

  /** Returns pending items sorted by urgencyScore descending. */
  async getPendingItems() {
    return db.query.decisionsInboxItems.findMany({
      where: eq(decisionsInboxItems.status, "pending"),
      orderBy: desc(decisionsInboxItems.urgencyScore),
    });
  },

  /**
   * Approve: mark approved, then EXECUTE the action payload. v3 closes the
   * loop. Jarvis 2.3: `chosenOptionText` records the tapped card option
   * (`option:<key> — <label>`) into founderOverrideAction so the log shows
   * WHICH option answered the card. F2: the founder's optional one-line
   * `reason` lands in founderModification (see normalizeDispositionReason).
   */
  async approve(itemId: number, chosenOptionText?: string, reason?: string): Promise<{ executed: boolean; detail?: string }> {
    // Mirror cards are presence + a deep link — dispositions happen on the
    // deep surface (the guard lives HERE, not only in the door routes, so
    // founder-chat's approve_decision tool and any future caller cannot mark
    // a mirror approved while the customer's real row stays open).
    await this.refuseIfMirror(itemId, "approve");
    const reasonText = normalizeDispositionReason(reason);
    // Mark as approved
    await db.update(decisionsInboxItems)
      .set({
        status: "approved",
        resolvedAt: new Date(),
        resolvedBy: "founder",
        updatedAt: new Date(),
        ...(chosenOptionText ? { founderOverrideAction: chosenOptionText } : {}),
        ...(reasonText ? { founderModification: reasonText } : {}),
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
      // F2 mirror cards — owned by the agents whose deep surfaces they
      // mirror: Quinn (Chief of Alignment) reviews appeals, Rafe (CCO) owns
      // the recourse loop. Both are canonical roster codenames
      // (shared/schema/agent-codenames.ts).
      appeal_review: "quinn",
      recourse_draft: "rafe",
      // X-A — portal abuse reports are a trust/alignment signal; Quinn
      // (Chief of Alignment) owns triage. NATIVE item, not a mirror.
      abuse_report: "quinn",
      // S5 — a cross-charter conflict memo is the MACHINE asking the founder
      // to rule on its own internal contention, so Solene owns it for the same
      // reason she owns shadow_promotion_request: only the founder's tap
      // settles a question about what the machine should do.
      conflict_memo: "solene",
    };
    return typeToAgent[itemType] || "sophie_csm";
  },

  /**
   * F2 reasons-on-disposition: `reason` keeps its legacy write into
   * founderOverrideAction (every learning-loop reader keys on that column)
   * AND lands normalized in founderModification — the one column every
   * disposition verb now writes its reason to.
   */
  async reject(itemId: number, reason?: string): Promise<void> {
    await this.refuseIfMirror(itemId, "reject");
    const reasonText = normalizeDispositionReason(reason);
    await db.update(decisionsInboxItems)
      .set({
        status: "rejected",
        resolvedAt: new Date(),
        resolvedBy: "founder",
        founderOverrideAction: reason,
        ...(reasonText ? { founderModification: reasonText } : {}),
        updatedAt: new Date(),
      })
      .where(eq(decisionsInboxItems.id, itemId));
  },

  async defer(itemId: number, hours = 24, reason?: string): Promise<void> {
    const reasonText = normalizeDispositionReason(reason);
    const deferredUntil = new Date(Date.now() + hours * 60 * 60 * 1000);
    await db.update(decisionsInboxItems)
      .set({
        status: "deferred",
        deferredUntil,
        ...(reasonText ? { founderModification: reasonText } : {}),
        updatedAt: new Date(),
      })
      .where(eq(decisionsInboxItems.id, itemId));
  },

  async override(itemId: number, customAction: string, reason?: string): Promise<void> {
    await this.refuseIfMirror(itemId, "override");
    const reasonText = normalizeDispositionReason(reason);
    await db.update(decisionsInboxItems)
      .set({
        status: "approved",
        resolvedAt: new Date(),
        resolvedBy: "founder",
        founderOverrideAction: customAction,
        ...(reasonText ? { founderModification: reasonText } : {}),
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
    const rows = await db.query.decisionsInboxItems.findMany({
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
