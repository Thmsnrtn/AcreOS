/**
 * Closing Cost Estimator — all-in cost visibility for land deals.
 * Pulls from countyRecordingFees + stateDocumentConfig for real data,
 * estimates title insurance and prorated taxes.
 */

import { getRecordingFees } from "./countyRecordingFees";
import { STATE_DOCUMENT_CONFIGS } from "./stateDocumentConfig";

export interface ClosingCostEstimate {
  recordingFee: number;
  transferTax: number;
  titleInsuranceEstimate: number;
  proratedTaxes: number;
  totalEstimated: number;
  breakdown: { item: string; amount: number; source: string }[];
  disclaimer: string;
}

export function estimateClosingCosts(
  state: string,
  county: string,
  salePrice: number,
  annualTax?: number,
  closingDate?: Date
): ClosingCostEstimate {
  const safePrice = Math.max(0, salePrice || 0);
  const feeInfo = getRecordingFees(state, county);
  const stateConfig = STATE_DOCUMENT_CONFIGS[state.toUpperCase()];

  const recordingFee = feeInfo.estimatedRecordingFee;

  // Transfer tax from recording fees service (already has state+county data)
  const transferTax = Math.round((safePrice / 1000) * feeInfo.transferTaxPer1000);

  // Title insurance rough estimate — 0.5% of sale price
  const titleInsuranceEstimate = Math.round(safePrice * 0.005);

  // Prorated taxes: annual tax ÷ 365 × days remaining in year
  let proratedTaxes = 0;
  if (annualTax && annualTax > 0) {
    const closing = closingDate || new Date();
    const endOfYear = new Date(closing.getFullYear(), 11, 31);
    const daysRemaining = Math.max(
      0,
      Math.ceil((endOfYear.getTime() - closing.getTime()) / (1000 * 60 * 60 * 24))
    );
    proratedTaxes = Math.round((annualTax / 365) * daysRemaining);
  }

  const breakdown: ClosingCostEstimate["breakdown"] = [
    {
      item: "Recording fee",
      amount: recordingFee,
      source: `${feeInfo.source} — ${feeInfo.recordingFeePerPage}/page × ${feeInfo.typicalPages} pages`,
    },
    {
      item: "Transfer tax",
      amount: transferTax,
      source: feeInfo.transferTaxPer1000 > 0
        ? `$${feeInfo.transferTaxPer1000}/$1,000 — paid by ${feeInfo.transferTaxPaidBy}`
        : `No transfer tax in ${state.toUpperCase()}`,
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
    breakdown.push({
      item: "Attorney closing requirement",
      amount: 0,
      source: `${stateConfig.stateName} requires attorney at closing — budget $500–$1,500`,
    });
  }

  const totalEstimated = recordingFee + transferTax + titleInsuranceEstimate + proratedTaxes;

  return {
    recordingFee,
    transferTax,
    titleInsuranceEstimate,
    proratedTaxes,
    totalEstimated,
    breakdown,
    disclaimer:
      "These are estimates based on public data. Actual closing costs vary by title company, attorney fees, and county-specific requirements. Consult your closing agent for exact figures.",
  };
}
