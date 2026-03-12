/**
 * T263 — Usury Ceiling Service Tests
 * Tests state usury law compliance checks for seller-financed land deals.
 */

import { describe, it, expect } from "vitest";

// ─── Inline pure logic ────────────────────────────────────────────────────────

interface StateLimits {
  stateCode: string;
  stateName: string;
  civilCeiling: number | null;
  commercialCeiling: number | null;
  realEstateCeiling: number | null;
  sellerFinancingExemption: boolean;
  notes: string;
  legalReference: string;
}

interface UsuryCeilingCheckResult {
  stateCode: string;
  stateName: string;
  proposedRate: number;
  applicable_ceiling: number | null;
  isAboveCeiling: boolean;
  risk: "compliant" | "borderline" | "likely_violation" | "consult_attorney";
  summary: string;
  recommendation: string;
  legalReference: string;
  sellerFinancingExemptionAvailable: boolean;
}

const STATE_USURY_DATA: StateLimits[] = [
  { stateCode: "AR", stateName: "Arkansas", civilCeiling: 17, commercialCeiling: 17, realEstateCeiling: 17, sellerFinancingExemption: false, notes: "Constitutional 17% cap. Applies to all loans.", legalReference: "Ark. Const. amend. 89" },
  { stateCode: "FL", stateName: "Florida", civilCeiling: 18, commercialCeiling: 25, realEstateCeiling: 18, sellerFinancingExemption: false, notes: "18% for RE, 25% criminal threshold.", legalReference: "Fla. Stat. § 687.01" },
  { stateCode: "CA", stateName: "California", civilCeiling: 10, commercialCeiling: null, realEstateCeiling: null, sellerFinancingExemption: true, notes: "Seller-financing exemption for non-dwelling RE.", legalReference: "Cal. Const. art. XV" },
  { stateCode: "TX", stateName: "Texas", civilCeiling: null, commercialCeiling: null, realEstateCeiling: null, sellerFinancingExemption: true, notes: "No effective ceiling for written commercial RE agreements.", legalReference: "Tex. Fin. Code § 302.001" },
  { stateCode: "CO", stateName: "Colorado", civilCeiling: null, commercialCeiling: null, realEstateCeiling: null, sellerFinancingExemption: true, notes: "No general usury ceiling.", legalReference: "C.R.S. § 5-12-103" },
  { stateCode: "NY", stateName: "New York", civilCeiling: 16, commercialCeiling: 25, realEstateCeiling: null, sellerFinancingExemption: true, notes: "Criminal usury at 25%+.", legalReference: "N.Y. Gen. Oblig. Law § 5-511" },
];

const stateMap = new Map(STATE_USURY_DATA.map(s => [s.stateCode, s]));

function checkUsuryCeiling(
  stateCode: string,
  proposedAnnualRateDecimal: number,
  isCommercialOrBusiness: boolean = false,
  hasDwelling: boolean = false
): UsuryCeilingCheckResult {
  const state = stateMap.get(stateCode.toUpperCase());
  const ratePercent = proposedAnnualRateDecimal * 100;

  if (!state) {
    return {
      stateCode,
      stateName: stateCode,
      proposedRate: ratePercent,
      applicable_ceiling: null,
      isAboveCeiling: false,
      risk: "consult_attorney",
      summary: `State "${stateCode}" not found in database.`,
      recommendation: "Consult a licensed real estate attorney.",
      legalReference: "Unknown",
      sellerFinancingExemptionAvailable: false,
    };
  }

  // Seller-financing exemption for non-dwelling RE
  if (state.sellerFinancingExemption && !hasDwelling) {
    return {
      stateCode,
      stateName: state.stateName,
      proposedRate: ratePercent,
      applicable_ceiling: null,
      isAboveCeiling: false,
      risk: "compliant",
      summary: `${state.stateName} has a seller-financing exemption for non-dwelling real estate.`,
      recommendation: `Document the seller-financing nature of the transaction. ${state.notes}`,
      legalReference: state.legalReference,
      sellerFinancingExemptionAvailable: true,
    };
  }

  // Determine applicable ceiling
  let ceiling: number | null = null;
  if (isCommercialOrBusiness && state.commercialCeiling !== null) {
    ceiling = state.commercialCeiling;
  } else if (state.realEstateCeiling !== null) {
    ceiling = state.realEstateCeiling;
  } else if (state.civilCeiling !== null) {
    ceiling = state.civilCeiling;
  }

  if (ceiling === null) {
    return {
      stateCode,
      stateName: state.stateName,
      proposedRate: ratePercent,
      applicable_ceiling: null,
      isAboveCeiling: false,
      risk: "compliant",
      summary: `${state.stateName} has no statutory usury ceiling for this type of transaction.`,
      recommendation: state.notes,
      legalReference: state.legalReference,
      sellerFinancingExemptionAvailable: state.sellerFinancingExemption,
    };
  }

  const isAbove = ratePercent > ceiling;
  const borderline = !isAbove && ratePercent >= ceiling * 0.9;

  return {
    stateCode,
    stateName: state.stateName,
    proposedRate: ratePercent,
    applicable_ceiling: ceiling,
    isAboveCeiling: isAbove,
    risk: isAbove ? "likely_violation" : borderline ? "borderline" : "compliant",
    summary: isAbove
      ? `USURY ALERT: Proposed rate of ${ratePercent.toFixed(2)}% exceeds ${state.stateName}'s ceiling of ${ceiling}%.`
      : `Proposed rate of ${ratePercent.toFixed(2)}% is within ${state.stateName}'s ceiling of ${ceiling}%.`,
    recommendation: isAbove
      ? `Reduce the interest rate to ${ceiling}% or below. ${state.notes}`
      : state.notes,
    legalReference: state.legalReference,
    sellerFinancingExemptionAvailable: state.sellerFinancingExemption,
  };
}

function getStateLimits(stateCode: string): StateLimits | null {
  return stateMap.get(stateCode.toUpperCase()) || null;
}

function getAllStateLimits(): StateLimits[] {
  return STATE_USURY_DATA;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("checkUsuryCeiling", () => {
  describe("seller-financing exemption", () => {
    it("returns compliant for CA non-dwelling with seller-financing exemption", () => {
      const result = checkUsuryCeiling("CA", 0.15, false, false); // 15%
      expect(result.risk).toBe("compliant");
      expect(result.isAboveCeiling).toBe(false);
      expect(result.applicable_ceiling).toBeNull();
      expect(result.sellerFinancingExemptionAvailable).toBe(true);
    });

    it("checks civil ceiling for CA when hasDwelling=true (no exemption)", () => {
      const result = checkUsuryCeiling("CA", 0.15, false, true); // 15% on dwelling
      // CA civil ceiling is 10%, 15% > 10% → violation
      expect(result.isAboveCeiling).toBe(true);
      expect(result.risk).toBe("likely_violation");
      expect(result.applicable_ceiling).toBe(10);
    });

    it("returns compliant for TX (no ceiling at all)", () => {
      const result = checkUsuryCeiling("TX", 0.25, false, false); // 25%
      expect(result.risk).toBe("compliant");
      expect(result.isAboveCeiling).toBe(false);
    });

    it("returns compliant for CO (no ceiling)", () => {
      const result = checkUsuryCeiling("CO", 0.20, false, false);
      expect(result.risk).toBe("compliant");
      expect(result.applicable_ceiling).toBeNull();
    });
  });

  describe("Arkansas strict ceiling", () => {
    it("flags violation when above 17% (no exemption)", () => {
      const result = checkUsuryCeiling("AR", 0.18); // 18% > 17%
      expect(result.isAboveCeiling).toBe(true);
      expect(result.risk).toBe("likely_violation");
      expect(result.applicable_ceiling).toBe(17);
    });

    it("returns compliant at exactly 17%", () => {
      const result = checkUsuryCeiling("AR", 0.17);
      expect(result.isAboveCeiling).toBe(false);
    });

    it("returns borderline when close to ceiling (>= 90% of limit)", () => {
      // 90% of 17% = 15.3%, so 16% should be borderline
      const result = checkUsuryCeiling("AR", 0.16);
      expect(result.risk).toBe("borderline");
    });
  });

  describe("Florida ceilings", () => {
    it("uses RE ceiling (18%) for non-commercial Florida deal", () => {
      const result = checkUsuryCeiling("FL", 0.20, false, false); // 20% > 18%
      expect(result.isAboveCeiling).toBe(true);
      expect(result.applicable_ceiling).toBe(18);
    });

    it("uses commercial ceiling (25%) for FL commercial", () => {
      const result = checkUsuryCeiling("FL", 0.20, true, false); // 20% < 25%
      expect(result.isAboveCeiling).toBe(false);
      expect(result.applicable_ceiling).toBe(25);
    });

    it("flags FL commercial above 25%", () => {
      const result = checkUsuryCeiling("FL", 0.30, true, false);
      expect(result.isAboveCeiling).toBe(true);
      expect(result.risk).toBe("likely_violation");
    });
  });

  describe("unknown state", () => {
    it("returns consult_attorney for unknown state", () => {
      const result = checkUsuryCeiling("XX", 0.12);
      expect(result.risk).toBe("consult_attorney");
      expect(result.isAboveCeiling).toBe(false);
    });
  });

  describe("New York", () => {
    it("returns compliant for NY seller-financed non-dwelling (exemption)", () => {
      const result = checkUsuryCeiling("NY", 0.20, false, false);
      expect(result.risk).toBe("compliant");
      expect(result.sellerFinancingExemptionAvailable).toBe(true);
    });

    it("uses civil ceiling when dwelling is involved", () => {
      const result = checkUsuryCeiling("NY", 0.20, false, true); // 20% > 16%
      expect(result.isAboveCeiling).toBe(true);
      expect(result.applicable_ceiling).toBe(16);
    });
  });
});

describe("getStateLimits", () => {
  it("returns state data for valid state code", () => {
    const limits = getStateLimits("AR");
    expect(limits).not.toBeNull();
    expect(limits!.stateName).toBe("Arkansas");
    expect(limits!.civilCeiling).toBe(17);
  });

  it("returns null for unknown state", () => {
    expect(getStateLimits("ZZ")).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(getStateLimits("ar")).toEqual(getStateLimits("AR"));
  });
});

describe("getAllStateLimits", () => {
  it("returns an array of state limits", () => {
    const all = getAllStateLimits();
    expect(Array.isArray(all)).toBe(true);
    expect(all.length).toBeGreaterThan(0);
  });

  it("all entries have required fields", () => {
    const all = getAllStateLimits();
    for (const s of all) {
      expect(typeof s.stateCode).toBe("string");
      expect(typeof s.stateName).toBe("string");
      expect(typeof s.sellerFinancingExemption).toBe("boolean");
    }
  });
});
