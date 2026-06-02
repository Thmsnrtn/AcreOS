/**
 * Tests for §1026.36(c)(1) prompt-crediting + suspense-bucket algorithm.
 *
 * Pure-function tests — no DB required. The DB-orchestrator path
 * (`applyPayment`) is exercised by integration tests in a separate file
 * once the test harness has db-mock plumbing wired for the reg-z tables.
 */

import { describe, expect, it } from "vitest";
import {
  decidePaymentApplication,
  computeAppliedAt,
} from "./index";

const PERIODIC_CENTS = 50_000; // $500/mo
const PERIODIC_SPLIT = {
  principalCents: 10_000,
  interestCents: 35_000,
  escrowCents: 5_000,
};
const CHICAGO = "America/Chicago";

describe("computeAppliedAt — §1026.36(c)(1)(i) prompt crediting", () => {
  it("payment received at 4:59pm local on due date — credits same day", () => {
    // 4:59pm Chicago = 21:59 UTC on the same date in standard time.
    const dueDate = new Date("2026-06-15T05:00:00Z"); // a Monday
    const receivedAt = new Date("2026-06-15T21:59:00Z"); // 4:59pm CT
    const applied = computeAppliedAt(receivedAt, dueDate, CHICAGO);
    expect(applied.getTime()).toBe(receivedAt.getTime());
  });

  it("payment received at 5:00pm local on due date — still same-day in our stricter policy", () => {
    const dueDate = new Date("2026-06-15T05:00:00Z");
    const receivedAt = new Date("2026-06-15T22:00:00Z"); // 5:00pm CT
    const applied = computeAppliedAt(receivedAt, dueDate, CHICAGO);
    // Strict-borrower-friendly: we credit on receipt regardless of hour.
    expect(applied.getTime()).toBe(receivedAt.getTime());
  });

  it("payment received before due date — credited on receipt date", () => {
    const dueDate = new Date("2026-06-15T05:00:00Z");
    const receivedAt = new Date("2026-06-10T10:00:00Z");
    const applied = computeAppliedAt(receivedAt, dueDate, CHICAGO);
    expect(applied.getTime()).toBe(receivedAt.getTime());
  });
});

describe("decidePaymentApplication — §1026.36(c)(1)", () => {
  const baseInput = {
    paymentAmountCents: 50_000,
    periodicPaymentAmountCents: PERIODIC_CENTS,
    existingSuspenseBalanceCents: 0,
    receivedAt: new Date("2026-06-15T15:00:00Z"),
    dueDate: new Date("2026-06-15T05:00:00Z"),
    loanTz: CHICAGO,
    periodicSplit: PERIODIC_SPLIT,
  };

  it("zero-amount payment is a no-op", () => {
    const decision = decidePaymentApplication({
      ...baseInput,
      paymentAmountCents: 0,
    });
    expect(decision.appliedToPrincipalCents).toBe(0);
    expect(decision.appliedToInterestCents).toBe(0);
    expect(decision.appliedToSuspenseCents).toBe(0);
    expect(decision.newSuspenseBalanceCents).toBe(0);
    expect(decision.regCitation).toContain("§1026.36(c)(1)(i)");
  });

  it("partial payment lands ENTIRELY in suspense — never partial-as-full", () => {
    const decision = decidePaymentApplication({
      ...baseInput,
      paymentAmountCents: 20_000, // half the periodic
    });
    expect(decision.appliedToPrincipalCents).toBe(0);
    expect(decision.appliedToInterestCents).toBe(0);
    expect(decision.appliedToEscrowCents).toBe(0);
    expect(decision.appliedToSuspenseCents).toBe(20_000);
    expect(decision.newSuspenseBalanceCents).toBe(20_000);
    expect(decision.regCitation).toContain("§1026.36(c)(1)(ii)");
  });

  it("suspense release: existing 30k + new 25k >= periodic 50k → full apply, 5k overage to suspense", () => {
    const decision = decidePaymentApplication({
      ...baseInput,
      paymentAmountCents: 25_000,
      existingSuspenseBalanceCents: 30_000,
    });
    expect(decision.appliedToPrincipalCents).toBe(PERIODIC_SPLIT.principalCents);
    expect(decision.appliedToInterestCents).toBe(PERIODIC_SPLIT.interestCents);
    expect(decision.appliedToEscrowCents).toBe(PERIODIC_SPLIT.escrowCents);
    // Net suspense delta = overage - existing = 5000 - 30000 = -25000.
    expect(decision.appliedToSuspenseCents).toBe(-25_000);
    expect(decision.newSuspenseBalanceCents).toBe(5_000);
    expect(decision.regCitation).toContain("suspense release");
  });

  it("full payment + no existing suspense: full apply, zero suspense delta", () => {
    const decision = decidePaymentApplication({
      ...baseInput,
      paymentAmountCents: 50_000,
      existingSuspenseBalanceCents: 0,
    });
    expect(decision.appliedToPrincipalCents).toBe(PERIODIC_SPLIT.principalCents);
    expect(decision.appliedToSuspenseCents).toBe(0);
    expect(decision.newSuspenseBalanceCents).toBe(0);
  });

  it("partial-payment-exactly-equal-to-existing-then-make-whole — edge case", () => {
    // Borrower had 25k in suspense, sends another 25k that exactly hits periodic.
    const decision = decidePaymentApplication({
      ...baseInput,
      paymentAmountCents: 25_000,
      existingSuspenseBalanceCents: 25_000,
    });
    expect(decision.appliedToPrincipalCents).toBe(PERIODIC_SPLIT.principalCents);
    expect(decision.appliedToInterestCents).toBe(PERIODIC_SPLIT.interestCents);
    // Released 25k, deposited 0 overage. Net = -25000.
    expect(decision.appliedToSuspenseCents).toBe(-25_000);
    expect(decision.newSuspenseBalanceCents).toBe(0);
  });

  it("overpayment: 75k paid, 50k applied, 25k stays in suspense for next cycle", () => {
    const decision = decidePaymentApplication({
      ...baseInput,
      paymentAmountCents: 75_000,
      existingSuspenseBalanceCents: 0,
    });
    expect(decision.appliedToPrincipalCents).toBe(PERIODIC_SPLIT.principalCents);
    expect(decision.appliedToSuspenseCents).toBe(25_000);
    expect(decision.newSuspenseBalanceCents).toBe(25_000);
  });

  it("rejects negative payment amounts", () => {
    expect(() =>
      decidePaymentApplication({ ...baseInput, paymentAmountCents: -1 }),
    ).toThrow();
  });

  it("conservation: sum of buckets always equals paymentAmount + suspense release", () => {
    // Property: across all branches, the value flow conserves.
    // paymentAmount = appliedToP + appliedToI + appliedToE + appliedToFees + (suspense delta from THIS payment)
    // Suspense delta from THIS payment = (newSuspense - existingSuspense)
    const cases = [
      { paymentAmountCents: 0, existingSuspenseBalanceCents: 0 },
      { paymentAmountCents: 20_000, existingSuspenseBalanceCents: 0 },
      { paymentAmountCents: 50_000, existingSuspenseBalanceCents: 0 },
      { paymentAmountCents: 25_000, existingSuspenseBalanceCents: 30_000 },
      { paymentAmountCents: 75_000, existingSuspenseBalanceCents: 0 },
    ];
    for (const c of cases) {
      const d = decidePaymentApplication({ ...baseInput, ...c });
      const bucketed =
        d.appliedToPrincipalCents +
        d.appliedToInterestCents +
        d.appliedToEscrowCents +
        d.appliedToFeesCents;
      const suspenseDelta = d.newSuspenseBalanceCents - c.existingSuspenseBalanceCents;
      // Conservation: paymentAmount === bucketed + suspenseDelta
      expect(bucketed + suspenseDelta).toBe(c.paymentAmountCents);
    }
  });
});
