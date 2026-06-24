import { describe, it, expect } from "vitest";
import { queryIntervention, summarizeModel, predictMoveEffect } from "../../server/services/autopilot/worldModel";
import { LAND_PACK, landEvidenceByLever } from "../../server/services/autopilot/packs/land";
import type { DomainPack } from "../../server/services/autopilot/domainPack";

// The land domain pack — the first (today only) implementation of the kernel↔
// vertical seam. These assertions own the land-specific causal numbers; the
// kernel mechanics are tested domain-agnostically in worldModel.test.ts.

describe("LAND_PACK — conforms to the DomainPack seam", () => {
  it("is a well-formed DomainPack", () => {
    const pack: DomainPack = LAND_PACK; // type-asserts conformance
    expect(pack.id).toBe("land");
    expect(pack.label).toMatch(/land/i);
    expect(pack.causalModel.variables.length).toBeGreaterThan(0);
    expect(Object.keys(pack.moveToLever).length).toBeGreaterThan(0);
  });

  it("every move maps to a real lever in the causal model", () => {
    const leverIds = new Set(
      LAND_PACK.causalModel.variables.filter((v) => v.kind === "lever").map((v) => v.id),
    );
    for (const lever of Object.values(LAND_PACK.moveToLever)) {
      expect(leverIds.has(lever)).toBe(true);
    }
  });

  it("supplies a regulatory profile the kernel claims engine can screen against", () => {
    expect(LAND_PACK.regulatoryProfile).toBeTruthy();
    expect(LAND_PACK.regulatoryProfile!.determinationPatterns.length).toBeGreaterThan(0);
    expect(LAND_PACK.regulatoryProfile!.bannedPatterns.length).toBeGreaterThan(0);
    expect(LAND_PACK.regulatoryProfile!.disclosureCues.length).toBeGreaterThan(0);
  });

  it("every edge endpoint references a declared variable", () => {
    const ids = new Set(LAND_PACK.causalModel.variables.map((v) => v.id));
    for (const e of LAND_PACK.causalModel.edges) {
      expect(ids.has(e.from)).toBe(true);
      expect(ids.has(e.to)).toBe(true);
    }
  });
});

describe("land seed model — causal propagation produces the seeded numbers", () => {
  it("propagates publish_guide → indexed_pages → … → MRR", () => {
    const r = queryIntervention(LAND_PACK.causalModel, "publish_guide", 10);
    const indexed = r.effects.find((e) => e.variable === "indexed_pages");
    const mrr = r.effects.find((e) => e.variable === "mrr");
    expect(indexed?.deltaPct).toBeCloseTo(8, 5); // 10 * 0.8
    // 10*0.8*0.5*0.3*0.15*1.0 = 0.18
    expect(mrr!.deltaPct).toBeCloseTo(0.18, 2);
    expect(mrr!.confidence).toBeGreaterThan(0); // honest: low but non-zero
    expect(mrr!.confidence).toBeLessThan(0.3); // priors are uncertain
  });

  it("surfaces MRR (the outcome) first", () => {
    const r = queryIntervention(LAND_PACK.causalModel, "publish_guide", 10);
    expect(r.effects[0].variable).toBe("mrr");
  });
});

describe("predictMoveEffect bound to the land pack", () => {
  it("predicts grow_owned_channels via the publish_guide lever", () => {
    const r = predictMoveEffect("grow_owned_channels", LAND_PACK.causalModel, LAND_PACK.moveToLever);
    expect(r).toBeTruthy();
    expect(r!.lever).toBe("publish_guide");
    expect(r!.effects.find((e) => e.variable === "mrr")).toBeTruthy();
  });

  it("returns null for an unmapped move (e.g. recover_payments)", () => {
    expect(predictMoveEffect("recover_payments", LAND_PACK.causalModel, LAND_PACK.moveToLever)).toBeNull();
  });
});

describe("landEvidenceByLever — refines from CONSEQUENCE only (T1.1)", () => {
  it("counts a recovered payment as success, a bounce as failure, per lever", () => {
    const ev = landEvidenceByLever([
      { moveKind: "grow_owned_channels", paymentRecovered: true },
      { moveKind: "grow_owned_channels", paymentRecovered: true },
      { moveKind: "grow_owned_channels", deliveryBounced: true },
    ]);
    expect(ev.publish_guide).toEqual({ successes: 2, failures: 1 });
  });
  it("does NOT move confidence on episodes with no real consequence (execution proxy disconnected)", () => {
    // A mechanically-successful move with no observed downstream consequence
    // contributes nothing to causal confidence — the whole point of T1.1.
    const ev = landEvidenceByLever([
      { moveKind: "grow_owned_channels", paymentRecovered: null, deliveryBounced: null },
      { moveKind: "grow_owned_channels" },
    ]);
    expect(ev).toEqual({});
  });
  it("ignores unmapped moves", () => {
    expect(landEvidenceByLever([{ moveKind: "recover_payments", paymentRecovered: true }])).toEqual({});
  });
});

describe("summarizeModel renders the land theory", () => {
  it("names the land levers and MRR outcome", () => {
    const s = summarizeModel(LAND_PACK.causalModel);
    expect(s).toMatch(/Publish a county guide/);
    expect(s).toMatch(/MRR/);
  });
});
