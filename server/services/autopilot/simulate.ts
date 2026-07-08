/**
 * Founder Autopilot — simulate-before-act (the honest counterfactual).
 *
 * North-Star elevation #3: before the founder is asked to approve a move, the
 * system attaches "here's what happens if you do / don't." The discipline here
 * is HONESTY — we attach only what is genuinely knowable: the hard cost
 * ceiling, whether the action is reversible, whether it touches a customer, and
 * what concretely clears on each choice. We do NOT fabricate outcome numbers
 * ("~14 signups, $260 revenue") — that's exactly the slop the craft + truth
 * standards forbid. A truthful "up to $5, reversible, drafts only" beats a
 * made-up forecast every time.
 *
 * Pure + deterministic → unit-testable.
 */
import type { RankedMove } from "./decide";
import type { AutopilotDomain } from "./policyGate";
import { bindingFor } from "./act";

export interface SimulateContext {
  maxCostUsd: number;
  envelopeStatus: "green" | "amber" | "red";
}

export interface MoveSimulation {
  domain: AutopilotDomain;
  customerFacing: boolean;
  /** Hard ceiling on AI spend for this action (real — the dispatch cap). */
  maxCostUsd: number;
  /** Whether the effect can be undone after it lands. */
  reversible: boolean;
  riskLevel: "low" | "medium" | "high";
  ifApproved: string;
  ifDeclined: string;
  /** Honest caveats — only true things (envelope pressure, the human-tap, etc). */
  notes: string[];
}

export function simulateMove(move: RankedMove, ctx: SimulateContext): MoveSimulation {
  const b = bindingFor(move.kind);
  const customerFacing = b.isCustomerFacing;

  // Reversibility: internal artifacts (content, code, ops) are reviewable +
  // roll-backable; a message sent to a customer cannot be unsent. Customer-
  // facing actions are gated by the tap precisely because approval is the
  // point of no return.
  const reversible = !customerFacing;

  // Risk: money movement is highest; reaching a real person is medium; internal
  // owned work is low. Honest + coarse — not a fake probability.
  const riskLevel: MoveSimulation["riskLevel"] =
    b.domain === "finance" ? "high" : customerFacing ? "medium" : "low";

  const ifApproved = customerFacing
    ? `The system carries out "${move.kind}" and the artifact reaches the customer. Up to $${ctx.maxCostUsd.toFixed(2)} in AI cost. This cannot be unsent.`
    : `The system carries out "${move.kind}" (${b.domain}). Up to $${ctx.maxCostUsd.toFixed(2)} in AI cost. Reversible — it produces a reviewable artifact, not an irreversible effect.`;

  const ifDeclined =
    "Nothing happens. The system holds, and will re-surface this only if it stays the highest-value move.";

  const notes: string[] = [];
  if (customerFacing) notes.push("Customer-facing — it always required your tap (witnessed-send).");
  if (ctx.envelopeStatus === "amber") notes.push("Spend is approaching the budget line this month.");
  if (ctx.envelopeStatus === "red") notes.push("Runway is constrained (envelope RED) — consider holding non-essential spend.");
  if (b.domain === "finance") notes.push("Touches money — review carefully.");

  return { domain: b.domain, customerFacing, maxCostUsd: ctx.maxCostUsd, reversible, riskLevel, ifApproved, ifDeclined, notes };
}

/** Render the simulation as a compact, human block for the founder ask body. */
export function renderSimulation(sim: MoveSimulation): string {
  const lines = [
    "— What happens —",
    `If you approve: ${sim.ifApproved}`,
    `If you decline: ${sim.ifDeclined}`,
    `Risk: ${sim.riskLevel} · Reversible: ${sim.reversible ? "yes" : "no"} · Cost ceiling: $${sim.maxCostUsd.toFixed(2)}`,
  ];
  if (sim.notes.length) lines.push(`Notes: ${sim.notes.join(" ")}`);
  return lines.join("\n");
}
