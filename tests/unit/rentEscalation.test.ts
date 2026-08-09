/**
 * Rent escalation (Wave 4 Stage 4) — the base rent for a month, stepped.
 *
 * The load-bearing test here is BACKWARD COMPATIBILITY: a lease with no schedule
 * steps must bill its flat monthly rent, byte-for-byte, so threading escalation
 * through the shared planner cannot silently restate any residential rent roll.
 * The rest pins the three step types (fixed amount / fixed % / CPI-with-collar),
 * their chronological compounding, and that a step missing its input is a no-op.
 */
import { describe, it, expect } from "vitest";
import {
  effectiveBaseRentForMonth,
  sumEffectiveBaseRentOverPeriod,
  type RentScheduleStepInput,
} from "../../shared/rental/rentEscalation";
import { planRentCharges } from "../../shared/rental/rentSchedule";

function step(overrides: Partial<RentScheduleStepInput>): RentScheduleStepInput {
  return {
    effectiveMonth: "2027-01-01",
    stepType: "fixed_pct",
    amountCents: null,
    pctBps: null,
    cpiIndexBase: null,
    cpiIndexCurrent: null,
    floorPctBps: null,
    ceilingPctBps: null,
    ...overrides,
  };
}

const BASE = 100_000; // $1,000.00

describe("backward compatibility — no steps is a flat, unchanged rent", () => {
  it("returns the base rent unchanged when there are no steps", () => {
    expect(effectiveBaseRentForMonth(BASE, [], "2027-06-01")).toBe(BASE);
  });

  it("the planner bills flat monthly rent for a lease with no scheduleSteps (residential invariant)", () => {
    const plan = planRentCharges({
      lease: {
        startDate: "2026-01-01",
        endDate: null,
        rentDueDayOfMonth: 1,
        monthlyRentCents: BASE,
        // no scheduleSteps
      },
      existingMonths: [],
      throughDate: "2026-03-01",
    });
    expect(plan.create).toHaveLength(3);
    expect(plan.create.every((c) => c.amountCents === BASE)).toBe(true);
  });
});

describe("fixed_amount — absolute reset", () => {
  it("sets the rent to the step amount from its effective month", () => {
    const steps = [step({ effectiveMonth: "2027-01-01", stepType: "fixed_amount", amountCents: 120_000 })];
    expect(effectiveBaseRentForMonth(BASE, steps, "2026-12-01")).toBe(BASE); // before step
    expect(effectiveBaseRentForMonth(BASE, steps, "2027-01-01")).toBe(120_000); // on step
    expect(effectiveBaseRentForMonth(BASE, steps, "2027-06-01")).toBe(120_000); // after
  });

  it("a fixed_amount with no amount is a no-op (never fabricate a figure)", () => {
    const steps = [step({ stepType: "fixed_amount", amountCents: null, effectiveMonth: "2027-01-01" })];
    expect(effectiveBaseRentForMonth(BASE, steps, "2027-06-01")).toBe(BASE);
  });
});

describe("fixed_pct — compounding bumps", () => {
  it("raises the rent by the step percentage", () => {
    const steps = [step({ stepType: "fixed_pct", pctBps: 300, effectiveMonth: "2027-01-01" })];
    expect(effectiveBaseRentForMonth(BASE, steps, "2027-06-01")).toBe(103_000); // +3%
  });

  it("compounds successive percentage steps in chronological order", () => {
    const steps = [
      step({ stepType: "fixed_pct", pctBps: 300, effectiveMonth: "2027-01-01" }),
      step({ stepType: "fixed_pct", pctBps: 300, effectiveMonth: "2028-01-01" }),
    ];
    expect(effectiveBaseRentForMonth(BASE, steps, "2027-06-01")).toBe(103_000); // one step applied
    expect(effectiveBaseRentForMonth(BASE, steps, "2028-06-01")).toBe(106_090); // both: 100000×1.03×1.03
  });

  it("applies steps regardless of input order (sorts by effective month)", () => {
    const steps = [
      step({ stepType: "fixed_pct", pctBps: 300, effectiveMonth: "2028-01-01" }),
      step({ stepType: "fixed_amount", amountCents: 200_000, effectiveMonth: "2027-01-01" }),
    ];
    // 2027 resets to 200000, then 2028 +3% = 206000
    expect(effectiveBaseRentForMonth(BASE, steps, "2028-06-01")).toBe(206_000);
  });
});

describe("cpi — indexed with a collar", () => {
  it("applies the raw CPI change when uncollared", () => {
    const steps = [
      step({ stepType: "cpi", cpiIndexBase: 100, cpiIndexCurrent: 105, effectiveMonth: "2027-01-01" }),
    ];
    expect(effectiveBaseRentForMonth(BASE, steps, "2027-06-01")).toBe(105_000); // +5%
  });

  it("caps the escalation at the ceiling", () => {
    const steps = [
      step({
        stepType: "cpi",
        cpiIndexBase: 100,
        cpiIndexCurrent: 108, // +8%
        ceilingPctBps: 300, // capped at 3%
        effectiveMonth: "2027-01-01",
      }),
    ];
    expect(effectiveBaseRentForMonth(BASE, steps, "2027-06-01")).toBe(103_000);
  });

  it("floors the escalation at the floor", () => {
    const steps = [
      step({
        stepType: "cpi",
        cpiIndexBase: 100,
        cpiIndexCurrent: 101, // +1%
        floorPctBps: 200, // floored at 2%
        effectiveMonth: "2027-01-01",
      }),
    ];
    expect(effectiveBaseRentForMonth(BASE, steps, "2027-06-01")).toBe(102_000);
  });

  it("a cpi step with no index anchor is a no-op", () => {
    const steps = [step({ stepType: "cpi", cpiIndexBase: null, cpiIndexCurrent: 105 })];
    expect(effectiveBaseRentForMonth(BASE, steps, "2027-06-01")).toBe(BASE);
  });
});

describe("sumEffectiveBaseRentOverPeriod — the escalation-aware period base rent", () => {
  it("equals base × months when there are no steps (backward compatible)", () => {
    expect(sumEffectiveBaseRentOverPeriod(BASE, [], "2026-01-01", 12)).toBe(BASE * 12);
  });

  it("sums the escalated base month-by-month across a year boundary", () => {
    // 100000 for 2026, then +10% from 2027-01. Window Nov 2026 – Feb 2027 (4 mo):
    // Nov,Dec 2026 = 100000 each; Jan,Feb 2027 = 110000 each → 420000.
    const steps = [step({ stepType: "fixed_pct", pctBps: 1000, effectiveMonth: "2027-01-01" })];
    expect(sumEffectiveBaseRentOverPeriod(BASE, steps, "2026-11-01", 4)).toBe(420_000);
  });

  it("returns 0 for a non-positive month count", () => {
    expect(sumEffectiveBaseRentOverPeriod(BASE, [], "2026-01-01", 0)).toBe(0);
  });
});

describe("planner integration — escalation flows into generated charges", () => {
  it("bills the escalated base per month once steps are present", () => {
    const plan = planRentCharges({
      lease: {
        startDate: "2026-01-01",
        endDate: null,
        rentDueDayOfMonth: 1,
        monthlyRentCents: BASE,
        scheduleSteps: [
          step({ stepType: "fixed_pct", pctBps: 500, effectiveMonth: "2026-02-01" }),
        ],
      },
      existingMonths: [],
      throughDate: "2026-03-01",
    });
    const byMonth = Object.fromEntries(plan.create.map((c) => [c.chargedForMonth, c.amountCents]));
    expect(byMonth["2026-01-01"]).toBe(BASE); // before the step
    expect(byMonth["2026-02-01"]).toBe(105_000); // +5%
    expect(byMonth["2026-03-01"]).toBe(105_000); // step persists
  });
});
