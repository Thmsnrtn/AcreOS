/**
 * The per-parcel due-diligence report as a paid product (W3). Browser-safe.
 *
 * Runs on the existing CREDIT rail (creditService.deductCredits — credits are
 * cents of prepaid AcreOS balance), so no new payment path exists. The report's
 * content is the same accuracy-gated facts and data-truth warnings the public
 * parcel page shows (publicLandFactsOf), packaged for the buyer to keep.
 *
 * Pricing is a founder-only hard stop: the price ships UNSET and every
 * purchase is refused until the founder sets it (a code change recorded in
 * docs/company/founder-decisions-*.md).
 */
export const PARCEL_DD_REPORT: {
  /** Price in credit cents. null = not decided. */
  priceCents: number | null;
  rail: "credits";
  decidedOn: string | null;
  decisionRecord: string | null;
} = {
  priceCents: null,
  rail: "credits",
  decidedOn: null,
  decisionRecord: null,
};

export const DD_REPORT_PRICE_UNSET =
  "The parcel due-diligence report is not for sale yet: its price has not been set.";

/** credit_transactions.metadata.kind of a report purchase. */
export const DD_REPORT_CREDIT_KIND = "parcel_dd_report";
