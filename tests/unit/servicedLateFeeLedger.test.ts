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
  paymentRows: [] as Array<Record<string, string | null>>,
  inserts: [] as Array<Record<string, unknown>>,
  conflict: false,
  existing: false,
  inFlight: false,
  phase: "full" as "full" | "wind_down" | "ended",
  servicedOrgs: [7] as number[],
  sweepNotes: [] as Array<Record<string, unknown>>,
  sweepWhere: "",
  selects: [] as Array<{ table: string; where: string; fields: string[] }>,
}));

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/services/borrower/servicingPhase", () => ({
  lenderServicingPhase: async () => ({ phase: h.phase }),
  orgsStillServiced: async () => h.servicedOrgs,
}));
vi.mock("../../server/utils/orgScopedDb", () => {
  const dialect = new PgDialect();
  return {
    unscopedForPlatformOps: () => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.from = () => q;
      q.where = (w: unknown) => {
        h.sweepWhere = dialect.sqlToQuery(w as SQL).params.join(",");
        return q;
      };
      q.orderBy = () => q;
      q.limit = async () => h.sweepNotes;
      return q;
    },
  };
});
vi.mock("../../server/db", () => {
  const dialect = new PgDialect();
  const select = (fields?: Record<string, unknown>) => {
    const rec = { table: "", where: "", fields: Object.keys(fields ?? {}) };
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
    q.limit = () => q;
    q.then = (f: (v: unknown) => unknown, r?: (e: unknown) => unknown) => {
      let rows: unknown[];
      if (rec.table === "ach_debit_attempts") rows = h.inFlight ? [{ id: 1 }] : [];
      else if (rec.table === "late_fee_assessments") rows = rec.fields.includes("cents") ? [{ cents: String(h.assessedCents) }] : h.existing ? [{ id: "a0" }] : [];
      else if (rec.table === "payments") rows = rec.fields.includes("cents") ? [{ cents: String(h.creditedCents) }] : h.paymentRows;
      else rows = [];
      return Promise.resolve(rows).then(f, r);
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
  lateFeeDueByCents,
  outstandingServicedLateFeesCents,
  runServicedLateFeeAssessmentPass,
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
  h.paymentRows = [];
  h.inserts = [];
  h.conflict = false;
  h.existing = false;
  h.inFlight = false;
  h.phase = "full";
  h.servicedOrgs = [7];
  h.sweepNotes = [];
  h.sweepWhere = "";
  h.selects = [];
});

/** A payment whose parts sum to its amount — a fee carved out of the money. */
const carved = (lateFee: string) => ({ amount: "125.00", principalAmount: "80.00", interestAmount: "20.00", feeAmount: "0", lateFeeAmount: lateFee });

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
    const q = h.selects.find((s) => s.table === "payments" && s.fields.includes("cents"))!.where;
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
    h.paymentRows = [carved("25.00")];
    expect(await outstandingServicedLateFeesCents(7, 42)).toBe(2500);
    const paid = h.selects.find((s) => s.table === "payments")!.where;
    expect(paid).toMatch(/"payments"\."organization_id" = \$1/);
    expect(paid).toMatch(/"payments"\."note_id" = \$2/);
    const q = h.selects.find((s) => s.table === "late_fee_assessments")!.where;
    expect(q).toMatch(/"late_fee_assessments"\."organization_id" = \$1/);
    expect(q).toMatch(/"late_fee_assessments"\."loan_type" = \$2/);
    expect(q).toMatch(/"late_fee_assessments"\."loan_id" = \$3/);
    expect(q).toMatch(/"late_fee_assessments"\."status" = \$4/);
  });

  it("never negative", async () => {
    h.assessedCents = 0;
    h.paymentRows = [carved("25.00")];
    expect(await outstandingServicedLateFeesCents(7, 42)).toBe(0);
  });

  it("a legacy fee written ON TOP of the payment (no money paid it) does not cancel a fee owed now", async () => {
    // Pre-ledger posting: the whole $100 went to principal + interest and a
    // $25 "collected" fee was added beside it. Counting it would read the
    // borrower's next real $25 fee as already paid.
    h.assessedCents = 2500;
    h.paymentRows = [
      { amount: "100.00", principalAmount: "80.00", interestAmount: "20.00", feeAmount: "0", lateFeeAmount: "25.00" },
      // ...and its refund reversal, every part negated.
      { amount: "-100.00", principalAmount: "-80.00", interestAmount: "-20.00", feeAmount: "0", lateFeeAmount: "-25.00" },
    ];
    expect(await outstandingServicedLateFeesCents(7, 42)).toBe(2500);
  });

  it("a genuine fee payment that is refunded is owed again", async () => {
    h.assessedCents = 2500;
    h.paymentRows = [carved("25.00"), { amount: "-125.00", principalAmount: "-80.00", interestAmount: "-20.00", feeAmount: "0", lateFeeAmount: "-25.00" }];
    expect(await outstandingServicedLateFeesCents(7, 42)).toBe(2500);
  });

  it("the carved-out rule tolerates pro-rata rounding, and nothing more", async () => {
    h.assessedCents = 5000;
    // A partial refund's reversal: shares rounded per part, 1 cent off the amount.
    h.paymentRows = [carved("25.00"), { amount: "-41.67", principalAmount: "-26.67", interestAmount: "-6.67", feeAmount: "0", lateFeeAmount: "-8.34" }];
    expect(await outstandingServicedLateFeesCents(7, 42)).toBe(5000 - 2500 + 834);
    // A $5 fee on top of a payment its parts already fill is not a payment of it.
    h.paymentRows = [{ amount: "100.00", principalAmount: "80.00", interestAmount: "20.00", feeAmount: "0", lateFeeAmount: "5.00" }];
    expect(await outstandingServicedLateFeesCents(7, 42)).toBe(5000);
  });
});

describe("no fee where none is owed", () => {
  it("once the lender's servicing has ended, nothing is assessed — even by a payoff quote", async () => {
    h.phase = "ended";
    const r = await assessServicedNoteLateFee(note(), daysAfterDue(40));
    expect(r).toMatchObject({ assessed: false, reason: "lender servicing has ended" });
    expect(h.inserts).toEqual([]);
    expect(await lateFeeDueByCents(note(), daysAfterDue(40))).toBe(0);
  });

  it("an autopay debit initiated within grace and still settling is not a missed installment", async () => {
    h.inFlight = true;
    const r = await assessServicedNoteLateFee(note(), daysAfterDue(14));
    expect(r.assessed).toBe(false);
    expect(h.inserts).toEqual([]);
    const q = h.selects.find((s) => s.table === "ach_debit_attempts")!.where;
    expect(q).toMatch(/"ach_debit_attempts"\."organization_id" = \$1/);
    expect(q).toMatch(/"ach_debit_attempts"\."note_id" = \$2/);
  });
});

describe("payoff good through a later date", () => {
  it("quotes the fee grace will pass on by that date", async () => {
    expect(await lateFeeDueByCents(note(), daysAfterDue(20))).toBe(2500);
    expect(h.inserts).toEqual([]); // a projection never records anything
  });
  it("…but not one already assessed (it is in what is owed), nor one not yet due", async () => {
    expect(await lateFeeDueByCents(note(), daysAfterDue(5))).toBe(0);
    h.existing = true;
    expect(await lateFeeDueByCents(note(), daysAfterDue(20))).toBe(0);
  });
});

describe("the daily sweep", () => {
  const swept = (o: Record<string, unknown> = {}) => ({
    id: 42, organizationId: 7, nextPaymentDate: DUE, gracePeriodDays: 10, lateFee: "25.00", monthlyPayment: "100.00", ...o,
  });

  it("evaluates late and delinquent notes too — not only 'active' — and never defaulted or paid-off ones", async () => {
    h.sweepNotes = [swept()];
    const r = await runServicedLateFeeAssessmentPass(daysAfterDue(15));
    expect(r).toMatchObject({ scanned: 1, assessed: 1 });
    for (const status of ["active", "late", "delinquent"]) expect(h.sweepWhere).toContain(status);
    for (const status of ["defaulted", "paid_off"]) expect(h.sweepWhere).not.toContain(status);
  });

  it("skips a lender whose servicing has ended", async () => {
    h.servicedOrgs = [];
    h.sweepNotes = [swept()];
    const r = await runServicedLateFeeAssessmentPass(daysAfterDue(15));
    expect(r.scanned).toBe(0);
    expect(h.inserts).toEqual([]);
  });

  it("a note with no installment date, or no grace, records nothing", async () => {
    h.sweepNotes = [swept({ nextPaymentDate: null }), swept({ id: 43, gracePeriodDays: null })];
    const r = await runServicedLateFeeAssessmentPass(daysAfterDue(15));
    expect(r).toMatchObject({ scanned: 2, assessed: 0, errors: 0 });
    expect(h.inserts).toEqual([]);
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
