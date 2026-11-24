/**
 * N-DEF-1 — payoff accrued from ORIGINATION for a tape-imported note.
 *
 * A tape import carries no payment ledger, so `resolvePayoffAccrualStart`
 * fell straight to the 2015 origination date and billed 4,285 days
 * ($168,321 on an $84,250 balance) although the tape states everything up to
 * its Paid Thru date as settled. The accrual start is now:
 *   ledger interest posting  >  note.paid_through_date  >  origination.
 *
 * These tests drive the REAL `computeAcquiredNotePayoff` (the one engine both
 * GET :id/payoff and POST :id/payoff/quotes call) with a scripted select
 * chain, and assert exact day and cent figures.
 */
import { describe, it, expect } from "vitest";

import { computeAcquiredNotePayoff } from "../../server/routes-notes";
import { resolvePayoffAccrualStart } from "../../server/services/notePaymentMath";

const NOTE = {
  id: "11111111-1111-1111-1111-111111111111",
  noteNumber: "TAPE-A",
  payerName: "SYNTHETIC Borrower A",
  status: "performing",
  currentBalanceCents: 8_425_000,
  unappliedBalanceCents: 0,
  interestRateBps: 850,
  originationDate: "2015-03-01",
};

/** select() chain answering, in call order: note, last-interest rows, late-fee sum. */
function scriptedDb(note: Record<string, unknown>, ledger: Array<Record<string, unknown>>) {
  const answers = [[note], ledger, [{ sum: 0 }]];
  let i = 0;
  return {
    select() {
      const rows = answers[i++];
      const chain: any = {
        from: () => chain,
        where: () => chain,
        orderBy: () => chain,
        limit: () => chain,
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
          Promise.resolve(rows).then(res, rej),
      };
      return chain;
    },
  } as any;
}

const PAYOFF_DATE = new Date("2026-11-23T00:00:00.000Z");
// 8,425,000 × 850bps × 22d / (10,000 × 365) = 43,163.70… → 43,164
const ACCRUED_22D = 43_164;
const iso = (d: Date) => d.toISOString().slice(0, 10);

describe("payoff accrual start — N-DEF-1", () => {
  it("tape-imported note (paid-through set, NO ledger) accrues from paid-through, not origination", async () => {
    const r = await computeAcquiredNotePayoff(
      scriptedDb({ ...NOTE, paidThroughDate: "2026-11-01" }, []),
      1,
      NOTE.id,
      PAYOFF_DATE,
    );
    expect(r).not.toBeNull();
    expect(iso(r!.input.accrualStartDate)).toBe("2026-11-01");
    expect(r!.quote.daysAccrued).toBe(22);
    expect(r!.quote.accruedInterestCents).toBe(ACCRUED_22D);
    expect(r!.quote.totalPayoffCents).toBe(8_425_000 + ACCRUED_22D);
  });

  it("a note with ledger interest postings still accrues from the ledger date, even if paid-through is set", async () => {
    const r = await computeAcquiredNotePayoff(
      scriptedDb({ ...NOTE, paidThroughDate: "2026-12-01" }, [
        { paymentDate: "2026-11-13", interestCents: 59_680 },
      ]),
      1,
      NOTE.id,
      PAYOFF_DATE,
    );
    expect(iso(r!.input.accrualStartDate)).toBe("2026-11-13");
    expect(r!.quote.daysAccrued).toBe(10);
    // 8,425,000 × 850 × 10 / 3,650,000 = 19,619.86… → 19,620
    expect(r!.quote.accruedInterestCents).toBe(19_620);
  });

  it("no ledger and no paid-through falls back to origination (honest fallback, nothing invented)", async () => {
    const r = await computeAcquiredNotePayoff(
      scriptedDb({ ...NOTE, paidThroughDate: null }, []),
      1,
      NOTE.id,
      PAYOFF_DATE,
    );
    expect(iso(r!.input.accrualStartDate)).toBe("2015-03-01");
  });

  it("resolver precedence: ledger > paid-through > origination; paid-through is optional", () => {
    expect(iso(resolvePayoffAccrualStart([], "2015-03-01", "2026-11-01"))).toBe("2026-11-01");
    expect(iso(resolvePayoffAccrualStart([], "2015-03-01", null))).toBe("2015-03-01");
    expect(iso(resolvePayoffAccrualStart([], "2015-03-01"))).toBe("2015-03-01");
    expect(
      iso(resolvePayoffAccrualStart([{ paymentDate: "2026-11-13", interestCents: 5 }], "2015-03-01", "2026-11-01")),
    ).toBe("2026-11-13");
    // A zero-interest posting settles nothing, so paid-through still governs.
    expect(
      iso(resolvePayoffAccrualStart([{ paymentDate: "2026-11-13", interestCents: 0 }], "2015-03-01", "2026-11-01")),
    ).toBe("2026-11-01");
  });
});
