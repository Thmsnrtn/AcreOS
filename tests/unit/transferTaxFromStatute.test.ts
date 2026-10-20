/**
 * Transfer tax — expected values worked from the STATUTE TEXT, not the table.
 *
 * The tests that used to guard transfer tax re-implemented the calculation
 * inline and pinned the table's own (wrong) numbers — "FL … $0.70/$1k on
 * $100k = $70" — so they agreed with a 10× error (best-in-class audit
 * 2026-10-20, §3 P0 #1). Each case below states the statutory rate in words
 * and the arithmetic by hand; the expected cents are typed literally. If the
 * table drifts from the statute, these fail.
 *
 * Statute rates were re-derived 2026-10-20 (see each row's citation in
 * shared/regulatory/transferTax.ts).
 */

import { describe, it, expect } from "vitest";
import {
  estimateTransferTax,
  TRANSFER_TAX_RULES,
  type TransferTaxEstimate,
} from "../../shared/regulatory/transferTax";

function cents(e: TransferTaxEstimate): number {
  if (e.kind !== "estimate") throw new Error(`expected an estimate, got ${e.kind}: ${"reason" in e ? e.reason : ""}`);
  return e.amountCents;
}

describe("flat state rates, worked from the statute", () => {
  const cases: Array<[string, string, number, number, string]> = [
    // [state, county, price, expected cents, worked arithmetic]
    ["FL", "Leon", 100_000, 70_000, "$0.70 per $100: 1,000 × $0.70 = $700"],
    ["FL", "Leon", 100_050, 70_070, "$0.70 per $100 or fraction: 1,001 × $0.70 = $700.70"],
    ["NC", "Wake", 150_000, 30_000, "$1 per $500: 300 × $1 = $300"],
    ["NV", "Lyon", 200_000, 78_000, "$1.95 per $500: 400 × $1.95 = $780"],
    ["NV", "Clark", 200_000, 102_000, "$2.55 per $500: 400 × $2.55 = $1,020"],
    ["NV", "Washoe", 200_000, 82_000, "$2.05 per $500: 400 × $2.05 = $820"],
    ["MI", "Kent", 100_000, 86_000, "state $3.75 per $500 (200 × 3.75 = $750) + county $0.55 per $500 ($110) = $860"],
    ["CA", "Fresno", 100_000, 11_000, "$0.55 per $500: 200 × $0.55 = $110"],
    ["CO", "Park", 100_000, 1_000, "$0.01 per $100: 1,000 × $0.01 = $10"],
    ["AL", "Baldwin", 100_000, 10_000, "$0.50 per $500: 200 × $0.50 = $100"],
    ["KY", "Hardin", 100_000, 10_000, "$0.50 per $500: 200 × $0.50 = $100"],
    ["OK", "Tulsa", 100_000, 15_000, "$0.75 per $500: 200 × $0.75 = $150"],
    ["SD", "Minnehaha", 100_000, 10_000, "$0.50 per $500: 200 × $0.50 = $100"],
    ["TN", "Davidson", 100_000, 37_000, "$0.37 per $100: 1,000 × $0.37 = $370"],
    ["SC", "Horry", 100_000, 37_000, "state $1.30 per $500 ($260) + county $0.55 per $500 ($110) = $370"],
    ["WV", "Kanawha", 100_000, 33_000, "$1.10 per $500 ($220) + county $0.55 per $500 ($110) = $330"],
    ["IL", "Sangamon", 100_000, 15_000, "state $0.50 per $500 ($100) + county $0.25 per $500 ($50) = $150"],
    ["GA", "Fulton", 100_000, 10_000, "$1 first $1,000 + $0.10 per further $100 = $1 + 990 × $0.10 = $100"],
    ["WI", "Dane", 100_000, 30_000, "$0.30 per $100: 1,000 × $0.30 = $300"],
    ["NH", "Merrimack", 100_000, 150_000, "$0.75 per $100 from each party: 1,000 × $1.50 = $1,500"],
    ["MA", "Worcester", 100_000, 45_600, "$2.28 per $500: 200 × $2.28 = $456"],
    ["MN", "Stearns", 100_000, 33_000, "0.33% of $100,000 = $330"],
    ["MN", "Hennepin", 100_000, 34_000, "0.34% of $100,000 = $340"],
    ["PA", "Erie", 100_000, 100_000, "1% state of $100,000 = $1,000"],
    ["MD", "Garrett", 100_000, 50_000, "0.5% state of $100,000 = $500"],
    ["DE", "Sussex", 100_000, 250_000, "2.5% state of $100,000 = $2,500"],
    ["NY", "Erie", 100_000, 40_000, "$2 per $500: 200 × $2 = $400"],
    ["VA", "Fauquier", 100_000, 35_000, "recordation $0.25 per $100 ($250) + grantor $0.50 per $500 ($100) = $350"],
    ["IA", "Polk", 100_000, 15_920, "$0.80 per $500 over the first $500: ceil(99,500 / 500) = 199 × $0.80 = $159.20"],
    ["NE", "Lancaster", 100_000, 33_200, "$3.32 per $1,000: 100 × $3.32 = $332"],
    ["AR", "Pulaski", 100_000, 33_000, "$3.30 per $1,000: 100 × $3.30 = $330"],
    ["OH", "Franklin", 100_000, 10_000, "mandatory $1 per $1,000: 100 × $1 = $100 (permissive fee excluded)"],
  ];
  for (const [st, county, price, expected, why] of cases) {
    it(`${st} ${county} $${price.toLocaleString()} → $${(expected / 100).toFixed(2)} (${why})`, () => {
      expect(cents(estimateTransferTax(st, price, { county, asOfIsoDate: "2026-10-20" }))).toBe(expected);
    });
  }
});

describe("Miami-Dade, Fla. Stat. § 201.02(1)(b)", () => {
  it("single-family residence: $0.60 per $100 → $600 on $100,000", () => {
    expect(cents(estimateTransferTax("FL", 100_000, { county: "Miami-Dade", propertyClass: "single_family_residence" }))).toBe(60_000);
  });
  it("vacant land carries the $0.45 surtax: $1.05 per $100 → $1,050 on $100,000", () => {
    expect(cents(estimateTransferTax("FL", 100_000, { county: "Miami-Dade County", propertyClass: "vacant_land" }))).toBe(105_000);
  });
  it("refuses when the property class is unknown", () => {
    expect(estimateTransferTax("FL", 100_000, { county: "Miami-Dade" }).kind).toBe("refused");
  });
});

describe("graduated schedules", () => {
  it("WA $600,000 (marginal): 1.10% × 525,000 + 1.28% × 75,000 = $5,775 + $960 = $6,735", () => {
    expect(cents(estimateTransferTax("WA", 600_000, { propertyClass: "vacant_land", asOfIsoDate: "2026-10-20" }))).toBe(673_500);
  });
  it("ME $1,500,000 (marginal): $2.20/$500 × 2,000 + $6.00/$500 × 1,000 = $4,400 + $6,000 = $10,400", () => {
    expect(cents(estimateTransferTax("ME", 1_500_000, { propertyClass: "vacant_land", asOfIsoDate: "2026-10-20" }))).toBe(1_040_000);
  });
  it("CT unimproved land $200,000: 0.75% = $1,500", () => {
    expect(cents(estimateTransferTax("CT", 200_000, { propertyClass: "vacant_land" }))).toBe(150_000);
  });
  it("CT residence $1,000,000 (marginal): 0.75% × 800,000 + 1.25% × 200,000 = $6,000 + $2,500 = $8,500", () => {
    expect(cents(estimateTransferTax("CT", 1_000_000, { propertyClass: "single_family_residence" }))).toBe(850_000);
  });
  it("HI vacant land $500,000 (general schedule, under $600k): $0.10 per $100 = $500", () => {
    expect(cents(estimateTransferTax("HI", 500_000, { propertyClass: "vacant_land" }))).toBe(50_000);
  });
  it("HI residence is refused (schedule turns on homeowner-exemption eligibility)", () => {
    expect(estimateTransferTax("HI", 500_000, { propertyClass: "single_family_residence" }).kind).toBe("refused");
  });
  it("RI vacant land $100,000: $3.75 per $500 → $750", () => {
    expect(cents(estimateTransferTax("RI", 100_000, { propertyClass: "vacant_land", asOfIsoDate: "2026-10-20" }))).toBe(75_000);
  });
  it("VT vacant land $100,000: 1.25% + 0.22% surcharge = $1,470", () => {
    expect(cents(estimateTransferTax("VT", 100_000, { propertyClass: "vacant_land" }))).toBe(147_000);
  });
  it("a graduated state refuses when the property class is unknown", () => {
    expect(estimateTransferTax("WA", 600_000).kind).toBe("refused");
  });
});

describe("no tax, local-only, refused and dated rules", () => {
  for (const st of ["TX", "AZ", "MT", "MO", "AK", "ID", "IN", "KS", "MS", "NM", "ND", "UT", "WY"]) {
    it(`${st} has no transfer tax`, () => {
      expect(estimateTransferTax(st, 100_000).kind).toBe("none");
    });
  }
  it("NJ refuses (graduated with exemptions)", () => {
    expect(estimateTransferTax("NJ", 100_000).kind).toBe("refused");
  });
  it("OR outside Washington County refuses as local-only; Washington County is $1 per $1,000", () => {
    expect(estimateTransferTax("OR", 100_000, { county: "Lane" }).kind).toBe("refused");
    expect(cents(estimateTransferTax("OR", 100_000, { county: "Washington" }))).toBe(10_000);
  });
  it("NE refuses a transfer dated before its current rate took effect", () => {
    expect(estimateTransferTax("NE", 100_000, { asOfIsoDate: "2026-01-15" }).kind).toBe("refused");
  });
  it("WA refuses a transfer after its bracket thresholds expire", () => {
    expect(estimateTransferTax("WA", 600_000, { propertyClass: "vacant_land", asOfIsoDate: "2027-02-01" }).kind).toBe("refused");
  });
  it("CO under $500 is not taxed", () => {
    expect(estimateTransferTax("CO", 400).kind).toBe("none");
  });
  it("an unknown state refuses", () => {
    expect(estimateTransferTax("ZZ", 100_000).kind).toBe("refused");
  });
  it("an estimate names the local taxes it excludes", () => {
    const e = estimateTransferTax("PA", 100_000);
    expect(e.kind === "estimate" && e.excludesLocal).toMatch(/local realty transfer/);
  });
});

describe("coverage", () => {
  it("every state and DC has a rule", () => {
    const states = "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" ");
    expect(states.filter((s) => !TRANSFER_TAX_RULES[s])).toEqual([]);
    expect(Object.keys(TRANSFER_TAX_RULES)).toHaveLength(51);
  });
});
