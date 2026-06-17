/**
 * Founder Autopilot — customer-lifecycle playbook (Hands roadmap P3).
 *
 * Phases 1–2 built the hands (send_email/sms/push/letter, dunning_action,
 * apply_refund). This module composes them into the serve → retain → expand
 * loop: it maps a lifecycle SITUATION (read from the outward perception bus +
 * platform senses) to the single highest-priority PLAY, naming which hand(s) the
 * dispatched agent should use and the honest brief for the work.
 *
 * It does NOT send anything. It selects + briefs; the dispatched agent drafts and
 * (for every customer-facing play) routes through the witnessed-send wall. Pure +
 * deterministic → fully unit-testable without a model or DB.
 */
import type { CraftSurface } from "./craftStandard";

export interface LifecyclePlay {
  id: string;
  title: string;
  surface: CraftSurface;
  /** Directed at a customer → witnessed-send (every lifecycle play except the
   * internal dunning retry). */
  isCustomerFacing: boolean;
  /** The hand(s) this play uses, by name — what the agent is expected to call. */
  hands: string[];
  /** The honest instruction handed to the agent. */
  brief: string;
}

/** The situation the playbook reasons over — sourced from senses + perception. */
export interface LifecycleSituation {
  /** Customers waiting on a support reply. */
  supportBacklog: number;
  /** New signups that stalled before first value. */
  activationStalled: boolean;
  /** Failed-payment events in dunning. */
  dunningPressure: number;
  /** Churn signals (cancellation / dispute) in window. */
  churnSignals: number;
  /** Orgs sitting at a usage limit (expansion candidates). */
  atLimitCount: number;
  /** Trials entering their closing window. */
  trialsEnding: number;
}

export const LIFECYCLE_PLAYS: Record<string, LifecyclePlay> = {
  support_reply: {
    id: "support_reply",
    title: "Answer a waiting customer",
    surface: "support",
    isCustomerFacing: true,
    hands: ["send_email"],
    brief:
      "A customer is waiting on support. Draft a genuinely helpful, specific reply that resolves their actual question — no canned filler. Route it through witnessed-send for the founder's tap before it goes out.",
  },
  dunning_recovery: {
    id: "dunning_recovery",
    title: "Recover a failed payment",
    surface: "generic",
    isCustomerFacing: false,
    hands: ["dunning_action"],
    brief:
      "A payment failed. Retry the charge via dunning_action (non-destructive, self-verifying). If a customer email is warranted, draft it separately through send_email (witnessed). Do not escalate the dunning stage past payment_recovery_2 without a founder tap.",
  },
  winback: {
    id: "winback",
    title: "Win back an at-risk customer",
    surface: "support",
    isCustomerFacing: true,
    hands: ["send_email", "apply_refund"],
    brief:
      "A customer is cancelling or disputing. Draft an honest, low-pressure win-back that acknowledges the real reason and offers a genuine fix (a small goodwill credit via apply_refund only if it's truly warranted and ≤ the cap). Witnessed-send before anything leaves.",
  },
  activation_nudge: {
    id: "activation_nudge",
    title: "Unblock a stalled signup",
    surface: "support",
    isCustomerFacing: true,
    hands: ["send_email", "send_push"],
    brief:
      "A new signup hasn't reached first value. Draft one concrete, friendly nudge that removes the specific next-step friction (not a generic 'come back'). Witnessed-send before sending.",
  },
  expansion_offer: {
    id: "expansion_offer",
    title: "Offer a fitting upgrade",
    surface: "support",
    isCustomerFacing: true,
    hands: ["send_email"],
    brief:
      "An org is hitting its plan limits — a genuine expansion signal. Draft a respectful, value-first note that names the limit they're hitting and the concrete benefit of the next tier. No pressure, no fake scarcity. Witnessed-send.",
  },
  trial_conversion: {
    id: "trial_conversion",
    title: "Convert an ending trial",
    surface: "support",
    isCustomerFacing: true,
    hands: ["send_email"],
    brief:
      "A trial is about to lapse. Draft a brief, honest nudge that reflects what they've actually used and the real reason to stay. No countdown theatrics. Witnessed-send.",
  },
};

/**
 * Pick the single highest-priority lifecycle play for the situation, or null if
 * nothing is warranted. Priority mirrors the brain's ladder: serve waiting
 * customers → recover revenue → retain → unblock activation → convert → expand.
 */
export function selectLifecyclePlay(s: LifecycleSituation): LifecyclePlay | null {
  if (s.supportBacklog > 0) return LIFECYCLE_PLAYS.support_reply;
  if (s.dunningPressure > 0) return LIFECYCLE_PLAYS.dunning_recovery;
  if (s.churnSignals > 0) return LIFECYCLE_PLAYS.winback;
  if (s.activationStalled) return LIFECYCLE_PLAYS.activation_nudge;
  if (s.trialsEnding > 0) return LIFECYCLE_PLAYS.trial_conversion;
  if (s.atLimitCount > 0) return LIFECYCLE_PLAYS.expansion_offer;
  return null;
}

export function lifecyclePlayById(id: string): LifecyclePlay | null {
  return LIFECYCLE_PLAYS[id] ?? null;
}
