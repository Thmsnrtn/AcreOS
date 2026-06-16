/**
 * Founder Autopilot — the escalation classifier.
 *
 * P0 batch 5. The layer between the immune system (runPolicyGateStack) and the
 * founder's attention. A gate decision is not the same thing as "bother Tom":
 * the whole product promise is 0.01% founder attention, so the default is to
 * NOT escalate, and every escalation must justify itself. This module encodes —
 * as pure, transparent, testable rules — when a gate outcome should reach the
 * founder, how loudly, and in what shape (a decision to approve vs. a draft to
 * review).
 *
 * Harmony:
 * - It consumes the existing PolicyGateDecision (batch 2) — it does not re-run
 *   any gate.
 * - Its urgency values are exactly the founder-ask urgencies
 *   (`urgent|normal|low`) so a verdict feeds askFounder() with no translation.
 * - It is STATELESS + pure: "is this structural or a one-off?" comes in as
 *   `recentBlockCount` (the caller owns the counting), so the classifier stays
 *   unit-testable and deterministic.
 *
 * The governing principle: the immune system blocking a bad action is the
 * system WORKING, not a problem to surface. A single block is self-correction —
 * silent by design. What reaches the founder is: (a) anything that genuinely
 * needs a human tap (witnessed-send), (b) anything STRUCTURAL (the same thing
 * blocked repeatedly = the system is stuck and needs a human), and (c) anything
 * the system isn't yet trusted to do alone (draft-and-present, the path by
 * which autonomy is earned). Nothing is ever silently dropped.
 */
import type { AutopilotDomain, PolicyGateDecision } from "./policyGate";

/** Exactly the founder-ask urgencies, so a verdict feeds askFounder() directly. */
export type EscalationUrgency = "urgent" | "normal" | "low";

/**
 * What the founder is being asked to do, if anything.
 *  - none                 → handled by the system; do not surface.
 *  - founder_ask          → a decision is required (approve / decline a pending action).
 *  - founder_draft_review → the system produced a draft it isn't trusted to send
 *                           alone yet; present it for review (this is how trust is earned).
 */
export type EscalationAction = "none" | "founder_ask" | "founder_draft_review";

export interface EscalationContext {
  domain: AutopilotDomain;
  /** True when the blocked/escalated action touches a customer's assets/comms. */
  isCustomerFacing: boolean;
  /**
   * How many times this same action-kind has been blocked recently. The caller
   * owns the counting; the classifier uses it only to tell a one-off (self-
   * correct, silent) from a structural stall (surface to the founder).
   */
  recentBlockCount: number;
  /** Runway pressure — governs whether budget/finance blocks reach the founder. */
  envelopeStatus: "green" | "amber" | "red";
}

export interface EscalationVerdict {
  escalate: boolean;
  action: EscalationAction;
  urgency: EscalationUrgency;
  /** Plain-language justification — goes straight into the audit log / ask body. */
  reason: string;
}

/** A block that recurs this many times stops being a one-off and is structural. */
export const STRUCTURAL_BLOCK_THRESHOLD = 3;

const NO_ESCALATION: EscalationVerdict = {
  escalate: false,
  action: "none",
  urgency: "low",
  reason: "Handled by the system — no founder attention required.",
};

/**
 * Classify a gate decision into a founder-escalation verdict. Pure + total.
 *
 * Default is silence. The branches below are the only paths that reach the
 * founder, each with an explicit justification.
 */
export function classifyEscalation(
  decision: PolicyGateDecision,
  ctx: EscalationContext,
): EscalationVerdict {
  // A clean pass is never surfaced — this is the 0.01% promise in action.
  if (decision.decision === "pass") {
    return NO_ESCALATION;
  }

  // ── escalate: the gate stack itself routed this to a human tap ────────────
  // Witnessed-send: a customer-facing action (or an approval-set tool) requires
  // the founder's tap by design. This is the one path that is *always* surfaced
  // — it's the human-in-the-loop guarantee, not a failure.
  if (decision.decision === "escalate") {
    // Money movement is the one routine human-tap we raise loudly; everything
    // else is a normal, batchable decision so the founder isn't pinged urgently
    // for every outbound message.
    const urgency: EscalationUrgency = ctx.domain === "finance" ? "urgent" : "normal";
    return {
      escalate: true,
      action: "founder_ask",
      urgency,
      reason:
        decision.decidedBy === "witnessed_send"
          ? "Action needs your tap before it goes out (witnessed-send)."
          : "A human decision is required before this can proceed.",
    };
  }

  // ── block: the immune system stopped the action ───────────────────────────
  // A single block is the system self-correcting and is intentionally silent.
  // What we surface depends on WHY it was blocked.
  const structural = ctx.recentBlockCount >= STRUCTURAL_BLOCK_THRESHOLD;

  switch (decision.decidedBy) {
    case "autonomy":
      // Not trusted to act alone here yet. The right move is never to drop it —
      // it's to draft and present, which is precisely how the domain earns its
      // next autonomy rung. Customer-facing drafts are slightly more pressing.
      return {
        escalate: true,
        action: "founder_draft_review",
        urgency: ctx.isCustomerFacing ? "normal" : "low",
        reason:
          "The system isn't yet trusted to do this on its own — drafted it for your review (this is how it earns autonomy).",
      };

    case "compliance":
      // The constitution/compliance gate firing is the immune system working.
      // One-off → self-correct silently. Repeated → something is STRUCTURALLY
      // trying to cross a line and the system is stuck; that needs a human, now.
      return structural
        ? {
            escalate: true,
            action: "founder_ask",
            urgency: "urgent",
            reason: `Compliance has blocked this ${ctx.recentBlockCount}× — the system is stuck and needs your call.`,
          }
        : NO_ESCALATION;

    case "budget":
      // A transient cost-cap hit means "back off and retry later" — silent.
      // But if the runway envelope is RED, a budget block is no longer
      // transient: the founder should know spend is genuinely constrained.
      if (ctx.envelopeStatus === "red") {
        return {
          escalate: true,
          action: "founder_ask",
          urgency: "normal",
          reason: "Runway is constrained (envelope RED) and spend is being capped — your call on budget.",
        };
      }
      return NO_ESCALATION;

    case "quality":
      // The eval/grounding gate rejected the output. Normally the system just
      // regenerates — silent. If it keeps failing to produce acceptable output,
      // it can't self-correct and needs a human.
      return structural
        ? {
            escalate: true,
            action: "founder_ask",
            urgency: "normal",
            reason: `The system can't produce acceptable output for this after ${ctx.recentBlockCount} tries — needs your input.`,
          }
        : NO_ESCALATION;

    default:
      // Unknown terminal cause — fail safe toward visibility rather than
      // silence. Better to over-surface a novel block once than to drop it.
      return {
        escalate: true,
        action: "founder_ask",
        urgency: "normal",
        reason: "An action was blocked for a reason the classifier doesn't recognize — surfacing for safety.",
      };
  }
}
