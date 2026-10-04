/**
 * The short-term rental acquisition form (engine `str_acquisition`).
 * Conventions: shared/economics/engineFields.ts.
 */
import type { EngineField } from "../engineFields";

export const STR_ACQUISITION_FIELDS: readonly EngineField[] = [
  { key: "purchasePriceCents", label: "Purchase price ($)", unit: "cents", min: 1 },
  { key: "closingCostsCents", label: "Closing costs ($)", unit: "cents", optional: true, min: 0, hint: "Left empty, closing costs are excluded — and the result says so." },
  { key: "furnishingCents", label: "Furnishing and setup ($)", unit: "cents", optional: true, min: 0, hint: "Furniture, linens, kitchenware, locks and photos to get it ready to book. Left empty, it is excluded — and the result says so." },
  { key: "averageDailyRateCents", label: "Average nightly rate ($)", unit: "cents", min: 0, hint: "What a guest pays per night on average across the year, before cleaning fee and lodging tax. Your own figure — no market rate is looked up." },
  { key: "occupancyPct", label: "Occupancy (% of nights available)", unit: "percent", min: 0, max: 100, hint: "Share of the nights you offer that are actually booked, averaged across the year — slow season included." },
  { key: "nightsAvailablePerYear", label: "Nights available per year", unit: "count", min: 1, max: 366, hint: "Nights you offer for booking. Leave out nights you block for yourself, for repairs, or because local rules cap them." },
  { key: "avgStayNights", label: "Average stay (nights)", unit: "number", min: 1, hint: "Average nights per booking. Booked nights ÷ average stay is how many turnovers you clean in a year." },
  { key: "cleaningCostPerTurnoverCents", label: "Cleaning cost per turnover ($)", unit: "cents", min: 0, hint: "What you pay the cleaner after each stay, laundry and restocking included." },
  { key: "cleaningFeePerStayCents", label: "Cleaning fee charged per stay ($)", unit: "cents", optional: true, min: 0, hint: "What the guest pays you per booking. Left empty, no cleaning-fee income is counted — and the result says so." },
  { key: "platformFeePct", label: "Platform / channel fee (% of booking revenue)", unit: "percent", min: 0, max: 100, hint: "The booking platform's host fee, plus any channel manager charged as a share of bookings." },
  { key: "managementPct", label: "Management (% of booking revenue)", unit: "percent", min: 0, max: 100, hint: "Your co-host or manager's cut. Enter your own time's worth if you self-manage — it is not free." },
  { key: "monthlyFixedCostsCents", label: "Fixed costs, monthly ($)", unit: "cents", min: 0, hint: "Utilities, internet, insurance, property taxes, HOA and software you pay whether or not it is booked." },
  { key: "reservesPct", label: "Reserves (% of booking revenue)", unit: "percent", min: 0, max: 100, hint: "Set aside for repairs, replacements and guest wear and tear." },
  { key: "downPaymentPct", label: "Down payment (%)", unit: "percent", optional: true, min: 0, max: 100, hint: "Leave empty to model an all-cash purchase." },
  { key: "interestRatePct", label: "Interest rate (%)", unit: "percent", optional: true, min: 0, max: 30, hint: "Required when the purchase is financed." },
  { key: "amortizationYears", label: "Amortization (years)", unit: "count", optional: true, min: 1, max: 40, hint: "Required when the purchase is financed." },
];
