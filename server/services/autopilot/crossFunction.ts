/**
 * Founder Autopilot — cross-function coordination (Elite Vision H3).
 *
 * The brain ranks moves, but until now it treated each domain INDEPENDENTLY —
 * it didn't model that growth raises support load and infra cost, or that great
 * support feeds retention (growth). A business isn't N independent loops; it's
 * one coupled system. This module models those second-order effects so effort
 * flows to the domain with the highest NET impact on the whole P&L, not the
 * highest local gain.
 *
 * The model:
 *   • Each domain has a `pressure` (0..1) — how stressed/needy it is now, derived
 *     from the real senses.
 *   • COUPLINGS: acting in `from` changes `to`'s pressure by a signed `effect`
 *     (+ = adds load, − = relieves).
 *   • netLeverage(d) = pressure[d] − Σ effect(d→to)·pressure[to]. Relieving a
 *     stressed domain is valuable; adding load to an already-stressed coupled
 *     domain subtracts from that value. So the brain naturally DAMPENS growth
 *     when support is underwater, and prioritizes the true bottleneck.
 *
 * Everything here is pure + total → unit-testable. It produces a per-domain
 * weight the planner blends with objective urgency; it never acts.
 */
import type { AutopilotDomain } from "./policyGate";
import type { DecisionSenses } from "./decide";

export const DOMAINS: AutopilotDomain[] = ["growth", "support", "deploy", "ops", "finance"];

/** Acting in `from` adds `effect` to `to`'s pressure (signed). Conservative,
 * small magnitudes — a nudge that reorders within a tier, never a lever that
 * overrides the safety ladder. */
export const COUPLINGS: ReadonlyArray<{ from: AutopilotDomain; to: AutopilotDomain; effect: number }> = [
  { from: "growth", to: "support", effect: 0.3 }, // more customers ⇒ more support load
  { from: "growth", to: "finance", effect: 0.2 }, // more usage ⇒ more infra/AI cost
  { from: "support", to: "growth", effect: -0.15 }, // great support ⇒ retention ⇒ growth
  { from: "deploy", to: "support", effect: -0.1 }, // fixing bugs ⇒ fewer support tickets
  { from: "finance", to: "growth", effect: -0.1 }, // healthy runway ⇒ room to grow
];

/** Derive each domain's current pressure (0..1) from the real senses. Pure. */
export function pressuresFromSenses(s: DecisionSenses): Record<AutopilotDomain, number> {
  const clamp = (n: number) => Math.min(1, Math.max(0, n));
  const envelope = s.envelopeStatus === "red" ? 1 : s.envelopeStatus === "amber" ? 0.5 : 0;
  return {
    deploy: clamp((s.openIncidents ?? 0) * 0.5 + (s.reflexFailures ?? 0) * 0.3),
    ops: clamp((s.complianceOpenCount ?? 0) * 0.5 + (s.emailComplaints ?? 0) * 0.3),
    support: clamp((s.supportBacklog ?? 0) / 5 + (s.churnSignals ?? 0) / 3),
    finance: clamp(envelope + (s.dunningPressure ?? 0) / 5),
    growth: clamp((s.activationStalled ? 0.4 : 0) + (s.trialsEnding ?? 0) / 5),
  };
}

/** Net leverage of acting in `domain` given the current pressures. Pure. */
export function netLeverage(domain: AutopilotDomain, pressures: Record<AutopilotDomain, number>): number {
  let value = pressures[domain];
  for (const c of COUPLINGS) {
    if (c.from === domain) value -= c.effect * pressures[c.to];
  }
  return value;
}

/**
 * A per-domain coordination WEIGHT in roughly [0.5, 1.5] — a multiplier the
 * planner blends with objective urgency for within-tier ordering. Centered on
 * 1.0 (neutral) and shifted by net leverage. Pure + bounded so it can only
 * reorder within a tier, never override the safety ladder.
 */
export function coordinationWeights(s: DecisionSenses): Record<AutopilotDomain, number> {
  const pressures = pressuresFromSenses(s);
  const out = {} as Record<AutopilotDomain, number>;
  for (const d of DOMAINS) {
    // leverage is roughly in [-1, 1]; map to [0.5, 1.5].
    out[d] = 1 + Math.max(-0.5, Math.min(0.5, netLeverage(d, pressures)));
  }
  return out;
}

/** Rank domains by net leverage (the bottleneck-first ordering). Pure. */
export function rankDomainsByLeverage(s: DecisionSenses): Array<{ domain: AutopilotDomain; leverage: number }> {
  const pressures = pressuresFromSenses(s);
  return DOMAINS.map((d) => ({ domain: d, leverage: netLeverage(d, pressures) })).sort((a, b) => b.leverage - a.leverage);
}
