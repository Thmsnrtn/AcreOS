/**
 * Tests for §1026.36(c)(2) late-fee non-pyramiding algorithm.
 *
 * The flagship adversarial scenario: three consecutive cycles where
 * cycles 1 and 2 are missed but cycle 3 is paid in full and on time.
 * The reg explicitly forbids assessing a fee on cycle 3 simply because
 * cycles 1-2 carried a delinquency. We verify that here.
 */

import { describe, expect, it } from "vitest";
import { shouldAssessLateFee } from "./index";

const PERIODIC_CENTS = 50_000;
const GRACE_DAYS = 10;
const LATE_FEE_CENTS = 5_000; // $50

function cycle(year: number, month: number) {
  const periodStart = new Date(Date.UTC(year, month - 1, 1));
  const periodEnd = new Date(Date.UTC(year, month, 0));
  const dueDate = new Date(Date.UTC(year, month - 1, 1));
  return { periodStart, periodEnd, dueDate };
}

describe("shouldAssessLateFee — §1026.36(c)(2) non-pyramiding", () => {
  it("cycle paid in full within grace — no fee", () => {
    const { periodStart, periodEnd, dueDate } = cycle(2026, 4);
    const result = shouldAssessLateFee({
      periodStart,
      periodEnd,
      dueDate,
      gracePeriodDays: GRACE_DAYS,
      periodicPaymentAmountCents: PERIODIC_CENTS,
      amountCreditedToCycleCents: PERIODIC_CENTS,
      evaluationDate: new Date(Date.UTC(2026, 3, 8)), // 7 days past due
      configuredLateFeeCents: LATE_FEE_CENTS,
    });
    expect(result.shouldAssess).toBe(false);
    expect(result.feeAmountCents).toBe(0);
  });

  it("cycle paid late (past grace) — fee fires", () => {
    const { periodStart, periodEnd, dueDate } = cycle(2026, 4);
    const result = shouldAssessLateFee({
      periodStart,
      periodEnd,
      dueDate,
      gracePeriodDays: GRACE_DAYS,
      periodicPaymentAmountCents: PERIODIC_CENTS,
      amountCreditedToCycleCents: 0, // nothing yet credited
      evaluationDate: new Date(Date.UTC(2026, 3, 15)), // 14 days past due
      configuredLateFeeCents: LATE_FEE_CENTS,
    });
    expect(result.shouldAssess).toBe(true);
    expect(result.feeAmountCents).toBe(LATE_FEE_CENTS);
    expect(result.justification).toContain("§1026.36(c)(2)");
  });

  it("boundary: payment exactly at due + grace — no fee", () => {
    const { periodStart, periodEnd, dueDate } = cycle(2026, 4);
    const result = shouldAssessLateFee({
      periodStart,
      periodEnd,
      dueDate,
      gracePeriodDays: GRACE_DAYS,
      periodicPaymentAmountCents: PERIODIC_CENTS,
      amountCreditedToCycleCents: 0,
      evaluationDate: new Date(Date.UTC(2026, 3, 11)), // exactly grace_days later
      configuredLateFeeCents: LATE_FEE_CENTS,
    });
    expect(result.shouldAssess).toBe(false);
  });

  it("boundary: payment one second past grace — fee fires", () => {
    const { periodStart, periodEnd, dueDate } = cycle(2026, 4);
    const result = shouldAssessLateFee({
      periodStart,
      periodEnd,
      dueDate,
      gracePeriodDays: GRACE_DAYS,
      periodicPaymentAmountCents: PERIODIC_CENTS,
      amountCreditedToCycleCents: 0,
      evaluationDate: new Date(Date.UTC(2026, 3, 12, 0, 0, 1)), // grace_days + 1s
      configuredLateFeeCents: LATE_FEE_CENTS,
    });
    expect(result.shouldAssess).toBe(true);
  });

  it("ADVERSARIAL: 3 consecutive missed-then-paid cycles — fees ONLY on the missed cycles, never pyramided", () => {
    // Cycle 1 (April): missed entirely.
    // Cycle 2 (May): missed entirely.
    // Cycle 3 (June): paid in full on the due date.
    // §1026.36(c)(2) forbids a fee on cycle 3.
    const evalDateForJune = new Date(Date.UTC(2026, 5, 12)); // 11 days past June 1

    const april = cycle(2026, 4);
    const may = cycle(2026, 5);
    const june = cycle(2026, 6);

    const aprilResult = shouldAssessLateFee({
      ...april,
      gracePeriodDays: GRACE_DAYS,
      periodicPaymentAmountCents: PERIODIC_CENTS,
      amountCreditedToCycleCents: 0,
      evaluationDate: evalDateForJune,
      configuredLateFeeCents: LATE_FEE_CENTS,
    });
    expect(aprilResult.shouldAssess).toBe(true); // April was missed.

    const mayResult = shouldAssessLateFee({
      ...may,
      gracePeriodDays: GRACE_DAYS,
      periodicPaymentAmountCents: PERIODIC_CENTS,
      amountCreditedToCycleCents: 0,
      evaluationDate: evalDateForJune,
      configuredLateFeeCents: LATE_FEE_CENTS,
    });
    expect(mayResult.shouldAssess).toBe(true); // May was missed.

    // The whole point: June was paid in full on time. NO FEE, even
    // though April + May carry delinquencies.
    const juneResult = shouldAssessLateFee({
      ...june,
      gracePeriodDays: GRACE_DAYS,
      periodicPaymentAmountCents: PERIODIC_CENTS,
      amountCreditedToCycleCents: PERIODIC_CENTS, // June paid in full
      evaluationDate: evalDateForJune,
      configuredLateFeeCents: LATE_FEE_CENTS,
    });
    expect(juneResult.shouldAssess).toBe(false);
    expect(juneResult.feeAmountCents).toBe(0);
    expect(juneResult.justification).toContain("regardless of prior-cycle delinquency");
  });

  it("zero configured late fee — never assesses", () => {
    const { periodStart, periodEnd, dueDate } = cycle(2026, 4);
    const result = shouldAssessLateFee({
      periodStart,
      periodEnd,
      dueDate,
      gracePeriodDays: GRACE_DAYS,
      periodicPaymentAmountCents: PERIODIC_CENTS,
      amountCreditedToCycleCents: 0,
      evaluationDate: new Date(Date.UTC(2026, 3, 30)),
      configuredLateFeeCents: 0,
    });
    expect(result.shouldAssess).toBe(false);
  });

  it("partial cycle credit (less than periodic) past grace — fee fires", () => {
    const { periodStart, periodEnd, dueDate } = cycle(2026, 4);
    const result = shouldAssessLateFee({
      periodStart,
      periodEnd,
      dueDate,
      gracePeriodDays: GRACE_DAYS,
      periodicPaymentAmountCents: PERIODIC_CENTS,
      amountCreditedToCycleCents: 25_000, // only half
      evaluationDate: new Date(Date.UTC(2026, 3, 20)),
      configuredLateFeeCents: LATE_FEE_CENTS,
    });
    expect(result.shouldAssess).toBe(true);
    expect(result.feeAmountCents).toBe(LATE_FEE_CENTS);
  });
});
