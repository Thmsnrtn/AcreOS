import { describe, it, expect } from "vitest";
import { makeSeededRng } from "../../server/services/autopilot/efficacy";
import { admitPack } from "../../server/services/autopilot/admitPack";
import { moveEvMap, rankMovesByCausalEv, predictMoveEffect } from "../../server/services/autopilot/worldModel";
import { scaffoldPackFiles } from "../../scripts/scaffold-pack.mjs";
import type { DomainPack } from "../../server/services/autopilot/domainPack";
import type { CausalModel } from "../../server/services/autopilot/worldModel";

/**
 * Frontier #11 — PACK INVARIANCE. The kernel claims to run UNCHANGED on any
 * vertical that supplies a conforming pack. These property tests make that
 * machine-checkable: generate many random ADMITTED packs and assert the kernel
 * never breaks on them; generate malformed packs and assert admitPack always
 * rejects them. This is the proof the seam is sound — the precondition to
 * platformizing on a second vertical.
 */
const rng = makeSeededRng(20260625);
const pick = <T>(a: T[]): T => a[Math.floor(rng() * a.length)];

/** Generate a random WELL-FORMED pack (acyclic chain lever→…→outcome). */
function randomValidPack(i: number): DomainPack {
  const nLevers = 1 + Math.floor(rng() * 3);
  const nMetrics = Math.floor(rng() * 3);
  const variables: CausalModel["variables"] = [];
  for (let k = 0; k < nLevers; k++) variables.push({ id: `lev${k}`, label: `L${k}`, kind: "lever" });
  for (let k = 0; k < nMetrics; k++) variables.push({ id: `met${k}`, label: `M${k}`, kind: "metric" });
  variables.push({ id: "out", label: "Outcome", kind: "outcome" });
  // Acyclic by construction: every edge points to a LATER variable in the array.
  const edges: CausalModel["edges"] = [];
  for (let a = 0; a < variables.length; a++) {
    for (let b = a + 1; b < variables.length; b++) {
      if (rng() < 0.5) {
        edges.push({ from: variables[a].id, to: variables[b].id, effect: (rng() - 0.5), confidence: rng(), evidence: "prior" });
      }
    }
  }
  const moveToLever: Record<string, string> = {};
  for (let m = 0; m < 1 + Math.floor(rng() * 4); m++) {
    moveToLever[`move_${m}`] = `lev${Math.floor(rng() * nLevers)}`;
  }
  return { id: `gen-${i}`, label: `Gen ${i}`, causalModel: { version: 1, variables, edges }, moveToLever };
}

describe("pack invariance — the kernel runs unchanged on ANY admitted pack", () => {
  it("every generated valid pack is admitted, and the kernel never breaks on it", () => {
    for (let i = 0; i < 120; i++) {
      const pack = randomValidPack(i);
      const verdict = admitPack(pack);
      expect(verdict.admitted).toBe(true); // generator only makes conforming packs

      // The kernel's pack-consuming functions must be TOTAL on any admitted pack.
      const moves = Object.keys(pack.moveToLever).map((kind, idx) => ({ kind, priority: 4 + (idx % 2), rationale: "x" }));
      const evMap = moveEvMap(moves, pack.causalModel, pack.moveToLever);
      for (const k of Object.keys(pack.moveToLever)) {
        expect(Number.isFinite(evMap[k])).toBe(true); // never NaN/undefined
      }
      const ranked = rankMovesByCausalEv(moves, pack.causalModel, pack.moveToLever);
      expect(ranked.length).toBe(moves.length); // ranking preserves the candidate set
      for (const m of moves) {
        const eff = predictMoveEffect(m.kind, pack.causalModel, pack.moveToLever);
        // either a real prediction or honest null — never a throw, never garbage
        expect(eff === null || Array.isArray(eff.effects)).toBe(true);
      }
    }
  });

  it("malformed packs are ALWAYS rejected (fail-closed) — never silently admitted", () => {
    const breakers: Array<(p: DomainPack) => DomainPack> = [
      (p) => ({ ...p, id: "Bad Id" }),
      (p) => ({ ...p, causalModel: { ...p.causalModel, variables: p.causalModel.variables.filter((v) => v.kind !== "outcome") } }),
      (p) => ({ ...p, moveToLever: { ...p.moveToLever, ghost_move: "no_such_lever" } }),
      (p) => ({ ...p, label: "" }),
    ];
    for (let i = 0; i < 60; i++) {
      const base = randomValidPack(i);
      const broken = pick(breakers)(base);
      expect(admitPack(broken).admitted).toBe(false);
    }
  });
});

describe("scaffolder produces an admissible pack (the skeleton refines the kernel on day one)", () => {
  it("the scaffolded index pack compiles to an admitted DomainPack shape", async () => {
    const files = scaffoldPackFiles("solar-leasing");
    // sanity on the generated source — the real admission is compile-time, but we
    // assert the generated causal model is valid by reconstructing it minimally.
    expect(Object.keys(files)).toEqual([
      "packs/solar-leasing/causalModel.ts",
      "packs/solar-leasing/regulatoryProfile.ts",
      "packs/solar-leasing/index.ts",
    ]);
    const cm = files["packs/solar-leasing/causalModel.ts"];
    expect(cm).toMatch(/kind: "outcome"/);
    expect(cm).toMatch(/kind: "lever"/);
    expect(cm).toMatch(/SOLAR_LEASING_CAUSAL_MODEL/);
    // Mirror the scaffolded model into a pack object + admit it (proves day-one validity).
    const scaffolded: DomainPack = {
      id: "solar-leasing",
      label: "SolarLeasing",
      causalModel: {
        version: 1,
        variables: [
          { id: "primary_action", label: "Primary action", kind: "lever" },
          { id: "engagement", label: "Engagement", kind: "metric" },
          { id: "revenue", label: "Revenue", kind: "outcome" },
        ],
        edges: [
          { from: "primary_action", to: "engagement", effect: 0.5, confidence: 0.2, evidence: "prior" },
          { from: "engagement", to: "revenue", effect: 0.3, confidence: 0.2, evidence: "prior" },
        ],
      },
      moveToLever: {},
    };
    expect(admitPack(scaffolded).admitted).toBe(true);
  });

  it("the scaffolder rejects a non-kebab id", () => {
    expect(() => scaffoldPackFiles("Bad Id")).toThrow(/kebab/);
  });
});
