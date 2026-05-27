/**
 * ATR (Ability-to-Repay) safe-harbor attestation capture.
 *
 * Reg-Z §1026.43(c) requires every creditor making a consumer-purpose
 * closed-end credit transaction secured by a dwelling to make a reasonable,
 * good-faith determination at OR BEFORE consummation that the consumer has
 * the ability to repay the loan according to its terms.
 *
 * The eight statutory factors (§1026.43(c)(2)):
 *   (i)    Current or reasonably expected income or assets (other than
 *          the value of the dwelling securing the loan)
 *   (ii)   Current employment status (if relying on employment income)
 *   (iii)  Monthly payment on the covered transaction
 *   (iv)   Monthly payment on any simultaneous loan
 *   (v)    Monthly payment for mortgage-related obligations (taxes,
 *          insurance, HOA, mortgage insurance)
 *   (vi)   Current debt obligations, alimony, child support
 *   (vii)  Monthly DTI ratio OR residual income
 *   (viii) Credit history
 *
 * Verification: §1026.43(c)(3) requires third-party records (W-2, tax
 * return, payroll receipts, financial-institution records, etc.) — the
 * operator's own statement is NOT sufficient for income / employment.
 *
 * Record retention: §1026.25(c)(3) — 3 years from consummation.
 *
 * QM (Qualified Mortgage, §1026.43(e)) classification:
 *   - General QM (§1026.43(e)(2)): APR-based safe harbor / rebuttable
 *     presumption depending on APR-over-APOR delta.
 *   - Small-creditor QM (§1026.43(e)(5)): portfolio loans by qualifying
 *     small creditors; safe harbor for HPMLs through 2026 sunset.
 *   - Seasoned QM (§1026.43(e)(7)): 36-month seasoning + payment history.
 *   - Non-QM: no statutory presumption; ATR claim available to borrower
 *     for life of loan + 3 years after default.
 *
 * Seller-financer caveat: The 3-property and 1-property natural-person
 * exemptions in §1026.36(a)(4) DO NOT exempt seller-financers from
 * §1026.43. ATR applies regardless of MLO licensing status whenever the
 * loan is secured by a dwelling and is consumer-purpose. The only escape
 * is non-dwelling (raw land) or pure business-purpose.
 *
 * This service:
 *   - Validates the eight-factor payload structure
 *   - Computes a derived DTI when not provided
 *   - Persists the attestation onto notes.atrDetermination + sets the
 *     completion flag
 *   - Throws AtrIncompleteError when required factors / verification
 *     documents are missing
 */

import { db } from "../db";
import { notes } from "@shared/schema";
import { eq } from "drizzle-orm";
import { logger } from "../utils/logger";

export type QmClassification =
  | "general_qm"
  | "small_creditor_qm"
  | "seasoned_qm"
  | "non_qm"
  | null;

export interface AtrVerificationDocument {
  factor: string; // which §1026.43(c)(2) factor this document supports
  documentType: "w2" | "tax_return" | "bank_statement" | "pay_stub" | "voe" | "credit_report" | "other";
  receivedDate: string; // ISO date
  storedAt?: string;
}

export interface AtrDeterminationInput {
  noteId: number;
  organizationId: number;
  /** Statutory factor (i) — annual income in CENTS (we store cents to avoid float drift). */
  currentOrReasonablyExpectedIncomeCents: number;
  /** Factor (ii) — current employment status. */
  currentEmploymentStatus: string;
  /** Factor (iii) — monthly P&I on the covered transaction in cents. */
  monthlyMortgagePaymentCents: number;
  /** Factor (iv) — monthly payment on any simultaneous loan (piggyback, HELOC). */
  monthlyPaymentSimultaneousLoansCents: number;
  /** Factor (v) — monthly mortgage-related obligations (taxes, insurance, HOA, MI). */
  monthlyPaymentMortgageRelatedObligationsCents: number;
  /** Factor (vi) — current debt obligations, alimony, child support per month. */
  currentDebtObligationsAlimonyChildSupportCents: number;
  /** Factor (vii) — operator-computed monthly DTI ratio in cents-of-debt-per-100-cents-income, OR residual income in cents. Use the field that matches the determination basis. */
  monthlyDtiOrResidualIncomeCents: number;
  /** Factor (viii) — credit history summary. */
  creditHistorySummary: string;
  verificationDocuments: AtrVerificationDocument[];
  qmClassification: QmClassification;
  attestedBy: string;
  attestedByUserId: number;
  attestationText: string;
}

export class AtrIncompleteError extends Error {
  public code: "MISSING_FACTOR" | "MISSING_VERIFICATION" | "INVALID_QM_CLASS";
  public missing: string[];
  constructor(code: AtrIncompleteError["code"], message: string, missing: string[]) {
    super(message);
    this.name = "AtrIncompleteError";
    this.code = code;
    this.missing = missing;
  }
}

/**
 * The canonical attestation text the operator must affirm verbatim. We
 * intentionally use the regulatory language; substituting marketing copy
 * here would weaken the evidentiary value of the attestation.
 */
export const ATR_ATTESTATION_TEXT =
  "I certify that I have made a reasonable and good faith determination that the consumer has a reasonable ability to repay this loan according to its terms, based on consideration of the eight factors enumerated in 12 CFR 1026.43(c)(2), and that the factors have been verified using reasonably reliable third-party records as required by 12 CFR 1026.43(c)(3). The supporting documentation is retained in the consumer credit transaction file in accordance with 12 CFR 1026.25(c)(3).";

/**
 * Validate the determination has all eight statutory factors and at
 * least the minimum verification documents. Throws AtrIncompleteError
 * on any missing required field — callers should catch and surface to
 * the operator with a checklist.
 */
export function validateAtrDetermination(input: AtrDeterminationInput): void {
  const missing: string[] = [];
  if (!Number.isFinite(input.currentOrReasonablyExpectedIncomeCents) || input.currentOrReasonablyExpectedIncomeCents <= 0)
    missing.push("factor_i_income");
  if (!input.currentEmploymentStatus?.trim()) missing.push("factor_ii_employment");
  if (!Number.isFinite(input.monthlyMortgagePaymentCents) || input.monthlyMortgagePaymentCents < 0)
    missing.push("factor_iii_monthly_payment");
  if (!Number.isFinite(input.monthlyPaymentSimultaneousLoansCents))
    missing.push("factor_iv_simultaneous_loan_payment");
  if (!Number.isFinite(input.monthlyPaymentMortgageRelatedObligationsCents))
    missing.push("factor_v_mortgage_related_obligations");
  if (!Number.isFinite(input.currentDebtObligationsAlimonyChildSupportCents))
    missing.push("factor_vi_other_debt_obligations");
  if (!Number.isFinite(input.monthlyDtiOrResidualIncomeCents))
    missing.push("factor_vii_dti_or_residual_income");
  if (!input.creditHistorySummary?.trim()) missing.push("factor_viii_credit_history");

  if (missing.length > 0) {
    throw new AtrIncompleteError(
      "MISSING_FACTOR",
      `ATR determination missing required factors: ${missing.join(", ")}`,
      missing,
    );
  }

  // §1026.43(c)(3) — income + employment require third-party records.
  // We don't second-guess document quality; we just require presence.
  const docsByFactor = new Set(input.verificationDocuments.map((d) => d.factor));
  const verificationGaps: string[] = [];
  if (!docsByFactor.has("factor_i_income")) verificationGaps.push("income_verification");
  if (!docsByFactor.has("factor_ii_employment") && !docsByFactor.has("factor_i_income")) {
    // employment can be verified by income docs in many cases (W-2, tax return).
    verificationGaps.push("employment_verification");
  }
  if (!docsByFactor.has("factor_viii_credit_history")) verificationGaps.push("credit_history_verification");

  if (verificationGaps.length > 0) {
    throw new AtrIncompleteError(
      "MISSING_VERIFICATION",
      `ATR determination missing third-party verification documents for: ${verificationGaps.join(", ")}. §1026.43(c)(3) requires reasonably reliable third-party records.`,
      verificationGaps,
    );
  }

  if (
    input.qmClassification !== null &&
    !["general_qm", "small_creditor_qm", "seasoned_qm", "non_qm"].includes(input.qmClassification)
  ) {
    throw new AtrIncompleteError(
      "INVALID_QM_CLASS",
      `Invalid QM classification: ${input.qmClassification}`,
      ["qm_classification"],
    );
  }

  // Attestation text must match the canonical block. Operator can copy
  // it from the UI; we hash-compare to prevent silent edits.
  if (input.attestationText.trim() !== ATR_ATTESTATION_TEXT.trim()) {
    throw new AtrIncompleteError(
      "MISSING_FACTOR",
      "Attestation text does not match the required §1026.43(c) language. Use ATR_ATTESTATION_TEXT exactly.",
      ["attestation_text"],
    );
  }
}

/**
 * Persist an ATR determination + attestation onto a note. Validates
 * input first; on failure throws AtrIncompleteError so the originating
 * surface can show the operator a missing-factor checklist before they
 * can consummate.
 *
 * IMPORTANT: This MUST run before the note status moves from 'pending'
 * to 'active'. Origination flows enforce that ordering.
 */
export async function persistAtrDetermination(input: AtrDeterminationInput): Promise<void> {
  validateAtrDetermination(input);

  const attestedAt = new Date().toISOString();
  const payload = {
    currentOrReasonablyExpectedIncomeCents: input.currentOrReasonablyExpectedIncomeCents,
    currentEmploymentStatus: input.currentEmploymentStatus,
    monthlyMortgagePaymentCents: input.monthlyMortgagePaymentCents,
    monthlyPaymentSimultaneousLoansCents: input.monthlyPaymentSimultaneousLoansCents,
    monthlyPaymentMortgageRelatedObligationsCents: input.monthlyPaymentMortgageRelatedObligationsCents,
    currentDebtObligationsAlimonyChildSupportCents: input.currentDebtObligationsAlimonyChildSupportCents,
    monthlyDtiOrResidualIncomeCents: input.monthlyDtiOrResidualIncomeCents,
    creditHistorySummary: input.creditHistorySummary,
    verificationDocuments: input.verificationDocuments,
    qmClassification: input.qmClassification,
    attestedBy: input.attestedBy,
    attestedByUserId: input.attestedByUserId,
    attestedAt,
    attestationText: ATR_ATTESTATION_TEXT,
  };

  const updated = await db
    .update(notes)
    .set({
      atrDetermination: payload,
      atrDeterminationCompleted: true,
      atrDeterminationCompletedAt: new Date(attestedAt),
      updatedAt: new Date(),
    })
    .where(eq(notes.id, input.noteId))
    .returning({ id: notes.id });

  if (updated.length === 0) {
    throw new Error(`Note ${input.noteId} not found — cannot attach ATR determination.`);
  }

  logger.info("atrSafeHarbor.attestationRecorded", {
    noteId: input.noteId,
    organizationId: input.organizationId,
    qmClassification: input.qmClassification,
    attestedByUserId: input.attestedByUserId,
  });
}

/**
 * Read the ATR determination back for a note. Returns null if no
 * determination has been captured yet (the calling surface should
 * gate consummation in that case).
 */
export async function getAtrDetermination(noteId: number) {
  const [row] = await db
    .select({
      atrDetermination: notes.atrDetermination,
      completed: notes.atrDeterminationCompleted,
      completedAt: notes.atrDeterminationCompletedAt,
    })
    .from(notes)
    .where(eq(notes.id, noteId))
    .limit(1);
  return row ?? null;
}

/**
 * Compute the DTI ratio (back-end DTI) from the eight-factor inputs in
 * basis points (so 4500 = 45.00%). Returned as a derived figure for the
 * UI to surface alongside the operator's own determination — NOT a
 * substitute for the operator's good-faith analysis.
 *
 * Formula: (factor iii + iv + v + vi) / monthly income
 * (Annual income / 12 = monthly income.)
 */
export function computeBackEndDtiBps(input: Pick<
  AtrDeterminationInput,
  | "currentOrReasonablyExpectedIncomeCents"
  | "monthlyMortgagePaymentCents"
  | "monthlyPaymentSimultaneousLoansCents"
  | "monthlyPaymentMortgageRelatedObligationsCents"
  | "currentDebtObligationsAlimonyChildSupportCents"
>): number | null {
  const monthlyIncomeCents = input.currentOrReasonablyExpectedIncomeCents / 12;
  if (monthlyIncomeCents <= 0) return null;
  const monthlyDebtCents =
    input.monthlyMortgagePaymentCents +
    input.monthlyPaymentSimultaneousLoansCents +
    input.monthlyPaymentMortgageRelatedObligationsCents +
    input.currentDebtObligationsAlimonyChildSupportCents;
  return Math.round((monthlyDebtCents / monthlyIncomeCents) * 10_000);
}
