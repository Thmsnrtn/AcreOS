import { describe, it, expect } from "vitest";
import {
  queryIntervention,
  summarizeModel,
  predictMoveEffect,
  refineConfidence,
  refineModel,
  rankMovesByCausalEv,
  type CausalModel,
} from "../../server/services/autopilot/worldModel";

// Domain-agnostic toy model — the kernel must reason over ANY ontology, so its
// tests carry no domain vocabulary (the land seed model is tested in landPack.test.ts).
const TOY: CausalModel = {
  version: 1,
  variables: [
    { id: "lever", label: "A lever", kind: "lever" },
    { id: "mid", label: "An intermediate metric", kind: "metric" },
    { id: "out", label: "The outcome", kind: "outcome" },
  ],
  edges: [
    { from: "lever", to: "mid", effect: 0.8, confidence: 0.4, evidence: "prior" },
    { from: "mid", to: "out", effect: 0.5, confidence: 0.3, evidence: "prior" },
  ],
};

describe("queryIntervention — forward causal propagation (the planning oracle)", () => {
  it("propagates an intervention along the chain to the outcome", () => {
    const r = queryIntervention(TOY, "lever", 10);
    const mid = r.effects.find((e) => e.variable === "mid");
    const out = r.effects.find((e) => e.variable === "out");
    expect(mid?.deltaPct).toBeCloseTo(8, 5); // 10 * 0.8
    expect(out).toBeTruthy(); // 10 * 0.8 * 0.5 = 4
    expect(out!.deltaPct).toBeCloseTo(4, 2);
    expect(out!.confidence).toBeGreaterThan(0); // honest: low but non-zero (0.4*0.3)
    expect(out!.confidence).toBeLessThan(0.3); // priors are uncertain
  });

  it("ranks the outcome ahead of intermediate metrics", () => {
    const r = queryIntervention(TOY, "lever", 10);
    expect(r.effects[0].variable).toBe("out"); // outcome surfaced first
  });

  it("returns no effects for an unknown lever", () => {
    expect(queryIntervention(TOY, "teleport", 10).effects).toEqual([]);
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

describe("predictMoveEffect — the planning oracle bridge (kernel; pack supplies the map)", () => {
  const moveToLever = { do_the_thing: "lever" };
  it("predicts a mapped move's causal effect via its lever", () => {
    const r = predictMoveEffect("do_the_thing", TOY, moveToLever);
    expect(r).toBeTruthy();
    expect(r!.lever).toBe("lever");
    expect(r!.effects.find((e) => e.variable === "out")).toBeTruthy();
  });
  it("returns null (honest absence) for an unmapped move — never a fabricated estimate", () => {
    expect(predictMoveEffect("unknown_move", TOY, moveToLever)).toBeNull();
  });
});

describe("refineConfidence — edges move from prior toward witnessed evidence", () => {
  it("is the identity at cold-start (no evidence)", () => {
    expect(refineConfidence(0.4, { successes: 0, failures: 0 })).toBe(0.4);
  });
  it("raises confidence when the lever consistently succeeds", () => {
    const r = refineConfidence(0.4, { successes: 20, failures: 0 });
    expect(r).toBeGreaterThan(0.4);
  });
  it("lowers confidence when the lever consistently fails", () => {
    const r = refineConfidence(0.7, { successes: 0, failures: 20 });
    expect(r).toBeLessThan(0.7);
  });
  it("moves only a little on thin evidence (sample-weighted)", () => {
    const thin = refineConfidence(0.4, { successes: 1, failures: 0 });
    const thick = refineConfidence(0.4, { successes: 40, failures: 0 });
    expect(thin).toBeGreaterThan(0.4);
    expect(thick).toBeGreaterThan(thin); // more evidence → moves further
  });
});

describe("refineModel — sharpens only edges with witnessed evidence", () => {
  it("leaves edges without evidence untouched (and returns the same object)", () => {
    const r = refineModel(TOY, {});
    expect(r).toBe(TOY); // identity when nothing changed
  });
  it("refines only the lever's outgoing edge confidence, never its effect", () => {
    const refined = refineModel(TOY, { lever: { successes: 30, failures: 0 } });
    const edge = refined.edges.find((e) => e.from === "lever" && e.to === "mid")!;
    const prior = TOY.edges.find((e) => e.from === "lever")!;
    expect(edge.confidence).toBeGreaterThan(prior.confidence); // confidence moved
    expect(edge.effect).toBe(prior.effect); // magnitude untouched (honest)
    expect(edge.evidence).toMatch(/refined from 30 witnessed/);
    // a non-lever edge (mid→out) has no evidence → unchanged
    expect(refined.edges.find((e) => e.from === "mid")!.confidence).toBe(
      TOY.edges.find((e) => e.from === "mid")!.confidence,
    );
  });
});

describe("rankMovesByCausalEv — within-tier oracle tiebreak (T2.2)", () => {
  // A model where lever "good" strongly moves the outcome, "meh" barely.
  const M: CausalModel = {
    version: 1,
    variables: [
      { id: "good", label: "good", kind: "lever" },
      { id: "meh", label: "meh", kind: "lever" },
      { id: "out", label: "out", kind: "outcome" },
    ],
    edges: [
      { from: "good", to: "out", effect: 1.0, confidence: 0.9, evidence: "" },
      { from: "meh", to: "out", effect: 0.05, confidence: 0.2, evidence: "" },
    ],
  };
  const moveToLever = { grow_good: "good", grow_meh: "meh" };

  it("NEVER crosses tiers — a lower-priority high-EV move can't jump an urgent one", () => {
    const moves = [
      { priority: 4, kind: "grow_meh" },
      { priority: 0, kind: "resolve_incident" }, // urgent, no lever
    ];
    const ranked = rankMovesByCausalEv(moves, M, moveToLever);
    expect(ranked[0].kind).toBe("resolve_incident"); // tier 0 stays first
  });

  it("breaks a discretionary-tier tie toward the higher predicted EV", () => {
    const moves = [
      { priority: 4, kind: "grow_meh" },
      { priority: 4, kind: "grow_good" },
    ];
    const ranked = rankMovesByCausalEv(moves, M, moveToLever);
    expect(ranked[0].kind).toBe("grow_good"); // higher outcome movement × confidence wins
  });

  it("a move with no lever scores 0 EV and falls behind a positive-EV peer (null-action default)", () => {
    const moves = [
      { priority: 4, kind: "no_lever_move" },
      { priority: 4, kind: "grow_good" },
    ];
    expect(rankMovesByCausalEv(moves, M, moveToLever)[0].kind).toBe("grow_good");
  });

  it("preserves incoming order in the action tiers (no EV churn where urgency rules)", () => {
    const moves = [
      { priority: 2, kind: "a" },
      { priority: 2, kind: "b" },
    ];
    const ranked = rankMovesByCausalEv(moves, M, moveToLever);
    expect(ranked.map((m) => m.kind)).toEqual(["a", "b"]);
  });
});

describe("summarizeModel — honest causal theory for the Context Pack", () => {
  it("renders levers, edges, and the uncertainty caveat", () => {
    const s = summarizeModel(TOY);
    expect(s).toMatch(/Causal theory of the business/i);
    expect(s).toMatch(/A lever/);
    expect(s).toMatch(/The outcome/);
    expect(s).toMatch(/never an oracle/i);
  });

  it("flags unmeasured (prior) edges vs measured ones (T1.1 honesty)", () => {
    // TOY's edges are all priors → every edge flagged unmeasured.
    expect(summarizeModel(TOY)).toMatch(/prior — unmeasured/);
    // After refinement from evidence, the refined edge is badged "measured".
    const refined = refineModel(TOY, { lever: { successes: 20, failures: 0 } });
    const s = summarizeModel(refined);
    expect(s).toMatch(/measured/);
  });
});
