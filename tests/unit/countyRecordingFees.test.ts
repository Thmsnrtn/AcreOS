/**
 * T269 — County Recording Fees Tests
 * Tests recording fee lookup, transfer tax calculation, and closing cost estimates.
 */

import { describe, it, expect } from "vitest";

// ─── Inline pure logic ────────────────────────────────────────────────────────

interface RecordingFeeInfo {
  state: string;
  county: string;
  recordingFeePerPage: number;
  typicalPages: number;
  estimatedRecordingFee: number;
  transferTaxRate: number;
  transferTaxPer1000: number;
  transferTaxPaidBy: "buyer" | "seller" | "split" | "none";
  specialNotes: string[];
  source: "database" | "state_default" | "estimate";
  confidence: "high" | "medium" | "low";
}

const STATE_TRANSFER_TAX: Record<string, { rate: number; paidBy: "buyer" | "seller" | "split" | "none" }> = {
  AZ: { rate: 0, paidBy: "none" },
  CA: { rate: 1.10, paidBy: "seller" },
  FL: { rate: 0.70, paidBy: "seller" },
  TX: { rate: 0, paidBy: "none" },
  NH: { rate: 15.00, paidBy: "split" },
  PA: { rate: 10.00, paidBy: "split" },
  WA: { rate: 17.78, paidBy: "seller" },
};

const STATE_RECORDING_FEE_PER_PAGE: Record<string, number> = {
  AZ: 15,
  CA: 21,
  FL: 10,
  TX: 36,
  NH: 25,
  PA: 77,
  WA: 203,
};

const COUNTY_OVERRIDES: Record<string, Partial<RecordingFeeInfo>> = {
  "CA|Los Angeles": {
    recordingFeePerPage: 21,
    transferTaxPer1000: 1.10,
    specialNotes: ["LA City adds additional 4.5% transfer tax on sales over $5M"],
  },
  "CA|San Francisco": {
    recordingFeePerPage: 21,
    transferTaxPer1000: 6.80,
    specialNotes: ["SF has tiered transfer tax up to $24.75/$1,000 for sales over $25M"],
  },
  "TX|Harris": {
    recordingFeePerPage: 35,
    specialNotes: ["No state transfer tax in Texas"],
  },
};

function getRecordingFees(state: string, county: string): RecordingFeeInfo {
  const stateUpper = state.toUpperCase().trim();
  const countyKey = `${stateUpper}|${county}`;
  const override = COUNTY_OVERRIDES[countyKey] || {};

  const stateTax = STATE_TRANSFER_TAX[stateUpper] ?? { rate: 0, paidBy: "none" as const };
  const feePerPage = override.recordingFeePerPage ?? STATE_RECORDING_FEE_PER_PAGE[stateUpper] ?? 20;
  const typicalPages = 3;
  const transferPer1000 = override.transferTaxPer1000 ?? stateTax.rate;

  const source: RecordingFeeInfo["source"] = override.recordingFeePerPage
    ? "database"
    : STATE_RECORDING_FEE_PER_PAGE[stateUpper]
    ? "state_default"
    : "estimate";

  const confidence: RecordingFeeInfo["confidence"] =
    source === "database" ? "high" : source === "state_default" ? "medium" : "low";

  return {
    state: stateUpper,
    county,
    recordingFeePerPage: feePerPage,
    typicalPages,
    estimatedRecordingFee: feePerPage * typicalPages,
    transferTaxRate: transferPer1000 / 1000,
    transferTaxPer1000: transferPer1000,
    transferTaxPaidBy: (override.transferTaxPaidBy as any) ?? stateTax.paidBy,
    specialNotes: override.specialNotes ?? [],
    source,
    confidence,
  };
}

function estimateClosingCosts(
  purchasePrice: number,
  state: string,
  county: string
): { recordingFee: number; transferTax: number; total: number } {
  const info = getRecordingFees(state, county);
  const transferTax = (purchasePrice / 1000) * info.transferTaxPer1000;
  return {
    recordingFee: info.estimatedRecordingFee,
    transferTax: Math.round(transferTax * 100) / 100,
    total: Math.round((info.estimatedRecordingFee + transferTax) * 100) / 100,
  };
}

function calculateBuyerVsSellerCosts(
  purchasePrice: number,
  state: string,
  county: string
): { buyerCosts: number; sellerCosts: number } {
  const info = getRecordingFees(state, county);
  const totalTransfer = (purchasePrice / 1000) * info.transferTaxPer1000;
  const recordingFee = info.estimatedRecordingFee;

  let buyerCosts = recordingFee; // buyer typically pays recording
  let sellerCosts = 0;

  if (info.transferTaxPaidBy === "seller") {
    sellerCosts += totalTransfer;
  } else if (info.transferTaxPaidBy === "buyer") {
    buyerCosts += totalTransfer;
  } else if (info.transferTaxPaidBy === "split") {
    buyerCosts += totalTransfer / 2;
    sellerCosts += totalTransfer / 2;
  }

  return { buyerCosts, sellerCosts };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("getRecordingFees", () => {
  it("returns state-level recording fee for TX general county", () => {
    const info = getRecordingFees("TX", "Bexar");
    expect(info.recordingFeePerPage).toBe(36);
    expect(info.typicalPages).toBe(3);
    expect(info.estimatedRecordingFee).toBe(108);
  });

  it("returns county-level override for TX Harris", () => {
    const info = getRecordingFees("TX", "Harris");
    expect(info.recordingFeePerPage).toBe(35);
    expect(info.source).toBe("database");
    expect(info.confidence).toBe("high");
  });

  it("returns 0 transfer tax for TX (no state transfer tax)", () => {
    const info = getRecordingFees("TX", "Bexar");
    expect(info.transferTaxRate).toBe(0);
    expect(info.transferTaxPaidBy).toBe("none");
  });

  it("returns correct CA transfer tax", () => {
    const info = getRecordingFees("CA", "Sacramento");
    expect(info.transferTaxPer1000).toBe(1.10);
    expect(info.transferTaxPaidBy).toBe("seller");
  });

  it("overrides transfer tax for CA San Francisco", () => {
    const info = getRecordingFees("CA", "San Francisco");
    expect(info.transferTaxPer1000).toBe(6.80);
    expect(info.specialNotes.length).toBeGreaterThan(0);
  });

  it("returns state_default source for known state", () => {
    const info = getRecordingFees("FL", "Hillsborough");
    expect(info.source).toBe("state_default");
    expect(info.confidence).toBe("medium");
  });

  it("returns estimate with low confidence for unknown state", () => {
    const info = getRecordingFees("ZZ", "Unknown");
    expect(info.source).toBe("estimate");
    expect(info.confidence).toBe("low");
    expect(info.recordingFeePerPage).toBe(20); // fallback
  });

  it("is case-insensitive for state", () => {
    const upper = getRecordingFees("TX", "Bexar");
    const lower = getRecordingFees("tx", "Bexar");
    expect(upper.recordingFeePerPage).toBe(lower.recordingFeePerPage);
  });
});

describe("estimateClosingCosts", () => {
  it("returns recording fee + transfer tax total for FL property", () => {
    // FL: $10/page × 3 = $30 recording; $0.70/$1k on $100k = $70 transfer
    const costs = estimateClosingCosts(100_000, "FL", "Orange");
    expect(costs.recordingFee).toBe(30);
    expect(costs.transferTax).toBe(70);
    expect(costs.total).toBe(100);
  });

  it("returns only recording fee for TX (no transfer tax)", () => {
    const costs = estimateClosingCosts(200_000, "TX", "Travis");
    expect(costs.transferTax).toBe(0);
    expect(costs.total).toBe(costs.recordingFee);
  });
});

describe("calculateBuyerVsSellerCosts", () => {
  it("assigns transfer tax to seller in CA", () => {
    const { buyerCosts, sellerCosts } = calculateBuyerVsSellerCosts(100_000, "CA", "Sacramento");
    // Buyer pays recording ($63), seller pays transfer ($110)
    expect(sellerCosts).toBeGreaterThan(0);
    expect(buyerCosts).toBeGreaterThan(0); // recording fee
  });

  it("splits transfer tax in PA", () => {
    const { buyerCosts, sellerCosts } = calculateBuyerVsSellerCosts(200_000, "PA", "Philadelphia");
    // Both pay half of transfer
    expect(buyerCosts).toBeGreaterThan(0);
    expect(sellerCosts).toBeGreaterThan(0);
  });

  it("seller pays 0 in TX (no transfer tax)", () => {
    const { sellerCosts } = calculateBuyerVsSellerCosts(500_000, "TX", "Bexar");
    expect(sellerCosts).toBe(0);
  });
});
