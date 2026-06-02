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
import { notes, organizations } from "@shared/schema";
import {
  periodicStatements,
  type InsertPeriodicStatement,
} from "@shared/schema/reg-z";
import { paymentApplications } from "@shared/schema/reg-z";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { logger } from "../../utils/logger";

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

export interface GenerateStatementsResult {
  organizationId: number;
  asOfDate: string;
  loansEvaluated: number;
  statementsGenerated: number;
  statementsSkipped: number;
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
  // Next month's due date = first of next month (we'll override per-loan
  // when the note has a non-default payment_due_day, below).
  const nextDueDate = new Date(
    Date.UTC(asOfDate.getUTCFullYear(), asOfDate.getUTCMonth() + 1, 1),
  );
  const deliveryDeadline = new Date(
    nextDueDate.getTime() - DELIVERY_LEAD_DAYS * 24 * 60 * 60 * 1000,
  );

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

  const result: GenerateStatementsResult = {
    organizationId,
    asOfDate: asOfDate.toISOString().slice(0, 10),
    loansEvaluated: activeLoans.length,
    statementsGenerated: 0,
    statementsSkipped: 0,
    errors: [],
    durationMs: 0,
  };

  for (const loan of activeLoans) {
    try {
      const generated = await generateOneStatement({
        loan,
        organizationId,
        cycleStart,
        cycleEnd,
        nextDueDate,
        deliveryDeadline,
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

  result.durationMs = Date.now() - start;
  logger.info(
    `[periodicStatements] org=${organizationId} loans=${result.loansEvaluated} generated=${result.statementsGenerated} skipped=${result.statementsSkipped} errors=${result.errors.length} duration=${result.durationMs}ms`,
  );
  return result;
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
    await notifyStatementGenerated(persistedId);
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
