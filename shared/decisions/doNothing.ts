/**
 * The "If you do nothing" contract — one plain-language sentence per decision
 * class stating what ACTUALLY happens when the founder never answers a card.
 *
 * Founder-trust audit (2026-07-28): every needs-you card left the founder
 * guessing what ignoring it costs — "ambient guilt." This module is the fix,
 * and it is bound by the no-fabrication rule: every sentence below states
 * TRUE CURRENT BEHAVIOR, verified against the code that owns each class.
 * Do not edit a sentence without re-verifying the behavior it describes.
 *
 * Verified sources (per class):
 *   shadow_promotion_request — server/services/autopilot/promotionRequest.ts:
 *     applyPromotionAnswer (founder tap) is the ONLY path that widens a
 *     domain's autonomy level; an unanswered card leaves the level untouched
 *     and the clean-cycle counter holding at threshold.
 *   outcome_check_in — server/services/outcomeLedger.ts: an unanswered
 *     check-in leaves the original decision unscored; getOutcomeLedgerCounts
 *     reports it as "overdue, never backfilled". writeOutcome runs only from
 *     machine checks (which never raise a founder card) or the founder's tap.
 *   letter_reply_confirm — server/services/solene/letterReply.ts: the
 *     witnessed-admission invariant — only confirmLetterReply (founder tap)
 *     touches precedent memory or the dispatch queue; the parse just waits.
 *   witnessed_send — server/services/autopilot/pendingHands.ts: frozen
 *     actions NEVER execute without approvePendingHand; TTL_MS = 24h, after
 *     which the draft is expired and can never execute (a re-send requires a
 *     fresh draft + fresh approval). The single delegated path is
 *     autoWitness.ts, which acts only under a live witness grant the founder
 *     issued themselves (zero grants → sweep is a no-op).
 *   founder_ask — server/services/solene/founderCollab.ts: agents never act
 *     on an unanswered ask; the escalation ladder re-pages and auto-resolves
 *     only TO THE SAFE SIDE (timed_out = the system did NOT act);
 *     expireOverdueAsks flips open→timed_out after the timeout
 *     (FOUNDER_ASK_DEFAULT_TIMEOUT_HOURS = 24 unless the ask set its own).
 *   executor-eligible types — server/services/autonomousDecisionExecutor.ts:
 *     runAutonomousDecisionExecutor scans ALL pending inbox items on a
 *     half-hourly tick, but ONLY when AUTONOMOUS_EXECUTOR_ENABLED === "true"
 *     (off by default; the founder must opt in). When on, it can approve /
 *     reject routine cards itself (resolvedBy "autonomous_executor" → the
 *     Auto-handled bucket). checkHardGuardrails blocks pricing/billing,
 *     data-deletion, and legal-signing actions BEFORE any model is consulted
 *     — those classes are deferred back to the founder, forever. Spends over
 *     $500 are founder-only at every tier (financialAuthorityGate:
 *     founderApprovalRequired on tiers 2-5; only "approved" ever executes,
 *     and unanswered approval records expire after the 72h TTL).
 *
 * Pure, dependency-free, imported by BOTH the server (decisionsInbox.ts) and
 * the client (founder-decisions.tsx) so the two surfaces can never drift.
 */

/**
 * The truthful caveat for cards the autonomous executor is allowed to touch.
 * The executor is OFF unless the founder set AUTONOMOUS_EXECUTOR_ENABLED=true.
 */
const EXECUTOR_CAVEAT =
  "If you've switched the autonomous executor on (it stays off until you opt in), " +
  "it may resolve routine cards like this on its next half-hourly pass and log the " +
  "result under Auto-handled — hard-stop actions still always wait for you.";

/**
 * Class keys that are not decisions-inbox itemTypes but distinct queues on
 * the Decisions door, given their own truthful sentence:
 *   witnessed_send — autopilot_pending_actions (the witnessed-send queue)
 *   founder_ask    — solene_founder_asks (the open-asks section)
 */
export const DO_NOTHING_CONTRACTS: Record<string, string> = {
  shadow_promotion_request:
    "If you never answer: nothing changes — the autopilot stays at its current level. " +
    "Only your tap can widen its authority; this card just waits.",

  outcome_check_in:
    "If you never answer: this waits and the original decision shows as overdue in the " +
    "ledger; no score is ever invented, and nothing else happens.",

  letter_reply_confirm:
    "If you never answer: nothing is applied — your reply is never acted on until you " +
    "confirm the reading here. This waits for your tap.",

  /*
   * TWO sentences, not one, and the split is load-bearing.
   *
   * This text is written in the FROZEN CARD's voice ("the draft still waits
   * right here"), and it used to render verbatim on the mirror ROW as well —
   * where it was both self-referential ("its row in the ranked queue" IS the
   * row you are reading) and, after a TTL, simply false: the mirror is a
   * snapshot whose only staleness closer is a once-a-day sweep, so for up to
   * ~24h the row could say the draft still waits while the frozen card had
   * already dropped off the page. A sentence pointing at a control that is no
   * longer rendered is exactly the class of claim this contract exists to
   * prevent.
   */
  witnessed_send:
    "If you never answer: nothing sends. The draft expires after 24 hours and can never " +
    "send after that — the autopilot would have to re-draft it for a fresh approval. The " +
    "one exception is a step-away witness grant you issued yourself. Its row in the ranked " +
    "queue is a mirror of this card: if you've switched the autonomous executor on it may " +
    "clear that ROW and log it under Auto-handled, but it can never send the draft — the " +
    "draft still waits right here, because this card reads the frozen action directly.",

  witnessed_send_mirror:
    "If you never answer: nothing sends from this row — it carries no buttons. It is a " +
    "mirror, filed here so the draft carries a rank instead of sitting wherever it " +
    "happened to land. The card above the queue is what reads the frozen action and is " +
    "the only place it can be sent. If that card is gone, the draft has already expired " +
    "or been dealt with, and this row is a record rather than something waiting on you.",

  founder_ask:
    "If you never answer: the agent never acts on an unanswered question — it does the " +
    "safe thing instead. It may page you again; after the timeout (24 hours unless the " +
    "ask set its own) it closes as timed out with nothing done.",

  support_escalation:
    `If you never answer: the customer's ticket stays open and this card waits. ${EXECUTOR_CAVEAT}`,

  churn_risk_intervention:
    `If you never answer: no retention outreach goes out from this card; it waits. ${EXECUTOR_CAVEAT}`,

  dunning_recovery:
    `If you never answer: no recovery email goes out from this card; it waits. ${EXECUTOR_CAVEAT}`,

  critical_alert:
    "If you never answer: the alert stays unacknowledged here and this card waits (the " +
    `pager for the incident is a separate channel). ${EXECUTOR_CAVEAT}`,

  feature_request_flagged:
    `If you never answer: nothing is built or scheduled — this card waits. ${EXECUTOR_CAVEAT}`,

  // F2 mirror cards — verified sources:
  //   appeal_review — server/routes-founder-appeals.ts is the ONLY writer of
  //     a terminal appeal status (upheld/reversed); appeals never expire and
  //     nothing rules on them automatically. The card is a mirror
  //     (decisionsInbox.createFromAppeal): the enabled-by-opt-in autonomous
  //     executor could at most clear the CARD (it logs under Auto-handled);
  //     the appeal row itself still waits on /founder/appeals.
  //   recourse_draft — recourse_drafts rows are sent/dismissed ONLY by the
  //     founder routes (routes-founder-recourse.ts); drafts never send
  //     themselves and never expire. Same mirror caveat.
  appeal_review:
    "If you never answer: the customer's appeal stays open and the refusal stands — " +
    "nothing rules on it for you, ever. This card mirrors the Appeals queue and clears " +
    "itself when you rule there. If you've switched the autonomous executor on, it may " +
    "clear this mirror card and log it under Auto-handled — but the appeal itself still " +
    "waits for your verdict on the Appeals queue.",

  // F2 slice 2 — the dated-obligation countdown. Verified source:
  //   server/services/datedObligations.ts is a STATIC registry; no code path
  //   changes a `due` date or removes a row — only a code edit does. The card
  //   is NATIVE with actionPayload null, so no disposition verb can discharge
  //   the obligation, and decisionsInbox.resolveDischargedObligationCards is
  //   the ONLY thing that closes an open card (it closes one exactly when the
  //   registry no longer lists that row at that date). The milestones are
  //   DEFAULT_PAGE_THRESHOLDS = [14, 7, 2, 0] unless a row overrides them, and
  //   founderBriefing.sendDailyBriefing sweeps once a day; the past-due
  //   milestone files exactly one card because the dedupe key is
  //   (obligationKey, milestone, due) at ANY status.
  dated_obligation:
    "If you never answer: the date still arrives — nothing on this card moves it. This is " +
    "a countdown, not a discharge: a fresh card is filed at each remaining milestone " +
    "(14, 7, 2 and 0 days out by default) and once more when it goes past due, and a card " +
    "closes itself only when the obligations registry stops listing that row at that date. " +
    "Answering records your decision; discharging the obligation is a separate, real act. " +
    `${EXECUTOR_CAVEAT}`,

  recourse_draft:
    "If you never answer: no reply goes to the customer — the drafted reply just waits " +
    "on the Recourse queue (drafts never send themselves and never expire). This card " +
    "mirrors that queue and clears itself when you send or dismiss there. If you've " +
    "switched the autonomous executor on, it may clear this mirror card and log it under " +
    "Auto-handled — but it can never send the reply.",
};

/**
 * Hard-stop classes: pricing/billing changes, customer-data deletion, legal
 * signing, spends over $500. Matched the same way the executor's
 * checkHardGuardrails matches (substring on the action/item type), against
 * the SAME action lists, so this claim can only be made where the code
 * actually enforces it. spend_over_500_usd is enforced by the financial
 * authority gate (founder-only at every tier above $500), not by a type
 * substring in the guardrail — it is listed here by its constitutional name.
 */
const HARD_STOP_TYPE_SUBSTRINGS = [
  // checkHardGuardrails BILLING_SUBSCRIPTION_ACTIONS
  "billing_modification",
  "subscription_change",
  "plan_upgrade",
  "plan_downgrade",
  "pricing_change",
  "payment_method_update",
  "invoice_adjustment",
  "subscription_cancel",
  // checkHardGuardrails DATA_DELETION_ACTIONS
  "data_deletion",
  "bulk_delete",
  "account_deletion",
  "record_purge",
  "permanent_delete",
  // checkHardGuardrails LEGAL_SIGNING_ACTIONS
  "legal_signing",
  "contract_execute",
  "contract_sign",
  "document_sign",
  "esign",
  "envelope_send",
  "agreement_execute",
  // financialAuthorityGate — founder-only at every tier above $500
  "spend_over_500",
];

export const HARD_STOP_DO_NOTHING =
  "This waits for you forever — it can never proceed without you. Pricing changes, " +
  "legal signing, spends over $500, and customer-data deletion are yours alone; the " +
  "machine refuses them without your tap.";

/**
 * Conservative catch-all for item types this map doesn't know. Verified
 * honest: an unknown pending card sits in the inbox untouched — UNLESS the
 * founder has opted the autonomous executor in, in which case unknown types
 * escalate to a model that may resolve the card (guardrails and hard-stops
 * still run first). The sentence says both halves plainly.
 */
export const DEFAULT_DO_NOTHING =
  "If you never answer: this waits. Nothing executes without you unless you've switched " +
  "the autonomous executor on — then it may resolve routine cards on its next half-hourly " +
  "pass and log them under Auto-handled. Hard-stop actions always wait for you.";

/** True when this item type falls in a founder-only hard-stop class. */
export function isHardStopItemType(itemType: string): boolean {
  const t = itemType.toLowerCase();
  return HARD_STOP_TYPE_SUBSTRINGS.some((s) => t.includes(s));
}

/**
 * The per-card "If you do nothing" sentence. Pure; never throws; always
 * returns a non-empty, code-verified sentence.
 */
export function doNothingContract(itemType: string): string {
  const exact = DO_NOTHING_CONTRACTS[itemType];
  if (exact) return exact;
  if (isHardStopItemType(itemType)) return HARD_STOP_DO_NOTHING;
  return DEFAULT_DO_NOTHING;
}
