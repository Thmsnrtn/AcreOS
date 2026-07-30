/**
 * `applyPaymentToSchedule` — what recording a payment does to an acquired
 * note's clock.
 *
 * This file exists because an independent audit found the change's two purest
 * new functions had ZERO tests, and the most serious defect in the whole build
 * lived in exactly that gap:
 *
 *   Originated 2019-03-10, acquired 2026-07-01, no payment history imported —
 *   the shape of EVERY tape-imported note, since the importer sets neither
 *   anchor. `nextPaymentVerdict` correctly refused to date it. But
 *   `advancePaidThrough` started from the same origination anchor with no such
 *   guard, so ONE ordinary payment produced paid-through 2019-03-15, next due
 *   2019-04-15, 2,653 days delinquent, band `default_candidate` — which flips
 *   the note to `default`, emits `payment.missed`, and trips the RESPA
 *   §1024.39 early-intervention obligation. Against a real borrower, off a
 *   date nobody verified.
 *
 * The guard now covers both doors. Any of the cases below would have caught it.
 */
import { describe, it, expect } from "vitest";
import {
  applyPaymentToSchedule,
  periodsSatisfiedByPayment,
  daysLateForNotePayment,
  REPERFORMING_DEFAULT_THRESHOLD,
} from "../../server/routes-notes";
import type { AcquiredNoteScheduleFacts } from "../../server/services/notes/acquiredNoteSchedule";

const ASOF = new Date(Date.UTC(2026, 6, 30)); // 2026-07-30
const SCHEDULED = 100_000; // $1,000.00 P&I

/** A note AcreOS has watched since origination — history is not a mystery. */
function seenFacts(over: Partial<AcquiredNoteScheduleFacts> = {}): AcquiredNoteScheduleFacts {
  return {
    paymentDueDay: 15,
    firstPaymentDate: "2025-02-15",
    originationDate: "2025-01-10",
    maturityDate: "2035-01-15",
    acquisitionDate: "2025-01-20",
    paidThroughDate: "2026-06-15",
    ...over,
  };
}

/** The tape import: bought years after origination, no history. */
function unseenFacts(over: Partial<AcquiredNoteScheduleFacts> = {}): AcquiredNoteScheduleFacts {
  return {
    paymentDueDay: 15,
    firstPaymentDate: null,
    originationDate: "2019-03-10",
    maturityDate: "2039-03-15",
    acquisitionDate: "2026-07-01",
    paidThroughDate: null,
    ...over,
  };
}

function apply(over: Partial<Parameters<typeof applyPaymentToSchedule>[0]> = {}) {
  return applyPaymentToSchedule({
    paymentType: "regular",
    paymentDate: "2026-07-14",
    principalCents: 30_000,
    interestCents: 70_000,
    escrowCents: 0,
    scheduledPaymentAmountCents: SCHEDULED,
    newCurrentBalanceCents: 5_000_000,
    facts: seenFacts(),
    storedNextPaymentDate: "2026-07-15",
    gracePeriodDays: 10,
    status: "performing",
    consecutiveOnTimePayments: 0,
    reperformingThresholdMet: false,
    reperformingThreshold: REPERFORMING_DEFAULT_THRESHOLD,
    asOf: ASOF,
    ...over,
  });
}

describe("THE REGRESSION — a payment must not manufacture a delinquency", () => {
  it("a payment on an unseen-history note establishes NO schedule", () => {
    const out = apply({ facts: unseenFacts(), storedNextPaymentDate: null });
    expect(out.paidThroughDate).toBeNull();
    expect(out.nextPaymentDate).toBeNull();
    // Not 2,653. Not 0-meaning-current either — null, meaning "we can't say".
    expect(out.daysDelinquent).toBeNull();
    expect(out.delinquencyStatus).toBeNull();
    expect(out.status).toBe("performing");
  });

  it("once the operator states paid-through, the same payment advances normally", () => {
    // The escape hatch has to work, or the rule above just bricks the note.
    const out = apply({
      facts: unseenFacts({ paidThroughDate: "2026-06-15" }),
      storedNextPaymentDate: "2026-07-15",
    });
    expect(out.paidThroughDate).toBe("2026-07-15");
    expect(out.nextPaymentDate).toBe("2026-08-15");
    expect(out.daysDelinquent).toBe(0);
    expect(out.delinquencyStatus).toBe("current");
  });

  it("a NULL result never destroys a paid-through that was already established", () => {
    // `advancePaidThrough` returns null both for "nothing satisfied" and for
    // "history unseen". Nulling the column on either would erase the one fact
    // the whole schedule rests on.
    const out = apply({
      paymentType: "extra_principal",
      principalCents: 50_000,
      interestCents: 0,
      facts: seenFacts({ paidThroughDate: "2026-06-15" }),
    });
    expect(out.paidThroughDate).toBe("2026-06-15");
  });
});

describe("periods satisfied", () => {
  it("a full scheduled payment satisfies exactly one period", () => {
    expect(
      periodsSatisfiedByPayment({
        paymentType: "regular",
        principalCents: 30_000,
        interestCents: 70_000,
        escrowCents: 0,
        scheduledPaymentAmountCents: SCHEDULED,
      }),
    ).toBe(1);
  });

  it("a partial satisfies NONE — recent money is not a satisfied period", () => {
    expect(
      periodsSatisfiedByPayment({
        paymentType: "partial",
        principalCents: 10_000,
        interestCents: 20_000,
        escrowCents: 0,
        scheduledPaymentAmountCents: SCHEDULED,
      }),
    ).toBe(0);
  });

  it("three periods of money satisfies three", () => {
    expect(
      periodsSatisfiedByPayment({
        paymentType: "regular",
        principalCents: 100_000,
        interestCents: 200_000,
        escrowCents: 0,
        scheduledPaymentAmountCents: SCHEDULED,
      }),
    ).toBe(3);
  });

  it("late fees and unapplied DEPOSITS do not service the loan", () => {
    // Money parked in unapplied has not been applied to a period, so it must
    // not advance the clock — that is the difference between "the borrower
    // sent money" and "the borrower is current".
    expect(
      periodsSatisfiedByPayment({
        paymentType: "regular",
        principalCents: 0,
        interestCents: 0,
        escrowCents: 0,
        scheduledPaymentAmountCents: SCHEDULED,
      }),
    ).toBe(0);
  });

  it("credits ONE period when no scheduled amount is on file", () => {
    // `payment_amount_cents` is NOT NULL, so this branch is defensive. When it
    // is hit we can see money serviced the loan but not how many periods it
    // covers, and one period is the reading that errs toward the borrower — in
    // a system whose output is a delinquency badge, that is the right
    // direction to be wrong in. Pinned so a future edit does not "tidy" it to
    // zero and quietly freeze such a note in permanent arrears.
    expect(
      periodsSatisfiedByPayment({
        paymentType: "regular",
        principalCents: 30_000,
        interestCents: 70_000,
        escrowCents: 0,
        scheduledPaymentAmountCents: null,
      }),
    ).toBe(1);
  });
});

describe("catching up, and the reperforming counters the schema already promised", () => {
  it("three periods of arrears advance paid-through by three, not one", () => {
    const out = apply({
      principalCents: 100_000,
      interestCents: 200_000,
      facts: seenFacts({ paidThroughDate: "2026-03-15" }),
      storedNextPaymentDate: "2026-04-15",
    });
    expect(out.periodsPaid).toBe(3);
    expect(out.paidThroughDate).toBe("2026-06-15");
  });

  it("a catch-up increments the on-time streak by ONE, not by periods paid", () => {
    // The streak counts payment EVENTS the borrower made on time. Awarding
    // three months of good behaviour for one catch-up cheque would walk a
    // reperforming note over its threshold on a single transaction.
    const out = apply({
      principalCents: 100_000,
      interestCents: 200_000,
      consecutiveOnTimePayments: 4,
      facts: seenFacts({ paidThroughDate: "2026-03-15" }),
      storedNextPaymentDate: "2026-04-15",
    });
    expect(out.consecutiveOnTimePayments).toBeLessThanOrEqual(5);
  });

  it("a late payment resets the streak to zero", () => {
    const out = apply({
      paymentDate: "2026-08-20", // well past 2026-07-15 + 10 days grace
      consecutiveOnTimePayments: 7,
      storedNextPaymentDate: "2026-07-15",
    });
    expect(out.consecutiveOnTimePayments).toBe(0);
    expect(out.onTime).toBe(false);
  });

  it("a payment inside grace is on time", () => {
    const out = apply({ paymentDate: "2026-07-22", storedNextPaymentDate: "2026-07-15" });
    expect(out.onTime).toBe(true);
    expect(out.consecutiveOnTimePayments).toBe(1);
  });

  it("crossing the threshold reports the transition exactly once", () => {
    const at = apply({
      consecutiveOnTimePayments: REPERFORMING_DEFAULT_THRESHOLD - 1,
      paymentDate: "2026-07-14",
    });
    expect(at.reperformingThresholdMet).toBe(true);
    expect(at.reperformingThresholdJustMet).toBe(true);

    const after = apply({
      consecutiveOnTimePayments: REPERFORMING_DEFAULT_THRESHOLD + 3,
      reperformingThresholdMet: true,
      paymentDate: "2026-07-14",
    });
    expect(after.reperformingThresholdMet).toBe(true);
    expect(after.reperformingThresholdJustMet).toBe(false);
  });

  it("extra_principal is neutral — a curtailment is not a missed payment", () => {
    const out = apply({
      paymentType: "extra_principal",
      principalCents: 50_000,
      interestCents: 0,
      consecutiveOnTimePayments: 6,
    });
    expect(out.onTime).toBeNull();
    expect(out.consecutiveOnTimePayments).toBe(6);
  });

  it("no due date on file means on-time is UNKNOWN, never false", () => {
    const out = apply({ storedNextPaymentDate: null, facts: seenFacts({ paidThroughDate: null }) });
    expect(out.onTime).toBeNull();
  });
});

describe("payoff is terminal", () => {
  it("clears the schedule and leaves the paid_off write to the caller", () => {
    const out = apply({
      paymentType: "payoff",
      newCurrentBalanceCents: 0,
      principalCents: 5_000_000,
    });
    expect(out.paidThroughDate).toBe(seenFacts().maturityDate);
    expect(out.nextPaymentDate).toBeNull();
    expect(out.daysDelinquent).toBe(0);
    expect(out.delinquencyStatus).toBe("current");
    // The route's own payoff branch owns that write; this must not race it.
    expect(out.status).toBe("performing");
  });

  it("never moves a terminal note back into the ageable band", () => {
    for (const status of ["paid_off", "sold"]) {
      const out = apply({ status, facts: seenFacts({ paidThroughDate: "2026-01-15" }) });
      expect(out.status).toBe(status);
    }
  });
});

describe("daysLate on the wire measures the period, not the month", () => {
  it("a catch-up on an old period reports the REAL lateness", () => {
    // The old implementation measured against the due day in the PAYMENT'S own
    // month, so a March payment made in July read as a few days late — and the
    // arrears it cleared were invisible to every workflow condition.
    expect(daysLateForNotePayment("2026-07-20", "2026-03-15")).toBe(127);
  });

  it("early or on-the-day is 0, never negative", () => {
    expect(daysLateForNotePayment("2026-07-10", "2026-07-15")).toBe(0);
    expect(daysLateForNotePayment("2026-07-15", "2026-07-15")).toBe(0);
  });

  it("no due date publishes an absence, not a number", () => {
    expect(daysLateForNotePayment("2026-07-20", null)).toBeNull();
    expect(daysLateForNotePayment("2026-07-20", undefined)).toBeNull();
    expect(daysLateForNotePayment("not-a-date", "2026-07-15")).toBeNull();
  });
});
