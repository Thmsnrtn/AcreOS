/**
 * Dodd-Frank Seller Financing Compliance Checker
 *
 * The Dodd-Frank Wall Street Reform Act (2010) added Title XIV, which requires
 * loan originators to be licensed under the SAFE Act. However, there are
 * seller-financing exemptions under CFPB Reg Z:
 *
 * Exclusion 1: "3-property seller financer" (12 CFR 1026.36(a)(4))
 *   Any person (natural person OR entity) that meets ALL of:
 *   (i)   finances the sale of 3 or fewer properties in any 12-month period,
 *         each owned by the person and securing the financing;
 *   (ii)  did not construct, or act as contractor for, a residence on the
 *         property in the ordinary course of business;
 *   (iii)(A) the financing is FULLY AMORTIZING — so NO balloon of any length;
 *   (iii)(B) the person determines in good faith that the buyer has a
 *         reasonable ability to repay;
 *   (iii)(C) fixed rate, or adjustable only after 5+ years with reasonable
 *         annual and lifetime caps.
 *
 * Exclusion 2: "1-property seller financer" (12 CFR 1026.36(a)(5))
 *   A natural person, estate, or trust that meets ALL of:
 *   (i)   finances the sale of only 1 property in any 12-month period, owned
 *         by it and securing the financing;
 *   (ii)  did not construct, or act as contractor for, a residence on the
 *         property in the ordinary course of business;
 *   (iii)(A) the repayment schedule does not produce negative amortization
 *         — balloons ARE permitted here;
 *   (iii)(B) fixed rate, or adjustable only after 5+ years with reasonable
 *         caps.
 *   Being the seller's own residence is NOT an element of either exclusion.
 *
 * 2026-10-20 (best-in-class audit): the previous version granted the
 * 3-property exclusion to balloon notes, said a balloon disqualified the
 * 1-property exclusion (backwards), required the property to be the seller's
 * residence, cited (a)(4)(i)/(ii) for what are (a)(4) and (a)(5), and had no
 * ability-to-repay element. An exclusion is now granted only when every
 * element is affirmatively satisfied; an element the operator has not
 * answered blocks the grant and is named (refuse, never assume).
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

import { DISCLAIMER_WORKSHEET } from "./legalDisclaimers";

export interface DoddFrankInput {
  /** Number of seller-financed transactions in the past 12 months (including this one) */
  sellerFinancedDealsLast12Months: number;
  /** Is the seller a natural person (individual) or an entity (LLC/Corp/Trust)? */
  sellerType: 'natural_person' | 'entity' | 'estate_or_trust';
  /** Does the subject property have a dwelling (house, manufactured home)? */
  hasDwelling: boolean;
  /** Did the seller construct the dwelling themselves? */
  sellerConstructedDwelling: boolean;
  /**
   * Retained for request compatibility only. Whether the property is the
   * seller's residence is NOT an element of either seller-financer exclusion
   * and is ignored by the check.
   */
  isSellerResidence?: boolean;
  /** Loan term in months */
  loanTermMonths: number;
  /** Interest rate type */
  rateType: 'fixed' | 'adjustable' | 'balloon_under_5yr' | 'balloon_5yr_plus';
  /** Balloon payment? If yes, after how many months? */
  balloonAfterMonths?: number;
  /** Annual interest rate (as a decimal, e.g. 0.12 for 12%) */
  interestRate: number;
  /**
   * For an adjustable rate: months from consummation to the FIRST possible
   * rate change. Both exclusions require 60+. Unknown blocks the exclusion.
   */
  firstRateAdjustmentMonths?: number;
  /**
   * 12 CFR 1026.36(a)(4)(iii)(B): did the seller determine in good faith that
   * the buyer has a reasonable ability to repay? Required for the 3-property
   * exclusion; unknown (undefined) blocks it.
   */
  abilityToRepayDetermined?: boolean;
  /**
   * Can the payment schedule produce negative amortization (payments below
   * accruing interest)? Disqualifies both exclusions; unknown blocks both.
   */
  negativeAmortization?: boolean;
  /**
   * Total points and fees in cents (12 CFR 1026.32(b)(1)). Includes
   * origination fees, discount points the borrower didn't choose, mortgage-
   * broker comp, and most third-party charges paid by the borrower. Optional
   * — when omitted, the HOEPA points/fees screen is skipped.
   */
  totalPointsAndFeesCents?: number;
  /** Total loan amount in cents (Reg-Z definition — financed amount). */
  totalLoanAmountCents?: number;
  /** Prepayment-penalty period, in months from consummation. */
  prepaymentPenaltyMonths?: number;
  /** Max prepayment-penalty as a fraction of the prepaid amount (e.g. 0.02 = 2%). */
  prepaymentPenaltyMaxPercent?: number;
}

export type ComplianceRisk = 'compliant' | 'review_needed' | 'likely_violation' | 'attorney_required';

export interface DoddFrankCheckResult {
  risk: ComplianceRisk;
  exemptionApplicable?: '3_property' | '1_property_natural_person' | 'non_dwelling_land' | 'none';
  /** Exclusion elements the operator has not answered, which block a grant. */
  unansweredElements?: string[];
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
  /**
   * Always-rendered disclaimer legend (L1 liability shield) — travels with
   * the result wherever it is rendered or forwarded. This checker provides
   * guidance, not legal advice.
   */
  disclaimer: string;
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
      disclaimer: DISCLAIMER_WORKSHEET,
    };
  }

  // Case 2: Has a dwelling — test each seller-financer exclusion element by
  // element (12 CFR 1026.36(a)(4) and (a)(5)). See the header for the rule.
  const evaluation = evaluateSellerFinancerExclusions(input);
  const applicableExemption = evaluation.exemption;
  let requiresMLO = applicableExemption === 'none';
  findings.push(...evaluation.findings);
  recommendations.push(...evaluation.recommendations);

  // ── HPML / HOEPA pricing screens ─────────────────────────────────────────
  //
  // HPML (Higher-Priced Mortgage Loan, 12 CFR 1026.35) — APR threshold:
  //    1st-lien (jumbo): APOR + 2.5%
  //    1st-lien (non-jumbo): APOR + 1.5%
  //    Subordinate-lien: APOR + 3.5%
  // HPML triggers escrow + appraisal requirements.
  //
  // HOEPA (High-Cost Mortgage, 12 CFR 1026.32) — three independent triggers:
  //    APR trigger:
  //      1st-lien:        APR > APOR + 6.5%
  //      1st-lien <$50k secured by personal property (incl. manufactured
  //                       home titled, not as real property): APOR + 8.5%
  //      Subordinate:     APR > APOR + 8.5%
  //    Points-and-fees trigger (loans consummated 2024+):
  //      Loan ≥ $26,968:  > 5% of total loan amount
  //      Loan <  $26,968: greater of 8% or $1,348 (2024 dollar figure)
  //    Prepayment-penalty trigger:
  //      Penalty period > 36 months OR penalty > 2% of any prepaid amount.
  //
  // The CFPB updates the loan-amount and dollar-fee thresholds annually
  // (12 CFR 1026.32(a)(1)(ii)(B)). When you update these constants check
  // the most-recent Reg-Z Comment 1026.32(a)(1)(ii)-1.
  //
  // AcreOS doesn't have APOR live in scope here; we surface the rate-only
  // posture as a conservative screen. The hard threshold check happens in
  // the seller-finance origination form once APOR is resolved.
  if (input.interestRate > 0.085) {
    findings.push({
      issue: 'HOEPA High-Cost Mortgage — APR trigger',
      detail: `Rate of ${(input.interestRate * 100).toFixed(2)}% likely exceeds the HOEPA APR trigger (APOR + 6.5% for 1st-lien; APOR + 8.5% for small-loan / personal-property and subordinate liens). A high-cost mortgage carries balloon prohibitions, pre-loan counseling, ability-to-repay requirements, and severe assignee-liability exposure. Confirm against current APOR (FFIEC) before consummation.`,
      severity: 'critical',
    });
    recommendations.push('Pull current APOR from FFIEC for the consummation date and recompute APR-over-APOR delta. If HOEPA-triggered, do NOT close without HOEPA-specific counsel — assignee liability follows the note.');
  } else if (input.interestRate > 0.065) {
    findings.push({
      issue: 'HPML zone — likely Higher-Priced Mortgage Loan',
      detail: `Rate of ${(input.interestRate * 100).toFixed(2)}% likely exceeds the HPML threshold (APOR + 1.5% on 1st-lien). HPMLs require an escrow account for property taxes + insurance (5-year minimum), a full interior appraisal, and ability-to-repay documentation.`,
      severity: 'warning',
    });
    recommendations.push('Verify current APOR (Average Prime Offer Rate) from FFIEC to determine if rate triggers HPML requirements. If HPML, enable tax + insurance escrow and capture an ability-to-repay determination.');
  }

  // ── HOEPA points-and-fees / prepay-penalty triggers ──────────────────────
  if (input.totalPointsAndFeesCents !== undefined && input.totalLoanAmountCents !== undefined) {
    const HOEPA_PF_LARGE_LOAN_FLOOR_CENTS = 2_695_200; // $26,968 (2024 figure, Reg-Z Comment 1026.32(a)(1)(ii)-1)
    const HOEPA_PF_SMALL_LOAN_DOLLAR_FLOOR_CENTS = 134_800; // $1,348 (2024)
    const pfRatio = input.totalPointsAndFeesCents / input.totalLoanAmountCents;
    if (input.totalLoanAmountCents >= HOEPA_PF_LARGE_LOAN_FLOOR_CENTS) {
      if (pfRatio > 0.05) {
        findings.push({
          issue: 'HOEPA points-and-fees trigger exceeded',
          detail: `Points + fees ($${(input.totalPointsAndFeesCents/100).toFixed(0)}) = ${(pfRatio*100).toFixed(2)}% of loan amount; HOEPA caps this at 5% for loans ≥ $26,968 (12 CFR 1026.32(a)(1)(ii)(A)). Loan is a high-cost mortgage.`,
          severity: 'critical',
        });
      }
    } else {
      const smallLoanLimit = Math.max(HOEPA_PF_SMALL_LOAN_DOLLAR_FLOOR_CENTS, input.totalLoanAmountCents * 0.08);
      if (input.totalPointsAndFeesCents > smallLoanLimit) {
        findings.push({
          issue: 'HOEPA points-and-fees trigger exceeded (small loan)',
          detail: `Loan amount <$26,968. Points + fees cap is the greater of 8% ($${(input.totalLoanAmountCents*0.08/100).toFixed(0)}) or $1,348. Reported $${(input.totalPointsAndFeesCents/100).toFixed(0)} exceeds the limit. Loan is a high-cost mortgage.`,
          severity: 'critical',
        });
      }
    }
  }
  if (input.prepaymentPenaltyMonths !== undefined && input.prepaymentPenaltyMonths > 36) {
    findings.push({
      issue: 'HOEPA prepayment-penalty trigger',
      detail: `Prepayment penalty period of ${input.prepaymentPenaltyMonths} months exceeds the 36-month HOEPA limit (12 CFR 1026.32(a)(1)(iii)). Loan is a high-cost mortgage.`,
      severity: 'critical',
    });
  }
  if (input.prepaymentPenaltyMaxPercent !== undefined && input.prepaymentPenaltyMaxPercent > 0.02) {
    findings.push({
      issue: 'HOEPA prepayment-penalty amount trigger',
      detail: `Prepayment penalty of ${(input.prepaymentPenaltyMaxPercent*100).toFixed(2)}% of the prepaid amount exceeds the 2% HOEPA limit. Loan is a high-cost mortgage.`,
      severity: 'critical',
    });
  }

  // Seller constructed the property
  if (input.sellerConstructedDwelling) {
    findings.push({
      issue: 'Seller-Constructed Dwelling',
      detail: 'A seller who constructed (or acted as contractor for) the residence in the ordinary course of business qualifies for neither seller-financer exclusion (12 CFR 1026.36(a)(4)(ii), (a)(5)(ii)). A licensed mortgage loan originator is required.',
      severity: 'critical',
    });
    requiresMLO = true;
  }

  // Final risk assessment
  let risk: ComplianceRisk;
  const criticals = findings.filter(f => f.severity === 'critical').length;
  const warnings = findings.filter(f => f.severity === 'warning').length;

  const undetermined = applicableExemption === 'none' && evaluation.unanswered.length > 0 && evaluation.disqualified.length === 0;
  if (undetermined && criticals === 0) {
    risk = 'review_needed';
    recommendations.push(`Answer the open exclusion element${evaluation.unanswered.length === 1 ? '' : 's'} (${evaluation.unanswered.join('; ')}) and run the check again. Until then, treat the loan as requiring a licensed MLO.`);
  } else if (requiresMLO || criticals > 0) {
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

  const summary = undetermined && criticals === 0
    ? `No seller-financer exclusion can be confirmed yet: ${evaluation.unanswered.join('; ')}. Treat the loan as requiring a licensed MLO until these are answered.`
    : risk === 'compliant'
    ? `Transaction appears to qualify for the ${applicableExemption?.replace(/_/g, ' ')} exemption. MLO licensing not required based on disclosed facts.`
    : risk === 'review_needed'
    ? `Transaction may qualify for an exemption but has conditions requiring attorney review. MLO may or may not be required.`
    : `This transaction appears to require a licensed MLO. The seller-financing exemptions may not apply based on disclosed facts.`;

  return {
    risk,
    exemptionApplicable: applicableExemption,
    unansweredElements: evaluation.unanswered,
    summary,
    findings,
    recommendations,
    requiresLicensedMLO: requiresMLO,
    disclaimer: DISCLAIMER_WORKSHEET,
  };
}

interface ExclusionEvaluation {
  exemption: '3_property' | '1_property_natural_person' | 'none';
  findings: DoddFrankCheckResult['findings'];
  recommendations: string[];
  /** Elements not answered that block a grant. */
  unanswered: string[];
  /** Elements affirmatively failed (for both exclusions). */
  disqualified: string[];
}

/**
 * Element-by-element test of the two Reg Z seller-financer exclusions. Each
 * exclusion is granted only when every element is affirmatively met.
 * Exported for tests.
 */
function evaluateSellerFinancerExclusions(input: DoddFrankInput): ExclusionEvaluation {
  const findings: DoddFrankCheckResult['findings'] = [];
  const recommendations: string[] = [];
  const n = input.sellerFinancedDealsLast12Months;
  const hasBalloon =
    input.rateType === 'balloon_under_5yr' ||
    input.rateType === 'balloon_5yr_plus' ||
    (typeof input.balloonAfterMonths === 'number' && input.balloonAfterMonths > 0);

  // Rate element, shared by (a)(4)(iii)(C) and (a)(5)(iii)(B).
  let rate: 'met' | 'failed' | 'unknown' = 'met';
  if (input.rateType === 'adjustable') {
    if (typeof input.firstRateAdjustmentMonths !== 'number') rate = 'unknown';
    else rate = input.firstRateAdjustmentMonths >= 60 ? 'met' : 'failed';
  }
  const negAm: 'met' | 'failed' | 'unknown' =
    input.negativeAmortization === undefined ? 'unknown' : input.negativeAmortization ? 'failed' : 'met';

  // ── 3-property exclusion, 12 CFR 1026.36(a)(4) ─────────────────────────
  const three: { failed: string[]; unknown: string[] } = { failed: [], unknown: [] };
  if (n > 3) three.failed.push(`financed ${n} properties in 12 months (limit 3)`);
  if (input.sellerConstructedDwelling) three.failed.push('seller constructed the residence');
  if (hasBalloon) three.failed.push('the note has a balloon, so it is not fully amortizing');
  if (negAm === 'failed') three.failed.push('the schedule can negatively amortize');
  else if (negAm === 'unknown') three.unknown.push('whether the schedule can negatively amortize');
  if (rate === 'failed') three.failed.push('the rate can adjust within the first 5 years');
  else if (rate === 'unknown') three.unknown.push('when the adjustable rate can first change');
  if (input.abilityToRepayDetermined === false) three.failed.push('no good-faith ability-to-repay determination');
  else if (input.abilityToRepayDetermined === undefined) three.unknown.push('whether a good-faith ability-to-repay determination was made');

  // ── 1-property exclusion, 12 CFR 1026.36(a)(5) ─────────────────────────
  const one: { failed: string[]; unknown: string[] } = { failed: [], unknown: [] };
  if (input.sellerType === 'entity') one.failed.push('seller is an entity, not a natural person, estate or trust');
  if (n > 1) one.failed.push(`financed ${n} properties in 12 months (limit 1)`);
  if (input.sellerConstructedDwelling) one.failed.push('seller constructed the residence');
  if (negAm === 'failed') one.failed.push('the schedule can negatively amortize');
  else if (negAm === 'unknown') one.unknown.push('whether the schedule can negatively amortize');
  if (rate === 'failed') one.failed.push('the rate can adjust within the first 5 years');
  else if (rate === 'unknown') one.unknown.push('when the adjustable rate can first change');

  if (three.failed.length === 0 && three.unknown.length === 0) {
    findings.push({
      issue: '3-Property Seller-Financer Exclusion',
      detail: `Every element of 12 CFR 1026.36(a)(4) is met on the disclosed facts: ${n} propert${n === 1 ? 'y' : 'ies'} financed in 12 months (limit 3), seller did not construct the residence, the note is fully amortizing with no balloon, the rate is fixed or first adjusts after 5+ years, and the seller made a good-faith ability-to-repay determination.`,
      severity: 'info',
    });
    recommendations.push('Keep the ability-to-repay determination (income, debts, credit) in the deal file — it is an element of the exclusion, not a formality.');
    return { exemption: '3_property', findings, recommendations, unanswered: [], disqualified: [] };
  }
  if (one.failed.length === 0 && one.unknown.length === 0) {
    findings.push({
      issue: '1-Property Seller-Financer Exclusion',
      detail: `Every element of 12 CFR 1026.36(a)(5) is met on the disclosed facts: the seller is a natural person, estate or trust, financed only 1 property in 12 months, did not construct the residence, the schedule cannot negatively amortize, and the rate is fixed or first adjusts after 5+ years.${hasBalloon ? ' A balloon is permitted under this exclusion.' : ''}`,
      severity: 'info',
    });
    if (three.failed.length > 0) {
      findings.push({
        issue: '3-Property Exclusion Not Available',
        detail: `The 3-property exclusion (12 CFR 1026.36(a)(4)) does not apply: ${three.failed.join('; ')}. Only the 1-property exclusion covers this loan, so a second seller-financed sale within 12 months would lose it.`,
        severity: 'warning',
      });
    }
    return { exemption: '1_property_natural_person', findings, recommendations, unanswered: [], disqualified: [] };
  }

  if (three.failed.length > 0) {
    findings.push({
      issue: '3-Property Exclusion Not Met',
      detail: `12 CFR 1026.36(a)(4) does not apply: ${three.failed.join('; ')}.`,
      severity: three.failed.some((f) => f.startsWith('financed')) ? 'critical' : 'warning',
    });
  }
  if (one.failed.length > 0 && input.sellerType !== 'entity') {
    findings.push({
      issue: '1-Property Exclusion Not Met',
      detail: `12 CFR 1026.36(a)(5) does not apply: ${one.failed.join('; ')}.`,
      severity: 'warning',
    });
  }
  if (hasBalloon && three.failed.length > 0 && input.sellerType === 'entity') {
    recommendations.push('An entity seller can only use the 3-property exclusion, which forbids any balloon. Restructure to a fully amortizing note or use a licensed MLO.');
  }
  // An exclusion still reachable once the open questions are answered.
  const reachable = [three, one].filter((e) => e.failed.length === 0 && e.unknown.length > 0);
  const unanswered = Array.from(new Set(reachable.flatMap((e) => e.unknown)));
  const disqualified = reachable.length === 0 ? Array.from(new Set([...three.failed, ...one.failed])) : [];
  if (unanswered.length > 0) {
    findings.push({
      issue: 'Exclusion Elements Unanswered',
      detail: `A seller-financer exclusion may apply but cannot be confirmed until these are answered: ${unanswered.join('; ')}.`,
      severity: 'warning',
    });
  }
  return { exemption: 'none', findings, recommendations, unanswered, disqualified };
}
