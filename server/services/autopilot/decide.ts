/**
 * Founder Autopilot — the decide-core (the brain's judgment).
 *
 * P0 batch 4. Pure, deterministic prioritization: given the REAL senses, rank
 * the candidate moves so the operating loop works the single highest-value
 * thing first. The plan's ordering — stabilize > serve waiting customers >
 * unblock activation > grow > optimize — encoded as transparent rules, not a
 * black box, so the founder can always understand why the system did what it
 * did (and so it's unit-testable without a model call).
 *
 * Honesty: operates only on senses that are genuinely measured. A sense that
 * isn't instrumented yet (e.g. uptime) is simply absent from the inputs and
 * never invented — the brain doesn't act on data it doesn't have.
 *
 * It RANKS; it does not act. The loop takes the top move(s) and routes each
 * through runPolicyGateStack (+ the per-domain Trust Ledger gate) before
 * anything executes.
 */
import type { AutopilotDomain } from "./policyGate";

export interface DecisionSenses {
  /** Open sev incidents / failed deploys needing attention. */
  openIncidents: number;
  /** Open compliance findings (Beatrice). */
  complianceOpenCount: number;
  /** Cost/runway envelope health. */
  envelopeStatus: "green" | "amber" | "red";
  /** Customers waiting on support. */
  supportBacklog: number;
  /** Signups in window. */
  trials: number;
  /** Trials that signed up but never hit first-value (activation stalled). */
  activationStalled: boolean;
  /** Current MRR (real, from the onboarding/revenue funnel). */
  mrr: number;
  /** Dispatches already queued + not yet run (avoid piling on). */
  dispatchBacklog: number;
  // ── Outward perception (Hands roadmap P0.2) — from the perception bus. All
  // optional + default to the honest zero so an unwired/quiet channel never
  // fabricates pressure. The brain only acts on a signal it genuinely has.
  /** Spam complaints in window — deliverability is at risk above 0. */
  emailComplaints?: number;
  /** Failed-payment events awaiting recovery. */
  dunningPressure?: number;
  /** Churn signals (cancellations / disputes) in window. */
  churnSignals?: number;
  /** Trials entering their closing window. */
  trialsEnding?: number;
  /** Autonomous-job (reflex) failures in window — a failing dunning/billing/
   * compliance job is a real business incident the brain should stabilize. */
  reflexFailures?: number;
  // ── Deal-shaped perception (Jarvis 2.1, audit G2). Observe-only inputs:
  // the tick sees pipeline motion and payment schedules; no new moves yet.
  /** deal:lifecycle mesh events (created/updated/closed) in the window. */
  dealEvents24h?: number;
  /** Note-vertical borrower payments due within the next 7 days. */
  notePaymentsDueSoon?: number;
  /** Note-vertical borrower payments past due. */
  notePaymentsOverdue?: number;
}

/** Lower `priority` = more urgent. */
export interface RankedMove {
  priority: number;
  domain: AutopilotDomain;
  kind: string;
  rationale: string;
  /**
   * True iff this move was PROPOSED BY THE OPERATOR as net-new (not in the
   * deterministic catalog) — kernel-elevation T2.3. A net-new move is forced
   * through witnessed-send in the BODY (moveToPolicyAction), never able to
   * auto-execute, regardless of any proposed binding.
   */
  isNetNew?: boolean;
}

/**
 * Rank the candidate moves from the current senses. Deterministic + total —
 * always returns at least one move (optimize) so the loop never idles blindly.
 */
export function rankMoves(s: DecisionSenses): RankedMove[] {
  const moves: RankedMove[] = [];

  // P0 — STABILIZE. Nothing else matters if the house is on fire. Incidents,
  // an over-budget/red envelope, or open compliance flags take precedence over
  // all growth/optimization.
  if (s.openIncidents > 0) {
    moves.push({ priority: 0, domain: "deploy", kind: "resolve_incident", rationale: `${s.openIncidents} open incident(s) — stabilize before anything else.` });
  }
  if (s.envelopeStatus === "red") {
    moves.push({ priority: 0, domain: "finance", kind: "protect_runway", rationale: "Cost/runway envelope is RED — cut spend / protect runway before growth." });
  }
  if (s.complianceOpenCount > 0) {
    moves.push({ priority: 1, domain: "ops", kind: "clear_compliance", rationale: `${s.complianceOpenCount} open compliance finding(s) — resolve before outward action.` });
  }
  // Reflex failures — an autonomous job (dunning, billing, compliance, backups)
  // is failing. The autonomic layer breaking is close to house-on-fire.
  const reflexFailures = s.reflexFailures ?? 0;
  if (reflexFailures > 0) {
    moves.push({ priority: 1, domain: "deploy", kind: "stabilize_reflexes", rationale: `${reflexFailures} autonomous-job failure(s) — stabilize the reflex layer before outward action.` });
  }

  // P1.5 — PROTECT DELIVERABILITY. Spam complaints poison the sending domain
  // for EVERY customer; a damaged reputation is close to house-on-fire for all
  // outward comms, so it ranks just below incidents/compliance.
  const emailComplaints = s.emailComplaints ?? 0;
  if (emailComplaints > 0) {
    moves.push({ priority: 1, domain: "ops", kind: "protect_deliverability", rationale: `${emailComplaints} spam complaint(s) — protect sending-domain reputation before more sends.` });
  }

  // P2 — SERVE WAITING CUSTOMERS. Real people are waiting; that beats growth.
  if (s.supportBacklog > 0) {
    moves.push({ priority: 2, domain: "support", kind: "clear_support_backlog", rationale: `${s.supportBacklog} customer(s) waiting on support.` });
  }

  // P2 — RETAIN AT-RISK CUSTOMERS. A cancellation/dispute is a real customer
  // leaving; winning them back beats acquiring a new one.
  const churnSignals = s.churnSignals ?? 0;
  if (churnSignals > 0) {
    moves.push({ priority: 2, domain: "support", kind: "retain_at_risk", rationale: `${churnSignals} churn signal(s) (cancellation/dispute) — attempt retention.` });
  }

  // P2 — RECOVER FAILED PAYMENTS. Dunning is the highest-ROI money work and the
  // outcome is self-verifying (the invoice clears or it doesn't).
  const dunningPressure = s.dunningPressure ?? 0;
  if (dunningPressure > 0) {
    moves.push({ priority: 2, domain: "finance", kind: "recover_payments", rationale: `${dunningPressure} failed payment(s) in dunning — recover the revenue.` });
  }

  // P3 — UNBLOCK ACTIVATION. New signups not reaching value is a leak under any
  // growth spend — fix the bucket before pouring more in.
  if (s.activationStalled) {
    moves.push({ priority: 3, domain: "deploy", kind: "unblock_activation", rationale: `${s.trials} trial(s) signed up but stalled before first value — fix the onboarding leak.` });
  }

  // P3 — CONVERT ENDING TRIALS. A trial about to lapse is a revenue-closing
  // window; nudge before it closes (fix the leak before growing the top).
  const trialsEnding = s.trialsEnding ?? 0;
  if (trialsEnding > 0) {
    moves.push({ priority: 3, domain: "finance", kind: "convert_trials", rationale: `${trialsEnding} trial(s) ending soon — nudge toward conversion.` });
  }

  // P4 — GROW. Only when stable and within budget. Owned-first per the plan.
  const stable = s.openIncidents === 0 && s.envelopeStatus !== "red" && s.complianceOpenCount === 0;
  if (stable && s.dispatchBacklog < 3) {
    moves.push({ priority: 4, domain: "growth", kind: "grow_owned_channels", rationale: "Stable + within budget — advance owned growth (content / parcel-check / outreach)." });
  }

  // P5 — OPTIMIZE. The always-available default so the loop is total.
  moves.push({ priority: 5, domain: "ops", kind: "optimize", rationale: "Nothing urgent — improve a system, tighten a playbook, or reduce cost." });

  return moves.sort((a, b) => a.priority - b.priority);
}

/** The single highest-value move right now. */
export function topMove(s: DecisionSenses): RankedMove {
  return rankMoves(s)[0];
}

/**
 * Re-order moves WITHIN each priority tier by how urgently their domain's
 * objectives need moving (Hands roadmap P5 → brain). This NEVER crosses tiers —
 * the safety ladder (stabilize > serve > … ) is untouched; it only breaks ties
 * among equally-urgent moves, steering effort toward the numbers furthest from
 * target. `urgencyByDomain` comes from objectives.domainUrgency (1.0 neutral →
 * 2.0 maximally behind). Pure + stable.
 */
export function applyObjectiveWeighting(
  moves: RankedMove[],
  urgencyByDomain: Partial<Record<AutopilotDomain, number>>,
): RankedMove[] {
  return [...moves]
    .map((m, i) => ({ m, i, u: urgencyByDomain[m.domain] ?? 1 }))
    .sort((a, b) => {
      if (a.m.priority !== b.m.priority) return a.m.priority - b.m.priority; // tier first
      if (b.u !== a.u) return b.u - a.u; // within tier: more-urgent domain first
      return a.i - b.i; // stable
    })
    .map((x) => x.m);
}

/**
 * Build DecisionSenses from the real morning-pulse snapshot (duck-typed so this
 * stays decoupled from the pulse module + unit-testable). Senses the pulse
 * doesn't carry yet (support backlog, activation, dispatch backlog) are passed
 * in `extra`, defaulting to the honest "none known" — never invented. Flagged
 * dispatches in the last 24h proxy open incidents.
 */
export function sensesFromPulse(
  pulse: {
    mrr: number;
    trials: number;
    complianceOpenCount: number;
    envelopeStatus: "green" | "amber" | "red";
    dispatchesFlaggedLast24h: number;
  },
  extra?: { supportBacklog?: number; activationStalled?: boolean; dispatchBacklog?: number },
  /** Outward perception (Hands roadmap P0.2) — counts from the perception bus. */
  outward?: { emailComplaints?: number; dunningPressure?: number; churnSignals?: number; trialsEnding?: number; reflexFailures?: number; dealEvents24h?: number; notePaymentsDueSoon?: number; notePaymentsOverdue?: number },
): DecisionSenses {
  return {
    openIncidents: pulse.dispatchesFlaggedLast24h,
    complianceOpenCount: pulse.complianceOpenCount,
    envelopeStatus: pulse.envelopeStatus,
    supportBacklog: extra?.supportBacklog ?? 0,
    trials: pulse.trials,
    activationStalled: extra?.activationStalled ?? false,
    mrr: pulse.mrr,
    dispatchBacklog: extra?.dispatchBacklog ?? 0,
    emailComplaints: outward?.emailComplaints ?? 0,
    dunningPressure: outward?.dunningPressure ?? 0,
    churnSignals: outward?.churnSignals ?? 0,
    trialsEnding: outward?.trialsEnding ?? 0,
    reflexFailures: outward?.reflexFailures ?? 0,
    dealEvents24h: outward?.dealEvents24h ?? 0,
    notePaymentsDueSoon: outward?.notePaymentsDueSoon ?? 0,
    notePaymentsOverdue: outward?.notePaymentsOverdue ?? 0,
  };
}
