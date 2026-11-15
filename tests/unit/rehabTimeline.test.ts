/**
 * Rehab timeline math (fix-and-flip package, Leg 3, §9.3) — pure, no database.
 *
 *   - the ORIGINAL baseline is the root of the supersedes chain, so a revision
 *     listed first cannot quietly become the denominator;
 *   - a phase that was never entered has no variance (never an invented delta),
 *     and a phase entered but never planned has no plan to be late against;
 *   - listing variance prefers the rehab's recorded date over the status log;
 *   - the holding comparison keeps scenario, plan and actuals in separate
 *     buckets and flags only the two facts it can prove.
 */
import { describe, expect, it } from "vitest";
import {
  holdingComparison,
  listingVarianceDays,
  originalBaseline,
  phaseVariances,
} from "../../shared/rehab/timeline";
import type { BaselineLike, TransitionLike } from "../../shared/rehab/timeline";

const b1: BaselineLike = {
  id: "b1",
  supersedesId: null,
  plannedStartDate: "2026-09-01",
  plannedListingDate: "2026-12-01",
  plannedHoldMonths: 4,
  plannedHoldingMonthlyCents: 100_000,
  phasePlans: [
    { phase: "demo", plannedDate: "2026-09-05" },
    { phase: "framing", plannedDate: "2026-09-20" },
  ],
  recordedBy: "user-1",
  createdAt: "2026-09-01T00:00:00Z",
};

/** The revision — every planned figure differs, so using it would change the answer. */
const b2: BaselineLike = {
  id: "b2",
  supersedesId: "b1",
  plannedStartDate: "2026-09-10",
  plannedListingDate: "2026-12-15",
  plannedHoldMonths: 5,
  plannedHoldingMonthlyCents: 120_000,
  phasePlans: [{ phase: "demo", plannedDate: "2026-09-15" }],
  recordedBy: "user-1",
  createdAt: "2026-09-10T00:00:00Z",
};

const demoTransition: TransitionLike = {
  fromStatus: "planning",
  toStatus: "demo",
  transitionedAt: "2026-09-08T10:00:00Z",
};

describe("originalBaseline", () => {
  it("returns the chain root even when the revision is listed first", () => {
    expect(originalBaseline([b2, b1])?.id).toBe("b1");
    expect(originalBaseline([b1, b2])?.id).toBe("b1");
  });

  it("returns null for an empty list — no plan is not a plan of zero", () => {
    expect(originalBaseline([])).toBeNull();
  });

  it("takes the earliest when several rows have no supersedes pointer", () => {
    const later: BaselineLike = { ...b1, id: "b3", createdAt: "2026-09-20T00:00:00Z" };
    expect(originalBaseline([later, b1])?.id).toBe("b1");
  });
});

describe("phaseVariances", () => {
  it("measures against the ORIGINAL's planned dates, not the revision's", () => {
    const original = originalBaseline([b2, b1]);
    const phases = phaseVariances(original, [demoTransition]);

    expect(phases.find((p) => p.phase === "demo")).toEqual({
      phase: "demo",
      plannedDate: "2026-09-05",
      actualDate: "2026-09-08",
      varianceDays: 3,
    });
  });

  it("a phase never entered has no actual and no variance — 'not recorded', never invented", () => {
    const phases = phaseVariances(originalBaseline([b2, b1]), [demoTransition]);

    expect(phases.find((p) => p.phase === "framing")).toEqual({
      phase: "framing",
      plannedDate: "2026-09-20",
      actualDate: null,
      varianceDays: null,
    });
  });

  it("a phase entered but never planned has a null planned date and null variance", () => {
    const phases = phaseVariances(b1, [
      demoTransition,
      { fromStatus: "demo", toStatus: "drywall", transitionedAt: "2026-10-01T12:00:00Z" },
    ]);

    expect(phases.find((p) => p.phase === "drywall")).toEqual({
      phase: "drywall",
      plannedDate: null,
      actualDate: "2026-10-01",
      varianceDays: null,
    });
  });

  it("orders the union of planned and entered phases by rehab status order", () => {
    const phases = phaseVariances(b1, [
      { fromStatus: "demo", toStatus: "drywall", transitionedAt: "2026-10-01T12:00:00Z" },
      demoTransition,
    ]);

    expect(phases.map((p) => p.phase)).toEqual(["demo", "framing", "drywall"]);
  });

  it("uses the EARLIEST entry into a phase, not the most recent", () => {
    const phases = phaseVariances(b1, [
      { fromStatus: "framing", toStatus: "demo", transitionedAt: "2026-09-12T00:00:00Z" },
      demoTransition,
    ]);

    expect(phases.find((p) => p.phase === "demo")?.actualDate).toBe("2026-09-08");
    expect(phases.find((p) => p.phase === "demo")?.varianceDays).toBe(3);
  });
});

describe("listingVarianceDays", () => {
  it("uses the earliest 'listed' transition when the rehab has no recorded listing date", () => {
    const listed: TransitionLike = {
      fromStatus: "finishes",
      toStatus: "listed",
      transitionedAt: "2026-12-11T09:00:00Z",
    };
    expect(listingVarianceDays(b1, null, [listed])).toBe(10);
  });

  it("prefers the rehab's own recorded listing date over the status log", () => {
    const listed: TransitionLike = {
      fromStatus: "finishes",
      toStatus: "listed",
      transitionedAt: "2026-12-11T09:00:00Z",
    };
    expect(listingVarianceDays(b1, "2026-11-28", [listed])).toBe(-3);
  });

  it("is null when either side was never recorded — never an invented date", () => {
    expect(listingVarianceDays(b1, null, [])).toBeNull();
    expect(listingVarianceDays(null, "2026-11-28", [])).toBeNull();
  });
});

describe("holdingComparison", () => {
  const scenario = {
    holdMonths: 6,
    monthlyHoldingCostCents: 120_000,
    holdMonthsOrigin: "user",
    monthlyOrigin: "platform-default",
  };

  it("keeps scenario, plan and actuals in separate buckets and flags both facts", () => {
    const out = holdingComparison({
      scenario,
      baseline: b1,
      entriesTotalCents: 800_000,
      elapsedDays: 200,
      meterAccruedCents: 500_000,
    });

    expect(out.scenario).toEqual({
      holdMonths: 6,
      monthlyHoldingCostCents: 120_000,
      assumedTotalCents: 720_000,
      holdMonthsOrigin: "user",
      monthlyOrigin: "platform-default",
    });
    expect(out.baselinePlan).toEqual({
      plannedHoldMonths: 4,
      plannedHoldingMonthlyCents: 100_000,
      plannedTotalCents: 400_000,
    });
    expect(out.actuals).toEqual({
      entriesTotalCents: 800_000,
      elapsedDays: 200,
      meterAccruedCents: 500_000,
    });
    expect(out.disagreement).toEqual({ spendPastScenario: true, timePastScenario: true });
  });

  it("flags nothing while recorded spend and elapsed days stay inside the scenario", () => {
    const out = holdingComparison({
      scenario,
      baseline: b1,
      entriesTotalCents: 700_000,
      elapsedDays: 100,
      meterAccruedCents: 500_000,
    });

    expect(out.disagreement).toEqual({ spendPastScenario: false, timePastScenario: false });
  });

  it("with no scenario nothing is flagged, even against a huge recorded total", () => {
    const out = holdingComparison({
      scenario: null,
      baseline: b1,
      entriesTotalCents: 99_000_000,
      elapsedDays: 999,
      meterAccruedCents: null,
    });

    expect(out.scenario).toBeNull();
    expect(out.disagreement).toEqual({ spendPastScenario: false, timePastScenario: false });
  });

  it("with no baseline the plan bucket is null rather than zero", () => {
    const out = holdingComparison({
      scenario: null,
      baseline: null,
      entriesTotalCents: 0,
      elapsedDays: null,
      meterAccruedCents: null,
    });

    expect(out.baselinePlan).toBeNull();
  });

  it("a total is null unless both factors are known", () => {
    const out = holdingComparison({
      scenario: { holdMonths: 6, monthlyHoldingCostCents: null, holdMonthsOrigin: null, monthlyOrigin: null },
      baseline: b1,
      entriesTotalCents: 0,
      elapsedDays: null,
      meterAccruedCents: null,
    });

    expect(out.scenario?.assumedTotalCents).toBeNull();
  });
});
