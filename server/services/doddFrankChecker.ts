/**
 * Dodd-Frank Seller Financing Compliance Checker
 *
 * The Dodd-Frank Wall Street Reform Act (2010) added Title XIV, which requires
 * loan originators to be licensed under the SAFE Act. However, there are
 * seller-financing exemptions under CFPB Reg Z:
 *
 * Exemption 1: "3-property safe harbor" (12 CFR 1026.36(a)(4)(i))
 *   - Seller finances no more than 3 properties per 12-month period
 *   - Each financed property is a "dwelling" (includes manufactured/land-home)
 *   - Seller did NOT construct the property
 *
 * Exemption 2: "1-property natural person" (12 CFR 1026.36(a)(4)(ii))
 *   - Seller is a natural person, estate, or trust (not an LLC/corp)
 *   - Finances only 1 property per 12-month period
 *   - Property is the seller's primary or secondary residence
 *   - No balloon payment < 5 years
 *   - Rate is fixed or does not increase in the first 5 years
 *
 * For LAND (non-dwelling), CFPB Reg Z and TILA generally do NOT apply
 * because land without a dwelling is not a "residential mortgage transaction."
 * However, when a manufactured home or existing structure is on the land,
 * the rules may apply. This checker provides guidance, not legal advice.
 *
 * References:
 *   - 12 CFR Part 1026 (Regulation Z)
 *   - CFPB Dodd-Frank owner-financing guidance
 *   - SAFE Act (12 U.S.C. 5102)
 */

export interface DoddFrankInput {
  /** Number of seller-financed transactions in the past 12 months (including this one) */
  sellerFinancedDealsLast12Months: number;
  /** Is the seller a natural person (individual) or an entity (LLC/Corp/Trust)? */
  sellerType: 'natural_person' | 'entity' | 'estate_or_trust';
  /** Does the subject property have a dwelling (house, manufactured home)? */
  hasDwelling: boolean;
  /** Did the seller construct the dwelling themselves? */
  sellerConstructedDwelling: boolean;
  /** Is the property the seller's primary or secondary residence? */
  isSellerResidence: boolean;
  /** Loan term in months */
  loanTermMonths: number;
  /** Interest rate type */
  rateType: 'fixed' | 'adjustable' | 'balloon_under_5yr' | 'balloon_5yr_plus';
  /** Balloon payment? If yes, after how many months? */
  balloonAfterMonths?: number;
  /** Annual interest rate (as a decimal, e.g. 0.12 for 12%) */
  interestRate: number;
}

export type ComplianceRisk = 'compliant' | 'review_needed' | 'likely_violation' | 'attorney_required';

export interface DoddFrankCheckResult {
  risk: ComplianceRisk;
  exemptionApplicable?: '3_property' | '1_property_natural_person' | 'non_dwelling_land' | 'none';
  /** Summary verdict */
  summary: string;
  /** Ordered list of findings */
  findings: Array<{
    issue: string;
    detail: string;
    severity: 'info' | 'warning' | 'critical';
  }>;
  /** Recommended actions */
  recommendations: string[];
  /** Does this deal require a licensed mortgage loan originator (MLO)? */
  requiresLicensedMLO: boolean;
}

/**
 * Run Dodd-Frank seller financing compliance check for a proposed deal.
 */
export function checkDoddFrankCompliance(input: DoddFrankInput): DoddFrankCheckResult {
  const findings: DoddFrankCheckResult['findings'] = [];
  const recommendations: string[] = [];

  // Case 1: Pure land (no dwelling) — TILA/Dodd-Frank generally does NOT apply
  if (!input.hasDwelling) {
    findings.push({
      issue: 'Non-dwelling land transaction',
      detail: 'CFPB Regulation Z and Dodd-Frank Title XIV generally do not apply to land-only sales without a residential dwelling. This is not a "residential mortgage transaction" under 12 CFR 1026.2(a)(24).',
      severity: 'info',
    });

    recommendations.push(
      'Verify the property has no dwelling, manufactured home, or structure that could be considered a residence.',
      'Even for land-only deals, consult your state attorney for any applicable state usury or seller-financing disclosure laws.',
      'If a dwelling will be placed on the land by the buyer, seek additional legal review.'
    );

    return {
      risk: 'compliant',
      exemptionApplicable: 'non_dwelling_land',
      summary: 'This appears to be a land-only transaction. Federal Dodd-Frank seller-financing rules generally do not apply. Verify no dwelling exists and review applicable state laws.',
      findings,
      recommendations,
      requiresLicensedMLO: false,
    };
  }

  // Case 2: Has a dwelling — apply Dodd-Frank seller-financing exemptions
  let requiresMLO = true;
  let applicableExemption: DoddFrankCheckResult['exemptionApplicable'] = 'none';

  // Check 3-property exemption
  if (input.sellerFinancedDealsLast12Months <= 3 && !input.sellerConstructedDwelling) {
    applicableExemption = '3_property';
    requiresMLO = false;

    findings.push({
      issue: '3-Property Exemption',
      detail: `Seller has financed ${input.sellerFinancedDealsLast12Months} property(s) in the past 12 months (limit: 3). The property was not constructed by the seller. The 3-property exemption under 12 CFR 1026.36(a)(4)(i) appears to apply.`,
      severity: 'info',
    });

    // Even under this exemption, there are still requirements
    if (input.rateType === 'adjustable') {
      findings.push({
        issue: 'Adjustable Rate — Additional disclosure required',
        detail: 'Even under the 3-property exemption, adjustable-rate seller-financed mortgages may require additional disclosures and cannot have certain prepayment penalties.',
        severity: 'warning',
      });
      recommendations.push('Have a real estate attorney draft the adjustable-rate seller-finance note with proper TILA disclosures.');
    }
  } else if (input.sellerFinancedDealsLast12Months > 3) {
    findings.push({
      issue: '3-Property Limit Exceeded',
      detail: `Seller has financed ${input.sellerFinancedDealsLast12Months} properties in the past 12 months. The 3-property exemption does NOT apply when more than 3 properties per year are seller-financed.`,
      severity: 'critical',
    });
  }

  // Check 1-property natural person exemption (even stricter)
  if (applicableExemption === 'none' && input.sellerType === 'natural_person') {
    if (input.sellerFinancedDealsLast12Months <= 1 && input.isSellerResidence) {
      if (input.rateType === 'fixed' || input.rateType === 'balloon_5yr_plus') {
        if (!input.balloonAfterMonths || input.balloonAfterMonths >= 60) {
          applicableExemption = '1_property_natural_person';
          requiresMLO = false;
          findings.push({
            issue: '1-Property Natural Person Exemption',
            detail: 'Seller is a natural person, financed ≤1 property in 12 months, property is seller\'s residence, and note terms satisfy the balloon/rate requirements. Exemption under 12 CFR 1026.36(a)(4)(ii) appears to apply.',
            severity: 'info',
          });
        }
      }
    }
  }

  // Entity seller — additional scrutiny
  if (input.sellerType === 'entity') {
    findings.push({
      issue: 'Entity Seller — Reduced Exemption Eligibility',
      detail: 'The 1-property natural person exemption does NOT apply to entities (LLC, corporation). Only the 3-property exemption may be available if deal count qualifies.',
      severity: 'warning',
    });
    recommendations.push('If the selling entity is an LLC, consider whether a licensed MLO is needed or restructure as a land contract in a state where that is permissible without licensing.');
  }

  // Balloon payment check
  if (input.balloonAfterMonths && input.balloonAfterMonths < 60) {
    findings.push({
      issue: 'Balloon Payment Under 5 Years',
      detail: `A balloon payment in less than 60 months (${input.balloonAfterMonths} months) disqualifies the 1-property natural person exemption and may violate qualified mortgage rules.`,
      severity: 'warning',
    });
    recommendations.push('Consider extending the balloon period to 60+ months to preserve exemption eligibility.');
  }

  // Rate check — above 10% triggers higher-priced mortgage scrutiny
  if (input.interestRate > 0.10) {
    findings.push({
      issue: 'High Interest Rate — HPML Threshold',
      detail: `Rate of ${(input.interestRate * 100).toFixed(1)}% may exceed the Higher-Priced Mortgage Loan (HPML) threshold (APOR + 1.5%). HPMLs have additional appraisal and escrow requirements.`,
      severity: 'warning',
    });
    recommendations.push('Verify current APOR (Average Prime Offer Rate) from FFIEC to determine if rate triggers HPML requirements.');
  }

  // Seller constructed the property
  if (input.sellerConstructedDwelling) {
    findings.push({
      issue: 'Seller-Constructed Dwelling',
      detail: 'When the seller constructed the dwelling, the 3-property exemption does NOT apply. A licensed mortgage loan originator is required.',
      severity: 'critical',
    });
    requiresMLO = true;
  }

  // Final risk assessment
  let risk: ComplianceRisk;
  const criticals = findings.filter(f => f.severity === 'critical').length;
  const warnings = findings.filter(f => f.severity === 'warning').length;

  if (requiresMLO || criticals > 0) {
    risk = 'likely_violation';
    recommendations.push('IMPORTANT: Consult a licensed real estate attorney before proceeding with this seller-financed transaction.');
    recommendations.push('Consider using a licensed mortgage loan originator (MLO) to originate the loan, even if an exemption may apply.');
  } else if (warnings > 0) {
    risk = 'review_needed';
    recommendations.push('Have a real estate attorney review the note and seller-finance structure before closing.');
  } else {
    risk = 'compliant';
    recommendations.push('Document the exemption basis in your deal file. Keep a running count of seller-financed deals to stay within the annual limit.');
  }

  const summary = risk === 'compliant'
    ? `Transaction appears to qualify for the ${applicableExemption?.replace(/_/g, ' ')} exemption. MLO licensing not required based on disclosed facts.`
    : risk === 'review_needed'
    ? `Transaction may qualify for an exemption but has conditions requiring attorney review. MLO may or may not be required.`
    : `This transaction appears to require a licensed MLO. The seller-financing exemptions may not apply based on disclosed facts.`;

  return {
    risk,
    exemptionApplicable: applicableExemption,
    summary,
    findings,
    recommendations,
    requiresLicensedMLO: requiresMLO,
  };
}
