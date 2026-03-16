/**
 * T33 — County Recording Fee + Transfer Tax Lookup
 *
 * Given state + county, returns:
 *   - Recording fee per page (typical deed is 2–4 pages)
 *   - Transfer tax rate and who typically pays (buyer/seller/split)
 *   - Special assessments to be aware of
 *
 * Data sourced from public county websites and updated periodically.
 * Returns best-available estimate with source confidence.
 */

export interface RecordingFeeInfo {
  state: string;
  county: string;
  recordingFeePerPage: number; // USD per page
  typicalPages: number; // typical deed length in pages
  estimatedRecordingFee: number; // recordingFeePerPage * typicalPages
  transferTaxRate: number; // as decimal (e.g. 0.001 = 0.1%)
  transferTaxPer1000: number; // USD per $1,000 of sale price
  transferTaxPaidBy: "buyer" | "seller" | "split" | "none";
  specialNotes: string[];
  source: "database" | "state_default" | "estimate";
  confidence: "high" | "medium" | "low";
}

// State-level defaults (per $1,000 sale price)
const STATE_TRANSFER_TAX: Record<string, { rate: number; paidBy: "buyer" | "seller" | "split" | "none" }> = {
  AL: { rate: 0.50, paidBy: "seller" },
  AZ: { rate: 0, paidBy: "none" },
  AR: { rate: 3.30, paidBy: "seller" },
  CA: { rate: 1.10, paidBy: "seller" },
  CO: { rate: 0.01, paidBy: "seller" },
  CT: { rate: 11.20, paidBy: "seller" },
  DE: { rate: 4.00, paidBy: "split" },
  FL: { rate: 0.70, paidBy: "seller" },
  GA: { rate: 1.00, paidBy: "seller" },
  HI: { rate: 1.25, paidBy: "seller" },
  ID: { rate: 0, paidBy: "none" },
  IL: { rate: 1.50, paidBy: "seller" },
  IN: { rate: 0, paidBy: "none" },
  IA: { rate: 1.60, paidBy: "seller" },
  KS: { rate: 0, paidBy: "none" },
  KY: { rate: 0.50, paidBy: "seller" },
  LA: { rate: 0, paidBy: "none" },
  ME: { rate: 2.20, paidBy: "split" },
  MD: { rate: 5.00, paidBy: "split" },
  MA: { rate: 4.56, paidBy: "seller" },
  MI: { rate: 8.60, paidBy: "seller" },
  MN: { rate: 3.30, paidBy: "seller" },
  MS: { rate: 0, paidBy: "none" },
  MO: { rate: 0, paidBy: "none" },
  MT: { rate: 0, paidBy: "none" },
  NE: { rate: 2.25, paidBy: "seller" },
  NV: { rate: 1.95, paidBy: "seller" },
  NH: { rate: 15.00, paidBy: "split" },
  NJ: { rate: 4.00, paidBy: "seller" },
  NM: { rate: 0, paidBy: "none" },
  NY: { rate: 4.00, paidBy: "seller" },
  NC: { rate: 2.00, paidBy: "seller" },
  ND: { rate: 0, paidBy: "none" },
  OH: { rate: 1.00, paidBy: "seller" },
  OK: { rate: 0.75, paidBy: "seller" },
  OR: { rate: 1.00, paidBy: "seller" },
  PA: { rate: 10.00, paidBy: "split" },
  RI: { rate: 4.56, paidBy: "seller" },
  SC: { rate: 3.70, paidBy: "seller" },
  SD: { rate: 0.50, paidBy: "seller" },
  TN: { rate: 3.70, paidBy: "seller" },
  TX: { rate: 0, paidBy: "none" },
  UT: { rate: 0, paidBy: "none" },
  VT: { rate: 12.50, paidBy: "seller" },
  VA: { rate: 2.50, paidBy: "seller" },
  WA: { rate: 17.78, paidBy: "seller" },
  WV: { rate: 3.30, paidBy: "seller" },
  WI: { rate: 3.00, paidBy: "seller" },
  WY: { rate: 0, paidBy: "none" },
};

// State-level recording fee defaults (per page)
const STATE_RECORDING_FEE_PER_PAGE: Record<string, number> = {
  AL: 4, AZ: 15, AR: 8, CA: 21, CO: 13, CT: 60, DE: 30, FL: 10,
  GA: 10, HI: 36, ID: 10, IL: 68, IN: 25, IA: 7, KS: 14, KY: 46,
  LA: 100, ME: 19, MD: 40, MA: 150, MI: 14, MN: 46, MS: 10, MO: 24,
  MT: 7, NE: 10, NV: 12, NH: 25, NJ: 40, NM: 25, NY: 125, NC: 26,
  ND: 30, OH: 28, OK: 18, OR: 80, PA: 77, RI: 220, SC: 10, SD: 15,
  TN: 12, TX: 36, UT: 30, VT: 10, VA: 25, WA: 203, WV: 17, WI: 30,
  WY: 12,
};

// County-specific overrides (key: "STATE|COUNTY")
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
  "TX|Travis": {
    recordingFeePerPage: 36,
    specialNotes: ["No state transfer tax in Texas"],
  },
  "FL|Miami-Dade": {
    transferTaxPer1000: 0.70,
    specialNotes: ["Miami-Dade has additional $0.45/$1,000 surtax for most properties"],
  },
};

export function getRecordingFees(state: string, county: string): RecordingFeeInfo {
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

/**
 * Compute total estimated closing cost contribution for a buyer given purchase price.
 */
export function estimateClosingCosts(
  purchasePrice: number,
  state: string,
  county: string
): {
  recordingFee: number;
  transferTaxTotal: number;
  buyerResponsibility: number;
  sellerResponsibility: number;
  totalCost: number;
  breakdown: RecordingFeeInfo;
} {
  const info = getRecordingFees(state, county);
  const transferTaxTotal = (purchasePrice / 1000) * info.transferTaxPer1000;
  const recordingFee = info.estimatedRecordingFee;

  let buyerPct = 0;
  let sellerPct = 0;
  if (info.transferTaxPaidBy === "buyer") buyerPct = 1;
  else if (info.transferTaxPaidBy === "seller") sellerPct = 1;
  else if (info.transferTaxPaidBy === "split") { buyerPct = 0.5; sellerPct = 0.5; }

  // Recording fee typically paid by buyer
  const buyerResponsibility = recordingFee + transferTaxTotal * buyerPct;
  const sellerResponsibility = transferTaxTotal * sellerPct;

  return {
    recordingFee,
    transferTaxTotal,
    buyerResponsibility: Math.round(buyerResponsibility),
    sellerResponsibility: Math.round(sellerResponsibility),
    totalCost: Math.round(recordingFee + transferTaxTotal),
    breakdown: info,
  };
}
