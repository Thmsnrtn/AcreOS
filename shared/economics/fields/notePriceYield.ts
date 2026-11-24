/**
 * The note price-to-yield form (engine `note_price_yield`).
 * Conventions: shared/economics/engineFields.ts. The pricing inputs are all
 * required — a price invented from a default is a number the operator cannot
 * defend. Rates are typed as percentage points; the engine converts them to
 * the basis points the pricing function speaks.
 */
import type { EngineField } from "../engineFields";

export const NOTE_PRICE_YIELD_FIELDS: readonly EngineField[] = [
  { key: "currentBalanceCents", label: "Unpaid balance ($)", unit: "cents", min: 1, hint: "What the borrower still owes today — the face you are discounting." },
  { key: "noteRatePct", label: "Note rate (%)", unit: "percent", min: 0, max: 100, hint: "The rate written on the note, not the yield you want." },
  { key: "paymentAmountCents", label: "Monthly payment ($)", unit: "cents", min: 1, hint: "The scheduled principal-and-interest payment on the tape." },
  { key: "remainingTermMonths", label: "Payments remaining", unit: "months", min: 1, max: 1200 },
  { key: "targetYieldPct", label: "Your target yield (%)", unit: "percent", min: 0.01, max: 200, hint: "The annual yield you require. The price below is the most you can pay and still earn it." },
  { key: "balloonAmountCents", label: "Balloon amount ($)", unit: "cents", optional: true, min: 1, hint: "Only for a balloon note — and only together with the balloon month." },
  { key: "balloonMonth", label: "Balloon falls due with payment #", unit: "months", optional: true, min: 1, max: 1200, hint: "Counted from today: payment 1 is the next scheduled payment." },
  { key: "acquisitionCostsCents", label: "Acquisition costs ($)", unit: "cents", optional: true, min: 0, hint: "Diligence, closing and servicing setup. Left empty, total cost is the price alone — and the result says so." },
];
