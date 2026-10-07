/**
 * The bookkeeping page's CSV export, as a pure function of the report.
 *
 * Money cells are DOLLARS straight from the report (see
 * shared/contracts/bookkeeping.ts — the server converts cents → dollars once).
 * This used to divide every value by 100 again, so a year with $1,234.56 of
 * interest exported as 12.35. A value that is not a finite number is written
 * as "N/A" rather than "NaN".
 */
import type { AnnualInterestReportResponse } from "@shared/contracts";

const CSV_NOT_AVAILABLE = "N/A";

export function csvDollars(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : CSV_NOT_AVAILABLE;
}

export function buildBookkeepingCsv(report: AnnualInterestReportResponse): string {
  const lines = [
    "Note ID,Borrower,Interest collected,Principal collected,Interest received >= $600 (review)",
    ...report.notes.map((n) =>
      [
        n.noteId,
        JSON.stringify(n.borrowerName ?? ""),
        csvDollars(n.interestCollected),
        csvDollars(n.principalCollected),
        n.requires1099 ? "yes" : "no",
      ].join(","),
    ),
    "",
    `Total interest,${csvDollars(report.totalInterestIncome)}`,
    `Total principal,${csvDollars(report.totalPrincipalReceived)}`,
    `Total late fees,${csvDollars(report.totalLateFeesCollected)}`,
    `Notes with >= $600 interest received (review),${report.notesWith1099Required}`,
  ];
  return lines.join("\n");
}
