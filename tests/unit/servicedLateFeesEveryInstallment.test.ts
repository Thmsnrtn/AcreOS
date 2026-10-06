/**
 * DEFECT-0185 — late fees on EVERY missed installment, lump-sum coverage, and
 * the owed fee read under the note's lock (W10.5 "Money residue").
 *
 * Batch F (DEFECT-0099) built an assessed late-fee ledger but evaluated only
 * the installment at `notes.next_payment_date`: a borrower three installments
 * behind carried ONE fee. A lump-sum catch-up advanced the due date one month
 * whatever it funded, so the installments it paid were later evaluated as
 * unpaid. And the fee owed was read before the posting transaction, so two
 * concurrent payments could each collect the same fee.
 *
 * These tests drive the REAL posting rule (`postServicedNotePayment`), the
 * REAL daily sweep and the REAL repository write through an in-memory ledger
 * that evaluates every WHERE (due-date windows, aggregates), enforces the
 * ledger's per-installment unique key, and models `SELECT … FOR UPDATE` and
 * READ COMMITTED visibility (servicedNoteLedgerFake.ts). Expectations come
 * from an independent integer-cents reference model of the note's own terms,
 * run over several deterministic schedules — never from the implementation.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { createLedgerFake } from "./servicedNoteLedgerFake";

const F = vi.hoisted(() => ({
  ledger: null as unknown as ReturnType<typeof createLedgerFake>,
  phase: "full" as "full" | "wind_down" | "ended",
}));

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/db", async () => {
  const { createLedgerFake } = await import("./servicedNoteLedgerFake");
  F.ledger = createLedgerFake();
  return { db: F.ledger.db, withTransaction: F.ledger.withTransaction };
});
vi.mock("../../server/utils/orgScopedDb", () => ({
  unscopedForPlatformOps: () => F.ledger.db,
}));
vi.mock("../../server/services/borrower/servicingPhase", () => ({
  lenderServicingPhase: async () => ({ phase: F.phase }),
  orgsStillServiced: async () => (F.phase === "ended" ? [] : [7]),
}));
vi.mock("../../server/services/workflow-engine", () => ({ emitPaymentEvent: vi.fn() }));
vi.mock("../../server/services/emailService", () => ({
  emailService: { sendEmail: vi.fn(async () => ({ success: true })) },
}));
vi.mock("../../server/services/activation", () => ({ recordActivationEventAsync: vi.fn() }));
vi.mock("../../server/storage", async () => {
  const { noteRepo } = await import("../../server/storage/noteRepo");
  const storage: Record<string, unknown> = {
    // The real repository write, on whatever connection the caller hands it.
    updateNote: (...args: unknown[]) => (noteRepo.updateNote as (...a: unknown[]) => unknown).apply(storage, args),
    logActivity: vi.fn(async () => undefined),
    getBorrowerLead: vi.fn(async () => null),
    getOrganization: vi.fn(async () => ({ id: 7, name: "Acme Lender" })),
  };
  return { storage, db: {} };
});

import {
  assessServicedNoteLateFee,
  runServicedLateFeeAssessmentPass,
} from "../../server/services/notes/servicedLateFees";
import {
  postBorrowerPortalCheckoutPayment,
  postServicedNotePayment,
} from "../../server/services/borrower/portalPaymentPosting";

// ── Reference calendar (independent of the implementation) ──────────────────
const DAY = 86_400_000;
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
/** Installment i of a note whose first payment is `first`: same day-of-month, clamped. */
function installmentDate(first: Date, i: number): Date {
  const y = first.getUTCFullYear();
  const m = first.getUTCMonth() + i;
  const ty = y + Math.floor(m / 12);
  const tm = ((m % 12) + 12) % 12;
  const d = Math.min(first.getUTCDate(), daysInMonth(ty, tm));
  return new Date(Date.UTC(ty, tm, d, first.getUTCHours(), first.getUTCMinutes()));
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
const at = (s: string) => new Date(s);
/** Exact decimal string → cents, the reference way (no floats). */
function cents(v: unknown): number {
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(v));
  if (!m) throw new Error(`not a 2-decimal amount: ${String(v)}`);
  const c = Number(m[2]) * 100 + Number((m[3] ?? "").padEnd(2, "0"));
  return m[1] ? -c : c;
}
const dollars = (c: number) => (c / 100).toFixed(2);

interface Schedule {
  name: string;
  first: Date;
  termMonths: number;
  scheduledCents: number;
  graceDays: number | null;
  lateFeeCents: number;
  /** Payments posted at 15:00 UTC on their day, after that day's 13:00 sweep. */
  payments: Array<{ day: string; cents: number }>;
  end: string;
}

function seedNote(s: Schedule, over: Record<string, unknown> = {}) {
  const schedule = Array.from({ length: s.termMonths }, (_, i) => ({
    paymentNumber: i + 1,
    dueDate: installmentDate(s.first, i).toISOString(),
    payment: s.scheduledCents / 100,
    principal: 0,
    interest: 0,
    balance: 0,
    status: "pending",
  }));
  F.ledger.fake.rows("notes").push({
    id: 42,
    organizationId: 7,
    borrowerId: null,
    originalPrincipal: "500000.00",
    currentBalance: "500000.00",
    interestRate: "6",
    termMonths: s.termMonths,
    monthlyPayment: dollars(s.scheduledCents),
    lateFee: dollars(s.lateFeeCents),
    gracePeriodDays: s.graceDays,
    startDate: installmentDate(s.first, -1),
    // In AcreOS from origination: every installment came due while it was held.
    createdAt: installmentDate(s.first, -1),
    firstPaymentDate: s.first,
    nextPaymentDate: s.first,
    status: "active",
    version: 1,
    amortizationSchedule: schedule,
    pendingCheckoutSessionId: null,
    deletedAt: null,
    ...over,
  });
}
const noteRow = () => ({ ...F.ledger.fake.rows("notes")[0] }) as never;
const assessments = () => F.ledger.fake.rows("late_fee_assessments");
const paymentRows = () => F.ledger.fake.rows("payments");

/**
 * The reference model. Installments are covered oldest-first; a payment
 * covers every installment due by its date (at least the current one) before
 * a cent goes to fees; only money beyond that pays fees owed; a fee is
 * assessed on an installment once grace has passed and it is not paid in
 * full, once per installment, never for one already covered.
 */
function referenceModel(s: Schedule, evaluations: Array<{ t: Date; payCents?: number }>) {
  const grid = (i: number) => installmentDate(s.first, i);
  let k = 0;
  let credit = 0;
  let owed = 0;
  let collected = 0;
  const assessed = new Map<number, number>();
  const perPayment: Array<{ feeCents: number; covered: number }> = [];
  const pastGrace = (i: number, t: Date) =>
    s.graceDays !== null && Math.floor((t.getTime() - grid(i).getTime()) / DAY) > s.graceDays;
  const evaluate = (t: Date) => {
    if (s.graceDays === null || s.lateFeeCents <= 0) return;
    for (let i = k; i < s.termMonths && pastGrace(i, t); i++) {
      if (assessed.has(i)) continue;
      if ((i === k ? credit : 0) >= s.scheduledCents) continue;
      assessed.set(i, s.lateFeeCents);
      owed += s.lateFeeCents;
    }
  };
  for (const e of evaluations) {
    evaluate(e.t);
    if (e.payCents === undefined) continue;
    let due = 0;
    for (let i = k; i < s.termMonths && grid(i).getTime() <= e.t.getTime(); i++) due++;
    due = Math.max(1, due);
    const demand = Math.max(0, due * s.scheduledCents - credit);
    const toInstallments = Math.min(e.payCents, demand);
    const fee = Math.min(e.payCents - toInstallments, owed);
    owed -= fee;
    collected += fee;
    const covered = Math.min(due, Math.floor((credit + toInstallments) / s.scheduledCents));
    if (covered > 0) {
      k += covered;
      // NOT the borrower's position: money toward a partly-funded NEXT
      // installment is dropped here exactly as the code drops it. That carry
      // is DEFECT-0297 (P1, deferred to W10.5b) — this model pins today's rule
      // so a change to it is deliberate, not that the rule is right.
      credit = 0;
    } else credit += toInstallments;
    perPayment.push({ feeCents: fee, covered });
  }
  return {
    assessedDays: [...assessed.keys()].sort((a, b) => a - b).map((i) => iso(grid(i))),
    collected,
    owed,
    nextDue: grid(k),
    perPayment,
  };
}

/** Drive the real code: a 13:00 UTC sweep every day, payments at 15:00 UTC. */
async function simulate(s: Schedule) {
  const evaluations: Array<{ t: Date; payCents?: number }> = [];
  const start = new Date(s.first.getTime() - 3 * DAY);
  const end = at(`${s.end}T23:59:59Z`);
  let n = 0;
  for (let d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())); d <= end; d = new Date(d.getTime() + DAY)) {
    const sweepAt = new Date(d.getTime() + 13 * 3600_000);
    await runServicedLateFeeAssessmentPass(sweepAt);
    evaluations.push({ t: sweepAt });
    for (const p of s.payments.filter((p) => p.day === iso(d))) {
      const payAt = new Date(d.getTime() + 15 * 3600_000);
      const out = await postServicedNotePayment({
        note: noteRow(),
        amountCents: p.cents,
        transactionId: `op:7:${s.name}:${n++}`,
        source: "operator_recorded",
        paymentMethod: "check",
        now: payAt,
        sendReceipt: false,
      });
      expect(out.outcome).toBe("posted");
      evaluations.push({ t: payAt, payCents: p.cents });
    }
  }
  return referenceModel(s, evaluations);
}

const SCHEDULES: Schedule[] = [
  {
    // Four installments missed, then one catch-up that pays all four plus
    // their fees; on time afterwards.
    name: "four-behind-full-catch-up",
    first: at("2026-01-01T00:00:00Z"),
    termMonths: 24,
    scheduledCents: 10_000,
    graceDays: 10,
    lateFeeCents: 2_500,
    payments: [
      { day: "2026-04-20", cents: 4 * 10_000 + 4 * 2_500 },
      { day: "2026-05-05", cents: 10_000 },
      { day: "2026-06-03", cents: 10_000 },
    ],
    end: "2026-07-20",
  },
  {
    // Odd cents, a long grace, and a lump that covers 2.5 installments when
    // two are due: two advance, the excess pays fees, the rest is principal.
    name: "odd-cents-lump-beyond-due",
    first: at("2026-03-15T00:00:00Z"),
    termMonths: 12,
    scheduledCents: 12_345,
    graceDays: 15,
    lateFeeCents: 1_999,
    payments: [
      { day: "2026-05-10", cents: 30_862 },
      { day: "2026-05-20", cents: 12_345 },
    ],
    end: "2026-07-31",
  },
  {
    // Day-31 schedule (clamped months) and a SHORT lump: four due, the money
    // covers two whole installments; only those two advance.
    name: "day31-short-lump",
    first: at("2026-01-31T00:00:00Z"),
    termMonths: 18,
    scheduledCents: 9_999,
    graceDays: 5,
    lateFeeCents: 1_000,
    payments: [
      { day: "2026-05-02", cents: 25_000 },
      { day: "2026-05-29", cents: 9_999 },
      { day: "2026-06-20", cents: 40_000 },
    ],
    end: "2026-08-15",
  },
  {
    // Partials that add up to an installment advance it; a partial past grace
    // still carries the fee; money above the installment later pays it.
    name: "partials-accumulate",
    first: at("2026-02-10T00:00:00Z"),
    termMonths: 12,
    scheduledCents: 20_000,
    graceDays: 7,
    lateFeeCents: 3_500,
    payments: [
      { day: "2026-02-12", cents: 10_000 },
      { day: "2026-02-15", cents: 10_000 },
      { day: "2026-03-20", cents: 5_000 },
      { day: "2026-03-25", cents: 15_000 },
      { day: "2026-04-09", cents: 23_500 },
    ],
    end: "2026-05-31",
  },
  {
    // Always within grace: never a fee, whatever the amounts.
    name: "always-on-time",
    first: at("2026-01-05T00:00:00Z"),
    termMonths: 12,
    scheduledCents: 15_000,
    graceDays: 10,
    lateFeeCents: 5_000,
    payments: [
      { day: "2026-01-14", cents: 15_000 },
      { day: "2026-02-05", cents: 15_000 },
      { day: "2026-03-01", cents: 30_000 },
      { day: "2026-04-15", cents: 15_000 },
    ],
    end: "2026-05-10",
  },
  {
    // The note states no grace period: no fee is ever assessed, however far behind.
    name: "no-grace-stated",
    first: at("2026-01-01T00:00:00Z"),
    termMonths: 12,
    scheduledCents: 10_000,
    graceDays: null,
    lateFeeCents: 2_500,
    payments: [{ day: "2026-05-01", cents: 20_000 }],
    end: "2026-06-30",
  },
];

beforeEach(() => {
  F.ledger.fake.reset();
  F.phase = "full";
});

describe("every missed installment carries the note's own fee — once, and only while unpaid", () => {
  for (const s of SCHEDULES) {
    it(`${s.name}: the ledger matches the reference model to the cent`, async () => {
      seedNote(s);
      const expected = await simulate(s);

      // Assessed: exactly the installments the note's rule supports, once each.
      const rows = assessments();
      expect(rows.map((r) => r.periodStart).sort()).toEqual(expected.assessedDays);
      for (const r of rows) {
        expect(r).toMatchObject({ organizationId: 7, loanId: "42", loanType: "note", status: "assessed", feeAmountCents: s.lateFeeCents });
      }
      const months = rows.map((r) => String(r.periodStart).slice(0, 7));
      expect(new Set(months).size).toBe(months.length);

      // Collected: only money beyond the installments due, never more than owed.
      const pays = paymentRows();
      expect(pays).toHaveLength(s.payments.length);
      expect(pays.map((p) => cents(p.lateFeeAmount))).toEqual(expected.perPayment.map((p) => p.feeCents));
      for (const p of pays) {
        // Cents-exact conservation: every cent of a payment lands somewhere.
        expect(cents(p.principalAmount) + cents(p.interestAmount) + cents(p.lateFeeAmount)).toBe(cents(p.amount));
      }

      // The due date moved by exactly the installments the money covered.
      expect(iso(new Date(noteRow()["nextPaymentDate" as never]))).toBe(iso(expected.nextDue));
    });
  }

  it("a lump-sum catch-up's funded installments are never evaluated as unpaid afterwards", async () => {
    const s = SCHEDULES[0];
    seedNote(s);
    await simulate(s);
    const before = assessments().length;
    // Months later, with the borrower current, sweeps assess nothing for
    // the four installments the catch-up paid.
    await runServicedLateFeeAssessmentPass(at("2026-07-05T13:00:00Z"));
    expect(assessments().length).toBe(before);
    expect(assessments().map((r) => r.periodStart)).not.toContain("2026-05-01");
  });
});

describe("the walk is bounded, and refuses where the schedule is not the note's", () => {
  const behind: Schedule = {
    name: "thirty-one-behind",
    first: at("2024-01-01T00:00:00Z"),
    termMonths: 60,
    scheduledCents: 10_000,
    graceDays: 10,
    lateFeeCents: 2_500,
    payments: [],
    end: "2026-07-15",
  };

  it("caps one run at 24 assessments, reports the rest, and the next run continues — never twice", async () => {
    seedNote(behind);
    const now = at("2026-07-15T13:00:00Z"); // installments 0..30 are past grace
    const first = (await assessServicedNoteLateFee(noteRow(), now)) as unknown as Record<string, unknown>;
    expect(assessments()).toHaveLength(24);
    expect(first).toMatchObject({ assessed: true, installmentsAssessed: 24, deferredInstallments: 7 });
    const second = (await assessServicedNoteLateFee(noteRow(), now)) as unknown as Record<string, unknown>;
    expect(assessments()).toHaveLength(31);
    expect(second).toMatchObject({ installmentsAssessed: 7, deferredInstallments: 0 });
    await assessServicedNoteLateFee(noteRow(), now);
    expect(assessments()).toHaveLength(31);
    expect(new Set(assessments().map((r) => r.periodStart)).size).toBe(31);
    expect(assessments().map((r) => r.periodStart).sort().at(-1)).toBe("2026-07-01");
  });

  it("a catch-up posting assesses EVERY deferred installment before it covers them — the cap bounds the sweep, not the posting", async () => {
    seedNote(behind);
    const now = at("2026-07-15T13:00:00Z"); // 31 installments past grace
    const out = await postServicedNotePayment({ note: noteRow(), amountCents: 31 * 10_000, transactionId: "op:catch-up", source: "operator_recorded", paymentMethod: "check", now, sendReceipt: false });
    expect(out.outcome).toBe("posted");
    expect(assessments()).toHaveLength(31);
    expect(new Set(assessments().map((r) => r.periodStart)).size).toBe(31);
  });

  it("the daily sweep reports installments, not just notes", async () => {
    seedNote(behind);
    const r = (await runServicedLateFeeAssessmentPass(at("2026-07-15T13:00:00Z"))) as unknown as Record<string, unknown>;
    expect(r).toMatchObject({ scanned: 1, assessed: 1, installmentsAssessed: 24, deferredInstallments: 7 });
  });

  it("never past the note's term", async () => {
    seedNote({ ...behind, termMonths: 3 });
    await assessServicedNoteLateFee(noteRow(), at("2026-07-15T13:00:00Z"));
    expect(assessments().map((r) => r.periodStart).sort()).toEqual(["2024-01-01", "2024-02-01", "2024-03-01"]);
  });

  it("an unrecorded payment is not a missed one: a note imported with a stale next date is never walked", async () => {
    // Imported mid-2026 with its 2024 next date. A payment recorded now is
    // applied to that backlog, so every month after the import would read as
    // unpaid — fees from payments AcreOS never saw (W10.5 audit). Only the
    // current installment is evaluated, as before the walk existed.
    seedNote(behind, { createdAt: at("2026-05-10T00:00:00Z") });
    const r = (await assessServicedNoteLateFee(noteRow(), at("2026-07-15T13:00:00Z"))) as unknown as Record<string, unknown>;
    expect(assessments().map((x) => x.periodStart)).toEqual(["2024-01-01"]);
    expect(r).toMatchObject({ walk: "current_only", installmentsAssessed: 1 });
    expect(String(r.walkRefusedReason)).toMatch(/predates AcreOS holding the note/);
  });

  it("a note entered the same day its first payment is due is held from that installment (UTC day, not instant)", async () => {
    // Recorded at 15:00 on the first due date; the date is midnight that day.
    seedNote({ ...behind, first: at("2026-01-01T00:00:00Z") }, { createdAt: at("2026-01-01T15:00:00Z"), nextPaymentDate: at("2026-01-01T00:00:00Z") });
    const r = (await assessServicedNoteLateFee(noteRow(), at("2026-04-15T13:00:00Z"))) as unknown as Record<string, unknown>;
    expect(r).toMatchObject({ walk: "schedule" });
    expect(assessments().map((x) => x.periodStart).sort()).toEqual(["2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01"]);
  });

  it("…while a note AcreOS has held since before its next date IS walked", async () => {
    seedNote(behind, { createdAt: at("2023-12-01T00:00:00Z") });
    const r = (await assessServicedNoteLateFee(noteRow(), at("2024-04-15T13:00:00Z"))) as unknown as Record<string, unknown>;
    expect(assessments().map((x) => x.periodStart).sort()).toEqual(["2024-01-01", "2024-02-01", "2024-03-01", "2024-04-01"]);
    expect(r).toMatchObject({ walk: "schedule" });
  });

  it("when AcreOS began holding the note is unknown: the current installment only, and it says why", async () => {
    seedNote(behind, { createdAt: null });
    const r = (await assessServicedNoteLateFee(noteRow(), at("2026-07-15T13:00:00Z"))) as unknown as Record<string, unknown>;
    expect(assessments().map((x) => x.periodStart)).toEqual(["2024-01-01"]);
    expect(r).toMatchObject({ walk: "current_only" });
    expect(String(r.walkRefusedReason)).toMatch(/AcreOS began servicing/);
  });

  it("a next payment date off the note's own schedule: the current installment only, and it says why", async () => {
    // First payment on the 31st; an earlier writer stepped the date to the 28th.
    seedNote({ ...behind, first: at("2026-01-31T00:00:00Z") }, { nextPaymentDate: at("2026-03-28T00:00:00Z") });
    const r = (await assessServicedNoteLateFee(noteRow(), at("2026-06-20T13:00:00Z"))) as unknown as Record<string, unknown>;
    expect(assessments().map((x) => x.periodStart)).toEqual(["2026-03-28"]);
    expect(r).toMatchObject({ walk: "current_only" });
    expect(String(r.walkRefusedReason)).toMatch(/schedule/i);
  });

  it("an installment already assessed under another day of the same month is not assessed again", async () => {
    seedNote({ ...behind, first: at("2026-01-31T00:00:00Z") }, { nextPaymentDate: at("2026-03-28T00:00:00Z") });
    assessments().push({ id: "pre", organizationId: 7, loanId: "42", loanType: "note", periodStart: "2026-03-31", periodEnd: "2026-04-30", feeAmountCents: 2_500, status: "assessed", justification: "x" });
    await assessServicedNoteLateFee(noteRow(), at("2026-06-20T13:00:00Z"));
    expect(assessments().map((x) => x.periodStart)).toEqual(["2026-03-31"]);
  });

  it.each([
    ["no grace stated", { gracePeriodDays: null }],
    ["no late fee", { lateFee: "0" }],
    ["defaulted (accelerated)", { status: "defaulted" }],
    ["paid off", { status: "paid_off" }],
  ])("%s: nothing is assessed, however far behind", async (_label, over) => {
    seedNote(behind, over);
    await assessServicedNoteLateFee(noteRow(), at("2026-07-15T13:00:00Z"));
    expect(assessments()).toHaveLength(0);
  });

  it("servicing ended: nothing is assessed", async () => {
    seedNote(behind);
    F.phase = "ended";
    await assessServicedNoteLateFee(noteRow(), at("2026-07-15T13:00:00Z"));
    expect(assessments()).toHaveLength(0);
  });
});

describe("concurrent postings read what is owed, and where the note stands, under its lock", () => {
  const twoBehind: Schedule = {
    name: "two-behind",
    first: at("2026-08-01T00:00:00Z"),
    termMonths: 12,
    scheduledCents: 10_000,
    graceDays: 10,
    lateFeeCents: 2_500,
    payments: [],
    end: "2026-09-30",
  };

  it("two different payments cannot each collect the same fee", async () => {
    // One installment behind (Sep 1), its fee assessed; Oct 1 not yet due.
    seedNote({ ...twoBehind, first: at("2026-09-01T00:00:00Z") });
    const now = at("2026-09-20T15:00:00Z");
    await runServicedLateFeeAssessmentPass(at("2026-09-20T13:00:00Z"));
    expect(assessments()).toHaveLength(1);
    F.ledger.fake.tickMs = 1;
    const post = (txn: string) =>
      postServicedNotePayment({ note: noteRow(), amountCents: 12_500, transactionId: txn, source: "operator_recorded", paymentMethod: "check", now, sendReceipt: false });
    const [a, b] = await Promise.all([post("op:7:a"), post("op:7:b")]);
    expect(a.outcome).toBe("posted");
    expect(b.outcome).toBe("posted");
    const fees = paymentRows().map((p) => cents(p.lateFeeAmount));
    expect(fees.reduce((x, y) => x + y, 0)).toBe(2_500);
    // ...and both installments they covered moved the date: Sep → Oct → Nov.
    expect(iso(new Date(noteRow()["nextPaymentDate" as never]))).toBe("2026-11-01");
  });

  it("two concurrent installment payments on a note two behind advance it twice", async () => {
    seedNote(twoBehind);
    F.ledger.fake.tickMs = 1;
    const now = at("2026-09-05T15:00:00Z"); // Aug 1 and Sep 1 both due
    const post = (txn: string) =>
      postServicedNotePayment({ note: noteRow(), amountCents: 10_000, transactionId: txn, source: "operator_recorded", paymentMethod: "check", now, sendReceipt: false });
    await Promise.all([post("op:7:x"), post("op:7:y")]);
    expect(iso(new Date(noteRow()["nextPaymentDate" as never]))).toBe("2026-10-01");
    const balance = cents(noteRow()["currentBalance" as never]);
    const principal = paymentRows().reduce((n, p) => n + cents(p.principalAmount), 0);
    expect(balance).toBe(50_000_000 - principal);
  });

  it("the SPLIT payoff (balance + one month's interest) on a note behind whose installments exceed it pays the fees and closes it (W10.5) — the per-diem payoff QUOTE can differ: DEFECT-0297", async () => {
    // $300 left at 6% → $1.50 of interest; four $100 installments due, each past grace.
    seedNote({ ...twoBehind, first: at("2026-06-01T00:00:00Z") }, { currentBalance: "300.00", nextPaymentDate: at("2026-06-01T00:00:00Z") });
    const now = at("2026-09-20T15:00:00Z"); // Jun, Jul, Aug, Sep due
    await runServicedLateFeeAssessmentPass(at("2026-09-20T13:00:00Z"));
    const owed = assessments().reduce((n, a) => n + Number(a.feeAmountCents), 0);
    expect(owed).toBeGreaterThan(0);
    const out = await postServicedNotePayment({ note: noteRow(), amountCents: 30_150 + owed, transactionId: "op:payoff", source: "operator_recorded", paymentMethod: "check", now, sendReceipt: false });
    expect(out.outcome).toBe("posted");
    const [row] = paymentRows();
    expect(cents(row.lateFeeAmount)).toBe(owed);
    expect(cents(noteRow()["currentBalance" as never])).toBe(0);
  });

  it("a card payment posts through the same coverage rule", async () => {
    seedNote(twoBehind);
    const out = await postBorrowerPortalCheckoutPayment({
      note: noteRow(),
      stripeSession: { id: "cs_lump", amount_total: 20_000, payment_status: "paid", metadata: { noteId: "42" } } as never,
      source: "borrower_portal",
      now: at("2026-09-05T15:00:00Z"),
    });
    expect(out.outcome).toBe("posted");
    expect(iso(new Date(noteRow()["nextPaymentDate" as never]))).toBe("2026-10-01");
    const sched = (noteRow()["amortizationSchedule" as never] as Array<{ status: string }>).map((r) => r.status);
    expect(sched.slice(0, 3)).toEqual(["paid", "paid", "pending"]);
  });
});
