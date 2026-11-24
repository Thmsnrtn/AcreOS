/**
 * The certificate-ledger entry input — ONE schema and ONE future-date rule for
 * every door that records a ledger entry (the REST route AND the Pax tool), so
 * a door cannot accept what the other refuses. Pure; no database.
 */
import { z } from "zod";
import { isCalendarDate } from "@shared/dates/calendar";

const ledgerSource = z.string().trim().min(1).max(500);
const ledgerDate = z.string().refine(isCalendarDate, "a calendar date (YYYY-MM-DD)");

export const ledgerEntrySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("subsequent_tax_paid"), paidOn: ledgerDate, amountCents: z.number().int().positive(), taxYear: z.string().regex(/^\d{4}$/).nullable(), source: ledgerSource }),
  // A notice the OPERATOR sent, outside AcreOS, recorded after the fact.
  // Notices sent in-product through the rail are recorded by the rail
  // itself, from the provider's receipt — never through this entry.
  z.object({ kind: z.literal("redemption_notice_recorded"), sentOn: ledgerDate, method: z.string().trim().min(1).max(200), note: z.string().trim().max(1_000).nullable(), source: ledgerSource }),
  z.object({ kind: z.literal("foreclosure_filing_deadline"), date: ledgerDate, source: ledgerSource }),
]);

export type LedgerEntryInput = z.infer<typeof ledgerEntrySchema>;

/** The date an entry says something HAPPENED on (null for a deadline, which is a future date by nature). */
export function happenedOnOf(e: LedgerEntryInput): string | null {
  return e.kind === "subsequent_tax_paid" ? e.paidOn : e.kind === "redemption_notice_recorded" ? e.sentOn : null;
}
