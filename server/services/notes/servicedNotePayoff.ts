/**
 * The one payoff quote for a SERVICED note (the `notes` book), computed by the
 * canonical engine and recorded (DEFECT-0097, DEFECT-0100).
 *
 * Two surfaces price a serviced note's payoff: the borrower portal
 * (`GET /api/borrower/payoff-quote`) and the operations agent's
 * `processPayoff` skill. The skill computed its own number — interest accrued
 * from the NEXT due date rather than the last payment, an early-payoff
 * "discount" of 2–3% of principal that no note contains, a 30-day validity,
 * rows in the legacy `payoff_quotes` table — so the same note could be quoted
 * two different amounts depending on who asked. Both now call this.
 *
 * The number comes from `computePayoffQuote` over inputs derived by
 * `payoffInputsFromServicedNote` from the note and its OWN completed payment
 * ledger; the row goes to `note_payoff_quotes`.
 */

import { storage, db } from "../../storage";
import { notePayoffQuotes, type Note, type NotePayoffQuote, type PayoffQuoteChannel } from "@shared/schema";
import {
  computePayoffQuote,
  payoffInputsFromServicedNote,
  isoDateUtc,
  PAYOFF_DAY_COUNT_CONVENTION,
  PAYOFF_ENGINE_VERSION,
  type PayoffQuote,
} from "../notePaymentMath";
import { dayInZone } from "../form1098Batch";

export async function quoteServicedNotePayoff(args: {
  note: Note;
  payoffDate: Date;
  /** The LENDER's zone — which calendar day a posting instant fell on. */
  lenderTimeZone: string;
  channel: PayoffQuoteChannel;
  payerName: string | null;
  quotedByUserId: string | null;
  /** Free-text provenance stored in `notes` (e.g. `borrower_session:<id>`). */
  provenance: string;
}): Promise<{ quote: PayoffQuote; row: NotePayoffQuote; ledgerRowsConsidered: number }> {
  const { note, payoffDate, lenderTimeZone } = args;

  // The accrual start comes from the ledger — the most recent COMPLETED
  // posting that carried interest — never from a schedule guess. Pending
  // and failed rows settle nothing; refund reversals carry non-positive
  // interest and are ignored by the engine.
  const ledger = (await storage.getPayments(note.organizationId, note.id)).filter(
    (p) => p.status === "completed",
  );
  // `payments.payment_date` is a TIMESTAMP; the engine counts whole days
  // between calendar dates. Handing it the instant floors a 09:30 posting
  // to one day fewer than the calendar says (measured: 11 days for
  // Aug 3 → Aug 15). Interest is settled THROUGH the day the payment
  // posted, and which day an instant fell on is a question about the
  // LENDER's zone — the same rule Form 1098 Box 1 uses (dayInZone's header
  // has what answering it with the server's zone cost).
  const input = payoffInputsFromServicedNote({
    note: {
      currentBalance: note.currentBalance,
      interestRate: note.interestRate,
      startDate: dayInZone(note.startDate, lenderTimeZone) ?? note.startDate,
    },
    ledgerRows: ledger.map((p) => ({
      paymentDate: dayInZone(p.paymentDate, lenderTimeZone) ?? p.paymentDate,
      interestAmount: p.interestAmount,
    })),
    payoffDate,
    // The servicing book has no unapplied-funds column (an overpayment's
    // residue is recorded as an activity, not a balance — DEFECT-0098) and
    // does not separate late fees ASSESSED from late fees COLLECTED
    // (`payments.late_fee_amount` is collected — DEFECT-0099). 0 here is the
    // absence of a tracked term, not an estimate — callers say so rather than
    // asserting nothing is owed.
    unappliedCreditCents: 0,
    lateFeesOutstandingCents: 0,
    // No org-configured payoff fee exists for serviced notes.
    payoffFeeCents: 0,
  });
  const quote = computePayoffQuote(input);

  const [row] = await db
    .insert(notePayoffQuotes)
    .values({
      organizationId: note.organizationId,
      noteSystem: "serviced_note",
      noteRef: String(note.id),
      noteNumber: null,
      payerName: args.payerName,
      quotedByUserId: args.quotedByUserId,
      channel: args.channel,
      payoffDate: quote.payoffDate,
      // The engine accrues interest THROUGH payoffDate, so that IS the last
      // date the quoted total is valid.
      goodThroughDate: quote.payoffDate,
      principalBalanceCents: quote.principalBalanceCents,
      annualRateBpsHundredths: Math.round(quote.annualRateBps * 100),
      accrualStartDate: quote.accrualStartDate,
      daysAccrued: quote.daysAccrued,
      dayCountConvention: quote.dayCountConvention,
      perDiemInterestCents: quote.perDiemInterestCents,
      accruedInterestCents: quote.accruedInterestCents,
      unappliedCreditCents: quote.unappliedCreditCents,
      lateFeesOutstandingCents: quote.lateFeesOutstandingCents,
      payoffFeeCents: quote.payoffFeeCents,
      totalPayoffCents: quote.totalPayoffCents,
      engineVersion: quote.engineVersion,
      engineInputJson: {
        principalBalanceCents: input.principalBalanceCents,
        annualRateBps: input.annualRateBps,
        accrualStartDate: isoDateUtc(input.accrualStartDate),
        payoffDate: isoDateUtc(input.payoffDate),
        unappliedCreditCents: input.unappliedCreditCents ?? 0,
        lateFeesOutstandingCents: input.lateFeesOutstandingCents ?? 0,
        payoffFeeCents: input.payoffFeeCents ?? 0,
        dayCountConvention: PAYOFF_DAY_COUNT_CONVENTION,
        engineVersion: PAYOFF_ENGINE_VERSION,
        ledgerRowsConsidered: ledger.length,
      },
      notes: args.provenance,
    })
    .returning();

  return { quote, row, ledgerRowsConsidered: ledger.length };
}
