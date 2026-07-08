import { describe, it, expect, vi } from "vitest";

vi.mock("../../server/db", () => ({ db: {} }));

import { snapshotEdges } from "../../server/services/autopilot/worldModelSnapshot";
import { refineModel, type CausalModel } from "../../server/services/autopilot/worldModel";

const MODEL: CausalModel = {
  version: 3,
  variables: [
    { id: "lever", label: "lever", kind: "lever" },
    { id: "out", label: "out", kind: "outcome" },
  ],
  edges: [{ from: "lever", to: "out", effect: 0.5, confidence: 0.4, evidence: "prior" }],
};

describe("snapshotEdges — the observable confidence trajectory (T1.3 #10)", () => {
  it("captures version, edges, and counts; a prior edge is unmeasured", () => {
    const s = snapshotEdges(MODEL);
    expect(s.modelVersion).toBe(3);
    expect(s.edgeCount).toBe(1);
    expect(s.measuredEdgeCount).toBe(0);
    expect(s.edges[0]).toMatchObject({ from: "lever", to: "out", confidence: 0.4, measured: false });
  });

  it("flags an edge as measured once refined from real consequence", () => {
    const refined = refineModel(MODEL, { lever: { successes: 20, failures: 0 } });
    const s = snapshotEdges(refined);
    expect(s.measuredEdgeCount).toBe(1);
    expect(s.edges[0].measured).toBe(true);
    expect(s.edges[0].confidence).toBeGreaterThan(0.4); // sharpened from the prior
  });
});
