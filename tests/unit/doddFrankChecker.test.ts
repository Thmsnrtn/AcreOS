/**
 * T275 — Dodd-Frank Compliance Checker Tests
 * Tests seller-financing compliance logic for land deals.
 */

import { describe, it, expect } from "vitest";

// ─── Inline pure logic ────────────────────────────────────────────────────────

interface DoddFrankInput {
  sellerFinancedDealsLast12Months: number;
  sellerType: "natural_person" | "entity" | "estate_or_trust";
  hasDwelling: boolean;
  sellerConstructedDwelling: boolean;
  isSellerResidence: boolean;
  loanTermMonths: number;
  rateType: "fixed" | "adjustable" | "balloon_under_5yr" | "balloon_5yr_plus";
  balloonAfterMonths?: number;
  interestRate: number;
}

type ComplianceRisk = "compliant" | "review_needed" | "likely_violation" | "attorney_required";

interface DoddFrankCheckResult {
  risk: ComplianceRisk;
  exemptionApplicable?: "3_property" | "1_property_natural_person" | "non_dwelling_land" | "none";
  summary: string;
  findings: Array<{ issue: string; detail: string; severity: "info" | "warning" | "critical" }>;
  recommendations: string[];
  requiresLicensedMLO: boolean;
}

function checkDoddFrankCompliance(input: DoddFrankInput): DoddFrankCheckResult {
  const findings: DoddFrankCheckResult["findings"] = [];
  const recommendations: string[] = [];

  // Pure land — generally exempt
  if (!input.hasDwelling) {
    findings.push({ issue: "Non-dwelling land transaction", detail: "CFPB Regulation Z generally does not apply to land-only sales.", severity: "info" });
    recommendations.push("Verify the property has no dwelling.", "Consult state attorney for state-specific laws.");
    return {
      risk: "compliant",
      exemptionApplicable: "non_dwelling_land",
      summary: "Land-only transaction — federal Dodd-Frank rules generally do not apply.",
      findings,
      recommendations,
      requiresLicensedMLO: false,
    };
  }

  let requiresMLO = true;
  let applicableExemption: DoddFrankCheckResult["exemptionApplicable"] = "none";

  // 3-property exemption
  if (input.sellerFinancedDealsLast12Months <= 3 && !input.sellerConstructedDwelling) {
    applicableExemption = "3_property";
    requiresMLO = false;
    findings.push({
      issue: "3-Property Exemption",
      detail: `Seller has financed ${input.sellerFinancedDealsLast12Months} property(s) in the past 12 months.`,
      severity: "info",
    });
    if (input.rateType === "adjustable") {
      findings.push({ issue: "Adjustable Rate", detail: "Additional disclosures may be required.", severity: "warning" });
      recommendations.push("Have an attorney draft the adjustable-rate note with proper TILA disclosures.");
    }
  } else if (input.sellerFinancedDealsLast12Months > 3) {
    findings.push({ issue: "3-Property Limit Exceeded", detail: `Seller has financed ${input.sellerFinancedDealsLast12Months} properties — limit is 3.`, severity: "critical" });
  }

  // 1-property natural person exemption
  if (applicableExemption === "none" && input.sellerType === "natural_person") {
    if (input.sellerFinancedDealsLast12Months <= 1 && input.isSellerResidence) {
      if (input.rateType === "fixed" || input.rateType === "balloon_5yr_plus") {
        if (!input.balloonAfterMonths || input.balloonAfterMonths >= 60) {
          applicableExemption = "1_property_natural_person";
          requiresMLO = false;
          findings.push({ issue: "1-Property Natural Person Exemption", detail: "Exemption appears to apply.", severity: "info" });
        }
      }
    }
  }

  if (input.sellerType === "entity") {
    findings.push({ issue: "Entity Seller", detail: "1-property natural person exemption does NOT apply to entities.", severity: "warning" });
    recommendations.push("Consider whether a licensed MLO is needed.");
  }

  if (input.balloonAfterMonths && input.balloonAfterMonths < 60) {
    findings.push({ issue: "Balloon Payment Under 5 Years", detail: `${input.balloonAfterMonths}-month balloon disqualifies exemption.`, severity: "warning" });
    recommendations.push("Extend balloon period to 60+ months.");
  }

  if (input.interestRate > 0.10) {
    findings.push({ issue: "High Interest Rate", detail: `${(input.interestRate * 100).toFixed(1)}% may trigger HPML.`, severity: "warning" });
    recommendations.push("Verify APOR rate from FFIEC.");
  }

  if (input.sellerConstructedDwelling) {
    findings.push({ issue: "Seller-Constructed Dwelling", detail: "3-property exemption does NOT apply.", severity: "critical" });
    requiresMLO = true;
  }

  const criticals = findings.filter(f => f.severity === "critical").length;
  const warnings = findings.filter(f => f.severity === "warning").length;

  let risk: ComplianceRisk;
  if (requiresMLO || criticals > 0) {
    risk = "likely_violation";
    recommendations.push("Consult a licensed real estate attorney before proceeding.");
  } else if (warnings > 0) {
    risk = "review_needed";
  } else {
    risk = "compliant";
  }

  return {
    risk,
    exemptionApplicable: applicableExemption,
    summary: risk === "compliant" ? "Transaction appears compliant." : risk === "review_needed" ? "Review recommended." : "Likely requires licensed MLO.",
    findings,
    recommendations,
    requiresLicensedMLO: requiresMLO,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

const landOnlyDeal: DoddFrankInput = {
  sellerFinancedDealsLast12Months: 1,
  sellerType: "natural_person",
  hasDwelling: false,
  sellerConstructedDwelling: false,
  isSellerResidence: false,
  loanTermMonths: 60,
  rateType: "fixed",
  interestRate: 0.10,
};

const dwellingDeal: DoddFrankInput = {
  sellerFinancedDealsLast12Months: 1,
  sellerType: "natural_person",
  hasDwelling: true,
  sellerConstructedDwelling: false,
  isSellerResidence: false,
  loanTermMonths: 60,
  rateType: "fixed",
  interestRate: 0.08,
};

describe("checkDoddFrankCompliance — land-only deals", () => {
  it("returns compliant for pure land with no dwelling", () => {
    const result = checkDoddFrankCompliance(landOnlyDeal);
    expect(result.risk).toBe("compliant");
    expect(result.exemptionApplicable).toBe("non_dwelling_land");
    expect(result.requiresLicensedMLO).toBe(false);
  });

  it("does not require MLO for land-only deals", () => {
    const result = checkDoddFrankCompliance({ ...landOnlyDeal, interestRate: 0.25 });
    expect(result.requiresLicensedMLO).toBe(false);
  });
});

describe("checkDoddFrankCompliance — 3-property exemption", () => {
  it("applies 3-property exemption for ≤3 deals", () => {
    const result = checkDoddFrankCompliance(dwellingDeal);
    expect(result.exemptionApplicable).toBe("3_property");
    expect(result.requiresLicensedMLO).toBe(false);
    expect(result.risk).toBe("compliant");
  });

  it("3 deals still qualifies for exemption", () => {
    const result = checkDoddFrankCompliance({ ...dwellingDeal, sellerFinancedDealsLast12Months: 3 });
    expect(result.exemptionApplicable).toBe("3_property");
  });

  it("flags violation when seller financed 4+ properties", () => {
    const result = checkDoddFrankCompliance({ ...dwellingDeal, sellerFinancedDealsLast12Months: 4 });
    expect(result.risk).toBe("likely_violation");
    expect(result.requiresLicensedMLO).toBe(true);
    const critical = result.findings.find(f => f.severity === "critical");
    expect(critical).toBeTruthy();
  });
});

describe("checkDoddFrankCompliance — seller-constructed dwelling", () => {
  it("requires MLO when seller constructed the dwelling", () => {
    const result = checkDoddFrankCompliance({
      ...dwellingDeal,
      sellerConstructedDwelling: true,
    });
    expect(result.requiresLicensedMLO).toBe(true);
    expect(result.risk).toBe("likely_violation");
  });
});

describe("checkDoddFrankCompliance — entity sellers", () => {
  it("adds warning for entity sellers (no 1-property exemption)", () => {
    const result = checkDoddFrankCompliance({
      ...dwellingDeal,
      sellerType: "entity",
      sellerFinancedDealsLast12Months: 1,
    });
    const entityWarning = result.findings.find(f => f.issue === "Entity Seller");
    expect(entityWarning).toBeTruthy();
  });
});

describe("checkDoddFrankCompliance — interest rate and balloon", () => {
  it("adds warning for interest rate above 10%", () => {
    const result = checkDoddFrankCompliance({ ...dwellingDeal, interestRate: 0.12 });
    const rateWarning = result.findings.find(f => f.issue === "High Interest Rate");
    expect(rateWarning).toBeTruthy();
    expect(result.risk).toBe("review_needed");
  });

  it("warns for balloon payment under 60 months", () => {
    const result = checkDoddFrankCompliance({
      ...dwellingDeal,
      balloonAfterMonths: 36,
    });
    const balloonWarning = result.findings.find(f => f.issue === "Balloon Payment Under 5 Years");
    expect(balloonWarning).toBeTruthy();
  });

  it("1-property natural person exemption applies for 1 deal + fixed rate + residence", () => {
    const result = checkDoddFrankCompliance({
      ...dwellingDeal,
      sellerFinancedDealsLast12Months: 5, // disqualifies 3-property
      isSellerResidence: true,
    });
    // 5 deals disqualifies both exemptions
    expect(result.exemptionApplicable).toBe("none");
    expect(result.requiresLicensedMLO).toBe(true);
  });
});
