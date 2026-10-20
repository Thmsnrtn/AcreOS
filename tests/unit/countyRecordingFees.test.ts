/**
 * County recording fees + closing-cost estimate — against the PRODUCTION
 * module.
 *
 * This file used to re-implement the module inline, table included, and so
 * pinned its 10×-low Florida rate ("$0.70/$1k") as the expected value
 * (best-in-class audit 2026-10-20). Transfer tax now comes from the one
 * canonical table (shared/regulatory/transferTax.ts, statute-checked in
 * transferTaxFromStatute.test.ts); these tests assert this module reports
 * what that table derives, by statute arithmetic, not by copying it.
 */

import { describe, it, expect } from "vitest";
import { getRecordingFees, estimateClosingCosts } from "../../server/services/countyRecordingFees";
import { estimateClosingCosts as estimateAllIn } from "../../server/services/closingCostEstimator";

describe("getRecordingFees — transfer tax comes from the canonical table", () => {
  it("FL is $7.00 per $1,000 ($0.70 per $100), not $0.70", () => {
    expect(getRecordingFees("FL", "Leon").transferTaxPer1000).toBe(7);
  });
  it("NV statewide is $3.90 per $1,000 ($1.95 per $500)", () => {
    expect(getRecordingFees("NV", "Lyon").transferTaxPer1000).toBe(3.9);
  });
  it("NV Clark is $5.10 per $1,000 ($2.55 per $500)", () => {
    expect(getRecordingFees("NV", "Clark").transferTaxPer1000).toBe(5.1);
  });
  it("MI includes the mandatory county piece: $7.50 + $1.10 = $8.60 per $1,000", () => {
    expect(getRecordingFees("MI", "Kent").transferTaxPer1000).toBe(8.6);
  });
  it("TX has none", () => {
    expect(getRecordingFees("TX", "Travis").transferTaxPer1000).toBe(0);
  });
  it("a graduated state has no single per-$1,000 figure and says why", () => {
    const wa = getRecordingFees("WA", "King");
    expect(wa.transferTaxPer1000).toBeNull();
    expect(wa.transferTaxRule).toMatch(/RCW 82\.45\.060/);
  });
  it("Miami-Dade carries no single per-$1,000 figure (class-dependent surtax)", () => {
    expect(getRecordingFees("FL", "Miami-Dade").transferTaxPer1000).toBeNull();
  });
  it("recording-fee lookup still resolves state defaults and county overrides", () => {
    expect(getRecordingFees("TX", "Harris").source).toBe("database");
    expect(getRecordingFees("TX", "Travis").source).toBe("database");
    expect(getRecordingFees("AZ", "Pima").source).toBe("state_default");
    expect(getRecordingFees("ZZ", "Nowhere").confidence).toBe("low");
  });
});

describe("estimateClosingCosts (recording-fees route)", () => {
  it("FL $100,000 transfer tax is $700 — 1,000 × $0.70 per $100", () => {
    expect(estimateClosingCosts(100_000, "FL", "Leon").transferTaxTotal).toBe(700);
  });
  it("a refused estimate is null, never 0", () => {
    expect(estimateClosingCosts(100_000, "NJ", "Morris").transferTaxTotal).toBeNull();
  });
  it("TX is 0 with no seller share", () => {
    const c = estimateClosingCosts(100_000, "TX", "Travis");
    expect(c.transferTaxTotal).toBe(0);
    expect(c.sellerResponsibility).toBe(0);
  });
});

describe("closingCostEstimator (all-in estimate)", () => {
  it("FL $100,000 transfer tax line is $700", () => {
    const e = estimateAllIn("FL", "Leon", 100_000);
    expect(e.transferTax).toBe(700);
    expect(e.breakdown.find((b) => b.item === "Transfer tax")?.source).toMatch(/201\.02/);
  });
  it("a refused state contributes nothing and says it was not estimated", () => {
    const e = estimateAllIn("NJ", "Morris", 100_000);
    expect(e.transferTax).toBe(0);
    expect(e.breakdown.find((b) => b.item === "Transfer tax")?.source).toMatch(/^Not estimated/);
  });
});
