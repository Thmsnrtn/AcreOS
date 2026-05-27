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
 * This service produces a RespaEscrowAnalysis shape; a future PDF
 * generator consumes it and renders the §1024.17(i) statement layout.
 */

import { db } from "../db";
import { notes, taxEscrowPayments } from "@shared/schema";
import { and, eq, gte, lte } from "drizzle-orm";

export interface RespaEscrowAnalysisInput {
  noteId: number;
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
  const [note] = await db.select().from(notes).where(eq(notes.id, input.noteId)).limit(1);
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
