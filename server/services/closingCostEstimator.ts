/**
 * Closing Cost Estimator — all-in cost visibility for land deals.
 * Pulls from countyRecordingFees + stateDocumentConfig for real data,
 * estimates title insurance and prorated taxes.
 */

import { getRecordingFees } from "./countyRecordingFees";
import { estimateTransferTax, isoDateOf, type PropertyClass } from "@shared/regulatory/transferTax";
import { STATE_DOCUMENT_CONFIGS } from "./stateDocumentConfig";
import { clock } from "../utils/clock";

export interface ClosingCostEstimate {
  recordingFee: number;
  /**
   * null when the canonical table refuses to estimate (the reason is in the
   * "Transfer tax" breakdown item and in totalExcludes). NEVER 0 for a
   * refusal — 0 reads as "no tax".
   */
  transferTax: number | null;
  titleInsuranceEstimate: number;
  proratedTaxes: number;
  /** Sum of the items that WERE estimated. See totalExcludes for what it leaves out. */
  totalEstimated: number;
  /** Items NOT in totalEstimated, with why (e.g. "Transfer tax — not estimated: …"). Empty when complete. */
  totalExcludes: string[];
  /** amount null = not estimated; the reason is in `source`. */
  breakdown: { item: string; amount: number | null; source: string }[];
  disclaimer: string;
}

export function estimateClosingCosts(
  state: string,
  county: string,
  salePrice: number,
  annualTax?: number,
  closingDate?: Date,
  propertyClass?: PropertyClass,
): ClosingCostEstimate {
  const safePrice = Math.max(0, salePrice || 0);
  const feeInfo = getRecordingFees(state, county);
  const stateConfig = STATE_DOCUMENT_CONFIGS[state.toUpperCase()];

  const recordingFee = feeInfo.estimatedRecordingFee;

  // Transfer tax from the one canonical table. A refused estimate is null —
  // excluded from the total, which then says it excludes it — never "$0 tax".
  const tt = estimateTransferTax(state, safePrice, {
    county,
    propertyClass,
    asOfIsoDate: isoDateOf(closingDate ?? clock.now()),
  });
  const transferTax: number | null =
    tt.kind === "estimate" ? Math.round(tt.amountCents / 100) : tt.kind === "none" ? 0 : null;

  // Title insurance rough estimate — 0.5% of sale price
  const titleInsuranceEstimate = Math.round(safePrice * 0.005);

  // Prorated taxes: annual tax ÷ 365 × days remaining in year
  let proratedTaxes = 0;
  if (annualTax && annualTax > 0) {
    const closing = closingDate || clock.now();
    const endOfYear = new Date(closing.getFullYear(), 11, 31);
    const daysRemaining = Math.max(
      0,
      Math.ceil((endOfYear.getTime() - closing.getTime()) / (1000 * 60 * 60 * 24))
    );
    proratedTaxes = Math.round((annualTax / 365) * daysRemaining);
  }

  const totalExcludes: string[] = [];
  if (tt.kind === "refused") totalExcludes.push(`Transfer tax — not estimated: ${tt.reason}`);
  else if (tt.kind === "estimate" && tt.excludesLocal) totalExcludes.push(`Local transfer taxes — ${tt.excludesLocal}`);

  const breakdown: ClosingCostEstimate["breakdown"] = [
    {
      item: "Recording fee",
      amount: recordingFee,
      source: `${feeInfo.source} — ${feeInfo.recordingFeePerPage}/page × ${feeInfo.typicalPages} pages`,
    },
    {
      item: "Transfer tax",
      amount: transferTax,
      source: tt.kind === "estimate"
        ? `${tt.statutoryUnit} (${tt.citation}) — customarily paid by ${tt.customaryPayer}${tt.excludesLocal ? `; excludes ${tt.excludesLocal}` : ""}`
        : tt.kind === "none"
        ? `No transfer tax in ${state.toUpperCase()} (${tt.citation})`
        : `Not estimated: ${tt.reason}`,
    },
    {
      item: "Title insurance (estimate)",
      amount: titleInsuranceEstimate,
      source: "Estimate — actual costs vary by title company",
    },
  ];

  if (proratedTaxes > 0) {
    breakdown.push({
      item: "Prorated property taxes",
      amount: proratedTaxes,
      source: `$${annualTax}/year prorated from closing to year-end`,
    });
  }

  // Add state-specific notes
  if (stateConfig?.attorneyStateForClosing) {
    // No figure: an attorney's fee is quoted, not computed. null (not $0),
    // and the total says it leaves it out.
    breakdown.push({
      item: "Attorney closing requirement",
      amount: null,
      source: `${stateConfig.stateName} requires attorney at closing — budget $500–$1,500`,
    });
    totalExcludes.push(`Attorney closing fee — ${stateConfig.stateName} requires an attorney at closing; budget $500–$1,500`);
  }

  // Only estimated items are summed; a refused (null) item is listed in
  // totalExcludes instead of being counted as zero.
  const totalEstimated = [recordingFee, transferTax, titleInsuranceEstimate, proratedTaxes]
    .reduce<number>((t, x) => (x === null ? t : t + x), 0);

  return {
    recordingFee,
    transferTax,
    titleInsuranceEstimate,
    proratedTaxes,
    totalEstimated,
    totalExcludes,
    breakdown,
    disclaimer:
      "These are estimates based on public data. Actual closing costs vary by title company, attorney fees, and county-specific requirements. Consult your closing agent for exact figures.",
  };
}
