/**
 * Workstream B — note-payment correctness (Collison review).
 *
 * Three failing tests that target the borrower-payment trust holes:
 *
 *   (a) Payoff from live ledger, not scheduled amortization.
 *       financialOSService.calculateNotePayoff re-runs the schedule and
 *       picks `remainingBalance` at index (paymentsReceived - 1). That
 *       diverges from reality the moment a borrower pays early/late,
 *       partial, or curtails principal. Ground truth = live balance +
 *       per-diem interest since last posting.
 *
 *   (b) Late-fee application using note.lateFee + note.gracePeriodDays.
 *       The borrower portal hard-codes lateFeeAmount: "0". A late fee
 *       must be assessed when a payment posts past grace.
 *
 *   (c) Stripe-session idempotency without a read-then-write race.
 *       Two concurrent calls with the same session id must result in
 *       exactly one persisted payment row (collapsed by the unique
 *       transactionId constraint via ON CONFLICT).
 *
 * Test fixtures (a) and (b) drive PURE math helpers that live in
 * server/services/notePaymentMath.ts (added in fix commits). Test (c)
 * drives the idempotent-insert helper from the same module.
 *
 * On the failing commit, these tests must FAIL — that's the point of TDD
 * here.
 */

import { describe, it, expect } from "vitest";

import {
  splitPaymentCents,
  computeAppliedLateFeeCents,
  computePayoffCents,
  insertPaymentIdempotentCents,
  type PaymentLedgerEntry,
} from "../../server/services/notePaymentMath";
import { calculateNotePayoff } from "../../server/services/financialOSService";

// ---------------------------------------------------------------------------
// (a) Payoff from live ledger, not amortization replay.
//
// Scenario: $50,000 / 9.9% / 120 months. Borrower history:
//   - 6 on-time scheduled P&I payments
//   - +$500 extra principal (curtailment) after month 3
//   - one partial $200 (held as unapplied — does NOT reduce principal)
//   - 1 on-time P&I payment
//   - late by 8 days on month 8 — payoff requested on day 12 of month 8
//
// We track the ground-truth balance using the same math the production
// path will use after the fix (currentBalanceCents reduced ONLY by the
// principal portion of completed P&I payments + curtailments; partial
// payments do not reduce principal). Payoff = currentBalance + per-diem.
// ---------------------------------------------------------------------------

describe("Workstream B — payoff math (live ledger, not schedule replay)", () => {
  const principalCents = 50_000_00; // $50,000 in cents
  const annualRateBps = 990; // 9.90% -> 990 bps
  const termMonths = 120;
  const firstPaymentDate = new Date("2026-01-01T00:00:00Z");

  // Build a synthetic ledger and a hand-computed live balance.
  // P&I monthly payment ~ $658.47 at 9.9% 120mo on $50,000. We don't need
  // the exact dollar — we drive the test off the ledger we construct.
  function pIWeights(balanceCents: number): { pCents: number; iCents: number; totalCents: number } {
    // monthly interest = balance * apr / 12
    const monthlyRate = annualRateBps / 10_000 / 12;
    const interestCents = Math.round(balanceCents * monthlyRate);
    // Use a fixed total payment derived from the standard amortization
    // formula so all months feel comparable. Computed at trial time.
    const totalCents = 65_847; // ~$658.47
    const principalCents = totalCents - interestCents;
    return { pCents: principalCents, iCents: interestCents, totalCents };
  }

  it("uses live currentBalance + per-diem (not schedule-indexed lookup) — (a)", () => {
    // Build a payment ledger that matches the Collison scenario.
    let balanceCents = principalCents;
    const ledger: PaymentLedgerEntry[] = [];

    const addMonths = (d: Date, n: number): Date => {
      const x = new Date(d);
      x.setUTCMonth(x.getUTCMonth() + n);
      return x;
    };

    // Months 1..6 — on-time scheduled P&I
    for (let m = 1; m <= 6; m++) {
      const { pCents, iCents } = pIWeights(balanceCents);
      balanceCents -= pCents;
      ledger.push({
        paymentDate: addMonths(firstPaymentDate, m - 1),
        principalCents: pCents,
        interestCents: iCents,
        unappliedCents: 0,
      });
    }

    // After month 3 — extra principal curtailment of $500 (50,000c).
    // The curtailment is principal-only; insertion order doesn't change
    // the final balance, just the per-diem accrual timing.
    const extraCurtailDate = addMonths(firstPaymentDate, 3);
    balanceCents -= 50_000;
    ledger.push({
      paymentDate: extraCurtailDate,
      principalCents: 50_000,
      interestCents: 0,
      unappliedCents: 0,
    });

    // Partial payment of $200 in month 7 — does NOT reduce principal.
    const partialDate = addMonths(firstPaymentDate, 6);
    ledger.push({
      paymentDate: partialDate,
      principalCents: 0,
      interestCents: 0,
      unappliedCents: 20_000,
    });

    // Month 7 P&I — on-time
    {
      const { pCents, iCents } = pIWeights(balanceCents);
      balanceCents -= pCents;
      ledger.push({
        paymentDate: addMonths(firstPaymentDate, 6),
        principalCents: pCents,
        interestCents: iCents,
        unappliedCents: 0,
      });
    }

    // Month 8 — borrower pays late by 8 days. Then payoff is requested on
    // day 12 of month 8 — so the last posting is paymentDate = day 8 of
    // month 8 (the late P&I). Per-diem from day 8 to day 12 = 4 days.
    const month8Due = addMonths(firstPaymentDate, 7);
    const month8Posted = new Date(month8Due);
    month8Posted.setUTCDate(month8Posted.getUTCDate() + 8);
    {
      const { pCents, iCents } = pIWeights(balanceCents);
      balanceCents -= pCents;
      ledger.push({
        paymentDate: month8Posted,
        principalCents: pCents,
        interestCents: iCents,
        unappliedCents: 0,
      });
    }

    const payoffDate = new Date(month8Posted);
    payoffDate.setUTCDate(payoffDate.getUTCDate() + 4); // 4 days later
    const daysSincePosting = 4;

    // Live-ledger payoff: balance + per-diem interest using /365 (matches
    // existing convention in financialOSService.calculateNotePayoff).
    const expectedPayoffCents = Math.round(
      balanceCents +
        balanceCents * (annualRateBps / 10_000 / 365) * daysSincePosting,
    );

    // ── Helper-level assertion: the new live-ledger helper must agree
    //    with the hand-computed payoff. (Pure-helper sanity check.)
    const helperPayoff = computePayoffCents({
      currentBalanceCents: balanceCents,
      annualRateBps,
      lastPostingDate: month8Posted,
      payoffDate,
    });
    expect(helperPayoff).toBe(expectedPayoffCents);

    // ── End-to-end assertion: calculateNotePayoff must be called with
    //    the LIVE balance + lastPaymentDate (the live-ledger contract)
    //    and must return the expected payoff value. Until commit 4 lands,
    //    calculateNotePayoff still indexes a replayed schedule and will
    //    disagree — that's the failing-first signal.
    const livePayoff = calculateNotePayoff({
      currentBalanceCents: balanceCents,
      annualInterestRate: annualRateBps / 10_000,
      lastPaymentDate: month8Posted,
      payoffDate,
    });

    const livePayoffCents = Math.round(livePayoff.totalPayoff * 100);
    expect(livePayoffCents).toBe(expectedPayoffCents);
  });
});

// ---------------------------------------------------------------------------
// (b) Late fee — applied when paymentDate > dueDate + gracePeriodDays.
// ---------------------------------------------------------------------------

describe("Workstream B — late fee application", () => {
  it("applies lateFee in cents when payment posts after grace period — (b)", () => {
    // $25.00 late fee, 10-day grace, payment 12 days after due.
    const dueDate = new Date("2026-03-01T00:00:00Z");
    const paymentDate = new Date("2026-03-13T00:00:00Z"); // day 12
    const lateFeeCents = 25_00; // $25.00
    const gracePeriodDays = 10;

    const applied = computeAppliedLateFeeCents({
      dueDate,
      paymentDate,
      gracePeriodDays,
      configuredLateFeeCents: lateFeeCents,
    });
    expect(applied).toBe(2500);
  });

  it("does NOT apply lateFee when payment posts within grace — (b)", () => {
    const dueDate = new Date("2026-03-01T00:00:00Z");
    const paymentDate = new Date("2026-03-09T00:00:00Z"); // day 8 — inside grace
    const applied = computeAppliedLateFeeCents({
      dueDate,
      paymentDate,
      gracePeriodDays: 10,
      configuredLateFeeCents: 2500,
    });
    expect(applied).toBe(0);
  });

  it("does NOT apply lateFee on the exact grace boundary — (b)", () => {
    const dueDate = new Date("2026-03-01T00:00:00Z");
    const paymentDate = new Date("2026-03-11T00:00:00Z"); // day 10 — last grace day
    const applied = computeAppliedLateFeeCents({
      dueDate,
      paymentDate,
      gracePeriodDays: 10,
      configuredLateFeeCents: 2500,
    });
    expect(applied).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// (b') P/I split in integer cents (no .toFixed(2) float drift).
// ---------------------------------------------------------------------------

describe("Workstream B — payment split in cents", () => {
  it("splits a single payment into integer-cent principal + interest — (b')", () => {
    // $50,000 balance, 9.9% APR, monthly payment $658.47.
    // monthly interest = 50_000_00 * (990 / 10_000 / 12) = 41_250 cents.
    // principal = 65_847 - 41_250 = 24_597 cents.
    const split = splitPaymentCents({
      paymentAmountCents: 65_847,
      currentBalanceCents: 50_000_00,
      annualRateBps: 990,
    });
    expect(split.principalCents + split.interestCents).toBe(65_847);
    expect(split.interestCents).toBe(41_250);
    expect(split.principalCents).toBe(24_597);
  });

  it("clamps principal at currentBalance — split cannot create negative balance — (b')", () => {
    // 9% APR -> monthly rate = 0.0075. Balance $100 (10_000 cents).
    // Interest on $100 for one month = 75 cents.
    // A $500 payment would produce $4.25 principal in normal math, but
    // here the borrower is paying off a $100 balance — principal must
    // clamp to the remaining $100 and the excess is interest? No —
    // payoff math: principal is clamped to balance, the rest is
    // accumulated as "overpayment / payoff residue" which the borrower
    // gets credited back. For the split helper, we cap principal at
    // balance and surface the residue.
    const split = splitPaymentCents({
      paymentAmountCents: 50_000,
      currentBalanceCents: 10_000,
      annualRateBps: 900,
    });
    expect(split.principalCents).toBeLessThanOrEqual(10_000);
    expect(split.principalCents + split.interestCents + split.residueCents).toBe(50_000);
  });
});

// ---------------------------------------------------------------------------
// (c) Idempotency — same Stripe sessionId submitted concurrently.
// ---------------------------------------------------------------------------

describe("Workstream B — Stripe sessionId idempotency", () => {
  it("two concurrent inserts with same transactionId yield exactly one row — (c)", async () => {
    // We test the idempotent insert helper directly. It must use
    // INSERT … ON CONFLICT (transaction_id) DO NOTHING RETURNING * and,
    // on zero rows, fetch+return the existing row.
    //
    // The test uses an in-memory mock that mirrors PG's unique-constraint
    // semantics and lets two coroutines race.

    const inserted: Array<{ transactionId: string; id: number }> = [];
    let nextId = 1;

    const fakeInsertOnConflict = async (txnId: string): Promise<{ id: number; transactionId: string } | null> => {
      // Simulate PG's ON CONFLICT DO NOTHING: if exists, return null (RETURNING
      // yields no row); else insert and return the new row.
      const existing = inserted.find((r) => r.transactionId === txnId);
      if (existing) return null;
      const row = { id: nextId++, transactionId: txnId };
      inserted.push(row);
      return row;
    };
    const fakeFetchExisting = async (txnId: string) => {
      return inserted.find((r) => r.transactionId === txnId) ?? null;
    };

    const a = insertPaymentIdempotentCents({
      transactionId: "cs_test_xyz",
      insertOnConflict: fakeInsertOnConflict,
      fetchExisting: fakeFetchExisting,
    });
    const b = insertPaymentIdempotentCents({
      transactionId: "cs_test_xyz",
      insertOnConflict: fakeInsertOnConflict,
      fetchExisting: fakeFetchExisting,
    });

    const [resA, resB] = await Promise.all([a, b]);

    // Exactly one row persisted, both responses non-null and equal.
    expect(inserted.length).toBe(1);
    expect(resA.row.id).toBe(resB.row.id);
    // Exactly one of the two should report `created=true`, the other `created=false`.
    expect([resA.created, resB.created].sort()).toEqual([false, true]);
  });
});
