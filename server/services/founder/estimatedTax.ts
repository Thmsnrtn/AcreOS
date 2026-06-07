/**
 * estimatedTax — Founder quarterly estimated-tax RADAR engine (FOUNDER-SIDE ONLY).
 *
 * The thing that protects Tom from a surprise underpayment penalty once AcreOS
 * pays him a draw. Computes the four IRS Form 1040-ES quarterly federal estimates
 * + the Massachusetts Form 1-ES estimates from the SAME structured income inputs
 * the draft-return engine uses, then applies the safe-harbor rule so the radar
 * tells him the MINIMUM to pay to avoid a penalty — and stays QUIET ($0) until
 * there is non-withheld income that withholding doesn't already cover.
 *
 * HONESTY CONTRACT (non-negotiable — this is self-prep software, NOT advice):
 *   - Every figure carries a plain-language `basis` string showing its work.
 *   - The safe-harbor target shows BOTH bases (current-year 90% vs prior-year
 *     100%/110%) and which one was chosen, so the founder sees why.
 *   - When W-2 withholding already covers the safe-harbor target, the radar
 *     reports $0 with a reassuring "your withholding covers you" message — it
 *     reassures, it does not alarm, pre-AcreOS-revenue.
 *   - Underpayment-penalty computation itself is NOT modeled (that needs the
 *     date each payment actually landed); we model only the safe-harbor TARGET.
 *
 * Pure module: NO db, NO encryption, NO logging. Callers (lifeCockpit service)
 * decrypt amounts first, run computeDraftReturn, and pass the resulting figures
 * in; nothing here ever touches a secret store or a logger.
 *
 * Reuses taxEngine/taxRules — it does NOT duplicate any tax table or bracket.
 */

import type { DraftReturn } from "./taxEngine";
import { humanFilingStatus } from "./taxEngine";
import type { FilingStatus } from "./taxRules";

// ─── Safe-harbor constants ─────────────────────────────────────────────────────
//
// IRS safe harbor (IRC §6654): you avoid the federal underpayment penalty if your
// total timely payments (withholding + estimates) are at least the SMALLER of:
//   (a) 90% of the CURRENT year's tax, OR
//   (b) 100% of the PRIOR year's tax (110% if prior-year AGI > $150,000;
//       $75,000 if MFS).
// MA mirrors the federal structure but requires 80% of current-year tax. We model
// MA with the same prior-year 100%/110% option for parity + safety; the MA
// current-year fraction (0.80) is encoded separately.

export const FED_CURRENT_YEAR_FRACTION = 0.9;
export const FED_PRIOR_YEAR_FRACTION = 1.0;
export const FED_PRIOR_YEAR_FRACTION_HIGH_AGI = 1.1;
/** AGI above which the 110% prior-year safe harbor applies (MFS: half). */
export const FED_HIGH_AGI_THRESHOLD = 150000;
export const FED_HIGH_AGI_THRESHOLD_MFS = 75000;

/** MA requires 80% of current-year tax (vs federal 90%). */
export const MA_CURRENT_YEAR_FRACTION = 0.8;
export const MA_PRIOR_YEAR_FRACTION = 1.0;
export const MA_PRIOR_YEAR_FRACTION_HIGH_AGI = 1.1;

/**
 * The de-minimis floor below which no estimated tax is required:
 *   - Federal: you owe NO penalty if the balance due after withholding is < $1,000.
 *   - MA: the threshold is $400.
 * Below the floor the radar stays quiet for that jurisdiction.
 */
export const FED_DE_MINIMIS = 1000;
export const MA_DE_MINIMIS = 400;

// ─── Quarter calendar ──────────────────────────────────────────────────────────
//
// The four IRS 1040-ES periods + MA Form 1-ES periods share the same statutory
// due dates (Apr 15 / Jun 15 / Sep 15 / Jan 15 of the following year). Dates roll
// to the next business day in practice, but we surface the statutory date and let
// the founder confirm — we never present a shifted date as authoritative.

export interface QuarterDef {
  /** 1-based quarter index (Q1..Q4). */
  quarter: number;
  label: string;
  /** ISO date (YYYY-MM-DD) of the statutory due date for this quarter. */
  dueDate: string;
}

/** Build the four statutory due dates for a given tax year. Q4 is in Jan of +1. */
export function quarterCalendar(taxYear: number): QuarterDef[] {
  return [
    { quarter: 1, label: "Q1", dueDate: `${taxYear}-04-15` },
    { quarter: 2, label: "Q2", dueDate: `${taxYear}-06-15` },
    { quarter: 3, label: "Q3", dueDate: `${taxYear}-09-15` },
    { quarter: 4, label: "Q4", dueDate: `${taxYear + 1}-01-15` },
  ];
}

// ─── Inputs ──────────────────────────────────────────────────────────────────

export type QuarterStatus = "upcoming" | "due_soon" | "overdue" | "paid";

export interface PriorYearLiability {
  /** Prior-year total tax (federal). Whole dollars, or null if unknown. */
  federalTotalTax: number | null;
  /** Prior-year MA total tax. Whole dollars, or null if unknown. */
  stateTotalTax: number | null;
  /** Prior-year AGI — drives the 110% high-income safe-harbor multiplier. */
  agi: number | null;
}

export interface QuarterPaidInput {
  quarter: number;
  jurisdiction: "federal" | "massachusetts";
  /** Whole-dollar amount the founder marked paid for this quarter. */
  amountPaid: number;
  /** ISO date the founder recorded the payment, if any. */
  paidAt?: string | null;
}

export interface EstimatedTaxInput {
  taxYear: number;
  filingStatus: FilingStatus;
  /** The computed current-year draft (federal + MA) — reused, never recomputed here. */
  draft: DraftReturn;
  /** Prior-year liability for the prior-year safe-harbor leg (optional). */
  priorYear?: PriorYearLiability | null;
  /** Quarters the founder has already marked paid (optional). */
  paid?: QuarterPaidInput[];
  /** "Today" for status computation — injectable for deterministic tests. */
  now?: Date;
}

// ─── Output shape ──────────────────────────────────────────────────────────────

export interface SafeHarborTarget {
  /** The annual required-payment target chosen (the SMALLER of the two legs). */
  requiredAnnualPayment: number;
  /** Current-year leg: fraction × current-year total tax. */
  currentYearLeg: number;
  /** Prior-year leg: 100%/110% × prior-year total tax (null if prior unknown). */
  priorYearLeg: number | null;
  /** Which leg won ("current_year" | "prior_year"). */
  chosenLeg: "current_year" | "prior_year";
  /** Expected withholding for the year (already covers part of the target). */
  expectedWithholding: number;
  /** requiredAnnualPayment − expectedWithholding, floored at 0. */
  estimatedShortfall: number;
  basis: string;
}

export interface QuarterObligation {
  quarter: number;
  label: string;
  dueDate: string;
  /** Whole-dollar amount due this quarter (shortfall ÷ 4, last quarter absorbs rounding). */
  amountDue: number;
  /** Amount the founder marked paid for this quarter (0 if none). */
  amountPaid: number;
  status: QuarterStatus;
  paidAt: string | null;
}

export interface JurisdictionRadar {
  jurisdiction: "federal" | "massachusetts";
  /** True when there IS an estimated-tax obligation (non-withheld income, over floor). */
  active: boolean;
  /** The quiet/active headline the UI shows. */
  headline: string;
  totalTax: number;
  expectedWithholding: number;
  deMinimisFloor: number;
  safeHarbor: SafeHarborTarget;
  quarters: QuarterObligation[];
  /** Sum of amounts still due across not-yet-paid quarters. */
  remainingDue: number;
}

export interface EstimatedTaxRadar {
  taxYear: number;
  filingStatus: FilingStatus;
  generatedAt: string;
  /** True when EITHER jurisdiction has an active obligation. */
  active: boolean;
  disclaimer: string;
  federal: JurisdictionRadar;
  /** Null when the draft has no MA estimate (state !== MA). */
  massachusetts: JurisdictionRadar | null;
}

export const ESTIMATED_TAX_DISCLAIMER =
  "ESTIMATE — not tax advice. This quarterly-estimate radar applies the IRS / MA " +
  "safe-harbor rule to your captured income to flag the MINIMUM you'd pay to avoid " +
  "an underpayment penalty. It does NOT compute the penalty itself (that depends on " +
  "when each payment lands), and it omits everything the draft return omits " +
  "(itemized deductions, credits, cap-gains rates, AMT, QBI). Confirm against IRS " +
  "Form 1040-ES, MA Form 1-ES, and your actual figures before you pay.";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function round(n: number): number {
  return Math.round(n);
}
function clampNonNegative(n: number): number {
  return n < 0 ? 0 : n;
}

/**
 * Split an annual shortfall into four equal quarterly amounts, with the last
 * quarter absorbing any rounding remainder so the four sum EXACTLY to the total.
 */
function splitIntoQuarters(annual: number): number[] {
  const total = clampNonNegative(round(annual));
  if (total === 0) return [0, 0, 0, 0];
  const per = Math.floor(total / 4);
  return [per, per, per, total - per * 3];
}

/** The high-AGI prior-year multiplier threshold for this filing status. */
function highAgiThreshold(filingStatus: FilingStatus): number {
  return filingStatus === "married_separate"
    ? FED_HIGH_AGI_THRESHOLD_MFS
    : FED_HIGH_AGI_THRESHOLD;
}

interface SafeHarborConfig {
  currentYearFraction: number;
  priorYearFraction: number;
  priorYearFractionHighAgi: number;
  deMinimis: number;
  jurisdictionLabel: string;
}

function computeSafeHarbor(
  currentYearTotalTax: number,
  expectedWithholding: number,
  priorYearTotalTax: number | null,
  priorYearAgi: number | null,
  filingStatus: FilingStatus,
  cfg: SafeHarborConfig,
): SafeHarborTarget {
  const currentYearLeg = round(currentYearTotalTax * cfg.currentYearFraction);

  let priorYearLeg: number | null = null;
  let priorMultiplier = cfg.priorYearFraction;
  if (priorYearTotalTax !== null && priorYearTotalTax > 0) {
    const threshold = highAgiThreshold(filingStatus);
    if (priorYearAgi !== null && priorYearAgi > threshold) {
      priorMultiplier = cfg.priorYearFractionHighAgi;
    }
    priorYearLeg = round(priorYearTotalTax * priorMultiplier);
  }

  // Safe harbor = the SMALLER of the two legs (you only need the lesser to be safe).
  let requiredAnnualPayment = currentYearLeg;
  let chosenLeg: "current_year" | "prior_year" = "current_year";
  if (priorYearLeg !== null && priorYearLeg < currentYearLeg) {
    requiredAnnualPayment = priorYearLeg;
    chosenLeg = "prior_year";
  }

  const estimatedShortfall = clampNonNegative(requiredAnnualPayment - expectedWithholding);

  const currentPct = round(cfg.currentYearFraction * 100);
  const priorPct = round(priorMultiplier * 100);
  const legBasis =
    priorYearLeg === null
      ? `prior-year liability not on file, so the current-year ${currentPct}% leg is used.`
      : chosenLeg === "prior_year"
        ? `prior-year ${priorPct}% leg ($${priorYearLeg.toLocaleString()}) is lower than the current-year ${currentPct}% leg ($${currentYearLeg.toLocaleString()}), so it sets the target.`
        : `current-year ${currentPct}% leg ($${currentYearLeg.toLocaleString()}) is lower than the prior-year ${priorPct}% leg ($${priorYearLeg.toLocaleString()}), so it sets the target.`;

  const basis =
    `${cfg.jurisdictionLabel} safe harbor for ${humanFilingStatus(filingStatus)}: ` +
    `${legBasis} ` +
    `Required annual payment $${requiredAnnualPayment.toLocaleString()} less expected withholding ` +
    `$${expectedWithholding.toLocaleString()} = estimated shortfall $${estimatedShortfall.toLocaleString()} ` +
    `to spread across four quarters. ESTIMATE — verify before filing.`;

  return {
    requiredAnnualPayment,
    currentYearLeg,
    priorYearLeg,
    chosenLeg,
    expectedWithholding,
    estimatedShortfall,
    basis,
  };
}

/** Compute a quarter's status from the calendar, today, and whether it was paid. */
function quarterStatus(
  dueDate: string,
  amountDue: number,
  amountPaid: number,
  now: Date,
): QuarterStatus {
  if (amountPaid > 0 && amountPaid >= amountDue) return "paid";
  const due = new Date(`${dueDate}T23:59:59Z`);
  const msPerDay = 24 * 60 * 60 * 1000;
  const daysUntil = Math.ceil((due.getTime() - now.getTime()) / msPerDay);
  if (daysUntil < 0) return "overdue";
  if (daysUntil <= 30) return "due_soon";
  return "upcoming";
}

function buildJurisdictionRadar(
  jurisdiction: "federal" | "massachusetts",
  taxYear: number,
  totalTax: number,
  expectedWithholding: number,
  hasUnwithheldIncome: boolean,
  priorYearTotalTax: number | null,
  priorYearAgi: number | null,
  filingStatus: FilingStatus,
  cfg: SafeHarborConfig,
  paid: QuarterPaidInput[],
  now: Date,
): JurisdictionRadar {
  const safeHarbor = computeSafeHarbor(
    totalTax,
    expectedWithholding,
    priorYearTotalTax,
    priorYearAgi,
    filingStatus,
    cfg,
  );

  const balanceAfterWithholding = clampNonNegative(totalTax - expectedWithholding);
  // The radar is ACTIVE only when there is non-withheld income AND the balance
  // after withholding clears the de-minimis floor AND the safe-harbor target
  // leaves a shortfall. Otherwise it stays quiet (reassures, does not alarm).
  const active =
    hasUnwithheldIncome &&
    balanceAfterWithholding >= cfg.deMinimis &&
    safeHarbor.estimatedShortfall > 0;

  const cal = quarterCalendar(taxYear);
  const perQuarter = active ? splitIntoQuarters(safeHarbor.estimatedShortfall) : [0, 0, 0, 0];

  const quarters: QuarterObligation[] = cal.map((q, i) => {
    const match = paid.find((p) => p.quarter === q.quarter && p.jurisdiction === jurisdiction);
    const amountPaid = match ? clampNonNegative(round(match.amountPaid)) : 0;
    const amountDue = perQuarter[i];
    return {
      quarter: q.quarter,
      label: q.label,
      dueDate: q.dueDate,
      amountDue,
      amountPaid,
      status: quarterStatus(q.dueDate, amountDue, amountPaid, now),
      paidAt: match?.paidAt ?? null,
    };
  });

  const remainingDue = quarters
    .filter((q) => q.status !== "paid")
    .reduce((sum, q) => sum + clampNonNegative(q.amountDue - q.amountPaid), 0);

  const jLabel = jurisdiction === "federal" ? "Federal (Form 1040-ES)" : "Massachusetts (Form 1-ES)";
  const jWord = jurisdiction === "federal" ? "federal" : "MA";
  const headline = active
    ? `${jLabel}: pay about $${safeHarbor.estimatedShortfall.toLocaleString()} in estimated tax across four quarters to stay penalty-safe. Estimate — verify before filing.`
    : !hasUnwithheldIncome
      ? `$0 — no estimated tax due. All your ${jWord} income has withholding at source; you're covered.`
      : balanceAfterWithholding < cfg.deMinimis
        ? `$0 — no estimated tax required. Your projected ${jWord} balance after withholding is under the $${cfg.deMinimis.toLocaleString()} threshold.`
        : `$0 — your withholding already meets the safe-harbor target, so no estimated payments are required.`;

  return {
    jurisdiction,
    active,
    headline,
    totalTax,
    expectedWithholding,
    deMinimisFloor: cfg.deMinimis,
    safeHarbor,
    quarters,
    remainingDue,
  };
}

// ─── Top-level ──────────────────────────────────────────────────────────────────

export function computeEstimatedTaxRadar(input: EstimatedTaxInput): EstimatedTaxRadar {
  const { draft, taxYear, filingStatus } = input;
  const now = input.now ?? new Date();
  const paid = input.paid ?? [];
  const prior = input.priorYear ?? null;

  const fedSummary = draft.federal.summary;
  // "Non-withheld income exists" ≈ there is self-employment / 1099-style income
  // that no employer withholds on. The draft's SE tax is the clean signal.
  const fedHasUnwithheld = fedSummary.selfEmploymentTax > 0;

  const federal = buildJurisdictionRadar(
    "federal",
    taxYear,
    fedSummary.totalTax,
    fedSummary.totalWithheld,
    fedHasUnwithheld,
    prior?.federalTotalTax ?? null,
    prior?.agi ?? null,
    filingStatus,
    {
      currentYearFraction: FED_CURRENT_YEAR_FRACTION,
      priorYearFraction: FED_PRIOR_YEAR_FRACTION,
      priorYearFractionHighAgi: FED_PRIOR_YEAR_FRACTION_HIGH_AGI,
      deMinimis: FED_DE_MINIMIS,
      jurisdictionLabel: "Federal",
    },
    paid,
    now,
  );

  let massachusetts: JurisdictionRadar | null = null;
  if (draft.massachusetts) {
    const maSummary = draft.massachusetts.summary;
    // MA has no SE-tax line; the underlying non-withheld income is the SAME
    // income that drives the federal SE signal, so we gate MA on the federal
    // unwithheld flag. This keeps spouse-W-2-only households quiet on both sides.
    const maHasUnwithheld = fedHasUnwithheld;
    massachusetts = buildJurisdictionRadar(
      "massachusetts",
      taxYear,
      maSummary.totalTax,
      maSummary.totalWithheld,
      maHasUnwithheld,
      prior?.stateTotalTax ?? null,
      prior?.agi ?? null,
      filingStatus,
      {
        currentYearFraction: MA_CURRENT_YEAR_FRACTION,
        priorYearFraction: MA_PRIOR_YEAR_FRACTION,
        priorYearFractionHighAgi: MA_PRIOR_YEAR_FRACTION_HIGH_AGI,
        deMinimis: MA_DE_MINIMIS,
        jurisdictionLabel: "Massachusetts",
      },
      paid,
      now,
    );
  }

  return {
    taxYear,
    filingStatus,
    generatedAt: now.toISOString(),
    active: federal.active || (massachusetts?.active ?? false),
    disclaimer: ESTIMATED_TAX_DISCLAIMER,
    federal,
    massachusetts,
  };
}
