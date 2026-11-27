/**
 * The commercial acquisition/hold form (engine `commercial_underwrite`).
 * Conventions: shared/economics/engineFields.ts.
 *
 * Every line is a RECORDED figure — the price the operator entered, the
 * recorded leases' rents, the recoveries on recorded CAM reconciliations,
 * the operating expenses measured from the expense records. There is no
 * market rent, no comp and no assumed expense anywhere in this form: with
 * no measured expenses and no ratio of the operator's own, the engine
 * returns no NOI rather than an invented one.
 */
import type { EngineField } from "../engineFields";

export const COMMERCIAL_UNDERWRITE_FIELDS: readonly EngineField[] = [
  { key: "purchasePriceCents", label: "Price you are underwriting ($)", unit: "cents", min: 1, hint: "The price you entered for this acquisition — the cap rate's denominator. It is not a market value or an assessed value, and nothing substitutes one." },
  { key: "leaseCount", label: "Recorded leases", unit: "count", min: 1, hint: "How many leases are recorded on the property. With none recorded there is no in-place income to underwrite." },
  { key: "baseMonthlyRentCents", label: "Recorded base rent ($/month)", unit: "cents", min: 0, hint: "The recorded leases' base monthly rent, before any rent-schedule step takes effect." },
  { key: "escalatedMonthlyRentCents", label: "In-place rent as of the month below ($/month)", unit: "cents", min: 0, hint: "The same recorded rent with the recorded rent-schedule steps applied as of the as-of month. Equal to the base rent when no step is in effect." },
  { key: "expiringWithin12MonthsMonthlyRentCents", label: "Rent expiring within 12 months ($/month)", unit: "cents", min: 0, hint: "The in-place rent on recorded leases whose terms end within twelve months of the as-of month — the rollover exposure." },
  { key: "camRecoveriesMonthlyCents", label: "CAM recoveries ($/month)", unit: "cents", optional: true, min: 0, hint: "Monthly recoveries from recorded CAM reconciliations only. Left empty, recoveries are excluded and the result says so — none is assumed." },
  { key: "rentableSqft", label: "Rentable area (sq ft)", unit: "number", optional: true, min: 1, hint: "The recorded rentable area, for the per-square-foot figures. Left empty, those figures are not computed." },
  { key: "measuredOpExMonthlyCents", label: "Measured operating expenses ($/month)", unit: "cents", optional: true, min: 0, hint: "Operating expenses measured from the property's expense records. Required when the row count below is above zero." },
  { key: "measuredOpExRowCount", label: "Expense records measured", unit: "count", min: 0, hint: "How many expense records the measured figure comes from. Zero means expenses are unmeasured — enter 0 only if nothing was measured." },
  { key: "measuredOpExMonthsCovered", label: "Months the measured expenses cover", unit: "count", min: 0, hint: "The span the measured expense records cover, in whole months." },
  { key: "opExBps", label: "— or your expense ratio (basis points of income)", unit: "number", optional: true, min: 0, max: 10000, hint: "Your own ratio, used only when expenses are unmeasured: 3500 is 35% of income. Leave empty if you entered measured expenses — and with neither, the engine returns no NOI." },
  { key: "asOfMonth", label: "As of month (YYYY-MM)", unit: "month", hint: "The month the in-place figures are read as of. Rent steps and the twelve-month rollover window are measured from it." },
];
