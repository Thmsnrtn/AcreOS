/**
 * RESPA annual escrow account analysis (12 CFR 1024.17).
 *
 * Every escrow account on a federally related mortgage requires an
 * annual escrow analysis at least once every 12 months. The analysis
 * computes the projected low point of the account over the next 12
 * months, compares it to the maximum allowable cushion, and determines
 * whether the account has a surplus, shortage, or deficiency.
 *
 * Key §1024.17 definitions and limits used here:
 *
 *   "Cushion" — additional funds the servicer may require to maintain
 *   in the account, capped at 1/6 of estimated total annual escrow
 *   disbursements (i.e. 2 months' worth of disbursements). State law
 *   may be tighter; this analysis uses the federal cap. §1024.17(c)(1).
 *
 *   "Surplus" — funds in the account in excess of (lowest projected
 *   monthly balance + cushion). If ≥ $50, refund within 30 days. If
 *   < $50, servicer may refund OR credit against next year's payments.
 *   §1024.17(f)(2).
 *
 *   "Shortage" — projected low point is positive but less than the
 *   target cushion. Servicer may collect the shortage as a lump sum
 *   (borrower's option) OR spread over ≥ 12 months. §1024.17(f)(3).
 *
 *   "Deficiency" — projected low point is negative (escrow is in the
 *   red). If < 1 month's escrow → may require single payment OR spread.
 *   If ≥ 1 month's escrow → MUST spread over ≥ 2 months. §1024.17(f)(4).
 *
 * Annual-escrow-statement (form HUD-1 substitute, §1024.17(i)) must be
 * delivered to the borrower within 30 days of the end of the
 * computation year. Servicer retention: 5 years (§1024.17(l)(1)).
 *
 * This service produces a RespaEscrowAnalysis shape AND the actual
 * §1024.17(i) annual escrow account statement artifact — see
 * `buildAnnualEscrowStatement` at the bottom of this file.
 *
 * WIRING STATUS (2026-08-01):
 *   - `analyzeEscrowAccount` IS wired: GET /api/notes/:id/escrow-analysis
 *     (server/routes-notes.ts) serves it, org-scoped, for the seller-finance
 *     (originated) `notes` book — the schema this module reads
 *     (notes.taxEscrowEnabled / monthlyTaxEscrow / taxEscrowBalance +
 *     tax_escrow_payments).
 *   - The ACQUIRED book (acquired_notes) is deliberately NOT served: it has
 *     no monthly escrow-deposit amount and only a single next-disbursement
 *     date/amount (taxDisbursementDueDate/AmountCents), so the 12-month
 *     trial-balance inputs this analysis requires do not exist for it.
 *     Inferring them would fabricate a compliance artifact.
 *   - `buildAnnualEscrowStatement` / `renderAnnualEscrowStatementPdf` remain
 *     deliberately UNWIRED (see the block comment above them).
 */

import { db } from "../db";
import { notes, taxEscrowPayments } from "@shared/schema";
import { and, eq, gte, lte } from "drizzle-orm";
import { jsPDF } from "jspdf";

export interface RespaEscrowAnalysisInput {
  noteId: number;
  /** Tenant scope — the analysis only reads notes belonging to this org. */
  organizationId: number;
  /** Computation-year start (typically the borrower's escrow anniversary date). */
  computationYearStart: Date;
  /**
   * Projected disbursements for the next 12 months in cents, keyed by
   * disbursement month. The operator pulls this from the property's
   * tax + insurance schedule. If undefined, the analyzer falls back to
   * the trailing 12 months of taxEscrowPayments as a proxy.
   */
  projectedDisbursementsByMonth?: Array<{
    monthIndex: number; // 0 = computation-year start month, 11 = month before next anniversary
    amountCents: number;
    category: "property_tax" | "homeowners_insurance" | "flood_insurance" | "mortgage_insurance" | "other";
    description: string;
  }>;
}

export interface RespaEscrowAnalysis {
  noteId: number;
  computationYearStart: string; // ISO date
  computationYearEnd: string; // ISO date
  monthlyEscrowPaymentCents: number;
  currentEscrowBalanceCents: number;
  // Sum of projected disbursements over the next 12 months.
  totalProjectedAnnualDisbursementsCents: number;
  // §1024.17(c)(1) — max 1/6 of annual disbursements.
  maxCushionCents: number;
  // Trial running balance month-by-month: opening balance + each
  // month's deposit − each month's scheduled disbursement.
  monthlyRunningBalances: Array<{
    monthIndex: number;
    depositCents: number;
    disbursementCents: number;
    runningBalanceCents: number;
  }>;
  lowestProjectedMonthlyBalanceCents: number;
  lowestProjectedMonthlyBalanceMonth: number;
  // Diagnosis (one of the four — see RESPA §1024.17(f)).
  status: "balanced" | "surplus" | "shortage" | "deficiency";
  surplusCents: number; // positive when lowestMonthly > maxCushion
  shortageCents: number; // positive when 0 ≤ lowestMonthly < maxCushion
  deficiencyCents: number; // positive when lowestMonthly < 0
  // Action the servicer must take per §1024.17(f).
  requiredAction: {
    code:
      | "refund_within_30_days" // surplus ≥ $50
      | "may_refund_or_credit" // surplus < $50
      | "shortage_collect_lump_or_spread" // shortage
      | "deficiency_may_lump_or_spread_lt_1mo"
      | "deficiency_must_spread_gte_1mo"
      | "no_action_required";
    description: string;
  };
  // Recomputed monthly escrow payment if the trial showed a shortage
  // or deficiency that needs spreading. Used by the servicer to update
  // the borrower's next-period escrow component.
  recomputedMonthlyEscrowPaymentCents: number | null;
  /**
   * Where the 12-month disbursement projection came from. HONESTY FLAG:
   * "trailing_12mo_proxy" means no operator projection was supplied and the
   * projection is last year's RECORDED tax_escrow_payments redistributed by
   * month — a proxy the operator should replace with the county tax +
   * insurance schedule before acting on the analysis. Optional because
   * pre-existing consumers built this shape by hand.
   */
  projectionSource?: "operator_supplied" | "trailing_12mo_proxy";
  generatedAt: string;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Run a §1024.17 annual escrow analysis on a single note.
 *
 * Pure-ish: reads notes + taxEscrowPayments, produces a structured
 * analysis. Does NOT mutate the note's monthlyTaxEscrow — the operator
 * applies the change separately after reviewing the analysis.
 */
export async function analyzeEscrowAccount(
  input: RespaEscrowAnalysisInput,
): Promise<RespaEscrowAnalysis> {
  const [note] = await db
    .select()
    .from(notes)
    .where(and(eq(notes.id, input.noteId), eq(notes.organizationId, input.organizationId)))
    .limit(1);
  if (!note) throw new Error(`Note ${input.noteId} not found.`);

  if (!note.taxEscrowEnabled) {
    throw new Error(
      `Note ${input.noteId} does not have tax escrow enabled — RESPA analysis is N/A.`,
    );
  }

  const monthlyEscrowCents = Math.round(parseFloat(note.monthlyTaxEscrow ?? "0") * 100);
  const currentBalanceCents = Math.round(parseFloat(note.taxEscrowBalance ?? "0") * 100);
  const yearStart = input.computationYearStart;
  const yearEnd = new Date(yearStart.getTime() + 365 * ONE_DAY_MS);

  // ── Resolve projected disbursements ────────────────────────────────
  let projected = input.projectedDisbursementsByMonth ?? [];
  let projectionSource: NonNullable<RespaEscrowAnalysis["projectionSource"]> =
    projected.length > 0 ? "operator_supplied" : "trailing_12mo_proxy";
  if (projected.length === 0) {
    // Fall back: trailing 12 months of taxEscrowPayments, distributed
    // by their payment month. This is a proxy — operators should
    // override with a real projection from the county tax + insurance
    // schedule when known.
    const trailingStart = new Date(yearStart.getTime() - 365 * ONE_DAY_MS);
    const trailing = await db
      .select()
      .from(taxEscrowPayments)
      .where(
        and(
          eq(taxEscrowPayments.organizationId, input.organizationId),
          eq(taxEscrowPayments.noteId, input.noteId),
          gte(taxEscrowPayments.paymentDate, trailingStart),
          lte(taxEscrowPayments.paymentDate, yearStart),
        ),
      );
    projected = trailing.map((p) => {
      const monthOffset = Math.max(
        0,
        Math.min(
          11,
          Math.floor(
            (p.paymentDate.getTime() - trailingStart.getTime()) / (30.4375 * ONE_DAY_MS),
          ),
        ),
      );
      return {
        monthIndex: monthOffset,
        amountCents: Math.round(parseFloat(p.amountPaid) * 100),
        category: "property_tax" as const,
        description: `Trailing-year proxy: ${p.installment ?? "annual"} ${p.taxYear ?? ""}`,
      };
    });
  }

  const totalAnnualDisbursementsCents = projected.reduce((s, d) => s + d.amountCents, 0);

  // §1024.17(c)(1) — max cushion = 1/6 of total annual disbursements.
  // We round DOWN (Math.floor) — servicers may not collect more than
  // the cap, so any rounding goes to the borrower's benefit.
  const maxCushionCents = Math.floor(totalAnnualDisbursementsCents / 6);

  // ── Trial running balance ──────────────────────────────────────────
  const monthlyRunningBalances: RespaEscrowAnalysis["monthlyRunningBalances"] = [];
  let running = currentBalanceCents;
  const disbursementsByMonth = new Map<number, number>();
  for (const d of projected) {
    disbursementsByMonth.set(
      d.monthIndex,
      (disbursementsByMonth.get(d.monthIndex) ?? 0) + d.amountCents,
    );
  }
  let lowestBalance = running;
  let lowestMonth = 0;
  for (let m = 0; m < 12; m++) {
    const deposit = monthlyEscrowCents;
    const disbursement = disbursementsByMonth.get(m) ?? 0;
    running = running + deposit - disbursement;
    monthlyRunningBalances.push({
      monthIndex: m,
      depositCents: deposit,
      disbursementCents: disbursement,
      runningBalanceCents: running,
    });
    if (running < lowestBalance) {
      lowestBalance = running;
      lowestMonth = m;
    }
  }

  // ── Diagnosis ──────────────────────────────────────────────────────
  let status: RespaEscrowAnalysis["status"];
  let surplus = 0;
  let shortage = 0;
  let deficiency = 0;
  if (lowestBalance < 0) {
    status = "deficiency";
    deficiency = -lowestBalance;
  } else if (lowestBalance < maxCushionCents) {
    status = "shortage";
    shortage = maxCushionCents - lowestBalance;
  } else if (lowestBalance > maxCushionCents) {
    status = "surplus";
    surplus = lowestBalance - maxCushionCents;
  } else {
    status = "balanced";
  }

  // ── Required action per §1024.17(f) ────────────────────────────────
  let requiredAction: RespaEscrowAnalysis["requiredAction"];
  let recomputedMonthly: number | null = null;

  if (status === "surplus") {
    if (surplus >= 5000) {
      requiredAction = {
        code: "refund_within_30_days",
        description: `Surplus of $${(surplus / 100).toFixed(2)} ≥ $50 — refund to borrower within 30 days of analysis (§1024.17(f)(2)(i)).`,
      };
    } else {
      requiredAction = {
        code: "may_refund_or_credit",
        description: `Surplus of $${(surplus / 100).toFixed(2)} < $50 — may refund OR credit against next year's payments (§1024.17(f)(2)(ii)).`,
      };
    }
  } else if (status === "shortage") {
    // Borrower's option: lump or spread over ≥ 12 months. Default to
    // 12-month spread for the recomputed payment.
    recomputedMonthly = monthlyEscrowCents + Math.ceil(shortage / 12);
    requiredAction = {
      code: "shortage_collect_lump_or_spread",
      description: `Shortage of $${(shortage / 100).toFixed(2)}. Servicer must offer borrower either a single lump-sum payment OR a monthly add-on spread over at least 12 months (§1024.17(f)(3)). Spread recommendation: +$${((recomputedMonthly - monthlyEscrowCents) / 100).toFixed(2)}/mo for 12 months.`,
    };
  } else if (status === "deficiency") {
    if (deficiency < monthlyEscrowCents) {
      recomputedMonthly = monthlyEscrowCents + Math.ceil(deficiency / 2);
      requiredAction = {
        code: "deficiency_may_lump_or_spread_lt_1mo",
        description: `Deficiency of $${(deficiency / 100).toFixed(2)} < 1 month's escrow. Servicer may require lump-sum OR spread over ≥ 2 months (§1024.17(f)(4)(i)). 2-month spread: +$${((recomputedMonthly - monthlyEscrowCents) / 100).toFixed(2)}/mo.`,
      };
    } else {
      recomputedMonthly = monthlyEscrowCents + Math.ceil(deficiency / 12);
      requiredAction = {
        code: "deficiency_must_spread_gte_1mo",
        description: `Deficiency of $${(deficiency / 100).toFixed(2)} ≥ 1 month's escrow. Servicer MUST spread over ≥ 2 months — default to 12-month spread (§1024.17(f)(4)(ii)). +$${((recomputedMonthly - monthlyEscrowCents) / 100).toFixed(2)}/mo for 12 months.`,
      };
    }
  } else {
    requiredAction = {
      code: "no_action_required",
      description: "Account is balanced — projected low point equals target cushion. No adjustment needed; annual statement still required (§1024.17(i)).",
    };
  }

  return {
    noteId: input.noteId,
    computationYearStart: yearStart.toISOString(),
    computationYearEnd: yearEnd.toISOString(),
    monthlyEscrowPaymentCents: monthlyEscrowCents,
    currentEscrowBalanceCents: currentBalanceCents,
    totalProjectedAnnualDisbursementsCents: totalAnnualDisbursementsCents,
    maxCushionCents,
    monthlyRunningBalances,
    lowestProjectedMonthlyBalanceCents: lowestBalance,
    lowestProjectedMonthlyBalanceMonth: lowestMonth,
    status,
    surplusCents: surplus,
    shortageCents: shortage,
    deficiencyCents: deficiency,
    requiredAction,
    recomputedMonthlyEscrowPaymentCents: recomputedMonthly,
    projectionSource,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Bulk analysis — runs analyzeEscrowAccount() for every escrow-enabled
 * note in an org. Used by the annual servicing job to produce the
 * year-end escrow statement batch for borrowers (§1024.17(i)).
 */
export async function analyzeAllEscrowAccountsForOrg(
  orgId: number,
  computationYearStart: Date,
): Promise<RespaEscrowAnalysis[]> {
  const escrowNotes = await db
    .select({ id: notes.id })
    .from(notes)
    .where(and(eq(notes.organizationId, orgId), eq(notes.taxEscrowEnabled, true)));

  const analyses: RespaEscrowAnalysis[] = [];
  for (const n of escrowNotes) {
    try {
      const a = await analyzeEscrowAccount({
        noteId: n.id,
        organizationId: orgId,
        computationYearStart,
      });
      analyses.push(a);
    } catch {
      // Skip notes that fail individually; the caller surfaces gaps
      // through a follow-up audit query.
      continue;
    }
  }
  return analyses;
}

// ══════════════════════════════════════════════════════════════════════════
// ANNUAL ESCROW ACCOUNT STATEMENT — the §1024.17(i) artifact
// ══════════════════════════════════════════════════════════════════════════
//
// Until now this file computed an analysis and produced no disclosure. The
// analysis alone is not the regulated artifact: §1024.17(i) requires the
// servicer to DELIVER an annual escrow account statement to the borrower
// within 30 days of the end of the computation year, and §1024.17(i)(1)
// enumerates exactly what it must contain:
//
//   (i)    the borrower's current monthly payment and the escrow portion
//   (ii)   the past year's monthly payment and the escrow portion
//   (iii)  the total amount paid INTO the escrow account last year
//   (iv)   the total amount paid OUT last year, separately identified by
//          taxes, insurance premiums and other charges
//   (v)    the balance in the account at the end of the period
//   (vi)   an explanation of how any surplus is being handled
//   (vii)  an explanation of how any shortage or deficiency is to be paid
//   (viii) if applicable, the reason(s) the estimated low monthly balance
//          was not reached, by noting differences between the most recent
//          account history and last year's projection
//
// §1024.17(i)(2) additionally requires an ACCOUNT HISTORY — the actual
// activity during the computation year that just ended — alongside the
// projection for the coming year.
//
// ── Why this needs inputs the analysis does not have ──────────────────
// `analyzeEscrowAccount` produces the PROJECTION for the coming year. It
// does not and cannot produce the account HISTORY: AcreOS's originated-note
// ledger (`payments`) has no escrow component column, so actual monthly
// escrow DEPOSITS are not recorded there, and last year's monthly payment
// amount is not retained historically.
//
// Therefore the history and the prior-year payment figures are REQUIRED
// INPUTS. When they are absent the statement is REFUSED with the specific
// reason. We never infer a deposit from the current monthly escrow amount,
// never assume twelve equal deposits, and never reuse the projection as if
// it were history — every one of those would be a fabricated disclosure.
//
// DELIBERATELY UNWIRED (2026-08-01): no route, job, or service calls
// `buildAnnualEscrowStatement` / `renderAnnualEscrowStatementPdf`. That is a
// decision, not an oversight — the required history inputs above do not exist
// anywhere in the schema, so any wiring today would either always refuse or
// fabricate. Wiring waits on a real decision to record per-payment escrow
// history for the originated book. Only the analysis half of this module
// (`analyzeEscrowAccount`) is production-reachable, via
// GET /api/notes/:id/escrow-analysis in server/routes-notes.ts.

/** One month of ACTUAL escrow activity during the computation year ended. */
export interface EscrowStatementActualMonth {
  /** 0 = first month of the computation year that ended, 11 = last. */
  monthIndex: number;
  /** Actual amount the borrower paid INTO escrow that month, in cents. */
  depositCents: number;
  /** Actual disbursements OUT of escrow that month, itemized. */
  disbursements: Array<{
    category:
      | "property_tax"
      | "homeowners_insurance"
      | "flood_insurance"
      | "mortgage_insurance"
      | "other";
    description: string;
    amountCents: number;
  }>;
}

export interface AnnualEscrowStatementInput {
  /** The projection for the COMING computation year. */
  analysis: RespaEscrowAnalysis;
  borrowerName: string;
  propertyAddress: string;
  servicerName: string;
  servicerAddress: string;
  servicerPhone: string;
  /** ISO date — start of the computation year that just ENDED. */
  computationYearEndedStart: string;
  /** ISO date — end of the computation year that just ENDED. */
  computationYearEndedEnd: string;
  /** Escrow balance at the START of the computation year that ended, cents. */
  startingBalanceCents: number;
  /** Escrow balance at the END of that year, cents. §1024.17(i)(1)(v). */
  endingBalanceCents: number;
  /** Actual activity — must cover all 12 months. §1024.17(i)(2). */
  actualHistory: EscrowStatementActualMonth[];
  /** §1024.17(i)(1)(i) — current total monthly payment, cents. */
  currentMonthlyPaymentCents: number;
  /** §1024.17(i)(1)(i) — escrow portion of the current payment, cents. */
  currentMonthlyEscrowPortionCents: number;
  /** §1024.17(i)(1)(ii) — last year's total monthly payment, cents. */
  priorYearMonthlyPaymentCents: number;
  /** §1024.17(i)(1)(ii) — escrow portion of last year's payment, cents. */
  priorYearMonthlyEscrowPortionCents: number;
  /**
   * Last year's projected low point, for the §1024.17(i)(1)(viii)
   * comparison. Omit ONLY when `isFirstComputationYear` is asserted.
   */
  priorYearProjectedLowestBalanceCents?: number;
  /**
   * Assert that this is the account's first computation year, so
   * §1024.17(i)(1)(viii) is genuinely not applicable. Must be set
   * explicitly — the absence of a prior projection is not by itself
   * evidence that none was required.
   */
  isFirstComputationYear?: boolean;
}

export type EscrowStatementRefusalCode =
  | "ACCOUNT_HISTORY_MISSING"
  | "ACCOUNT_HISTORY_INCOMPLETE"
  | "ACCOUNT_HISTORY_DOES_NOT_RECONCILE"
  | "BORROWER_NAME_MISSING"
  | "PROPERTY_ADDRESS_MISSING"
  | "SERVICER_IDENTITY_INCOMPLETE"
  | "COMPUTATION_YEAR_DATES_MISSING"
  | "CURRENT_PAYMENT_MISSING"
  | "PRIOR_YEAR_PAYMENT_MISSING"
  | "PRIOR_YEAR_PROJECTION_MISSING";

/** The §1024.17(i) statement, fully derived. Money is integer cents. */
export interface AnnualEscrowStatement {
  noteId: number;
  borrowerName: string;
  propertyAddress: string;
  servicerName: string;
  servicerAddress: string;
  servicerPhone: string;
  computationYearEndedStart: string;
  computationYearEndedEnd: string;
  /** §1024.17(i) — statement is due within 30 days of the year end. */
  deliveryDueBy: string;

  // (i) and (ii)
  currentMonthlyPaymentCents: number;
  currentMonthlyEscrowPortionCents: number;
  priorYearMonthlyPaymentCents: number;
  priorYearMonthlyEscrowPortionCents: number;

  // (iii), (iv), (v)
  totalPaidIntoEscrowCents: number;
  totalPaidOutOfEscrowCents: number;
  /** (iv) — "separately identified" by category. */
  disbursementsByCategory: Array<{ category: string; amountCents: number }>;
  startingBalanceCents: number;
  endingBalanceCents: number;

  /** §1024.17(i)(2) — actual activity, month by month, with running balance. */
  accountHistory: Array<{
    monthIndex: number;
    depositCents: number;
    disbursementCents: number;
    runningBalanceCents: number;
    disbursementDetail: string;
  }>;
  /** The lowest balance the account ACTUALLY reached last year. */
  actualLowestBalanceCents: number;
  actualLowestBalanceMonth: number;

  /** The projection for the coming year, straight from the analysis. */
  projection: RespaEscrowAnalysis["monthlyRunningBalances"];
  projectedLowestBalanceCents: number;
  maxCushionCents: number;

  // (vi) and (vii) — reuse the analysis's §1024.17(f) determination.
  status: RespaEscrowAnalysis["status"];
  surplusCents: number;
  shortageCents: number;
  deficiencyCents: number;
  surplusOrShortageExplanation: string;
  newMonthlyEscrowPaymentCents: number | null;

  /** (viii) — populated when applicable, else the not-applicable reason. */
  lowBalanceVarianceExplanation: string;

  generatedAt: string;
}

export type AnnualEscrowStatementResult =
  | { kind: "statement"; statement: AnnualEscrowStatement }
  | { kind: "refused"; codes: EscrowStatementRefusalCode[]; reason: string };

const CATEGORY_LABELS: Record<string, string> = {
  property_tax: "Taxes",
  homeowners_insurance: "Homeowner's insurance premiums",
  flood_insurance: "Flood insurance premiums",
  mortgage_insurance: "Mortgage insurance premiums",
  other: "Other charges",
};

function dollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

/**
 * Produce the §1024.17(i) annual escrow account statement, or REFUSE.
 *
 * PURE — no DB, no clock beyond `generatedAt`. Every figure is either
 * supplied as a recorded fact or derived arithmetically from supplied
 * facts. Nothing is estimated. The reconciliation gate below is what makes
 * that claim checkable: if the supplied history does not add up to the
 * supplied ending balance, the history is wrong or incomplete and we refuse
 * rather than publish a statement that misstates the borrower's account.
 */
export function buildAnnualEscrowStatement(
  input: AnnualEscrowStatementInput,
): AnnualEscrowStatementResult {
  const codes: EscrowStatementRefusalCode[] = [];
  const details: string[] = [];

  if (!input.borrowerName?.trim()) {
    codes.push("BORROWER_NAME_MISSING");
    details.push("the borrower's name is not recorded");
  }
  if (!input.propertyAddress?.trim()) {
    codes.push("PROPERTY_ADDRESS_MISSING");
    details.push("the property address is not recorded");
  }
  if (!input.servicerName?.trim() || !input.servicerAddress?.trim()) {
    codes.push("SERVICER_IDENTITY_INCOMPLETE");
    details.push("the servicer's name and mailing address are required on the statement");
  }
  if (!input.computationYearEndedStart || !input.computationYearEndedEnd) {
    codes.push("COMPUTATION_YEAR_DATES_MISSING");
    details.push("the computation year that ended is not identified");
  }
  if (input.currentMonthlyPaymentCents <= 0) {
    codes.push("CURRENT_PAYMENT_MISSING");
    details.push(
      "the borrower's current monthly payment is required by §1024.17(i)(1)(i) and is not recorded",
    );
  }
  if (input.priorYearMonthlyPaymentCents <= 0) {
    codes.push("PRIOR_YEAR_PAYMENT_MISSING");
    details.push(
      "last year's monthly payment amount is required by §1024.17(i)(1)(ii) and is not retained",
    );
  }

  // ── Account history: present, complete, and self-consistent ───────────
  const history = input.actualHistory ?? [];
  if (history.length === 0) {
    codes.push("ACCOUNT_HISTORY_MISSING");
    details.push(
      "no actual escrow account history was supplied — §1024.17(i)(2) requires the real " +
        "activity for the computation year, and AcreOS's payment ledger does not record an " +
        "escrow component, so the history cannot be derived",
    );
  } else {
    const months = new Set(history.map((m) => m.monthIndex));
    const missing = [...Array(12).keys()].filter((m) => !months.has(m));
    if (missing.length > 0 || months.size !== 12) {
      codes.push("ACCOUNT_HISTORY_INCOMPLETE");
      details.push(
        `the account history is missing ${missing.length || 12 - months.size} of the 12 months ` +
          `(missing month indices: ${missing.join(", ") || "duplicated entries"})`,
      );
    }
  }

  const totalIn = history.reduce((s, m) => s + m.depositCents, 0);
  const totalOut = history.reduce(
    (s, m) => s + m.disbursements.reduce((t, d) => t + d.amountCents, 0),
    0,
  );

  // Reconciliation: opening + deposits − disbursements MUST equal the
  // stated closing balance. A mismatch means the history is incomplete or
  // the balances are wrong; either way the statement would misstate the
  // account, so we refuse instead of publishing it.
  if (!codes.includes("ACCOUNT_HISTORY_MISSING")) {
    const computedEnding = input.startingBalanceCents + totalIn - totalOut;
    if (computedEnding !== input.endingBalanceCents) {
      codes.push("ACCOUNT_HISTORY_DOES_NOT_RECONCILE");
      details.push(
        `the account history does not reconcile: opening ${dollars(input.startingBalanceCents)} ` +
          `plus deposits ${dollars(totalIn)} less disbursements ${dollars(totalOut)} is ` +
          `${dollars(computedEnding)}, but the stated closing balance is ` +
          `${dollars(input.endingBalanceCents)} (a ${dollars(
            input.endingBalanceCents - computedEnding,
          )} discrepancy)`,
      );
    }
  }

  // ── (viii) prerequisite ───────────────────────────────────────────────
  const hasPriorProjection = input.priorYearProjectedLowestBalanceCents !== undefined;
  if (!hasPriorProjection && !input.isFirstComputationYear) {
    codes.push("PRIOR_YEAR_PROJECTION_MISSING");
    details.push(
      "§1024.17(i)(1)(viii) requires the statement to explain any difference between the " +
        "account history and last year's projection; last year's projected low balance is not " +
        "on file and this was not asserted to be the account's first computation year",
    );
  }

  if (codes.length > 0) {
    const joined =
      details.length === 1
        ? details[0]
        : `${details.slice(0, -1).join("; ")}; and ${details[details.length - 1]}`;
    return {
      kind: "refused",
      codes,
      reason:
        `Annual escrow account statement REFUSED for note ${input.analysis.noteId}: ${joined}. ` +
        `No statement was produced. Supply the missing records and re-run — a statement ` +
        `containing an assumed figure would misstate the borrower's escrow account.`,
    };
  }

  // ── Derive the account history running balance + actual low point ─────
  const ordered = [...history].sort((a, b) => a.monthIndex - b.monthIndex);
  let running = input.startingBalanceCents;
  let actualLow = input.startingBalanceCents;
  let actualLowMonth = 0;
  const accountHistory: AnnualEscrowStatement["accountHistory"] = [];
  for (const m of ordered) {
    const out = m.disbursements.reduce((t, d) => t + d.amountCents, 0);
    running = running + m.depositCents - out;
    accountHistory.push({
      monthIndex: m.monthIndex,
      depositCents: m.depositCents,
      disbursementCents: out,
      runningBalanceCents: running,
      disbursementDetail: m.disbursements
        .map((d) => `${d.description} (${dollars(d.amountCents)})`)
        .join("; "),
    });
    if (running < actualLow) {
      actualLow = running;
      actualLowMonth = m.monthIndex;
    }
  }

  // (iv) — disbursements separately identified by category.
  const byCategory = new Map<string, number>();
  for (const m of ordered) {
    for (const d of m.disbursements) {
      byCategory.set(d.category, (byCategory.get(d.category) ?? 0) + d.amountCents);
    }
  }
  const disbursementsByCategory = [...byCategory.entries()]
    .map(([category, amountCents]) => ({
      category: CATEGORY_LABELS[category] ?? category,
      amountCents,
    }))
    .sort((a, b) => a.category.localeCompare(b.category));

  // (viii) — compare the actual low point to last year's projection.
  let variance: string;
  if (!hasPriorProjection) {
    variance =
      "Not applicable — this is the first computation year for this escrow account, so there " +
      "is no prior projection to compare against (§1024.17(i)(1)(viii)).";
  } else {
    const projected = input.priorYearProjectedLowestBalanceCents ?? 0;
    const delta = actualLow - projected;
    if (delta === 0) {
      variance =
        `The account reached its projected low balance of ${dollars(projected)} exactly; ` +
        `no variance to explain (§1024.17(i)(1)(viii)).`;
    } else {
      const direction = delta < 0 ? "below" : "above";
      variance =
        `The lowest balance the account actually reached was ${dollars(actualLow)} in month ` +
        `${actualLowMonth + 1}, which is ${dollars(Math.abs(delta))} ${direction} last year's ` +
        `projected low balance of ${dollars(projected)}. The difference is the net effect of ` +
        `actual escrow deposits of ${dollars(totalIn)} and actual disbursements of ` +
        `${dollars(totalOut)} against the amounts projected a year ago ` +
        `(§1024.17(i)(1)(viii)).`;
    }
  }

  const dueBy = new Date(
    new Date(input.computationYearEndedEnd).getTime() + 30 * ONE_DAY_MS,
  ).toISOString();

  return {
    kind: "statement",
    statement: {
      noteId: input.analysis.noteId,
      borrowerName: input.borrowerName.trim(),
      propertyAddress: input.propertyAddress.trim(),
      servicerName: input.servicerName.trim(),
      servicerAddress: input.servicerAddress.trim(),
      servicerPhone: input.servicerPhone,
      computationYearEndedStart: input.computationYearEndedStart,
      computationYearEndedEnd: input.computationYearEndedEnd,
      deliveryDueBy: dueBy,

      currentMonthlyPaymentCents: input.currentMonthlyPaymentCents,
      currentMonthlyEscrowPortionCents: input.currentMonthlyEscrowPortionCents,
      priorYearMonthlyPaymentCents: input.priorYearMonthlyPaymentCents,
      priorYearMonthlyEscrowPortionCents: input.priorYearMonthlyEscrowPortionCents,

      totalPaidIntoEscrowCents: totalIn,
      totalPaidOutOfEscrowCents: totalOut,
      disbursementsByCategory,
      startingBalanceCents: input.startingBalanceCents,
      endingBalanceCents: input.endingBalanceCents,

      accountHistory,
      actualLowestBalanceCents: actualLow,
      actualLowestBalanceMonth: actualLowMonth,

      projection: input.analysis.monthlyRunningBalances,
      projectedLowestBalanceCents: input.analysis.lowestProjectedMonthlyBalanceCents,
      maxCushionCents: input.analysis.maxCushionCents,

      status: input.analysis.status,
      surplusCents: input.analysis.surplusCents,
      shortageCents: input.analysis.shortageCents,
      deficiencyCents: input.analysis.deficiencyCents,
      // (vi)/(vii) — the §1024.17(f) determination the analyzer already made.
      surplusOrShortageExplanation: input.analysis.requiredAction.description,
      newMonthlyEscrowPaymentCents: input.analysis.recomputedMonthlyEscrowPaymentCents,

      lowBalanceVarianceExplanation: variance,

      generatedAt: new Date().toISOString(),
    },
  };
}

/**
 * Render the §1024.17(i) annual escrow account statement as a PDF for
 * delivery to the borrower. Consumes only the structured statement, so it
 * can never introduce a figure the builder refused to assert.
 */
export function renderAnnualEscrowStatementPdf(s: AnnualEscrowStatement): Buffer {
  const doc = new jsPDF({ unit: "in", format: "letter" });
  const margin = 0.6;
  const right = 8.5 - margin;
  let y = margin;

  const line = (text: string, size = 9, bold = false): void => {
    doc.setFontSize(size);
    doc.setFont("helvetica", bold ? "bold" : "normal");
    const wrapped = doc.splitTextToSize(text, right - margin) as string[];
    doc.text(wrapped, margin, y);
    y += 0.16 * wrapped.length;
  };
  const row = (label: string, value: string, bold = false): void => {
    doc.setFontSize(9);
    doc.setFont("helvetica", bold ? "bold" : "normal");
    const wrapped = doc.splitTextToSize(label, 5.0) as string[];
    doc.text(wrapped, margin, y);
    doc.text(value, right, y, { align: "right" });
    y += 0.16 * Math.max(1, wrapped.length);
  };
  const gap = (h = 0.14): void => {
    y += h;
  };

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text("Annual Escrow Account Disclosure Statement", margin, y + 0.2);
  y += 0.45;
  line("Prepared under RESPA, 12 CFR §1024.17(i)", 8);
  gap();

  line(s.servicerName, 9, true);
  line(s.servicerAddress);
  if (s.servicerPhone) line(`Phone: ${s.servicerPhone}`);
  gap();

  row("Borrower", s.borrowerName, true);
  row("Property", s.propertyAddress);
  row("Account", `Note ${s.noteId}`);
  row(
    "Computation year ended",
    `${s.computationYearEndedStart.slice(0, 10)} to ${s.computationYearEndedEnd.slice(0, 10)}`,
  );
  row("Statement due to borrower by", s.deliveryDueBy.slice(0, 10));
  gap(0.22);

  line("Your monthly payment", 10, true);
  row("Current monthly payment", dollars(s.currentMonthlyPaymentCents));
  row("  of which escrow", dollars(s.currentMonthlyEscrowPortionCents));
  row("Last year's monthly payment", dollars(s.priorYearMonthlyPaymentCents));
  row("  of which escrow", dollars(s.priorYearMonthlyEscrowPortionCents));
  gap(0.22);

  line("Escrow account activity — the year that ended", 10, true);
  row("Balance at start of year", dollars(s.startingBalanceCents));
  row("Total paid into escrow", dollars(s.totalPaidIntoEscrowCents));
  row("Total paid out of escrow", dollars(s.totalPaidOutOfEscrowCents));
  for (const c of s.disbursementsByCategory) {
    row(`  ${c.category}`, dollars(c.amountCents));
  }
  row("Balance at end of year", dollars(s.endingBalanceCents), true);
  row(
    "Lowest balance actually reached",
    `${dollars(s.actualLowestBalanceCents)} (month ${s.actualLowestBalanceMonth + 1})`,
  );
  gap(0.22);

  line("Account history — actual activity, month by month", 10, true);
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.text("Month", margin, y);
  doc.text("Paid in", margin + 1.0, y);
  doc.text("Paid out", margin + 2.0, y);
  doc.text("Balance", margin + 3.1, y);
  doc.text("Disbursements", margin + 4.2, y);
  y += 0.15;
  doc.setFont("helvetica", "normal");
  for (const m of s.accountHistory) {
    if (y > 10.2) {
      doc.addPage();
      y = margin;
    }
    doc.text(String(m.monthIndex + 1), margin, y);
    doc.text(dollars(m.depositCents), margin + 1.0, y);
    doc.text(dollars(m.disbursementCents), margin + 2.0, y);
    doc.text(dollars(m.runningBalanceCents), margin + 3.1, y);
    const detail = (doc.splitTextToSize(m.disbursementDetail || "—", 2.6) as string[])[0] ?? "—";
    doc.text(detail, margin + 4.2, y);
    y += 0.15;
  }
  gap(0.22);

  if (y > 8.6) {
    doc.addPage();
    y = margin;
  }

  line("Projection for the coming year", 10, true);
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.text("Month", margin, y);
  doc.text("Payments to escrow", margin + 1.0, y);
  doc.text("Payments from escrow", margin + 2.7, y);
  doc.text("Balance", margin + 4.5, y);
  y += 0.15;
  doc.setFont("helvetica", "normal");
  for (const m of s.projection) {
    if (y > 10.2) {
      doc.addPage();
      y = margin;
    }
    doc.text(String(m.monthIndex + 1), margin, y);
    doc.text(dollars(m.depositCents), margin + 1.0, y);
    doc.text(dollars(m.disbursementCents), margin + 2.7, y);
    doc.text(dollars(m.runningBalanceCents), margin + 4.5, y);
    y += 0.15;
  }
  gap(0.2);
  row("Projected lowest balance", dollars(s.projectedLowestBalanceCents));
  row("Required cushion (1/6 of annual disbursements)", dollars(s.maxCushionCents));
  gap(0.22);

  if (y > 9.0) {
    doc.addPage();
    y = margin;
  }

  line("Surplus, shortage or deficiency", 10, true);
  row("Determination", s.status.toUpperCase(), true);
  if (s.surplusCents > 0) row("Surplus", dollars(s.surplusCents));
  if (s.shortageCents > 0) row("Shortage", dollars(s.shortageCents));
  if (s.deficiencyCents > 0) row("Deficiency", dollars(s.deficiencyCents));
  gap(0.06);
  line(s.surplusOrShortageExplanation);
  if (s.newMonthlyEscrowPaymentCents !== null) {
    gap(0.06);
    row("New monthly escrow payment", dollars(s.newMonthlyEscrowPaymentCents), true);
  }
  gap(0.22);

  line("Difference from last year's projection", 10, true);
  line(s.lowBalanceVarianceExplanation);

  return Buffer.from(doc.output("arraybuffer") as ArrayBuffer);
}
