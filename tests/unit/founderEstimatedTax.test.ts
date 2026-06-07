/**
 * Founder quarterly estimated-tax RADAR tests (FOUNDER-SIDE ONLY).
 *
 * Locks the safe-harbor math + the QUIET-when-fully-withheld behavior against
 * hand-verified figures so a future drift PR can't silently expose Tom to an
 * underpayment penalty — or, just as importantly, can't make the radar alarm
 * when his W-2 withholding already covers him (pre-AcreOS-revenue it must
 * reassure, not alarm).
 *
 * The radar reuses computeDraftReturn, so each case builds a real draft from
 * structured income and asserts the resulting quarterly obligations.
 */

import { describe, it, expect } from "vitest";

import { computeDraftReturn, type TaxEngineInput } from "../../server/services/founder/taxEngine";
import {
  computeEstimatedTaxRadar,
  quarterCalendar,
  FED_CURRENT_YEAR_FRACTION,
  FED_DE_MINIMIS,
  type EstimatedTaxInput,
} from "../../server/services/founder/estimatedTax";

function draftFor(income: TaxEngineInput["income"], year = 2025) {
  return computeDraftReturn({ taxYear: year, filingStatus: "married_joint", state: "MA", income });
}

// A fixed "now" well before any 2025 due date so quarters read as upcoming.
const NOW = new Date("2025-01-01T00:00:00Z");

function radarFor(
  income: TaxEngineInput["income"],
  extra: Partial<EstimatedTaxInput> = {},
) {
  const draft = draftFor(income);
  return computeEstimatedTaxRadar({
    taxYear: 2025,
    filingStatus: "married_joint",
    draft,
    now: NOW,
    ...extra,
  });
}

describe("quarterCalendar — the four statutory due dates", () => {
  it("surfaces Apr 15 / Jun 15 / Sep 15 / Jan 15 (next year)", () => {
    const cal = quarterCalendar(2025);
    expect(cal.map((q) => q.dueDate)).toEqual([
      "2025-04-15",
      "2025-06-15",
      "2025-09-15",
      "2026-01-15",
    ]);
  });
});

describe("QUIET when fully withheld (the reassurance contract)", () => {
  it("two W-2 incomes, no side income → $0, radar inactive, reassuring headline", () => {
    // Both incomes are withheld at source → no non-withheld income → no SE tax.
    const radar = radarFor([
      { sourceType: "w2_self", label: "Day job", amount: 120000, withholdingAtSource: true, federalWithheld: 15000, stateWithheld: 5000 },
      { sourceType: "w2_spouse", label: "Spouse job", amount: 80000, withholdingAtSource: true, federalWithheld: 9000, stateWithheld: 3500 },
    ]);

    // The radar stays QUIET because there is no NON-WITHHELD income (no SE tax),
    // regardless of whether the W-2 withholding was set precisely. No quarterly
    // estimates are surfaced; the founder trues up the small balance at filing.
    expect(radar.federal.totalTax).toBeGreaterThan(0);
    expect(radar.active).toBe(false);
    expect(radar.federal.active).toBe(false);
    expect(radar.federal.quarters.every((q) => q.amountDue === 0)).toBe(true);
    expect(radar.federal.headline).toContain("$0");
    expect(radar.federal.headline.toLowerCase()).toContain("covered");
    // MA is gated on the same non-withheld signal → also quiet.
    expect(radar.massachusetts?.active).toBe(false);
    expect(radar.massachusetts?.quarters.every((q) => q.amountDue === 0)).toBe(true);
  });

  it("zero income → quiet (no division-by-zero, no alarm)", () => {
    const radar = radarFor([]);
    expect(radar.active).toBe(false);
    expect(radar.federal.safeHarbor.estimatedShortfall).toBe(0);
  });

  it("non-withheld income BUT a tiny prior-year safe harbor already met → quiet", () => {
    // There IS a draw (non-withheld), but a near-zero prior-year liability makes
    // the prior-year leg the (lower) target, which withholding already covers →
    // shortfall 0 → radar stays quiet via the 'withholding meets target' branch.
    const radar = radarFor(
      [
        { sourceType: "w2_self", label: "Day job", amount: 100000, withholdingAtSource: true, federalWithheld: 14000, stateWithheld: 4500 },
        { sourceType: "acreos_draw", label: "AcreOS draw", amount: 8000, withholdingAtSource: false },
      ],
      { priorYear: { federalTotalTax: 100, stateTotalTax: 50, agi: 5000 } },
    );
    expect(radar.federal.safeHarbor.chosenLeg).toBe("prior_year");
    expect(radar.federal.safeHarbor.estimatedShortfall).toBe(0);
    expect(radar.federal.active).toBe(false);
    expect(radar.federal.headline).toContain("$0");
  });
});

describe("ACTIVE when non-withheld income exists (the protection contract)", () => {
  // AcreOS draw of $60,000 with NO withholding, plus a withheld spouse W-2.
  const income: TaxEngineInput["income"] = [
    { sourceType: "w2_spouse", label: "Spouse job", amount: 80000, withholdingAtSource: true, federalWithheld: 9000, stateWithheld: 3500 },
    { sourceType: "acreos_draw", label: "AcreOS draw", amount: 60000, withholdingAtSource: false, federalWithheld: 0, stateWithheld: 0 },
  ];

  it("federal radar activates and quarters sum exactly to the shortfall", () => {
    const radar = radarFor(income);
    expect(radar.active).toBe(true);
    expect(radar.federal.active).toBe(true);

    const sf = radar.federal.safeHarbor;
    // Current-year leg = 90% of federal total tax (no prior year on file).
    expect(sf.currentYearLeg).toBe(Math.round(radar.federal.totalTax * FED_CURRENT_YEAR_FRACTION));
    expect(sf.priorYearLeg).toBeNull();
    expect(sf.chosenLeg).toBe("current_year");
    // Shortfall = required − withholding, floored at 0.
    expect(sf.estimatedShortfall).toBe(Math.max(0, sf.requiredAnnualPayment - sf.expectedWithholding));

    // Four quarters sum EXACTLY to the shortfall (last absorbs rounding).
    const sum = radar.federal.quarters.reduce((s, q) => s + q.amountDue, 0);
    expect(sum).toBe(sf.estimatedShortfall);
    // Even split: first three equal, last >= them.
    const [q1, q2, q3, q4] = radar.federal.quarters.map((q) => q.amountDue);
    expect(q1).toBe(q2);
    expect(q2).toBe(q3);
    expect(q4).toBeGreaterThanOrEqual(q3);
  });

  it("federal balance after withholding clears the $1,000 de-minimis floor", () => {
    const radar = radarFor(income);
    expect(radar.federal.totalTax - radar.federal.expectedWithholding).toBeGreaterThanOrEqual(
      FED_DE_MINIMIS,
    );
  });
});

describe("safe harbor chooses the SMALLER of the two legs", () => {
  const income: TaxEngineInput["income"] = [
    { sourceType: "acreos_draw", label: "AcreOS draw", amount: 90000, withholdingAtSource: false },
  ];

  it("prefers a LOW prior-year leg over a higher current-year leg", () => {
    // Tiny prior-year liability ($2,000) → prior-year 100% leg ($2,000) is far
    // below 90% of this year's tax, so it sets the (lower) target.
    const radar = radarFor(income, {
      priorYear: { federalTotalTax: 2000, stateTotalTax: 500, agi: 20000 },
    });
    const sf = radar.federal.safeHarbor;
    expect(sf.priorYearLeg).toBe(2000); // 100% of $2,000 (AGI under $150k)
    expect(sf.chosenLeg).toBe("prior_year");
    expect(sf.requiredAnnualPayment).toBe(2000);
  });

  it("applies the 110% high-income multiplier when prior-year AGI > $150k", () => {
    // Prior-year tax $5,000, AGI $200k → prior leg = 110% × 5,000 = 5,500.
    const radar = radarFor(income, {
      priorYear: { federalTotalTax: 5000, stateTotalTax: 1000, agi: 200000 },
    });
    const sf = radar.federal.safeHarbor;
    expect(sf.priorYearLeg).toBe(5500);
    expect(sf.chosenLeg).toBe("prior_year");
    expect(sf.requiredAnnualPayment).toBe(5500);
    expect(sf.basis).toContain("110%");
  });

  it("falls back to the current-year leg when prior-year is unknown", () => {
    const radar = radarFor(income);
    const sf = radar.federal.safeHarbor;
    expect(sf.priorYearLeg).toBeNull();
    expect(sf.chosenLeg).toBe("current_year");
    expect(sf.basis).toContain("current-year");
  });
});

describe("marking a quarter paid", () => {
  const income: TaxEngineInput["income"] = [
    { sourceType: "acreos_draw", label: "AcreOS draw", amount: 90000, withholdingAtSource: false },
  ];

  it("reflects a paid quarter as status=paid and shrinks remainingDue", () => {
    const base = radarFor(income);
    const q1Due = base.federal.quarters[0].amountDue;

    const paid = radarFor(income, {
      paid: [{ quarter: 1, jurisdiction: "federal", amountPaid: q1Due, paidAt: "2025-04-10" }],
    });
    const q1 = paid.federal.quarters[0];
    expect(q1.status).toBe("paid");
    expect(q1.amountPaid).toBe(q1Due);
    expect(paid.federal.remainingDue).toBe(base.federal.remainingDue - q1Due);
  });
});

describe("honesty contract", () => {
  it("every active jurisdiction's safe harbor carries a non-empty basis", () => {
    const radar = radarFor([
      { sourceType: "acreos_draw", label: "AcreOS draw", amount: 90000, withholdingAtSource: false },
    ]);
    expect(radar.federal.safeHarbor.basis.length).toBeGreaterThan(0);
    expect(radar.federal.safeHarbor.basis).toContain("ESTIMATE");
    expect(radar.disclaimer).toContain("not tax advice");
  });
});
