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

/** Default SLA: respond within 2h, resolve within 24h. */
export const DEFAULT_SLA: SlaTargets = { firstReplyMinutes: 120, resolutionMinutes: 24 * 60 };

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

/** Max cost for an autopilot NPS-follow-up dispatch. */
export const NPS_FOLLOWUP_MAX_COST_USD = 1.5;

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
