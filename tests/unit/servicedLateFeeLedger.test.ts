/**
 * Founder ruling 2026-09-29 #6 (DEFECT-0099) — serviced notes carry an
 * assessed late-fee ledger.
 *
 * Before: no record of a fee OWED existed, and every posting path wrote a
 * day-count fee into payments.late_fee_amount as COLLECTED while the whole
 * payment went to principal and interest — a collection no money made.
 * Payoff quotes and statements had to say late fees were "not tracked".
 *
 * Now a fee is ASSESSED (late_fee_assessments, loan_type 'note') when grace
 * passes on an installment not paid in full, by the §1026.36(c)(2)
 * non-pyramiding rule; a payment COLLECTS toward fees only what exceeds the
 * scheduled installment; what is OWED is assessed minus collected.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { getTableName, type SQL } from "drizzle-orm";

const h = vi.hoisted(() => ({
  creditedCents: 0,
  assessedCents: 0,
  collectedCents: 0,
  inserts: [] as Array<Record<string, unknown>>,
  conflict: false,
  selects: [] as Array<{ table: string; where: string }>,
}));

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/db", () => {
  const dialect = new PgDialect();
  const select = () => {
    const rec = { table: "", where: "" };
    const q: Record<string, unknown> = {};
    q.from = (t: unknown) => {
      rec.table = getTableName(t as never);
      h.selects.push(rec);
      return q;
    };
    q.where = (w: unknown) => {
      rec.where = dialect.sqlToQuery(w as SQL).sql;
      return q;
    };
    q.then = (f: (v: unknown) => unknown, r?: (e: unknown) => unknown) => {
      let cents = 0;
      if (rec.table === "late_fee_assessments") cents = h.assessedCents;
      // The installment-credit read is bounded by due date; the fees-collected read is not.
      else if (rec.table === "payments") cents = /due_date/.test(rec.where) ? h.creditedCents : h.collectedCents;
      return Promise.resolve([{ cents: String(cents) }]).then(f, r);
    };
    return q;
  };
  const insert = () => ({
    values: (v: Record<string, unknown>) => ({
      onConflictDoNothing: () => ({
        returning: async () => {
          if (h.conflict) return [];
          h.inserts.push(v);
          return [{ id: "a1" }];
        },
      }),
    }),
  });
  return { db: { select, insert } };
});

import {
  assessServicedNoteLateFee,
  feeFromExcessCents,
  outstandingServicedLateFeesCents,
} from "../../server/services/notes/servicedLateFees";

const DUE = new Date("2026-09-01T00:00:00Z");
const note = (o: Record<string, unknown> = {}) =>
  ({
    id: 42,
    organizationId: 7,
    nextPaymentDate: DUE,
    gracePeriodDays: 10,
    lateFee: "25.00",
    monthlyPayment: "100.00",
    ...o,
  }) as never;
const daysAfterDue = (n: number) => new Date(DUE.getTime() + n * 86_400_000);

beforeEach(() => {
  h.creditedCents = 0;
  h.assessedCents = 0;
  h.collectedCents = 0;
  h.inserts = [];
  h.conflict = false;
  h.selects = [];
});

describe("assessment — when grace passes on a missed installment", () => {
  it("within grace: nothing assessed", async () => {
    const r = await assessServicedNoteLateFee(note(), daysAfterDue(10));
    expect(r.assessed).toBe(false);
    expect(h.inserts).toEqual([]);
  });

  it("past grace, installment unpaid: ONE fee on that installment, recorded with its justification", async () => {
    const r = await assessServicedNoteLateFee(note(), daysAfterDue(11));
    expect(r).toMatchObject({ assessed: true, feeCents: 2500 });
    expect(h.inserts).toHaveLength(1);
    expect(h.inserts[0]).toMatchObject({
      organizationId: 7,
      loanId: "42",
      loanType: "note",
      periodStart: "2026-09-01",
      periodEnd: "2026-10-01",
      feeAmountCents: 2500,
      status: "assessed",
    });
    expect(String(h.inserts[0].justification)).toMatch(/§1026\.36\(c\)\(2\)/);
  });

  it("re-running is a no-op — the installment's row already exists", async () => {
    h.conflict = true;
    const r = await assessServicedNoteLateFee(note(), daysAfterDue(20));
    expect(r).toMatchObject({ assessed: false, alreadyExisted: true });
  });

  it("an installment paid in full within grace never carries a fee — and the credit is read for THIS installment, this org", async () => {
    h.creditedCents = 10000;
    const r = await assessServicedNoteLateFee(note(), daysAfterDue(40));
    expect(r.assessed).toBe(false);
    expect(h.inserts).toEqual([]);
    const q = h.selects.find((s) => s.table === "payments")!.where;
    expect(q).toMatch(/"payments"\."organization_id" = \$1/);
    expect(q).toMatch(/"payments"\."note_id" = \$2/);
    expect(q).toMatch(/"payments"\."due_date" >= \$\d and "payments"\."due_date" < \$\d/);
  });

  it("a partial payment does not stop the fee: the installment is still short", async () => {
    h.creditedCents = 5000;
    expect((await assessServicedNoteLateFee(note(), daysAfterDue(15))).assessed).toBe(true);
  });

  it("no stated grace period, or no late fee, means no fee — ever", async () => {
    expect((await assessServicedNoteLateFee(note({ gracePeriodDays: null }), daysAfterDue(60))).assessed).toBe(false);
    expect((await assessServicedNoteLateFee(note({ lateFee: "0" }), daysAfterDue(60))).assessed).toBe(false);
    expect(h.inserts).toEqual([]);
  });
});

describe("owed = assessed − collected", () => {
  it("counts only this note's ASSESSED rows (waived and reversed fees are not owed)", async () => {
    h.assessedCents = 5000;
    h.collectedCents = 2500;
    expect(await outstandingServicedLateFeesCents(7, 42)).toBe(2500);
    const q = h.selects.find((s) => s.table === "late_fee_assessments")!.where;
    expect(q).toMatch(/"late_fee_assessments"\."organization_id" = \$1/);
    expect(q).toMatch(/"late_fee_assessments"\."loan_type" = \$2/);
    expect(q).toMatch(/"late_fee_assessments"\."loan_id" = \$3/);
    expect(q).toMatch(/"late_fee_assessments"\."status" = \$4/);
  });

  it("never negative", async () => {
    h.assessedCents = 0;
    h.collectedCents = 2500; // legacy rows recorded a "collected" fee nothing assessed
    expect(await outstandingServicedLateFeesCents(7, 42)).toBe(0);
  });
});

describe("collection — only money ABOVE the installment pays fees", () => {
  it("an installment-sized payment collects no fee; it all goes to the installment", () => {
    expect(feeFromExcessCents({ amountCents: 10000, scheduledCents: 10000, outstandingFeeCents: 2500 })).toBe(0);
  });
  it("a payment short of the installment collects no fee (the fee never makes a payment short)", () => {
    expect(feeFromExcessCents({ amountCents: 9000, scheduledCents: 10000, outstandingFeeCents: 2500 })).toBe(0);
  });
  it("the excess pays the fee, up to what is owed; the rest is principal", () => {
    expect(feeFromExcessCents({ amountCents: 12500, scheduledCents: 10000, outstandingFeeCents: 2500 })).toBe(2500);
    expect(feeFromExcessCents({ amountCents: 11000, scheduledCents: 10000, outstandingFeeCents: 2500 })).toBe(1000);
    expect(feeFromExcessCents({ amountCents: 20000, scheduledCents: 10000, outstandingFeeCents: 2500 })).toBe(2500);
  });
  it("nothing owed, or no schedule to measure against: nothing collected", () => {
    expect(feeFromExcessCents({ amountCents: 20000, scheduledCents: 10000, outstandingFeeCents: 0 })).toBe(0);
    expect(feeFromExcessCents({ amountCents: 20000, scheduledCents: null, outstandingFeeCents: 2500 })).toBe(0);
  });
});
