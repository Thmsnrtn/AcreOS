/**
 * Founder Autopilot — measurement loops (Elite Vision D2).
 *
 * "You cannot earn autonomy on a loop you don't measure." This closes three open
 * loops with their decision cores — the logic that turns a measurement into an
 * action the brain can then own:
 *
 *   • Support SLA      — first-reply + resolution timing + breach detection, so
 *                        the brain can prioritize a breaching ticket.
 *   • NPS → action     — a score becomes a segment + a concrete next play
 *                        (detractor → winback, promoter → referral ask).
 *   • KB auto-draft    — a clean, well-rated AI resolution becomes a draft KB
 *                        article (gated: only good resolutions seed the KB).
 *
 * All pure → unit-testable. The DB reads + the scheduled job that applies these
 * are thin mechanical wiring on top.
 */

// ── Support SLA ──────────────────────────────────────────────────────────────

export interface SlaTargets {
  firstReplyMinutes: number;
  resolutionMinutes: number;
}

/**
 * Flat default SLA: respond within 2h, resolve within 24h. Retained for
 * un-classified callers only — the support seam (routes-support-tickets +
 * decisionsInbox) now classifies every ticket into a severity class (O5,
 * handoff P5 §4) and passes `SLA_BY_SEVERITY[class]` instead.
 */
export const DEFAULT_SLA: SlaTargets = { firstReplyMinutes: 120, resolutionMinutes: 24 * 60 };

// ── Severity-class SLAs (O5 / handoff doctrine P5 §4) ────────────────────────
//
// Support items CLASSIFY at creation:
//   P0 — broken money / broken send rails → page the founder NOW
//   P1 — blocked workflow                 → same-day (resolve within 24h)
//   P2 — question                         → answered within 48h
//
// Pure: classification derives only from the ticket's category/priority/text,
// so it is unit-testable and can never invent a severity from data it wasn't
// given (refuse-not-fabricate: no signal ⇒ the conservative P2 floor).

export type SupportSeverityClass = "P0" | "P1" | "P2";

export interface SupportSeverityInput {
  category?: string | null;
  priority?: string | null;
  subject?: string | null;
  description?: string | null;
}

export interface SupportSeverityClassification {
  severityClass: SupportSeverityClass;
  /** Which signal fired — honest provenance for the queue card. */
  reason: string;
}

/**
 * Per-class SLA targets. P1 inherits the old flat default (2h/24h — "same
 * day"); P2 keeps the 2h first-reply floor (classification never loosens the
 * reply bar) with the doctrine's 48h resolution window; P0 tightens both.
 */
export const SLA_BY_SEVERITY: Record<SupportSeverityClass, SlaTargets> = {
  P0: { firstReplyMinutes: 30, resolutionMinutes: 4 * 60 },
  P1: { firstReplyMinutes: 120, resolutionMinutes: 24 * 60 },
  P2: { firstReplyMinutes: 120, resolutionMinutes: 48 * 60 },
};

/** Money-rail context: payments, charges, billing, payouts. */
const MONEY_SIGNAL =
  /\b(payment|payments|charge|charged|charges|billing|invoice|refund|payout|payouts|subscription|stripe|card|bank|escrow|deposit|wire)\b/i;
/** Send-rail context: outbound email/SMS/campaign delivery. */
const SEND_SIGNAL =
  /\b(e-?mails?|sms|text messages?|campaigns?|blasts?|send|sends|sending|sent|deliver|delivery|deliveries|delivered)\b/i;
/** Something is BROKEN (vs. a question about it). */
const BROKEN_SIGNAL =
  /\b(fail|fails|failed|failing|failure|failures|error|errors|erroring|broke|broken|breaks|down|outage|declined?|declines|declining|bounced?|bounces|bouncing|missing|lost|wrong|double[- ]charged?|charged twice|duplicate|stuck|blocked|crash|crashes|crashed|crashing|cannot|can'?t|won'?t|unable|not (?:working|sending|going out|arriving|received|receiving|loading|syncing|saving))\b/i;

/**
 * Classify a support ticket into a severity class at creation. Pure.
 *
 *   P0 — a money or send rail is BROKEN (context signal + broken signal), or
 *        the customer marked a billing ticket urgent.
 *   P1 — a workflow is blocked (broken signal without money/send context), or
 *        the ticket is a bug/technical report, or the customer marked it
 *        high/urgent.
 *   P2 — everything else (questions, requests, feedback).
 */
export function classifySupportSeverity(
  input: SupportSeverityInput,
): SupportSeverityClassification {
  const category = (input.category ?? "").toLowerCase();
  const priority = (input.priority ?? "").toLowerCase();
  const text = `${input.subject ?? ""}\n${input.description ?? ""}`;

  const moneyContext =
    MONEY_SIGNAL.test(text) || category === "billing" || category === "billing_payment";
  const sendContext = SEND_SIGNAL.test(text);
  const broken = BROKEN_SIGNAL.test(text);

  if (broken && (moneyContext || sendContext)) {
    return {
      severityClass: "P0",
      reason: moneyContext ? "broken-money signal" : "broken-send signal",
    };
  }
  if (moneyContext && priority === "urgent") {
    return { severityClass: "P0", reason: "urgent billing ticket" };
  }
  if (broken) {
    return { severityClass: "P1", reason: "blocked-workflow signal" };
  }
  if (category === "bug" || category === "bug_report" || category === "technical") {
    return { severityClass: "P1", reason: `category: ${category}` };
  }
  if (priority === "urgent" || priority === "high") {
    return { severityClass: "P1", reason: `customer-set priority: ${priority}` };
  }
  return { severityClass: "P2", reason: "question / no blocking signal" };
}

/** The SLA targets for a severity class. Pure. */
export function slaTargetsFor(severityClass: SupportSeverityClass): SlaTargets {
  return SLA_BY_SEVERITY[severityClass];
}

/**
 * The visible SLA clock: when this ticket's class says it must be RESOLVED,
 * counted from ticket creation (never from escalation time — escalating late
 * must not reset the clock). Pure.
 */
export function slaDeadlineFor(
  severityClass: SupportSeverityClass,
  ticketCreatedAt: Date,
): Date {
  return new Date(
    ticketCreatedAt.getTime() + SLA_BY_SEVERITY[severityClass].resolutionMinutes * 60000,
  );
}

export interface SlaInput {
  createdAt: Date;
  /** When the first agent/Pax reply went out (from the first outbound message). */
  firstReplyAt?: Date | null;
  resolvedAt?: Date | null;
  /** "now" for an unresolved/unanswered ticket (so an open breach counts). */
  now: Date;
}

export interface SlaMetrics {
  firstReplyMinutes: number | null;
  resolutionMinutes: number | null;
  firstReplyBreached: boolean;
  resolutionBreached: boolean;
}

function minutesBetween(a: Date, b: Date): number {
  return Math.max(0, (b.getTime() - a.getTime()) / 60000);
}

/** Compute SLA metrics + breaches. Pure. An unanswered/unresolved ticket breaches
 * once `now` passes the target (an open breach, not just a historical one). */
export function computeSla(input: SlaInput, targets: SlaTargets = DEFAULT_SLA): SlaMetrics {
  const firstReplyMinutes = input.firstReplyAt ? minutesBetween(input.createdAt, input.firstReplyAt) : null;
  const resolutionMinutes = input.resolvedAt ? minutesBetween(input.createdAt, input.resolvedAt) : null;
  const elapsed = minutesBetween(input.createdAt, input.now);
  // An unanswered/unresolved ticket breaches once `now` passes the target (an
  // OPEN breach); an answered/resolved one breaches if it took too long.
  const firstReplyBreached = firstReplyMinutes === null ? elapsed > targets.firstReplyMinutes : firstReplyMinutes > targets.firstReplyMinutes;
  const resolutionBreached = resolutionMinutes === null ? elapsed > targets.resolutionMinutes : resolutionMinutes > targets.resolutionMinutes;
  return { firstReplyMinutes, resolutionMinutes, firstReplyBreached, resolutionBreached };
}

// ── NPS → action ─────────────────────────────────────────────────────────────

export type NpsSegment = "detractor" | "passive" | "promoter";
export type NpsAction = "winback_outreach" | "check_in" | "ask_referral";

export interface NpsActionPlan {
  segment: NpsSegment;
  action: NpsAction;
  /** Maps to a lifecyclePlaybook play where one fits. */
  lifecyclePlayId: string | null;
}

/** Turn an NPS score (0–10) into a segment + a concrete next action. Pure. */
export function npsActionFor(score: number): NpsActionPlan {
  if (score <= 6) return { segment: "detractor", action: "winback_outreach", lifecyclePlayId: "winback" };
  if (score <= 8) return { segment: "passive", action: "check_in", lifecyclePlayId: "support_reply" };
  return { segment: "promoter", action: "ask_referral", lifecyclePlayId: null };
}

// ── KB auto-draft ────────────────────────────────────────────────────────────

export interface ResolvedTicketSignal {
  status: string;
  aiHandled: boolean;
  /** AI confidence in the resolution (0–1). */
  confidence: number | null;
  /** Post-resolution rating (1–5). */
  satisfaction: number | null;
  reopened: boolean;
}

/** Confidence + satisfaction floors so only GOOD resolutions seed the KB. */
export const KB_DRAFT_MIN_CONFIDENCE = 0.7;
export const KB_DRAFT_MIN_SATISFACTION = 4;

/** Should this resolved ticket seed a draft KB article? Pure + conservative. */
export function shouldDraftKb(t: ResolvedTicketSignal): boolean {
  if (t.status !== "resolved" && t.status !== "closed") return false;
  if (!t.aiHandled || t.reopened) return false;
  if (t.confidence != null && t.confidence < KB_DRAFT_MIN_CONFIDENCE) return false;
  // If a satisfaction rating exists it must clear the floor; absence doesn't block.
  if (t.satisfaction != null && t.satisfaction < KB_DRAFT_MIN_SATISFACTION) return false;
  return true;
}

/** Compose the draft KB article from a resolved ticket. Pure (text only). */
export function composeKbDraft(input: { question: string; resolution: string }): { title: string; body: string } {
  const title = input.question.trim().slice(0, 120);
  const body = [input.resolution.trim(), "", "_Drafted by the autopilot from a resolved support ticket — review before publishing._"].join("\n");
  return { title, body };
}

// ────────────────────────────────────────────────────────────────────────────
// Impure orchestration — wire the pure NPS + KB logic into the live system.
// (wire-for-real: measurementLoops.npsActionFor + lifecyclePlaybook were dead.)
// ────────────────────────────────────────────────────────────────────────────

/**
 * O5 — page the founder on a P0 support ticket via the alert spine, the SAME
 * live page path the backup verifier uses (`pageBackupVerifyFailure` pattern:
 * severity "critical" → pageCriticalThrottled + finding + system_alerts row).
 * Best-effort: a page failure must never block or alter ticket creation.
 * Dedupe is per-ticket, so one P0 ticket pages once, not per retry.
 *
 * @returns true only when a page was actually dispatched.
 */
export async function pageSupportP0Ticket(input: {
  ticketId: number;
  organizationId?: number | null;
  subject?: string | null;
  reason: string;
}): Promise<boolean> {
  try {
    const { raiseAlert } = await import("../alertSpine");
    const result = await raiseAlert({
      severity: "critical",
      source: "supportSeveritySla",
      title: `P0 support ticket #${input.ticketId} (${input.reason})`,
      detail:
        `Ticket #${input.ticketId}${input.subject ? ` ("${input.subject}")` : ""} classified P0 — ${input.reason}. ` +
        `Target: first touch within ${SLA_BY_SEVERITY.P0.firstReplyMinutes} minutes, ` +
        `resolution within ${SLA_BY_SEVERITY.P0.resolutionMinutes / 60} hours.`,
      dedupeKey: `support_p0_ticket_${input.ticketId}`,
      domain: "cs",
      citedReason:
        "Support doctrine (handoff P5 §4): a broken-money/send ticket is P0 — page the founder, never queue it silently.",
      organizationId: input.organizationId ?? null,
      alertType: "support_p0",
    });
    return result.paged;
  } catch {
    return false; // best-effort — never throws into the ticket path
  }
}

/** Max cost for an autopilot NPS-follow-up dispatch. */
export const NPS_FOLLOWUP_MAX_COST_USD = 1.5;

/**
 * Seed a DRAFT KB article from a cleanly auto-resolved support ticket
 * (wire-for-real: measurementLoops.shouldDraftKb/composeKbDraft were dead).
 * Conservative: only a high-confidence AI resolution drafts. Idempotent — never
 * drafts twice for the same ticket. Best-effort: never throws into the resolver
 * (a KB draft must never break a customer resolution). The draft lands as
 * is_draft/draft_status='pending_review'/is_published=false for founder review
 * at the /founder/support/kb-drafts surface (Tahoe E3 substrate).
 */
export async function draftKbFromResolvedTicket(input: {
  ticketId: number;
  question: string;
  resolution: string;
  confidence: number | null; // 0..1
  category?: string | null;
}): Promise<{ drafted: boolean; reason?: string }> {
  try {
    const signal: ResolvedTicketSignal = {
      status: "resolved",
      aiHandled: true,
      confidence: input.confidence,
      satisfaction: null, // not yet known at resolve time; absence doesn't block
      reopened: false,
    };
    if (!shouldDraftKb(signal)) return { drafted: false, reason: "below draft bar" };

    const { db } = await import("../../db");
    const { knowledgeBaseArticles } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");

    // Idempotent: one draft per source ticket.
    const existing = await db
      .select({ id: knowledgeBaseArticles.id })
      .from(knowledgeBaseArticles)
      .where(eq(knowledgeBaseArticles.sourceTicketId, input.ticketId))
      .limit(1);
    if (existing.length > 0) return { drafted: false, reason: "already drafted" };

    const { title, body } = composeKbDraft({ question: input.question, resolution: input.resolution });
    const slug =
      title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) +
      `-t${input.ticketId}`;
    await db.insert(knowledgeBaseArticles).values({
      title: title || `Resolved ticket #${input.ticketId}`,
      slug,
      content: body,
      category: input.category || "general",
      isDraft: true,
      draftStatus: "pending_review",
      isPublished: false,
      sourceTicketId: input.ticketId,
    });
    return { drafted: true };
  } catch {
    return { drafted: false, reason: "error (swallowed)" };
  }
}

/**
 * NPS → action → governed dispatch (wire-for-real). On a low NPS score, resolve
 * the lifecycle play (lifecyclePlaybook) the segment maps to and enqueue a
 * GATED autopilot dispatch to draft the customer follow-up. The draft routes
 * through witnessed-send (the send_email hand requires the founder's tap), and
 * the whole thing is bounded by the ensemble cap + the dispatch master switch.
 * Conservative on volume: only DETRACTORS (≤6) auto-enqueue — the clear,
 * low-volume, high-value case; passives get the plan returned but no dispatch.
 * Best-effort: never throws into the caller (the NPS submit must not fail).
 */
export async function enqueueNpsFollowup(input: {
  score: number;
  organizationId: number;
  userId: string;
  feedback?: string | null;
}): Promise<{ enqueued: boolean; segment: NpsSegment; playId: string | null; dispatchId?: number }> {
  const plan = npsActionFor(input.score);
  try {
    if (plan.segment !== "detractor" || !plan.lifecyclePlayId) {
      return { enqueued: false, segment: plan.segment, playId: plan.lifecyclePlayId };
    }
    const { lifecyclePlayById } = await import("./lifecyclePlaybook");
    const play = lifecyclePlayById(plan.lifecyclePlayId);
    if (!play || !play.isCustomerFacing) {
      return { enqueued: false, segment: plan.segment, playId: plan.lifecyclePlayId };
    }
    const { enqueueDispatch } = await import("../solene/dispatchQueue");
    const promptText = [
      `A customer just left a DETRACTOR NPS score of ${input.score}/10.`,
      input.feedback ? `Their verbatim feedback: "${input.feedback}".` : `No written feedback was left.`,
      ``,
      `Run the "${play.id}" lifecycle play. ${play.brief}`,
      ``,
      `Draft a tasteful, specific, human win-back email for organization #${input.organizationId}.`,
      `Use the ${play.hands.join(", ")} hand(s). The send is witnessed — the founder taps to send; you only draft.`,
    ].join("\n");
    const dispatchId = await enqueueDispatch({
      sourceType: "detector",
      sourceId: `nps:${input.organizationId}:${input.userId}`,
      agentRole: "soren",
      promptText,
      maxCostUsd: NPS_FOLLOWUP_MAX_COST_USD,
      enqueuedBy: "nps-followup",
    });
    return { enqueued: true, segment: plan.segment, playId: plan.lifecyclePlayId, dispatchId };
  } catch {
    // Gated/capped/disabled → no dispatch; honest no-op, never breaks the submit.
    return { enqueued: false, segment: plan.segment, playId: plan.lifecyclePlayId };
  }
}
