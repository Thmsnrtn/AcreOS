/**
 * Outcome — closing the loop without rewriting it.
 *
 * Canonical law 9: "Outcomes append learning; they do not rewrite history."
 * BI178 sharpens it: an outcome is an OBSERVATION of what happened, not
 * retroactive validation of the decision. A good decision can have a bad
 * outcome, and a record that scores decisions by their results teaches an
 * investor to be lucky rather than right.
 *
 * The design consequence tested hardest here is that variance is a PURE
 * PROJECTION over the decision's FROZEN scenario references — never a stored
 * number, and never computed against a live scenario row. A stored variance is
 * a third number that can drift from the two it derives from; a variance
 * computed against a live row lets a later recomputation silently change how a
 * past decision looks.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  OUTCOME_KINDS,
  OUTCOME_SHAPE_VERSION,
  OutcomeMetricError,
  buildOutcome,
  computeVariance,
  describeVariance,
  isTerminal,
} from "@shared/outcomes/outcome";
import type { FrozenScenarioRef } from "@shared/economics/scenario";

const ROOT = path.resolve(__dirname, "../..");

function scenarioRef(over: Partial<FrozenScenarioRef> = {}): FrozenScenarioRef {
  return {
    scenarioId: 9,
    label: "Base case",
    engineId: "land_deal",
    engineVersion: "land-deal-1",
    headline: [
      { id: "profit", value: 2_400_000, unit: "cents" },
      { id: "roi", value: 0.55, unit: "ratio" },
      { id: "irr", value: 0.72, unit: "ratio" },
    ],
    ...over,
  };
}

function outcome(actuals: Array<{ id: string; value: number | null }>) {
  return buildOutcome({
    decisionSnapshotId: 5,
    subjectType: "property",
    subjectId: 42,
    kind: "sold",
    summary: "Sold to a neighbour at asking, 11 months in.",
    actuals,
  });
}

describe("the outcome record itself", () => {
  it("always references the decision it resulted from", () => {
    const o = outcome([{ id: "profit", value: 1_900_000 }]);
    expect(o.decisionSnapshotId).toBe(5);
    expect(o.shapeVersion).toBe(OUTCOME_SHAPE_VERSION);
  });

  it("refuses an unregistered metric rather than storing an uncomparable one", () => {
    // Predicted and actual must speak the same vocabulary or a variance means
    // nothing.
    expect(() => outcome([{ id: "vibes", value: 1 }])).toThrow(OutcomeMetricError);
  });

  it("stamps the unit from the shared metric registry, not from the caller", () => {
    const o = outcome([{ id: "profit", value: 1_900_000 }]);
    expect(o.actuals[0].unit).toBe("cents");
  });

  it("distinguishes an interim observation from a resolved position", () => {
    expect(isTerminal("still_open")).toBe(false);
    expect(isTerminal("sold")).toBe(true);
    expect(new Set(OUTCOME_KINDS).size).toBe(OUTCOME_KINDS.length);
  });
});

describe("variance is a projection over what was FROZEN", () => {
  it("compares actuals against the decision's frozen scenario, not a live one", () => {
    const v = computeVariance(
      outcome([
        { id: "profit", value: 1_900_000 },
        { id: "roi", value: 0.41 },
        { id: "irr", value: 0.38 },
      ]),
      [scenarioRef()],
    );
    const profit = v.find((x) => x.metricId === "profit")!;
    expect(profit.state).toBe("compared");
    expect(profit.predicted).toBe(2_400_000);
    expect(profit.actual).toBe(1_900_000);
    expect(profit.delta).toBe(-500_000);
    // profit is higherIsBetter, and it came in under — so not better.
    expect(profit.better).toBe(false);
  });

  it("marks a metric better when it moved the way the metric calls better", () => {
    const v = computeVariance(outcome([{ id: "profit", value: 3_000_000 }]), [scenarioRef()]);
    expect(v.find((x) => x.metricId === "profit")!.better).toBe(true);
  });

  it("respects higherIsBetter: a LOWER break-even is better", () => {
    const v = computeVariance(
      buildOutcome({
        decisionSnapshotId: 5,
        subjectType: "property",
        subjectId: 42,
        kind: "sold",
        summary: "s",
        actuals: [{ id: "breakeven_sale", value: 4_000_000 }],
      }),
      [
        scenarioRef({
          headline: [{ id: "breakeven_sale", value: 4_500_000, unit: "cents" }],
        }),
      ],
    );
    const be = v.find((x) => x.metricId === "breakeven_sale")!;
    expect(be.delta).toBe(-500_000);
    expect(be.better).toBe(true); // lower break-even is better
  });

  it("takes the FIRST scenario that carries a metric rather than averaging rivals", () => {
    // Averaging two competing hypotheses would invent a forecast nobody made.
    const v = computeVariance(outcome([{ id: "profit", value: 1_000_000 }]), [
      scenarioRef({ label: "Base", headline: [{ id: "profit", value: 2_400_000, unit: "cents" }] }),
      scenarioRef({ label: "Slow", headline: [{ id: "profit", value: 800_000, unit: "cents" }] }),
    ]);
    expect(v.find((x) => x.metricId === "profit")!.predicted).toBe(2_400_000);
  });
});

describe("unmeasured and unpredicted are different facts", () => {
  it("keeps a predicted-but-never-measured metric visible", () => {
    // Silently dropping it is how "we predicted five things and checked one"
    // comes to read as a clean scorecard.
    const v = computeVariance(outcome([{ id: "profit", value: 1_900_000 }]), [scenarioRef()]);
    const roi = v.find((x) => x.metricId === "roi")!;
    expect(roi.state).toBe("unmeasured");
    expect(roi.delta).toBeUndefined();
    expect(roi.better).toBeUndefined();
  });

  it("marks a measured-but-never-predicted metric as unpredicted, not as a miss", () => {
    const v = computeVariance(outcome([{ id: "hold_months", value: 11 }]), [
      scenarioRef({ headline: [{ id: "profit", value: 2_400_000, unit: "cents" }] }),
    ]);
    expect(v.find((x) => x.metricId === "hold_months")!.state).toBe("unpredicted");
  });

  it("treats a null actual as NOT MEASURED, never as zero", () => {
    const v = computeVariance(outcome([{ id: "profit", value: null }]), [scenarioRef()]);
    const profit = v.find((x) => x.metricId === "profit")!;
    expect(profit.state).toBe("unmeasured");
    expect(profit.actual).toBeNull();
    expect(profit.delta).toBeUndefined();
  });

  it("reports every metric from either side, sorted and de-duplicated", () => {
    const v = computeVariance(
      outcome([
        { id: "profit", value: 1 },
        { id: "hold_months", value: 11 },
      ]),
      [scenarioRef()],
    );
    expect(v.map((x) => x.metricId)).toEqual(["hold_months", "irr", "profit", "roi"]);
  });
});

describe("no confident-looking meaningless numbers", () => {
  it("omits the relative delta when the prediction was zero", () => {
    // delta / 0 is Infinity, which renders as a number and means nothing.
    const v = computeVariance(outcome([{ id: "profit", value: 500 }]), [
      scenarioRef({ headline: [{ id: "profit", value: 0, unit: "cents" }] }),
    ]);
    const profit = v.find((x) => x.metricId === "profit")!;
    expect(profit.state).toBe("compared");
    expect(profit.delta).toBe(500);
    expect(profit.relative).toBeUndefined();
  });

  it("computes the relative delta when the prediction is non-zero", () => {
    const v = computeVariance(outcome([{ id: "profit", value: 1_200_000 }]), [scenarioRef()]);
    expect(v.find((x) => x.metricId === "profit")!.relative).toBeCloseTo(-0.5, 6);
  });
});

describe("the summary observes; it does not judge the decision", () => {
  it("never claims a decision was right or wrong", () => {
    // BI178: an outcome is an observation of what happened, not retroactive
    // validation. A record that scores decisions by their results teaches an
    // investor to be lucky rather than right.
    const line = describeVariance(
      computeVariance(outcome([{ id: "profit", value: 500 }]), [scenarioRef()]),
    );
    for (const word of ["good", "bad", "wrong", "correct", "mistake", "should have"]) {
      expect(line.toLowerCase()).not.toContain(word);
    }
  });

  it("counts what landed at or better than predicted, and names the gaps", () => {
    const line = describeVariance(
      computeVariance(
        outcome([
          { id: "profit", value: 3_000_000 },
          { id: "roi", value: 0.2 },
        ]),
        [scenarioRef()],
      ),
    );
    expect(line).toContain("1/2 metric(s) landed at or better than predicted");
    expect(line).toContain("1 never measured"); // irr was predicted, not measured
  });

  it("says plainly when nothing was predicted", () => {
    const line = describeVariance(
      computeVariance(outcome([{ id: "profit", value: 1 }]), []),
    );
    expect(line).toContain("nothing was predicted");
  });
});

describe("law 9 is structural — outcomes cannot rewrite decisions", () => {
  it("the outcome store has no path to write a decision", () => {
    // The cleanest way to honour "outcomes append learning; they do not rewrite
    // history" is for the outcome writer to have no path to the decision
    // writer at all.
    const src = fs.readFileSync(
      path.join(ROOT, "server/services/outcomes/outcomeStore.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/db\s*\.\s*(update|delete)\(\s*decisionSnapshots/);
    expect(src).not.toMatch(/db\s*\.\s*(update|delete)\(\s*outcomes/);
    // It reads the decision (to learn the subject and the frozen scenarios) and
    // imports only the READ function from the decision store.
    expect(src).toContain("getDecision");
    expect(src).not.toContain("recordDecision");
  });

  it("the table stores no variance column — variance is a projection", () => {
    // A stored variance is a third number that can drift from the two it
    // derives from, and "improving" it later would silently restate how good a
    // past decision looked.
    const schema = fs.readFileSync(path.join(ROOT, "shared/schema/outcomes.ts"), "utf8");
    expect(schema).not.toMatch(/variance\s*:\s*(jsonb|doublePrecision|integer)\(/);
    expect(schema).not.toMatch(/delta\s*:\s*(jsonb|doublePrecision|integer)\(/);
  });

  it("the HTTP surface exposes no mutation of a recorded outcome", () => {
    const routes = fs.readFileSync(path.join(ROOT, "server/routes-decisions.ts"), "utf8");
    expect(routes).not.toMatch(/router\s*\.\s*(put|patch|delete)\s*\(/);
  });

  it("is wired — routed and migrated", () => {
    const routes = fs.readFileSync(path.join(ROOT, "server/routes-decisions.ts"), "utf8");
    expect(routes).toContain("recordOutcome");
    expect(routes).toContain("outcomesForDecision");
    const migrate = fs.readFileSync(path.join(ROOT, "scripts/migrate.mjs"), "utf8");
    expect(migrate).toContain('CREATE TABLE IF NOT EXISTS "outcomes"');
    expect(fs.existsSync(path.join(ROOT, "migrations/0231_outcomes.sql"))).toBe(true);
    const barrel = fs.readFileSync(path.join(ROOT, "shared/schema.ts"), "utf8");
    expect(barrel).toContain('export * from "./schema/outcomes"');
  });
});

describe("determinism", () => {
  it("produces identical variance from identical inputs", () => {
    const o = outcome([{ id: "profit", value: 1_900_000 }]);
    const a = computeVariance(o, [scenarioRef()]);
    const b = computeVariance(o, [scenarioRef()]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
