/**
 * The founder decisions the W3 acquisition engine is waiting on — all three
 * are pricing-class hard stops, so each surface ships refusing until its
 * value is set. Read by the founder's Controls section, so an open decision is
 * visible where the founder works rather than buried in a config file.
 */
import { CREATOR_PROGRAM } from "@shared/billing/creatorProgram";
import { FOUNDING_MEMBER_OFFER } from "@shared/billing/foundingMemberOffer";
import { PARCEL_DD_REPORT } from "@shared/billing/parcelReportProduct";

export interface AcquisitionDecision {
  key: "creator_commission_rate" | "founding_member_yearly" | "parcel_dd_report_price";
  question: string;
  status: "pending" | "set";
  value: string | null;
  whereToSet: string;
}

export function pendingAcquisitionDecisions(): AcquisitionDecision[] {
  const fm = FOUNDING_MEMBER_OFFER;
  const fmSet = fm.tier !== null && fm.priceYearlyCents !== null;
  return [
    {
      key: "creator_commission_rate",
      question: "What commission do creators earn on a paid conversion, and is it paid on every invoice or only the first year?",
      status: CREATOR_PROGRAM.commissionBps === null ? "pending" : "set",
      value: CREATOR_PROGRAM.commissionBps === null ? null : `${CREATOR_PROGRAM.commissionBps / 100}% of the amount paid`,
      whereToSet: "shared/billing/creatorProgram.ts (CREATOR_PROGRAM.commissionBps)",
    },
    {
      key: "founding_member_yearly",
      question: "Which plan do founding members get, at what yearly price? (No lifetime deals.)",
      status: fmSet ? "set" : "pending",
      value: fmSet ? `${fm.tier} at $${(fm.priceYearlyCents! / 100).toFixed(2)} a year` : null,
      whereToSet: "shared/billing/foundingMemberOffer.ts, plus a yearly Stripe price in STRIPE_PRICE_FOUNDING_MEMBER_YEARLY and the offer.founding_member_yearly flag",
    },
    {
      key: "parcel_dd_report_price",
      question: "What does one per-parcel due-diligence report cost, in credits?",
      status: PARCEL_DD_REPORT.priceCents === null ? "pending" : "set",
      value: PARCEL_DD_REPORT.priceCents === null ? null : `$${(PARCEL_DD_REPORT.priceCents / 100).toFixed(2)} in credits`,
      whereToSet: "shared/billing/parcelReportProduct.ts (PARCEL_DD_REPORT.priceCents)",
    },
  ];
}
