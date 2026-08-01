/**
 * T263 — Usury Ceiling: tests of the REAL service.
 *
 * Rewritten 2026-08-01. This file previously reimplemented the ceiling logic
 * inline and asserted against its own copy — every assertion could pass while
 * `server/services/usuryCeiling.ts` said the opposite. It now imports the
 * shipped service and asserts against it.
 *
 * The inline `SPEC_STATE_LIMITS` table below is kept deliberately: it is an
 * INDEPENDENT expectation, written separately from the implementation. The
 * "service table matches independent spec" block compares the service's data
 * to it. Where the two disagree, that is a finding to investigate — do NOT
 * silently edit the spec to match the code.
 *
 * Status 2026-08-01: the service agrees with the spec on every ceiling and
 * exemption flag for all six spec states (AR, FL, CA, TX, CO, NY). Service
 * legalReference strings are supersets of the spec citations for CA and NY
 * (extra statute cites), which is why those assertions use `toContain`.
 *
 * Cross-source consistency between the THREE overlapping usury tables
 * (`usury.ts`, `usuryCeiling.ts`, `rmloAdvisor.ts`) is covered separately by
 * tests/unit/usuryConsistency.test.ts. Tracked as `state.usury-ceilings` in
 * shared/governance/statuteRegister.ts.
 */

import { describe, it, expect } from "vitest";
import {
  checkUsuryCeiling,
  getStateLimits,
  getAllStateLimits,
} from "../../server/services/usuryCeiling";

// ─── Independent expectation (the spec) ──────────────────────────────────────
// Deliberately NOT typed with the service's StateLimits interface, so the spec
// stays independent of the implementation's shape.

interface SpecStateLimits {
  stateCode: string;
  stateName: string;
  civilCeiling: number | null;
  commercialCeiling: number | null;
  realEstateCeiling: number | null;
  sellerFinancingExemption: boolean;
  /** Primary citation — asserted as a substring of the service's reference. */
  legalReference: string;
}

const SPEC_STATE_LIMITS: SpecStateLimits[] = [
  { stateCode: "AR", stateName: "Arkansas", civilCeiling: 17, commercialCeiling: 17, realEstateCeiling: 17, sellerFinancingExemption: false, legalReference: "Ark. Const. amend. 89" },
  { stateCode: "FL", stateName: "Florida", civilCeiling: 18, commercialCeiling: 25, realEstateCeiling: 18, sellerFinancingExemption: false, legalReference: "Fla. Stat. § 687.01" },
  { stateCode: "CA", stateName: "California", civilCeiling: 10, commercialCeiling: null, realEstateCeiling: null, sellerFinancingExemption: true, legalReference: "Cal. Const. art. XV" },
  { stateCode: "TX", stateName: "Texas", civilCeiling: null, commercialCeiling: null, realEstateCeiling: null, sellerFinancingExemption: true, legalReference: "Tex. Fin. Code § 302.001" },
  { stateCode: "CO", stateName: "Colorado", civilCeiling: null, commercialCeiling: null, realEstateCeiling: null, sellerFinancingExemption: true, legalReference: "C.R.S. § 5-12-103" },
  { stateCode: "NY", stateName: "New York", civilCeiling: 16, commercialCeiling: 25, realEstateCeiling: null, sellerFinancingExemption: true, legalReference: "N.Y. Gen. Oblig. Law § 5-511" },
];

// ─── Service table vs independent spec ───────────────────────────────────────

describe("service table matches independent spec", () => {
  for (const spec of SPEC_STATE_LIMITS) {
    it(`${spec.stateCode} (${spec.stateName}) ceilings, exemption, and citation match the spec`, () => {
      const actual = getStateLimits(spec.stateCode);
      expect(actual, `${spec.stateCode} missing from service table`).not.toBeNull();
      expect(actual!.stateName).toBe(spec.stateName);
      expect(actual!.civilCeiling, `${spec.stateCode} civilCeiling`).toBe(spec.civilCeiling);
      expect(actual!.commercialCeiling, `${spec.stateCode} commercialCeiling`).toBe(spec.commercialCeiling);
      expect(actual!.realEstateCeiling, `${spec.stateCode} realEstateCeiling`).toBe(spec.realEstateCeiling);
      expect(actual!.sellerFinancingExemption, `${spec.stateCode} sellerFinancingExemption`).toBe(spec.sellerFinancingExemption);
      expect(actual!.legalReference, `${spec.stateCode} legalReference`).toContain(spec.legalReference);
    });
  }
});

// ─── Behavioral tests against the real service ───────────────────────────────

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
  it("covers at least the 50 states plus DC", () => {
    const all = getAllStateLimits();
    expect(Array.isArray(all)).toBe(true);
    expect(all.length).toBeGreaterThanOrEqual(51);
    const codes = new Set(all.map((s) => s.stateCode));
    for (const spec of SPEC_STATE_LIMITS) {
      expect(codes.has(spec.stateCode), `missing ${spec.stateCode}`).toBe(true);
    }
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
