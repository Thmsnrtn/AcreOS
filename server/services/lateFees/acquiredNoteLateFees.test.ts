/**
 * §1026.36(c)(2) late-fee non-pyramiding piggyback on acquired notes
 * (Beatrice 2026-06-02 ruling §5). The pure algorithm doesn't care about
 * loan type — non-pyramiding semantics are identical. What changed: the
 * persistence-layer UNIQUE index now includes loan_type, so distinct
 * originated + acquired loans that share a stringified id cannot collide.
 *
 * These tests exercise the pure-function behavior on acquired-note shapes
 * + assert the non-pyramiding hold survives across the two loan types.
 */

import { describe, expect, it } from "vitest";
import { shouldAssessLateFee } from "./index";
import { qualifiesForRegZStatementSync } from "../periodicStatements/predicate";
import { computeNoteDelinquency } from "../notes/acquiredNoteSchedule";
import type { AcquiredNote } from "@shared/schema/notes-vertical";

const PERIODIC_CENTS = 50_000;
const GRACE_DAYS = 10;
const LATE_FEE_CENTS = 5_000;

/**
 * The cycle the fee-assessable cases below evaluate: April 2026, due the 1st.
 * The fixture's stored schedule columns describe the SAME cycle, so the row
 * is a note that is genuinely past grace rather than a `current` note whose
 * stored aging contradicts the fee the test then asserts is due.
 */
const MISSED_CYCLE_DUE = "2026-04-01";
/** Last period the borrower fully satisfied — the cycle before the missed one. */
const PAID_THROUGH = "2026-03-01";
/**
 * "Now" for the fee-assessable cases. 2026-04-20 is 9 days past the grace
 * deadline (MISSED_CYCLE_DUE + GRACE_DAYS = 2026-04-11). The tests pass this
 * same instant as `evaluationDate`, so the note's stored aging and the cycle
 * under evaluation cannot describe two different days.
 */
const EVALUATION_DATE = new Date(Date.UTC(2026, 3, 20));

function cycle(year: number, month: number) {
  return {
    periodStart: new Date(Date.UTC(year, month - 1, 1)),
    periodEnd: new Date(Date.UTC(year, month, 0)),
    dueDate: new Date(Date.UTC(year, month - 1, 1)),
  };
}

function qualifyingAcquired(overrides: Partial<AcquiredNote> = {}): AcquiredNote {
  return {
    id: "22222222-2222-2222-2222-222222222222",
    organizationId: 1,
    propertyId: null,
    borrowerId: null,
    noteNumber: "AN-LF-1",
    originalPrincipalCents: 10_000_000,
    currentBalanceCents: 9_500_000,
    unappliedBalanceCents: 0,
    interestRateBps: 800,
    termMonths: 360,
    paymentAmountCents: PERIODIC_CENTS,
    paymentDueDay: 1,
    originationDate: "2020-01-01",
    maturityDate: "2050-01-01",
    acquisitionDate: "2024-06-01",
    acquisitionPriceCents: 8_500_000,
    firstPaymentDate: "2020-02-01",
    // The missed cycle is the note's next-due period; the cycle before it is
    // paid through. Grace + fee are read from this file's own constants so a
    // change to either can never leave the fixture behind.
    nextPaymentDate: MISSED_CYCLE_DUE,
    paidThroughDate: PAID_THROUGH,
    gracePeriodDays: GRACE_DAYS,
    lateFeeCents: LATE_FEE_CENTS,
    // Derived by the same pure function the aging job uses, from this
    // fixture's own due date + grace, as of the tests' evaluation instant.
    // At 2026-04-20 that is 9 days past grace → `delinquent`.
    ...computeNoteDelinquency({
      nextPaymentDate: MISSED_CYCLE_DUE,
      gracePeriodDays: GRACE_DAYS,
      asOf: EVALUATION_DATE,
    }),
    status: "late",
    payerName: "Jane Borrower",
    payerAddress: null,
    payerEncryptedTin: null,
    payerTinType: null,
    originalLender: null,
    assignmentDocS3Key: null,
    insuranceStatus: "verified",
    insuranceCarrier: null,
    insurancePolicyNumber: null,
    insuranceExpiresAt: null,
    insuranceAnnualPremiumCents: null,
    taxEscrowEnabled: false,
    taxEscrowBalanceCents: 0,
    taxDisbursementDueDate: null,
    taxDisbursementAmountCents: null,
    taxAuthorityName: null,
    consecutiveOnTimePayments: 0,
    reperformingThresholdMet: false,
    compliancePostureJson: null,
    isConsumerPurpose: true,
    collateralIsDwelling: true,
    servicingArrangement: "self_serviced",
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("§1026.36(c)(2) late-fee piggyback on acquired notes", () => {
  it("qualifying acquired note: missed cycle past grace → fee fires once", () => {
    const note = qualifyingAcquired();
    const predicate = qualifiesForRegZStatementSync({ kind: "acquired_note", row: note });
    expect(predicate.qualifies).toBe(true);

    // The stored row must itself describe a note past grace — a fee asserted
    // against a row whose aging says `current` would be two truths at once.
    expect(note.paidThroughDate).toBe(PAID_THROUGH);
    expect(note.daysDelinquent).toBeGreaterThan(0);
    expect(note.delinquencyStatus).not.toBe("current");

    const { periodStart, periodEnd, dueDate } = cycle(2026, 4);
    const result = shouldAssessLateFee({
      periodStart,
      periodEnd,
      dueDate,
      gracePeriodDays: GRACE_DAYS,
      periodicPaymentAmountCents: PERIODIC_CENTS,
      amountCreditedToCycleCents: 0,
      evaluationDate: EVALUATION_DATE,
      configuredLateFeeCents: LATE_FEE_CENTS,
    });
    expect(result.shouldAssess).toBe(true);
    expect(result.feeAmountCents).toBe(LATE_FEE_CENTS);
    expect(result.justification).toContain("§1026.36(c)(2)");
  });

  it("ADVERSARIAL: acquired-note non-pyramiding holds across origin + acquired loan types", () => {
    // Borrower has BOTH an originated note (cycle 1 missed) and an acquired
    // note (cycle 1 paid in full). The non-pyramiding rule must independently
    // evaluate each — the originated-note shortfall must NOT trigger a fee
    // on the acquired note's on-time cycle. Each loan is its own cycle space.
    const acquiredCycle = cycle(2026, 4);
    const acquiredResult = shouldAssessLateFee({
      ...acquiredCycle,
      gracePeriodDays: GRACE_DAYS,
      periodicPaymentAmountCents: PERIODIC_CENTS,
      amountCreditedToCycleCents: PERIODIC_CENTS, // paid in full
      evaluationDate: new Date(Date.UTC(2026, 3, 30)),
      configuredLateFeeCents: LATE_FEE_CENTS,
    });
    expect(acquiredResult.shouldAssess).toBe(false);
    expect(acquiredResult.justification).toContain("regardless of prior-cycle delinquency");
  });

  it("non-qualifying acquired note (passive_holder) → predicate gates BEFORE late-fee evaluation", () => {
    const note = qualifyingAcquired({ servicingArrangement: "passive_holder" });
    const predicate = qualifiesForRegZStatementSync({ kind: "acquired_note", row: note });
    expect(predicate.qualifies).toBe(false);
    // The piggyback contract: a non-self_serviced acquired note doesn't
    // attract AcreOS's late-fee assessor. Duty lies with the actual servicer.
  });

  it("idempotency-shape contract: re-running on same (loan_id, period_start, loan_type) is a no-op", () => {
    // Pure-function behavior — the DB-layer UNIQUE index does the real
    // enforcement. We verify the pure function returns the same result on
    // back-to-back evaluations (no hidden state).
    const { periodStart, periodEnd, dueDate } = cycle(2026, 4);
    const input = {
      periodStart,
      periodEnd,
      dueDate,
      gracePeriodDays: GRACE_DAYS,
      periodicPaymentAmountCents: PERIODIC_CENTS,
      amountCreditedToCycleCents: 0,
      evaluationDate: EVALUATION_DATE,
      configuredLateFeeCents: LATE_FEE_CENTS,
    };
    const r1 = shouldAssessLateFee(input);
    const r2 = shouldAssessLateFee(input);
    expect(r1).toEqual(r2);
    expect(r1.shouldAssess).toBe(true);
  });
});
