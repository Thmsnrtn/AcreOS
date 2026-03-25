/**
 * Legal Intelligence — adverse possession, partition risk, tax lien context, RESPA awareness.
 * Advisory only — never substitutes for legal counsel.
 */

import { logger } from "../utils/logger";

// ── Adverse Possession ──────────────────────────────────────────────

interface AdversePossessionInfo {
  state: string;
  yearsRequired: number;
  requiresGoodFaith: boolean;
  requiresTaxPayment: boolean;
  colorOfTitle: boolean;
  notes: string;
  riskLevel: "low" | "medium" | "high";
}

const ADVERSE_POSSESSION_DATA: Record<string, Omit<AdversePossessionInfo, "state" | "riskLevel">> = {
  TX: { yearsRequired: 10, requiresGoodFaith: false, requiresTaxPayment: true, colorOfTitle: true, notes: "3-year period with color of title, 5 with deed, 10 standard, 25 without title" },
  FL: { yearsRequired: 7, requiresGoodFaith: false, requiresTaxPayment: true, colorOfTitle: true, notes: "7 years with color of title and tax payment required" },
  AZ: { yearsRequired: 10, requiresGoodFaith: false, requiresTaxPayment: true, colorOfTitle: false, notes: "10 years continuous, open, notorious. 3 years with color of title" },
  CA: { yearsRequired: 5, requiresGoodFaith: false, requiresTaxPayment: true, colorOfTitle: false, notes: "5 years with tax payment. Must be open, notorious, continuous, hostile" },
  CO: { yearsRequired: 18, requiresGoodFaith: true, requiresTaxPayment: true, colorOfTitle: true, notes: "18 years standard, 7 with color of title and tax payment" },
  NM: { yearsRequired: 10, requiresGoodFaith: false, requiresTaxPayment: true, colorOfTitle: false, notes: "10 years continuous possession with tax payment" },
  NC: { yearsRequired: 20, requiresGoodFaith: false, requiresTaxPayment: false, colorOfTitle: true, notes: "20 years standard, 7 with color of title" },
  GA: { yearsRequired: 20, requiresGoodFaith: false, requiresTaxPayment: false, colorOfTitle: true, notes: "20 years standard, 7 under color of title" },
  OR: { yearsRequired: 10, requiresGoodFaith: false, requiresTaxPayment: false, colorOfTitle: false, notes: "10 years continuous, open, notorious, hostile, exclusive" },
  WA: { yearsRequired: 10, requiresGoodFaith: true, requiresTaxPayment: true, colorOfTitle: false, notes: "10 years with good faith and tax payment" },
  MI: { yearsRequired: 15, requiresGoodFaith: false, requiresTaxPayment: false, colorOfTitle: true, notes: "15 years standard, statutory period varies with color of title" },
  OH: { yearsRequired: 21, requiresGoodFaith: false, requiresTaxPayment: false, colorOfTitle: false, notes: "21 years — one of the longest periods in the US" },
  NY: { yearsRequired: 10, requiresGoodFaith: false, requiresTaxPayment: false, colorOfTitle: false, notes: "10 years. Must be actual, open, notorious, exclusive, continuous, hostile" },
};

export function getAdversePossessionInfo(state: string): AdversePossessionInfo {
  const data = ADVERSE_POSSESSION_DATA[state.toUpperCase()];
  if (!data) {
    return {
      state: state.toUpperCase(),
      yearsRequired: 10,
      requiresGoodFaith: false,
      requiresTaxPayment: false,
      colorOfTitle: false,
      notes: `Specific adverse possession data not available for ${state}. Consult local counsel.`,
      riskLevel: "medium",
    };
  }

  const riskLevel = data.yearsRequired <= 7 ? "high" : data.yearsRequired <= 15 ? "medium" : "low";
  return { state: state.toUpperCase(), ...data, riskLevel };
}

// ── Partition Risk ──────────────────────────────────────────────────

export interface PartitionRisk {
  hasMultipleOwners: boolean;
  partitionType: "in_kind" | "by_sale" | "unknown";
  riskLevel: "low" | "medium" | "high";
  flags: string[];
  recommendations: string[];
}

export function assessPartitionRisk(
  ownerCount: number,
  ownership: "sole" | "joint" | "tenants_in_common" | "unknown",
  hasHeirs?: boolean,
  isInherited?: boolean
): PartitionRisk {
  const flags: string[] = [];
  const recommendations: string[] = [];
  let riskLevel: "low" | "medium" | "high" = "low";
  let partitionType: "in_kind" | "by_sale" | "unknown" = "unknown";

  if (ownerCount > 1 || ownership === "tenants_in_common") {
    flags.push("Multiple owners detected — partition action possible");
    riskLevel = "medium";
    partitionType = "by_sale";

    if (ownerCount > 3) {
      flags.push("4+ owners significantly increases partition risk");
      riskLevel = "high";
    }

    recommendations.push("Verify all owners agree to the sale before closing");
    recommendations.push("Consider obtaining quitclaim deeds from all parties");
  }

  if (isInherited || hasHeirs) {
    flags.push("Inherited property — heirs may have undisclosed interests");
    if (riskLevel === "low") riskLevel = "medium";
    recommendations.push("Run a full title search to identify all heirs");
    recommendations.push("Check probate records for the county");
  }

  if (ownership === "joint") {
    partitionType = "in_kind";
    recommendations.push("Joint tenancy includes right of survivorship — verify with title");
  }

  if (flags.length === 0) {
    flags.push("No partition risk indicators detected");
    recommendations.push("Standard title insurance should suffice");
  }

  return { hasMultipleOwners: ownerCount > 1, partitionType, riskLevel, flags, recommendations };
}

// ── Tax Lien Context ────────────────────────────────────────────────

export interface TaxLienContext {
  state: string;
  redemptionPeriodMonths: number;
  interestRate: string;
  penaltyStructure: string;
  auctionType: "tax_lien" | "tax_deed" | "hybrid";
  investorConsiderations: string[];
}

const TAX_LIEN_DATA: Record<string, Omit<TaxLienContext, "state">> = {
  TX: { redemptionPeriodMonths: 6, interestRate: "25% penalty first year, 50% after", penaltyStructure: "Penalty-based", auctionType: "tax_deed", investorConsiderations: ["Texas is a tax deed state — no lien certificates", "Short 6-month redemption on non-homestead", "2-year redemption on homesteads"] },
  FL: { redemptionPeriodMonths: 24, interestRate: "Up to 18% annually", penaltyStructure: "Interest-based bid down", auctionType: "tax_lien", investorConsiderations: ["Florida is the largest tax lien market", "Bidding starts at 18% and goes down", "2-year redemption period before deed application"] },
  AZ: { redemptionPeriodMonths: 36, interestRate: "16% max", penaltyStructure: "Interest-based", auctionType: "tax_lien", investorConsiderations: ["3-year redemption period", "Must wait 3 years before applying for deed", "Investor responsible for subsequent taxes"] },
  CA: { redemptionPeriodMonths: 60, interestRate: "1.5% penalty per month", penaltyStructure: "Penalty-based", auctionType: "tax_deed", investorConsiderations: ["California is a tax deed state", "5-year default period before sale", "Properties sell at public auction"] },
  GA: { redemptionPeriodMonths: 12, interestRate: "20% premium", penaltyStructure: "Premium-based", auctionType: "hybrid", investorConsiderations: ["Redemption period is 12 months", "20% premium added at redemption", "Must notify owner of right to redeem"] },
  CO: { redemptionPeriodMonths: 36, interestRate: "9-12%", penaltyStructure: "Interest-based", auctionType: "tax_lien", investorConsiderations: ["3-year redemption", "Interest rates vary by county", "Must apply for treasurer's deed after redemption expires"] },
  NC: { redemptionPeriodMonths: 0, interestRate: "N/A — direct sale", penaltyStructure: "None", auctionType: "tax_deed", investorConsiderations: ["North Carolina sells tax deeds directly", "No redemption period after sale", "Winning bidder receives fee simple title"] },
};

export function getTaxLienContext(state: string): TaxLienContext {
  const data = TAX_LIEN_DATA[state.toUpperCase()];
  if (!data) {
    return {
      state: state.toUpperCase(),
      redemptionPeriodMonths: 12,
      interestRate: "Varies",
      penaltyStructure: "Unknown",
      auctionType: "hybrid",
      investorConsiderations: [`Specific tax lien data not available for ${state}. Research county procedures.`],
    };
  }
  return { state: state.toUpperCase(), ...data };
}

// ── RESPA Awareness ─────────────────────────────────────────────────

export interface RespaCheck {
  applicable: boolean;
  requirements: string[];
  warnings: string[];
  exemptions: string[];
}

export function checkRespaApplicability(
  isSellerFinanced: boolean,
  hasMortgage: boolean,
  isResidential: boolean,
  numberOfUnits?: number
): RespaCheck {
  const requirements: string[] = [];
  const warnings: string[] = [];
  const exemptions: string[] = [];

  // RESPA applies to federally-related mortgage loans on residential properties
  const applicable = (hasMortgage && isResidential) || (isSellerFinanced && isResidential && (numberOfUnits || 0) <= 4);

  if (!applicable) {
    exemptions.push("RESPA generally does not apply to commercial land transactions");
    exemptions.push("Cash purchases without mortgage involvement are typically exempt");
    if (!isResidential) {
      exemptions.push("Non-residential land purchases are generally exempt from RESPA");
    }
    return { applicable, requirements, warnings, exemptions };
  }

  requirements.push("Good Faith Estimate (GFE) must be provided within 3 business days of loan application");
  requirements.push("HUD-1 Settlement Statement required at closing");
  requirements.push("No kickbacks or referral fees between settlement service providers (Section 8)");
  requirements.push("Escrow account limitations — cannot require excessive deposits (Section 10)");

  if (isSellerFinanced) {
    warnings.push("Seller-financed transactions with 1-4 residential units may trigger RESPA requirements");
    warnings.push("Dodd-Frank safe harbor: ≤3 seller-financed transactions per year for non-dealers");
    requirements.push("Loan originator licensing may be required depending on state and volume");
  }

  if (hasMortgage) {
    requirements.push("Servicing transfer notices required within 15 days (Section 6)");
    warnings.push("Affiliated business arrangements must be disclosed with estimated charges");
  }

  return { applicable, requirements, warnings, exemptions };
}
