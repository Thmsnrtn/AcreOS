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
}

/** Lower `priority` = more urgent. */
export interface RankedMove {
  priority: number;
  domain: AutopilotDomain;
  kind: string;
  rationale: string;
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

  // P2 — SERVE WAITING CUSTOMERS. Real people are waiting; that beats growth.
  if (s.supportBacklog > 0) {
    moves.push({ priority: 2, domain: "support", kind: "clear_support_backlog", rationale: `${s.supportBacklog} customer(s) waiting on support.` });
  }

  // P3 — UNBLOCK ACTIVATION. New signups not reaching value is a leak under any
  // growth spend — fix the bucket before pouring more in.
  if (s.activationStalled) {
    moves.push({ priority: 3, domain: "deploy", kind: "unblock_activation", rationale: `${s.trials} trial(s) signed up but stalled before first value — fix the onboarding leak.` });
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
  };
}
