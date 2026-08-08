// ============================================================================
// SHARED/RENTAL/PROPERTYEXPENSE.TS — the expense axis (Wave 3, multifamily → core)
// ----------------------------------------------------------------------------
// Pure and browser-safe: no imports, no DB, no `process`. The server derives
// `isOperating` from this file, the client renders categories from it, and the
// writer test exercises it directly — one source of truth for "what kinds of
// money a rental operator spends, and which of them belong in NOI".
//
// WHY THIS EXISTS
// ───────────────
// Until this axis, the product held rent (an income line) and maintenance
// invoices (one narrow slice of spend), and NOTHING else. Net operating income
// was therefore assumed — the standing shortcut was "NOI ≈ 60% of rent", i.e.
// a flat 40%-of-rent expense guess baked into every projection. A guessed
// expense ratio is a fabricated number wearing a plausible costume: a building
// with a new roof and one with a failing one get the same NOI, and the operator
// cannot see the difference the product claims to manage. `property_expenses`
// is the LEDGER that replaces the guess with what the operator actually spent.
//
// SCHEDULE-E SHAPE, DELIBERATELY
// ──────────────────────────────
// The categories mirror IRS Schedule E (Form 1040) line items for rental real
// estate, because that is the vocabulary the operator already keeps their books
// in and files their taxes from. Matching it means an expense entered here is an
// expense they can reconcile against their return, not a fourth private taxonomy
// they have to translate. Two of the fourteen lines — mortgage interest and
// depreciation — are stored for Schedule-E COMPLETENESS but are NOT operating
// expenses, and must never enter NOI (see isOperatingCategory).
//
// MONEY POSTURE (founder ruling "be the rail, not the provider")
// ──────────────────────────────────────────────────────────────
// This is a record of money the operator ALREADY spent, elsewhere, on their own
// account. Nothing on this axis moves, holds, collects or charges a cent. An
// expense row is a fact the operator asserts about their own books; the product
// stores and totals it, and takes no custody of anything.
// ============================================================================

/**
 * The rental-expense categories, Schedule-E-shaped. The order is the order a
 * Schedule E lists them, so a category picker reads like the form the operator
 * already knows. Two are NON-operating (mortgage_interest, depreciation) — see
 * isOperatingCategory. `other` is the honest catch-all: a spend that is real but
 * does not fit a named line is recorded as `other` rather than mis-filed into a
 * line it does not belong to.
 */
export const PROPERTY_EXPENSE_CATEGORIES = [
  "advertising",
  "cleaning_maintenance",
  "repairs",
  "insurance",
  "legal_professional",
  "management_fees",
  "commissions",
  "supplies",
  "taxes",
  "utilities",
  "auto_travel",
  "mortgage_interest", // NON-operating — a financing cost, below the NOI line
  "depreciation", // NON-operating — a non-cash allowance, never in NOI
  "other",
] as const;

export type PropertyExpenseCategory = typeof PROPERTY_EXPENSE_CATEGORIES[number];

/**
 * The two Schedule-E lines that are stored but are NOT operating expenses.
 *
 *   - mortgage_interest is a FINANCING cost. NOI is deliberately defined above
 *     the capital stack ("net OPERATING income") precisely so a levered and an
 *     unlevered owner of the same building compute the SAME NOI — putting debt
 *     service into NOI would make the number depend on how the building was
 *     financed rather than on how it operates, and every cap-rate and DSCR built
 *     on it would be wrong.
 *   - depreciation is a NON-CASH tax allowance. No dollar leaves the operator's
 *     account for it; it exists to reduce taxable income, not to measure the
 *     cost of running the building. Folding it into NOI double-counts the roof
 *     (once as the repair that replaced it, again as the depreciation of it) and
 *     understates operating performance.
 *
 * Both are still worth STORING: the operator files them on Schedule E, so a
 * ledger that could not hold them would force them to keep a second set of
 * books. They are captured here and excluded from NOI there — the exclusion
 * lives in this one predicate so no call site re-decides it.
 */
const NON_OPERATING_CATEGORIES: ReadonlySet<PropertyExpenseCategory> = new Set([
  "mortgage_interest",
  "depreciation",
]);

/**
 * True when a category counts toward net OPERATING income; false for the two
 * financing/non-cash lines that are stored for Schedule-E completeness but never
 * belong in NOI. Total over PROPERTY_EXPENSE_CATEGORIES — every category has a
 * definite answer, so the server can derive `isOperating` for any stored row
 * without a fallback branch that could quietly mis-classify an unknown value.
 */
export function isOperatingCategory(category: PropertyExpenseCategory): boolean {
  return !NON_OPERATING_CATEGORIES.has(category);
}

/**
 * Human-readable label per category, for pickers and ledger rows. Kept here so
 * the display noun and the stored token cannot drift — a category renamed on the
 * screen but not in the enum (or the reverse) is exactly how a "Repairs" filter
 * quietly stops matching `repairs`.
 */
export const PROPERTY_EXPENSE_CATEGORY_LABELS: Record<PropertyExpenseCategory, string> = {
  advertising: "Advertising",
  cleaning_maintenance: "Cleaning & maintenance",
  repairs: "Repairs",
  insurance: "Insurance",
  legal_professional: "Legal & professional",
  management_fees: "Management fees",
  commissions: "Commissions",
  supplies: "Supplies",
  taxes: "Taxes",
  utilities: "Utilities",
  auto_travel: "Auto & travel",
  mortgage_interest: "Mortgage interest",
  depreciation: "Depreciation",
  other: "Other",
};

/**
 * Where an expense came from. `manual` is an operator-entered row; the operator
 * asserted it. `maintenance_invoice` is a completed maintenance ticket's invoice
 * rolled into the ledger — the same money, promoted from the tickets table to
 * the expense axis so it counts against NOI exactly once. Kept as a const array
 * so the schema default and the roll-in writer share one vocabulary.
 */
export const PROPERTY_EXPENSE_SOURCES = ["manual", "maintenance_invoice"] as const;
export type PropertyExpenseSource = typeof PROPERTY_EXPENSE_SOURCES[number];
