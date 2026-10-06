/**
 * DEFECT-0185 — the ONE installment-coverage rule every serviced-note posting
 * writer shares (W10.5). Pure, integer cents.
 *
 * A payment covers the installments that are due (at least the current one)
 * before a cent goes to late fees; only money beyond them pays fees owed
 * (§1026.36(c)(2): a fee never makes an installment short); the due date
 * advances by the installments FULLY covered — a partial advances nothing,
 * a lump that funds three advances three.
 */
import { describe, expect, it } from "vitest";
import {
  addMonthsUtc,
  allocateServicedPayment,
  countInstallmentsDue,
  nextDueDateAfterCoverage,
  resolveInstallmentSchedule,
} from "../../server/services/notes/installmentCoverage";
import { splitPaymentCents, splitPayoffCents } from "../../server/services/notePaymentMath";

const at = (s: string) => new Date(s);
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

describe("allocateServicedPayment — installments first, then fees, then principal", () => {
  it.each([
    // amount, scheduled, prior credit, due, owed → covered, toInstallments, fee
    [10_000, 10_000, 0, 1, 2_500, 1, 10_000, 0],
    [12_500, 10_000, 0, 1, 2_500, 1, 10_000, 2_500],
    [5_000, 10_000, 0, 1, 2_500, 0, 5_000, 0],
    [5_000, 10_000, 5_000, 1, 2_500, 1, 5_000, 0], // a second partial completes the installment
    [7_500, 10_000, 5_000, 1, 2_500, 1, 5_000, 2_500], // ...and its excess pays the fee
    [30_000, 10_000, 0, 3, 7_500, 3, 30_000, 0], // three due, exactly three paid: no fee taken from them
    [37_500, 10_000, 0, 3, 7_500, 3, 30_000, 7_500],
    [25_000, 10_000, 0, 4, 10_000, 2, 25_000, 0], // short lump: two whole installments
    [40_000, 10_000, 0, 1, 0, 1, 10_000, 0], // ahead of schedule: one installment, the rest principal
    [0, 10_000, 0, 2, 2_500, 0, 0, 0],
  ])("%i¢ vs %i¢ (prior %i¢, %i due, %i¢ owed)", (amountCents, scheduledCents, priorCreditCents, installmentsDue, outstandingFeeCents, covered, toInst, fee) => {
    const r = allocateServicedPayment({ amountCents, scheduledCents, priorCreditCents, installmentsDue, outstandingFeeCents });
    expect(r).toMatchObject({ installmentsCovered: covered, toInstallmentsCents: toInst, lateFeeCents: fee });
    expect(r.toInstallmentsCents + r.lateFeeCents + r.principalOnlyCents).toBe(amountCents);
  });

  it("a payoff on a note whose installments due exceed its payoff still reaches the fees owed (W10.5)", () => {
    // $300 balance + $1.50 interest = $301.50 payoff; four $100 installments due; $25 owed.
    const r = allocateServicedPayment({ amountCents: 32_650, scheduledCents: 10_000, priorCreditCents: 0, installmentsDue: 4, outstandingFeeCents: 2_500, payoffCents: 30_150 });
    expect(r).toEqual({ installmentsCovered: 4, toInstallmentsCents: 30_150, lateFeeCents: 2_500, principalOnlyCents: 0, measured: true });
    // Below the payoff the cap changes nothing: installments first, as before.
    expect(allocateServicedPayment({ amountCents: 25_000, scheduledCents: 10_000, priorCreditCents: 0, installmentsDue: 4, outstandingFeeCents: 2_500, payoffCents: 30_150 })).toMatchObject({
      installmentsCovered: 2,
      toInstallmentsCents: 25_000,
      lateFeeCents: 0,
    });
    // A payoff above every installment due is not capped below them.
    expect(allocateServicedPayment({ amountCents: 12_500, scheduledCents: 10_000, priorCreditCents: 0, installmentsDue: 1, outstandingFeeCents: 2_500, payoffCents: 500_000 })).toMatchObject({
      toInstallmentsCents: 10_000,
      lateFeeCents: 2_500,
    });
  });

  it("splitPayoffCents is exactly what splitPaymentCents applies before residue", () => {
    for (const [balance, bps] of [[30_000, 600], [1, 999], [12_345_678, 1_175], [0, 600], [99_999, 0]]) {
      const payoff = splitPayoffCents(balance, bps);
      expect(splitPaymentCents({ paymentAmountCents: payoff, currentBalanceCents: balance, annualRateBps: bps }).residueCents).toBe(0);
      expect(splitPaymentCents({ paymentAmountCents: payoff + 1, currentBalanceCents: balance, annualRateBps: bps }).residueCents).toBe(1);
    }
  });

  it("no scheduled amount to measure against: the pre-ledger rule (one installment, no fee)", () => {
    expect(allocateServicedPayment({ amountCents: 12_500, scheduledCents: null, priorCreditCents: 0, installmentsDue: 3, outstandingFeeCents: 2_500 })).toMatchObject({
      installmentsCovered: 1,
      lateFeeCents: 0,
    });
  });

  it("refuses non-integer cents rather than rounding money", () => {
    expect(() => allocateServicedPayment({ amountCents: 100.5, scheduledCents: 10_000, priorCreditCents: 0, installmentsDue: 1, outstandingFeeCents: 0 })).toThrow();
  });

  it("invariants hold over a deterministic sweep of inputs", () => {
    // A seeded LCG — the same 5,000 cases every run.
    let seed = 0x5eed;
    const rnd = (n: number) => {
      seed = (Math.imul(seed, 1_103_515_245) + 12_345) >>> 0;
      return seed % n;
    };
    for (let c = 0; c < 5_000; c++) {
      const S = 1 + rnd(50_000);
      const due = 1 + rnd(6);
      const prior = rnd(S); // a prior partial is always short of one installment
      const owed = rnd(4) * (1 + rnd(5_000));
      const amount = rnd(8 * S);
      const r = allocateServicedPayment({ amountCents: amount, scheduledCents: S, priorCreditCents: prior, installmentsDue: due, outstandingFeeCents: owed });
      const demand = due * S - prior;
      expect(Number.isInteger(r.lateFeeCents) && Number.isInteger(r.toInstallmentsCents)).toBe(true);
      expect(r.toInstallmentsCents + r.lateFeeCents + r.principalOnlyCents).toBe(amount);
      expect(r.toInstallmentsCents).toBe(Math.min(amount, demand));
      // A fee is paid only once every due installment is fully funded.
      if (r.lateFeeCents > 0) expect(r.toInstallmentsCents).toBe(demand);
      expect(r.lateFeeCents).toBeLessThanOrEqual(owed);
      // Covered = whole installments funded, never more than are due.
      expect(r.installmentsCovered).toBeLessThanOrEqual(due);
      expect(r.installmentsCovered * S).toBeLessThanOrEqual(prior + r.toInstallmentsCents);
      if (r.installmentsCovered < due) expect(prior + r.toInstallmentsCents).toBeLessThan((r.installmentsCovered + 1) * S);
    }
  });
});

describe("the schedule is the note's own: first payment date + term, by calendar month", () => {
  it("adds months in UTC, clamped to month end, always from the anchor (no drift)", () => {
    const first = at("2026-01-31T00:00:00Z");
    expect([0, 1, 2, 3, 13].map((i) => iso(addMonthsUtc(first, i)))).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2027-02-28"]);
  });

  it("resolves the current installment's index when the next date is on the schedule", () => {
    const r = resolveInstallmentSchedule({ firstPaymentDate: at("2026-01-31T00:00:00Z"), termMonths: 12, nextPaymentDate: at("2026-03-31T00:00:00Z") });
    expect(r).toMatchObject({ kind: "grid", currentIndex: 2, termMonths: 12 });
  });

  it.each([
    ["a date stepped off the schedule (31st → 28th)", { firstPaymentDate: at("2026-01-31T00:00:00Z"), termMonths: 12, nextPaymentDate: at("2026-03-28T00:00:00Z") }],
    ["no first payment date", { firstPaymentDate: null, termMonths: 12, nextPaymentDate: at("2026-03-01T00:00:00Z") }],
    ["no term", { firstPaymentDate: at("2026-01-01T00:00:00Z"), termMonths: null, nextPaymentDate: at("2026-03-01T00:00:00Z") }],
    ["a date before the first payment", { firstPaymentDate: at("2026-05-01T00:00:00Z"), termMonths: 12, nextPaymentDate: at("2026-03-01T00:00:00Z") }],
    ["a date past the term", { firstPaymentDate: at("2026-01-01T00:00:00Z"), termMonths: 2, nextPaymentDate: at("2026-03-01T00:00:00Z") }],
  ])("refuses to determine the schedule: %s", (_l, note) => {
    expect(resolveInstallmentSchedule(note as never).kind).toBe("undetermined");
  });

  it("counts installments due through a date, at least the current one, never past the term", () => {
    const note = { firstPaymentDate: at("2026-01-01T00:00:00Z"), termMonths: 4, nextPaymentDate: at("2026-02-01T00:00:00Z") };
    expect(countInstallmentsDue(note, at("2026-01-20T00:00:00Z"))).toBe(1);
    expect(countInstallmentsDue(note, at("2026-02-01T00:00:00Z"))).toBe(1);
    expect(countInstallmentsDue(note, at("2026-03-15T00:00:00Z"))).toBe(2);
    expect(countInstallmentsDue(note, at("2027-01-01T00:00:00Z"))).toBe(3); // Feb, Mar, Apr — the term ends
  });

  it("advances the due date by the installments covered, on the note's schedule", () => {
    const note = { firstPaymentDate: at("2026-01-31T00:00:00Z"), termMonths: 12, nextPaymentDate: at("2026-02-28T00:00:00Z") };
    const now = at("2026-05-01T00:00:00Z");
    expect(iso(nextDueDateAfterCoverage(note, 0, now))).toBe("2026-02-28");
    expect(iso(nextDueDateAfterCoverage(note, 1, now))).toBe("2026-03-31"); // not the 28th
    expect(iso(nextDueDateAfterCoverage(note, 3, now))).toBe("2026-05-31");
    // Off the schedule: month steps from the stored date, as before.
    const drifted = { ...note, nextPaymentDate: at("2026-03-28T00:00:00Z") };
    expect(iso(nextDueDateAfterCoverage(drifted, 2, now))).toBe("2026-05-28");
  });
});
