/**
 * T264 — Property Tax Service Tests
 * Tests tax escrow calculations, portal URL lookup, and escrow adequacy checks.
 */

import { describe, it, expect } from "vitest";

// ─── Inline pure logic ────────────────────────────────────────────────────────

interface TaxEscrowSetup {
  annualPropertyTax: number;
  monthlyTaxEscrow: number;
  totalMonthlyPaymentWithEscrow: number;
  projectedEscrowBalance12Months: number;
  countyTaxPortalUrl: string;
}

const STATE_TAX_PORTAL_PATTERNS: Record<string, string> = {
  AZ: "https://mcassessor.maricopa.gov/",
  CA: "https://www.assessor.lacounty.gov/",
  TX: "https://www.dallascad.org/",
  FL: "https://www.bcpao.us/",
  CO: "https://www.denvergov.org/Government/Agencies-Departments-Offices/",
};

function getCountyTaxPortalUrl(state: string, county?: string): string {
  const stateCode = state.toUpperCase().trim();
  return (
    STATE_TAX_PORTAL_PATTERNS[stateCode] ||
    `https://www.google.com/search?q=${encodeURIComponent(`${county || ""} county ${stateCode} property tax payment online`)}`
  );
}

function calculateTaxEscrow(
  annualPropertyTax: number,
  currentMonthlyPayment: number,
  state: string,
  county?: string
): TaxEscrowSetup {
  const monthlyTaxEscrow = Math.ceil((annualPropertyTax / 12) * 100) / 100;
  return {
    annualPropertyTax,
    monthlyTaxEscrow,
    totalMonthlyPaymentWithEscrow: currentMonthlyPayment + monthlyTaxEscrow,
    projectedEscrowBalance12Months: monthlyTaxEscrow * 12,
    countyTaxPortalUrl: getCountyTaxPortalUrl(state, county),
  };
}

function isEscrowAdequate(currentBalance: number, annualTax: number, monthsUntilDue: number): boolean {
  const requiredBalance = (annualTax / 12) * monthsUntilDue;
  return currentBalance >= requiredBalance;
}

function calculateEscrowShortfall(currentBalance: number, annualTax: number, monthsUntilDue: number): number {
  const required = (annualTax / 12) * monthsUntilDue;
  return Math.max(0, required - currentBalance);
}

function prorateTaxByDays(annualTax: number, daysOwned: number, daysInYear = 365): number {
  return Math.round((annualTax / daysInYear) * daysOwned * 100) / 100;
}

function estimateAnnualTaxFromRate(assessedValueCents: number, millageRate: number): number {
  // millage rate = dollars per $1,000 of assessed value
  return (assessedValueCents / 1000) * millageRate;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("getCountyTaxPortalUrl", () => {
  it("returns known portal for AZ", () => {
    const url = getCountyTaxPortalUrl("AZ");
    expect(url).toContain("maricopa");
  });

  it("returns known portal for TX", () => {
    expect(getCountyTaxPortalUrl("TX")).toContain("dallascad");
  });

  it("is case-insensitive", () => {
    expect(getCountyTaxPortalUrl("az")).toBe(getCountyTaxPortalUrl("AZ"));
  });

  it("falls back to google search for unknown state", () => {
    const url = getCountyTaxPortalUrl("WY", "Laramie");
    expect(url).toContain("google.com/search");
    expect(url).toContain("WY");
  });

  it("includes county in fallback URL", () => {
    const url = getCountyTaxPortalUrl("MT", "Gallatin");
    expect(url).toContain("Gallatin");
  });
});

describe("calculateTaxEscrow", () => {
  it("computes monthly escrow as annual / 12 rounded up", () => {
    // $1200/year → $100/month exactly
    const result = calculateTaxEscrow(1200, 500, "TX");
    expect(result.monthlyTaxEscrow).toBe(100);
    expect(result.annualPropertyTax).toBe(1200);
  });

  it("rounds up partial cents", () => {
    // $1300/year → 108.333... → ceil to 108.34
    const result = calculateTaxEscrow(1300, 500, "TX");
    expect(result.monthlyTaxEscrow).toBeCloseTo(108.34, 2);
  });

  it("adds escrow to monthly payment", () => {
    const result = calculateTaxEscrow(1200, 500, "TX");
    expect(result.totalMonthlyPaymentWithEscrow).toBe(600);
  });

  it("projects 12-month escrow balance", () => {
    const result = calculateTaxEscrow(1200, 500, "TX");
    expect(result.projectedEscrowBalance12Months).toBeCloseTo(1200, 0);
  });

  it("includes county portal URL", () => {
    const result = calculateTaxEscrow(1200, 500, "AZ", "Maricopa");
    expect(result.countyTaxPortalUrl).toBeTruthy();
    expect(typeof result.countyTaxPortalUrl).toBe("string");
  });
});

describe("isEscrowAdequate", () => {
  it("returns true when balance covers upcoming tax", () => {
    // $1200/year, 3 months until due → need $300, have $400
    expect(isEscrowAdequate(400, 1200, 3)).toBe(true);
  });

  it("returns false when balance is insufficient", () => {
    // $1200/year, 6 months → need $600, have $400
    expect(isEscrowAdequate(400, 1200, 6)).toBe(false);
  });

  it("returns true when balance exactly meets requirement", () => {
    expect(isEscrowAdequate(300, 1200, 3)).toBe(true);
  });
});

describe("calculateEscrowShortfall", () => {
  it("returns shortfall when balance insufficient", () => {
    // Need $600, have $400 → shortfall $200
    expect(calculateEscrowShortfall(400, 1200, 6)).toBe(200);
  });

  it("returns 0 when balance is adequate", () => {
    expect(calculateEscrowShortfall(500, 1200, 3)).toBe(0);
  });
});

describe("prorateTaxByDays", () => {
  it("prorates full year", () => {
    expect(prorateTaxByDays(1200, 365)).toBeCloseTo(1200, 0);
  });

  it("prorates half year", () => {
    expect(prorateTaxByDays(1200, 182)).toBeCloseTo(598.36, 1);
  });

  it("prorates single day", () => {
    expect(prorateTaxByDays(3650, 1)).toBeCloseTo(10, 0);
  });
});

describe("estimateAnnualTaxFromRate", () => {
  it("calculates at 10 mills on $100k", () => {
    // $100,000 assessed, 10 mills = $10/thousand = $1,000 annual tax
    expect(estimateAnnualTaxFromRate(100_000, 10)).toBe(1000);
  });

  it("calculates at 20 mills on $250k", () => {
    // $250,000, 20 mills = $20/thousand = $5,000
    expect(estimateAnnualTaxFromRate(250_000, 20)).toBe(5000);
  });

  it("returns 0 for zero assessed value", () => {
    expect(estimateAnnualTaxFromRate(0, 15)).toBe(0);
  });
});
