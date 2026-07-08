import { describe, it, expect } from "vitest";
import { admitPack, assertPackAdmitted } from "../../server/services/autopilot/admitPack";
import type { DomainPack } from "../../server/services/autopilot/domainPack";
import { LAND_PACK } from "../../server/services/autopilot/packs/land";

/**
 * Frontier #11 — admitPack is the proof obligation a DomainPack discharges
 * before the kernel runs on it. The real pack must always pass; every malformed
 * shape must be rejected (fail-closed).
 */

const validPack = (over: Partial<DomainPack> = {}): DomainPack => ({
  id: "demo",
  label: "Demo",
  causalModel: {
    version: 1,
    variables: [
      { id: "lev", label: "Lever", kind: "lever" },
      { id: "out", label: "Outcome", kind: "outcome" },
    ],
    edges: [{ from: "lev", to: "out", effect: 0.4, confidence: 0.3, evidence: "prior" }],
  },
  moveToLever: { do_thing: "lev" },
  ...over,
});

describe("admitPack — the refinement proof", () => {
  it("ADMITS the real LAND_PACK (the shipping pack must always conform)", () => {
    const v = admitPack(LAND_PACK);
    expect(v.admitted).toBe(true);
    expect(v.violations).toEqual([]);
  });

  it("admits a minimal valid pack", () => {
    expect(admitPack(validPack()).admitted).toBe(true);
  });

  it("REJECTS a non-kebab id", () => {
    expect(admitPack(validPack({ id: "Demo Pack" })).admitted).toBe(false);
  });

  it("REJECTS a causal model with no outcome variable (the brain can't rank EV)", () => {
    const v = admitPack(validPack({
      causalModel: { version: 1, variables: [{ id: "lev", label: "L", kind: "lever" }], edges: [] },
    }));
    expect(v.admitted).toBe(false);
    expect(v.violations.join(" ")).toMatch(/outcome/);
  });

  it("REJECTS a dangling moveToLever entry (move → non-existent lever)", () => {
    const v = admitPack(validPack({ moveToLever: { do_thing: "ghost" } }));
    expect(v.admitted).toBe(false);
    expect(v.violations.join(" ")).toMatch(/not a declared lever/);
  });

  it("REJECTS an edge referencing an unknown variable", () => {
    const v = admitPack(validPack({
      causalModel: {
        version: 1,
        variables: [{ id: "lev", label: "L", kind: "lever" }, { id: "out", label: "O", kind: "outcome" }],
        edges: [{ from: "lev", to: "ghost", effect: 0.1, confidence: 0.5, evidence: "x" }],
      },
    }));
    expect(v.admitted).toBe(false);
    expect(v.violations.join(" ")).toMatch(/unknown variable/);
  });

  it("REJECTS a cyclic causal model", () => {
    const v = admitPack(validPack({
      causalModel: {
        version: 1,
        variables: [{ id: "a", label: "A", kind: "lever" }, { id: "b", label: "B", kind: "outcome" }],
        edges: [
          { from: "a", to: "b", effect: 0.1, confidence: 0.5, evidence: "x" },
          { from: "b", to: "a", effect: 0.1, confidence: 0.5, evidence: "x" },
        ],
      },
    }));
    expect(v.admitted).toBe(false);
    expect(v.violations.join(" ")).toMatch(/acyclic/);
  });

  it("REJECTS out-of-range edge confidence", () => {
    const v = admitPack(validPack({
      causalModel: {
        version: 1,
        variables: [{ id: "lev", label: "L", kind: "lever" }, { id: "out", label: "O", kind: "outcome" }],
        edges: [{ from: "lev", to: "out", effect: 0.1, confidence: 1.5, evidence: "x" }],
      },
    }));
    expect(v.admitted).toBe(false);
    expect(v.violations.join(" ")).toMatch(/confidence/);
  });

  it("is total — never throws on garbage input", () => {
    expect(admitPack(null as unknown as DomainPack).admitted).toBe(false);
    expect(admitPack({} as DomainPack).admitted).toBe(false);
  });

  it("assertPackAdmitted throws on a bad pack, passes a good one", () => {
    expect(() => assertPackAdmitted(validPack())).not.toThrow();
    expect(() => assertPackAdmitted(validPack({ id: "BAD" }))).toThrow(/failed admission/);
  });
});
