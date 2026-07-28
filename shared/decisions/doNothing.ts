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

  witnessed_send:
    "If you never answer: nothing sends. The draft expires after 24 hours and can never " +
    "send after that — the autopilot would have to re-draft it for a fresh approval. The " +
    "one exception is a step-away witness grant you issued yourself.",

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
