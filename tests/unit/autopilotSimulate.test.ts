import { describe, it, expect } from "vitest";
import { simulateMove, renderSimulation } from "../../server/services/autopilot/simulate";
import type { RankedMove } from "../../server/services/autopilot/decide";

const move = (kind: string): RankedMove => ({ priority: 4, domain: "growth", kind, rationale: "r" });
const ctx = (over: Partial<{ maxCostUsd: number; envelopeStatus: "green" | "amber" | "red" }> = {}) => ({
  maxCostUsd: 5,
  envelopeStatus: "green" as const,
  ...over,
});

describe("autopilot simulate-before-act — honest counterfactual", () => {
  it("HONESTY: never fabricates outcome numbers (no invented signups/revenue)", () => {
    const text = renderSimulation(simulateMove(move("grow_owned_channels"), ctx()));
    expect(text).not.toMatch(/\d+\s*(signups?|leads?|conversions?|customers?)/i);
    expect(text).not.toMatch(/revenue|forecast|projected|estimated\s+\d/i);
  });

  it("surfaces the REAL cost ceiling and reversibility", () => {
    const sim = simulateMove(move("grow_owned_channels"), ctx({ maxCostUsd: 5 }));
    expect(sim.maxCostUsd).toBe(5);
    expect(sim.reversible).toBe(true); // owned content is reviewable/rollback-able
    expect(renderSimulation(sim)).toMatch(/Cost ceiling: \$5\.00/);
  });

  it("a customer-facing move is not reversible (a send can't be unsent) and flags the tap", () => {
    const sim = simulateMove(move("clear_support_backlog"), ctx());
    expect(sim.customerFacing).toBe(true);
    expect(sim.reversible).toBe(false);
    expect(sim.riskLevel).toBe("medium");
    expect(sim.notes.join(" ")).toMatch(/witnessed-send|your tap/i);
    expect(sim.ifApproved).toMatch(/cannot be unsent/i);
  });

  it("money movement is high risk", () => {
    expect(simulateMove(move("protect_runway"), ctx()).riskLevel).toBe("high");
  });

  it("internal owned work is low risk and reversible", () => {
    const sim = simulateMove(move("optimize"), ctx());
    expect(sim.riskLevel).toBe("low");
    expect(sim.reversible).toBe(true);
  });

  it("surfaces true budget pressure only when it exists", () => {
    expect(simulateMove(move("optimize"), ctx({ envelopeStatus: "green" })).notes.join(" ")).not.toMatch(/runway|budget line/i);
    expect(simulateMove(move("optimize"), ctx({ envelopeStatus: "red" })).notes.join(" ")).toMatch(/constrained|RED/i);
  });

  it("declining always means nothing happens (no hidden side effect)", () => {
    expect(simulateMove(move("optimize"), ctx()).ifDeclined).toMatch(/Nothing happens/i);
  });
});
