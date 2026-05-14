/**
 * Per-state tax-lien certificate + tax-deed rules.
 *
 * Pillar L (tax-delinquent specialist personas) surfaced four
 * recurring confusions:
 *   - How long does the redemption period run?
 *   - What's the statutory yield (the rate accrued on the certificate)?
 *   - Is this a "tax-lien certificate" state, a "tax-deed" state, or
 *     a hybrid?
 *   - What's the foreclosure trigger?
 *
 * This module captures the answers as pure data. It is NOT legal
 * advice — operators must verify each transaction against current
 * statutes. The data below reflects the *general* rule per state at
 * time of authoring; counties may override on specific elements.
 *
 * Used by:
 *   - shared/regulatory/taxLienAdvisor.ts (future Pillar L follow-up
 *     for richer posture output)
 *   - Workflow templates in workflow-engine.ts to schedule
 *     redemption-countdown + foreclosure-eligibility triggers
 *   - UI surfaces on the tax-delinquent certificate detail page
 */

export type SaleType =
  | "tax_lien_certificate" // operator buys a lien; collects interest if redeemed
  | "tax_deed"             // operator buys the deed directly
  | "hybrid";              // some counties cert, some counties deed

export interface StateTaxLienRules {
  state: string;
  saleType: SaleType;
  // Statutory yield earned on a tax-lien certificate during the
  // redemption period. Stored as basis points (e.g. 1200 = 12%/yr).
  // null where the state is deed-only or rate isn't statutory.
  statutoryYieldBps: number | null;
  // Some states bid down the rate at auction (e.g. FL 18% → can bid
  // to 0.25%). When true, statutoryYieldBps is the MAX, not the
  // realized rate.
  rateIsBidDown: boolean;
  // Redemption period (months) before the operator can move to
  // foreclosure / deed take. null = no redemption period (pure deed
  // states like Texas have a short post-sale redemption window
  // captured separately).
  redemptionPeriodMonths: number | null;
  // Post-sale redemption window for deed states. Texas: 6-24 months
  // depending on homestead/agricultural use. Some other deed states
  // have similar.
  postSaleRedemptionMonths: number | null;
  // Notice-of-foreclosure / notice-of-application-for-deed
  // requirements (months notice before action).
  preForeclosureNoticeMonths: number;
  // Where to find the canonical statute (for the operator + their
  // attorney to verify).
  statutoryReference: string;
  notes: string;
}

export const STATE_TAX_LIEN_RULES: Record<string, StateTaxLienRules> = {
  AL: { state: "AL", saleType: "tax_lien_certificate", statutoryYieldBps: 1200, rateIsBidDown: false, redemptionPeriodMonths: 36, postSaleRedemptionMonths: null, preForeclosureNoticeMonths: 1, statutoryReference: "AL Code §40-10-29 et seq.", notes: "3-year redemption; 12% statutory rate; possible 6-month judicial cure post-redemption-expiry." },
  AK: { state: "AK", saleType: "tax_deed", statutoryYieldBps: null, rateIsBidDown: false, redemptionPeriodMonths: null, postSaleRedemptionMonths: 12, preForeclosureNoticeMonths: 1, statutoryReference: "AK Stat. §29.45.290 et seq.", notes: "Deed state. 1-year post-sale redemption to original owner." },
  AZ: { state: "AZ", saleType: "tax_lien_certificate", statutoryYieldBps: 1600, rateIsBidDown: true, redemptionPeriodMonths: 36, postSaleRedemptionMonths: null, preForeclosureNoticeMonths: 1, statutoryReference: "ARS §42-18101 et seq.", notes: "Rate bids down at auction; redemption period 3 years." },
  AR: { state: "AR", saleType: "tax_deed", statutoryYieldBps: null, rateIsBidDown: false, redemptionPeriodMonths: null, postSaleRedemptionMonths: 0, preForeclosureNoticeMonths: 0, statutoryReference: "ACA §26-37-101 et seq.", notes: "Deed state. State-controlled sales by Commissioner of State Lands." },
  CA: { state: "CA", saleType: "tax_deed", statutoryYieldBps: null, rateIsBidDown: false, redemptionPeriodMonths: 60, postSaleRedemptionMonths: 0, preForeclosureNoticeMonths: 1, statutoryReference: "CA R&T Code §3691 et seq.", notes: "Default redemption 5 years; deed sold at public auction after." },
  CO: { state: "CO", saleType: "tax_lien_certificate", statutoryYieldBps: 1200, rateIsBidDown: false, redemptionPeriodMonths: 36, postSaleRedemptionMonths: null, preForeclosureNoticeMonths: 1, statutoryReference: "CRS §39-11-101 et seq.", notes: "9 points above federal discount rate; 3-year redemption." },
  CT: { state: "CT", saleType: "tax_lien_certificate", statutoryYieldBps: 1800, rateIsBidDown: false, redemptionPeriodMonths: 12, postSaleRedemptionMonths: null, preForeclosureNoticeMonths: 1, statutoryReference: "Conn. Gen. Stat. §12-157", notes: "1-year redemption; very high statutory rate." },
  DE: { state: "DE", saleType: "tax_lien_certificate", statutoryYieldBps: 1500, rateIsBidDown: false, redemptionPeriodMonths: 60, postSaleRedemptionMonths: null, preForeclosureNoticeMonths: 1, statutoryReference: "9 Del. C. §8722 et seq.", notes: "Sheriff sale; 60-day redemption after sale; some counties run longer." },
  FL: { state: "FL", saleType: "tax_lien_certificate", statutoryYieldBps: 1800, rateIsBidDown: true, redemptionPeriodMonths: 24, postSaleRedemptionMonths: null, preForeclosureNoticeMonths: 1, statutoryReference: "F.S. §197.402 et seq.", notes: "Rate bids down to 0.25%. 2-year minimum before tax-deed application." },
  GA: { state: "GA", saleType: "tax_deed", statutoryYieldBps: 2000, rateIsBidDown: false, redemptionPeriodMonths: null, postSaleRedemptionMonths: 12, preForeclosureNoticeMonths: 1, statutoryReference: "OCGA §48-4-40 et seq.", notes: "Deed state; 20% penalty (not annual rate) if redeemed within first year; 30% after." },
  HI: { state: "HI", saleType: "tax_deed", statutoryYieldBps: null, rateIsBidDown: false, redemptionPeriodMonths: null, postSaleRedemptionMonths: 12, preForeclosureNoticeMonths: 1, statutoryReference: "HRS §246-55 et seq.", notes: "Deed state. 1-year post-sale redemption." },
  ID: { state: "ID", saleType: "tax_deed", statutoryYieldBps: null, rateIsBidDown: false, redemptionPeriodMonths: null, postSaleRedemptionMonths: 14, preForeclosureNoticeMonths: 1, statutoryReference: "Idaho Code §63-1003 et seq.", notes: "Deed state; 14-month post-sale window." },
  IL: { state: "IL", saleType: "tax_lien_certificate", statutoryYieldBps: 1800, rateIsBidDown: true, redemptionPeriodMonths: 30, postSaleRedemptionMonths: null, preForeclosureNoticeMonths: 5, statutoryReference: "35 ILCS 200/21 et seq.", notes: "Rate bids down to 0%. 2.5-year redemption (residential) or 3-year (vacant/non-resid)." },
  IN: { state: "IN", saleType: "tax_lien_certificate", statutoryYieldBps: 1000, rateIsBidDown: false, redemptionPeriodMonths: 12, postSaleRedemptionMonths: null, preForeclosureNoticeMonths: 1, statutoryReference: "IC §6-1.1-24 et seq.", notes: "10% interest; 12-month redemption." },
  IA: { state: "IA", saleType: "tax_lien_certificate", statutoryYieldBps: 2400, rateIsBidDown: false, redemptionPeriodMonths: 21, postSaleRedemptionMonths: null, preForeclosureNoticeMonths: 3, statutoryReference: "Iowa Code §447", notes: "24% statutory; 1.75-year redemption." },
  KS: { state: "KS", saleType: "tax_deed", statutoryYieldBps: null, rateIsBidDown: false, redemptionPeriodMonths: null, postSaleRedemptionMonths: 24, preForeclosureNoticeMonths: 1, statutoryReference: "K.S.A. §79-2801 et seq.", notes: "Deed state." },
  KY: { state: "KY", saleType: "tax_lien_certificate", statutoryYieldBps: 1200, rateIsBidDown: false, redemptionPeriodMonths: 12, postSaleRedemptionMonths: null, preForeclosureNoticeMonths: 1, statutoryReference: "KRS §134.420 et seq.", notes: "12% rate; 12-month redemption period." },
  LA: { state: "LA", saleType: "tax_lien_certificate", statutoryYieldBps: 1200, rateIsBidDown: true, redemptionPeriodMonths: 36, postSaleRedemptionMonths: null, preForeclosureNoticeMonths: 1, statutoryReference: "La. R.S. §47:2153 et seq.", notes: "Bids down on % undivided ownership, not rate; 5% penalty + 1%/mo interest." },
  ME: { state: "ME", saleType: "tax_lien_certificate", statutoryYieldBps: 800, rateIsBidDown: false, redemptionPeriodMonths: 18, postSaleRedemptionMonths: null, preForeclosureNoticeMonths: 1, statutoryReference: "36 M.R.S. §942 et seq.", notes: "Municipal liens; automatic foreclosure after 18 months." },
  MD: { state: "MD", saleType: "tax_lien_certificate", statutoryYieldBps: 1200, rateIsBidDown: true, redemptionPeriodMonths: 6, postSaleRedemptionMonths: null, preForeclosureNoticeMonths: 1, statutoryReference: "Md. Tax-Property §14-808 et seq.", notes: "Varies by county; Baltimore City rate is 18%. Short 6-month period to file foreclosure." },
  MA: { state: "MA", saleType: "tax_lien_certificate", statutoryYieldBps: 1600, rateIsBidDown: false, redemptionPeriodMonths: 6, postSaleRedemptionMonths: null, preForeclosureNoticeMonths: 1, statutoryReference: "M.G.L. c. 60 §53 et seq.", notes: "16% statutory; 6-month period before petition to foreclose." },
  MI: { state: "MI", saleType: "tax_deed", statutoryYieldBps: null, rateIsBidDown: false, redemptionPeriodMonths: null, postSaleRedemptionMonths: 1, preForeclosureNoticeMonths: 1, statutoryReference: "MCL §211.78 et seq.", notes: "Hybrid: pre-2014 was cert state; now deed state with 1-month post-sale redemption." },
  MN: { state: "MN", saleType: "tax_deed", statutoryYieldBps: null, rateIsBidDown: false, redemptionPeriodMonths: null, postSaleRedemptionMonths: 0, preForeclosureNoticeMonths: 1, statutoryReference: "Minn. Stat. §279 et seq.", notes: "Deed state; state forfeiture after 3-year delinquency; sold by state." },
  MS: { state: "MS", saleType: "tax_lien_certificate", statutoryYieldBps: 1800, rateIsBidDown: false, redemptionPeriodMonths: 24, postSaleRedemptionMonths: null, preForeclosureNoticeMonths: 1, statutoryReference: "Miss. Code §27-43-1 et seq.", notes: "18% statutory; 2-year redemption period." },
  MO: { state: "MO", saleType: "tax_lien_certificate", statutoryYieldBps: 1000, rateIsBidDown: false, redemptionPeriodMonths: 12, postSaleRedemptionMonths: null, preForeclosureNoticeMonths: 1, statutoryReference: "RSMo §140 et seq.", notes: "10% interest + 8% on certain costs; 1-year redemption." },
  MT: { state: "MT", saleType: "tax_lien_certificate", statutoryYieldBps: 1000, rateIsBidDown: false, redemptionPeriodMonths: 36, postSaleRedemptionMonths: null, preForeclosureNoticeMonths: 1, statutoryReference: "MCA §15-17 et seq.", notes: "10% per annum; 3-year redemption." },
  NE: { state: "NE", saleType: "tax_lien_certificate", statutoryYieldBps: 1400, rateIsBidDown: true, redemptionPeriodMonths: 36, postSaleRedemptionMonths: null, preForeclosureNoticeMonths: 1, statutoryReference: "Neb. Rev. Stat. §77-1801 et seq.", notes: "Rate bids down; 14% max; 3-year redemption." },
  NV: { state: "NV", saleType: "tax_deed", statutoryYieldBps: null, rateIsBidDown: false, redemptionPeriodMonths: null, postSaleRedemptionMonths: 0, preForeclosureNoticeMonths: 1, statutoryReference: "NRS §361 et seq.", notes: "Deed state; trust deed transfers post-redemption period." },
  NH: { state: "NH", saleType: "tax_lien_certificate", statutoryYieldBps: 1800, rateIsBidDown: false, redemptionPeriodMonths: 24, postSaleRedemptionMonths: null, preForeclosureNoticeMonths: 1, statutoryReference: "NH RSA §80:59 et seq.", notes: "18% interest; 2-year redemption." },
  NJ: { state: "NJ", saleType: "tax_lien_certificate", statutoryYieldBps: 1800, rateIsBidDown: true, redemptionPeriodMonths: 24, postSaleRedemptionMonths: null, preForeclosureNoticeMonths: 1, statutoryReference: "N.J.S.A. §54:5 et seq.", notes: "Rate bids to 0%; premium also bid up. 2-year redemption." },
  NM: { state: "NM", saleType: "tax_deed", statutoryYieldBps: null, rateIsBidDown: false, redemptionPeriodMonths: null, postSaleRedemptionMonths: 0, preForeclosureNoticeMonths: 1, statutoryReference: "NMSA §7-38 et seq.", notes: "Deed state; state property tax division sells." },
  NY: { state: "NY", saleType: "tax_lien_certificate", statutoryYieldBps: 1400, rateIsBidDown: false, redemptionPeriodMonths: 24, postSaleRedemptionMonths: null, preForeclosureNoticeMonths: 1, statutoryReference: "NY RPTL Article 11", notes: "Local-option; NYC's program is most active. 2-year redemption." },
  NC: { state: "NC", saleType: "tax_deed", statutoryYieldBps: null, rateIsBidDown: false, redemptionPeriodMonths: null, postSaleRedemptionMonths: 0, preForeclosureNoticeMonths: 1, statutoryReference: "N.C.G.S. §105-374 et seq.", notes: "Deed state via mortgage-style foreclosure." },
  ND: { state: "ND", saleType: "tax_deed", statutoryYieldBps: null, rateIsBidDown: false, redemptionPeriodMonths: null, postSaleRedemptionMonths: 12, preForeclosureNoticeMonths: 3, statutoryReference: "N.D.C.C. §57-28 et seq.", notes: "Deed state with extended redemption + 3-month notice." },
  OH: { state: "OH", saleType: "tax_lien_certificate", statutoryYieldBps: 1800, rateIsBidDown: true, redemptionPeriodMonths: 12, postSaleRedemptionMonths: null, preForeclosureNoticeMonths: 1, statutoryReference: "Ohio Rev. Code §5721 et seq.", notes: "Bulk-sales to investor pools; rate bids down. 1-year redemption." },
  OK: { state: "OK", saleType: "tax_lien_certificate", statutoryYieldBps: 800, rateIsBidDown: false, redemptionPeriodMonths: 24, postSaleRedemptionMonths: null, preForeclosureNoticeMonths: 1, statutoryReference: "OK Stat. §68-3105 et seq.", notes: "8% interest; 2-year redemption." },
  OR: { state: "OR", saleType: "tax_deed", statutoryYieldBps: null, rateIsBidDown: false, redemptionPeriodMonths: null, postSaleRedemptionMonths: 24, preForeclosureNoticeMonths: 1, statutoryReference: "ORS §312 et seq.", notes: "Deed state via foreclosure proceeding; 2-year post-judgment redemption." },
  PA: { state: "PA", saleType: "tax_lien_certificate", statutoryYieldBps: 1200, rateIsBidDown: false, redemptionPeriodMonths: 9, postSaleRedemptionMonths: null, preForeclosureNoticeMonths: 1, statutoryReference: "53 P.S. §7101 et seq.", notes: "Local-option; varies widely by county. 9-month redemption typical." },
  RI: { state: "RI", saleType: "tax_lien_certificate", statutoryYieldBps: 1600, rateIsBidDown: false, redemptionPeriodMonths: 12, postSaleRedemptionMonths: null, preForeclosureNoticeMonths: 1, statutoryReference: "R.I.G.L. §44-9 et seq.", notes: "16% interest; 1-year redemption." },
  SC: { state: "SC", saleType: "tax_lien_certificate", statutoryYieldBps: 1200, rateIsBidDown: false, redemptionPeriodMonths: 12, postSaleRedemptionMonths: null, preForeclosureNoticeMonths: 1, statutoryReference: "S.C. Code §12-51 et seq.", notes: "12% interest; 1-year redemption." },
  SD: { state: "SD", saleType: "tax_lien_certificate", statutoryYieldBps: 1000, rateIsBidDown: false, redemptionPeriodMonths: 36, postSaleRedemptionMonths: null, preForeclosureNoticeMonths: 1, statutoryReference: "SDCL §10-23 et seq.", notes: "10% interest; 3-year redemption." },
  TN: { state: "TN", saleType: "tax_deed", statutoryYieldBps: 1000, rateIsBidDown: false, redemptionPeriodMonths: null, postSaleRedemptionMonths: 12, preForeclosureNoticeMonths: 1, statutoryReference: "T.C.A. §67-5 et seq.", notes: "Hybrid: post-sale redemption with 10% interest." },
  TX: { state: "TX", saleType: "tax_deed", statutoryYieldBps: null, rateIsBidDown: false, redemptionPeriodMonths: null, postSaleRedemptionMonths: 24, preForeclosureNoticeMonths: 1, statutoryReference: "Tex. Tax Code §34 et seq.", notes: "Hybrid deed/cert: 25% penalty first 6 months; 50% after, on homestead/ag. Non-homestead: 25% / 50%, 6-month redemption." },
  UT: { state: "UT", saleType: "tax_deed", statutoryYieldBps: null, rateIsBidDown: false, redemptionPeriodMonths: null, postSaleRedemptionMonths: 0, preForeclosureNoticeMonths: 1, statutoryReference: "Utah Code §59-2 et seq.", notes: "Deed state; 4-year delinquency triggers tax sale." },
  VT: { state: "VT", saleType: "tax_lien_certificate", statutoryYieldBps: 1200, rateIsBidDown: false, redemptionPeriodMonths: 12, postSaleRedemptionMonths: null, preForeclosureNoticeMonths: 1, statutoryReference: "32 V.S.A. §5252 et seq.", notes: "12% interest; 1-year redemption." },
  VA: { state: "VA", saleType: "tax_deed", statutoryYieldBps: null, rateIsBidDown: false, redemptionPeriodMonths: null, postSaleRedemptionMonths: 0, preForeclosureNoticeMonths: 6, statutoryReference: "Va. Code §58.1-3965 et seq.", notes: "Deed state via judicial sale." },
  WA: { state: "WA", saleType: "tax_deed", statutoryYieldBps: null, rateIsBidDown: false, redemptionPeriodMonths: null, postSaleRedemptionMonths: 0, preForeclosureNoticeMonths: 1, statutoryReference: "RCW §84.64 et seq.", notes: "Deed state; 3-year delinquency triggers tax sale." },
  WV: { state: "WV", saleType: "tax_lien_certificate", statutoryYieldBps: 1200, rateIsBidDown: false, redemptionPeriodMonths: 17, postSaleRedemptionMonths: null, preForeclosureNoticeMonths: 1, statutoryReference: "W.Va. Code §11A-3-1 et seq.", notes: "12% interest; 17-month redemption." },
  WI: { state: "WI", saleType: "tax_deed", statutoryYieldBps: null, rateIsBidDown: false, redemptionPeriodMonths: null, postSaleRedemptionMonths: 24, preForeclosureNoticeMonths: 1, statutoryReference: "Wis. Stat. §75 et seq.", notes: "Deed state; 2-year post-sale redemption." },
  WY: { state: "WY", saleType: "tax_lien_certificate", statutoryYieldBps: 1800, rateIsBidDown: false, redemptionPeriodMonths: 48, postSaleRedemptionMonths: null, preForeclosureNoticeMonths: 3, statutoryReference: "Wyo. Stat. §39-13 et seq.", notes: "18% interest; 4-year redemption (longest in the country)." },
  DC: { state: "DC", saleType: "tax_lien_certificate", statutoryYieldBps: 1800, rateIsBidDown: false, redemptionPeriodMonths: 6, postSaleRedemptionMonths: null, preForeclosureNoticeMonths: 1, statutoryReference: "D.C. Code §47-1330 et seq.", notes: "18% interest; 6-month redemption (very short)." },
};

export function getStateRules(state: string): StateTaxLienRules | null {
  return STATE_TAX_LIEN_RULES[(state || "").toUpperCase()] ?? null;
}
