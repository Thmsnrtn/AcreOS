/**
 * The tax-lien bid form (engine `tax_lien_bid`).
 * Conventions: shared/economics/engineFields.ts.
 *
 * The premium treatment is a choice between three named rules. The form shows
 * them as labelled options (EngineField.options) and the wire carries a code;
 * the engine maps the code to the named rule and freezes the NAME in the
 * scenario's inputs, so a recorded scenario reads "forfeited", never "3". The
 * engine also accepts the name itself. This map is the one place the codes are
 * defined.
 */
import type { EngineField } from "../engineFields";
import type { PremiumTreatment } from "../../calculators/taxLienBid";

export const PREMIUM_TREATMENT_BY_CODE: Readonly<Record<number, PremiumTreatment>> = {
  1: "refunded_with_interest",
  2: "refunded_no_interest",
  3: "forfeited",
};

export const TAX_LIEN_BID_FIELDS: readonly EngineField[] = [
  { key: "faceAmountCents", label: "Certificate face amount ($)", unit: "cents", min: 0.01, hint: "The delinquent taxes, interest and costs the certificate is sold for, from the county's sale list." },
  { key: "premiumCents", label: "Premium above face ($)", unit: "cents", min: 0, hint: "What you bid on top of the face amount. Enter 0 if you are bidding face only. Zero is a real bid, so the field is not optional." },
  { key: "interestRatePct", label: "Interest rate the certificate earns (% a year)", unit: "percent", min: 0, max: 100, hint: "In a fixed-rate state, the statutory rate. In a bid-down state, the rate you bid at auction. Modelled as simple interest on face, for the months until redemption. Check the State rules page for your state; only the rate you enter here is used." },
  { key: "penaltyPct", label: "Redemption penalty (% of face)", unit: "percent", optional: true, min: 0, max: 100, hint: "A one-time charge on face that the owner pays on redemption, in states that have one. Left empty, no penalty is counted, and the result says so." },
  {
    key: "premiumTreatment",
    label: "What happens to the premium on redemption",
    unit: "count",
    min: 1,
    max: 3,
    options: [
      { value: 1, label: "Refunded with interest" },
      { value: 2, label: "Refunded, no interest" },
      { value: 3, label: "Forfeited" },
    ],
    hint: "States differ — check your state's rule. With interest means at the certificate's rate.",
  },
  { key: "acquisitionCostsCents", label: "Registration and admin fees ($)", unit: "cents", optional: true, min: 0, hint: "What you pay to bid and buy beyond the certificate itself. Treated as not recovered at redemption. Left empty, they are excluded, and the result says so." },
  { key: "redemptionMonth", label: "Owner redeems in month", unit: "months", min: 1, max: 360, hint: "Months from purchase until you expect the owner to pay off the certificate. Every return shown is the result IF they redeem then." },
];
