// ============================================================================
// shared/contracts/bookkeeping.ts — API contract for the bookkeeping page.
// ----------------------------------------------------------------------------
// GET /api/bookkeeping/annual-report?year=YYYY
//
// THE UNIT. Every money field in this response is DOLLARS: a decimal number
// with at most two places (1234.56 means $1,234.56). The server sums payments
// in integer cents (shared/finance/cents.ts) and converts cents → dollars
// exactly ONCE, at the report edge in server/services/bookkeeping.ts. Nothing
// downstream converts again: the page renders these values with the
// dollar-valued formatter (`usd`), never a cents formatter and never `/ 100`.
//
// Why this file exists: the page declared its own response interface, divided
// every dollar figure by 100 a second time ($1,234.56 rendered as $12.35), and
// read a `netProfit` field no endpoint has ever returned (rendered "$NaN").
// Both the server and the page now hold the SAME schema, so a field the page
// reads that the server does not send fails parsing instead of rendering.
//
// ISOMORPHIC: imported by the client bundle and the server — plain zod only.
// ============================================================================

import { z } from "zod";
import type { ApiContract } from "./index";

/** A dollar amount: finite, at most two decimal places. */
const dollars = z
  .number()
  .finite()
  .refine((n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6, {
    message: "a dollar amount carries at most two decimal places",
  });

// STRICT, and exactly what the page renders. The service's report also
// carries borrower contact and tax fields that only the server-side 1099 path
// uses. The response is built by `projectAnnualInterestReport` below and holds
// only what the page renders; a key outside this shape fails the contract.
const bookkeepingNoteSummarySchema = z
  .object({
    noteId: z.number().int(),
    borrowerName: z.string(),
    /** DOLLARS */
    interestCollected: dollars,
    /** DOLLARS */
    principalCollected: dollars,
    /** Interest RECEIVED ≥ $600 in the year — a review flag, not a filing determination. */
    requires1099: z.boolean(),
  })
  .strict();

const annualInterestReportResponseSchema = z
  .object({
    taxYear: z.number().int(),
    /** DOLLARS */
    totalInterestIncome: dollars,
    /** DOLLARS */
    totalPrincipalReceived: dollars,
    /** DOLLARS */
    totalLateFeesCollected: dollars,
    notesWith1099Required: z.number().int().nonnegative(),
    notes: z.array(bookkeepingNoteSummarySchema),
  })
  .strict();

export type AnnualInterestReportResponse = z.infer<typeof annualInterestReportResponseSchema>;

export const annualInterestReportContract: ApiContract<null, typeof annualInterestReportResponseSchema> = {
  method: "GET",
  path: "/api/bookkeeping/annual-report",
  requestSchema: null,
  responseSchema: annualInterestReportResponseSchema,
};

/** The fields of the server's report this projection reads (a structural subset). */
export interface AnnualInterestReportSource {
  taxYear: number;
  totalInterestIncome: number;
  totalPrincipalReceived: number;
  totalLateFeesCollected: number;
  notesWith1099Required: number;
  notes: Array<{
    noteId: number;
    borrowerName: string;
    interestCollected: number;
    principalCollected: number;
    requires1099: boolean;
  }>;
}

/**
 * Build the response from the full report by NAMING every field it carries —
 * an allowlist, so a field added to the report later (or the borrower PII it
 * already holds) never reaches the browser by default.
 */
export function projectAnnualInterestReport(report: AnnualInterestReportSource): AnnualInterestReportResponse {
  return {
    taxYear: report.taxYear,
    totalInterestIncome: report.totalInterestIncome,
    totalPrincipalReceived: report.totalPrincipalReceived,
    totalLateFeesCollected: report.totalLateFeesCollected,
    notesWith1099Required: report.notesWith1099Required,
    notes: report.notes.map((n) => ({
      noteId: n.noteId,
      borrowerName: n.borrowerName,
      interestCollected: n.interestCollected,
      principalCollected: n.principalCollected,
      requires1099: n.requires1099,
    })),
  };
}
