/**
 * TRUST MAY ONLY BE GRANTED BY EVIDENCE THE AGENT DID NOT AUTHOR.
 *
 * Trust is not a score for its own sake: `agentAuthorityGate.checkAuthority`
 * promotes a level-2 action ("recommend and wait") to level 1, and level 1 to
 * level 0 (full autonomy), on this number alone. So whatever raises it decides
 * what the system may do without asking.
 *
 * Two of the three dimensions used to let the agent raise it by itself.
 *
 * ── DIMENSION 2 — THE EXECUTION LOG ─────────────────────────────────────────
 * `+1` when `agentActionLog.outcome = 'success'` covered ≥80% of an agent's
 * actions in a day. That column is the ACTOR'S OWN receipt: eight of the ten
 * sites that write it write the literal `"success"` at the moment the action is
 * ISSUED — `predictiveAutoscaler` writes it beside `output: { scheduled: true }`
 * and `durationMs: 0` — and the tenth writes `result.success`, "the executor did
 * not throw". So an agent earned authority by asserting its own success, and a
 * 3-day streak multiplied that by 1.5.
 *
 * The file already contained the argument against itself: dimension 3 was added
 * "NEW in v5" with the comment "Real outcome verification: did the action
 * actually HELP?", reading `outcomeVerificationQueue`, whose verifiers check
 * actual database state. Dimension 2 was left granting the same +1.
 *
 * ── DIMENSION 1 — auto_resolved ─────────────────────────────────────────────
 * Accuracy counted `status = 'approved' OR status = 'auto_resolved'` over ALL
 * items. `auto_resolved` means the autonomous executor closed it without a
 * human (`paxObserver`, `autonomyHealth`), so an agent that never escalated
 * scored 100% accuracy and gained trust — downward pressure on escalation,
 * which is the same defect found in `outcomeVerificationLoop` pointing the
 * other way.
 *
 * Auto-resolution is now excluded from the numerator AND the denominator. It is
 * not evidence of correctness and not evidence of error; it is an unmeasured
 * outcome, and averaging it in either direction invents a result. Accuracy is
 * computed over the items a human actually adjudicated, and when a human
 * adjudicated none, this dimension contributes nothing.
 *
 * ── THE ASYMMETRY IS DELIBERATE ─────────────────────────────────────────────
 * A run of FAILED actions still costs trust. A failed action is conclusive: it
 * did not do what it set out to do. A succeeded one proves only that it ran.
 * Removing the penalty for symmetry's sake would throw away a real signal.
 */
export interface TrustEvidence {
  /** Inbox items a HUMAN approved. Ground truth. */
  humanApproved: number;
  /** Inbox items a human rejected. Ground truth, the other way. */
  humanRejected: number;
  /** Items the executor closed itself. Neither — see above. */
  autoResolved: number;
  /** Founder overrides. Each one costs trust directly. */
  overridden: number;
  /** Rows the agent wrote about its own execution. Never GRANTS trust. */
  selfReportedActions: number;
  selfReportedFailures: number;
  /** Outcomes an independent verifier observed in the world. */
  verifiedPositive: number;
  verifiedNegative: number;
}

export interface TrustDelta {
  delta: number;
  reasons: string[];
  /** Accuracy over HUMAN-adjudicated items only; null when none were. */
  accuracyRate: number | null;
}

/** Pure: the day's trust movement from the evidence. No DB, no clock. */
export function trustDeltaFrom(e: TrustEvidence, accuracyPct: number): TrustDelta {
  let delta = 0;
  const reasons: string[] = [];

  // ── Dimension 1: decision accuracy, over adjudicated items only ──────────
  const adjudicated = e.humanApproved + e.humanRejected;
  const accuracyRate = adjudicated > 0 ? (e.humanApproved / adjudicated) * 100 : null;
  if (accuracyRate !== null) {
    if (accuracyRate >= accuracyPct) {
      delta += 1;
      reasons.push(`${accuracyRate.toFixed(0)}% accuracy on ${adjudicated} adjudicated decisions`);
    } else if (accuracyRate < 60) {
      delta -= 1;
      reasons.push(`${accuracyRate.toFixed(0)}% accuracy — needs improvement`);
    }
  }
  if (e.autoResolved > 0) {
    // Recorded, never scored. Visible so a human reading the log can see how
    // much of the day went unadjudicated.
    reasons.push(`${e.autoResolved} auto-resolved (not scored — no human verdict)`);
  }
  if (e.overridden > 0) {
    delta -= e.overridden;
    reasons.push(`${e.overridden} CEO override(s)`);
  }

  // ── Dimension 2: the agent's own execution log. FAILURES ONLY ────────────
  if (e.selfReportedFailures > 2) {
    delta -= 1;
    reasons.push(`${e.selfReportedFailures} failed actions — reliability concern`);
  } else if (e.selfReportedActions > 0) {
    reasons.push(`${e.selfReportedActions} action(s) executed (execution is not an outcome — not scored)`);
  }

  // ── Dimension 3: outcomes an independent verifier observed ───────────────
  if (e.verifiedPositive > 0) {
    delta += Math.min(2, e.verifiedPositive);
    reasons.push(`${e.verifiedPositive} action${e.verifiedPositive > 1 ? "s" : ""} verified as successful`);
  }
  if (e.verifiedNegative > 0) {
    delta -= e.verifiedNegative;
    reasons.push(
      `${e.verifiedNegative} action${e.verifiedNegative > 1 ? "s" : ""} did not achieve desired outcome`,
    );
  }

  return { delta, reasons, accuracyRate };
}
