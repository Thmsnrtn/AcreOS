/**
 * Note price ↔ yield (shared/notes/notePriceYield.ts) — autonomy gap N-4.
 *
 * Every expected number below is computed HERE from the closed-form annuity
 * formulas, never by calling the module under test:
 *
 *   monthly yield      y  = (1 + Y)^(1/12) − 1            (Y = annual target)
 *   annuity PV         PV = pmt · (1 − (1+y)^−n) / y
 *   balance after k    B_k = P(1+i)^k − pmt · ((1+i)^k − 1) / i      (i = rate/12)
 *   price              = PV(payments) + (balloon | B_n) / (1+y)^H
 *
 * Standard-table anchors: a 10% / 30-year note pays $87.757 per $10,000
 * ($877.57 on $100,000) and an 8% / 30-year note $733.76 on $100,000; a
 * note bought at par earns exactly its note rate compounded monthly,
 * (1 + 0.10/12)^12 − 1 = 10.4713%, and 12%/12 = 1% a month is 1.01^12 − 1 =
 * 12.6825%.
 */
import { describe, expect, it } from "vitest";
import {
  priceForTargetYield,
  yieldForPrice,
  scheduledCashFlows,
  pricingInputFromTapeRow,
  calendarMonthsBetween,
  MAX_REMAINING_TERM_MONTHS,
  type NoteCashFlowInput,
  type PriceForYieldResult,
  type YieldForPriceResult,
} from "@shared/notes/notePriceYield";

const monthly = (annual: number) => Math.pow(1 + annual, 1 / 12) - 1;
const annuityPv = (pmt: number, y: number, n: number) => (pmt * (1 - Math.pow(1 + y, -n))) / y;
const balanceAfter = (p: number, i: number, pmt: number, k: number) => p * Math.pow(1 + i, k) - (pmt * (Math.pow(1 + i, k) - 1)) / i;

const P = 10_000_000; // $100,000.00

const amortizing10: NoteCashFlowInput = { currentBalanceCents: P, noteRateBps: 1000, paymentAmountCents: 87_757, remainingTermMonths: 360 };

function expectOk<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  expect(r.ok).toBe(true);
  return r as Extract<T, { ok: true }>;
}

describe("priceForTargetYield — known amortization tables", () => {
  it("fully amortizing $100,000 / 10% / 360 mo at a 12% target", () => {
    const y = monthly(0.12);
    const expected = annuityPv(87_757, y, 360) + balanceAfter(P, 0.1 / 12, 87_757, 360) / Math.pow(1 + y, 360);
    const r = expectOk(priceForTargetYield(amortizing10, 1200));
    expect(Math.abs(r.priceCents - expected)).toBeLessThanOrEqual(1);
    // A 12% hurdle on a 10% note is a discount.
    expect(r.priceCents).toBeLessThan(P);
    expect(r.priceToBalance).toBeGreaterThan(0.8);
    expect(r.horizonMonths).toBe(360);
  });

  it("8% / 30-year note with a month-60 balloon at a 10% target", () => {
    const i = 0.08 / 12;
    const pmt = 73_376; // $733.76 — the 8%/30yr table value
    const balloon = Math.round(balanceAfter(P, i, pmt, 60));
    const y = monthly(0.1);
    const expected = annuityPv(pmt, y, 60) + balloon / Math.pow(1 + y, 60);
    const r = expectOk(
      priceForTargetYield({ currentBalanceCents: P, noteRateBps: 800, paymentAmountCents: pmt, remainingTermMonths: 360, balloon: { amountCents: balloon, month: 60 } }, 1000),
    );
    expect(Math.abs(r.priceCents - expected)).toBeLessThanOrEqual(1);
    expect(r.horizonMonths).toBe(60);
  });

  it("a balloon equal to the amortized balance prices the same as running the note to that month and paying it off", () => {
    const pmt = 73_376;
    const bal = balanceAfter(P, 0.08 / 12, pmt, 60);
    const withBalloon = expectOk(
      priceForTargetYield({ currentBalanceCents: P, noteRateBps: 800, paymentAmountCents: pmt, remainingTermMonths: 60, balloon: { amountCents: Math.round(bal), month: 60 } }, 1500),
    );
    const noBalloon = expectOk(priceForTargetYield({ currentBalanceCents: P, noteRateBps: 800, paymentAmountCents: pmt, remainingTermMonths: 60 }, 1500));
    expect(Math.abs(withBalloon.priceCents - noBalloon.priceCents)).toBeLessThanOrEqual(1);
  });

  it("interest-only note (payment == monthly interest): par at the note's own compounded yield", () => {
    // $1,000/mo interest on $100,000 at 12%, 24 months, whole balance at the end.
    const input: NoteCashFlowInput = { currentBalanceCents: P, noteRateBps: 1200, paymentAmountCents: 100_000, remainingTermMonths: 24 };
    const targetBps = (Math.pow(1.01, 12) - 1) * 10_000; // y = exactly 1% a month
    const r = expectOk(priceForTargetYield(input, targetBps));
    expect(Math.abs(r.priceCents - P)).toBeLessThanOrEqual(1);
    const y = 0.01;
    expect(Math.abs(r.priceCents - (annuityPv(100_000, y, 24) + P / Math.pow(1 + y, 24)))).toBeLessThanOrEqual(1);
  });

  it("interest-only + balloon at month 24 prices off the stated balloon", () => {
    const input: NoteCashFlowInput = { currentBalanceCents: P, noteRateBps: 1200, paymentAmountCents: 100_000, remainingTermMonths: 36, balloon: { amountCents: P, month: 24 } };
    const y = monthly(0.15);
    const expected = annuityPv(100_000, y, 24) + P / Math.pow(1 + y, 24);
    const r = expectOk(priceForTargetYield(input, 1500));
    expect(Math.abs(r.priceCents - expected)).toBeLessThanOrEqual(1);
    expect(r.horizonMonths).toBe(24);
  });

  it("payment below the monthly interest capitalizes: the grown balance is owed at the end", () => {
    // $500/mo against $1,000/mo of interest, 12 months.
    const input: NoteCashFlowInput = { currentBalanceCents: P, noteRateBps: 1200, paymentAmountCents: 50_000, remainingTermMonths: 12 };
    const residual = balanceAfter(P, 0.01, 50_000, 12);
    expect(residual).toBeGreaterThan(P); // negative amortization — balance grew
    const y = monthly(0.15);
    const expected = annuityPv(50_000, y, 12) + residual / Math.pow(1 + y, 12);
    const r = expectOk(priceForTargetYield(input, 1500));
    expect(Math.abs(r.priceCents - expected)).toBeLessThanOrEqual(1);
  });

  it("a stated balloon smaller than the schedule balance is used as stated", () => {
    const pmt = 73_376;
    const balloon = 5_000_000;
    const y = monthly(0.1);
    const expected = annuityPv(pmt, y, 60) + balloon / Math.pow(1 + y, 60);
    const r = expectOk(
      priceForTargetYield({ currentBalanceCents: P, noteRateBps: 800, paymentAmountCents: pmt, remainingTermMonths: 360, balloon: { amountCents: balloon, month: 60 } }, 1000),
    );
    expect(Math.abs(r.priceCents - expected)).toBeLessThanOrEqual(1);
  });

  it("zero-rate note: pure annuity of the payments", () => {
    const input: NoteCashFlowInput = { currentBalanceCents: 1_200_000, noteRateBps: 0, paymentAmountCents: 100_000, remainingTermMonths: 12 };
    const y = monthly(0.12);
    const r = expectOk(priceForTargetYield(input, 1200));
    expect(Math.abs(r.priceCents - annuityPv(100_000, y, 12))).toBeLessThanOrEqual(1);
  });

  it("a payment that exceeds what is owed pays the note off in one month and the stream stops", () => {
    const input: NoteCashFlowInput = { currentBalanceCents: 100_000, noteRateBps: 1200, paymentAmountCents: 500_000, remainingTermMonths: 12 };
    const sched = scheduledCashFlows(input);
    expect(sched.ok).toBe(true);
    if (!sched.ok) return;
    expect(sched.flowsCents[0]).toBeCloseTo(101_000, 6); // 100,000 × 1.01
    expect(sched.flowsCents.slice(1).every((f) => f === 0)).toBe(true);
    const y = monthly(0.12);
    const r = expectOk(priceForTargetYield(input, 1200));
    expect(Math.abs(r.priceCents - 101_000 / (1 + y))).toBeLessThanOrEqual(1);
  });
});

describe("yieldForPrice — known anchors", () => {
  it("fully amortizing note bought at par earns its note rate compounded monthly (10.4713%)", () => {
    const r = expectOk(yieldForPrice(amortizing10, P));
    expect(Math.abs(r.annualYield - (Math.pow(1 + 0.1 / 12, 12) - 1))).toBeLessThan(1e-5); // payment is rounded to the cent
  });

  it("interest-only note bought at par earns 1.01^12 − 1 = 12.6825%", () => {
    const input: NoteCashFlowInput = { currentBalanceCents: P, noteRateBps: 1200, paymentAmountCents: 100_000, remainingTermMonths: 24 };
    const r = expectOk(yieldForPrice(input, P));
    expect(Math.abs(r.annualYield - (Math.pow(1.01, 12) - 1))).toBeLessThan(1e-9);
    expect(Math.abs(r.monthlyYield - 0.01)).toBeLessThan(1e-10);
  });

  it("a discount raises the yield above the note rate, a premium lowers it", () => {
    const disc = expectOk(yieldForPrice(amortizing10, 8_000_000));
    const prem = expectOk(yieldForPrice(amortizing10, 11_000_000));
    expect(disc.annualYield).toBeGreaterThan(0.1047);
    expect(prem.annualYield).toBeLessThan(0.1047);
    expect(prem.annualYield).toBeGreaterThan(0);
  });

  it("a price above every dollar the note will pay is a negative yield, not a refusal", () => {
    const total = 360 * 87_757;
    const r = expectOk(yieldForPrice(amortizing10, total + 1_000_000));
    expect(r.annualYield).toBeLessThan(0);
  });
});

describe("round trip: price → yield returns the target", () => {
  const balloonCase: NoteCashFlowInput = {
    currentBalanceCents: P,
    noteRateBps: 800,
    paymentAmountCents: 73_376,
    remainingTermMonths: 360,
    balloon: { amountCents: Math.round(balanceAfter(P, 0.08 / 12, 73_376, 60)), month: 60 },
  };
  const interestOnly: NoteCashFlowInput = { currentBalanceCents: P, noteRateBps: 1200, paymentAmountCents: 100_000, remainingTermMonths: 24 };
  const negAm: NoteCashFlowInput = { currentBalanceCents: P, noteRateBps: 1200, paymentAmountCents: 50_000, remainingTermMonths: 12 };
  const cases: Array<[string, NoteCashFlowInput]> = [
    ["amortizing", amortizing10],
    ["balloon", balloonCase],
    ["interest-only", interestOnly],
    ["negative amortization", negAm],
  ];
  for (const [name, input] of cases) {
    for (const bps of [500, 800, 1200, 2500]) {
      it(`${name} @ ${bps} bps`, () => {
        const price = expectOk(priceForTargetYield(input, bps));
        const back = expectOk(yieldForPrice(input, price.priceCents));
        expect(Math.abs(back.annualYield - bps / 10_000)).toBeLessThan(1e-6);
      });
    }
  }
});

describe("refusals — never a made-up number", () => {
  const refused = (r: PriceForYieldResult | YieldForPriceResult, reason: string) => {
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe(reason);
  };

  it("target yield at or below zero, or not a number", () => {
    for (const bps of [0, -100, Number.NaN, Number.POSITIVE_INFINITY]) refused(priceForTargetYield(amortizing10, bps), "target_yield_invalid");
  });

  it("price zero, negative or not a number", () => {
    for (const p of [0, -5_000_000, Number.NaN]) refused(yieldForPrice(amortizing10, p), "price_invalid");
  });

  it("term 0, fractional, or beyond the ceiling", () => {
    for (const t of [0, -12, 12.5, MAX_REMAINING_TERM_MONTHS + 1]) {
      refused(priceForTargetYield({ ...amortizing10, remainingTermMonths: t }, 1200), "term_invalid");
      refused(yieldForPrice({ ...amortizing10, remainingTermMonths: t }, P), "term_invalid");
    }
  });

  it("payment zero or negative", () => {
    for (const pmt of [0, -100]) refused(priceForTargetYield({ ...amortizing10, paymentAmountCents: pmt }, 1200), "payment_invalid");
  });

  it("balance zero or negative; negative rate", () => {
    refused(priceForTargetYield({ ...amortizing10, currentBalanceCents: 0 }, 1200), "balance_invalid");
    refused(priceForTargetYield({ ...amortizing10, currentBalanceCents: -1 }, 1200), "balance_invalid");
    refused(priceForTargetYield({ ...amortizing10, noteRateBps: -1 }, 1200), "rate_invalid");
  });

  it("balloon larger than the balance still owed", () => {
    const input: NoteCashFlowInput = { ...amortizing10, balloon: { amountCents: 2 * P, month: 60 } };
    refused(priceForTargetYield(input, 1200), "balloon_exceeds_balance");
    refused(yieldForPrice(input, P), "balloon_exceeds_balance");
  });

  it("balloon amount at or below zero; month outside the remaining payments", () => {
    refused(priceForTargetYield({ ...amortizing10, balloon: { amountCents: 0, month: 60 } }, 1200), "balloon_invalid");
    refused(priceForTargetYield({ ...amortizing10, balloon: { amountCents: 1_000_000, month: 0 } }, 1200), "balloon_month_out_of_range");
    refused(priceForTargetYield({ ...amortizing10, balloon: { amountCents: 1_000_000, month: 361 } }, 1200), "balloon_month_out_of_range");
  });

  it("an IRR that cannot be bracketed is refused, not clamped", () => {
    refused(yieldForPrice(amortizing10, 1), "yield_not_found"); // one cent for $100k of paper: PV even at the bracket's top rate is ~8,700 cents, so no root exists in range
  });

  it("a price far above the flows yields a deeply negative — but real — rate", () => {
    // PV is continuous from ~infinity at the bracket floor, so a root exists:
    // refusing it would be the fabrication. The yield is honestly terrible.
    const r = expectOk(yieldForPrice(amortizing10, 1e15));
    expect(r.annualYield).toBeLessThan(-0.4);
    expect(r.annualYield).toBeGreaterThan(-1);
  });

  it("does not mutate its input", () => {
    const frozen = Object.freeze({ ...amortizing10, balloon: Object.freeze({ amountCents: 1_000_000, month: 60 }) });
    expect(() => priceForTargetYield(frozen, 1200)).not.toThrow();
    expect(() => yieldForPrice(frozen, P)).not.toThrow();
  });
});

describe("pricingInputFromTapeRow — uses only what the tape states", () => {
  const row = {
    currentBalanceCents: P,
    interestRateBps: 800,
    paymentAmountCents: 73_376,
    remainingTermMonths: 60 as number | null,
    maturityDate: "2031-11-15",
    balloonAmountCents: null as number | null,
    balloonDate: null as string | null,
  };

  it("calendarMonthsBetween is the calendar-month difference", () => {
    expect(calendarMonthsBetween("2026-11-01", "2031-11-15")).toBe(60);
    expect(calendarMonthsBetween("2026-11-30", "2026-12-01")).toBe(1);
    expect(calendarMonthsBetween("nope", "2026-12-01")).toBeNull();
  });

  it("stated remaining term is used as stated, no as-of needed", () => {
    const r = pricingInputFromTapeRow(row, null);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.input.remainingTermMonths).toBe(60);
      expect(r.input.balloon).toBeNull();
    }
  });

  it("no remaining term and no as-of date: not priced (a term is never assumed)", () => {
    expect(pricingInputFromTapeRow({ ...row, remainingTermMonths: null }, null).ok).toBe(false);
  });

  it("no remaining term, as-of date given: months to maturity", () => {
    const r = pricingInputFromTapeRow({ ...row, remainingTermMonths: null }, "2026-11-01");
    expect(r.ok && r.input.remainingTermMonths).toBe(60);
  });

  it("as-of at or after maturity: nothing left to price", () => {
    expect(pricingInputFromTapeRow({ ...row, remainingTermMonths: null }, "2031-11-20").ok).toBe(false);
  });

  it("balloon is anchored to maturity: 6 months before maturity of a 60-payment note is payment 54", () => {
    const r = pricingInputFromTapeRow({ ...row, balloonAmountCents: 5_000_000, balloonDate: "2031-05-01" }, null);
    expect(r.ok && r.input.balloon).toEqual({ amountCents: 5_000_000, month: 54 });
  });

  it("balloon amount with no balloon date: not priced", () => {
    expect(pricingInputFromTapeRow({ ...row, balloonAmountCents: 5_000_000 }, null).ok).toBe(false);
  });
});
