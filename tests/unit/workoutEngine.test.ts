/**
 * Notes V2 Leg 2 — the workout NPV engine (shared/notes/workoutEngine.ts).
 *
 *   7. The golden case: every path's NPV equals the independently computed
 *      figure (shared/notes/golden/workout-golden.compute.py — Python Decimal,
 *      not this engine) to the cent, line by line, and each path's discounted
 *      column re-adds to its NPV.
 *   8. Missing-input refusal: remove each required input in turn — exactly the
 *      affected paths refuse, naming it; no path computes from a guessed value.
 *  10. Sensitivity: value and timeline perturbations move NPVs in the expected
 *      direction and by the expected amount on the golden case.
 *  11. Claims shape: no recommendation, ranking, score or winner anywhere in the
 *      payload, and the path order is fixed whatever the numbers are.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
// The neutral order the spec lists the paths in, pinned here independently of the engine.
const WORKOUT_PATHS = ["hold_perform", "modification", "forbearance", "deed_in_lieu", "foreclosure", "charge_off_hold"] as const;
import {
  runWorkoutComparison,
  WORKOUT_ENGINE_VERSION,
  type WorkoutInputs,
  type PathResult,
} from "@shared/notes/workoutEngine";

const golden = JSON.parse(readFileSync(path.join(__dirname, "../../shared/notes/golden/workout-golden.expected.json"), "utf8")) as {
  inputs: WorkoutInputs;
  modifiedPaymentCents: number;
  npvCents: Record<string, number>;
  discountedLines: Record<string, Record<string, number>>;
  sensitivity: Record<string, number>;
};
const clone = (): WorkoutInputs => JSON.parse(JSON.stringify(golden.inputs));
const computed = (p: PathResult | undefined) => {
  if (!p || p.status !== "computed") throw new Error(`expected computed, got ${JSON.stringify(p)}`);
  return p;
};
const pathOf = (r: ReturnType<typeof runWorkoutComparison>, name: string) => r.paths.find((p) => p.path === name);

describe("workout engine — golden case (7)", () => {
  const run = runWorkoutComparison(golden.inputs);

  it("computes every path and stamps the engine version", () => {
    expect(run.status).toBe("computed");
    expect(run.engineVersion).toBe(WORKOUT_ENGINE_VERSION);
    expect(run.paths.map((p) => p.status)).toEqual(WORKOUT_PATHS.map(() => "computed"));
  });

  for (const p of WORKOUT_PATHS) {
    it(`${p}: NPV matches the independent arithmetic to the cent, line by line`, () => {
      const r = computed(pathOf(run, p));
      expect(r.npvCents).toBe(golden.npvCents[p]);
      const lines = Object.fromEntries(r.lines.map((l) => [String(l.period), l.discountedCents]));
      expect(lines).toEqual(golden.discountedLines[p]);
    });

    it(`${p}: the discounted column re-adds to the NPV, and each line's net = inflow − outflow = sum of components`, () => {
      const r = computed(pathOf(run, p));
      expect(r.lines.reduce((a, l) => a + l.discountedCents, 0)).toBe(r.npvCents);
      for (const l of r.lines) {
        expect(l.netCents).toBe(l.inflowCents - l.outflowCents);
        expect(Object.values(l.components).reduce((a, b) => a + b, 0)).toBe(l.netCents);
      }
    });
  }

  it("the modification's level payment matches the independent amortization", () => {
    const r = computed(pathOf(run, "modification"));
    expect(r.assumptions.join(" ")).toContain(`${golden.modifiedPaymentCents} cents per period`);
  });

  it("forgiven principal is shown as a fact with its amount — and nothing tax-shaped", () => {
    const r = computed(pathOf(run, "modification"));
    expect(r.facts).toEqual([{ label: "Principal forgiven by the stated modification", cents: 50_000, period: null }]);
    expect(JSON.stringify(run)).not.toMatch(/1099|tax form|taxable|form 1099/i);
  });

  it("is deterministic: the same snapshot yields byte-identical output", () => {
    expect(JSON.stringify(runWorkoutComparison(clone()))).toBe(JSON.stringify(run));
  });
});

describe("workout engine — missing-input refusal (8)", () => {
  it("no discount rate, balance, rate or payment: the whole run refuses and names each", () => {
    for (const [mutate, name] of [
      [(i: WorkoutInputs) => (i.discountRateBps = null), "discount rate"],
      [(i: WorkoutInputs) => (i.note.upbCents = null), "unpaid principal balance"],
      [(i: WorkoutInputs) => (i.note.rateBps = null), "note rate"],
      [(i: WorkoutInputs) => (i.note.paymentCents = null), "payment amount"],
    ] as const) {
      const i = clone();
      mutate(i);
      const r = runWorkoutComparison(i);
      expect(r.status).toBe("refused");
      expect(r.refusedFor).toEqual([name]);
      expect(r.paths).toEqual([]);
    }
  });

  it("no collateral value: exactly the two disposition paths refuse, naming it", () => {
    const i = clone();
    i.collateralValueCents = null;
    const r = runWorkoutComparison(i);
    const refused = r.paths.filter((p) => p.status === "refused");
    expect(refused.map((p) => p.path)).toEqual(["deed_in_lieu", "foreclosure"]);
    for (const p of refused) expect(p.status === "refused" && p.missing).toEqual(["collateral value"]);
  });

  it("no foreclosure timeline: only foreclosure refuses, naming it", () => {
    const i = clone();
    i.foreclosure!.timelineMonths = null;
    const r = runWorkoutComparison(i);
    expect(r.paths.filter((p) => p.status === "refused").map((p) => [p.path, p.status === "refused" && p.missing])).toEqual([
      ["foreclosure", ["foreclosure timeline (months)"]],
    ]);
  });

  it("no remaining term: the payment-stream paths refuse (modification runs on its own stated term)", () => {
    const i = clone();
    i.note.remainingTermMonths = null;
    const r = runWorkoutComparison(i);
    expect(r.paths.filter((p) => p.status === "refused").map((p) => p.path)).toEqual(["hold_perform", "forbearance"]);
  });

  it("no arrears figure: every path that collects arrears refuses; a waived-arrears modification does not need one", () => {
    const i = clone();
    i.note.arrearsCents = null;
    expect(runWorkoutComparison(i).paths.filter((p) => p.status === "refused").map((p) => p.path)).toEqual(["hold_perform", "modification", "forbearance"]);
    i.modification!.arrearsTreatment = "waive";
    expect(pathOf(runWorkoutComparison(i), "modification")?.status).toBe("computed");
  });

  it("an unstated scenario is 'not stated', never computed from a default", () => {
    const i = clone();
    i.modification = null;
    i.forbearance = null;
    i.deedInLieu = null;
    i.foreclosure = null;
    i.chargeOffHold = null;
    const r = runWorkoutComparison(i);
    expect(r.paths.map((p) => p.status)).toEqual(["computed", "not_stated", "not_stated", "not_stated", "not_stated", "not_stated"]);
  });
});

describe("workout engine — sensitivity grid (10)", () => {
  const run = runWorkoutComparison(golden.inputs);
  const cell = (p: string, vf: number, tf: number) => run.sensitivity.find((s) => s.path === p)!.cells.find((c) => c.valueFactor === vf && c.timelineFactor === tf)!.npvCents!;

  it("the 1.0 × 1.0 cell is the path's NPV", () => {
    for (const p of WORKOUT_PATHS) expect(cell(p, 1, 1)).toBe(golden.npvCents[p]);
  });

  it("spot cells match the independent arithmetic", () => {
    expect(cell("foreclosure", 1.2, 1.25)).toBe(golden.sensitivity["foreclosure_value1.2_timeline1.25"]);
    expect(cell("deed_in_lieu", 0.8, 0.75)).toBe(golden.sensitivity["deed_in_lieu_value0.8_timeline0.75"]);
  });

  it("higher collateral value raises disposition NPVs by the discounted value difference", () => {
    for (const p of ["deed_in_lieu", "foreclosure"]) {
      const T = (p === "deed_in_lieu" ? golden.inputs.deedInLieu : golden.inputs.foreclosure)!.timelineMonths!;
      const step = 0.1 * golden.inputs.collateralValueCents! / Math.pow(1 + 0.01, T);
      expect(cell(p, 1.1, 1) - cell(p, 1, 1)).toBeCloseTo(step, -1);
      expect(cell(p, 0.8, 1)).toBeLessThan(cell(p, 0.9, 1));
      expect(cell(p, 1.2, 1)).toBeGreaterThan(cell(p, 1.1, 1));
    }
  });

  it("a longer timeline lowers the disposition and recovery NPVs (more carry, later proceeds)", () => {
    for (const p of ["deed_in_lieu", "foreclosure", "charge_off_hold"]) {
      expect(cell(p, 1, 1.25)).toBeLessThan(cell(p, 1, 1));
      expect(cell(p, 1, 0.75)).toBeGreaterThan(cell(p, 1, 1));
    }
  });

  it("paths whose model uses neither value nor timeline are flat across the grid, and say so", () => {
    for (const p of ["hold_perform", "modification", "forbearance"]) {
      const s = run.sensitivity.find((x) => x.path === p)!;
      expect(s.sensitiveTo).toEqual([]);
      expect(new Set(s.cells.map((c) => c.npvCents))).toEqual(new Set([golden.npvCents[p]]));
    }
  });
});

describe("workout engine — claims shape (11)", () => {
  const FORBIDDEN = /recommend|best|score|rank|winner|preferred|optimal|suggest/i;
  const keysOf = (v: unknown, out: string[] = []): string[] => {
    if (Array.isArray(v)) v.forEach((x) => keysOf(x, out));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { out.push(k); keysOf(x, out); }
    return out;
  };

  it("no key anywhere in the payload names a recommendation, rank, score or winner", () => {
    const keys = keysOf(runWorkoutComparison(golden.inputs));
    expect(keys.length).toBeGreaterThan(50); // vacuity floor: the walk actually read the payload
    expect(keys.filter((k) => FORBIDDEN.test(k))).toEqual([]);
  });

  it("no assumption or reason text advises", () => {
    const r = runWorkoutComparison(golden.inputs);
    const text = r.paths.flatMap((p) => (p.status === "computed" ? p.assumptions : [p.reason])).join(" ");
    expect(text).not.toMatch(FORBIDDEN);
    expect(text).not.toMatch(/\bshould\b/i);
  });

  it("path order is fixed and never follows value: reshuffling which path is largest does not move any path", () => {
    for (const value of [100_000, 1_200_000, 50_000_000]) {
      const i = clone();
      i.collateralValueCents = value;
      const r = runWorkoutComparison(i);
      expect(r.paths.map((p) => p.path)).toEqual([...WORKOUT_PATHS]);
    }
    // Vacuity: the scenarios above genuinely change which path is largest.
    const largest = (value: number) => {
      const i = clone();
      i.collateralValueCents = value;
      const ps = runWorkoutComparison(i).paths.map((p) => computed(p));
      return ps.reduce((a, b) => (b.npvCents > a.npvCents ? b : a)).path;
    };
    expect(largest(100_000)).not.toBe(largest(50_000_000));
  });
});
