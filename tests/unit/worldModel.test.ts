import { describe, it, expect } from "vitest";
import { queryIntervention, summarizeModel, ACREOS_SEED_MODEL, type CausalModel } from "../../server/services/autopilot/worldModel";

describe("queryIntervention — forward causal propagation (the planning oracle)", () => {
  it("propagates an intervention along the chain to the outcome", () => {
    const r = queryIntervention(ACREOS_SEED_MODEL, "publish_guide", 10);
    const indexed = r.effects.find((e) => e.variable === "indexed_pages");
    const mrr = r.effects.find((e) => e.variable === "mrr");
    expect(indexed?.deltaPct).toBeCloseTo(8, 5); // 10 * 0.8
    expect(mrr).toBeTruthy(); // 10*0.8*0.5*0.3*0.15*1.0 = 0.18
    expect(mrr!.deltaPct).toBeCloseTo(0.18, 2);
    expect(mrr!.confidence).toBeGreaterThan(0); // honest: low but non-zero
    expect(mrr!.confidence).toBeLessThan(0.3); // priors are uncertain
  });

  it("ranks the outcome (MRR) ahead of intermediate metrics", () => {
    const r = queryIntervention(ACREOS_SEED_MODEL, "publish_guide", 10);
    expect(r.effects[0].variable).toBe("mrr"); // outcome surfaced first
  });

  it("returns no effects for an unknown lever", () => {
    expect(queryIntervention(ACREOS_SEED_MODEL, "teleport", 10).effects).toEqual([]);
  });

  it("handles a multi-path graph without double-counting (topological pass)", () => {
    const m: CausalModel = {
      version: 1,
      variables: [
        { id: "L", label: "lever", kind: "lever" },
        { id: "A", label: "a", kind: "metric" },
        { id: "B", label: "b", kind: "metric" },
        { id: "Y", label: "y", kind: "outcome" },
      ],
      edges: [
        { from: "L", to: "A", effect: 1, confidence: 1, evidence: "" },
        { from: "L", to: "B", effect: 2, confidence: 1, evidence: "" },
        { from: "A", to: "Y", effect: 1, confidence: 1, evidence: "" },
        { from: "B", to: "Y", effect: 1, confidence: 1, evidence: "" },
      ],
    };
    // Y = L*1*1 (via A) + L*2*1 (via B) = 3*delta
    expect(queryIntervention(m, "L", 10).effects.find((e) => e.variable === "Y")!.deltaPct).toBeCloseTo(30, 5);
  });
});

describe("summarizeModel — honest causal theory for the Context Pack", () => {
  it("renders levers, edges, and the uncertainty caveat", () => {
    const s = summarizeModel(ACREOS_SEED_MODEL);
    expect(s).toMatch(/Causal theory of the business/i);
    expect(s).toMatch(/Publish a county guide/);
    expect(s).toMatch(/MRR/);
    expect(s).toMatch(/never an oracle/i);
  });
});
