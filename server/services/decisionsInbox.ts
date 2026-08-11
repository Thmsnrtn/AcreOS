import { db } from "../db";
import {
  decisionsInboxItems, supportTickets, systemAlerts, featureRequests,
  organizations, paxDecisionAppeals, paxRefusalPayloads, recourseDrafts,
  autopilotPendingActions,
} from "@shared/schema";
import { eq, and, desc, gte, isNull, or, lt, sql } from "drizzle-orm";
import { executeAction, hasExecutor } from "./agentActionExecutors";
import { getHand } from "./autopilot/hands/registry";
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
 * F2 slices 1–2 (handoff P6 §3 — "one decision queue") — MIRROR CARDS.
 *
 * Founder decision inflows that live on their own disposition surface are
 * mirrored into the decisions door as cards pointing back at that surface:
 *
 *   appeal_review   ← pax_decision_appeals   (/founder/appeals — a customer
 *                     is waiting on an upheld/reversed verdict)
 *   recourse_draft  ← recourse_drafts        (/founder/recourse — a drafted
 *                     personal reply to a negative signal, same-hour doctrine)
 *   witnessed_send  ← autopilot_pending_actions (slice 2 — a hand the autopilot
 *                     drafted and FROZE; the "Waiting on you to send" control
 *                     on the Decisions door owns the tap)
 *
 * Deliberately an ADAPTER, not a data migration: the deep stores stay the
 * system of record and their surfaces keep the full disposition forms
 * (verdict + reviewNotes + customerMessage; edit-and-send; the frozen args +
 * content-hash re-verification). The mirror card carries presence + ranking +
 * a pointer; it never executes anything (actionPayload is always null) and it
 * resolves ITSELF when the source row is disposed (see resolveMirrorItem +
 * the hooks in routes-founder-appeals.ts / routes-founder-recourse.ts /
 * autopilot/pendingHands.ts). The door's generic approve/reject/override
 * refuse mirror cards and point at the owning surface
 * (routes-founder-intelligence.ts + refuseIfMirror at the service altitude).
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
  /**
   * F2 slice 2 — the witnessed-send queue. The disposition control is the
   * "Waiting on you to send" card ON the Decisions door itself (it renders the
   * frozen args verbatim so the founder reads EXACTLY what will send) and it
   * posts to /api/founder/autopilot/pending-actions/:id/{approve,reject},
   * which re-verifies the sha256 content hash and fires executeHandWitnessed.
   *
   * MIRROR, never NATIVE, for a safety reason and not a stylistic one: the
   * queue's generic approve runs `executeAction` against the registered agent
   * executors, which know nothing about the frozen args or the content hash.
   * Approving a frozen hand from the queue would mark the card approved while
   * the send never happened — the exact "silent hiding" the slice-5 mirror
   * rule exists to prevent. So refuseIfMirror covers it and the card never
   * carries an actionPayload.
   *
   * deepLink is the door itself because the control lives there; the card
   * therefore does NOT put a `deepLink` in its contextBundle (that would
   * render a link back to the page you are already on). The pointer is a
   * sentence in recommendedAction instead. The registry entry still supplies
   * refuseMirrorDisposition's message.
   */
  witnessed_send: {
    deepLink: "/founder/decisions",
    surfaceName: "Waiting on you to send",
    bundleKey: "sourcePendingActionId",
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
 * F2 slice 2 — inflow A: the AUTOPILOT PENDING HANDS (witnessed-send) queue.
 *
 * itemType deliberately equals the class key the door already uses for the
 * witnessed-send section, so `doNothingContract("witnessed_send")` — the
 * verified sentence about the 24h TTL and "nothing sends without your tap" —
 * covers the mirror card and the frozen card identically and can never drift
 * between them.
 */
export const WITNESSED_SEND_ITEM_TYPE = "witnessed_send";

/**
 * Per-hand rank for the witnessed-send mirror. Grounded in the REGISTERED
 * hands (server/services/autopilot/hands/*: apply_refund, dunning_action,
 * run_ad_campaign, send_email, send_sms, send_push, send_letter) and in each
 * spec's own `movesMoney` flag — not invented bands.
 *
 * Placement inside the existing severity/urgency grammar, so a frozen draft
 * cannot jump the queue by accident:
 *   80 money hands  — level with a BILLING support escalation (the customer's
 *                     money), below a cancellation-recourse reply (85), below
 *                     a critical churn/alert/P0 (90-95).
 *   62 customer sends — above a general support escalation (50) because a
 *                     drafted outward message is time-sensitive, below every
 *                     high-risk class.
 * An UNKNOWN hand (a newly registered one this map has not been taught) falls
 * back to the customer-send band and says so in the card, rather than being
 * silently ranked as if it were understood.
 */
const WITNESSED_SEND_CARD_META: Record<
  string,
  { riskLevel: "medium" | "high"; urgencyScore: number; whatItDoes: string }
> = {
  apply_refund: { riskLevel: "high", urgencyScore: 80, whatItDoes: "moves money (a refund)" },
  dunning_action: { riskLevel: "high", urgencyScore: 80, whatItDoes: "moves money (a charge retry)" },
  run_ad_campaign: { riskLevel: "high", urgencyScore: 80, whatItDoes: "spends money (ad budget)" },
  send_email: { riskLevel: "medium", urgencyScore: 62, whatItDoes: "sends a customer-facing email" },
  send_sms: { riskLevel: "medium", urgencyScore: 62, whatItDoes: "sends a customer-facing SMS" },
  send_push: { riskLevel: "medium", urgencyScore: 62, whatItDoes: "sends a customer-facing push" },
  send_letter: { riskLevel: "medium", urgencyScore: 62, whatItDoes: "sends a physical letter" },
};

const WITNESSED_SEND_FALLBACK = {
  riskLevel: "medium" as const,
  urgencyScore: 62,
  whatItDoes: "is a hand this queue has not been taught to describe",
};

/**
 * The rank band for a hand this queue has no entry for.
 *
 * The map above is keyed by hand NAME, which means it duplicates a fact the
 * registry already owns. Register an eighth money-moving hand and the frozen
 * card is correctly witnessed — `registry.ts` forces `requiresApproval` for
 * exactly these hands — but it would rank 62/medium, alongside a marketing
 * email, silently and forever. Since ranking IS the reason the mirror exists,
 * that is the one thing the fallback must not get wrong.
 *
 * So derive the band from the registry, using the same predicate `autoWitness`
 * uses to decide a hand moves money. The name map keeps only what it is
 * genuinely better at: the human sentence describing what the hand does.
 */
function witnessedSendBandFor(handName: string): {
  riskLevel: "medium" | "high";
  urgencyScore: number;
} {
  try {
    const spec = getHand(handName);
    const movesMoney = spec?.movesMoney === true || spec?.domain === "finance";
    if (movesMoney) return { riskLevel: "high", urgencyScore: 80 };
  } catch {
    /* registry unavailable → fall through to the conservative default */
  }
  return { riskLevel: WITNESSED_SEND_FALLBACK.riskLevel, urgencyScore: WITNESSED_SEND_FALLBACK.urgencyScore };
}

/**
 * F2 slice 2 — inflow B: the DATED-OBLIGATION COUNTDOWNS (handoff P6 §3,
 * "the dated-obligation countdowns (Part 5 §3)").
 *
 * NATIVE, not a mirror: server/services/datedObligations.ts is a STATIC
 * registry (a handful of rows in code), so there is no deep surface that
 * "disposes" a row — nothing to link to and nothing to resolve the card from
 * a tap. The queue row IS the founder's record of the decision, so every
 * disposition verb works on it directly.
 *
 * Honesty contract, stated on the card itself: answering the card does NOT
 * discharge the obligation. The date passes regardless; the alertSpine pager
 * keeps firing at each milestone (that is a separate PROMPT channel — see the
 * same pattern on support P0s), and the card only closes ITSELF when the
 * registry row is actually discharged (removed, or its `due` moved) — see
 * resolveDischargedObligationCards.
 */
export const DATED_OBLIGATION_ITEM_TYPE = "dated_obligation";

/**
 * A stable per-obligation anchor. Deliberately the SAME derivation the
 * alertSpine dedupeKey uses in founderBriefing.ts (envVar where one exists,
 * else a slug of the what-line) so the card and the page refer to the same
 * thing by the same name.
 */
export function datedObligationKey(o: { what: string; envVar?: string }): string {
  return o.envVar ?? o.what.toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

/**
 * The milestone label for a countdown card. Mirrors founderBriefing's
 * dedupeKey suffix exactly: the days-left threshold, or "overdue" past due.
 */
export function datedObligationMilestone(daysLeft: number): string {
  return daysLeft < 0 ? "overdue" : String(daysLeft);
}

/**
 * Countdown rank. Kept BELOW the fire classes (critical_alert 95, support P0
 * 95, critical churn 90-100) so a calendar row can never outrank a live
 * incident, and level with a cancellation-recourse reply (85) at ≤2 days.
 */
function datedObligationRank(daysLeft: number): {
  riskLevel: "medium" | "high" | "critical";
  urgencyScore: number;
} {
  if (daysLeft < 0) return { riskLevel: "critical", urgencyScore: 90 };
  if (daysLeft <= 2) return { riskLevel: "critical", urgencyScore: 85 };
  if (daysLeft <= 7) return { riskLevel: "high", urgencyScore: 60 };
  return { riskLevel: "medium", urgencyScore: 40 };
}

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
   * F2 slice 2 (inflow A) — mirror a FROZEN AUTOPILOT HAND
   * (autopilot_pending_actions) into the one ranked queue. Called best-effort
   * from pendingHands.proposePendingHand right after the freeze; a mirror
   * failure must never turn a freeze into a send or a refusal.
   *
   * Class B through the arbiter (a drafted outward action is a real interrupt
   * the founder must see). Dedupe: one OPEN (pending/deferred) card per frozen
   * action via contextBundle.sourcePendingActionId — proposePendingHand itself
   * reuses an identical live row, so a re-proposed draft cannot mint a second
   * card either.
   *
   * FREE-TEXT DISCIPLINE (same rule as createFromAppeal): the frozen `args`
   * hold the actual outbound body, recipient addresses and subjects. This
   * row's sophieAnalysis feeds model-read surfaces (decisionLogRag,
   * companyMind), so NONE of it is copied here — not even the machine-written
   * summary, which embeds the recipient. The verbatim stays where the founder
   * reads it before tapping: the "Waiting on you to send" card.
   */
  async createFromPendingHand(
    pendingActionId: number,
    opts?: { now?: number },
  ): Promise<{ itemId: number | null; created: boolean }> {
    const now = opts?.now ?? Date.now();
    const action = await db.query.autopilotPendingActions.findFirst({
      where: eq(autopilotPendingActions.id, pendingActionId),
    });
    if (!action) return { itemId: null, created: false };
    // Only a LIVE frozen action earns a card: an approved/executed/rejected
    // row is already disposed, and an expired one can never send (TTL_MS), so
    // mirroring either would resurrect a decided item.
    if (action.status !== "pending") return { itemId: null, created: false };
    if (!action.expiresAt || action.expiresAt.getTime() <= now) {
      return { itemId: null, created: false };
    }

    const existing = await db.query.decisionsInboxItems.findFirst({
      where: and(
        eq(decisionsInboxItems.itemType, WITNESSED_SEND_ITEM_TYPE),
        or(
          eq(decisionsInboxItems.status, "pending"),
          eq(decisionsInboxItems.status, "deferred"),
        ),
        sql`${decisionsInboxItems.contextBundle}->>'sourcePendingActionId' = ${String(pendingActionId)}`,
      ),
    });
    // Dedupe predicate re-applied in process so unit tests pin the
    // open-card-only semantics independent of the SQL layer (A1 pattern).
    if (
      existing &&
      existing.itemType === WITNESSED_SEND_ITEM_TYPE &&
      (existing.status === "pending" || existing.status === "deferred") &&
      Number(existing.contextBundle?.sourcePendingActionId) === pendingActionId
    ) {
      return { itemId: existing.id, created: false };
    }

    // Prose from the name map (it is the better source for a human sentence);
    // RANK from the registry, so an unmapped money-moving hand cannot quietly
    // rank as a customer send.
    const named = WITNESSED_SEND_CARD_META[action.handName];
    const band = named
      ? { riskLevel: named.riskLevel, urgencyScore: named.urgencyScore }
      : witnessedSendBandFor(action.handName);
    const meta = {
      riskLevel: band.riskLevel,
      urgencyScore: band.urgencyScore,
      whatItDoes: named?.whatItDoes ?? WITNESSED_SEND_FALLBACK.whatItDoes,
    };
    const arbiter = await arbitrateInboxInsert(
      "B",
      `Frozen send awaiting your tap: ${action.handName} (#${pendingActionId})`,
      {
        itemType: WITNESSED_SEND_ITEM_TYPE,
        pendingActionId,
        handName: action.handName,
        domain: action.domain ?? undefined,
      },
    );

    const [item] = await db.insert(decisionsInboxItems).values({
      itemType: WITNESSED_SEND_ITEM_TYPE,
      riskLevel: meta.riskLevel,
      urgencyScore: meta.urgencyScore,
      sophieAnalysis:
        `The autopilot drafted a "${action.handName}" hand` +
        `${action.domain ? ` in the ${action.domain} domain` : ""} and FROZE it — it ` +
        `${meta.whatItDoes}, so it sends only on your tap. Nothing has been sent.`,
      recommendedAction:
        'Read the exact text on the "Waiting on you to send" card on this page — that card ' +
        "carries the frozen wording verbatim and the Approve & send / Reject buttons. " +
        "This card is its place in the ranked queue; it clears itself when you decide there.",
      recommendedActionLabel: "Review the frozen send",
      // Nothing executes from this card. The ONLY executor is
      // executeHandWitnessed, reached through approvePendingHand, which
      // re-verifies the content hash first.
      actionPayload: null,
      organizationId: null,
      ownerAgentCodename: this.inferAgent(WITNESSED_SEND_ITEM_TYPE),
      contextBundle: {
        sourcePendingActionId: pendingActionId,
        handName: action.handName,
        domain: action.domain ?? null,
        // No deepLink key on purpose — the control is on this same page, and a
        // link back to /founder/decisions from /founder/decisions is noise.
        disposeOn: 'the "Waiting on you to send" card on this page',
        expiresAt: action.expiresAt.toISOString(),
        handKnownToQueue: Object.prototype.hasOwnProperty.call(
          WITNESSED_SEND_CARD_META,
          action.handName,
        ),
      },
      status: arbiter.status,
      deferredUntil: arbiter.deferredUntil,
    }).returning();

    return { itemId: item?.id ?? null, created: true };
  },

  /**
   * F2 slice 2 (inflow A) — close every witnessed-send mirror whose frozen
   * action has passed its 24h TTL. approvePendingHand/rejectPendingHand
   * resolve the card on a founder tap; an untouched draft simply ages out with
   * no event, so this sweep is what keeps an un-actionable card from sitting
   * in "Needs you" forever. Called from the daily founderBriefing sweep, so a
   * card can linger at most one sweep past expiry.
   *
   * Resolved as "auto_resolved" with resolvedBy "witnessed_send_expired", NOT
   * as "rejected": the decision-log buckets send any human-ish resolvedBy to
   * the "You reviewed" bucket, and the founder did not review this — it aged
   * out untouched. "Auto-handled" is the only bucket that is true of it, and
   * the reason line states plainly that nothing was sent (never that the
   * founder declined it).
   */
  async resolveExpiredWitnessedSendMirrors(
    now = new Date(),
  ): Promise<{ resolved: number }> {
    const open = await db.query.decisionsInboxItems.findMany({
      where: and(
        eq(decisionsInboxItems.itemType, WITNESSED_SEND_ITEM_TYPE),
        or(
          eq(decisionsInboxItems.status, "pending"),
          eq(decisionsInboxItems.status, "deferred"),
        ),
      ),
    });
    let resolved = 0;
    for (const row of open) {
      if (row.itemType !== WITNESSED_SEND_ITEM_TYPE) continue;
      if (row.status !== "pending" && row.status !== "deferred") continue;
      const expiresAtRaw = row.contextBundle?.expiresAt;
      const expiresAt = typeof expiresAtRaw === "string" ? Date.parse(expiresAtRaw) : NaN;
      // A card with no readable expiry is left ALONE — refusing to guess beats
      // closing a live send on a parse failure.
      if (!Number.isFinite(expiresAt) || expiresAt > now.getTime()) continue;
      await db.update(decisionsInboxItems)
        .set({
          status: "auto_resolved",
          resolvedAt: now,
          resolvedBy: "witnessed_send_expired",
          founderModification:
            "The frozen draft passed its 24-hour approval window and can never send. " +
            "Nothing was sent; the autopilot must re-draft it for a fresh approval.",
          updatedAt: now,
        })
        .where(eq(decisionsInboxItems.id, row.id));
      resolved += 1;
    }
    return { resolved };
  },

  /**
   * F2 slice 2 (inflow B) — file ONE countdown card for a dated obligation at
   * ONE page milestone. NATIVE (see DATED_OBLIGATION_ITEM_TYPE): every
   * disposition verb works on it, but nothing executes — actionPayload is
   * always null, so the founder's tap IS the action, exactly like conflict_memo
   * and shadow_promotion_request.
   *
   * Dedupe is on (obligationKey, milestone, due) at ANY status, not just open
   * cards: once the founder has answered the T-7 card, the sweep must not
   * re-ask it tomorrow, and the past-due milestone (which the daily sweep hits
   * every day) must file exactly one card. Renewing the registry row moves
   * `due`, which changes the identity and starts a fresh countdown — which is
   * the correct behavior, not a bug.
   */
  async createFromDatedObligation(input: {
    what: string;
    due: string;
    owner: string;
    kind: string;
    note: string;
    daysLeft: number;
    envVar?: string;
    vendor?: string;
    soleSourceFor?: string;
  }): Promise<{ itemId: number | null; created: boolean }> {
    const obligationKey = datedObligationKey(input);
    const milestone = datedObligationMilestone(input.daysLeft);

    const existing = await db.query.decisionsInboxItems.findFirst({
      where: and(
        eq(decisionsInboxItems.itemType, DATED_OBLIGATION_ITEM_TYPE),
        sql`${decisionsInboxItems.contextBundle}->>'obligationKey' = ${obligationKey}`,
        sql`${decisionsInboxItems.contextBundle}->>'milestone' = ${milestone}`,
        sql`${decisionsInboxItems.contextBundle}->>'due' = ${input.due}`,
      ),
    });
    // Predicate re-applied in process (A1 pattern) — and note it deliberately
    // ignores status: an ANSWERED milestone is never re-asked.
    if (
      existing &&
      existing.itemType === DATED_OBLIGATION_ITEM_TYPE &&
      existing.contextBundle?.obligationKey === obligationKey &&
      existing.contextBundle?.milestone === milestone &&
      existing.contextBundle?.due === input.due
    ) {
      return { itemId: existing.id, created: false };
    }

    const rank = datedObligationRank(input.daysLeft);
    const whenLine =
      input.daysLeft < 0
        ? `was due ${input.due} and is now ${Math.abs(input.daysLeft)} day(s) PAST DUE`
        : `falls due ${input.due}, in ~${input.daysLeft} day(s)`;

    const arbiter = await arbitrateInboxInsert(
      "B",
      `Dated obligation: ${input.what} (${milestone})`,
      { itemType: DATED_OBLIGATION_ITEM_TYPE, obligationKey, milestone, due: input.due },
    );

    const [item] = await db.insert(decisionsInboxItems).values({
      itemType: DATED_OBLIGATION_ITEM_TYPE,
      riskLevel: rank.riskLevel,
      urgencyScore: rank.urgencyScore,
      sophieAnalysis:
        `${input.what} ${whenLine}. Owner: ${input.owner}.` +
        `${input.soleSourceFor ? ` It is the sole source for ${input.soleSourceFor}.` : ""}` +
        ` ${input.note}`,
      recommendedAction:
        "Discharge it (renew the credential, do the review), then update or remove its row " +
        "in server/services/datedObligations.ts in the same change — that registry is the " +
        "record, and this card closes itself once the row no longer falls due on this date. " +
        "Answering the card records your decision; it does not move the date.",
      recommendedActionLabel: "Review obligation",
      // Nothing executes: the registry is static code, so there is no action to
      // run. The founder's tap IS the record.
      actionPayload: null,
      organizationId: null,
      ownerAgentCodename: this.inferAgent(DATED_OBLIGATION_ITEM_TYPE),
      contextBundle: {
        // Tap-sized options are what make a NATIVE card actually answerable on
        // the door — founder-decisions.tsx renders buttons ONLY from
        // contextBundle.options, so a native card without them is a card the
        // founder cannot dispose. Both labels name the founder's own assertion,
        // never a system claim: nothing here discharges the obligation, and the
        // approve route reports executed:false so the toast says so.
        options: sanitizeDecisionOptions([
          { key: "discharged", label: "Done — I've discharged it" },
          { key: "not_yet", label: "Not yet — raise it at the next milestone" },
        ]),
        obligationKey,
        milestone,
        due: input.due,
        daysLeft: input.daysLeft,
        kind: input.kind,
        owner: input.owner,
        ...(input.envVar ? { envVar: input.envVar } : {}),
        ...(input.vendor ? { vendor: input.vendor } : {}),
        ...(input.soleSourceFor ? { soleSourceFor: input.soleSourceFor } : {}),
      },
      status: arbiter.status,
      deferredUntil: arbiter.deferredUntil,
    }).returning();

    return { itemId: item?.id ?? null, created: true };
  },

  /**
   * F2 slice 2 (inflow B) — the countdown's SELF-RESOLUTION. An open card is
   * closed when the static registry no longer carries that obligation at that
   * date: the row was removed (discharged) or its `due` was moved (renewed).
   * That is the only "disposition" a static registry can express, so it is the
   * only thing this reads — it never guesses from the calendar alone.
   *
   * Resolved as "auto_resolved" with resolvedBy "obligation_registry" so it
   * lands in Auto-handled (truthfully: nothing needed the founder) rather than
   * in "You reviewed".
   */
  async resolveDischargedObligationCards(
    liveObligations: Array<{ what: string; due: string; envVar?: string }>,
    now = new Date(),
  ): Promise<{ resolved: number }> {
    const live = new Set(
      liveObligations.map((o) => `${datedObligationKey(o)}::${o.due}`),
    );
    const open = await db.query.decisionsInboxItems.findMany({
      where: and(
        eq(decisionsInboxItems.itemType, DATED_OBLIGATION_ITEM_TYPE),
        or(
          eq(decisionsInboxItems.status, "pending"),
          eq(decisionsInboxItems.status, "deferred"),
        ),
      ),
    });
    let resolved = 0;
    for (const row of open) {
      if (row.itemType !== DATED_OBLIGATION_ITEM_TYPE) continue;
      if (row.status !== "pending" && row.status !== "deferred") continue;
      const key = row.contextBundle?.obligationKey;
      const due = row.contextBundle?.due;
      // A card whose identity is unreadable is left ALONE rather than closed on
      // a guess (refuse-not-fabricate).
      if (typeof key !== "string" || typeof due !== "string") continue;
      if (live.has(`${key}::${due}`)) continue;
      await db.update(decisionsInboxItems)
        .set({
          status: "auto_resolved",
          resolvedAt: now,
          resolvedBy: "obligation_registry",
          founderModification:
            "The obligations registry no longer lists this row at this date — it was " +
            "discharged or renewed, so the countdown card closed itself.",
          updatedAt: now,
        })
        .where(eq(decisionsInboxItems.id, row.id));
      resolved += 1;
    }
    return { resolved };
  },

  /**
   * F2 slice 2 (inflow B) — the whole countdown sweep in one call, so the
   * producer (founderBriefing.ts, the existing daily loop that already pages
   * on these same milestones through alertSpine) adds exactly one line.
   *
   * Uses the SAME milestone gate as the pager (`daysLeft < 0 ||
   * pageThresholdsFor(o).includes(daysLeft)`) so the card and the page fire
   * together and neither invents an occasion the other does not recognize.
   */
  async syncDatedObligationCards(
    now = new Date(),
  ): Promise<{ filed: number; resolved: number }> {
    const { DATED_OBLIGATIONS, imminentObligations, pageThresholdsFor } =
      await import("./datedObligations");

    let filed = 0;
    for (const o of imminentObligations(now, 14)) {
      const atMilestone = o.daysLeft < 0 || pageThresholdsFor(o).includes(o.daysLeft);
      if (!atMilestone) continue;
      const res = await this.createFromDatedObligation({
        what: o.what,
        due: o.due,
        owner: o.owner,
        kind: o.kind,
        note: o.note,
        daysLeft: o.daysLeft,
        envVar: o.envVar,
        vendor: o.vendor,
        soleSourceFor: o.soleSourceFor,
      });
      if (res.created) filed += 1;
    }

    const { resolved } = await this.resolveDischargedObligationCards(
      DATED_OBLIGATIONS.map((o) => ({ what: o.what, due: o.due, envVar: o.envVar })),
      now,
    );
    return { filed, resolved };
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
    status: "approved" | "rejected" | "auto_resolved";
    detail: string;
    /**
     * WHO actually closed this. Defaults to the founder's own surface, which
     * was the only possibility when this was written — and that assumption
     * became a lie the moment a standing witness grant could approve a hand
     * while the founder was asleep. A machine send recorded as
     * `founder_deep_surface` files under "You reviewed" in the decision log,
     * so the "Auto-handled" bucket — whose entire purpose is *what the system
     * did in your absence* — never sees it, and the false sentence is then
     * ingested by `decisionLogRag` into the model-read corpus.
     *
     * Callers that are NOT a founder tap must say so.
     */
    resolvedBy?: string;
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
        resolvedBy: input.resolvedBy ?? "founder_deep_surface",
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
      // F2 slice 2 — the witnessed-send mirror. Solene owns it: the frozen
      // hand came from HER dispatch executor, and only the founder's tap
      // (approvePendingHand → executeHandWitnessed) ever sends it.
      witnessed_send: "solene",
      // F2 slice 2 — dated-obligation countdowns are a reliability signal (a
      // known calendar date passing with nothing watching), which is the same
      // class Sentinel owns for critical_alert.
      dated_obligation: "sentinel_devops",
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
