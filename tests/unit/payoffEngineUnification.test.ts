/**
 * Wave C "Money moves" (agent C3) — ONE payoff engine.
 *
 * Before this wave four code paths computed a payoff four different ways:
 *
 *   1. notePaymentMath.computePayoffCents         — ledger-derived, /365, floor days
 *   2. routes-notes GET /api/notes/:id/payoff     — float per-diem, days ROUNDED
 *   3. routes-borrower GET /api/borrower/payoff-quote — no ledger at all: it
 *      guessed the last payment date as `nextPaymentDate − 30 days` and did the
 *      arithmetic in floating-point dollars via .toFixed(2)
 *   4. agent-skills "calculate payoff" skill      — accrual base = nextPaymentDate,
 *      plus an invented 2–3% "early payoff discount"
 *
 * A payoff quote that disagrees with the ledger by a cent is a legal problem,
 * not a rounding nit — a payoff statement is a representation the holder is
 * bound by. These tests pin the unified engine:
 *
 *   (1) every entry point produces the SAME number, to the cent, for the same
 *       economics — including across the cents/decimal note-book boundary;
 *   (2) the day-count convention is actual/365 fixed, half-open, FLOORED;
 *   (3) no floating-point drift, including at magnitudes where float loses
 *       integer precision entirely;
 *   (4) the decimal↔cents boundary conversions are exact (parseFloat is not).
 */
import { describe, it, expect } from "vitest";

import {
  computePayoffQuote,
  computePayoffCents,
  resolvePayoffAccrualStart,
  payoffInputsFromServicedNote,
  decimalDollarsToCents,
  decimalStringToScaledInt,
  percentStringToBps,
  wholeDaysBetweenUtc,
  splitPaymentCents,
  parseIsoDateUtc,
  PAYOFF_DAY_COUNT_CONVENTION,
} from "../../server/services/notePaymentMath";
import { calculateNotePayoff } from "../../server/services/financialOSService";

// ── Reference arithmetic, computed independently of the engine ──────────────
// Exact rational half-up in BigInt. If the engine and this disagree, one of
// them is wrong on purpose-built ground truth rather than on a re-run of the
// same code.
function referenceAccruedCents(
  balanceCents: number,
  annualRateBps: number,
  days: number,
): number {
  const num = BigInt(balanceCents) * BigInt(Math.round(annualRateBps * 100)) * BigInt(days);
  const den = 10_000n * 100n * 365n;
  return Number((2n * num + den) / (2n * den));
}

const D = (iso: string) => parseIsoDateUtc(iso);

// ---------------------------------------------------------------------------
// (1) A synthetic MULTI-PAYMENT note produces one identical payoff from every
//     entry point.
//
// $50,000.00 / 9.90% / 120 months. Ledger history, in order:
//   6 scheduled P&I payments,
//   a $500.00 principal-only curtailment (settles no interest),
//   a $200.00 partial (held unapplied — reduces neither principal nor
//     interest, and must NOT reset the accrual clock),
//   1 more scheduled P&I payment on 2026-08-03,
//   payoff requested 2026-08-15.
// ---------------------------------------------------------------------------

interface LedgerRow {
  paymentDate: string;
  principalCents: number;
  interestCents: number;
  unappliedCents: number;
}

function buildMultiPaymentFixture() {
  const annualRateBps = 990;
  let balanceCents = 50_000_00;
  const ledger: LedgerRow[] = [];

  const scheduled = (date: string) => {
    // $525.00/mo scheduled P&I, split in integer cents by the same helper the
    // production posting path uses.
    const split = splitPaymentCents({
      paymentAmountCents: 525_00,
      currentBalanceCents: balanceCents,
      annualRateBps,
    });
    balanceCents -= split.principalCents;
    ledger.push({
      paymentDate: date,
      principalCents: split.principalCents,
      interestCents: split.interestCents,
      unappliedCents: 0,
    });
  };

  for (const d of ["2026-01-03", "2026-02-03", "2026-03-03", "2026-04-03", "2026-05-03", "2026-06-03"]) {
    scheduled(d);
  }

  // Principal-only curtailment: no interest component.
  balanceCents -= 500_00;
  ledger.push({
    paymentDate: "2026-06-20",
    principalCents: 500_00,
    interestCents: 0,
    unappliedCents: 0,
  });

  // Partial held as unapplied: touches neither principal nor interest.
  ledger.push({
    paymentDate: "2026-07-14",
    principalCents: 0,
    interestCents: 0,
    unappliedCents: 200_00,
  });

  scheduled("2026-08-03");

  return { annualRateBps, balanceCents, unappliedCents: 200_00, ledger };
}

describe("Wave C — one payoff engine, identical from every entry point", () => {
  const fixture = buildMultiPaymentFixture();
  const payoffDate = D("2026-08-15");

  it("derives the accrual start from the ledger — the last posting that SETTLED INTEREST", () => {
    const accrualStart = resolvePayoffAccrualStart(fixture.ledger, "2025-12-03");
    // Not the curtailment (2026-06-20, no interest), not the unapplied
    // partial (2026-07-14, no interest) — the 2026-08-03 P&I payment.
    expect(accrualStart.toISOString().slice(0, 10)).toBe("2026-08-03");
  });

  it("falls back to origination when nothing interest-bearing has posted", () => {
    const start = resolvePayoffAccrualStart(
      [
        { paymentDate: "2026-06-20", interestCents: 0 },
        { paymentDate: "2026-07-14", interestCents: 0 },
        // An NSF reversal carries NEGATIVE interest: it settles nothing.
        { paymentDate: "2026-07-20", interestCents: -12_34 },
      ],
      "2025-12-03",
    );
    expect(start.toISOString().slice(0, 10)).toBe("2025-12-03");
  });

  it("engine, legacy helper, and the DECIMAL note book all agree TO THE CENT", () => {
    const accrualStart = resolvePayoffAccrualStart(fixture.ledger, "2025-12-03");
    const days = wholeDaysBetweenUtc(accrualStart, payoffDate); // 2026-08-03 → 2026-08-15
    expect(days).toBe(12);

    // Ground truth, computed independently in exact BigInt arithmetic.
    const expectedAccrued = referenceAccruedCents(fixture.balanceCents, fixture.annualRateBps, days);
    const expectedTotal = fixture.balanceCents + expectedAccrued;

    // ── Entry point A: the engine itself.
    const quote = computePayoffQuote({
      principalBalanceCents: fixture.balanceCents,
      annualRateBps: fixture.annualRateBps,
      accrualStartDate: accrualStart,
      payoffDate,
    });
    expect(quote.daysAccrued).toBe(12);
    expect(quote.accruedInterestCents).toBe(expectedAccrued);
    expect(quote.totalPayoffCents).toBe(expectedTotal);
    expect(quote.dayCountConvention).toBe(PAYOFF_DAY_COUNT_CONVENTION);

    // ── Entry point B: the legacy live-ledger helper (now a delegation).
    expect(
      computePayoffCents({
        currentBalanceCents: fixture.balanceCents,
        annualRateBps: fixture.annualRateBps,
        lastPostingDate: accrualStart,
        payoffDate,
      }),
    ).toBe(expectedTotal);

    // ── Entry point C: the DECIMAL servicing book (`notes` + `payments`),
    // which stores dollars as numeric strings and the rate as a percent
    // string. Same economics expressed in the other representation must
    // produce the same cents — this is the boundary the borrower-portal
    // payoff quote crosses.
    const decimalInput = payoffInputsFromServicedNote({
      note: {
        currentBalance: (fixture.balanceCents / 100).toFixed(2),
        interestRate: "9.9",
        startDate: "2025-12-03",
      },
      ledgerRows: fixture.ledger.map((r) => ({
        paymentDate: r.paymentDate,
        interestAmount: (r.interestCents / 100).toFixed(2),
      })),
      payoffDate,
    });
    expect(decimalInput.principalBalanceCents).toBe(fixture.balanceCents);
    expect(decimalInput.annualRateBps).toBe(990);
    expect(decimalInput.accrualStartDate.toISOString().slice(0, 10)).toBe("2026-08-03");
    expect(computePayoffQuote(decimalInput).totalPayoffCents).toBe(expectedTotal);

    // ── Entry point D: financialOSService.calculateNotePayoff, the dollars
    // API used by POST /financial/note-payoff.
    const os = calculateNotePayoff({
      currentBalanceCents: fixture.balanceCents,
      annualInterestRate: fixture.annualRateBps / 10_000,
      lastPaymentDate: accrualStart,
      payoffDate,
    });
    expect(Math.round(os.totalPayoff * 100)).toBe(expectedTotal);
  });

  it("nets unapplied funds the borrower already sent against the payoff", () => {
    const accrualStart = resolvePayoffAccrualStart(fixture.ledger, "2025-12-03");
    const withCredit = computePayoffQuote({
      principalBalanceCents: fixture.balanceCents,
      annualRateBps: fixture.annualRateBps,
      accrualStartDate: accrualStart,
      payoffDate,
      unappliedCreditCents: fixture.unappliedCents,
    });
    const without = computePayoffQuote({
      principalBalanceCents: fixture.balanceCents,
      annualRateBps: fixture.annualRateBps,
      accrualStartDate: accrualStart,
      payoffDate,
    });
    expect(without.totalPayoffCents - withCredit.totalPayoffCents).toBe(200_00);
    // A credit larger than the debt floors at zero — never a negative payoff.
    expect(
      computePayoffQuote({
        principalBalanceCents: 1_000_00,
        annualRateBps: 990,
        accrualStartDate: D("2026-08-03"),
        payoffDate,
        unappliedCreditCents: 5_000_00,
      }).totalPayoffCents,
    ).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// (2) Day-count convention: actual/365 fixed, half-open, FLOORED.
// ---------------------------------------------------------------------------

describe("Wave C — day-count convention (actual/365 fixed, floored)", () => {
  const base = {
    principalBalanceCents: 100_000_00,
    annualRateBps: 1_000, // 10%
  };

  it("accrues 0 days when the payoff lands on the accrual start date", () => {
    const q = computePayoffQuote({
      ...base,
      accrualStartDate: D("2026-08-03"),
      payoffDate: D("2026-08-03"),
    });
    expect(q.daysAccrued).toBe(0);
    expect(q.accruedInterestCents).toBe(0);
    expect(q.totalPayoffCents).toBe(base.principalBalanceCents);
  });

  it("FLOORS partial days instead of rounding them up (the old route over-charged)", () => {
    // 12 hours after the accrual start: zero whole days elapsed. The
    // pre-Wave-C GET :id/payoff used Math.round on the ms difference, which
    // billed a whole extra day of interest for a same-afternoon payoff.
    const halfDay = new Date(D("2026-08-03").getTime() + 12 * 60 * 60 * 1000);
    expect(wholeDaysBetweenUtc(D("2026-08-03"), halfDay)).toBe(0);
    expect(Math.round((halfDay.getTime() - D("2026-08-03").getTime()) / 86_400_000)).toBe(1); // the old behaviour
    expect(
      computePayoffQuote({ ...base, accrualStartDate: D("2026-08-03"), payoffDate: halfDay })
        .accruedInterestCents,
    ).toBe(0);
  });

  it("never accrues negative days for a back-dated payoff", () => {
    const q = computePayoffQuote({
      ...base,
      accrualStartDate: D("2026-08-03"),
      payoffDate: D("2026-07-03"),
    });
    expect(q.daysAccrued).toBe(0);
    expect(q.accruedInterestCents).toBe(0);
  });

  it("uses 365 days in a LEAP year too (365 'fixed'), matching every prior AcreOS path", () => {
    // 2028 is a leap year. A full calendar year of accrual is 366 actual days
    // at a /365 daily rate — the convention does not switch to /366.
    const q = computePayoffQuote({
      ...base,
      accrualStartDate: D("2028-01-01"),
      payoffDate: D("2029-01-01"),
    });
    expect(q.daysAccrued).toBe(366);
    expect(q.accruedInterestCents).toBe(referenceAccruedCents(base.principalBalanceCents, 1_000, 366));
  });

  it("rounds the TOTAL once — per-diem × days is a display approximation, not the answer", () => {
    const q = computePayoffQuote({
      principalBalanceCents: 33_333_33,
      annualRateBps: 777,
      accrualStartDate: D("2026-01-01"),
      payoffDate: D("2026-04-11"), // 100 days
    });
    expect(q.daysAccrued).toBe(100);
    expect(q.accruedInterestCents).toBe(referenceAccruedCents(33_333_33, 777, 100));
    // Rounding per-day then multiplying drifts; the engine does not do that.
    expect(q.perDiemInterestCents * q.daysAccrued).not.toBe(q.accruedInterestCents);
  });
});

// ---------------------------------------------------------------------------
// (3) No floating-point drift.
// ---------------------------------------------------------------------------

describe("Wave C — no floating-point drift on the money path", () => {
  it("stays exact over a 360-payment amortization, at every step", () => {
    const annualRateBps = 725; // 7.25%
    let balanceCents = 425_000_00; // $425,000
    let lastPosting = D("2026-01-01");
    const drifts: number[] = [];

    for (let n = 0; n < 360; n++) {
      const split = splitPaymentCents({
        paymentAmountCents: 2_899_00,
        currentBalanceCents: balanceCents,
        annualRateBps,
      });
      balanceCents -= split.principalCents;
      // Post on the 1st of each following month.
      const next = new Date(lastPosting);
      next.setUTCMonth(next.getUTCMonth() + 1);
      lastPosting = next;

      // Payoff quoted 17 days after each posting.
      const payoffDate = new Date(lastPosting.getTime() + 17 * 86_400_000);
      const quote = computePayoffQuote({
        principalBalanceCents: balanceCents,
        annualRateBps,
        accrualStartDate: lastPosting,
        payoffDate,
      });
      expect(quote.daysAccrued).toBe(17);
      drifts.push(
        quote.accruedInterestCents - referenceAccruedCents(balanceCents, annualRateBps, 17),
      );
      if (balanceCents === 0) break;
    }

    // Not "within a few cents" — exactly zero, on every one of the payments.
    expect(drifts.every((d) => d === 0)).toBe(true);
    expect(drifts.length).toBeGreaterThan(300);
  });

  it("is exact at magnitudes where IEEE-754 loses integer precision entirely", () => {
    // $80,000,000 balance, 12%, 10 years of accrual. The intermediate product
    // balance × rate × days exceeds 2^53, so a float multiply would silently
    // land on the wrong integer.
    const balanceCents = 8_000_000_000; // $80,000,000.00
    const annualRateBps = 1_200;
    const days = 3_653;

    const q = computePayoffQuote({
      principalBalanceCents: balanceCents,
      annualRateBps,
      accrualStartDate: D("2016-01-01"),
      payoffDate: D("2026-01-01"),
    });
    expect(q.daysAccrued).toBe(days);
    expect(q.accruedInterestCents).toBe(referenceAccruedCents(balanceCents, annualRateBps, days));

    // Demonstrate that the naive product really is past the exact-integer
    // range — this is the arithmetic the engine deliberately does not do.
    const naiveProduct = balanceCents * (annualRateBps * 100) * days;
    expect(naiveProduct).toBeGreaterThan(Number.MAX_SAFE_INTEGER);
  });

  it("preserves a sub-basis-point rate instead of rounding it to whole bps", () => {
    // 9.875% = 987.5 bps. Rounding to 988 bps moves a real quote.
    const exact = computePayoffQuote({
      principalBalanceCents: 250_000_00,
      annualRateBps: 987.5,
      accrualStartDate: D("2026-01-01"),
      payoffDate: D("2026-07-01"),
    });
    const rounded = computePayoffQuote({
      principalBalanceCents: 250_000_00,
      annualRateBps: 988,
      accrualStartDate: D("2026-01-01"),
      payoffDate: D("2026-07-01"),
    });
    expect(exact.accruedInterestCents).toBe(
      referenceAccruedCents(250_000_00, 987.5, exact.daysAccrued),
    );
    expect(exact.accruedInterestCents).not.toBe(rounded.accruedInterestCents);
  });

  it("rejects non-integer or negative money instead of silently coercing it", () => {
    expect(() =>
      computePayoffQuote({
        principalBalanceCents: 1_000.5,
        annualRateBps: 990,
        accrualStartDate: D("2026-01-01"),
        payoffDate: D("2026-02-01"),
      }),
    ).toThrow(/non-negative integer/);
    expect(() =>
      computePayoffQuote({
        principalBalanceCents: -1,
        annualRateBps: 990,
        accrualStartDate: D("2026-01-01"),
        payoffDate: D("2026-02-01"),
      }),
    ).toThrow(/non-negative integer/);
    expect(() =>
      computePayoffQuote({
        principalBalanceCents: 1_000,
        annualRateBps: 990,
        accrualStartDate: D("2026-01-01"),
        payoffDate: D("2026-02-01"),
        unappliedCreditCents: -5,
      }),
    ).toThrow(/unappliedCreditCents/);
  });
});

// ---------------------------------------------------------------------------
// (4) The cents ↔ decimal boundary.
// ---------------------------------------------------------------------------

describe("Wave C — the cents↔decimal boundary is exact", () => {
  it("converts decimal dollars to cents without going through a float", () => {
    expect(decimalDollarsToCents("48250.00")).toBe(4_825_000);
    expect(decimalDollarsToCents("0.01")).toBe(1);
    expect(decimalDollarsToCents(null)).toBe(0);
    expect(decimalDollarsToCents("")).toBe(0);
    expect(decimalDollarsToCents("-12.34")).toBe(-1234);

    // The case parseFloat gets wrong: 0.145 dollars is 14.5 cents, which
    // rounds half-up to 15. parseFloat("0.145") * 100 is 14.499999999999998,
    // so the float path loses the cent.
    expect(Math.round(parseFloat("0.145") * 100)).toBe(14);
    expect(decimalDollarsToCents("0.145")).toBe(15);

    // Half-up on the guard digit, applied consistently.
    expect(decimalDollarsToCents("1.005")).toBe(101);
    expect(decimalDollarsToCents("1.004")).toBe(100);
    expect(decimalDollarsToCents("1.0049")).toBe(100);
  });

  it("stays exact for balances too large for float cent conversion", () => {
    expect(decimalStringToScaledInt("99999999999.99", 2)).toBe(9_999_999_999_999);
  });

  it("converts an annual percent string to (possibly fractional) bps exactly", () => {
    expect(percentStringToBps("9.9")).toBe(990);
    expect(percentStringToBps("9.875")).toBe(987.5);
    expect(percentStringToBps("12")).toBe(1_200);
    expect(percentStringToBps("0")).toBe(0);
    expect(percentStringToBps(null)).toBe(0);
  });

  it("derives the serviced-note accrual start from the LEDGER, not from nextPaymentDate − 30d", () => {
    // The heuristic the borrower portal used: nextPaymentDate (2026-09-01)
    // minus 30 days = 2026-08-02. The ledger says interest was settled
    // 2026-08-03. One day of interest on a real balance, on a legal document.
    const heuristic = new Date(D("2026-09-01").getTime() - 30 * 86_400_000);
    expect(heuristic.toISOString().slice(0, 10)).toBe("2026-08-02");

    const input = payoffInputsFromServicedNote({
      note: { currentBalance: "48250.00", interestRate: "9.9", startDate: "2025-12-03" },
      ledgerRows: [
        { paymentDate: "2026-07-03", interestAmount: "397.06" },
        { paymentDate: "2026-08-03", interestAmount: "398.06" },
      ],
      payoffDate: D("2026-08-15"),
    });
    expect(input.accrualStartDate.toISOString().slice(0, 10)).toBe("2026-08-03");

    const fromLedger = computePayoffQuote(input);
    const fromHeuristic = computePayoffQuote({ ...input, accrualStartDate: heuristic });
    expect(fromLedger.daysAccrued).toBe(12);
    expect(fromHeuristic.daysAccrued).toBe(13);
    expect(fromLedger.totalPayoffCents).not.toBe(fromHeuristic.totalPayoffCents);
  });
});
