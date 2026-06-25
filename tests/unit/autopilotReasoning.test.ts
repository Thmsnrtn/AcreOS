import { describe, it, expect } from "vitest";
import { buildReasoningTrace, type ReasoningTraceInput } from "../../server/services/autopilot/reasoning";

const calm: ReasoningTraceInput["senses"] = {
  mrr: 0,
  trials: 0,
  supportBacklog: 0,
  envelopeStatus: "green",
  dispatchBacklog: 0,
  openIncidents: 0,
  complianceOpenCount: 0,
};

const base = (over: Partial<ReasoningTraceInput> = {}): ReasoningTraceInput => ({
  consideredMoves: [
    { kind: "grow_owned_channels", priority: 4, rationale: "stable" },
    { kind: "optimize", priority: 5, rationale: "default" },
  ],
  chosen: { kind: "grow_owned_channels", domain: "growth", playId: "county-guide" },
  senses: calm,
  forecast: { successProb: 0.8, n: 5, confidence: "medium" },
  gate: { decision: "pass" },
  outcome: "acted",
  ...over,
});

describe("autopilot reasoning trace — the glass box", () => {
  it("reconstructs the full chain: options weighed, choice, forecast, gate, outcome", () => {
    const t = buildReasoningTrace(base());
    expect(t.narrative).toMatch(/weighed 2 options/);
    expect(t.narrative).toMatch(/chose "grow_owned_channels" \(county-guide\)/);
    expect(t.narrative).toMatch(/~80% likely to go well, from 5 past runs/);
    expect(t.narrative).toMatch(/cleared every gate/);
    expect(t.narrative).toMatch(/carried it out/);
    // structured fields preserved verbatim
    expect(t.chosen.playId).toBe("county-guide");
    expect(t.gate.decision).toBe("pass");
  });

  it("names the dominant sense that drove the choice (incident > compliance > runway > support > stable)", () => {
    expect(buildReasoningTrace(base({ senses: { ...calm, openIncidents: 2 } })).narrative).toMatch(/2 open incident/);
    expect(buildReasoningTrace(base({ senses: { ...calm, complianceOpenCount: 1 } })).narrative).toMatch(/compliance/);
    expect(buildReasoningTrace(base({ senses: { ...calm, envelopeStatus: "red" } })).narrative).toMatch(/runway was constrained/);
    expect(buildReasoningTrace(base({ senses: { ...calm, supportBacklog: 3 } })).narrative).toMatch(/3 customer\(s\) were waiting/);
    expect(buildReasoningTrace(base()).narrative).toMatch(/stable/);
  });

  it("HONESTY: with no track record it says it couldn't forecast, never fakes a number", () => {
    const t = buildReasoningTrace(base({ forecast: { successProb: 0.5, n: 0, confidence: "none" } }));
    expect(t.narrative).toMatch(/No track record yet/i);
    expect(t.narrative).not.toMatch(/~\d+% likely/);
  });

  it("Frontier #2: glass-boxes the road not taken when the model ranked one higher (as an estimate)", () => {
    const t = buildReasoningTrace(base({ shadowRegret: { bestAlternativeKind: "optimize", regret: 2.5, isEstimate: true } }));
    expect(t.narrative).toMatch(/rated "optimize" a bit higher/);
    expect(t.narrative).toMatch(/est\. \+2\.5/);
    expect(t.narrative).toMatch(/not observed/); // always framed as estimate
    expect(t.narrative).toMatch(/chose "grow_owned_channels" anyway/);
  });

  it("Frontier #2: stays silent when there was no regret (chosen WAS the top pick)", () => {
    const zero = buildReasoningTrace(base({ shadowRegret: { bestAlternativeKind: "optimize", regret: 0, isEstimate: true } }));
    expect(zero.narrative).not.toMatch(/rated .* a bit higher/);
    const none = buildReasoningTrace(base()); // no shadowRegret at all
    expect(none.narrative).not.toMatch(/rated .* a bit higher/);
  });

  it("explains WHICH gate decided when it didn't simply pass", () => {
    const esc = buildReasoningTrace(base({ gate: { decision: "escalate", decidedBy: "witnessed_send" }, outcome: "escalated" }));
    expect(esc.narrative).toMatch(/needed your tap/);
    expect(esc.narrative).toMatch(/customer-facing/);
    expect(esc.narrative).toMatch(/brought it to you/);
    const blk = buildReasoningTrace(base({ gate: { decision: "block", decidedBy: "autonomy" }, outcome: "suppressed" }));
    expect(blk.narrative).toMatch(/autonomy gate/);
    expect(blk.narrative).toMatch(/held it and self-corrected/);
  });
});
