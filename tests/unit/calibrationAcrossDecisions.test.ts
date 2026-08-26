/**
 * Calibration — the layer above a single variance (Master Audit Section VII D).
 *
 * The whole risk of this module is that it is a NUMBER GENERATOR pointed at a
 * small sample. Everything it produces looks authoritative: a percentage, a
 * direction, a p-value. So the tests that matter most here are not the ones that
 * check the arithmetic — they are the ones that check it REFUSES.
 *
 * "Your resale assumptions run 12% optimistic" derived from four deals is
 * fabrication wearing a statistic's clothes, and it is worse than saying
 * nothing, because a confident-sounding bias claim will change how someone
 * prices their next offer.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  CALIBRATION_SHAPE_VERSION,
  MIN_COMPARISONS_FOR_DIRECTION,
  computeCalibration,
  describeCalibration,
  signTestProbability,
} from "@shared/outcomes/calibration";
import type { MetricVariance } from "@shared/outcomes/outcome";
import { metricById } from "@shared/economics/scenario";

const ROOT = path.resolve(__dirname, "../..");

/** One outcome's worth of variance for a single metric. */
function compared(
  metricId: string,
  predicted: number,
  actual: number,
): MetricVariance[] {
  const spec = metricById(metricId)!;
  const delta = actual - predicted;
  return [
    {
      metricId,
      label: spec.label,
      unit: spec.unit,
      state: "compared",
      predicted,
      actual,
      delta,
      ...(predicted === 0 ? {} : { relative: delta / Math.abs(predicted) }),
      better: spec.higherIsBetter ? delta >= 0 : delta <= 0,
    },
  ];
}

function unmeasured(metricId: string, predicted: number): MetricVariance[] {
  const spec = metricById(metricId)!;
  return [
    {
      metricId,
      label: spec.label,
      unit: spec.unit,
      state: "unmeasured",
      predicted,
      actual: null,
    },
  ];
}

/** n outcomes where the actual came in `factor` times the forecast. */
function runs(metricId: string, n: number, predicted: number, factor: number) {
  return Array.from({ length: n }, () =>
    compared(metricId, predicted, Math.round(predicted * factor)),
  );
}

describe("it refuses before it reports", () => {
  it("says nothing about direction below the floor, however lopsided", () => {
    // Five outcomes ALL missing the same way is the most suggestive small
    // sample there is, and it still is not evidence: a two-sided sign test puts
    // it at p=0.0625.
    const report = computeCalibration(runs("profit", 5, 2_000_000, 0.6));
    const m = report.metrics[0];
    expect(m.state).toBe("insufficient");
    expect(m.bias).toBeUndefined();
    expect(m.medianRelativeError).toBeUndefined();
    expect(m.comparedCount).toBe(5);
  });

  it("the derived fields are ABSENT, not null", () => {
    // A null renders as "—" in some views and as 0 in others. An absent key
    // cannot be rendered as a zero at all.
    const m = computeCalibration(runs("profit", 3, 1_000_000, 0.5)).metrics[0];
    expect("bias" in m).toBe(false);
    expect("medianRelativeError" in m).toBe(false);
    expect("directionProbability" in m).toBe(false);
  });

  it("the floor is the point below which no evidence is possible, not a taste", () => {
    // At n=6 a unanimous split reaches p=0.031; at n=5 it is 0.0625. So six is
    // the smallest sample from which ANY direction could clear 0.05. A floor
    // chosen for feeling right would be the fabrication this module prevents.
    expect(signTestProbability(5, 5)).toBeCloseTo(0.0625, 6);
    expect(signTestProbability(6, 6)).toBeCloseTo(0.03125, 6);
    expect(MIN_COMPARISONS_FOR_DIRECTION).toBe(6);
  });

  it("an empty history is a clean empty report, not a zeroed one", () => {
    const report = computeCalibration([]);
    expect(report.outcomeCount).toBe(0);
    expect(report.metrics).toEqual([]);
    expect(report.shapeVersion).toBe(CALIBRATION_SHAPE_VERSION);
  });

  it("says 'not enough yet' as a whole sentence, not as a hedged claim", () => {
    const lines = describeCalibration(computeCalibration(runs("profit", 4, 1_000_000, 0.5)));
    expect(lines[0]).toContain("not enough measured outcomes yet");
    for (const word of ["optimistic", "pessimistic", "%"]) {
      expect(lines[0]).not.toContain(word);
    }
  });
});

describe("the sign test is exact", () => {
  it("matches hand-computed binomial tails", () => {
    // Exact rather than a normal approximation: n is small here, and an
    // approximation at n=7 is exactly the quiet inaccuracy this file is about.
    expect(signTestProbability(8, 6)).toBeCloseTo((2 * (28 + 8 + 1)) / 256, 10);
    expect(signTestProbability(10, 10)).toBeCloseTo(2 / 1024, 10);
    expect(signTestProbability(10, 5)).toBe(1); // a perfect split is certain
    expect(signTestProbability(0, 0)).toBe(1);
  });

  it("never returns a probability above 1", () => {
    for (let n = 0; n <= 12; n++) {
      for (let k = 0; k <= n; k++) {
        const p = signTestProbability(n, k);
        expect(p).toBeGreaterThan(0);
        expect(p).toBeLessThanOrEqual(1);
      }
    }
  });

  it("a suggestive-but-not-significant lean is reported as CENTRED", () => {
    // 7 of 10 in one direction is p=0.34. Calling that a bias is how noise
    // becomes advice.
    const mixed = [
      ...runs("profit", 7, 2_000_000, 0.8),
      ...runs("profit", 3, 2_000_000, 1.2),
    ];
    const m = computeCalibration(mixed).metrics[0];
    expect(m.state).toBe("calibrated");
    expect(m.bias).toBe("centred");
    expect(m.directionProbability!).toBeGreaterThan(0.05);
    expect(m.factors.join(" ")).toContain("not distinguishable from chance");
  });
});

describe("what it says when it CAN say something", () => {
  const optimisticProfit = computeCalibration(runs("profit", 8, 2_000_000, 0.75));

  it("names an over-forecast as optimistic", () => {
    const m = optimisticProfit.metrics[0];
    expect(m.state).toBe("calibrated");
    expect(m.bias).toBe("optimistic");
    expect(m.medianRelativeError).toBeCloseTo(-0.25, 6);
    expect(m.medianDelta).toBe(-500_000);
    expect(m.directionProbability!).toBeLessThan(0.05);
  });

  it("respects higherIsBetter — a LOW break-even forecast is the optimistic one", () => {
    // The subtlety that makes `optimistic` mean something. A break-even sale
    // price forecast BELOW what it turned out to be was the favourable
    // forecast, even though the number was smaller.
    expect(metricById("breakeven_sale")!.higherIsBetter).toBe(false);
    const m = computeCalibration(runs("breakeven_sale", 8, 4_000_000, 1.15)).metrics[0];
    expect(m.bias).toBe("optimistic");
    // ... and the mirror case.
    const other = computeCalibration(runs("breakeven_sale", 8, 4_000_000, 0.85)).metrics[0];
    expect(other.bias).toBe("pessimistic");
  });

  it("uses the MEDIAN so one runaway deal cannot define the number", () => {
    // Seven deals 10% under, one that came in 20x. A mean relative error would
    // be about +2.4 — a number describing nothing that happened.
    const withOutlier = [
      ...runs("profit", 7, 1_000_000, 0.9),
      ...compared("profit", 1_000_000, 20_000_000).map((v) => [v]),
    ].flat().map((v) => [v]);
    const m = computeCalibration(withOutlier).metrics[0];
    expect(m.medianRelativeError).toBeCloseTo(-0.1, 6);
  });

  it("states the numeric direction from the DELTA, never from the bias word", () => {
    // Those agree only for higher-is-better metrics. Deriving "above/below"
    // from the bias would state the opposite of what happened for every
    // lower-is-better metric.
    const line = describeCalibration(
      computeCalibration(runs("breakeven_sale", 8, 4_000_000, 1.15)),
    )[0];
    expect(line).toContain("below what happened"); // actual came in HIGHER
    expect(line).toContain("optimistic"); // ...which for break-even is optimistic
  });
});

describe("it never hides how thin the evidence is", () => {
  it("carries predicted-but-never-measured alongside the calibration", () => {
    // A metric forecast forty times and measured eight times has a calibration
    // built on eight points. A reader who cannot see that reads it as forty.
    const report = computeCalibration([
      ...runs("profit", 8, 2_000_000, 0.75),
      ...Array.from({ length: 32 }, () => unmeasured("profit", 2_000_000)),
    ]);
    const m = report.metrics[0];
    expect(m.comparedCount).toBe(8);
    expect(m.unmeasuredCount).toBe(32);
    expect(m.factors.join(" ")).toContain("32 further decision(s) predicted this");
    expect(report.outcomeCount).toBe(40);
  });

  it("counts zero-predicted comparisons separately rather than dropping them", () => {
    // They are real comparisons that contribute a DIRECTION but no percentage —
    // delta/0 is Infinity. Dropping them silently would shrink the sample the
    // reader thinks they are looking at.
    const report = computeCalibration([
      ...runs("profit", 6, 1_000_000, 0.8),
      ...Array.from({ length: 2 }, () => compared("profit", 0, -50_000)),
    ]);
    const m = report.metrics[0];
    expect(m.comparedCount).toBe(8);
    expect(m.unscaledCount).toBe(2);
    expect(m.factors.join(" ")).toContain("predicted zero");
    // The relative error came only from the six that could produce one.
    expect(m.medianRelativeError).toBeCloseTo(-0.2, 6);
  });

  it("does not count `unpredicted` against the forecasts that WERE made", () => {
    // `unpredicted` says the DECISION made no forecast. That is a fact about
    // coverage, not about how good the forecasts turned out to be, and mixing
    // them would make a well-calibrated operator look worse for having recorded
    // an extra actual.
    const spec = metricById("hold_months")!;
    const report = computeCalibration([
      ...runs("profit", 6, 2_000_000, 0.75),
      [
        {
          metricId: "hold_months",
          label: spec.label,
          unit: spec.unit,
          state: "unpredicted" as const,
          predicted: null,
          actual: 11,
        },
      ],
    ]);
    // It does not merely score zero — the metric is ABSENT from the report
    // entirely, which is the stronger and more correct statement. A metric that
    // was only ever unpredicted is not a badly-calibrated forecast; it is not a
    // forecast, and listing it as "insufficient" would invite a reader to think
    // a forecast had been attempted and fallen short.
    expect(report.metrics.map((m) => m.metricId)).toEqual(["profit"]);
    expect(report.outcomeCount).toBe(7);
  });
});

describe("it describes forecasts, never people or decisions", () => {
  it("never says a decision was right, wrong, good or bad (BI178)", () => {
    const lines = describeCalibration(
      computeCalibration([
        ...runs("profit", 8, 2_000_000, 0.6),
        ...runs("roi", 8, 0.5, 1.4),
      ]),
    );
    const all = lines.join(" ").toLowerCase();
    for (const word of [
      "good", "bad", "wrong", "correct", "mistake", "should have",
      "poor", "you are", "skill",
    ]) {
      expect(all).not.toContain(word);
    }
  });

  it("emits NO overall score across metrics", () => {
    // A single number mixing a cents metric with a ratio metric is arithmetic on
    // incompatible units, and it would hide exactly which measurement is thin.
    const report = computeCalibration([
      ...runs("profit", 8, 2_000_000, 0.6),
      ...runs("roi", 8, 0.5, 1.4),
    ]);
    expect(Object.keys(report).sort()).toEqual([
      "metrics",
      "outcomeCount",
      "shapeVersion",
    ]);
  });

  it("keeps metrics separate and sorted", () => {
    const report = computeCalibration([
      ...runs("roi", 6, 0.5, 1.4),
      ...runs("profit", 6, 2_000_000, 0.6),
    ]);
    expect(report.metrics.map((m) => m.metricId)).toEqual(["profit", "roi"]);
  });
});

describe("determinism and wiring", () => {
  it("produces identical output from identical input", () => {
    const input = runs("profit", 9, 2_000_000, 0.8);
    expect(JSON.stringify(computeCalibration(input))).toBe(
      JSON.stringify(computeCalibration(input)),
    );
  });

  it("is PURE — no clock, no I/O, no model", () => {
    const src = fs.readFileSync(path.join(ROOT, "shared/outcomes/calibration.ts"), "utf8");
    for (const banned of ["Date.now", "new Date(", "fetch(", "process.env", "db."]) {
      expect(src, `calibration.ts must not use ${banned}`).not.toContain(banned);
    }
  });

  it("is reachable — a store reader and a mounted route", () => {
    // This repo's most common defect is a correct thing nothing calls.
    const store = fs.readFileSync(
      path.join(ROOT, "server/services/outcomes/outcomeStore.ts"),
      "utf8",
    );
    expect(store).toContain("export async function calibrationForOrganization");
    expect(store).toContain("computeCalibration(");
    const routes = fs.readFileSync(path.join(ROOT, "server/routes-decisions.ts"), "utf8");
    expect(routes).toContain('router.get("/calibration"');
    expect(routes).toContain("calibrationForOrganization(organizationId)");
    // Registered BEFORE the id route, which is also digit-constrained.
    //
    // This used to pin the literal `router.get("/:id(\\d+)"`. Express 5
    // (path-to-regexp v8) REMOVED inline regex params: that pattern throws at
    // route registration and killed the process on boot, taking production down
    // on 2026-08-25. The constraint now lives in the `numericIdOnly` guard, so
    // the assertion tracks the mechanism rather than the spelling — and asserts
    // the constraint still EXISTS, which the old `indexOf` pairing never did.
    const idRoute = routes.indexOf('router.get("/:id"');
    expect(idRoute, "the /:id route is gone — where did it go?").toBeGreaterThan(-1);
    expect(routes.indexOf('router.get("/calibration"')).toBeLessThan(idRoute);
    expect(
      routes,
      "the digit constraint disappeared — a literal path can now be swallowed by /:id",
    ).toContain("const numericIdOnly");
    expect(routes).toMatch(/router\.get\("\/:id",\s*numericIdOnly/);
    // Inline regex params must never come back: they are a boot-time crash.
    expect(routes, "inline regex param reintroduced — Express 5 throws on this").not.toMatch(
      /router\.(get|post|put|patch|delete)\("\/:[A-Za-z_]+\(/,
    );
  });

  it("the calibration read is org-scoped in BOTH queries", () => {
    // It reads two tables, so it has two chances to leak. The decision fetch is
    // scoped independently rather than trusting the ids on the outcome rows.
    const store = fs.readFileSync(
      path.join(ROOT, "server/services/outcomes/outcomeStore.ts"),
      "utf8",
    );
    const fn = store.slice(store.indexOf("export async function calibrationForOrganization"));
    expect(fn).toMatch(/eq\(outcomes\.organizationId, organizationId\)/);
    expect(fn).toMatch(/eq\(decisionSnapshots\.organizationId, organizationId\)/);
  });

  it("does not reinvent the founder plane's decision eval", () => {
    // decisionEval scores a PROBABILITY against a binary vote (Brier). This
    // scores a predicted NUMBER against an actual number. Different kind of
    // thing — but the discipline (a hard cold-start floor, refusing rather than
    // reporting) is reused rather than reinvented, and neither imports the
    // other's arithmetic.
    const src = fs.readFileSync(path.join(ROOT, "shared/outcomes/calibration.ts"), "utf8");
    // No IMPORT of the founder-plane maths. (Asserted on imports, not on the
    // file text: the header names the path `server/services/autopilot/
    // decisionEval.ts` on purpose, so the relationship between the two is
    // findable by anyone who greps for either.)
    const imports = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    for (const spec of imports) {
      expect(spec, "calibration.ts must not import server-side code").not.toMatch(
        /autopilot|server\//,
      );
    }
    expect(src).not.toMatch(/\bbrierScore\b/);
    expect(src).toContain("decisionEval"); // named, so the relationship is findable
  });
});
