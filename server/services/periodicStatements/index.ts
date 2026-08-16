/**
 * periodicStatements — §1026.41 periodic statements for closed-end
 * consumer-purpose dwelling loans.
 *
 * 12 C.F.R. §1026.41(b): the servicer must deliver a periodic statement
 * for each billing cycle. (d) enumerates the required content. (b)(2)
 * sets the timing: the statement must be delivered no later than a
 * reasonably prompt time before the next payment is due — industry
 * standard 21 days before due_date.
 *
 * This module:
 *  1. Selects the loans whose cycle ends in the given asOfDate window.
 *  2. For each, computes every required field per §1026.41(d).
 *  3. Persists one `periodic_statements` row per (loan, cycleStart).
 *     Idempotent — re-running the generator for a cycle that already
 *     has a row is a no-op (per the unique index).
 *  4. Returns a summary used by the cron job for logging + alerting.
 *
 * PDF rendering + email delivery live in companion files:
 *   - ./pdf.ts        renders the persisted row to a pdfkit document
 *   - ./delivery.ts   sends the borrower-facing notification email
 *                     with a link to the secured portal URL (never an
 *                     attachment — Beatrice's directive: PDFs in email
 *                     create discovery risk + bounce-rate hits)
 *
 * Performance target (Iris's elite bar): generation completes within
 * 30s for orgs with up to 5000 active loans. The hot path is one
 * SELECT per loan + one INSERT per loan; both are indexed. At 5k
 * loans that's ~10k queries — well under 30s on a warm pool.
 */

import { db } from "../../db";
import { notes } from "@shared/schema";
import { deriveNextPaymentDate } from "../notes/acquiredNoteSchedule";
import {
  periodicStatements,
  periodicStatementSkips,
  type InsertPeriodicStatement,
} from "@shared/schema/reg-z";
import { paymentApplications } from "@shared/schema/reg-z";
import { acquiredNotes, type AcquiredNote } from "@shared/schema/notes-vertical";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { logger } from "../../utils/logger";
import { qualifiesForRegZStatement } from "./predicate";
import { parseCalendarDate } from "@shared/dates/calendar";

// HUD-approved housing counsellor hotline — §1026.41(d)(8) mandates
// disclosure when the borrower is 45+ days delinquent. The hotline
// number is set by HUD and rarely changes; we hardcode rather than
// pull from a per-org config because the value IS the regulation.
const HUD_HOUSING_COUNSELOR_PHONE = "800-569-4287";
const HUD_HOUSING_COUNSELOR_URL =
  "https://www.hud.gov/findacounselor";

// §1026.41(b)(2): industry-standard 21-day window between statement
// delivery and next payment due.
const DELIVERY_LEAD_DAYS = 21;

// §1026.41(d)(8): delinquency disclosure threshold.
const DELINQUENCY_DISCLOSURE_THRESHOLD_DAYS = 45;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Why a (loan, cycle) produced no statement. Machine code + operator-facing
 * reason + the §-section that authorises the refusal — the same shape the
 * 1098/1099 batch services use for their refusals, and the same pair the
 * skip ledger persists.
 */
export type StatementSkipCode =
  | "PREDICATE_OUT_OF_SCOPE"
  | "NO_DERIVABLE_DUE_DATE";

export interface StatementSkip {
  loanId: string;
  noteTable: "notes" | "acquired_notes";
  code: StatementSkipCode;
  reason: string;
  citation: string;
}

/**
 * The §-section that authorises refusing to generate rather than printing a
 * due date we cannot support. §1026.41(d)(1) makes the payment due date a
 * REQUIRED disclosure — so a statement bearing a fabricated one is not a
 * lesser version of compliance, it is an inaccurate consumer disclosure.
 * Not generating is recoverable (backfill); telling a borrower the wrong
 * date is not.
 */
export const DUE_DATE_REFUSAL_CITATION =
  "12 C.F.R. §1026.41(d)(1) — the payment due date is a required disclosure; AcreOS refuses to state a due date it cannot derive from the note's own schedule.";

function noDerivableDueDateReason(
  noteTable: "notes" | "acquired_notes",
  loanId: string,
  detail: string,
): string {
  return `No payment due date could be derived for ${noteTable} ${loanId} (${detail}). Refusing to generate a §1026.41 periodic statement rather than print a due date the note does not support.`;
}

export interface GenerateStatementsResult {
  organizationId: number;
  asOfDate: string;
  loansEvaluated: number;
  statementsGenerated: number;
  statementsSkipped: number;
  /**
   * Every skip, itemised. `statementsSkipped` is the count; this is the
   * list an operator reads to see WHOSE note lacks a schedule. Populated
   * for predicate skips and due-date refusals alike.
   */
  skips: StatementSkip[];
  errors: Array<{ loanId: string; error: string }>;
  durationMs: number;
}

export interface GenerateStatementsOptions {
  /**
   * If true, regenerate (replace) an existing statement row. Default
   * false — re-running is a no-op. Used by ops tooling to recover
   * from a botched generation without manually nuking rows.
   */
  regenerate?: boolean;
}

/**
 * Generate periodic statements for an org's loans whose cycle ends
 * within the asOfDate's billing window. Returns a summary.
 *
 * Multi-tenant safety: every query is org-scoped via the
 * notes.organization_id filter. No cross-org reads possible.
 */
export async function generateStatementsForCycle(
  organizationId: number,
  asOfDate: Date,
  options: GenerateStatementsOptions = {},
): Promise<GenerateStatementsResult> {
  const start = Date.now();

  // Cycle = the calendar month ending at asOfDate. We use a
  // last-day-of-cycle anchor: cycleEnd is the last day of the month
  // containing asOfDate; cycleStart is the first day.
  //
  // Rationale: §1026.41 doesn't dictate cycle boundaries — they're set
  // by the loan's terms. AcreOS's `notes` table assumes monthly cycles
  // (matches the `monthlyPayment` field name + the amortization
  // schedule generator). When we add bi-weekly or quarterly cycles,
  // the cycleStart/cycleEnd computation moves to a per-loan helper.
  const cycleEnd = new Date(
    Date.UTC(asOfDate.getUTCFullYear(), asOfDate.getUTCMonth() + 1, 0),
  );
  const cycleStart = new Date(
    Date.UTC(asOfDate.getUTCFullYear(), asOfDate.getUTCMonth(), 1),
  );
  // The due date is resolved PER LOAN, from that loan's own schedule.
  //
  // This block used to read: "Next month's due date = first of next month
  // (we'll override per-loan when the note has a non-default
  // payment_due_day, below)." That override was never written. The result
  // was that every §1026.41 periodic statement AcreOS produced told the
  // borrower their payment was due on the 1st of next month — a wrong date
  // on a legally-required consumer disclosure, for every borrower whose
  // note says anything else — and `deliveryDeadline` (the §1026.41(b)(2)
  // timing obligation) was computed off the same wrong date.
  //
  // The note is kept rather than deleted because it is what pinned the
  // stub: the truth now is that `resolveNoteDueDate` /
  // `resolveAcquiredNoteDueDate` below read the loan's stored
  // next_payment_date first and fall back to deriving from the note's own
  // schedule facts, and `deliveryDeadlineFor` derives the delivery deadline
  // from THAT per-loan date. There is deliberately no calendar fallback: a
  // loan whose schedule cannot be resolved is skipped with a logged
  // NO_DERIVABLE_DUE_DATE reason (refuse, never fabricate).

  // Pull active loans for the org. §1026.41 covers closed-end
  // consumer-purpose dwelling loans. We filter on status='active' as
  // the AcreOS-side proxy. Notes with the seller-financed-land
  // configuration are the customer-facing analog. Beatrice's audit
  // (2026-05-31) confirmed the ATR gate covers entry into this set.
  const activeLoans = await db
    .select()
    .from(notes)
    .where(
      and(
        eq(notes.organizationId, organizationId),
        eq(notes.status, "active"),
      ),
    );

  // Acquired notes (Beatrice 2026-06-02 ruling). The predicate gates
  // whether each row generates — most acquired notes will SKIP because
  // their servicingArrangement defaults to 'passive_holder'. The skip
  // ledger captures every skip with its §-citation for examiner audit.
  // Pull only rows in active servicing states; paid-off / sold notes
  // never owe a current statement.
  const activeAcquiredNotes = await db
    .select()
    .from(acquiredNotes)
    .where(
      and(
        eq(acquiredNotes.organizationId, organizationId),
        sql`${acquiredNotes.status} NOT IN ('paid_off', 'sold')`,
      ),
    );

  const result: GenerateStatementsResult = {
    organizationId,
    asOfDate: asOfDate.toISOString().slice(0, 10),
    loansEvaluated: activeLoans.length + activeAcquiredNotes.length,
    statementsGenerated: 0,
    statementsSkipped: 0,
    skips: [],
    errors: [],
    durationMs: 0,
  };

  // One recorder for both loops: itemise on the result AND persist to the
  // audit ledger, so the operator summary and the examiner ledger can never
  // disagree about why a loan produced nothing.
  const recordSkip = async (skip: StatementSkip, cycle: Date): Promise<void> => {
    result.skips.push(skip);
    result.statementsSkipped += 1;
    await writeSkipLedger({
      organizationId,
      noteTable: skip.noteTable,
      noteId: skip.loanId,
      cycleStart: cycle,
      reason: skip.reason,
      citation: skip.citation,
    });
  };

  for (const loan of activeLoans) {
    try {
      // Originated notes: predicate always returns qualifies=true (AcreOS
      // is the servicer by construction for this vertical). The skip
      // ledger therefore only writes for acquired notes in this commit.
      const predicate = await qualifiesForRegZStatement(
        { kind: "note", row: loan },
        organizationId,
      );
      if (!predicate.qualifies) {
        await recordSkip(
          {
            loanId: String(loan.id),
            noteTable: "notes",
            code: "PREDICATE_OUT_OF_SCOPE",
            reason: predicate.skipReason ?? "predicate returned skip without reason",
            citation: predicate.citation,
          },
          cycleStart,
        );
        continue;
      }

      // §1026.41(d)(1): the due date on the statement is THIS loan's due
      // date, or there is no statement.
      const resolved = resolveNoteDueDate(loan);
      if (!resolved) {
        await recordSkip(
          {
            loanId: String(loan.id),
            noteTable: "notes",
            code: "NO_DERIVABLE_DUE_DATE",
            reason: noDerivableDueDateReason(
              "notes",
              String(loan.id),
              "next_payment_date is empty and the stored amortization schedule carries no unpaid entry with a usable due date",
            ),
            citation: DUE_DATE_REFUSAL_CITATION,
          },
          cycleStart,
        );
        continue;
      }

      const generated = await generateOneStatement({
        loan,
        organizationId,
        cycleStart,
        cycleEnd,
        nextDueDate: resolved.dueDate,
        deliveryDeadline: deliveryDeadlineFor(resolved.dueDate),
        regenerate: options.regenerate ?? false,
      });
      if (generated) {
        result.statementsGenerated += 1;
      } else {
        result.statementsSkipped += 1;
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      result.errors.push({ loanId: String(loan.id), error: errMsg });
      logger.error(
        `[periodicStatements] error generating for loan ${loan.id}`,
        err instanceof Error ? err : undefined,
      );
    }
  }

  for (const acq of activeAcquiredNotes) {
    try {
      const predicate = await qualifiesForRegZStatement(
        { kind: "acquired_note", row: acq },
        organizationId,
      );
      if (!predicate.qualifies) {
        await recordSkip(
          {
            loanId: acq.id,
            noteTable: "acquired_notes",
            code: "PREDICATE_OUT_OF_SCOPE",
            reason: predicate.skipReason ?? "predicate returned skip without reason",
            citation: predicate.citation,
          },
          cycleStart,
        );
        continue;
      }

      // §1026.41(d)(1): this note's OWN due date — stored next_payment_date
      // first, then derived from the note's schedule facts. Never the
      // calendar.
      const resolved = resolveAcquiredNoteDueDate(acq, asOfDate);
      if (!resolved) {
        await recordSkip(
          {
            loanId: acq.id,
            noteTable: "acquired_notes",
            code: "NO_DERIVABLE_DUE_DATE",
            reason: noDerivableDueDateReason(
              "acquired_notes",
              acq.id,
              "next_payment_date is empty and payment_due_day / first_payment_date / origination_date / maturity_date / paid_through_date do not yield a scheduled payment on or before maturity",
            ),
            citation: DUE_DATE_REFUSAL_CITATION,
          },
          cycleStart,
        );
        continue;
      }

      const generated = await generateOneAcquiredStatement({
        note: acq,
        organizationId,
        cycleStart,
        cycleEnd,
        asOfDate,
        nextDueDate: resolved.dueDate,
        deliveryDeadline: deliveryDeadlineFor(resolved.dueDate),
        regenerate: options.regenerate ?? false,
      });
      if (generated) {
        result.statementsGenerated += 1;
      } else {
        result.statementsSkipped += 1;
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      result.errors.push({ loanId: acq.id, error: errMsg });
      logger.error(
        `[periodicStatements] error generating for acquired note ${acq.id}`,
        err instanceof Error ? err : undefined,
      );
    }
  }

  result.durationMs = Date.now() - start;
  logger.info(
    `[periodicStatements] org=${organizationId} loans=${result.loansEvaluated} generated=${result.statementsGenerated} skipped=${result.statementsSkipped} errors=${result.errors.length} duration=${result.durationMs}ms`,
  );

  // A due-date refusal is a DATA gap, not a scope determination — the loan
  // is in §1026.41 scope and owes a statement we could not honestly write.
  // It gets its own line so it does not hide inside the skip total.
  const dueDateRefusals = result.skips.filter(
    (s) => s.code === "NO_DERIVABLE_DUE_DATE",
  );
  if (dueDateRefusals.length > 0) {
    logger.warn(
      `[periodicStatements] org=${organizationId} — ${dueDateRefusals.length} in-scope loan(s) produced NO statement because no payment due date could be derived. These owe a statement once their schedule is backfilled.`,
      {
        metadata: {
          detail: {
            loanIds: dueDateRefusals.map((s) => `${s.noteTable}:${s.loanId}`),
          },
        },
      },
    );
  }

  return result;
}

// ============================================================================
// DUE-DATE RESOLUTION — §1026.41(d)(1)
// ----------------------------------------------------------------------------
// Every statement's due date comes from the loan it is about. These helpers
// are the only place that answers "when is this borrower's next payment
// due?", and each of them can return null. Null means "we do not know", and
// the caller's contract is to SKIP the loan — never to substitute a
// calendar date. A wrong due date on a Reg-Z disclosure is a worse outcome
// than a statement that was not generated.
// ============================================================================

/*
 * `parseCalendarDate` now lives in `@shared/dates/calendar` and is imported
 * at the top of this file. This module WROTE the canonical body — it was the
 * most capable of the three copies (Date, ISO datetime, and 'YYYY-MM-DD',
 * all with the roll-over rejection) — so consolidation moved it out rather
 * than replacing it with a weaker one.
 */

/**
 * §1026.41(b)(2): delivery no later than a reasonably prompt time before the
 * next payment is due — industry standard 21 days BEFORE that loan's due
 * date. Derived from the per-loan date, so the timing obligation moves with
 * the real obligation instead of with the calendar.
 */
export function deliveryDeadlineFor(dueDate: Date): Date {
  return new Date(dueDate.getTime() - DELIVERY_LEAD_DAYS * DAY_MS);
}

/**
 * The due date for an ORIGINATED (seller-finance) note.
 *
 * Preference order, both readings of the note's own record:
 *  1. `notes.next_payment_date` — server-side truth, maintained by the
 *     payment-posting paths.
 *  2. the earliest not-yet-paid entry of the note's stored amortization
 *     schedule.
 *
 * Null when neither exists. The seller-finance path carried the identical
 * calendar-constant defect as the acquired path (it stamped the 1st of next
 * month too); this is its fix.
 */
export function resolveNoteDueDate(
  loan: Pick<typeof notes.$inferSelect, "nextPaymentDate" | "amortizationSchedule">,
): { dueDate: Date; source: "stored_next_payment_date" | "amortization_schedule" } | null {
  const stored = parseCalendarDate(loan.nextPaymentDate ?? null);
  if (stored) return { dueDate: stored, source: "stored_next_payment_date" };

  let earliest: Date | null = null;
  for (const entry of loan.amortizationSchedule ?? []) {
    if (!entry || entry.status === "paid") continue;
    const parsed = parseCalendarDate(entry.dueDate);
    if (!parsed) continue;
    if (!earliest || parsed.getTime() < earliest.getTime()) earliest = parsed;
  }
  if (earliest) return { dueDate: earliest, source: "amortization_schedule" };
  return null;
}

/**
 * The due date for an ACQUIRED note.
 *
 * Preference order:
 *  1. `acquired_notes.next_payment_date` — written by the aging job from
 *     real facts (payments posted, paid-through, maturity cap, month-end
 *     clamp).
 *  2. `deriveNextPaymentDate` over the note's schedule facts. That module is
 *     pure, clamps month-end (a note due the 31st is due Feb 28/29), and
 *     deliberately returns a PAST date for an overdue note rather than
 *     rolling it forward to look friendly.
 *
 * Null when the facts support neither — including "paid through maturity",
 * where nothing further is due on the monthly schedule and a 361st payment
 * on a 360-month note would be an invented obligation.
 */
export function resolveAcquiredNoteDueDate(
  note: Pick<
    AcquiredNote,
    | "nextPaymentDate"
    | "paymentDueDay"
    | "firstPaymentDate"
    | "originationDate"
    | "maturityDate"
    | "paidThroughDate"
    | "acquisitionDate"
  >,
  asOfDate: Date,
): { dueDate: Date; source: "stored_next_payment_date" | "derived_from_schedule" } | null {
  const stored = parseCalendarDate(note.nextPaymentDate ?? null);
  if (stored) return { dueDate: stored, source: "stored_next_payment_date" };

  const derived = deriveNextPaymentDate(
    {
      paymentDueDay: note.paymentDueDay,
      firstPaymentDate: note.firstPaymentDate ?? null,
      originationDate: note.originationDate,
      maturityDate: note.maturityDate,
      paidThroughDate: note.paidThroughDate ?? null,
      acquisitionDate: note.acquisitionDate,
    },
    asOfDate,
  );
  const parsed = parseCalendarDate(derived);
  if (parsed) return { dueDate: parsed, source: "derived_from_schedule" };
  return null;
}

/**
 * How many scheduled monthly payments have come due, counting the oldest
 * unpaid one, as of `asOf`.
 *
 * Used only to state the amount required to bring the loan current on the
 * §1026.41(d)(8) delinquency block. Reporting ONE payment for a borrower who
 * has missed six understates what they owe to cure, which is exactly the
 * kind of comfortable-but-wrong number this disclosure exists to prevent.
 *
 * `dueDay` is the note's CONTRACTUAL due day (1-31), not the day-of-month of
 * the clamped oldest-unpaid date: a note due the 31st whose oldest unpaid
 * period landed on Feb 28 must still measure March against the 31st, or the
 * count runs one period hot for three days every March.
 */
function scheduledPeriodsElapsed(
  oldestUnpaidDue: Date,
  asOf: Date,
  dueDay: number,
): number {
  if (asOf.getTime() < oldestUnpaidDue.getTime()) return 0;
  const effectiveDueDay =
    Number.isInteger(dueDay) && dueDay >= 1 && dueDay <= 31
      ? dueDay
      : oldestUnpaidDue.getUTCDate();

  const monthsApart =
    (asOf.getUTCFullYear() - oldestUnpaidDue.getUTCFullYear()) * 12 +
    (asOf.getUTCMonth() - oldestUnpaidDue.getUTCMonth());

  // Clamp the scheduled day into asOf's own month before comparing.
  const lastDayOfAsOfMonth = new Date(
    Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const scheduledThisMonth = Math.min(effectiveDueDay, lastDayOfAsOfMonth);
  const thisMonthHasComeDue = asOf.getUTCDate() >= scheduledThisMonth;

  return monthsApart + (thisMonthHasComeDue ? 1 : 0);
}

interface GenerateOneInput {
  loan: typeof notes.$inferSelect;
  organizationId: number;
  cycleStart: Date;
  cycleEnd: Date;
  nextDueDate: Date;
  deliveryDeadline: Date;
  regenerate: boolean;
}

async function generateOneStatement(input: GenerateOneInput): Promise<boolean> {
  const { loan, organizationId, cycleStart, cycleEnd, nextDueDate, deliveryDeadline, regenerate } =
    input;
  const loanId = String(loan.id);

  // Idempotency: check whether a statement for (loan, cycleStart) already exists.
  const existing = await db
    .select({ id: periodicStatements.id })
    .from(periodicStatements)
    .where(
      and(
        eq(periodicStatements.loanId, loanId),
        eq(periodicStatements.cycleStart, cycleStart.toISOString().slice(0, 10)),
      ),
    )
    .limit(1);

  if (existing.length > 0 && !regenerate) {
    return false; // no-op: §1026.41 requires exactly one statement per cycle
  }

  // Compute every required §1026.41(d) field.
  const fields = await computeStatementFields({
    loan,
    organizationId,
    cycleStart,
    cycleEnd,
    nextDueDate,
  });

  const row: InsertPeriodicStatement = {
    organizationId,
    loanId,
    loanType: "note",
    cycleStart: cycleStart.toISOString().slice(0, 10),
    cycleEnd: cycleEnd.toISOString().slice(0, 10),
    dueDate: nextDueDate.toISOString().slice(0, 10),
    amountDueCents: fields.amountDueCents,
    paymentApplicationExplanation: fields.paymentApplicationExplanation,
    principalBalanceCents: fields.principalBalanceCents,
    interestRateBps: fields.interestRateBps,
    payoffCents: fields.payoffCents,
    prepaymentPenaltyDisclosed: false, // AcreOS notes carry no prepayment penalty
    pastPaymentBreakdown: fields.pastPaymentBreakdown,
    ytdPrincipalCents: fields.ytd.principalCents,
    ytdInterestCents: fields.ytd.interestCents,
    ytdEscrowCents: fields.ytd.escrowCents,
    ytdFeesCents: fields.ytd.feesCents,
    transactions: fields.transactions,
    partialPaymentBalanceCents: fields.partialPaymentBalanceCents,
    delinquencyInfo: fields.delinquencyInfo,
    deliveryDeadline: deliveryDeadline.toISOString().slice(0, 10),
    deliveryStatus: "pending",
  };

  let persistedId: string;
  if (existing.length > 0 && regenerate) {
    persistedId = existing[0].id;
    await db
      .update(periodicStatements)
      .set(row)
      .where(eq(periodicStatements.id, persistedId));
  } else {
    const [inserted] = await db
      .insert(periodicStatements)
      .values(row)
      .returning({ id: periodicStatements.id });
    persistedId = inserted.id;
  }

  // Fire the borrower notification email. The notifier is idempotent —
  // re-running for an already-delivered statement is a no-op (it reads
  // delivery_status before sending). A send failure here MUST NOT abort
  // the cron batch; we catch + log so the remaining loans keep generating.
  try {
    const { notifyStatementGenerated } = await import("./delivery");
    const notifyResult = await notifyStatementGenerated(persistedId);
    // A BYO-identity block is not an error and not a success — the row is
    // generated and portal-readable, but the statutory email will never
    // go out until the org connects email. It is TERMINAL (never retried),
    // so if it is not logged here it is invisible in the cron's
    // "generated=N errors=M" summary. The founder/org alert is raised
    // inside the notifier; this is the operator-facing breadcrumb.
    if (notifyResult.blockedNoOrgIdentity) {
      logger.warn(
        `[periodicStatements] statement ${persistedId} (loan ${loanId}, org ${organizationId}) generated but email BLOCKED — org has no connected email identity; not retried`,
        { metadata: { statementId: persistedId, organizationId, loanId } },
      );
    }
  } catch (notifyErr) {
    logger.warn(
      `[periodicStatements] notify failed for statement ${persistedId} (loan ${loanId}) — generation succeeded, email did not`,
      { metadata: { detail: { error: notifyErr instanceof Error ? notifyErr.message : String(notifyErr) } } },
    );
  }

  return true;
}

// ============================================================================
// FIELD COMPUTATION — §1026.41(d) line-by-line
// ============================================================================

interface ComputeFieldsInput {
  loan: typeof notes.$inferSelect;
  organizationId: number;
  cycleStart: Date;
  cycleEnd: Date;
  nextDueDate: Date;
}

interface ComputedFields {
  amountDueCents: number;
  paymentApplicationExplanation: {
    principalCents: number;
    interestCents: number;
    escrowCents: number;
    feesCents: number;
  };
  principalBalanceCents: number;
  interestRateBps: number;
  payoffCents: number;
  pastPaymentBreakdown: {
    principalCents: number;
    interestCents: number;
    escrowCents: number;
    feesCents: number;
    unappliedCents: number;
    totalReceivedCents: number;
  };
  ytd: {
    principalCents: number;
    interestCents: number;
    escrowCents: number;
    feesCents: number;
  };
  transactions: Array<{
    date: string;
    label: string;
    amountCents: number;
    appliedTo: string;
  }>;
  partialPaymentBalanceCents: number;
  delinquencyInfo: {
    daysDelinquent: number;
    delinquentSinceDate: string;
    totalAmountDelinquentCents: number;
    housingCounselorPhone: string;
    housingCounselorUrl: string;
    riskOfForeclosureNotice: boolean;
  } | undefined;
}

async function computeStatementFields(
  input: ComputeFieldsInput,
): Promise<ComputedFields> {
  const { loan, cycleStart, cycleEnd } = input;

  // Numeric columns on the legacy notes table are decimal strings;
  // convert to integer cents for our snapshot.
  const dollarsToCents = (s: string | null | undefined): number => {
    if (!s) return 0;
    const n = parseFloat(s);
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * 100);
  };

  const amountDueCents = dollarsToCents(loan.monthlyPayment);
  const principalBalanceCents = dollarsToCents(loan.currentBalance);
  const interestRateBps = Math.round(parseFloat(loan.interestRate ?? "0") * 100);

  // Payoff: balance + accrued interest since the last posting. We
  // approximate using a one-cycle accrual (cycleEnd minus cycleStart).
  const monthlyInterestCents = Math.round(
    (principalBalanceCents * interestRateBps) / (10_000 * 12),
  );
  const payoffCents = principalBalanceCents + monthlyInterestCents;

  // Pull the cycle's payment_applications for the past-payment breakdown
  // + transactions array.
  const cyclePayments = await db
    .select()
    .from(paymentApplications)
    .where(
      and(
        eq(paymentApplications.loanId, String(loan.id)),
        gte(paymentApplications.appliedAt, cycleStart),
        lte(paymentApplications.appliedAt, cycleEnd),
      ),
    );

  const pastPaymentBreakdown = {
    principalCents: 0,
    interestCents: 0,
    escrowCents: 0,
    feesCents: 0,
    unappliedCents: 0,
    totalReceivedCents: 0,
  };
  const transactions: ComputedFields["transactions"] = [];

  for (const p of cyclePayments) {
    pastPaymentBreakdown.principalCents += p.appliedToPrincipalCents;
    pastPaymentBreakdown.interestCents += p.appliedToInterestCents;
    pastPaymentBreakdown.escrowCents += p.appliedToEscrowCents;
    pastPaymentBreakdown.feesCents += p.appliedToFeesCents;
    pastPaymentBreakdown.unappliedCents += p.appliedToSuspenseCents;
    pastPaymentBreakdown.totalReceivedCents +=
      p.appliedToPrincipalCents +
      p.appliedToInterestCents +
      p.appliedToEscrowCents +
      p.appliedToFeesCents +
      Math.max(p.appliedToSuspenseCents, 0);

    transactions.push({
      date: new Date(p.appliedAt).toISOString().slice(0, 10),
      label: p.appliedToSuspenseCents > 0 ? "Partial payment (held)" : "Payment received",
      amountCents:
        p.appliedToPrincipalCents +
        p.appliedToInterestCents +
        p.appliedToEscrowCents +
        p.appliedToFeesCents +
        Math.max(p.appliedToSuspenseCents, 0),
      appliedTo: p.appliedToSuspenseCents > 0 ? "suspense" : "principal/interest",
    });
  }

  // YTD totals: sum from Jan 1 to cycleEnd. One query.
  const ytdStart = new Date(Date.UTC(cycleStart.getUTCFullYear(), 0, 1));
  const ytdRow = await db
    .select({
      principal: sql<number>`COALESCE(SUM(${paymentApplications.appliedToPrincipalCents}), 0)::bigint`,
      interest: sql<number>`COALESCE(SUM(${paymentApplications.appliedToInterestCents}), 0)::bigint`,
      escrow: sql<number>`COALESCE(SUM(${paymentApplications.appliedToEscrowCents}), 0)::bigint`,
      fees: sql<number>`COALESCE(SUM(${paymentApplications.appliedToFeesCents}), 0)::bigint`,
    })
    .from(paymentApplications)
    .where(
      and(
        eq(paymentApplications.loanId, String(loan.id)),
        gte(paymentApplications.appliedAt, ytdStart),
        lte(paymentApplications.appliedAt, cycleEnd),
      ),
    );

  const ytd = {
    principalCents: Number(ytdRow[0]?.principal ?? 0),
    interestCents: Number(ytdRow[0]?.interest ?? 0),
    escrowCents: Number(ytdRow[0]?.escrow ?? 0),
    feesCents: Number(ytdRow[0]?.fees ?? 0),
  };

  // Payment application explanation: how the upcoming payment will split.
  // We approximate using a single-cycle accrual on the post-cycle balance.
  const upcomingInterest = Math.round(
    (principalBalanceCents * interestRateBps) / (10_000 * 12),
  );
  const upcomingEscrow = dollarsToCents(loan.monthlyTaxEscrow);
  const upcomingPrincipal = Math.max(
    0,
    amountDueCents - upcomingInterest - upcomingEscrow,
  );
  const paymentApplicationExplanation = {
    principalCents: upcomingPrincipal,
    interestCents: upcomingInterest,
    escrowCents: upcomingEscrow,
    feesCents: 0,
  };

  // §1026.41(d)(8) delinquency block — only when >= 45 days delinquent.
  const daysDelinquent = loan.daysDelinquent ?? 0;
  let delinquencyInfo: ComputedFields["delinquencyInfo"];
  if (daysDelinquent >= DELINQUENCY_DISCLOSURE_THRESHOLD_DAYS) {
    const delinquentSinceDate = new Date(
      Date.now() - daysDelinquent * 24 * 60 * 60 * 1000,
    );
    delinquencyInfo = {
      daysDelinquent,
      delinquentSinceDate: delinquentSinceDate.toISOString().slice(0, 10),
      totalAmountDelinquentCents: amountDueCents,
      housingCounselorPhone: HUD_HOUSING_COUNSELOR_PHONE,
      housingCounselorUrl: HUD_HOUSING_COUNSELOR_URL,
      riskOfForeclosureNotice: daysDelinquent >= 90,
    };
  }

  // Partial-payment block — the running suspense balance for this loan,
  // not the cycle. If positive, the PDF renderer surfaces the held amount.
  const partialPaymentBalanceCents = Math.max(0, pastPaymentBreakdown.unappliedCents);

  return {
    amountDueCents,
    paymentApplicationExplanation,
    principalBalanceCents,
    interestRateBps,
    payoffCents,
    pastPaymentBreakdown,
    ytd,
    transactions,
    partialPaymentBalanceCents,
    delinquencyInfo,
  };
}

// ============================================================================
// SKIP LEDGER — Beatrice ruling §4 audit primitive
// ----------------------------------------------------------------------------
// Every predicate skip persists a row here with the §-citation. UNIQUE on
// (org_id, note_table, note_id, cycle_start) — re-running the generator
// for a cycle whose skip was already logged is a no-op at the DB layer.
// ============================================================================

interface WriteSkipInput {
  organizationId: number;
  noteTable: "notes" | "acquired_notes";
  noteId: string;
  cycleStart: Date;
  reason: string;
  citation: string;
}

async function writeSkipLedger(input: WriteSkipInput): Promise<void> {
  await db
    .insert(periodicStatementSkips)
    .values({
      organizationId: input.organizationId,
      noteTable: input.noteTable,
      noteId: input.noteId,
      cycleStart: input.cycleStart,
      reason: input.reason,
      citation: input.citation,
    })
    .onConflictDoNothing({
      target: [
        periodicStatementSkips.organizationId,
        periodicStatementSkips.noteTable,
        periodicStatementSkips.noteId,
        periodicStatementSkips.cycleStart,
      ],
    });
  logger.info(
    `[periodicStatements] skip logged: org=${input.organizationId} table=${input.noteTable} note=${input.noteId} cycle=${input.cycleStart.toISOString().slice(0, 10)} reason="${input.reason}" citation="${input.citation}"`,
  );
}

// ============================================================================
// ACQUIRED-NOTE STATEMENT GENERATION
// ----------------------------------------------------------------------------
// Same §1026.41(d) field set as the originated-notes path, but pulled from
// the acquired_notes columns (which store cents directly instead of the
// decimal-string convention the originated `notes` table uses).
// ============================================================================

interface GenerateOneAcquiredInput {
  note: AcquiredNote;
  organizationId: number;
  cycleStart: Date;
  cycleEnd: Date;
  /** Evaluation instant — the delinquency block measures against it. */
  asOfDate: Date;
  /** This note's OWN next due date, already resolved. Never a calendar constant. */
  nextDueDate: Date;
  deliveryDeadline: Date;
  regenerate: boolean;
}

/**
 * §1026.41(d)(8) delinquency block for an acquired note, built from the
 * note's real aging columns.
 *
 * Returns undefined — no block at all — in exactly two cases, and neither
 * one is "we guessed current":
 *
 *  1. **No determination exists.** `days_delinquent` / `delinquency_status`
 *     are absent (a row the aging job has never touched, or a legacy row
 *     predating those columns). Silence is the honest output; emitting
 *     "0 days delinquent" would assert a finding nobody made.
 *  2. **Under the 45-day threshold.** The rule only requires the block at
 *     45+ days, and a borrower 12 days down does not get a foreclosure-risk
 *     disclosure.
 *
 * `delinquentSinceDate` is the OLDEST UNPAID SCHEDULED DUE DATE — the date
 * the account actually became delinquent, which is what the rule asks for.
 * The originated path back-computes it as `now - daysDelinquent`, which is
 * an approximation; here the real date is available so we use it rather than
 * synthesise one.
 */
export function buildAcquiredDelinquencyInfo(input: {
  note: Pick<
    AcquiredNote,
    "daysDelinquent" | "delinquencyStatus" | "paymentDueDay"
  >;
  oldestUnpaidDueDate: Date;
  paymentAmountCents: number;
  asOfDate: Date;
}): ComputedFields["delinquencyInfo"] {
  const { note, oldestUnpaidDueDate, paymentAmountCents, asOfDate } = input;

  const daysDelinquent = note.daysDelinquent;
  const status = note.delinquencyStatus;
  const hasDetermination =
    typeof daysDelinquent === "number" &&
    Number.isFinite(daysDelinquent) &&
    typeof status === "string" &&
    status.length > 0;
  if (!hasDetermination) return undefined;
  if (daysDelinquent < DELINQUENCY_DISCLOSURE_THRESHOLD_DAYS) return undefined;

  // Amount to bring the loan current: every scheduled payment that has come
  // due since (and including) the oldest unpaid one. At least one, since we
  // only reach here at 45+ days past due.
  const periodsUnpaid = Math.max(
    1,
    scheduledPeriodsElapsed(oldestUnpaidDueDate, asOfDate, note.paymentDueDay),
  );

  return {
    daysDelinquent,
    delinquentSinceDate: oldestUnpaidDueDate.toISOString().slice(0, 10),
    totalAmountDelinquentCents: periodsUnpaid * paymentAmountCents,
    housingCounselorPhone: HUD_HOUSING_COUNSELOR_PHONE,
    housingCounselorUrl: HUD_HOUSING_COUNSELOR_URL,
    riskOfForeclosureNotice: daysDelinquent >= 90,
  };
}

async function generateOneAcquiredStatement(input: GenerateOneAcquiredInput): Promise<boolean> {
  const {
    note,
    organizationId,
    cycleStart,
    cycleEnd,
    asOfDate,
    nextDueDate,
    deliveryDeadline,
    regenerate,
  } = input;
  const loanId = note.id;

  const existing = await db
    .select({ id: periodicStatements.id })
    .from(periodicStatements)
    .where(
      and(
        eq(periodicStatements.loanId, loanId),
        eq(periodicStatements.cycleStart, cycleStart.toISOString().slice(0, 10)),
      ),
    )
    .limit(1);

  if (existing.length > 0 && !regenerate) {
    return false;
  }

  // Pull the cycle's payment_applications for past-payment + transactions.
  // The unified payment_applications table holds rows for both note types,
  // distinguished by loan_type. Acquired-note rows write loanType='acquired_note'.
  const cyclePayments = await db
    .select()
    .from(paymentApplications)
    .where(
      and(
        eq(paymentApplications.loanId, loanId),
        gte(paymentApplications.appliedAt, cycleStart),
        lte(paymentApplications.appliedAt, cycleEnd),
      ),
    );

  const pastPaymentBreakdown = {
    principalCents: 0,
    interestCents: 0,
    escrowCents: 0,
    feesCents: 0,
    unappliedCents: 0,
    totalReceivedCents: 0,
  };
  const transactions: Array<{
    date: string;
    label: string;
    amountCents: number;
    appliedTo: string;
  }> = [];

  for (const p of cyclePayments) {
    pastPaymentBreakdown.principalCents += p.appliedToPrincipalCents;
    pastPaymentBreakdown.interestCents += p.appliedToInterestCents;
    pastPaymentBreakdown.escrowCents += p.appliedToEscrowCents;
    pastPaymentBreakdown.feesCents += p.appliedToFeesCents;
    pastPaymentBreakdown.unappliedCents += p.appliedToSuspenseCents;
    pastPaymentBreakdown.totalReceivedCents +=
      p.appliedToPrincipalCents +
      p.appliedToInterestCents +
      p.appliedToEscrowCents +
      p.appliedToFeesCents +
      Math.max(p.appliedToSuspenseCents, 0);

    transactions.push({
      date: new Date(p.appliedAt).toISOString().slice(0, 10),
      label: p.appliedToSuspenseCents > 0 ? "Partial payment (held)" : "Payment received",
      amountCents:
        p.appliedToPrincipalCents +
        p.appliedToInterestCents +
        p.appliedToEscrowCents +
        p.appliedToFeesCents +
        Math.max(p.appliedToSuspenseCents, 0),
      appliedTo: p.appliedToSuspenseCents > 0 ? "suspense" : "principal/interest",
    });
  }

  const ytdStart = new Date(Date.UTC(cycleStart.getUTCFullYear(), 0, 1));
  const ytdRow = await db
    .select({
      principal: sql<number>`COALESCE(SUM(${paymentApplications.appliedToPrincipalCents}), 0)::bigint`,
      interest: sql<number>`COALESCE(SUM(${paymentApplications.appliedToInterestCents}), 0)::bigint`,
      escrow: sql<number>`COALESCE(SUM(${paymentApplications.appliedToEscrowCents}), 0)::bigint`,
      fees: sql<number>`COALESCE(SUM(${paymentApplications.appliedToFeesCents}), 0)::bigint`,
    })
    .from(paymentApplications)
    .where(
      and(
        eq(paymentApplications.loanId, loanId),
        gte(paymentApplications.appliedAt, ytdStart),
        lte(paymentApplications.appliedAt, cycleEnd),
      ),
    );

  const amountDueCents = note.paymentAmountCents;
  const principalBalanceCents = note.currentBalanceCents;
  const interestRateBps = note.interestRateBps;
  const upcomingInterest = Math.round(
    (principalBalanceCents * interestRateBps) / (10_000 * 12),
  );
  const upcomingPrincipal = Math.max(0, amountDueCents - upcomingInterest);
  const payoffCents = principalBalanceCents + upcomingInterest;

  // §1026.41(d)(8) delinquency block.
  //
  // This block used to read: "acquired_notes carries `status` but no
  // day-counter. For this commit we leave delinquencyInfo undefined; the
  // day-counter wiring is the RESPA §1024.39 follow-up commit." That
  // follow-up has landed — `acquired_notes` now carries `days_delinquent`
  // and `delinquency_status`, maintained by the aging job, using the same
  // vocabulary as the originated book. The note is kept rather than deleted
  // because it is what pinned the stub; the truth now is that the block is
  // built from those real columns (see buildAcquiredDelinquencyInfo), and
  // is left undefined ONLY when the note carries no delinquency
  // determination at all or is under the 45-day disclosure threshold.
  const delinquencyInfo = buildAcquiredDelinquencyInfo({
    note,
    oldestUnpaidDueDate: nextDueDate,
    paymentAmountCents: amountDueCents,
    asOfDate,
  });

  const partialPaymentBalanceCents = Math.max(0, pastPaymentBreakdown.unappliedCents);

  const row: InsertPeriodicStatement = {
    organizationId,
    loanId,
    loanType: "acquired_note",
    cycleStart: cycleStart.toISOString().slice(0, 10),
    cycleEnd: cycleEnd.toISOString().slice(0, 10),
    dueDate: nextDueDate.toISOString().slice(0, 10),
    amountDueCents,
    paymentApplicationExplanation: {
      principalCents: upcomingPrincipal,
      interestCents: upcomingInterest,
      escrowCents: 0,
      feesCents: 0,
    },
    principalBalanceCents,
    interestRateBps,
    payoffCents,
    prepaymentPenaltyDisclosed: false,
    pastPaymentBreakdown,
    ytdPrincipalCents: Number(ytdRow[0]?.principal ?? 0),
    ytdInterestCents: Number(ytdRow[0]?.interest ?? 0),
    ytdEscrowCents: Number(ytdRow[0]?.escrow ?? 0),
    ytdFeesCents: Number(ytdRow[0]?.fees ?? 0),
    transactions,
    partialPaymentBalanceCents,
    delinquencyInfo,
    deliveryDeadline: deliveryDeadline.toISOString().slice(0, 10),
    deliveryStatus: "pending",
  };

  let persistedId: string;
  if (existing.length > 0 && regenerate) {
    persistedId = existing[0].id;
    await db.update(periodicStatements).set(row).where(eq(periodicStatements.id, persistedId));
  } else {
    const [inserted] = await db
      .insert(periodicStatements)
      .values(row)
      .returning({ id: periodicStatements.id });
    persistedId = inserted.id;
  }

  // Borrower notification: same delivery hook as originated notes. The
  // delivery module reads loanType from the persisted row and renders
  // accordingly.
  try {
    const { notifyStatementGenerated } = await import("./delivery");
    const notifyResult = await notifyStatementGenerated(persistedId);
    // Same breadcrumb as the originated path — see the comment there.
    if (notifyResult.blockedNoOrgIdentity) {
      logger.warn(
        `[periodicStatements] acquired-note statement ${persistedId} (note ${loanId}, org ${organizationId}) generated but email BLOCKED — org has no connected email identity; not retried`,
        { metadata: { statementId: persistedId, organizationId, loanId } },
      );
    }
  } catch (notifyErr) {
    logger.warn(
      `[periodicStatements] notify failed for acquired-note statement ${persistedId} (note ${loanId}) — generation succeeded, email did not`,
      {
        metadata: {
          detail: { error: notifyErr instanceof Error ? notifyErr.message : String(notifyErr) },
        },
      },
    );
  }

  return true;
}

/**
 * Verify a generated statement row has every §1026.41(d) required field
 * non-empty. Used by tests + by the cron's post-generation audit step.
 */
export function auditRequiredFields(row: {
  amountDueCents: number;
  dueDate: string;
  principalBalanceCents: number;
  interestRateBps: number;
  payoffCents: number;
  pastPaymentBreakdown: unknown;
  paymentApplicationExplanation: unknown;
  ytdPrincipalCents: number;
  ytdInterestCents: number;
  transactions: unknown[];
}): { ok: boolean; missingFields: string[] } {
  const missing: string[] = [];
  if (row.amountDueCents == null) missing.push("amountDueCents (§1026.41(d)(1))");
  if (!row.dueDate) missing.push("dueDate (§1026.41(d)(1))");
  if (row.principalBalanceCents == null)
    missing.push("principalBalanceCents (§1026.41(d)(3)(i))");
  if (row.interestRateBps == null) missing.push("interestRateBps (§1026.41(d)(3)(ii))");
  if (row.payoffCents == null) missing.push("payoffCents (§1026.41(d)(3)(iii))");
  if (!row.pastPaymentBreakdown) missing.push("pastPaymentBreakdown (§1026.41(d)(4))");
  if (!row.paymentApplicationExplanation)
    missing.push("paymentApplicationExplanation (§1026.41(d)(1)(ii))");
  if (row.ytdPrincipalCents == null) missing.push("ytdPrincipalCents (§1026.41(d)(4)(ii))");
  if (row.ytdInterestCents == null) missing.push("ytdInterestCents (§1026.41(d)(4)(ii))");
  if (!Array.isArray(row.transactions)) missing.push("transactions (§1026.41(d)(5))");
  return { ok: missing.length === 0, missingFields: missing };
}
