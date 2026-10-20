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

import {
  describeTransferTax,
  estimateTransferTax,
  isoDateOf,
  per1000,
  transferTaxRuleFor,
  type CustomaryPayer,
  type PropertyClass,
} from "@shared/regulatory/transferTax";
import { clock } from "../utils/clock";

export interface RecordingFeeInfo {
  state: string;
  county: string;
  recordingFeePerPage: number; // USD per page
  typicalPages: number; // typical deed length in pages
  estimatedRecordingFee: number; // recordingFeePerPage * typicalPages
  /**
   * USD per $1,000 of consideration when ONE statewide/county rate applies;
   * null when the tax is graduated, class-dependent, local-only, or refused
   * (see transferTaxRule for why).
   */
  transferTaxPer1000: number | null;
  /** The statutory rule in words, with citation, from the canonical table. */
  transferTaxRule: string;
  transferTaxPaidBy: CustomaryPayer;
  specialNotes: string[];
  source: "database" | "state_default" | "estimate";
  confidence: "high" | "medium" | "low";
}

// Transfer tax is NOT in this file. It is read from
// shared/regulatory/transferTax.ts, the one table every caller uses
// (best-in-class audit 2026-10-20). This file's old STATE_TRANSFER_TAX map
// was labelled "per $1,000" while holding per-$100 and per-$500 figures
// (FL 0.70, NV 1.95, AL 0.50, …) and disagreed with the contract generator.

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
    specialNotes: ["The City of Los Angeles levies its own transfer tax (plus Measure ULA above its thresholds) on top of the county rate"],
  },
  "CA|San Francisco": {
    recordingFeePerPage: 21,
    specialNotes: ["San Francisco levies its own tiered transfer tax in place of the county rate; confirm with the Assessor-Recorder"],
  },
  "TX|Harris": {
    recordingFeePerPage: 35,
    specialNotes: ["No state transfer tax in Texas"],
  },
  "TX|Travis": {
    recordingFeePerPage: 36,
    specialNotes: ["No state transfer tax in Texas"],
  },
  // Miami-Dade's class-dependent rate is NOT restated here: transferTaxRule
  // (describeTransferTax with the county) already carries it from the one
  // table, and a second copy of a rate is how the tables drifted.
};

export function getRecordingFees(state: string, county: string): RecordingFeeInfo {
  const stateUpper = state.toUpperCase().trim();
  const countyKey = `${stateUpper}|${county}`;
  const override = COUNTY_OVERRIDES[countyKey] || {};

  const rule = transferTaxRuleFor(stateUpper, county);
  const feePerPage = override.recordingFeePerPage ?? STATE_RECORDING_FEE_PER_PAGE[stateUpper] ?? 20;
  const typicalPages = 3;
  const transferPer1000 =
    rule?.kind === "none" ? 0
    : rule?.kind === "flat" && rule.rate ? per1000(rule.rate) + (rule.addOns ?? []).reduce((t, a) => t + per1000(a), 0)
    : null;

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
    transferTaxPer1000: transferPer1000,
    transferTaxRule: describeTransferTax(stateUpper, county),
    transferTaxPaidBy: rule?.customaryPayer ?? "varies",
    specialNotes: override.specialNotes ?? [],
    source,
    confidence,
  };
}

/**
 * Compute total estimated closing cost contribution for a buyer given purchase price.
 *
 * A refused transfer tax is null everywhere it appears — the total, the
 * buyer's share and the seller's share leave it OUT and `totalExcludes` says
 * so. A "varies" payer is not assigned to either side: the tax is in
 * `unallocatedTransferTax`, not silently dropped from both.
 */
export function estimateClosingCosts(
  purchasePrice: number,
  state: string,
  county: string,
  opts: { propertyClass?: PropertyClass; asOfIsoDate?: string } = {},
): {
  recordingFee: number;
  /** null when the canonical table refuses to estimate (see transferTaxRefusal). */
  transferTaxTotal: number | null;
  /** Why the transfer tax was not estimated; null when it was (or there is none). */
  transferTaxRefusal: string | null;
  transferTaxExcludesLocal: string | null;
  /** null when the transfer tax is refused (the share cannot be known). */
  buyerResponsibility: number | null;
  /** null when the transfer tax is refused. */
  sellerResponsibility: number | null;
  /** Transfer tax whose payer is negotiated ("varies"), in neither side's share; null when refused. */
  unallocatedTransferTax: number | null;
  /** Sum of what WAS estimated. */
  totalCost: number;
  /** What totalCost leaves out, in words. Empty when complete. */
  totalExcludes: string[];
  breakdown: RecordingFeeInfo;
} {
  const info = getRecordingFees(state, county);
  const est = estimateTransferTax(state, purchasePrice, {
    county,
    propertyClass: opts.propertyClass,
    asOfIsoDate: opts.asOfIsoDate ?? isoDateOf(clock.now()),
  });
  // A refused estimate is null, never 0 — 0 would read as "no tax".
  const transferTaxTotal: number | null =
    est.kind === "estimate" ? est.amountCents / 100 : est.kind === "none" ? 0 : null;
  const recordingFee = info.estimatedRecordingFee;

  let buyerPct = 0;
  let sellerPct = 0;
  let unallocatedPct = 0;
  if (info.transferTaxPaidBy === "buyer") buyerPct = 1;
  else if (info.transferTaxPaidBy === "seller") sellerPct = 1;
  else if (info.transferTaxPaidBy === "split") { buyerPct = 0.5; sellerPct = 0.5; }
  else if (info.transferTaxPaidBy === "varies") unallocatedPct = 1;

  const totalExcludes: string[] = [];
  if (est.kind === "refused") totalExcludes.push(`Transfer tax — not estimated: ${est.reason}`);
  else if (est.kind === "estimate" && est.excludesLocal) totalExcludes.push(`Local transfer taxes — ${est.excludesLocal}`);

  // Recording fee typically paid by buyer
  const buyerResponsibility = transferTaxTotal === null ? null : Math.round(recordingFee + transferTaxTotal * buyerPct);
  const sellerResponsibility = transferTaxTotal === null ? null : Math.round(transferTaxTotal * sellerPct);

  return {
    recordingFee,
    transferTaxTotal,
    transferTaxRefusal: est.kind === "refused" ? est.reason : null,
    transferTaxExcludesLocal: est.kind === "estimate" ? est.excludesLocal : null,
    buyerResponsibility,
    sellerResponsibility,
    unallocatedTransferTax: transferTaxTotal === null ? null : Math.round(transferTaxTotal * unallocatedPct),
    totalCost: Math.round(transferTaxTotal === null ? recordingFee : recordingFee + transferTaxTotal),
    totalExcludes,
    breakdown: info,
  };
}
