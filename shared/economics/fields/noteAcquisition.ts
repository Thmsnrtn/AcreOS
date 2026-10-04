/**
 * The note acquisition form (engine `note_acquisition`).
 * Conventions: shared/economics/engineFields.ts.
 */
import type { EngineField } from "../engineFields";

export const NOTE_ACQUISITION_FIELDS: readonly EngineField[] = [
  { key: "unpaidPrincipalCents", label: "Unpaid principal balance ($)", unit: "cents", min: 1, hint: "The balance still owed today, from the payment history — not the original loan amount." },
  { key: "noteRatePct", label: "Note rate (%)", unit: "percent", min: 0, max: 30, hint: "The interest rate written on the note." },
  { key: "remainingTermMonths", label: "Remaining term (months)", unit: "months", min: 1, max: 480, hint: "Payments left on the amortization schedule. For a note that balloons early, this is the full schedule (e.g. 300 on a 30-year note five years in), not the months to the balloon — enter the balloon month below." },
  { key: "monthlyPaymentCents", label: "Monthly payment ($)", unit: "cents", optional: true, min: 1, hint: "Principal and interest only, as written on the note. Leave empty to use the level payment for this balance, rate and term." },
  { key: "purchasePriceCents", label: "Purchase price ($)", unit: "cents", min: 1, hint: "What you would pay the seller for the note." },
  { key: "closingCostsCents", label: "Closing and due-diligence costs ($)", unit: "cents", optional: true, min: 0, hint: "Title, BPO, collateral file review, legal and servicing set-up. Left empty, they are excluded, and the result says so." },
  { key: "balloonMonth", label: "Balloon month", unit: "months", optional: true, min: 1, max: 480, hint: "Months from purchase until the remaining balance falls due, if the note has a balloon. Leave empty if it pays to the end of the term." },
];
