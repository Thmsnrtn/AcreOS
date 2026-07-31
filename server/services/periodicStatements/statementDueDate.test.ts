/**
 * Structural build B — the due date on a Reg-Z §1026.41 periodic statement.
 *
 * THE DEFECT THIS PINS SHUT
 * -------------------------
 * The generator used to compute ONE due date for the whole org, per cycle:
 *
 *     // Next month's due date = first of next month (we'll override per-loan
 *     // when the note has a non-default payment_due_day, below).
 *     const nextDueDate = new Date(Date.UTC(y, m + 1, 1));
 *
 * The promised override was never written — `paymentDueDay` was not read
 * anywhere in the file. So every periodic statement AcreOS produced, on BOTH
 * books, told the borrower their payment was due on the 1st, whatever their
 * note said. §1026.41(b)(2)'s delivery deadline was computed off the same wrong
 * date, so the timing obligation moved with the calendar rather than with the
 * actual obligation.
 *
 * The fix is per-loan resolution plus a REFUSAL: a loan whose schedule cannot
 * be resolved produces no statement and a named skip, rather than a statement
 * carrying a comfortable, invented date. That is the standing rule in this
 * repo — a wrong number on a legally-required disclosure is worse than a
 * disclosure that was not generated, because the operator can act on an
 * absence and cannot act on a plausible lie.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  resolveNoteDueDate,
  resolveAcquiredNoteDueDate,
  deliveryDeadlineFor,
  buildAcquiredDelinquencyInfo,
} from "./index";

const SRC = fs.readFileSync(path.resolve(__dirname, "index.ts"), "utf-8");

const ASOF = new Date(Date.UTC(2026, 6, 30)); // 2026-07-30
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** An acquired note originated and acquired in the same month, so the schedule
 *  module produces a date instead of refusing on unseen servicing history. */
function acquired(over: Record<string, unknown> = {}) {
  return {
    nextPaymentDate: null,
    paymentDueDay: 15,
    firstPaymentDate: "2025-02-15",
    originationDate: "2025-01-10",
    maturityDate: "2035-01-15",
    paidThroughDate: "2026-07-15",
    acquisitionDate: "2025-01-20",
    ...over,
  } as Parameters<typeof resolveAcquiredNoteDueDate>[0];
}

describe("the acquired book gets ITS OWN due date, never the calendar's", () => {
  it("a note due on the 15th resolves to the 15th — not the 1st", () => {
    const r = resolveAcquiredNoteDueDate(acquired(), ASOF);
    expect(r).not.toBeNull();
    expect(iso(r!.dueDate).slice(8)).toBe("15");
    expect(iso(r!.dueDate)).toBe("2026-08-15");
    expect(r!.source).toBe("derived_from_schedule");
  });

  it("the stored server-side date wins over derivation", () => {
    const r = resolveAcquiredNoteDueDate(
      acquired({ nextPaymentDate: "2026-09-15" }),
      ASOF,
    );
    expect(iso(r!.dueDate)).toBe("2026-09-15");
    expect(r!.source).toBe("stored_next_payment_date");
  });

  it("month-end clamps — a note due the 31st is due Feb 28 in a common year", () => {
    const r = resolveAcquiredNoteDueDate(
      acquired({
        paymentDueDay: 31,
        firstPaymentDate: "2025-03-31",
        paidThroughDate: "2027-01-31",
        maturityDate: "2035-01-31",
      }),
      new Date(Date.UTC(2027, 0, 31)),
    );
    expect(iso(r!.dueDate)).toBe("2027-02-28");
  });

  it("month-end clamps to Feb 29 in a leap year", () => {
    const r = resolveAcquiredNoteDueDate(
      acquired({
        paymentDueDay: 31,
        firstPaymentDate: "2027-03-31",
        paidThroughDate: "2028-01-31",
        maturityDate: "2035-01-31",
      }),
      new Date(Date.UTC(2028, 0, 31)),
    );
    expect(iso(r!.dueDate)).toBe("2028-02-29");
  });

  it("an OVERDUE note keeps its past due date — being late is the signal", () => {
    const r = resolveAcquiredNoteDueDate(
      acquired({ paidThroughDate: "2026-02-15" }),
      ASOF,
    );
    // 2026-03-15 is months behind `asOf`. Rolling it forward to look friendly
    // is precisely the fabrication this build removed from the browser.
    expect(iso(r!.dueDate)).toBe("2026-03-15");
    expect(r!.dueDate.getTime()).toBeLessThan(ASOF.getTime());
  });

  it("REFUSES rather than approximating when the facts yield nothing", () => {
    // Bought in 2026, originated 2019, no payment history imported: the
    // platform never saw this note's servicing and must not assert a schedule.
    const r = resolveAcquiredNoteDueDate(
      acquired({
        originationDate: "2019-03-10",
        acquisitionDate: "2026-07-01",
        firstPaymentDate: null,
        paidThroughDate: null,
      }),
      ASOF,
    );
    expect(r).toBeNull();
  });

  it("REFUSES past maturity — a 361st payment on a 360-month note is invented", () => {
    const r = resolveAcquiredNoteDueDate(
      acquired({ paidThroughDate: "2035-01-15", maturityDate: "2035-01-15" }),
      new Date(Date.UTC(2035, 1, 1)),
    );
    expect(r).toBeNull();
  });
});

describe("the seller-finance book carried the identical defect, and is fixed too", () => {
  it("prefers the stored next_payment_date", () => {
    const r = resolveNoteDueDate({
      nextPaymentDate: new Date(Date.UTC(2026, 7, 20)),
      amortizationSchedule: null,
    } as Parameters<typeof resolveNoteDueDate>[0]);
    expect(iso(r!.dueDate)).toBe("2026-08-20");
    expect(r!.source).toBe("stored_next_payment_date");
  });

  it("falls back to the earliest UNPAID amortization entry", () => {
    const r = resolveNoteDueDate({
      nextPaymentDate: null,
      amortizationSchedule: [
        { dueDate: "2026-05-20", status: "paid" },
        { dueDate: "2026-07-20", status: "pending" },
        { dueDate: "2026-06-20", status: "late" },
      ],
    } as unknown as Parameters<typeof resolveNoteDueDate>[0]);
    // The earliest still-owed period, not the earliest row and not the newest.
    expect(iso(r!.dueDate)).toBe("2026-06-20");
    expect(r!.source).toBe("amortization_schedule");
  });

  it("REFUSES when every entry is paid and no stored date exists", () => {
    const r = resolveNoteDueDate({
      nextPaymentDate: null,
      amortizationSchedule: [{ dueDate: "2026-05-20", status: "paid" }],
    } as unknown as Parameters<typeof resolveNoteDueDate>[0]);
    expect(r).toBeNull();
  });
});

describe("§1026.41(b)(2) delivery timing follows the LOAN, not the calendar", () => {
  it("the deadline is a fixed lead time before that loan's own due date", () => {
    const due = new Date(Date.UTC(2026, 7, 15));
    const deadline = deliveryDeadlineFor(due);
    expect(deadline.getTime()).toBeLessThan(due.getTime());
    const leadDays = Math.round((due.getTime() - deadline.getTime()) / 86_400_000);
    expect(leadDays).toBeGreaterThan(0);
    // Two loans with different due dates must get different deadlines — the
    // whole point of removing the org-wide constant.
    expect(deliveryDeadlineFor(new Date(Date.UTC(2026, 7, 1))).getTime()).not.toBe(
      deadline.getTime(),
    );
  });
});

describe("§1026.41(d)(8) delinquency block — populated, but never synthesised", () => {
  const oldest = new Date(Date.UTC(2026, 2, 15));

  it("is undefined when there is no delinquency determination to report", () => {
    expect(
      buildAcquiredDelinquencyInfo({
        note: { daysDelinquent: 0, delinquencyStatus: "current", paymentDueDay: 15 },
        oldestUnpaidDueDate: oldest,
        paymentAmountCents: 100_000,
        asOfDate: ASOF,
      }),
    ).toBeUndefined();
  });

  it("is undefined below the disclosure threshold — 12 days down is not a foreclosure warning", () => {
    expect(
      buildAcquiredDelinquencyInfo({
        note: { daysDelinquent: 12, delinquencyStatus: "delinquent", paymentDueDay: 15 },
        oldestUnpaidDueDate: oldest,
        paymentAmountCents: 100_000,
        asOfDate: ASOF,
      }),
    ).toBeUndefined();
  });

  it("uses the REAL oldest unpaid due date, not now-minus-daysDelinquent", () => {
    const info = buildAcquiredDelinquencyInfo({
      note: { daysDelinquent: 137, delinquencyStatus: "default_candidate", paymentDueDay: 15 },
      oldestUnpaidDueDate: oldest,
      paymentAmountCents: 100_000,
      asOfDate: ASOF,
    });
    expect(info?.delinquentSinceDate).toBe("2026-03-15");
    // Five periods have come due since (and including) March 15 as of July 30.
    expect(info?.totalAmountDelinquentCents).toBe(5 * 100_000);
    expect(info?.riskOfForeclosureNotice).toBe(true);
  });

  it("counts more than one period — understating the cure amount is the failure mode", () => {
    const info = buildAcquiredDelinquencyInfo({
      note: { daysDelinquent: 60, delinquencyStatus: "seriously_delinquent", paymentDueDay: 15 },
      oldestUnpaidDueDate: new Date(Date.UTC(2026, 4, 15)),
      paymentAmountCents: 50_000,
      asOfDate: ASOF,
    });
    expect(info!.totalAmountDelinquentCents).toBeGreaterThan(50_000);
  });
});

describe("the calendar constant is gone for good", () => {
  it("no org-wide 'first of next month' due date survives in the generator", () => {
    // The exact shape of the old bug: a due date built from asOfDate's month
    // plus one, on day 1, with no per-loan input.
    expect(SRC).not.toMatch(
      /nextDueDate\s*=\s*new Date\(\s*Date\.UTC\(\s*asOfDate\.getUTCFullYear\(\),\s*asOfDate\.getUTCMonth\(\)\s*\+\s*1,\s*1\s*\)/,
    );
  });

  it("both books refuse with a named, citable reason instead of a fallback date", () => {
    expect(SRC).toContain("NO_DERIVABLE_DUE_DATE");
    expect(SRC).toContain("DUE_DATE_REFUSAL_CITATION");
    // Two call sites — one per book. If a future edit deletes one refusal, the
    // book it belongs to silently returns to inventing dates.
    expect((SRC.match(/NO_DERIVABLE_DUE_DATE/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
