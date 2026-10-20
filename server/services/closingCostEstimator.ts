/**
 * Closing Cost Estimator — all-in cost visibility for land deals.
 * Pulls from countyRecordingFees + stateDocumentConfig for real data,
 * estimates title insurance and prorated taxes.
 */

import { getRecordingFees } from "./countyRecordingFees";
import { estimateTransferTax } from "@shared/regulatory/transferTax";
import { STATE_DOCUMENT_CONFIGS } from "./stateDocumentConfig";
import { clock } from "../utils/clock";

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

  // Transfer tax from the one canonical table. A refused estimate contributes
  // nothing to the total and says why, rather than reading as "$0 tax".
  const tt = estimateTransferTax(state, safePrice, { county, asOfIsoDate: closingDate ? closingDate.toISOString().slice(0, 10) : undefined });
  const transferTax = tt.kind === "estimate" ? Math.round(tt.amountCents / 100) : 0;

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
