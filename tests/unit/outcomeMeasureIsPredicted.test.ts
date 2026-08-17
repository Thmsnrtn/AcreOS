/**
 * The prompt's header stated a rule the prompt did not implement.
 *
 * `client/src/components/today/OutcomePrompt.tsx` has said since it shipped that
 * it asks for an amount:
 *
 *   > only for a metric the deciding engine actually PREDICTED, so the variance
 *   > it produces is a genuine comparison rather than two unrelated numbers
 *
 * It did not. The amount was keyed to the ANSWER KIND — `acquired` →
 * `total_cost`, `sold` → `profit` — under a comment justifying that with *"both
 * ids below are produced by the flip engine that records these decisions"*.
 * True when the flip analyzer was the only recorder; false from the moment a
 * second surface started recording decisions, and five now do.
 *
 * WHAT IT COST, precisely. The subdivision lot-pricing lock records **no
 * Scenario at all** — deliberately: a per-lot price grid carries no
 * `total_cost`, `profit` or `cap_rate`, and adding an engine so it could would
 * be gaming the adoption ratchet. Ask that decision "what did you actually
 * make?" and the customer's answer is stored as a real measurement whose
 * variance comes back `unpredicted`.
 *
 * Not corruption — the variance layer keeps `unmeasured` and `unpredicted`
 * distinct exactly so this stays legible, and `buildOutcome` refuses any metric
 * that is not registered. The cost is honesty: a number asked for that nothing
 * can be compared against, then filed as though it could be.
 *
 * Nothing was broken TODAY only because the lock passes `reviewDueAt: null`, so
 * the prompt has still only ever seen flip decisions. That is a latent defect
 * waiting on one field, which is the kind this program has learned to close
 * before it fires rather than after.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { measurableFor, type OutcomeMeasure } from "../../client/src/lib/outcome-measure";

const ROOT = path.resolve(__dirname, "../..");

const PROFIT: OutcomeMeasure = {
  metricId: "profit",
  question: "What did you actually make?",
  hint: "Net of everything.",
};
const TOTAL_COST: OutcomeMeasure = {
  metricId: "total_cost",
  question: "What did it actually cost to acquire?",
  hint: "All-in.",
};

describe("an amount is asked for only where a forecast exists to compare it to", () => {
  it("asks when the decision predicted that metric", () => {
    // The positive path first: a rule that refused everything would satisfy
    // every negative case below.
    expect(measurableFor(PROFIT, { predictedMetricIds: ["profit", "total_cost"] }))
      .toEqual(PROFIT);
  });

  it("does NOT ask when the decision predicted something else", () => {
    expect(
      measurableFor(PROFIT, { predictedMetricIds: ["total_cost"] }),
      "asked what the customer made about a decision that never forecast profit",
    ).toBeNull();
  });

  it("does NOT ask when the decision predicted nothing at all", () => {
    // The lot-pricing lock, exactly. An empty list is a real answer, not a
    // missing one — many decisions are made without running economics.
    expect(measurableFor(PROFIT, { predictedMetricIds: [] })).toBeNull();
    expect(measurableFor(TOTAL_COST, { predictedMetricIds: [] })).toBeNull();
  });

  it("asks nothing for an answer that carries no measure", () => {
    // `still_open`, `offer_rejected`, `abandoned` — an unresolved or abandoned
    // position has no realised number by definition.
    expect(measurableFor(undefined, { predictedMetricIds: ["profit"] })).toBeNull();
  });

  it("returns the candidate UNCHANGED, so copy and metric cannot drift apart", () => {
    // A rule that rebuilt the measure could pair "what did you actually make?"
    // with `total_cost`. Identity is asserted, not just truthiness.
    const out = measurableFor(PROFIT, { predictedMetricIds: ["profit"] });
    expect(out).toBe(PROFIT);
  });
});

describe("the rule is wired into the prompt and fed by the server", () => {
  const prompt = fs.readFileSync(
    path.join(ROOT, "client/src/components/today/OutcomePrompt.tsx"),
    "utf8",
  );
  const store = fs.readFileSync(
    path.join(ROOT, "server/services/decisions/decisionStore.ts"),
    "utf8",
  );

  it("the prompt gates the amount step on it", () => {
    expect(prompt).toContain('from "@/lib/outcome-measure"');
    expect(
      prompt,
      "the amount step is gated on the answer's own `measures` again, which is " +
        "the kind-keyed shape this unit replaced",
    ).toContain("if (measurableFor(a.measures, d)) {");
    expect(prompt).not.toMatch(/if \(a\.measures\) \{/);
  });

  it("the due list carries what each decision predicted", () => {
    // Without this the prompt has nothing to check against, and the gate above
    // would silently refuse every measurement — a different way to be wrong.
    expect(store).toContain("predictedMetricIds");
    const at = store.indexOf("predictedMetricIds: [");
    expect(at, "predictedMetricIds is declared but never populated").toBeGreaterThan(-1);
    const body = store.slice(at, at + 300);
    expect(body, "it is not derived from the frozen scenarios").toContain("row.scenarios");
    expect(body, "duplicate metric ids across scenarios are not collapsed").toContain("new Set(");
  });

  it("the source of truth is the FROZEN snapshot, not a live scenario read", () => {
    // decision_snapshots.scenarios exists so that "a forecast can never be lost
    // between the engine and the outcome, which is how a real prediction came
    // to read as unpredicted". Re-reading the scenario table would reintroduce
    // exactly that.
    const at = store.indexOf("predictedMetricIds: [");
    const body = store.slice(at, at + 300);
    expect(body).not.toContain("await");
    expect(body).not.toContain("db.select");
  });
});
