/**
 * Dodd-Frank seller-financer exclusion tests.
 *
 * These import the PRODUCTION module. The previous file re-implemented the
 * checker inline, so it agreed with the bug it was meant to catch: balloon
 * notes were granted the 3-property exclusion (best-in-class audit
 * 2026-10-20, §3 P0 #2).
 *
 * Expected outcomes below are derived from the regulation text, not from the
 * implementation:
 *   12 CFR 1026.36(a)(4) — any person; ≤3 properties / 12 months; did not
 *     construct the residence; FULLY AMORTIZING (no balloon); good-faith
 *     ability-to-repay determination; fixed rate or first adjustment ≥ 5 yrs.
 *   12 CFR 1026.36(a)(5) — natural person, estate or trust; 1 property /
 *     12 months; did not construct; no negative amortization (balloons OK);
 *     fixed rate or first adjustment ≥ 5 yrs. Seller's residence is NOT an
 *     element of either.
 */

import { describe, it, expect } from "vitest";
import {
  checkDoddFrankCompliance,
  type DoddFrankInput,
} from "../../server/services/doddFrankChecker";

// A fully-amortizing, fixed-rate note under the HPML rate screen, with every
// exclusion element answered — the clean baseline each case perturbs.
const base: DoddFrankInput = {
  sellerFinancedDealsLast12Months: 1,
  sellerType: "natural_person",
  hasDwelling: true,
  sellerConstructedDwelling: false,
  loanTermMonths: 120,
  rateType: "fixed",
  interestRate: 0.06,
  abilityToRepayDetermined: true,
  negativeAmortization: false,
};

describe("land-only (no dwelling)", () => {
  it("is outside Reg Z's residential-mortgage scope", () => {
    const r = checkDoddFrankCompliance({ ...base, hasDwelling: false, interestRate: 0.25 });
    expect(r.exemptionApplicable).toBe("non_dwelling_land");
    expect(r.requiresLicensedMLO).toBe(false);
  });
});

describe("balloon notes — the defect this file exists to catch", () => {
  it("an entity financing 3 dwellings with a 36-month balloon gets NO exclusion", () => {
    const r = checkDoddFrankCompliance({
      ...base,
      sellerType: "entity",
      sellerFinancedDealsLast12Months: 3,
      rateType: "balloon_under_5yr",
      balloonAfterMonths: 36,
    });
    expect(r.exemptionApplicable).toBe("none");
    expect(r.requiresLicensedMLO).toBe(true);
    expect(r.risk).toBe("likely_violation");
  });

  it("a balloon of ANY length disqualifies the 3-property exclusion (fully amortizing)", () => {
    const r = checkDoddFrankCompliance({
      ...base,
      sellerType: "entity",
      sellerFinancedDealsLast12Months: 2,
      rateType: "balloon_5yr_plus",
      balloonAfterMonths: 84,
    });
    expect(r.exemptionApplicable).toBe("none");
    expect(r.requiresLicensedMLO).toBe(true);
  });

  it("a natural person's single balloon note DOES fit the 1-property exclusion", () => {
    const r = checkDoddFrankCompliance({
      ...base,
      rateType: "balloon_under_5yr",
      balloonAfterMonths: 36,
    });
    expect(r.exemptionApplicable).toBe("1_property_natural_person");
    expect(r.requiresLicensedMLO).toBe(false);
  });

  it("an estate or trust's single balloon note fits the 1-property exclusion", () => {
    const r = checkDoddFrankCompliance({
      ...base,
      sellerType: "estate_or_trust",
      balloonAfterMonths: 24,
      rateType: "balloon_under_5yr",
    });
    expect(r.exemptionApplicable).toBe("1_property_natural_person");
  });
});

describe("3-property exclusion, 12 CFR 1026.36(a)(4)", () => {
  it("applies to an entity with 2 fully-amortizing fixed notes and an ATR determination", () => {
    const r = checkDoddFrankCompliance({ ...base, sellerType: "entity", sellerFinancedDealsLast12Months: 2 });
    expect(r.exemptionApplicable).toBe("3_property");
    expect(r.requiresLicensedMLO).toBe(false);
    expect(r.risk).toBe("compliant");
  });

  it("is not granted when the ability-to-repay question is unanswered", () => {
    const r = checkDoddFrankCompliance({
      ...base,
      sellerType: "entity",
      sellerFinancedDealsLast12Months: 2,
      abilityToRepayDetermined: undefined,
    });
    expect(r.exemptionApplicable).toBe("none");
    expect(r.requiresLicensedMLO).toBe(true);
    expect(r.risk).toBe("review_needed");
    expect(r.unansweredElements?.join(" ")).toMatch(/ability-to-repay/);
  });

  it("is lost when no ATR determination was made", () => {
    const r = checkDoddFrankCompliance({
      ...base,
      sellerType: "entity",
      sellerFinancedDealsLast12Months: 2,
      abilityToRepayDetermined: false,
    });
    expect(r.exemptionApplicable).toBe("none");
    expect(r.risk).toBe("likely_violation");
  });

  it("4 properties in 12 months loses both exclusions with a critical finding", () => {
    const r = checkDoddFrankCompliance({ ...base, sellerType: "entity", sellerFinancedDealsLast12Months: 4 });
    expect(r.exemptionApplicable).toBe("none");
    expect(r.requiresLicensedMLO).toBe(true);
    expect(r.findings.some((f) => f.severity === "critical")).toBe(true);
  });

  it("an adjustable rate first changing at month 84 still qualifies", () => {
    const r = checkDoddFrankCompliance({
      ...base,
      sellerType: "entity",
      sellerFinancedDealsLast12Months: 2,
      rateType: "adjustable",
      firstRateAdjustmentMonths: 84,
    });
    expect(r.exemptionApplicable).toBe("3_property");
  });

  it("an adjustable rate first changing at month 36 loses both exclusions", () => {
    const r = checkDoddFrankCompliance({
      ...base,
      rateType: "adjustable",
      firstRateAdjustmentMonths: 36,
    });
    expect(r.exemptionApplicable).toBe("none");
    expect(r.requiresLicensedMLO).toBe(true);
  });
});

describe("1-property exclusion, 12 CFR 1026.36(a)(5)", () => {
  it("does not require the property to be the seller's residence", () => {
    const r = checkDoddFrankCompliance({ ...base, isSellerResidence: false, abilityToRepayDetermined: undefined });
    expect(r.exemptionApplicable).toBe("1_property_natural_person");
    expect(r.requiresLicensedMLO).toBe(false);
  });

  it("does not require an ability-to-repay determination", () => {
    const r = checkDoddFrankCompliance({ ...base, abilityToRepayDetermined: false });
    expect(r.exemptionApplicable).toBe("1_property_natural_person");
  });

  it("is lost on negative amortization", () => {
    const r = checkDoddFrankCompliance({ ...base, negativeAmortization: true });
    expect(r.exemptionApplicable).toBe("none");
    expect(r.requiresLicensedMLO).toBe(true);
  });

  it("is not available to an entity", () => {
    const r = checkDoddFrankCompliance({
      ...base,
      sellerType: "entity",
      rateType: "balloon_under_5yr",
      balloonAfterMonths: 36,
    });
    expect(r.exemptionApplicable).toBe("none");
  });

  it("2 properties in 12 months loses it", () => {
    const r = checkDoddFrankCompliance({ ...base, sellerFinancedDealsLast12Months: 2, rateType: "balloon_under_5yr", balloonAfterMonths: 36 });
    expect(r.exemptionApplicable).toBe("none");
  });
});

describe("seller-constructed residence", () => {
  it("loses both exclusions", () => {
    const r = checkDoddFrankCompliance({ ...base, sellerConstructedDwelling: true });
    expect(r.exemptionApplicable).toBe("none");
    expect(r.requiresLicensedMLO).toBe(true);
    expect(r.risk).toBe("likely_violation");
  });
});

describe("pricing screens still run on exempt loans", () => {
  it("an HPML-zone rate on an exempt loan is review_needed, not compliant", () => {
    const r = checkDoddFrankCompliance({ ...base, interestRate: 0.075 });
    expect(r.exemptionApplicable).not.toBe("none");
    expect(r.risk).toBe("review_needed");
  });
});
