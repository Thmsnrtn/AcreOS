/**
 * State Usury Law Guard
 *
 * Before finalizing seller-financing terms, check whether the agreed interest
 * rate violates the receiving state's usury ceiling. Usury violations can
 * result in: forfeiture of all interest, loan voiding, or criminal penalties.
 *
 * IMPORTANT: This is informational only. Usury law is complex and varies by:
 *   - Type of loan (commercial vs. consumer vs. seller-financed real estate)
 *   - Lender type (individual vs. entity)
 *   - Whether the borrower waived usury protection in the note
 *   - Federal preemption (national banks are exempt)
 *
 * For most seller-financed land deals (non-consumer, non-dwelling), usury
 * ceilings are typically higher or inapplicable, but individual states vary.
 *
 * Data source: State statutes as of 2025. Always verify current law.
 */

export interface StateLimits {
  stateCode: string;
  stateName: string;
  /** General civil usury ceiling (% per annum). null = no general ceiling */
  civilCeiling: number | null;
  /** Commercial/business loan ceiling. Often higher than civil ceiling */
  commercialCeiling: number | null;
  /** Real estate / seller-financed mortgage ceiling */
  realEstateCeiling: number | null;
  /** Is there a specific seller-financing exemption? */
  sellerFinancingExemption: boolean;
  notes: string;
  legalReference: string;
}

// State usury data — all rates are maximum annual percentage rates (APR)
// null = no statutory ceiling (market rate permitted)
const STATE_USURY_DATA: StateLimits[] = [
  { stateCode: 'AL', stateName: 'Alabama', civilCeiling: 6, commercialCeiling: null, realEstateCeiling: null, sellerFinancingExemption: true, notes: 'No ceiling for written commercial agreements. RE seller-finance broadly exempt.', legalReference: 'Ala. Code § 8-8-1' },
  { stateCode: 'AK', stateName: 'Alaska', civilCeiling: 10.5, commercialCeiling: null, realEstateCeiling: null, sellerFinancingExemption: true, notes: 'Parties may contract for any rate in writing for commercial loans.', legalReference: 'AS 45.45.010' },
  { stateCode: 'AZ', stateName: 'Arizona', civilCeiling: 10, commercialCeiling: null, realEstateCeiling: null, sellerFinancingExemption: true, notes: 'No general usury law for real estate loans. Parties may agree to any rate.', legalReference: 'A.R.S. § 44-1201' },
  { stateCode: 'AR', stateName: 'Arkansas', civilCeiling: 17, commercialCeiling: 17, realEstateCeiling: 17, sellerFinancingExemption: false, notes: 'Constitutional 17% cap (Amendment 89). Among the strictest in the US. Applies to all loans.', legalReference: 'Ark. Const. amend. 89' },
  { stateCode: 'CA', stateName: 'California', civilCeiling: 10, commercialCeiling: null, realEstateCeiling: null, sellerFinancingExemption: true, notes: 'For seller-financed real property, parties may agree to any rate if seller held title. Complex rules.', legalReference: 'Cal. Const. art. XV; Cal. Fin. Code § 22002' },
  { stateCode: 'CO', stateName: 'Colorado', civilCeiling: null, commercialCeiling: null, realEstateCeiling: null, sellerFinancingExemption: true, notes: 'No general usury ceiling. Parties may contract for any rate.', legalReference: 'C.R.S. § 5-12-103' },
  { stateCode: 'CT', stateName: 'Connecticut', civilCeiling: 12, commercialCeiling: null, realEstateCeiling: null, sellerFinancingExemption: true, notes: 'Mortgage and commercial exceptions effectively allow market rates.', legalReference: 'Conn. Gen. Stat. § 37-4' },
  { stateCode: 'DE', stateName: 'Delaware', civilCeiling: null, commercialCeiling: null, realEstateCeiling: null, sellerFinancingExemption: true, notes: 'No usury ceiling. Delaware is deliberately lender-friendly.', legalReference: '5 Del. C. § 943' },
  { stateCode: 'FL', stateName: 'Florida', civilCeiling: 18, commercialCeiling: 25, realEstateCeiling: 18, sellerFinancingExemption: false, notes: 'RE transactions generally 18%. Criminal usury at 25%+. Written agreements required.', legalReference: 'Fla. Stat. § 687.01' },
  { stateCode: 'GA', stateName: 'Georgia', civilCeiling: 7, commercialCeiling: null, realEstateCeiling: null, sellerFinancingExemption: true, notes: 'Very low civil rate but commercial/RE exceptions are broad.', legalReference: 'O.C.G.A. § 7-4-2' },
  { stateCode: 'HI', stateName: 'Hawaii', civilCeiling: 10, commercialCeiling: null, realEstateCeiling: null, sellerFinancingExemption: true, notes: 'RE seller financing broadly exempt with written agreement.', legalReference: 'Haw. Rev. Stat. § 478-1' },
  { stateCode: 'ID', stateName: 'Idaho', civilCeiling: 12, commercialCeiling: null, realEstateCeiling: null, sellerFinancingExemption: true, notes: 'Parties may agree to any rate in writing for RE transactions.', legalReference: 'Idaho Code § 28-22-104' },
  { stateCode: 'IL', stateName: 'Illinois', civilCeiling: 9, commercialCeiling: null, realEstateCeiling: null, sellerFinancingExemption: true, notes: 'Broad exemptions for written contracts and corporate borrowers.', legalReference: '815 ILCS 205/1' },
  { stateCode: 'IN', stateName: 'Indiana', civilCeiling: 8, commercialCeiling: null, realEstateCeiling: null, sellerFinancingExemption: true, notes: 'Financial institution loans and RE loans broadly exempt.', legalReference: 'Ind. Code § 24-4.6-1-101' },
  { stateCode: 'IA', stateName: 'Iowa', civilCeiling: null, commercialCeiling: null, realEstateCeiling: null, sellerFinancingExemption: true, notes: 'Iowa repealed its usury law. No ceiling.', legalReference: 'Iowa Code § 535.2' },
  { stateCode: 'KS', stateName: 'Kansas', civilCeiling: 15, commercialCeiling: null, realEstateCeiling: null, sellerFinancingExemption: true, notes: 'Agricultural and RE loans may exceed ceiling with agreement.', legalReference: 'K.S.A. § 16-207' },
  { stateCode: 'KY', stateName: 'Kentucky', civilCeiling: 8, commercialCeiling: null, realEstateCeiling: null, sellerFinancingExemption: true, notes: 'Written agreements for RE permit market rates.', legalReference: 'KRS § 360.010' },
  { stateCode: 'LA', stateName: 'Louisiana', civilCeiling: 12, commercialCeiling: null, realEstateCeiling: null, sellerFinancingExemption: true, notes: 'Conventional mortgages exempt from usury ceiling.', legalReference: 'La. R.S. 9:3509' },
  { stateCode: 'ME', stateName: 'Maine', civilCeiling: null, commercialCeiling: null, realEstateCeiling: null, sellerFinancingExemption: true, notes: 'No general usury ceiling. Consumer Credit Code covers consumer transactions separately.', legalReference: '9-A M.R.S. § 2-201' },
  { stateCode: 'MD', stateName: 'Maryland', civilCeiling: 6, commercialCeiling: null, realEstateCeiling: null, sellerFinancingExemption: true, notes: 'RE loans permit any agreed rate in writing. Commercial broadly exempt.', legalReference: 'Md. Code Ann., Com. Law § 12-102' },
  { stateCode: 'MA', stateName: 'Massachusetts', civilCeiling: 20, commercialCeiling: null, realEstateCeiling: null, sellerFinancingExemption: true, notes: 'Higher rate for commercial. RE broadly exempt.', legalReference: 'Mass. Gen. Laws ch. 107 § 3' },
  { stateCode: 'MI', stateName: 'Michigan', civilCeiling: 7, commercialCeiling: null, realEstateCeiling: null, sellerFinancingExemption: true, notes: 'Exceptions for commercial and RE significantly broaden allowed rates.', legalReference: 'MCL § 438.31' },
  { stateCode: 'MN', stateName: 'Minnesota', civilCeiling: 8, commercialCeiling: null, realEstateCeiling: null, sellerFinancingExemption: true, notes: 'Agricultural and commercial exceptions permit market rates.', legalReference: 'Minn. Stat. § 334.01' },
  { stateCode: 'MS', stateName: 'Mississippi', civilCeiling: 10, commercialCeiling: null, realEstateCeiling: null, sellerFinancingExemption: true, notes: 'Written contracts may specify any rate for business and RE.', legalReference: 'Miss. Code Ann. § 75-17-1' },
  { stateCode: 'MO', stateName: 'Missouri', civilCeiling: null, commercialCeiling: null, realEstateCeiling: null, sellerFinancingExemption: true, notes: 'Constitutional amendment removed usury ceiling. No limit.', legalReference: 'Mo. Const. art. IV, § 26' },
  { stateCode: 'MT', stateName: 'Montana', civilCeiling: null, commercialCeiling: null, realEstateCeiling: null, sellerFinancingExemption: true, notes: 'No usury ceiling. Market rates permitted.', legalReference: 'Mont. Code Ann. § 31-1-105' },
  { stateCode: 'NE', stateName: 'Nebraska', civilCeiling: null, commercialCeiling: null, realEstateCeiling: null, sellerFinancingExemption: true, notes: 'No usury ceiling in Nebraska. Any rate permitted.', legalReference: 'Neb. Rev. Stat. § 45-101.04' },
  { stateCode: 'NV', stateName: 'Nevada', civilCeiling: null, commercialCeiling: null, realEstateCeiling: null, sellerFinancingExemption: true, notes: 'No usury ceiling. Nevada is borrower and lender friendly.', legalReference: 'NRS § 99.050' },
  { stateCode: 'NH', stateName: 'New Hampshire', civilCeiling: null, commercialCeiling: null, realEstateCeiling: null, sellerFinancingExemption: true, notes: 'No statutory usury limit.', legalReference: 'RSA 336:1' },
  { stateCode: 'NJ', stateName: 'New Jersey', civilCeiling: 16, commercialCeiling: 30, realEstateCeiling: null, sellerFinancingExemption: true, notes: 'RE mortgages broadly exempt from civil ceiling. Commercial up to 30%.', legalReference: 'N.J.S.A. 31:1-1' },
  { stateCode: 'NM', stateName: 'New Mexico', civilCeiling: null, commercialCeiling: null, realEstateCeiling: null, sellerFinancingExemption: true, notes: 'No general usury ceiling.', legalReference: 'NMSA 1978 § 56-8-11' },
  { stateCode: 'NY', stateName: 'New York', civilCeiling: 16, commercialCeiling: 25, realEstateCeiling: null, sellerFinancingExemption: true, notes: 'Criminal usury at 25%+. Corporate borrowers broadly exempt. RE permits market rates.', legalReference: 'N.Y. Gen. Oblig. Law § 5-511; Banking Law § 14-a' },
  { stateCode: 'NC', stateName: 'North Carolina', civilCeiling: 8, commercialCeiling: null, realEstateCeiling: null, sellerFinancingExemption: true, notes: 'RE and commercial loans broadly exempt from civil ceiling.', legalReference: 'N.C. Gen. Stat. § 24-1' },
  { stateCode: 'ND', stateName: 'North Dakota', civilCeiling: 6, commercialCeiling: null, realEstateCeiling: null, sellerFinancingExemption: true, notes: 'Written agreements for commercial and RE broadly permit market rates.', legalReference: 'N.D. Cent. Code § 47-14-05' },
  { stateCode: 'OH', stateName: 'Ohio', civilCeiling: 8, commercialCeiling: null, realEstateCeiling: null, sellerFinancingExemption: true, notes: 'RE and commercial broadly exempt with written agreement.', legalReference: 'ORC § 1343.01' },
  { stateCode: 'OK', stateName: 'Oklahoma', civilCeiling: 6, commercialCeiling: null, realEstateCeiling: null, sellerFinancingExemption: true, notes: 'Commercial and RE loans with written agreement broadly exempt.', legalReference: '15 O.S. § 267' },
  { stateCode: 'OR', stateName: 'Oregon', civilCeiling: 9, commercialCeiling: null, realEstateCeiling: null, sellerFinancingExemption: true, notes: 'RE and commercial broadly exempt.', legalReference: 'ORS § 82.010' },
  { stateCode: 'PA', stateName: 'Pennsylvania', civilCeiling: 6, commercialCeiling: null, realEstateCeiling: null, sellerFinancingExemption: true, notes: 'Broad exceptions for RE transactions. Commercial broadly exempt.', legalReference: '41 Pa. Stat. § 201' },
  { stateCode: 'RI', stateName: 'Rhode Island', civilCeiling: 21, commercialCeiling: null, realEstateCeiling: null, sellerFinancingExemption: true, notes: 'Higher civil ceiling. RE broadly exempt.', legalReference: 'R.I. Gen. Laws § 6-26-2' },
  { stateCode: 'SC', stateName: 'South Carolina', civilCeiling: 8.75, commercialCeiling: null, realEstateCeiling: null, sellerFinancingExemption: true, notes: 'RE and commercial broadly exempt with written agreement.', legalReference: 'S.C. Code Ann. § 34-31-20' },
  { stateCode: 'SD', stateName: 'South Dakota', civilCeiling: null, commercialCeiling: null, realEstateCeiling: null, sellerFinancingExemption: true, notes: 'South Dakota repealed usury ceiling. No limit. Very lender-friendly.', legalReference: 'SDCL § 54-3-1.1' },
  { stateCode: 'TN', stateName: 'Tennessee', civilCeiling: null, commercialCeiling: null, realEstateCeiling: null, sellerFinancingExemption: true, notes: 'No general usury ceiling for written contracts.', legalReference: 'Tenn. Code Ann. § 47-14-103' },
  { stateCode: 'TX', stateName: 'Texas', civilCeiling: null, commercialCeiling: null, realEstateCeiling: null, sellerFinancingExemption: true, notes: 'No effective ceiling for written commercial RE agreements. 18% default if no rate specified.', legalReference: 'Tex. Fin. Code § 302.001' },
  { stateCode: 'UT', stateName: 'Utah', civilCeiling: null, commercialCeiling: null, realEstateCeiling: null, sellerFinancingExemption: true, notes: 'No usury ceiling. Market rates permitted.', legalReference: 'Utah Code Ann. § 15-1-1' },
  { stateCode: 'VT', stateName: 'Vermont', civilCeiling: null, commercialCeiling: null, realEstateCeiling: null, sellerFinancingExemption: true, notes: 'No general ceiling for written agreements.', legalReference: '9 V.S.A. § 41a' },
  { stateCode: 'VA', stateName: 'Virginia', civilCeiling: 12, commercialCeiling: null, realEstateCeiling: null, sellerFinancingExemption: true, notes: 'RE and commercial broadly exempt with written contract.', legalReference: 'Va. Code Ann. § 6.2-301' },
  { stateCode: 'WA', stateName: 'Washington', civilCeiling: 12, commercialCeiling: null, realEstateCeiling: null, sellerFinancingExemption: true, notes: 'RE loans exempt from civil ceiling. Market rates for written agreements.', legalReference: 'RCW § 19.52.010' },
  { stateCode: 'WV', stateName: 'West Virginia', civilCeiling: 8, commercialCeiling: null, realEstateCeiling: null, sellerFinancingExemption: true, notes: 'RE broadly exempt.', legalReference: 'W. Va. Code § 47-6-5' },
  { stateCode: 'WI', stateName: 'Wisconsin', civilCeiling: null, commercialCeiling: null, realEstateCeiling: null, sellerFinancingExemption: true, notes: 'No usury ceiling.', legalReference: 'Wis. Stat. § 138.04' },
  { stateCode: 'WY', stateName: 'Wyoming', civilCeiling: null, commercialCeiling: null, realEstateCeiling: null, sellerFinancingExemption: true, notes: 'No usury ceiling.', legalReference: 'Wyo. Stat. § 40-14-354' },
  { stateCode: 'DC', stateName: 'Washington D.C.', civilCeiling: 6, commercialCeiling: 24, realEstateCeiling: null, sellerFinancingExemption: true, notes: 'RE broadly exempt.', legalReference: 'D.C. Code § 28-3301' },
];

const stateMap = new Map(STATE_USURY_DATA.map(s => [s.stateCode, s]));

export interface UsuryCeilingCheckResult {
  stateCode: string;
  stateName: string;
  proposedRate: number;
  applicable_ceiling: number | null;
  isAboveCeiling: boolean;
  risk: 'compliant' | 'borderline' | 'likely_violation' | 'consult_attorney';
  summary: string;
  recommendation: string;
  legalReference: string;
  sellerFinancingExemptionAvailable: boolean;
}

/**
 * Check whether a proposed interest rate violates a state's usury ceiling
 * for a seller-financed real estate transaction.
 */
export function checkUsuryCeiling(
  stateCode: string,
  proposedAnnualRateDecimal: number,
  isCommercialOrBusiness: boolean = false,
  hasDwelling: boolean = false
): UsuryCeilingCheckResult {
  const state = stateMap.get(stateCode.toUpperCase());
  const ratePercent = proposedAnnualRateDecimal * 100;

  if (!state) {
    return {
      stateCode,
      stateName: stateCode,
      proposedRate: ratePercent,
      applicable_ceiling: null,
      isAboveCeiling: false,
      risk: 'consult_attorney',
      summary: `State "${stateCode}" not found in database. Verify usury laws manually.`,
      recommendation: 'Consult a licensed real estate attorney in this state before finalizing terms.',
      legalReference: 'Unknown',
      sellerFinancingExemptionAvailable: false,
    };
  }

  // If there's a seller-financing exemption and it's RE (with or without dwelling),
  // the ceiling may not apply
  if (state.sellerFinancingExemption && !hasDwelling) {
    return {
      stateCode,
      stateName: state.stateName,
      proposedRate: ratePercent,
      applicable_ceiling: null,
      isAboveCeiling: false,
      risk: 'compliant',
      summary: `${state.stateName} has a seller-financing exemption for non-dwelling real estate. The general usury ceiling likely does not apply.`,
      recommendation: `Document the seller-financing nature of the transaction in the note. ${state.notes}`,
      legalReference: state.legalReference,
      sellerFinancingExemptionAvailable: true,
    };
  }

  // Determine applicable ceiling
  let ceiling: number | null = null;
  if (isCommercialOrBusiness && state.commercialCeiling !== null) {
    ceiling = state.commercialCeiling;
  } else if (state.realEstateCeiling !== null) {
    ceiling = state.realEstateCeiling;
  } else if (state.civilCeiling !== null) {
    ceiling = state.civilCeiling;
  }

  if (ceiling === null) {
    return {
      stateCode,
      stateName: state.stateName,
      proposedRate: ratePercent,
      applicable_ceiling: null,
      isAboveCeiling: false,
      risk: 'compliant',
      summary: `${state.stateName} has no statutory usury ceiling for this type of transaction.`,
      recommendation: state.notes,
      legalReference: state.legalReference,
      sellerFinancingExemptionAvailable: state.sellerFinancingExemption,
    };
  }

  const isAbove = ratePercent > ceiling;
  const borderline = !isAbove && ratePercent >= ceiling * 0.9;

  return {
    stateCode,
    stateName: state.stateName,
    proposedRate: ratePercent,
    applicable_ceiling: ceiling,
    isAboveCeiling: isAbove,
    risk: isAbove ? 'likely_violation' : borderline ? 'borderline' : 'compliant',
    summary: isAbove
      ? `USURY ALERT: Proposed rate of ${ratePercent.toFixed(2)}% exceeds ${state.stateName}'s ceiling of ${ceiling}%. This may be unenforceable or criminal.`
      : borderline
      ? `Proposed rate of ${ratePercent.toFixed(2)}% is close to ${state.stateName}'s ceiling of ${ceiling}%. Review with an attorney.`
      : `Proposed rate of ${ratePercent.toFixed(2)}% is within ${state.stateName}'s ceiling of ${ceiling}%.`,
    recommendation: isAbove
      ? `Reduce the interest rate to ${ceiling}% or below. Alternatively, confirm whether a seller-financing exemption applies. Consult a local real estate attorney. ${state.notes}`
      : `${state.notes}`,
    legalReference: state.legalReference,
    sellerFinancingExemptionAvailable: state.sellerFinancingExemption,
  };
}

export function getStateLimits(stateCode: string): StateLimits | null {
  return stateMap.get(stateCode.toUpperCase()) || null;
}

export function getAllStateLimits(): StateLimits[] {
  return STATE_USURY_DATA;
}
