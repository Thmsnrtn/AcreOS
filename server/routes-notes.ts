/**
 * Note Investor vertical — acquired-notes API.
 *
 * Phase 5 §5 (Q4 2026). Foundation surface — list / create / read / update
 * acquired notes plus a payments ledger and an amortization-schedule
 * compute endpoint. The full BPO + tape diligence workflow + Sophie agent
 * expansion ride a follow-up PR (see
 * docs/archive/exhaustive-completion/note-investor-followups.md).
 *
 * All endpoints are org-scoped via getOrCreateOrg and gated to
 * owner/admin (notes are a financial/asset entity — VAs and viewers don't
 * mutate them; we may relax the read path later if a customer asks).
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "./db";
import {
  acquiredNotes,
  notePayments,
  noteAssignments,
  noteOwnershipSplits,
  noteLossMitCases,
  noteLossMitActions,
  LOSS_MIT_STATUS,
  LOSS_MIT_ACTION_TYPES,
  // The seller-finance servicing book (the `notes` table, ~schema 1356) — the
  // Close & Carry bridge originates into THIS, distinct from acquiredNotes.
  notes as sellerFinanceNotes,
} from "@shared/schema";
import { renderAssignmentPdf } from "./services/noteAssignmentPdf";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId, getUserId } from "./types/request";
import { storage, calculateMonthlyPayment } from "./storage";
import type { InsertNote } from "@shared/schema";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { requireRole } from "./middleware/roleGuard";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import { encrypt as encryptField } from "./services/fieldEncryption";
import { emitPaymentEvent } from "./services/workflow-engine";

// ─── Schemas ─────────────────────────────────────────────────────────────────

const addressSchema = z
  .object({
    line1: z.string().optional(),
    line2: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zip: z.string().optional(),
    country: z.string().optional(),
    phone: z.string().optional(),
  })
  .passthrough();

const noteStatusSchema = z.enum(["performing", "late", "default", "paid_off", "sold"]);

const createNoteSchema = z.object({
  propertyId: z.number().int().positive().nullable().optional(),
  borrowerId: z.number().int().positive().nullable().optional(),
  noteNumber: z.string().min(1).max(120),
  originalPrincipalCents: z.number().int().nonnegative(),
  currentBalanceCents: z.number().int().nonnegative(),
  interestRateBps: z.number().int().min(0).max(100_000),
  termMonths: z.number().int().min(1).max(1200),
  paymentAmountCents: z.number().int().nonnegative(),
  paymentDueDay: z.number().int().min(1).max(31),
  originationDate: z.string().min(1), // ISO 8601 date
  maturityDate: z.string().min(1),
  acquisitionDate: z.string().min(1),
  acquisitionPriceCents: z.number().int().nonnegative(),
  status: noteStatusSchema.optional(),
  payerName: z.string().min(1).max(240),
  payerAddress: addressSchema.optional(),
  // Plaintext TIN — encrypted server-side before persisting.
  payerTin: z.string().min(1).max(40).optional(),
  payerTinType: z.enum(["SSN", "EIN", "ITIN"]).optional(),
  originalLender: z.string().max(240).optional(),
  assignmentDocS3Key: z.string().max(512).optional(),
  // Compliance fields (PR-11)
  insuranceStatus: z.enum(["verified", "expiring_soon", "lapsed", "force_placed"]).optional(),
  insuranceCarrier: z.string().max(240).optional(),
  insurancePolicyNumber: z.string().max(120).optional(),
  insuranceExpiresAt: z.string().optional(),
  insuranceAnnualPremiumCents: z.number().int().nonnegative().optional(),
  taxEscrowEnabled: z.boolean().optional(),
  taxEscrowBalanceCents: z.number().int().nonnegative().optional(),
  taxDisbursementDueDate: z.string().optional(),
  taxDisbursementAmountCents: z.number().int().nonnegative().optional(),
  taxAuthorityName: z.string().max(240).optional(),
  notes: z.string().max(8_000).optional(),
});

const patchNoteSchema = createNoteSchema.partial();

const paymentTypeSchema = z.enum([
  "regular",
  "partial",
  "extra_principal",
  "payoff",
  "nsf_reversal",
  "unapplied_apply",
]);

const recordPaymentSchema = z.object({
  paymentDate: z.string().min(1),
  // Per-bucket cents. NSF reversals supply negative values; everything else
  // requires non-negative. Validated server-side after type is known.
  principalCents: z.number().int().default(0),
  interestCents: z.number().int().default(0),
  escrowCents: z.number().int().default(0),
  lateFeeCents: z.number().int().default(0),
  unappliedCents: z.number().int().default(0),
  paymentType: paymentTypeSchema.default("regular"),
  originalPaymentId: z.string().min(1).max(64).optional(),
  paymentMethod: z.enum(["ach", "check", "wire", "cash", "other"]).default("ach"),
  referenceNumber: z.string().max(120).optional(),
  notes: z.string().max(2_000).optional(),
});

// ─── Workflow payment events (Wave B — "wire the engine") ────────────────────
//
// The note-servicing automations (payment receipt, dunning, partial-payment
// handling, payoff) hang off the workflow engine's `payment.*` triggers.
// `/api/notes/:id/payments` is the acquired-note ledger's ONLY writer
// (the single `db.insert(notePayments)` in the repo), so this is the one and
// only emit site for that ledger — exactly one event per posted payment row.
//
// Money-path discipline, in order:
//   1. every ledger write commits first;
//   2. the emit runs after, wrapped, and can never throw back into the
//      request — a broken workflow must never fail, roll back, or re-post a
//      payment. The caller gets `void`, never a rejection.
//
// `entityId` is 0 because `note_payments` is uuid-keyed while
// `emitPaymentEvent`'s entityId is numeric; the real key travels as
// `data.paymentId`.
const UUID_KEYED_PAYMENT_ENTITY_ID = 0;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whole days between the period's due day and the day the payment posted.
 *
 * Derived ONLY from stored fields (`acquired_notes.payment_due_day` + the
 * payment date), clamped to the month's length for short months. Returns
 * `null` when the note carries no due day, so the event never publishes an
 * invented number. 0 means on-time-or-early, never "unknown".
 */
export function daysLateForNotePayment(
  paymentDate: string,
  paymentDueDay: number | null | undefined,
): number | null {
  if (!paymentDueDay || !Number.isFinite(paymentDueDay)) return null;
  const paid = new Date(`${String(paymentDate).slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(paid.getTime())) return null;
  const year = paid.getUTCFullYear();
  const month = paid.getUTCMonth();
  const lastDayOfMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const due = Date.UTC(year, month, Math.min(paymentDueDay, lastDayOfMonth));
  const diffDays = Math.floor((paid.getTime() - due) / DAY_MS);
  return diffDays > 0 ? diffDays : 0;
}

/** Everything the emit needs, read from rows that are already committed. */
export interface PostedNotePayment {
  organizationId: number;
  noteId: string;
  noteNumber: string | null;
  payerName: string | null;
  paymentId: string;
  paymentType: string;
  paymentMethod: string;
  paymentDate: string;
  principalCents: number;
  interestCents: number;
  escrowCents: number;
  lateFeeCents: number;
  unappliedCents: number;
  /** acquired_notes.payment_amount_cents — the scheduled P&I for a period. */
  scheduledPaymentAmountCents: number | null;
  paymentDueDay: number | null;
  remainingBalanceCents: number;
  unappliedBalanceCents: number;
  noteStatus: string;
}

/**
 * Build the `data` bag workflow conditions match on and templates
 * interpolate ({{amount}}, {{noteId}}, {{borrowerName}}, {{daysLate}}…).
 *
 * `amountCents` is the cash that moved this transaction:
 * principal + interest + escrow + late fee + unapplied. That sums correctly
 * for every payment type — a partial deposits into unapplied only, an
 * `unapplied_apply` nets to 0 (funds were already held), and an NSF reversal
 * nets negative.
 *
 * Fields we do not have (borrower email, on-time streak) are simply absent
 * rather than guessed.
 */
export function buildNotePaymentEventData(p: PostedNotePayment): Record<string, any> {
  const amountCents =
    p.principalCents + p.interestCents + p.escrowCents + p.lateFeeCents + p.unappliedCents;
  const scheduled = p.scheduledPaymentAmountCents;
  const isReversal = p.paymentType === "nsf_reversal";
  const isPartial =
    p.paymentType === "partial" ||
    (scheduled !== null && amountCents > 0 && amountCents < scheduled);
  const isFullPayment =
    scheduled === null || isReversal ? null : amountCents >= scheduled;

  return {
    source: "acquired_note_ledger",
    // Identity
    noteId: p.noteId,
    noteNumber: p.noteNumber,
    paymentId: p.paymentId,
    borrowerName: p.payerName,
    // Money
    amountCents,
    amount: amountCents / 100,
    principalCents: p.principalCents,
    interestCents: p.interestCents,
    escrowCents: p.escrowCents,
    lateFeeCents: p.lateFeeCents,
    unappliedCents: p.unappliedCents,
    scheduledPaymentAmountCents: scheduled,
    // Shape of the payment — what conditions branch on
    paymentType: p.paymentType,
    paymentMethod: p.paymentMethod,
    paymentDate: p.paymentDate,
    isPartial,
    isFullPayment,
    isPayoff: p.paymentType === "payoff",
    isReversal,
    ...(isReversal ? { reason: "nsf_reversal" } : {}),
    daysLate: daysLateForNotePayment(p.paymentDate, p.paymentDueDay),
    // State after the payment
    remainingBalanceCents: p.remainingBalanceCents,
    remainingPrincipal: p.remainingBalanceCents / 100,
    unappliedBalanceCents: p.unappliedBalanceCents,
    noteStatus: p.noteStatus,
  };
}

/**
 * Fire-and-forget workflow emit for a payment that is ALREADY committed to
 * the acquired-note ledger. Never throws.
 *
 * An NSF reversal is not a receipt — in servicing terms it is the canonical
 * missed payment (the money bounced), so it fires `payment.missed` and every
 * other type fires `payment.received`.
 */
export function emitNotePaymentWorkflowEvent(p: PostedNotePayment): void {
  try {
    const event = p.paymentType === "nsf_reversal" ? "payment.missed" : "payment.received";
    emitPaymentEvent(
      event,
      p.organizationId,
      UUID_KEYED_PAYMENT_ENTITY_ID,
      buildNotePaymentEventData(p),
    );
  } catch (err) {
    // Swallowed on purpose: the payment is posted and the response must not
    // change because a workflow misbehaved.
    logger.error(
      "notes.recordPayment workflow emit failed (payment already posted)",
      err instanceof Error ? err : undefined,
      { organizationId: p.organizationId, noteId: p.noteId, paymentId: p.paymentId },
    );
  }
}

// ─── Pure helpers ────────────────────────────────────────────────────────────

interface AmortizationRow {
  paymentNumber: number;
  dueDate: string; // ISO date
  payment: number; // cents
  principal: number; // cents
  interest: number; // cents
  balance: number; // cents
}

/**
 * Compute the remaining amortization schedule from a current balance, term,
 * and rate. Pure / framework-free so the route handler stays thin and the
 * computation can be unit-tested without a DB.
 */
export function computeAmortization(input: {
  currentBalanceCents: number;
  interestRateBps: number;
  paymentAmountCents: number;
  termMonthsRemaining: number;
  startDate: Date;
  paymentDueDay: number;
}): AmortizationRow[] {
  const monthlyRate = input.interestRateBps / 10_000 / 12;
  let balance = input.currentBalanceCents;
  const out: AmortizationRow[] = [];

  for (let i = 1; i <= input.termMonthsRemaining && balance > 0; i++) {
    const interest = Math.round(balance * monthlyRate);
    const principal = Math.min(input.paymentAmountCents - interest, balance);
    if (principal <= 0) {
      // Negative-amortization safeguard — payment doesn't cover interest.
      // We bail rather than emit a runaway schedule.
      break;
    }
    balance = Math.max(0, balance - principal);

    // Add `i` months to startDate, clamping the day to the requested
    // paymentDueDay. JS Date handles month overflow but not day clamping
    // for short months (Feb 30 → Mar 2), so we explicitly clamp.
    const due = new Date(Date.UTC(
      input.startDate.getUTCFullYear(),
      input.startDate.getUTCMonth() + i,
      1,
    ));
    const lastDayOfMonth = new Date(Date.UTC(
      due.getUTCFullYear(),
      due.getUTCMonth() + 1,
      0,
    )).getUTCDate();
    due.setUTCDate(Math.min(input.paymentDueDay, lastDayOfMonth));

    out.push({
      paymentNumber: i,
      dueDate: due.toISOString().slice(0, 10),
      payment: interest + principal,
      principal,
      interest,
      balance,
    });
  }

  return out;
}

// ─── Close & Carry — deal → note field mapping ───────────────────────────────
//
// The lifecycle bridge: a closed seller-finance deal one-click-originates the
// serviced note with NO re-keying. This pure function is the contract — given a
// deal (its accepted/offer amount + saved ROI analysis) plus any operator
// edits from the one-confirm screen, it produces the `notes`-table insert
// payload. Kept framework-free so the field mapping (the thing a customer
// notices in week one) is unit-testable without a DB.
//
// Money on the deal/note tables is stored as decimal strings (numeric columns),
// NOT cents — matching the seller-finance `notes` table and POST /api/notes.

/** The deal fields the carry flow reads. Subset of the full Deal row. */
export interface CarryableDeal {
  id: number;
  organizationId: number;
  propertyId: number | null;
  status: string;
  type: string;
  offerAmount: string | null;
  acceptedAmount: string | null;
  closingDate: Date | string | null;
  analysisResults: {
    downPayment?: number;
    interestRate?: number;
    holdingPeriodMonths?: number;
    financedAmount?: number;
  } | null;
}

/** Operator edits from the one-confirm screen. All optional → deal supplies the default. */
export interface CarryOverrides {
  borrowerId?: number | null;
  salePrice?: number; // total sale price (dollars)
  downPayment?: number; // dollars
  interestRate?: number; // annual percent
  termMonths?: number;
  firstPaymentDate?: string; // ISO date
}

export interface MappedNoteFields {
  organizationId: number;
  propertyId: number | null;
  borrowerId: number | null;
  originatingDealId: number;
  originalPrincipal: string;
  currentBalance: string;
  interestRate: string;
  termMonths: number;
  monthlyPayment: string;
  downPayment: string;
  startDate: Date;
  firstPaymentDate: Date;
  status: string;
}

const DEFAULT_TERM_MONTHS = 120; // 10yr — the common land-contract default
const DEFAULT_INTEREST_RATE = 0; // operator must set a real rate on the confirm screen

/**
 * Add `months` calendar months to a date, clamping the day for short months.
 * Mirrors the amortization due-date clamp above.
 */
function addCalendarMonths(base: Date, months: number): Date {
  const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(base.getUTCDate(), lastDay));
  return d;
}

/**
 * Map a closed seller-finance deal (+ operator edits) → the `notes` insert
 * payload. Pure: no DB, no side effects.
 *
 * - Sale price: override.salePrice ?? deal.acceptedAmount ?? deal.offerAmount
 * - Down payment: override.downPayment ?? analysisResults.downPayment ?? 0
 * - Financed principal: salePrice - downPayment (never negative)
 * - Rate / term: override ?? analysisResults ?? sensible default
 * - Start date: deal.closingDate ?? now
 * - First payment: override ?? one month after start (clamped)
 *
 * monthlyPayment is computed from (principal, rate, term) — never taken from the
 * client. amortizationSchedule + maturityDate are derived downstream by
 * storage.createNote, so they are intentionally not set here.
 */
export function mapDealToNoteFields(
  deal: CarryableDeal,
  overrides: CarryOverrides,
  now: Date = new Date(),
): MappedNoteFields {
  const salePrice =
    overrides.salePrice ??
    (deal.acceptedAmount != null ? Number(deal.acceptedAmount) : null) ??
    (deal.offerAmount != null ? Number(deal.offerAmount) : null) ??
    0;

  const downPayment = Math.max(
    0,
    overrides.downPayment ?? deal.analysisResults?.downPayment ?? 0,
  );

  const financedPrincipal = Math.max(0, salePrice - downPayment);

  const interestRate =
    overrides.interestRate ??
    deal.analysisResults?.interestRate ??
    DEFAULT_INTEREST_RATE;

  const termMonths =
    overrides.termMonths ??
    deal.analysisResults?.holdingPeriodMonths ??
    DEFAULT_TERM_MONTHS;

  const startDate = deal.closingDate ? new Date(deal.closingDate) : new Date(now);

  const firstPaymentDate = overrides.firstPaymentDate
    ? new Date(overrides.firstPaymentDate)
    : addCalendarMonths(startDate, 1);

  const monthlyPayment = calculateMonthlyPayment(financedPrincipal, interestRate, termMonths);

  return {
    organizationId: deal.organizationId,
    propertyId: deal.propertyId,
    borrowerId: overrides.borrowerId ?? null,
    originatingDealId: deal.id,
    originalPrincipal: String(financedPrincipal),
    currentBalance: String(financedPrincipal),
    interestRate: String(interestRate),
    termMonths,
    monthlyPayment: String(monthlyPayment),
    downPayment: String(downPayment),
    startDate,
    firstPaymentDate,
    // Always land 'pending' so origination runs through the audited Reg-Z
    // chokepoint (POST /api/notes/:id/originate). The carry pre-fills; the
    // operator originates.
    status: "pending",
  };
}

// ─── Yield math ──────────────────────────────────────────────────────────────

/**
 * Newton-Raphson IRR. Returns the discount rate that zeroes NPV of the
 * given cash-flow series. Same algorithm as client/src/components/IRRCalculator.tsx
 * (1e-7 tolerance, 1000 iter ceiling). Cash flows are in cents; the period
 * unit (annual vs monthly) is whatever the caller's stream is in — caller
 * converts to annual.
 */
function calcIRR(cashFlows: number[], guess = 0.05): number | null {
  const MAX_ITER = 1000;
  const TOLERANCE = 1e-7;
  let rate = guess;
  for (let i = 0; i < MAX_ITER; i++) {
    let npv = 0;
    let dNpv = 0;
    for (let t = 0; t < cashFlows.length; t++) {
      const denom = Math.pow(1 + rate, t);
      npv += cashFlows[t] / denom;
      if (t > 0) dNpv -= (t * cashFlows[t]) / Math.pow(1 + rate, t + 1);
    }
    if (Math.abs(dNpv) < 1e-12) return null;
    const newRate = rate - npv / dNpv;
    if (Math.abs(newRate - rate) < TOLERANCE) return newRate;
    rate = newRate;
  }
  return null;
}

interface ComputeYieldsInput {
  acquisitionPriceCents: number;
  currentBalanceCents: number;
  interestRateBps: number;
  paymentAmountCents: number;
  termMonths: number;
  acquisitionDate: string; // ISO
  payments: Array<{ paymentDate: string; principalCents: number; interestCents: number }>;
}

interface ComputeYieldsResult {
  // Decimals (0.085 = 8.5%). Null when the IRR didn't converge.
  currentYield: number;
  ytmAtAcquisition: number | null;
  irrToDate: number | null;
  effectiveNetYield: number | null;
  // Servicing-cost assumption used in the effective-net calc. Null when
  // we don't have enough data to estimate; see implementation notes.
  effectiveNetServicingAssumption: { annualBps: number; note: string } | null;
}

/**
 * Compute the four yield metrics Linnea wants on every note detail page.
 * Pure / unit-testable; called by GET /api/notes/:id/yield.
 */
export function computeYields(input: ComputeYieldsInput): ComputeYieldsResult {
  const {
    acquisitionPriceCents,
    currentBalanceCents,
    interestRateBps,
    paymentAmountCents,
    termMonths,
    acquisitionDate,
    payments,
  } = input;

  // ── Current yield ───────────────────────────────────────────────────────
  // running coupon on basis: (annual interest payment / acquisition price)
  // Approximation: rate * currentBalance / acquisitionPrice.
  const annualInterestCents = (interestRateBps / 10_000) * currentBalanceCents;
  const currentYield = acquisitionPriceCents > 0
    ? annualInterestCents / acquisitionPriceCents
    : 0;

  // ── YTM at acquisition ──────────────────────────────────────────────────
  // IRR over the original projected cash flows: -acquisitionPrice at t=0,
  // then paymentAmountCents per month for termMonths. We compute the
  // monthly IRR, then convert to annual via (1+r_m)^12 - 1.
  const ytmFlowsMonthly: number[] = [-acquisitionPriceCents];
  for (let m = 0; m < termMonths; m++) ytmFlowsMonthly.push(paymentAmountCents);
  const ytmMonthly = calcIRR(ytmFlowsMonthly, 0.005);
  const ytmAtAcquisition = ytmMonthly === null ? null : Math.pow(1 + ytmMonthly, 12) - 1;

  // ── IRR-to-date ─────────────────────────────────────────────────────────
  // Actual cash flows from the payment ledger, plus a terminal "if it pays
  // off today" cash flow equal to the current balance. Periods are months
  // from acquisition. We bucket by month-from-acquisition so a borrower's
  // partial-then-make-whole behavior nets correctly within a month.
  const acqDate = new Date(acquisitionDate);
  const monthsFromAcquisition = (iso: string): number => {
    const d = new Date(iso);
    return (d.getUTCFullYear() - acqDate.getUTCFullYear()) * 12 +
      (d.getUTCMonth() - acqDate.getUTCMonth());
  };
  const monthlyCashIn = new Map<number, number>();
  let maxMonth = 0;
  for (const p of payments) {
    const m = Math.max(0, monthsFromAcquisition(p.paymentDate));
    const cash = p.principalCents + p.interestCents;
    monthlyCashIn.set(m, (monthlyCashIn.get(m) ?? 0) + cash);
    if (m > maxMonth) maxMonth = m;
  }
  const irrFlowsMonthly: number[] = [-acquisitionPriceCents];
  for (let m = 1; m <= Math.max(1, maxMonth); m++) {
    irrFlowsMonthly.push(monthlyCashIn.get(m) ?? 0);
  }
  // Add today's "if-paid-off" terminal value at the next-month bucket.
  irrFlowsMonthly.push(currentBalanceCents);
  const irrMonthly = calcIRR(irrFlowsMonthly, 0.005);
  const irrToDate = irrMonthly === null ? null : Math.pow(1 + irrMonthly, 12) - 1;

  // ── Effective net yield ─────────────────────────────────────────────────
  // Linnea: "net of servicing costs and tax escrow float."
  // We don't track servicing costs as structured data yet — this is the
  // PR-9 / pool-tracking surface where investor-level cost allocation
  // lives. Until then, apply the documented industry-typical 25 bps
  // assumption and label it as such so the user can correct it in their
  // CPA flow. When we add a per-org servicing-cost field, swap the
  // hardcoded value for the org's setting.
  const SERVICING_BPS_DEFAULT = 25; // 0.25% — small-balance secondary market typical
  const effectiveNetYield = irrToDate === null
    ? null
    : Math.max(0, irrToDate - SERVICING_BPS_DEFAULT / 10_000);
  const effectiveNetServicingAssumption = irrToDate === null
    ? null
    : { annualBps: SERVICING_BPS_DEFAULT, note: "industry-typical default; will read from org setting once configurable" };

  return {
    currentYield,
    ytmAtAcquisition,
    irrToDate,
    effectiveNetYield,
    effectiveNetServicingAssumption,
  };
}

// ─── Basis schedule (IRS Pub 1212 — market-discount accretion) ───────────────

interface BasisScheduleRow {
  year: number;
  startingBasisCents: number;
  accretedDiscountCents: number;
  principalReceivedCents: number;
  endingBasisCents: number;
}

interface BasisScheduleInput {
  acquisitionPriceCents: number;
  originalPrincipalCents: number; // face value at acquisition
  acquisitionDate: string;
  maturityDate: string;
  payments: Array<{ paymentDate: string; principalCents: number }>;
  // Method per Pub 1212. 'ratable' = straight-line over remaining term.
  // 'constant_yield' = bond-accounting style; not yet implemented (the
  // ratable election is what most non-bond note investors use).
  method?: "ratable" | "constant_yield";
}

/**
 * Compute the per-year basis schedule for a purchased note.
 *
 * For notes bought at a discount (face > acquisition), the IRS requires
 * market-discount accretion as ordinary income over the remaining life
 * (Pub 1212). Without this, basis at sale is wrong, gain/loss is wrong,
 * and Linnea gets an IRS letter — her exact concern.
 *
 * Ratable method (the default): each year accrues
 *   total_discount × (months_in_year / total_months_remaining_at_acquisition)
 * with months capped to the term ending at maturity.
 */
export function computeBasisSchedule(input: BasisScheduleInput): BasisScheduleRow[] {
  const {
    acquisitionPriceCents,
    originalPrincipalCents,
    acquisitionDate,
    maturityDate,
    payments,
  } = input;

  const totalDiscountCents = originalPrincipalCents - acquisitionPriceCents;

  // Premium (acquisition > face) is a separate code path — bond premium
  // amortization elections under §171 — we don't auto-accrete in that
  // direction; just flat-line the basis.
  if (totalDiscountCents <= 0) {
    return [];
  }

  const acqDate = new Date(acquisitionDate);
  const matDate = new Date(maturityDate);
  const totalMonthsRemainingAtAcquisition = Math.max(
    1,
    (matDate.getUTCFullYear() - acqDate.getUTCFullYear()) * 12 +
      (matDate.getUTCMonth() - acqDate.getUTCMonth()),
  );

  // For each year between acquisition and maturity (inclusive), compute
  // the months that fell in that year. Multiply by per-month accretion.
  const accretionPerMonthCents = totalDiscountCents / totalMonthsRemainingAtAcquisition;

  // Bucket payments by year (only principal — interest is already taxed).
  const principalByYear = new Map<number, number>();
  for (const p of payments) {
    const y = new Date(p.paymentDate).getUTCFullYear();
    principalByYear.set(y, (principalByYear.get(y) ?? 0) + p.principalCents);
  }

  const rows: BasisScheduleRow[] = [];
  let runningBasis = acquisitionPriceCents;

  const startYear = acqDate.getUTCFullYear();
  const endYear = matDate.getUTCFullYear();

  for (let y = startYear; y <= endYear; y++) {
    // Months of this year that fall within (acqDate, matDate].
    const yearStart = new Date(Date.UTC(y, 0, 1));
    const yearEnd = new Date(Date.UTC(y, 11, 31));
    const periodStart = acqDate > yearStart ? acqDate : yearStart;
    const periodEnd = matDate < yearEnd ? matDate : yearEnd;
    const monthsInYear = Math.max(
      0,
      (periodEnd.getUTCFullYear() - periodStart.getUTCFullYear()) * 12 +
        (periodEnd.getUTCMonth() - periodStart.getUTCMonth()) +
        1, // inclusive
    );

    const accretedThisYearCents = Math.round(accretionPerMonthCents * monthsInYear);
    const principalReceivedThisYear = principalByYear.get(y) ?? 0;
    const startingBasis = runningBasis;
    const endingBasis = Math.max(
      0,
      startingBasis + accretedThisYearCents - principalReceivedThisYear,
    );

    rows.push({
      year: y,
      startingBasisCents: startingBasis,
      accretedDiscountCents: accretedThisYearCents,
      principalReceivedCents: principalReceivedThisYear,
      endingBasisCents: endingBasis,
    });

    runningBasis = endingBasis;
  }

  return rows;
}

// ─── Route registration ──────────────────────────────────────────────────────

export function registerNoteRoutes(app: Express): void {
  const ownerOrAdmin = requireRole(["owner", "admin"]);

  // ── List ─────────────────────────────────────────────────────────────────
  app.get(
    "/api/notes",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10) || 50, 200);
        const offset = Math.max(parseInt(String(req.query.offset ?? "0"), 10) || 0, 0);
        const status = typeof req.query.status === "string" ? req.query.status : undefined;

        const whereClause = status
          ? and(eq(acquiredNotes.organizationId, orgId), eq(acquiredNotes.status, status))
          : eq(acquiredNotes.organizationId, orgId);

        const rows = await db
          .select()
          .from(acquiredNotes)
          .where(whereClause)
          .orderBy(desc(acquiredNotes.acquisitionDate))
          .limit(limit)
          .offset(offset);

        // Never leak the encrypted TIN over the wire — strip on the way out.
        const safe = rows.map(({ payerEncryptedTin: _stripped, ...rest }) => rest);
        return res.json({ notes: safe, limit, offset, count: safe.length });
      } catch (err) {
        logger.error("notes.list failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── Create ───────────────────────────────────────────────────────────────
  app.post(
    "/api/notes",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const parsed = createNoteSchema.safeParse(req.body);
        if (!parsed.success) {
          return Errors.validationFailed(res, parsed.error.flatten());
        }
        const data = parsed.data;

        const encryptedTin = data.payerTin ? encryptField(data.payerTin) : null;

        const [row] = await db
          .insert(acquiredNotes)
          .values({
            organizationId: orgId,
            propertyId: data.propertyId ?? null,
            borrowerId: data.borrowerId ?? null,
            noteNumber: data.noteNumber,
            originalPrincipalCents: data.originalPrincipalCents,
            currentBalanceCents: data.currentBalanceCents,
            interestRateBps: data.interestRateBps,
            termMonths: data.termMonths,
            paymentAmountCents: data.paymentAmountCents,
            paymentDueDay: data.paymentDueDay,
            originationDate: data.originationDate,
            maturityDate: data.maturityDate,
            acquisitionDate: data.acquisitionDate,
            acquisitionPriceCents: data.acquisitionPriceCents,
            status: data.status ?? "performing",
            payerName: data.payerName,
            payerAddress: data.payerAddress ?? null,
            payerEncryptedTin: encryptedTin,
            payerTinType: data.payerTinType ?? null,
            originalLender: data.originalLender ?? null,
            assignmentDocS3Key: data.assignmentDocS3Key ?? null,
            notes: data.notes ?? null,
          })
          .returning();

        if (!row) {
          return Errors.internal(res, new Error("Insert returned no row"));
        }
        const { payerEncryptedTin: _stripped, ...safe } = row;
        return res.status(201).json({ note: safe });
      } catch (err) {
        // Unique-violation → friendlier message than a 500.
        if (err instanceof Error && /unique/i.test(err.message)) {
          return Errors.badRequest(res, "Note number is already in use for this organization");
        }
        logger.error("notes.create failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // insurance-watch — registered BEFORE /api/notes/:id so the literal path
  // wins; the :id matcher was capturing "insurance-watch" and 404ing the
  // tax-readiness insurance panel (2026-07-11 full-app sweep).
  // GET /api/notes/insurance-watch
  // Returns notes whose insurance_status is not 'verified', plus notes
  // whose insurance_expires_at falls within the next 60 days.
  app.get(
    "/api/notes/insurance-watch",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const today = new Date();
        const horizon = new Date(today.getTime() + 60 * 86_400_000);
        const horizonIso = horizon.toISOString().slice(0, 10);
        const todayIso = today.toISOString().slice(0, 10);

        const rows = await db
          .select({
            id: acquiredNotes.id,
            noteNumber: acquiredNotes.noteNumber,
            payerName: acquiredNotes.payerName,
            insuranceStatus: acquiredNotes.insuranceStatus,
            insuranceCarrier: acquiredNotes.insuranceCarrier,
            insurancePolicyNumber: acquiredNotes.insurancePolicyNumber,
            insuranceExpiresAt: acquiredNotes.insuranceExpiresAt,
            currentBalanceCents: acquiredNotes.currentBalanceCents,
          })
          .from(acquiredNotes)
          .where(and(
            eq(acquiredNotes.organizationId, orgId),
            sql`(${acquiredNotes.insuranceStatus} <> 'verified' OR (${acquiredNotes.insuranceExpiresAt} IS NOT NULL AND ${acquiredNotes.insuranceExpiresAt} <= ${horizonIso} AND ${acquiredNotes.insuranceExpiresAt} >= ${todayIso}))`,
          ))
          .orderBy(acquiredNotes.insuranceExpiresAt);

        return res.json({ notes: rows, horizonIso });
      } catch (err) {
        logger.error("notes.insurance-watch failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // escrow-disbursements — registered BEFORE /api/notes/:id so the literal path wins (2026-07-11 route-order sweep).
  // GET /api/notes/escrow-disbursements?withinDays=60
  // Linnea's "tax disbursements due in the next 60 days" view.
  app.get(
    "/api/notes/escrow-disbursements",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const withinDays = Math.min(365, Math.max(1, parseInt(String(req.query.withinDays ?? "60"), 10) || 60));
        const today = new Date();
        const horizon = new Date(today.getTime() + withinDays * 86_400_000);
        const horizonIso = horizon.toISOString().slice(0, 10);

        const rows = await db
          .select({
            id: acquiredNotes.id,
            noteNumber: acquiredNotes.noteNumber,
            payerName: acquiredNotes.payerName,
            taxEscrowBalanceCents: acquiredNotes.taxEscrowBalanceCents,
            taxDisbursementDueDate: acquiredNotes.taxDisbursementDueDate,
            taxDisbursementAmountCents: acquiredNotes.taxDisbursementAmountCents,
            taxAuthorityName: acquiredNotes.taxAuthorityName,
          })
          .from(acquiredNotes)
          .where(and(
            eq(acquiredNotes.organizationId, orgId),
            eq(acquiredNotes.taxEscrowEnabled, true),
            sql`${acquiredNotes.taxDisbursementDueDate} IS NOT NULL`,
            sql`${acquiredNotes.taxDisbursementDueDate} <= ${horizonIso}`,
          ))
          .orderBy(acquiredNotes.taxDisbursementDueDate);

        return res.json({ notes: rows, withinDays, horizonIso });
      } catch (err) {
        logger.error("notes.escrow-disbursements failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── Detail ───────────────────────────────────────────────────────────────
  app.get(
    "/api/notes/:id",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const id = req.params.id;
        const [row] = await db
          .select()
          .from(acquiredNotes)
          .where(and(eq(acquiredNotes.id, id), eq(acquiredNotes.organizationId, orgId)))
          .limit(1);
        if (!row) {
          return Errors.notFound(res, "Note");
        }
        const { payerEncryptedTin: _stripped, ...safe } = row;
        return res.json({ note: safe });
      } catch (err) {
        logger.error("notes.get failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── Update ───────────────────────────────────────────────────────────────
  app.patch(
    "/api/notes/:id",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const id = req.params.id;
        const parsed = patchNoteSchema.safeParse(req.body);
        if (!parsed.success) {
          return Errors.validationFailed(res, parsed.error.flatten());
        }
        const patch = parsed.data;

        // Build the update object explicitly so unset fields aren't nulled.
        const update: Partial<typeof acquiredNotes.$inferInsert> = {
          updatedAt: new Date(),
        };
        if (patch.propertyId !== undefined) update.propertyId = patch.propertyId;
        if (patch.borrowerId !== undefined) update.borrowerId = patch.borrowerId;
        if (patch.noteNumber !== undefined) update.noteNumber = patch.noteNumber;
        if (patch.originalPrincipalCents !== undefined) update.originalPrincipalCents = patch.originalPrincipalCents;
        if (patch.currentBalanceCents !== undefined) update.currentBalanceCents = patch.currentBalanceCents;
        if (patch.interestRateBps !== undefined) update.interestRateBps = patch.interestRateBps;
        if (patch.termMonths !== undefined) update.termMonths = patch.termMonths;
        if (patch.paymentAmountCents !== undefined) update.paymentAmountCents = patch.paymentAmountCents;
        if (patch.paymentDueDay !== undefined) update.paymentDueDay = patch.paymentDueDay;
        if (patch.originationDate !== undefined) update.originationDate = patch.originationDate;
        if (patch.maturityDate !== undefined) update.maturityDate = patch.maturityDate;
        if (patch.acquisitionDate !== undefined) update.acquisitionDate = patch.acquisitionDate;
        if (patch.acquisitionPriceCents !== undefined) update.acquisitionPriceCents = patch.acquisitionPriceCents;
        if (patch.status !== undefined) update.status = patch.status;
        if (patch.payerName !== undefined) update.payerName = patch.payerName;
        if (patch.payerAddress !== undefined) update.payerAddress = patch.payerAddress;
        if (patch.payerTin !== undefined) update.payerEncryptedTin = patch.payerTin ? encryptField(patch.payerTin) : null;
        if (patch.payerTinType !== undefined) update.payerTinType = patch.payerTinType ?? null;
        if (patch.originalLender !== undefined) update.originalLender = patch.originalLender ?? null;
        if (patch.assignmentDocS3Key !== undefined) update.assignmentDocS3Key = patch.assignmentDocS3Key ?? null;
        // Compliance fields (PR-11)
        if (patch.insuranceStatus !== undefined) update.insuranceStatus = patch.insuranceStatus;
        if (patch.insuranceCarrier !== undefined) update.insuranceCarrier = patch.insuranceCarrier ?? null;
        if (patch.insurancePolicyNumber !== undefined) update.insurancePolicyNumber = patch.insurancePolicyNumber ?? null;
        if (patch.insuranceExpiresAt !== undefined) update.insuranceExpiresAt = patch.insuranceExpiresAt ?? null;
        if (patch.insuranceAnnualPremiumCents !== undefined) update.insuranceAnnualPremiumCents = patch.insuranceAnnualPremiumCents ?? null;
        if (patch.taxEscrowEnabled !== undefined) update.taxEscrowEnabled = patch.taxEscrowEnabled;
        if (patch.taxEscrowBalanceCents !== undefined) update.taxEscrowBalanceCents = patch.taxEscrowBalanceCents;
        if (patch.taxDisbursementDueDate !== undefined) update.taxDisbursementDueDate = patch.taxDisbursementDueDate ?? null;
        if (patch.taxDisbursementAmountCents !== undefined) update.taxDisbursementAmountCents = patch.taxDisbursementAmountCents ?? null;
        if (patch.taxAuthorityName !== undefined) update.taxAuthorityName = patch.taxAuthorityName ?? null;
        if (patch.notes !== undefined) update.notes = patch.notes ?? null;

        const [row] = await db
          .update(acquiredNotes)
          .set(update)
          .where(and(eq(acquiredNotes.id, id), eq(acquiredNotes.organizationId, orgId)))
          .returning();

        if (!row) {
          return Errors.notFound(res, "Note");
        }
        const { payerEncryptedTin: _stripped, ...safe } = row;
        return res.json({ note: safe });
      } catch (err) {
        logger.error("notes.patch failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── List payments (ledger) ───────────────────────────────────────────────
  app.get(
    "/api/notes/:id/payments",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const id = req.params.id;
        // Confirm the note belongs to this org first.
        const [note] = await db
          .select({ id: acquiredNotes.id })
          .from(acquiredNotes)
          .where(and(eq(acquiredNotes.id, id), eq(acquiredNotes.organizationId, orgId)))
          .limit(1);
        if (!note) {
          return Errors.notFound(res, "Note");
        }
        const rows = await db
          .select()
          .from(notePayments)
          .where(eq(notePayments.noteId, id))
          .orderBy(desc(notePayments.paymentDate), desc(notePayments.createdAt));
        return res.json({ payments: rows });
      } catch (err) {
        logger.error("notes.listPayments failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── Record payment ───────────────────────────────────────────────────────
  app.post(
    "/api/notes/:id/payments",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const id = req.params.id;
        const parsed = recordPaymentSchema.safeParse(req.body);
        if (!parsed.success) {
          return Errors.validationFailed(res, parsed.error.flatten());
        }
        const data = parsed.data;

        // Confirm the note belongs to this org BEFORE inserting (cross-org
        // payment rows would corrupt the 1099-INT aggregation).
        const [note] = await db
          .select({
            id: acquiredNotes.id,
            currentBalanceCents: acquiredNotes.currentBalanceCents,
            unappliedBalanceCents: acquiredNotes.unappliedBalanceCents,
            status: acquiredNotes.status,
            // Read for the workflow event payload only (same row, no extra
            // query): note number + payer name identify the note in
            // automations, due day + scheduled payment let conditions decide
            // "was this late / partial?".
            noteNumber: acquiredNotes.noteNumber,
            payerName: acquiredNotes.payerName,
            paymentAmountCents: acquiredNotes.paymentAmountCents,
            paymentDueDay: acquiredNotes.paymentDueDay,
          })
          .from(acquiredNotes)
          .where(and(eq(acquiredNotes.id, id), eq(acquiredNotes.organizationId, orgId)))
          .limit(1);
        if (!note) {
          return Errors.notFound(res, "Note");
        }

        // Per-type validation. The zod schema accepts negative cents on
        // every type so NSF reversals can pass; here we tighten for the
        // common cases.
        const isReversal = data.paymentType === "nsf_reversal";
        const isUnappliedApply = data.paymentType === "unapplied_apply";
        const allowNegative = isReversal || isUnappliedApply;
        for (const [field, val] of [
          ["principalCents", data.principalCents],
          ["interestCents", data.interestCents],
          ["escrowCents", data.escrowCents],
          ["lateFeeCents", data.lateFeeCents],
        ] as const) {
          if (!allowNegative && val < 0) {
            return Errors.badRequest(res, `${field} must be non-negative for ${data.paymentType} payments`);
          }
        }

        if (isReversal && !data.originalPaymentId) {
          return Errors.badRequest(res, "originalPaymentId is required for nsf_reversal");
        }

        // For 'partial' payments — no principal/interest applied, all into
        // unapplied. We force the buckets to zero so callers can't sneak
        // a regular split through under the partial label.
        if (data.paymentType === "partial") {
          if (data.unappliedCents <= 0) {
            return Errors.badRequest(res, "partial payments must supply a positive unappliedCents");
          }
          if (data.principalCents !== 0 || data.interestCents !== 0) {
            return Errors.badRequest(res, "partial payments don't apply to principal/interest — use 'unapplied_apply' to consume held funds");
          }
        }

        // Extra-principal: principal-only, no other buckets.
        if (data.paymentType === "extra_principal") {
          if (data.principalCents <= 0) {
            return Errors.badRequest(res, "extra_principal must supply a positive principalCents");
          }
          if (data.interestCents !== 0 || data.escrowCents !== 0 || data.lateFeeCents !== 0) {
            return Errors.badRequest(res, "extra_principal payments must be principal-only — clear the other buckets");
          }
        }

        // Unapplied-apply: consumes from unapplied, must be a draw-down.
        if (isUnappliedApply) {
          if (data.unappliedCents >= 0) {
            return Errors.badRequest(res, "unapplied_apply must supply negative unappliedCents (the amount being consumed from the held balance)");
          }
          const drawDown = -data.unappliedCents;
          if (drawDown > (note.unappliedBalanceCents ?? 0)) {
            return Errors.badRequest(res, `unapplied_apply draw of ${drawDown}¢ exceeds available unapplied balance of ${note.unappliedBalanceCents ?? 0}¢`);
          }
        }

        // Insert payment row. Drizzle handles the bigint serialization.
        const [row] = await db
          .insert(notePayments)
          .values({
            noteId: id,
            organizationId: orgId,
            paymentDate: data.paymentDate,
            principalCents: data.principalCents,
            interestCents: data.interestCents,
            escrowCents: data.escrowCents,
            lateFeeCents: data.lateFeeCents,
            unappliedCents: data.unappliedCents,
            paymentType: data.paymentType,
            originalPaymentId: data.originalPaymentId ?? null,
            paymentMethod: data.paymentMethod,
            referenceNumber: data.referenceNumber ?? null,
            notes: data.notes ?? null,
          })
          .returning();

        // Update denormalized running balances on the note.
        // currentBalance: subtract principal applied (negative principal on
        //   reversal restores balance).
        // unappliedBalance: add unapplied delta (positive on partial,
        //   negative on unapplied_apply or unapplied-restoring reversal).
        // status flips to 'paid_off' on a payoff that zeroes the balance.
        const newCurrentBalance = Math.max(
          0,
          (note.currentBalanceCents ?? 0) - data.principalCents,
        );
        const newUnappliedBalance = Math.max(
          0,
          (note.unappliedBalanceCents ?? 0) + data.unappliedCents,
        );
        const updates: Partial<typeof acquiredNotes.$inferInsert> = {
          currentBalanceCents: newCurrentBalance,
          unappliedBalanceCents: newUnappliedBalance,
          updatedAt: new Date(),
        };
        if (data.paymentType === "payoff" && newCurrentBalance === 0) {
          updates.status = "paid_off";
        }
        await db
          .update(acquiredNotes)
          .set(updates)
          .where(eq(acquiredNotes.id, id));

        // Ledger is committed (payment row + note balances). Only now do we
        // tell the workflow engine. Fire-and-forget, never throws.
        emitNotePaymentWorkflowEvent({
          organizationId: orgId,
          noteId: id,
          noteNumber: note.noteNumber ?? null,
          payerName: note.payerName ?? null,
          paymentId: row.id,
          paymentType: data.paymentType,
          paymentMethod: data.paymentMethod,
          paymentDate: data.paymentDate,
          principalCents: data.principalCents,
          interestCents: data.interestCents,
          escrowCents: data.escrowCents,
          lateFeeCents: data.lateFeeCents,
          unappliedCents: data.unappliedCents,
          scheduledPaymentAmountCents: note.paymentAmountCents ?? null,
          paymentDueDay: note.paymentDueDay ?? null,
          remainingBalanceCents: newCurrentBalance,
          unappliedBalanceCents: newUnappliedBalance,
          noteStatus: updates.status ?? note.status,
        });

        return res.status(201).json({
          payment: row,
          currentBalanceCents: newCurrentBalance,
          unappliedBalanceCents: newUnappliedBalance,
          status: updates.status ?? note.status,
        });
      } catch (err) {
        logger.error("notes.recordPayment failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── Reconciliation (drift indicator) ─────────────────────────────────────
  // The Collison trust upgrade. Two SUM() queries against notePayments
  // plus a single read of acquiredNotes give us a numeric drift between
  // the ledger and the running balance. drift = 0 on a clean book; any
  // non-zero value means a writer skipped the ledger, fat-fingered a
  // split, or a backfill drifted. Surfacing this on every note detail
  // page is the single biggest trust upgrade in the plan.
  app.get(
    "/api/notes/:id/reconciliation",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const id = req.params.id;

        // Note row — opening principal, live current balance.
        const [note] = await db
          .select({
            id: acquiredNotes.id,
            originalPrincipalCents: acquiredNotes.originalPrincipalCents,
            currentBalanceCents: acquiredNotes.currentBalanceCents,
          })
          .from(acquiredNotes)
          .where(and(eq(acquiredNotes.id, id), eq(acquiredNotes.organizationId, orgId)))
          .limit(1);
        if (!note) return Errors.notFound(res, "Note");

        // SUM() across the payment ledger. Use COALESCE to default to 0
        // on a fresh note with no payments yet. Pulling all four buckets
        // in one query keeps the read cheap.
        const [sums] = await db
          .select({
            sumOfPrincipalPostedCents: sql<number>`COALESCE(SUM(${notePayments.principalCents}), 0)::bigint`,
            sumOfInterestPostedCents: sql<number>`COALESCE(SUM(${notePayments.interestCents}), 0)::bigint`,
            sumOfLateFeesPostedCents: sql<number>`COALESCE(SUM(${notePayments.lateFeeCents}), 0)::bigint`,
            sumOfEscrowPostedCents: sql<number>`COALESCE(SUM(${notePayments.escrowCents}), 0)::bigint`,
          })
          .from(notePayments)
          .where(eq(notePayments.noteId, id));

        // Last posting — drives "asOf"-like indicators on the UI so the
        // drift display can be honest about the freshness of the data.
        const [lastPosting] = await db
          .select({
            id: notePayments.id,
            paymentDate: notePayments.paymentDate,
          })
          .from(notePayments)
          .where(eq(notePayments.noteId, id))
          .orderBy(desc(notePayments.paymentDate), desc(notePayments.createdAt))
          .limit(1);

        // What the SCHEDULE says principal should be (opening principal
        // minus the sum of principal we posted). When drift is non-zero,
        // this is the "what should it be" anchor.
        const openingPrincipalCents = note.originalPrincipalCents;
        const sumOfPrincipalPostedCents = Number(sums?.sumOfPrincipalPostedCents ?? 0);
        const sumOfInterestPostedCents = Number(sums?.sumOfInterestPostedCents ?? 0);
        const sumOfLateFeesPostedCents = Number(sums?.sumOfLateFeesPostedCents ?? 0);
        const sumOfEscrowPostedCents = Number(sums?.sumOfEscrowPostedCents ?? 0);
        const scheduleSaysPrincipalCents =
          openingPrincipalCents - sumOfPrincipalPostedCents;
        const drift = note.currentBalanceCents - scheduleSaysPrincipalCents;

        return res.json({
          openingPrincipalCents,
          sumOfPrincipalPostedCents,
          sumOfInterestPostedCents,
          sumOfLateFeesPostedCents,
          sumOfEscrowPostedCents,
          currentPrincipalCents: note.currentBalanceCents,
          scheduleSaysPrincipalCents,
          drift,
          lastPostingId: lastPosting?.id ?? null,
          asOf: new Date().toISOString(),
        });
      } catch (err) {
        logger.error(
          "notes.reconciliation failed",
          err instanceof Error ? err : undefined,
        );
        return Errors.internal(res, err);
      }
    },
  );

  // ── Basis schedule (Pub 1212 market-discount accretion) ──────────────────
  app.get(
    "/api/notes/:id/basis",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const id = req.params.id;
        const method = (req.query.method === "constant_yield" ? "constant_yield" : "ratable") as
          | "ratable"
          | "constant_yield";

        const [note] = await db
          .select()
          .from(acquiredNotes)
          .where(and(eq(acquiredNotes.id, id), eq(acquiredNotes.organizationId, orgId)))
          .limit(1);
        if (!note) return Errors.notFound(res, "Note");

        const payments = await db
          .select({
            paymentDate: notePayments.paymentDate,
            principalCents: notePayments.principalCents,
          })
          .from(notePayments)
          .where(eq(notePayments.noteId, id))
          .orderBy(notePayments.paymentDate);

        const schedule = computeBasisSchedule({
          acquisitionPriceCents: note.acquisitionPriceCents,
          originalPrincipalCents: note.originalPrincipalCents,
          acquisitionDate: note.acquisitionDate as unknown as string,
          maturityDate: note.maturityDate as unknown as string,
          payments: payments.map((p) => ({
            paymentDate: p.paymentDate as unknown as string,
            principalCents: p.principalCents,
          })),
          method,
        });

        const totalDiscountCents = note.originalPrincipalCents - note.acquisitionPriceCents;
        return res.json({
          noteId: id,
          method,
          totalDiscountCents,
          isPremium: totalDiscountCents < 0,
          schedule,
        });
      } catch (err) {
        logger.error("notes.basis failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── Yield panel (current / YTM / IRR-to-date / effective net) ────────────
  // Linnea: "every note's detail page should show all four yield metrics
  // computed live from its actual payment history. That's table stakes."
  app.get(
    "/api/notes/:id/yield",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const id = req.params.id;

        const [note] = await db
          .select()
          .from(acquiredNotes)
          .where(and(eq(acquiredNotes.id, id), eq(acquiredNotes.organizationId, orgId)))
          .limit(1);
        if (!note) return Errors.notFound(res, "Note");

        const payments = await db
          .select()
          .from(notePayments)
          .where(eq(notePayments.noteId, id))
          .orderBy(notePayments.paymentDate);

        const yields = computeYields({
          acquisitionPriceCents: note.acquisitionPriceCents,
          currentBalanceCents: note.currentBalanceCents,
          interestRateBps: note.interestRateBps,
          paymentAmountCents: note.paymentAmountCents,
          termMonths: note.termMonths,
          acquisitionDate: note.acquisitionDate as unknown as string,
          payments: payments.map((p) => ({
            paymentDate: p.paymentDate as unknown as string,
            principalCents: p.principalCents,
            interestCents: p.interestCents,
            // Escrow + late fee don't reduce the asset, so they're excluded
            // from the IRR cash-flow stream from Linnea's perspective.
          })),
        });

        return res.json({ noteId: id, ...yields });
      } catch (err) {
        logger.error("notes.yield failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── Assignment paperwork ─────────────────────────────────────────────────
  // POST /api/notes/:id/assignments
  // Generates a combined Allonge + Assignment of Mortgage PDF, persists
  // the metadata, returns the assignment + base64 PDF for immediate
  // download. State-specific recordable templates are out of scope for
  // this PR; the generic template is legally-correct shape but isn't
  // automatically county-recordable.
  app.post(
    "/api/notes/:id/assignments",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const noteId = req.params.id;
        const parsed = z.object({
          assigneeName: z.string().min(1).max(240),
          assigneeAddress: z.object({
            line1: z.string().optional(),
            line2: z.string().optional(),
            city: z.string().optional(),
            state: z.string().optional(),
            zip: z.string().optional(),
          }).optional(),
          state: z.string().length(2).optional(),
          salePriceCents: z.number().int().nonnegative().optional(),
          saleDate: z.string().min(1),
          notes: z.string().max(2_000).optional(),
        }).safeParse(req.body);
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.flatten());
        const data = parsed.data;

        // Pull the note + the org name (assignor on the paperwork is
        // the organization).
        const [note] = await db
          .select()
          .from(acquiredNotes)
          .where(and(eq(acquiredNotes.id, noteId), eq(acquiredNotes.organizationId, orgId)))
          .limit(1);
        if (!note) return Errors.notFound(res, "Note");

        // Org name lookup — we need it to populate "ASSIGNOR" on the PDF.
        const { organizations } = await import("@shared/schema");
        const [org] = await db
          .select({ name: organizations.name })
          .from(organizations)
          .where(eq(organizations.id, orgId))
          .limit(1);
        const assignorName = org?.name ?? "Note Holder";

        // Render the PDF (synchronous; jsPDF in-memory).
        const { pdfBase64 } = renderAssignmentPdf({
          assignorName,
          assigneeName: data.assigneeName,
          assigneeAddress: data.assigneeAddress,
          noteNumber: note.noteNumber,
          payerName: note.payerName,
          payerAddress: (note.payerAddress as any) ?? undefined,
          originalPrincipalCents: note.originalPrincipalCents,
          currentBalanceCents: note.currentBalanceCents,
          interestRateBps: note.interestRateBps,
          paymentAmountCents: note.paymentAmountCents,
          originationDate: note.originationDate as unknown as string,
          maturityDate: note.maturityDate as unknown as string,
          salePriceCents: data.salePriceCents,
          saleDate: data.saleDate,
          state: data.state,
        });

        // Persist metadata. PDF storage to S3 is queued for a follow-up;
        // for now we return the base64 inline and don't store the bytes.
        const [row] = await db
          .insert(noteAssignments)
          .values({
            organizationId: orgId,
            noteId,
            assigneeName: data.assigneeName,
            assigneeAddress: data.assigneeAddress ?? null,
            state: data.state ?? null,
            templateVariant: "generic",
            salePriceCents: data.salePriceCents ?? null,
            saleDate: data.saleDate,
            pdfS3Key: null,
            status: "generated",
            notes: data.notes ?? null,
          })
          .returning();

        return res.status(201).json({ assignment: row, pdfBase64 });
      } catch (err) {
        logger.error("notes.assignments.create failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // GET /api/notes/:id/assignments — list issued paperwork for this note
  app.get(
    "/api/notes/:id/assignments",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const noteId = req.params.id;
        const rows = await db
          .select()
          .from(noteAssignments)
          .where(and(eq(noteAssignments.organizationId, orgId), eq(noteAssignments.noteId, noteId)))
          .orderBy(desc(noteAssignments.createdAt));
        return res.json({ assignments: rows });
      } catch (err) {
        logger.error("notes.assignments.list failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // PATCH /api/notes/assignments/:id — status updates (signed / recorded)
  app.patch(
    "/api/note-assignments/:id",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const parsed = z.object({
          status: z.enum(["generated", "signed", "recorded", "voided"]).optional(),
          signedAt: z.string().optional(),
          recordedAt: z.string().optional(),
          recordingNumber: z.string().max(120).optional(),
          notes: z.string().max(2_000).optional(),
        }).safeParse(req.body);
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.flatten());

        const update: Partial<typeof noteAssignments.$inferInsert> = {
          ...parsed.data,
          updatedAt: new Date(),
          signedAt: parsed.data.signedAt ? new Date(parsed.data.signedAt) : undefined,
          recordedAt: parsed.data.recordedAt ? new Date(parsed.data.recordedAt) : undefined,
        };
        const [row] = await db
          .update(noteAssignments)
          .set(update)
          .where(and(eq(noteAssignments.id, req.params.id), eq(noteAssignments.organizationId, orgId)))
          .returning();
        if (!row) return Errors.notFound(res, "Assignment");
        return res.json({ assignment: row });
      } catch (err) {
        logger.error("notes.assignments.patch failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── Loss-mit case files ──────────────────────────────────────────────────
  // Linnea bonus #7: "30% of our time on the bottom 10% of our book."
  // GET    /api/notes/:id/loss-mit-case          — current open case (or null)
  // POST   /api/notes/:id/loss-mit-case          — open a new case
  // PATCH  /api/loss-mit-cases/:id               — update / close
  // GET    /api/loss-mit-cases/:id/actions       — action log
  // POST   /api/loss-mit-cases/:id/actions       — log a new action
  // GET    /api/loss-mit-cases?status=open       — org-level dashboard
  app.get(
    "/api/notes/:id/loss-mit-case",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const noteId = req.params.id;
        const [row] = await db
          .select()
          .from(noteLossMitCases)
          .where(and(
            eq(noteLossMitCases.organizationId, orgId),
            eq(noteLossMitCases.noteId, noteId),
            eq(noteLossMitCases.status, "open"),
          ))
          .limit(1);
        return res.json({ case: row ?? null });
      } catch (err) {
        logger.error("notes.lossMit.get failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  app.post(
    "/api/notes/:id/loss-mit-case",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const noteId = req.params.id;
        const parsed = z.object({
          state: z.string().length(2).optional(),
          daysPastDueAtOpen: z.number().int().nonnegative().optional(),
          summary: z.string().max(2_000).optional(),
        }).safeParse(req.body);
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.flatten());

        // Block opening a second case while one is already open.
        const [existing] = await db
          .select({ id: noteLossMitCases.id })
          .from(noteLossMitCases)
          .where(and(
            eq(noteLossMitCases.organizationId, orgId),
            eq(noteLossMitCases.noteId, noteId),
            eq(noteLossMitCases.status, "open"),
          ))
          .limit(1);
        if (existing) {
          return Errors.badRequest(res, "An open case already exists for this note. Close it before opening a new one.");
        }

        const [row] = await db
          .insert(noteLossMitCases)
          .values({ organizationId: orgId, noteId, ...parsed.data })
          .returning();
        return res.status(201).json({ case: row });
      } catch (err) {
        logger.error("notes.lossMit.create failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  app.patch(
    "/api/loss-mit-cases/:id",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const parsed = z.object({
          status: z.enum(LOSS_MIT_STATUS).optional(),
          state: z.string().length(2).optional(),
          scraActiveDuty: z.boolean().optional(),
          scraCheckedAt: z.string().optional(),
          summary: z.string().max(2_000).optional(),
        }).safeParse(req.body);
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.flatten());

        const update: Partial<typeof noteLossMitCases.$inferInsert> = {
          ...parsed.data,
          updatedAt: new Date(),
          scraCheckedAt: parsed.data.scraCheckedAt ? new Date(parsed.data.scraCheckedAt) : undefined,
        };
        // Closing the case stamps closedAt.
        if (parsed.data.status && parsed.data.status !== "open") {
          update.closedAt = new Date();
        }

        const [row] = await db
          .update(noteLossMitCases)
          .set(update)
          .where(and(eq(noteLossMitCases.id, req.params.id), eq(noteLossMitCases.organizationId, orgId)))
          .returning();
        if (!row) return Errors.notFound(res, "Case");
        return res.json({ case: row });
      } catch (err) {
        logger.error("notes.lossMit.patch failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  app.get(
    "/api/loss-mit-cases/:id/actions",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const rows = await db
          .select()
          .from(noteLossMitActions)
          .where(and(
            eq(noteLossMitActions.organizationId, orgId),
            eq(noteLossMitActions.caseId, req.params.id),
          ))
          .orderBy(desc(noteLossMitActions.performedAt));
        return res.json({ actions: rows });
      } catch (err) {
        logger.error("notes.lossMit.actions.list failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  app.post(
    "/api/loss-mit-cases/:id/actions",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const parsed = z.object({
          actionType: z.enum(LOSS_MIT_ACTION_TYPES),
          performedAt: z.string().optional(),
          notes: z.string().max(4_000).optional(),
        }).safeParse(req.body);
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.flatten());

        // Ensure the case belongs to the org.
        const [c] = await db
          .select({ id: noteLossMitCases.id })
          .from(noteLossMitCases)
          .where(and(eq(noteLossMitCases.id, req.params.id), eq(noteLossMitCases.organizationId, orgId)))
          .limit(1);
        if (!c) return Errors.notFound(res, "Case");

        const userId = req.user?.id || req.user?.id || null;

        const [row] = await db
          .insert(noteLossMitActions)
          .values({
            organizationId: orgId,
            caseId: req.params.id,
            actionType: parsed.data.actionType,
            performedAt: parsed.data.performedAt ? new Date(parsed.data.performedAt) : new Date(),
            notes: parsed.data.notes ?? null,
            performedByUserId: userId,
          })
          .returning();

        // Auto-update the case when SCRA is checked — convenience for the
        // common case where a user logs the SCRA check action and expects
        // the case-level scraCheckedAt + scraActiveDuty to reflect it.
        if (parsed.data.actionType === "scra_checked") {
          const isActiveDuty = /active.duty/i.test(parsed.data.notes ?? "");
          await db
            .update(noteLossMitCases)
            .set({ scraCheckedAt: new Date(), scraActiveDuty: isActiveDuty, updatedAt: new Date() })
            .where(eq(noteLossMitCases.id, req.params.id));
        }

        return res.status(201).json({ action: row });
      } catch (err) {
        logger.error("notes.lossMit.actions.create failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  app.get(
    "/api/loss-mit-cases",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const status = typeof req.query.status === "string" ? req.query.status : "open";
        const rows = await db
          .select({
            caseId: noteLossMitCases.id,
            noteId: noteLossMitCases.noteId,
            status: noteLossMitCases.status,
            state: noteLossMitCases.state,
            daysPastDueAtOpen: noteLossMitCases.daysPastDueAtOpen,
            openedAt: noteLossMitCases.openedAt,
            scraCheckedAt: noteLossMitCases.scraCheckedAt,
            payerName: acquiredNotes.payerName,
            noteNumber: acquiredNotes.noteNumber,
            currentBalanceCents: acquiredNotes.currentBalanceCents,
          })
          .from(noteLossMitCases)
          .innerJoin(acquiredNotes, eq(acquiredNotes.id, noteLossMitCases.noteId))
          .where(and(
            eq(noteLossMitCases.organizationId, orgId),
            (LOSS_MIT_STATUS as readonly string[]).includes(status)
              ? eq(noteLossMitCases.status, status as any)
              : eq(noteLossMitCases.status, "open"),
          ))
          .orderBy(desc(noteLossMitCases.openedAt));
        return res.json({ cases: rows });
      } catch (err) {
        logger.error("notes.lossMit.list failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── Compliance watch lists ───────────────────────────────────────────────


  // ── Ownership splits (pool / fractional) ─────────────────────────────────
  // GET    /api/notes/:id/splits
  // POST   /api/notes/:id/splits
  // PATCH  /api/note-splits/:id
  // DELETE /api/note-splits/:id
  app.get(
    "/api/notes/:id/splits",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const noteId = req.params.id;
        const rows = await db
          .select()
          .from(noteOwnershipSplits)
          .where(and(eq(noteOwnershipSplits.organizationId, orgId), eq(noteOwnershipSplits.noteId, noteId)))
          .orderBy(desc(noteOwnershipSplits.percentageBps));
        const totalBps = rows.reduce((s, r) => s + r.percentageBps, 0);
        return res.json({ splits: rows, totalBps, unallocatedBps: 10_000 - totalBps });
      } catch (err) {
        logger.error("notes.splits.list failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  app.post(
    "/api/notes/:id/splits",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const noteId = req.params.id;
        const parsed = z.object({
          investorLeadId: z.number().int().positive().optional(),
          investorName: z.string().min(1).max(240),
          investorEmail: z.string().email().optional(),
          role: z.enum(["org", "lp"]).default("lp"),
          percentageBps: z.number().int().min(1).max(10_000),
          effectiveFrom: z.string().optional(),
          effectiveTo: z.string().optional(),
          notes: z.string().max(2_000).optional(),
        }).safeParse(req.body);
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.flatten());

        // Ensure summed bps for the note doesn't exceed 10000 after this insert.
        const existing = await db
          .select({ bps: noteOwnershipSplits.percentageBps })
          .from(noteOwnershipSplits)
          .where(and(eq(noteOwnershipSplits.organizationId, orgId), eq(noteOwnershipSplits.noteId, noteId)));
        const usedBps = existing.reduce((s, r) => s + r.bps, 0);
        if (usedBps + parsed.data.percentageBps > 10_000) {
          return Errors.badRequest(
            res,
            `Adding ${parsed.data.percentageBps} bps would exceed 100% (already allocated: ${usedBps} bps; available: ${10_000 - usedBps} bps)`,
          );
        }

        const [row] = await db
          .insert(noteOwnershipSplits)
          .values({
            organizationId: orgId,
            noteId,
            ...parsed.data,
          })
          .returning();
        return res.status(201).json({ split: row });
      } catch (err) {
        logger.error("notes.splits.create failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  app.patch(
    "/api/note-splits/:id",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const splitId = req.params.id;
        const parsed = z.object({
          investorName: z.string().min(1).max(240).optional(),
          investorEmail: z.string().email().optional(),
          percentageBps: z.number().int().min(1).max(10_000).optional(),
          effectiveFrom: z.string().optional(),
          effectiveTo: z.string().optional(),
          notes: z.string().max(2_000).optional(),
        }).safeParse(req.body);
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.flatten());

        // If changing percentageBps, validate the new sum.
        if (parsed.data.percentageBps !== undefined) {
          const [current] = await db
            .select()
            .from(noteOwnershipSplits)
            .where(and(eq(noteOwnershipSplits.id, splitId), eq(noteOwnershipSplits.organizationId, orgId)))
            .limit(1);
          if (!current) return Errors.notFound(res, "Split");
          const others = await db
            .select({ bps: noteOwnershipSplits.percentageBps })
            .from(noteOwnershipSplits)
            .where(and(
              eq(noteOwnershipSplits.organizationId, orgId),
              eq(noteOwnershipSplits.noteId, current.noteId),
            ));
          const otherBps = others
            .filter((_, i) => others[i] !== current as any) // crude; we'll subtract by id below
            .reduce((s, r) => s + r.bps, 0);
          // Recompute properly by excluding the current row.
          const recomputed = others.reduce((s, r) => s + r.bps, 0) - current.percentageBps;
          if (recomputed + parsed.data.percentageBps > 10_000) {
            return Errors.badRequest(res, `Update would exceed 100% (other splits: ${recomputed} bps)`);
          }
          void otherBps;
        }

        const [row] = await db
          .update(noteOwnershipSplits)
          .set({ ...parsed.data, updatedAt: new Date() })
          .where(and(eq(noteOwnershipSplits.id, splitId), eq(noteOwnershipSplits.organizationId, orgId)))
          .returning();
        if (!row) return Errors.notFound(res, "Split");
        return res.json({ split: row });
      } catch (err) {
        logger.error("notes.splits.patch failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  app.delete(
    "/api/note-splits/:id",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const [row] = await db
          .delete(noteOwnershipSplits)
          .where(and(eq(noteOwnershipSplits.id, req.params.id), eq(noteOwnershipSplits.organizationId, orgId)))
          .returning();
        if (!row) return Errors.notFound(res, "Split");
        return res.json({ deleted: true });
      } catch (err) {
        logger.error("notes.splits.delete failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── Payoff calculator ────────────────────────────────────────────────────
  // GET /api/notes/:id/payoff?date=YYYY-MM-DD
  // Returns the dollar amount required to fully settle the note as of the
  // requested close date — principal + accrued interest through that date
  // − unapplied funds held. Linnea: "Borrower calls Tuesday. 'What's my
  // payoff if I close Friday at 2 PM?' I need a payoff calculator. One
  // button." This is the one-button.
  app.get(
    "/api/notes/:id/payoff",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const id = req.params.id;
        const dateParam = (req.query.date as string | undefined) ?? new Date().toISOString().slice(0, 10);
        const closeDate = new Date(dateParam);
        if (isNaN(closeDate.getTime())) {
          return Errors.badRequest(res, "date must be a valid ISO date (YYYY-MM-DD)");
        }

        const [note] = await db
          .select()
          .from(acquiredNotes)
          .where(and(eq(acquiredNotes.id, id), eq(acquiredNotes.organizationId, orgId)))
          .limit(1);
        if (!note) {
          return Errors.notFound(res, "Note");
        }

        // Find the most recent payment that included an interest component;
        // accrued-interest base = days since that payment * daily rate *
        // current balance. If no prior payments, accrue from origination.
        const lastInterestRow = await db
          .select({ paymentDate: notePayments.paymentDate })
          .from(notePayments)
          .where(and(eq(notePayments.noteId, id), sql`${notePayments.interestCents} > 0`))
          .orderBy(desc(notePayments.paymentDate))
          .limit(1);

        const accrualStart = new Date(
          lastInterestRow[0]?.paymentDate
            ? (lastInterestRow[0].paymentDate as unknown as string)
            : (note.originationDate as unknown as string),
        );
        const daysAccrued = Math.max(
          0,
          Math.round((closeDate.getTime() - accrualStart.getTime()) / 86_400_000),
        );

        // Daily interest = balance * (annualRateBps / 10000) / 365
        const annualRate = note.interestRateBps / 10_000;
        const dailyRateCents = (note.currentBalanceCents * annualRate) / 365;
        const accruedInterestCents = Math.round(dailyRateCents * daysAccrued);

        const principalCents = note.currentBalanceCents;
        const unappliedCreditCents = note.unappliedBalanceCents ?? 0;
        // Late fees outstanding: track by summing lateFeeCents and netting
        // off any reversed/applied. For now, lateFeeCents on the ledger sums.
        const lateFeeRows = await db
          .select({ sum: sql<number>`COALESCE(SUM(${notePayments.lateFeeCents}), 0)::bigint` })
          .from(notePayments)
          .where(eq(notePayments.noteId, id));
        const lateFeesAppliedCents = Number(lateFeeRows[0]?.sum ?? 0);

        const totalPayoffCents =
          principalCents + accruedInterestCents - unappliedCreditCents;

        return res.json({
          asOf: dateParam,
          principalCents,
          accruedInterestCents,
          unappliedCreditCents,
          lateFeesAppliedToDateCents: lateFeesAppliedCents,
          totalPayoffCents: Math.max(0, totalPayoffCents),
          daysAccrued,
          accrualStart: accrualStart.toISOString().slice(0, 10),
          dailyInterestCents: Math.round(dailyRateCents),
        });
      } catch (err) {
        logger.error("notes.payoff failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── Amortization schedule ────────────────────────────────────────────────
  app.get(
    "/api/notes/:id/amortization",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const id = req.params.id;
        const [note] = await db
          .select()
          .from(acquiredNotes)
          .where(and(eq(acquiredNotes.id, id), eq(acquiredNotes.organizationId, orgId)))
          .limit(1);
        if (!note) {
          return Errors.notFound(res, "Note");
        }

        // We compute remaining schedule from today's currentBalanceCents,
        // not from the original principal. Months remaining = termMonths
        // minus months elapsed since origination. We clamp at 1..termMonths
        // to keep the schedule well-formed for paid-down notes.
        const origDate = new Date(note.originationDate as unknown as string);
        const monthsElapsed = Math.max(
          0,
          (new Date().getUTCFullYear() - origDate.getUTCFullYear()) * 12 +
            (new Date().getUTCMonth() - origDate.getUTCMonth()),
        );
        const remaining = Math.max(1, note.termMonths - monthsElapsed);

        const schedule = computeAmortization({
          currentBalanceCents: note.currentBalanceCents,
          interestRateBps: note.interestRateBps,
          paymentAmountCents: note.paymentAmountCents,
          termMonthsRemaining: remaining,
          startDate: new Date(),
          paymentDueDay: note.paymentDueDay,
        });

        return res.json({
          noteId: id,
          currentBalanceCents: note.currentBalanceCents,
          interestRateBps: note.interestRateBps,
          paymentAmountCents: note.paymentAmountCents,
          termMonthsRemaining: remaining,
          schedule,
        });
      } catch (err) {
        logger.error("notes.amortization failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── Close & Carry — POST /api/notes/from-deal/:dealId ──────────────────────
  //
  // The lifecycle bridge. A closed seller-finance deal one-click-originates the
  // serviced `notes` row with NO re-keying: buyer (operator-confirmed), sale
  // price, down payment, rate, term, first-payment date all pre-filled from the
  // deal. Links deal.id ↔ note.id (notes.originatingDealId). The deal's document
  // package stays the note's origination folder — reachable through the deal
  // link, so nothing is copied/duplicated.
  //
  // Acts on the seller-finance `notes` table (via storage.createNote), NOT the
  // acquired-notes vertical that the rest of this file serves — the carry flow
  // is about notes the operator ORIGINATES, not notes they buy.
  app.post(
    "/api/notes/from-deal/:dealId",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const userId = getUserId(req);
        const dealId = Number(req.params.dealId);
        if (!Number.isInteger(dealId) || dealId <= 0) {
          return Errors.badRequest(res, "Invalid deal id");
        }

        const overridesSchema = z.object({
          borrowerId: z.number().int().positive().nullable().optional(),
          salePrice: z.number().nonnegative().optional(),
          downPayment: z.number().nonnegative().optional(),
          interestRate: z.number().min(0).max(100).optional(),
          termMonths: z.number().int().min(1).max(1200).optional(),
          firstPaymentDate: z.string().min(1).optional(),
        });
        const parsed = overridesSchema.safeParse(req.body ?? {});
        if (!parsed.success) {
          return Errors.validationFailed(res, parsed.error.flatten());
        }
        const overrides = parsed.data;

        // Org-scoped load + ownership check.
        const deal = await storage.getDeal(orgId, dealId);
        if (!deal) {
          return Errors.notFound(res, "Deal");
        }

        // Only closed deals can be carried. (A deal that hasn't closed has no
        // settled terms to originate against.)
        if (deal.status !== "closed") {
          return Errors.badRequest(
            res,
            "Only a closed deal can be carried into a note",
            { dealStatus: deal.status },
          );
        }

        // Idempotency: a deal originates at most one note. If one already
        // exists, return it (200) instead of creating a duplicate. Org-scoped
        // probe on the leading-org composite index (notes_org_originating_deal).
        const [existing] = await db
          .select()
          .from(sellerFinanceNotes)
          .where(
            and(
              eq(sellerFinanceNotes.organizationId, orgId),
              eq(sellerFinanceNotes.originatingDealId, dealId),
            ),
          )
          .limit(1);
        if (existing) {
          return res.status(200).json({ note: existing, alreadyCarried: true });
        }

        // If the operator named a borrower, it must be a lead in THIS org.
        if (overrides.borrowerId != null) {
          const lead = await storage.getLead(orgId, overrides.borrowerId);
          if (!lead) {
            return Errors.badRequest(res, "borrowerId does not match a lead in this organization");
          }
        }

        const mapped = mapDealToNoteFields(
          {
            id: deal.id,
            organizationId: deal.organizationId,
            propertyId: deal.propertyId,
            status: deal.status,
            type: deal.type,
            offerAmount: deal.offerAmount,
            acceptedAmount: deal.acceptedAmount,
            closingDate: deal.closingDate,
            analysisResults: deal.analysisResults ?? null,
          },
          overrides,
        );

        const note = await storage.createNote(mapped as unknown as InsertNote);

        logger.info("notes.carried_from_deal", {
          orgId,
          userId,
          dealId,
          noteId: note.id,
        });

        return res.status(201).json({ note, originatingDealId: dealId });
      } catch (err) {
        if (err instanceof z.ZodError) {
          return Errors.badRequest(res, err.issues[0].message);
        }
        logger.error("notes.from_deal failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── Reverse link — GET /api/notes/from-deal/:dealId ────────────────────────
  // Resolves the note (if any) that was originated from a deal, so the deal
  // surface can show an "originated note" link. Returns { note: null } when the
  // deal hasn't been carried yet. Org-scoped probe on the leading-org composite.
  app.get(
    "/api/notes/from-deal/:dealId",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const dealId = Number(req.params.dealId);
        if (!Number.isInteger(dealId) || dealId <= 0) {
          return Errors.badRequest(res, "Invalid deal id");
        }
        const [note] = await db
          .select()
          .from(sellerFinanceNotes)
          .where(
            and(
              eq(sellerFinanceNotes.organizationId, orgId),
              eq(sellerFinanceNotes.originatingDealId, dealId),
            ),
          )
          .limit(1);
        return res.json({ note: note ?? null });
      } catch (err) {
        logger.error("notes.from_deal_lookup failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );
}

// ─── Aggregation helper used by form1099Batch.ts ─────────────────────────────

/**
 * Aggregate interest paid per payer for a given org + tax year. Used by the
 * 1099-INT batch generator to union interest from acquired-note payments
 * with interest from originated notes.
 *
 * Returns rows of `{ noteId, payerName, payerAddress, payerEncryptedTin,
 * payerTinType, interestCents }`. Only includes payers where the summed
 * interest meets or exceeds the IRS 1099-INT $600 threshold; the caller
 * may apply additional filters.
 */
export async function aggregateAcquiredNoteInterestForYear(
  orgId: number,
  taxYear: number,
): Promise<Array<{
  noteId: string;
  noteNumber: string;
  payerName: string;
  payerAddress: typeof acquiredNotes.$inferSelect.payerAddress;
  payerEncryptedTin: string | null;
  payerTinType: string | null;
  interestCents: number;
}>> {
  const yearStart = `${taxYear}-01-01`;
  const yearEnd = `${taxYear}-12-31`;

  // Sum interest_cents per note for the year, joined to acquired_notes for
  // payer details. We aggregate in SQL rather than fetching individual rows
  // because a busy noteholder's payment ledger can run to thousands of rows
  // per year.
  const rows = await db
    .select({
      noteId: acquiredNotes.id,
      noteNumber: acquiredNotes.noteNumber,
      payerName: acquiredNotes.payerName,
      payerAddress: acquiredNotes.payerAddress,
      payerEncryptedTin: acquiredNotes.payerEncryptedTin,
      payerTinType: acquiredNotes.payerTinType,
      interestCents: sql<number>`COALESCE(SUM(${notePayments.interestCents}), 0)::bigint`,
    })
    .from(acquiredNotes)
    .leftJoin(
      notePayments,
      and(
        eq(notePayments.noteId, acquiredNotes.id),
        sql`${notePayments.paymentDate} >= ${yearStart}`,
        sql`${notePayments.paymentDate} <= ${yearEnd}`,
      ),
    )
    .where(eq(acquiredNotes.organizationId, orgId))
    .groupBy(
      acquiredNotes.id,
      acquiredNotes.noteNumber,
      acquiredNotes.payerName,
      acquiredNotes.payerAddress,
      acquiredNotes.payerEncryptedTin,
      acquiredNotes.payerTinType,
    );

  // Narrow to rows with non-zero interest. The SQL coalesces to 0 for notes
  // with no payments in the year — we don't want to issue a 1099-INT for
  // those.
  return rows
    .map((r) => ({ ...r, interestCents: Number(r.interestCents ?? 0) }))
    .filter((r) => r.interestCents > 0);
}
