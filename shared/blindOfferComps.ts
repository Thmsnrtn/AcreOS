/**
 * Which rows count as a comparable SALE for a blind offer (DEFECT-0107/0122).
 *
 * The offer is "a quarter of the lowest comparable sale from the last 12–18
 * months". Every clause of that sentence is a rule, and each used to be
 * unenforced somewhere:
 *
 * - a SALE: USDA county averages and the synthetic estimate trend were
 *   pushed into the comp set as "comps" (DEFECT-0107);
 * - with a PRICE: a row with no positive price per acre is not a sale;
 * - DATED and RECENT: an undated or ten-year-old sale could set a mailed
 *   price, because nothing checked (DEFECT-0122).
 *
 * One rule, imported by the calculator (server/services/blindOfferCalculator.ts)
 * and by the wizard's live "lowest comp" preview, so the number the operator
 * sees while entering comps is the number the calculator will use.
 * Pure and browser-safe: no Node or server imports.
 */

/** 18 months, the outer edge of the formula's window. */
const COMP_WINDOW_DAYS = 548;

const BENCHMARK_SOURCES = new Set(["usda_nass", "estimate"]);

export type CompExclusion = "benchmark" | "no_price" | "undated" | "stale" | "future_dated";

export interface CompCandidate {
  pricePerAcre: number;
  source: string;
  saleDate?: string | null;
}

/** Null when the row counts as a comparable sale at `now`; otherwise why not. */
export function compExclusion(c: CompCandidate, now: Date): CompExclusion | null {
  if (BENCHMARK_SOURCES.has(c.source)) return "benchmark";
  if (typeof c.pricePerAcre !== "number" || !Number.isFinite(c.pricePerAcre) || c.pricePerAcre <= 0) {
    return "no_price";
  }
  const sold = c.saleDate ? Date.parse(c.saleDate) : Number.NaN;
  if (!Number.isFinite(sold)) return "undated";
  // One day of slack for a sale recorded "today" in a later time zone.
  if (sold > now.getTime() + 24 * 60 * 60 * 1000) return "future_dated";
  if (now.getTime() - sold > COMP_WINDOW_DAYS * 24 * 60 * 60 * 1000) return "stale";
  return null;
}

const EXCLUSION_LABEL: Record<CompExclusion, string> = {
  benchmark: "USDA / estimated benchmarks are not sales",
  no_price: "no positive price per acre",
  undated: "no sale date",
  stale: "sold more than 18 months ago",
  future_dated: "sale date is in the future",
};

export function describeCompExclusion(reason: CompExclusion): string {
  return EXCLUSION_LABEL[reason];
}
