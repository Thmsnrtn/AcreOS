/**
 * decideOperatingExpense (Wave 4 Stage 5a) — the op-ex precedence, now pure.
 *
 * The residential NOI logic used a flat 40%-of-collections op-ex guess when
 * nothing was measured. That guess is MEANINGLESS for a commercial building (a
 * NNN tenant reimburses op-ex; a gross lease bundles it), so a cap rate built on
 * it is a fabricated number. This pins the carve-out: an UNMEASURED commercial
 * property gets NO assumed op-ex — op-ex is null, NOI/cap rate fall away — while
 * measured expenses or an explicit override still win, commercial or not.
 */
import { describe, it, expect } from "vitest";
import { decideOperatingExpense } from "../../shared/rental/noi";

const RENT = 1_000_000; // $10,000/mo collections

describe("precedence: measured > override > assumed", () => {
  it("measured expenses win (residential or commercial)", () => {
    for (const isCommercial of [false, true]) {
      const d = decideOperatingExpense({
        hasMeasured: true,
        measuredOpExMonthlyCents: 350_000,
        opExBps: undefined,
        isCommercial,
        monthlyRentCollectedCents: RENT,
      });
      expect(d.opExSource).toBe("measured_expenses");
      expect(d.opExBasis).toBe("operator_supplied");
      expect(d.opExMonthlyCents).toBe(350_000);
    }
  });

  it("an explicit opExBps override wins over the assumption (residential or commercial)", () => {
    for (const isCommercial of [false, true]) {
      const d = decideOperatingExpense({
        hasMeasured: false,
        measuredOpExMonthlyCents: 0,
        opExBps: 3000, // 30%
        isCommercial,
        monthlyRentCollectedCents: RENT,
      });
      expect(d.opExSource).toBe("ratio_override");
      expect(d.opExBasis).toBe("operator_supplied");
      expect(d.opExMonthlyCents).toBe(300_000); // 30% of RENT
    }
  });
});

describe("residential unmeasured — the honest 40% rule of thumb", () => {
  it("falls back to the assumed 40% ratio and keeps the assumed label", () => {
    const d = decideOperatingExpense({
      hasMeasured: false,
      measuredOpExMonthlyCents: 0,
      opExBps: undefined,
      isCommercial: false,
      monthlyRentCollectedCents: RENT,
    });
    expect(d.opExSource).toBe("assumed_ratio");
    expect(d.opExBasis).toBe("assumed_ratio");
    expect(d.opExMonthlyCents).toBe(400_000); // 40% of RENT
  });
});

describe("negative measured op-ex — REFUSED, not computed with", () => {
  // Operating expenses are stored nonnegative (the expense write path
  // validates that), so a negative measured figure is a data error, never a
  // measurement and never a credit. Computing with it would ADD the
  // "expense" to NOI and present the result as measured books.
  it("throws in plain words (residential or commercial)", () => {
    for (const isCommercial of [false, true]) {
      expect(() =>
        decideOperatingExpense({
          hasMeasured: true,
          measuredOpExMonthlyCents: -1,
          opExBps: undefined,
          isCommercial,
          monthlyRentCollectedCents: RENT,
        }),
      ).toThrow(/measured operating expenses cannot be negative/);
    }
  });

  it("refuses however large the negative is — no plausible NOI is produced", () => {
    expect(() =>
      decideOperatingExpense({
        hasMeasured: true,
        measuredOpExMonthlyCents: -350_000,
        opExBps: 3000, // an override does not launder a measured data error
        isCommercial: false,
        monthlyRentCollectedCents: RENT,
      }),
    ).toThrow(/cannot be negative/);
  });

  it("a measured ZERO stays valid — zero is a real measurement", () => {
    const d = decideOperatingExpense({
      hasMeasured: true,
      measuredOpExMonthlyCents: 0,
      opExBps: undefined,
      isCommercial: false,
      monthlyRentCollectedCents: RENT,
    });
    expect(d.opExSource).toBe("measured_expenses");
    expect(d.opExBasis).toBe("operator_supplied");
    expect(d.opExMonthlyCents).toBe(0);
  });

  it("an unused negative placeholder is not computed with when nothing was measured", () => {
    // When hasMeasured is false the measured figure is never read (callers
    // pass 0); the precedence below decides from the override/assumption.
    const d = decideOperatingExpense({
      hasMeasured: false,
      measuredOpExMonthlyCents: -1,
      opExBps: undefined,
      isCommercial: false,
      monthlyRentCollectedCents: RENT,
    });
    expect(d.opExSource).toBe("assumed_ratio");
    expect(d.opExMonthlyCents).toBe(400_000);
  });
});

describe("commercial unmeasured — NO assumed op-ex (the carve-out)", () => {
  it("yields null op-ex so NOI/cap rate fall away rather than being fabricated", () => {
    const d = decideOperatingExpense({
      hasMeasured: false,
      measuredOpExMonthlyCents: 0,
      opExBps: undefined,
      isCommercial: true,
      monthlyRentCollectedCents: RENT,
    });
    expect(d.opExSource).toBe("commercial_unmeasured");
    expect(d.opExBasis).toBe("unavailable");
    expect(d.opExMonthlyCents).toBeNull();
  });
});
