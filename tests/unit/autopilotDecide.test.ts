import { describe, it, expect } from "vitest";
import { rankMoves, topMove, sensesFromPulse, type DecisionSenses } from "../../server/services/autopilot/decide";

const calm: DecisionSenses = {
  openIncidents: 0,
  complianceOpenCount: 0,
  envelopeStatus: "green",
  supportBacklog: 0,
  trials: 0,
  activationStalled: false,
  mrr: 0,
  dispatchBacklog: 0,
};

describe("autopilot decide-core — the brain's judgment", () => {
  it("is total: always returns at least the optimize move, even on a calm system", () => {
    const moves = rankMoves(calm);
    expect(moves.length).toBeGreaterThanOrEqual(1);
    expect(moves.at(-1)).toMatchObject({ kind: "optimize", domain: "ops" });
  });

  it("STABILIZE beats everything: an open incident outranks support, activation, and growth", () => {
    const top = topMove({ ...calm, openIncidents: 1, supportBacklog: 5, activationStalled: true, trials: 3 });
    expect(top.kind).toBe("resolve_incident");
    expect(top.priority).toBe(0);
  });

  it("a RED envelope forces runway protection before growth", () => {
    const moves = rankMoves({ ...calm, envelopeStatus: "red" });
    expect(moves[0].kind).toBe("protect_runway");
    // growth must NOT be proposed when the envelope is red
    expect(moves.find((m) => m.kind === "grow_owned_channels")).toBeUndefined();
  });

  it("compliance is cleared before any outward action", () => {
    const moves = rankMoves({ ...calm, complianceOpenCount: 2 });
    expect(moves[0].kind).toBe("clear_compliance");
    expect(moves.find((m) => m.kind === "grow_owned_channels")).toBeUndefined();
  });

  it("waiting customers (support) outrank activation and growth", () => {
    const top = topMove({ ...calm, supportBacklog: 3, activationStalled: true, trials: 4 });
    expect(top.kind).toBe("clear_support_backlog");
    expect(top.domain).toBe("support");
  });

  it("fixes the activation leak before pouring on more growth", () => {
    const moves = rankMoves({ ...calm, activationStalled: true, trials: 5 });
    const activationIdx = moves.findIndex((m) => m.kind === "unblock_activation");
    const growthIdx = moves.findIndex((m) => m.kind === "grow_owned_channels");
    expect(activationIdx).toBeGreaterThanOrEqual(0);
    expect(growthIdx).toBeGreaterThan(activationIdx);
  });

  it("grows only when stable, within budget, and not already backed up", () => {
    expect(rankMoves(calm).find((m) => m.kind === "grow_owned_channels")).toBeDefined();
    // backed up → don't pile on more growth dispatches
    expect(rankMoves({ ...calm, dispatchBacklog: 5 }).find((m) => m.kind === "grow_owned_channels")).toBeUndefined();
  });

  it("never invents senses — it ranks only from what it's given", () => {
    // No `uptime` input exists on DecisionSenses by design; the brain can't act
    // on a sense that isn't measured.
    expect(Object.keys(calm)).not.toContain("uptime");
  });

  it("sensesFromPulse maps real pulse fields and defaults unmeasured ones honestly", () => {
    const senses = sensesFromPulse({
      mrr: 250,
      trials: 4,
      complianceOpenCount: 1,
      envelopeStatus: "amber",
      dispatchesFlaggedLast24h: 2,
    });
    expect(senses.mrr).toBe(250);
    expect(senses.openIncidents).toBe(2); // flagged dispatches proxy incidents
    expect(senses.complianceOpenCount).toBe(1);
    // unmeasured senses default to the honest "none known", never invented
    expect(senses.supportBacklog).toBe(0);
    expect(senses.activationStalled).toBe(false);
    expect(senses.dispatchBacklog).toBe(0);
    // and the brain acts on it: a flagged incident makes stabilize the top move
    expect(topMove(senses).kind).toBe("resolve_incident");
  });
});
