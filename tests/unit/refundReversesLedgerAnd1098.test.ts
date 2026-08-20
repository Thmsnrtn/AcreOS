/**
 * REFUND → LEDGER → FORM 1098 BOX 1.
 *
 * THE DEFECT THIS GATE EXISTS FOR
 * ───────────────────────────────
 * A borrower's card payment is a DIRECT charge on the lender's own Stripe
 * account, so its `charge.refunded` arrives at the CONNECT endpoint and is
 * dispatched by `stripeConnect.handleWebhookEvent`. That switch had no refund
 * branch: the event hit `default:`, AcreOS logged "Unhandled Stripe webhook
 * event", the payment row stood, the note balance stayed reduced — and Form
 * 1098 Box 1 reported mortgage interest the borrower never actually paid,
 * filed with the IRS under that borrower's real TIN.
 *
 * PRECISELY SCOPED, because the looser claim is false: webhookHandlers' own
 * PLATFORM dispatcher already handled BOTH `charge.refunded` (→
 * processChargeRefunded, which reverses AcreOS's own subscription revenue
 * recognition) and `charge.dispute.*` (→ processChargeDispute). Neither
 * touches a note ledger and neither ever receives a lender's Connect event.
 * It was the CONNECT switch that lacked the branch, not the codebase.
 *
 * A branch is not enough on its own, either: Stripe delivers only what the
 * endpoint's `enabled_events` names, and `charge.refunded` was missing from
 * the list `routes-setup.ts` provisions the Connect endpoint with. That half
 * is gated by `stripeConnectWebhookEvents.test.ts`.
 *
 * WHY THIS GATE IS NOT A SOURCE SCAN
 * ──────────────────────────────────
 * "the string charge.refunded appears in stripeConnect.ts" would go green for
 * a branch that logs and returns. So the tests below drive the REAL objects:
 * a real Connect event through the real `handleWebhookEvent`, into the real
 * refund handler, writing into a fake database, and then the rows that
 * database actually holds are mapped by the REAL `toOriginatedLedgerEntries`
 * into the REAL `deriveForm1098`. The assertion is on the tax figure at the
 * end, not on any symbol along the way. Reintroducing the defect through an
 * equivalent representation — no branch, a branch that does nothing, a
 * reversal row that never reaches the tax path because it is marked something
 * other than posted, a Box 1 that goes back to a naive signed sum — fails it.
 *
 * VACUITY: the first test in every block asserts the HAPPY path produces a
 * real, non-empty, correct figure, so "no violation found" cannot be the
 * result of an empty population or a broken fixture.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Fake database ─────────────────────────────────────────────────────────
//
// IT HONOURS THE WHERE CLAUSE. The first version of this fake did not: it
// dispatched on table identity plus "was .limit() called", and returned
// `paymentRows.filter(r => !r.transactionId.includes("::refund::")).slice(0,1)`
// for the limited read. That made the handler's actual lookup —
// `where(eq(payments.transactionId, session.id))` — UNEXERCISED: the tests
// passed because the first non-reversal row happened to carry the same
// amounts as the refunded one, so pointing the query at the wrong payment
// produced identical numbers. A gate that cannot tell those apart certifies
// nothing about which row a refund reverses.
//
// So the drizzle `SQL` object is interpreted: its chunk tree is flattened into
// (column, operator, parameter) triples and compiled into a row predicate.
// `LIKE` is implemented with real SQL semantics — `%` any run, `_` ANY SINGLE
// CHARACTER — which is what makes the handler's `startsWith` re-filter
// meaningful, since Stripe ids are full of underscores. Anything the
// interpreter cannot read (an OR, an unrecognised operator, a WHERE that
// yields no constraint at all) THROWS rather than quietly matching every row:
// a fake that silently widens a query is how the defect above survived.

const dbState = vi.hoisted(() => ({
  paymentRows: [] as any[],
  note: null as any,
  nextId: 1,
}));

const schemaTables = vi.hoisted(() => ({ payments: null as any, notes: null as any }));

const fakeDb = vi.hoisted(() => {
  const isPayments = (t: any) => t === schemaTables.payments;

  // ── drizzle SQL → row predicate ────────────────────────────────────────
  const flatten = (node: any, out: any[] = []): any[] => {
    if (node === null || node === undefined) return out;
    if (Array.isArray(node.queryChunks)) {
      for (const c of node.queryChunks) flatten(c, out);
      return out;
    }
    out.push(node);
    return out;
  };
  const isText = (n: any) => Array.isArray(n?.value);
  const isParam = (n: any) =>
    n !== null && typeof n === "object" && "value" in n && "encoder" in n;
  const isColumn = (n: any) => typeof n?.name === "string" && n?.table !== undefined;

  /** The row property a drizzle Column corresponds to. */
  const columnKey = (col: any): string => {
    for (const table of [schemaTables.payments, schemaTables.notes]) {
      if (!table) continue;
      for (const [k, v] of Object.entries(table)) if (v === col) return k;
    }
    throw new Error(`fake db: column "${String(col?.name)}" belongs to no table this fake knows`);
  };

  /** Real SQL LIKE: `%` = any run, `_` = exactly one character. */
  const likeToRegExp = (pattern: string): RegExp => {
    let body = "";
    for (const ch of pattern) {
      if (ch === "%") body += "[\\s\\S]*";
      else if (ch === "_") body += "[\\s\\S]";
      else body += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
    return new RegExp(`^${body}$`);
  };

  function compile(where: any): (row: any) => boolean {
    if (!where) {
      // Every read the handler performs is filtered. An unfiltered one is a
      // bug in the code under test, not something to paper over.
      throw new Error("fake db: a read with no WHERE clause would match every row — refusing");
    }
    const constraints: Array<{ key: string; op: string; value: any }> = [];
    let col: any = null;
    let op: string | null = null;
    for (const tok of flatten(where)) {
      // `like()` inlines its pattern as a bare JS primitive rather than a
      // Param, so a primitive here IS the bound value.
      if (tok === null || typeof tok !== "object") {
        if (!col || !op) {
          throw new Error("fake db: unreadable WHERE clause — refusing rather than ignoring it");
        }
        constraints.push({ key: columnKey(col), op, value: tok });
        col = null;
        op = null;
        continue;
      }
      if (isColumn(tok)) {
        col = tok;
        op = null;
        continue;
      }
      if (isText(tok)) {
        const txt = tok.value.join("").toLowerCase();
        if (txt.includes(" or ")) {
          throw new Error("fake db: OR is not interpreted — refusing rather than matching everything");
        }
        if (txt.includes(" like ")) op = "like";
        else if (txt.includes(" = ")) op = "eq";
        continue;
      }
      if (isParam(tok)) {
        if (!col || !op) {
          throw new Error("fake db: unreadable WHERE clause — refusing rather than ignoring it");
        }
        constraints.push({ key: columnKey(col), op, value: tok.value });
        col = null;
        op = null;
        continue;
      }
      throw new Error("fake db: unrecognised SQL chunk in a WHERE clause");
    }
    if (constraints.length === 0) {
      throw new Error("fake db: WHERE clause yielded no constraint — refusing to match everything");
    }
    return (row: any) =>
      constraints.every((c) => {
        const actual = row?.[c.key];
        if (c.op === "eq") return String(actual) === String(c.value);
        return likeToRegExp(String(c.value)).test(String(actual ?? ""));
      });
  }

  function selectBuilder(projection?: any) {
    const b: any = {
      _table: null,
      _where: null,
      _limit: null as number | null,
      from(t: any) {
        b._table = t;
        return b;
      },
      where(w: any) {
        b._where = w;
        return b;
      },
      limit(n: number) {
        b._limit = n;
        return b;
      },
      for() {
        return b;
      },
      then(resolve: any, reject: any) {
        return Promise.resolve()
          .then(() => {
            const source: any[] = isPayments(b._table)
              ? dbState.paymentRows
              : dbState.note
                ? [dbState.note]
                : [];
            let rows = source.filter(compile(b._where));
            if (b._limit !== null) rows = rows.slice(0, b._limit);
            if (projection && typeof projection === "object") {
              rows = rows.map((r) => {
                const out: any = {};
                for (const [k, col] of Object.entries(projection)) out[k] = r[columnKey(col)];
                return out;
              });
            }
            return rows;
          })
          .then(resolve, reject);
      },
    };
    return b;
  }

  function insertBuilder(table: any) {
    let values: any = null;
    const b: any = {
      values(v: any) {
        values = v;
        return b;
      },
      onConflictDoNothing() {
        return b;
      },
      async returning() {
        if (!isPayments(table)) return [];
        // The real unique partial index on payments.transaction_id.
        if (dbState.paymentRows.some((r) => r.transactionId === values.transactionId)) return [];
        const row = { id: dbState.nextId++, ...values };
        dbState.paymentRows.push(row);
        return [row];
      },
    };
    return b;
  }

  function updateBuilder(table: any) {
    let patch: any = null;
    let where: any = null;
    const b: any = {
      set(v: any) {
        patch = v;
        return b;
      },
      where(w: any) {
        where = w;
        return b;
      },
      async returning() {
        if (isPayments(table) || !dbState.note) return [];
        // The optimistic lock is IN the WHERE clause (id AND version), so a
        // fake that ignored it could never fail a lock conflict.
        if (!compile(where)(dbState.note)) return [];
        Object.assign(dbState.note, patch);
        return [dbState.note];
      },
    };
    return b;
  }

  return {
    select: (proj?: any) => selectBuilder(proj),
    insert: (t: any) => insertBuilder(t),
    update: (t: any) => updateBuilder(t),
  };
});

vi.mock("../../server/storage", () => ({
  storage: {
    getOrganization: vi.fn(async () => ({ id: 5, name: "Cedar Ridge Land Holdings LLC" })),
    getOrganizationIntegration: vi.fn(async () => null),
    getLead: vi.fn(async () => null),
    createSystemAlert: vi.fn(async () => undefined),
  },
  db: fakeDb,
}));

vi.mock("../../server/db", () => ({
  db: fakeDb,
  withTransaction: async (fn: any) => fn(fakeDb),
}));

const stripeCalls = vi.hoisted(() => ({ sessionLists: [] as any[] }));

vi.mock("../../server/stripeClient", () => ({
  STRIPE_API_VERSION: "2026-02-25.clover",
  getStripeSecretKey: () => "sk_test_123",
  getUncachableStripeClient: async () => ({
    checkout: {
      sessions: {
        list: async (params: any, options: any) => {
          stripeCalls.sessionLists.push({ params, options });
          return {
            data: [
              {
                id: "cs_borrower_1",
                metadata: { type: "borrower_portal_payment", organizationId: "5", noteId: "77" },
              },
            ],
          };
        },
      },
    },
  }),
}));

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../server/services/autopilot/perception", () => ({ recordSense: vi.fn() }));

import { payments as paymentsTable, notes as notesTable } from "@shared/schema";
import {
  deriveForm1098,
  deriveInterestBoxes,
  toOriginatedLedgerEntries,
  toAcquiredLedgerEntries,
  refundReversalTransactionId,
  parseReversalTransactionId,
  type Form1098Candidate,
  type Form1098LedgerEntry,
  type LenderIdentity,
} from "../../server/services/form1098Batch";
import { deriveRefundReversals } from "../../server/webhookHandlers";
// The PRODUCER of the ACH-return transaction id. The parser is pinned against
// this, never against the literal ":return" — see block 6.
import { reversalTransactionId as achReturnTransactionId } from "../../server/services/achAutopay";

schemaTables.payments = paymentsTable;
schemaTables.notes = notesTable;

// ── Fixtures ──────────────────────────────────────────────────────────────

const TAX_YEAR = 2025;
const NOTE_ID = 77;
const ORG_ID = 5;
const SESSION_ID = "cs_borrower_1";

/** The refunded payment: $500.00 = $150.00 principal + $350.00 interest. */
const PAYMENT_CENTS = 500_00;
const PAYMENT_PRINCIPAL_CENTS = 150_00;
const PAYMENT_INTEREST_CENTS = 350_00;

/** Eleven earlier 2025 payments, so the year clears the $600 threshold. */
const OTHER_2025_INTEREST_CENTS = 11 * 350_00;

const lender: LenderIdentity = {
  name: "Cedar Ridge Land Holdings LLC",
  address: { line1: "900 Congress Ave Ste 400", city: "Austin", state: "TX", zip: "78701" },
  phone: "5125550100",
  tin: "88-1234567",
  tinType: "EIN",
};

function candidate(ledger: Form1098LedgerEntry[]): Form1098Candidate {
  return {
    source: "originated",
    noteRef: `NOTE-${NOTE_ID}`,
    accountNumber: `NOTE-${NOTE_ID}`,
    originationDate: "2021-06-15",
    acquisitionDate: null,
    firstScheduledPaymentDate: "2021-07-01",
    originalPrincipalCents: 120_000_00,
    currentBalanceCents: 100_000_00,
    borrowerName: "Marisol Vega",
    borrowerAddress: { line1: "1420 Pecan Hollow Rd", city: "Bastrop", state: "TX", zip: "78602" },
    borrowerEncryptedTin: "412-88-7635",
    borrowerTinType: "SSN",
    propertyAddress: null,
    ledger,
  };
}

function expectForm(c: Form1098Candidate) {
  const out = deriveForm1098(c, lender, TAX_YEAR);
  if (out.kind !== "form") {
    throw new Error(`expected a form, got ${out.kind}: ${JSON.stringify(out)}`);
  }
  return out.form;
}

/** The `payments` rows a real note would hold: 2024 coverage + 12 of 2025. */
function seededPaymentRows() {
  const rows: any[] = [
    {
      id: 100,
      organizationId: ORG_ID,
      noteId: NOTE_ID,
      amount: "500.00",
      principalAmount: "150.00",
      interestAmount: "350.00",
      feeAmount: "0",
      lateFeeAmount: "0",
      paymentDate: new Date("2024-12-01T00:00:00Z"),
      dueDate: new Date("2024-12-01T00:00:00Z"),
      paymentMethod: "card",
      transactionId: "cs_prior_year",
      status: "completed",
    },
  ];
  for (let m = 1; m <= 11; m++) {
    rows.push({
      id: 100 + m,
      organizationId: ORG_ID,
      noteId: NOTE_ID,
      amount: "500.00",
      principalAmount: "150.00",
      interestAmount: "350.00",
      feeAmount: "0",
      lateFeeAmount: "0",
      paymentDate: new Date(`2025-${String(m).padStart(2, "0")}-01T00:00:00Z`),
      dueDate: new Date(`2025-${String(m).padStart(2, "0")}-01T00:00:00Z`),
      paymentMethod: "card",
      transactionId: `cs_month_${m}`,
      status: "completed",
    });
  }
  // The payment that gets refunded.
  rows.push({
    id: 200,
    organizationId: ORG_ID,
    noteId: NOTE_ID,
    amount: "500.00",
    principalAmount: "150.00",
    interestAmount: "350.00",
    feeAmount: "0",
    lateFeeAmount: "0",
    paymentDate: new Date("2025-12-01T00:00:00Z"),
    dueDate: new Date("2025-12-01T00:00:00Z"),
    paymentMethod: "card",
    transactionId: SESSION_ID,
    status: "completed",
  });
  return rows;
}

function ledgerFromDb(): Form1098LedgerEntry[] {
  return toOriginatedLedgerEntries(dbState.paymentRows as any).get(NOTE_ID) ?? [];
}

function box1FromDb(taxYear = TAX_YEAR): number {
  return deriveInterestBoxes(ledgerFromDb(), taxYear).box1Cents;
}

const epoch = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

function refundEvent(opts: {
  amountRefundedCents: number;
  refunds: Array<{ id: string; amountCents: number; iso: string }>;
  account?: string | null;
}) {
  return {
    id: `evt_${opts.refunds.map((r) => r.id).join("_")}`,
    type: "charge.refunded",
    account: opts.account === undefined ? "acct_lender_own" : opts.account,
    data: {
      object: {
        id: "ch_borrower_1",
        payment_intent: "pi_borrower_1",
        created: epoch("2025-12-01T00:00:00Z"),
        amount: PAYMENT_CENTS,
        amount_refunded: opts.amountRefundedCents,
        refunds: {
          data: opts.refunds.map((r) => ({
            id: r.id,
            amount: r.amountCents,
            status: "succeeded",
            created: epoch(r.iso),
          })),
        },
      },
    },
  } as any;
}

async function fireConnectWebhook(event: any) {
  const { stripeConnectService } = await import("../../server/services/stripeConnect");
  await stripeConnectService.handleWebhookEvent(event);
}

beforeEach(() => {
  dbState.paymentRows = seededPaymentRows();
  dbState.note = {
    id: NOTE_ID,
    organizationId: ORG_ID,
    currentBalance: "100000.00",
    status: "active",
    version: 1,
  };
  dbState.nextId = 900;
  stripeCalls.sessionLists.length = 0;
});

// ───────────────────────────────────────────────────────────────────────────
// 1. END TO END — a real refund event must change the real tax figure
// ───────────────────────────────────────────────────────────────────────────

describe("charge.refunded → note ledger → Form 1098 Box 1", () => {
  it("VACUITY: with no refund, the seeded year reports every cent of interest", () => {
    // If this ever goes to zero or empty, every "the refund was removed"
    // assertion below would pass for the wrong reason.
    const box1 = box1FromDb();
    expect(box1).toBe(OTHER_2025_INTEREST_CENTS + PAYMENT_INTEREST_CENTS);
    expect(box1).toBeGreaterThan(0);
    expect(ledgerFromDb().length).toBe(13);

    const form = expectForm(candidate(ledgerFromDb()));
    expect(form.box1MortgageInterestReceivedCents).toBe(
      OTHER_2025_INTEREST_CENTS + PAYMENT_INTEREST_CENTS,
    );
    expect(form.box4RefundOfOverpaidInterestCents).toBe(0);
  });

  it("a FULL refund removes that payment's interest from Box 1 — and only that payment's", async () => {
    await fireConnectWebhook(
      refundEvent({
        amountRefundedCents: PAYMENT_CENTS,
        refunds: [{ id: "re_full", amountCents: PAYMENT_CENTS, iso: "2025-12-20T12:00:00Z" }],
      }),
    );

    // History PRESERVED: the original row is untouched, a reversing row was
    // appended beside it.
    const original = dbState.paymentRows.find((r) => r.transactionId === SESSION_ID);
    expect(original.status).toBe("completed");
    expect(original.interestAmount).toBe("350.00");

    const reversal = dbState.paymentRows.find(
      (r) => r.transactionId === refundReversalTransactionId(SESSION_ID, "re_full"),
    );
    expect(reversal, "a reversing ledger row must be appended").toBeDefined();
    expect(Number(reversal.interestAmount)).toBe(-350);
    expect(Number(reversal.principalAmount)).toBe(-150);

    // THE FIGURE THAT REACHES THE IRS.
    const form = expectForm(candidate(ledgerFromDb()));
    expect(form.box1MortgageInterestReceivedCents).toBe(OTHER_2025_INTEREST_CENTS);
    expect(form.box4RefundOfOverpaidInterestCents).toBe(0);
  });

  it("restores the refunded principal to the note balance", async () => {
    expect(dbState.note.currentBalance).toBe("100000.00");
    await fireConnectWebhook(
      refundEvent({
        amountRefundedCents: PAYMENT_CENTS,
        refunds: [{ id: "re_full", amountCents: PAYMENT_CENTS, iso: "2025-12-20T12:00:00Z" }],
      }),
    );
    expect(Number(dbState.note.currentBalance)).toBe(100_150);
    expect(dbState.note.version).toBe(2);
  });

  it.each(["active", "late", "delinquent", "defaulted"])(
    "a refund NEVER clears a delinquency — a '%s' note keeps that status",
    async (status) => {
      // `status: newBalance > 0 ? 'active' : locked.status` looks like it only
      // un-pays-off a note. It also resets 'late', 'delinquent' and
      // 'defaulted' to 'active' — silently erasing a delinquency the product
      // reads as truth (routes-finance.ts branches on 'defaulted';
      // routes-today.ts on 'late'/'delinquent'). A refund says nothing about
      // whether the borrower is current, so only 'paid_off' may be lifted.
      dbState.note.status = status;
      await fireConnectWebhook(
        refundEvent({
          amountRefundedCents: PAYMENT_CENTS,
          refunds: [{ id: "re_full", amountCents: PAYMENT_CENTS, iso: "2025-12-20T12:00:00Z" }],
        }),
      );
      // The reversal really did post — otherwise the status is unchanged for
      // the boring reason.
      expect(Number(dbState.note.currentBalance)).toBe(100_150);
      expect(dbState.note.version).toBe(2);
      expect(dbState.note.status).toBe(status);
    },
  );

  it("lifts ONLY 'paid_off' — a refund that un-pays-off a note reopens it", async () => {
    dbState.note.currentBalance = "0.00";
    dbState.note.status = "paid_off";
    await fireConnectWebhook(
      refundEvent({
        amountRefundedCents: PAYMENT_CENTS,
        refunds: [{ id: "re_full", amountCents: PAYMENT_CENTS, iso: "2025-12-20T12:00:00Z" }],
      }),
    );
    expect(Number(dbState.note.currentBalance)).toBe(150);
    expect(dbState.note.status).toBe("active");
  });

  it("reverses the row THIS checkout session wrote, not the first row on the note", async () => {
    // A second completed payment on the same note and org, carrying DIFFERENT
    // money, seeded ahead of the refunded one. The handler's lookup is
    // `where(eq(payments.transactionId, session.id))`; if that predicate were
    // ignored — or the query pointed at the wrong column — this row is what a
    // `.slice(0, 1)` would return, and the refund would reverse $800 of
    // interest that was never refunded.
    dbState.paymentRows.unshift({
      id: 50,
      organizationId: ORG_ID,
      noteId: NOTE_ID,
      amount: "900.00",
      principalAmount: "100.00",
      interestAmount: "800.00",
      feeAmount: "0",
      lateFeeAmount: "0",
      paymentDate: new Date("2025-02-15T00:00:00Z"),
      dueDate: new Date("2025-02-01T00:00:00Z"),
      paymentMethod: "card",
      transactionId: "cs_unrelated_bigger",
      status: "completed",
    });

    await fireConnectWebhook(
      refundEvent({
        amountRefundedCents: PAYMENT_CENTS,
        refunds: [{ id: "re_full", amountCents: PAYMENT_CENTS, iso: "2025-12-20T12:00:00Z" }],
      }),
    );

    const reversal = dbState.paymentRows.find(
      (r) => r.transactionId === refundReversalTransactionId(SESSION_ID, "re_full"),
    );
    expect(reversal, "a reversing ledger row must be appended").toBeDefined();
    expect(Number(reversal.interestAmount)).toBe(-350);
    expect(Number(reversal.principalAmount)).toBe(-150);
    // The period it reverses is the REFUNDED payment's, not the other row's.
    expect(new Date(reversal.dueDate).toISOString()).toBe("2025-12-01T00:00:00.000Z");

    // The unrelated payment is untouched, and its interest still reaches the form.
    const unrelated = dbState.paymentRows.find((r) => r.transactionId === "cs_unrelated_bigger");
    expect(unrelated.interestAmount).toBe("800.00");
    expect(box1FromDb()).toBe(OTHER_2025_INTEREST_CENTS + 800_00);
    expect(Number(dbState.note.currentBalance)).toBe(100_150);
  });

  it("a PARTIAL refund removes only the refunded share of the interest", async () => {
    // $200 of a $500 payment = 40%. 40% of $350 interest = $140.
    await fireConnectWebhook(
      refundEvent({
        amountRefundedCents: 200_00,
        refunds: [{ id: "re_partial", amountCents: 200_00, iso: "2025-12-20T12:00:00Z" }],
      }),
    );

    const reversal = dbState.paymentRows.find(
      (r) => r.transactionId === refundReversalTransactionId(SESSION_ID, "re_partial"),
    );
    expect(Number(reversal.interestAmount)).toBe(-140);
    expect(Number(reversal.principalAmount)).toBe(-60);

    const form = expectForm(candidate(ledgerFromDb()));
    expect(form.box1MortgageInterestReceivedCents).toBe(
      OTHER_2025_INTEREST_CENTS + PAYMENT_INTEREST_CENTS - 140_00,
    );
    expect(Number(dbState.note.currentBalance)).toBe(100_060);
  });

  it("a SECOND partial refund completing the payment reverses exactly the remainder", async () => {
    await fireConnectWebhook(
      refundEvent({
        amountRefundedCents: 200_00,
        refunds: [{ id: "re_partial", amountCents: 200_00, iso: "2025-12-20T12:00:00Z" }],
      }),
    );
    await fireConnectWebhook(
      refundEvent({
        amountRefundedCents: PAYMENT_CENTS,
        refunds: [
          { id: "re_partial", amountCents: 200_00, iso: "2025-12-20T12:00:00Z" },
          { id: "re_rest", amountCents: 300_00, iso: "2025-12-22T12:00:00Z" },
        ],
      }),
    );

    // Both reversals together net the payment to exactly zero — no stray cent
    // of interest survives on the form.
    expect(box1FromDb()).toBe(OTHER_2025_INTEREST_CENTS);
    expect(Number(dbState.note.currentBalance)).toBe(100_150);
  });

  it("is idempotent — a redelivered event posts nothing a second time", async () => {
    const event = refundEvent({
      amountRefundedCents: PAYMENT_CENTS,
      refunds: [{ id: "re_full", amountCents: PAYMENT_CENTS, iso: "2025-12-20T12:00:00Z" }],
    });
    await fireConnectWebhook(event);
    const afterFirst = dbState.paymentRows.length;
    await fireConnectWebhook(event);
    expect(dbState.paymentRows.length).toBe(afterFirst);
    expect(Number(dbState.note.currentBalance)).toBe(100_150);
    expect(box1FromDb()).toBe(OTHER_2025_INTEREST_CENTS);
  });

  it("looks the charge up on the LENDER'S account, never AcreOS's", async () => {
    await fireConnectWebhook(
      refundEvent({
        amountRefundedCents: PAYMENT_CENTS,
        refunds: [{ id: "re_full", amountCents: PAYMENT_CENTS, iso: "2025-12-20T12:00:00Z" }],
      }),
    );
    expect(stripeCalls.sessionLists).toHaveLength(1);
    expect(stripeCalls.sessionLists[0].options.stripeAccount).toBe("acct_lender_own");
  });

  it("writes NOTHING when the connected account is unknown — refusal, not a guess", async () => {
    const before = dbState.paymentRows.length;
    await fireConnectWebhook(
      refundEvent({
        amountRefundedCents: PAYMENT_CENTS,
        refunds: [{ id: "re_full", amountCents: PAYMENT_CENTS, iso: "2025-12-20T12:00:00Z" }],
        account: null,
      }),
    );
    expect(dbState.paymentRows.length).toBe(before);
    expect(box1FromDb()).toBe(OTHER_2025_INTEREST_CENTS + PAYMENT_INTEREST_CENTS);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2. A refund that crosses a tax year is Box 4, not a silent Box 1 haircut
// ───────────────────────────────────────────────────────────────────────────

describe("a refund crossing a year boundary lands in Box 4", () => {
  it("VACUITY: 2026 is a LIVE window — a 2026 payment reports real interest in it", () => {
    // The assertions below say "2026 Box 1 stayed at 0". That is only
    // meaningful if 2026 is a window this splitter can see at all: an
    // off-by-one in the year bounds, or a fixture whose rows all fall
    // outside it, would produce the same 0 for the wrong reason. So prove
    // the window carries a real, non-zero figure first.
    const withA2026Payment: Form1098LedgerEntry[] = [
      ...ledgerFromDb(),
      { date: "2026-01-05", principalCents: 150_00, interestCents: 350_00 },
      { date: "2026-12-31", principalCents: 150_00, interestCents: 350_00 },
    ];
    const boxes = deriveInterestBoxes(withA2026Payment, 2026);
    expect(boxes.box1Cents).toBe(700_00);
    expect(boxes.box1Cents).toBeGreaterThan(0);
  });

  it("reimburses in the refund's year and leaves the receipt year alone", async () => {
    await fireConnectWebhook(
      refundEvent({
        amountRefundedCents: PAYMENT_CENTS,
        // Refunded in FEBRUARY — a year after the interest was received and
        // reported to the IRS.
        refunds: [{ id: "re_next_year", amountCents: PAYMENT_CENTS, iso: "2026-02-14T12:00:00Z" }],
      }),
    );

    // 2025 is unchanged: that interest really was received during 2025.
    const y2025 = deriveInterestBoxes(ledgerFromDb(), 2025);
    expect(y2025.box1Cents).toBe(OTHER_2025_INTEREST_CENTS + PAYMENT_INTEREST_CENTS);

    // 2026 reports the reimbursement in Box 4 — and does NOT quietly shrink
    // 2026's Box 1, which is what a naive signed sum would do.
    const y2026 = deriveInterestBoxes(ledgerFromDb(), 2026);
    expect(y2026.box4Cents).toBe(PAYMENT_INTEREST_CENTS);
    expect(y2026.box1Cents).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 3. The pure allocator — partial refunds, cumulatively, without drift
// ───────────────────────────────────────────────────────────────────────────

describe("deriveRefundReversals", () => {
  const original = {
    amountCents: PAYMENT_CENTS,
    principalCents: PAYMENT_PRINCIPAL_CENTS,
    interestCents: PAYMENT_INTEREST_CENTS,
    feeCents: 0,
    lateFeeCents: 0,
  };

  it("VACUITY: a full refund reverses exactly the original, to the cent", () => {
    const [row] = deriveRefundReversals({
      original,
      refunds: [{ id: "re_1", amountCents: PAYMENT_CENTS, createdIso: "2025-12-20T00:00:00Z" }],
      alreadyReversedRefundIds: new Set(),
    });
    expect(row).toBeDefined();
    expect(row.amountCents).toBe(-PAYMENT_CENTS);
    expect(row.principalCents).toBe(-PAYMENT_PRINCIPAL_CENTS);
    expect(row.interestCents).toBe(-PAYMENT_INTEREST_CENTS);
  });

  it("splits three uneven partials with no rounding drift", () => {
    const rows = deriveRefundReversals({
      original,
      refunds: [
        { id: "a", amountCents: 166_67, createdIso: "2025-12-01T00:00:00Z" },
        { id: "b", amountCents: 166_67, createdIso: "2025-12-02T00:00:00Z" },
        { id: "c", amountCents: 166_66, createdIso: "2025-12-03T00:00:00Z" },
      ],
      alreadyReversedRefundIds: new Set(),
    });
    expect(rows).toHaveLength(3);
    expect(rows.reduce((s, r) => s + r.interestCents, 0)).toBe(-PAYMENT_INTEREST_CENTS);
    expect(rows.reduce((s, r) => s + r.principalCents, 0)).toBe(-PAYMENT_PRINCIPAL_CENTS);
  });

  it("skips refunds already reversed but still counts them toward the total", () => {
    const rows = deriveRefundReversals({
      original,
      refunds: [
        { id: "a", amountCents: 200_00, createdIso: "2025-12-01T00:00:00Z" },
        { id: "b", amountCents: 300_00, createdIso: "2025-12-05T00:00:00Z" },
      ],
      alreadyReversedRefundIds: new Set(["a"]),
    });
    expect(rows.map((r) => r.refundId)).toEqual(["b"]);
    // "a" already took $140 of interest; "b" reverses only the rest.
    expect(rows[0].interestCents).toBe(-(PAYMENT_INTEREST_CENTS - 140_00));
  });

  it("refuses to proportion against a non-positive original", () => {
    expect(
      deriveRefundReversals({
        original: { ...original, amountCents: 0 },
        refunds: [{ id: "a", amountCents: 100, createdIso: "2025-12-01T00:00:00Z" }],
        alreadyReversedRefundIds: new Set(),
      }),
    ).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 4. Reversals we cannot place are REFUSED, never guessed
// ───────────────────────────────────────────────────────────────────────────

describe("unplaceable reversals refuse the form", () => {
  function ledgerWith(entry: Form1098LedgerEntry): Form1098LedgerEntry[] {
    return [
      { date: "2024-12-01", principalCents: 150_00, interestCents: 350_00 },
      ...Array.from({ length: 12 }, (_, m) => ({
        date: `2025-${String(m + 1).padStart(2, "0")}-01`,
        principalCents: 150_00,
        interestCents: 350_00,
      })),
      entry,
    ];
  }

  it("VACUITY: the same ledger without the odd entry produces a form with a real figure", () => {
    // "it refused" is only evidence if the identical ledger, minus the one
    // entry under test, does NOT refuse — and reports a real number rather
    // than an empty one.
    const out = deriveForm1098(
      candidate(ledgerWith({ date: "2025-12-15", principalCents: 150_00, interestCents: 350_00 })),
      lender,
      TAX_YEAR,
    );
    expect(out.kind).toBe("form");
    if (out.kind !== "form") throw new Error("unreachable");
    // Twelve 2025 payments plus the extra one; the 2024 row is out of year.
    expect(out.form.box1MortgageInterestReceivedCents).toBe(13 * 350_00);
    expect(out.form.box1MortgageInterestReceivedCents).toBeGreaterThan(0);
    expect(out.form.box4RefundOfOverpaidInterestCents).toBe(0);
  });

  it("refuses when a reversal cannot be matched to the payment it reverses", () => {
    const out = deriveForm1098(
      candidate(
        ledgerWith({
          date: "2025-12-15",
          principalCents: -150_00,
          interestCents: -350_00,
          reversal: { kind: "refund", originalDate: null },
        }),
      ),
      lender,
      TAX_YEAR,
    );
    expect(out.kind).toBe("refusal");
    if (out.kind === "refusal") {
      expect(out.refusal.codes).toContain("REVERSAL_ORIGIN_UNRESOLVED");
    }
  });

  it("refuses a prior-year BOUNCED payment instead of shrinking this year's Box 1", () => {
    // Money that never cleared is not a Box 4 reimbursement — the EARLIER
    // year's form is the wrong one and needs a corrected filing.
    const out = deriveForm1098(
      candidate(
        ledgerWith({
          date: "2025-03-02",
          principalCents: -150_00,
          interestCents: -350_00,
          reversal: { kind: "nonpayment", originalDate: "2024-12-01" },
        }),
      ),
      lender,
      TAX_YEAR,
    );
    expect(out.kind).toBe("refusal");
    if (out.kind === "refusal") {
      expect(out.refusal.codes).toContain("PRIOR_YEAR_NONPAYMENT_REVERSAL");
      expect(out.refusal.reason).toMatch(/CORRECTED/);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 5. An ACH return must not subtract the same interest twice
// ───────────────────────────────────────────────────────────────────────────

describe("ACH return (original struck, reversal appended)", () => {
  const achRows = [
    {
      noteId: NOTE_ID,
      paymentDate: new Date("2025-06-01T00:00:00Z"),
      principalAmount: "150.00",
      interestAmount: "350.00",
      transactionId: "pi_ach_1",
      status: "completed",
    },
  ];

  it("VACUITY: while the ACH payment stands, its interest is in Box 1", () => {
    const entries = toOriginatedLedgerEntries(achRows as any).get(NOTE_ID)!;
    expect(deriveInterestBoxes(entries, TAX_YEAR).box1Cents).toBe(350_00);
  });

  it("nets to zero once achAutopay marks the original failed and appends the reversal", () => {
    const returned = [
      { ...achRows[0], status: "failed" },
      {
        noteId: NOTE_ID,
        paymentDate: new Date("2025-06-08T00:00:00Z"),
        principalAmount: "-150.00",
        interestAmount: "-350.00",
        transactionId: achReturnTransactionId("pi_ach_1"),
        status: "completed",
      },
    ];
    const entries = toOriginatedLedgerEntries(returned as any).get(NOTE_ID) ?? [];
    // Not -350_00: the struck original never entered the sum, so subtracting
    // it again would understate Box 1 by the whole returned payment.
    expect(deriveInterestBoxes(entries, TAX_YEAR).box1Cents).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 6. One reversal-link convention, shared by the writer and the reader
// ───────────────────────────────────────────────────────────────────────────

describe("the reversal link", () => {
  it("VACUITY: the encoder produces a real, distinct, decodable id", () => {
    // "an ordinary id parses to null" and "an ACH id parses to nonpayment"
    // would both hold for a degenerate encoder that returned its input, or
    // for a parser that returned null for everything. Pin a real value first.
    const txId = refundReversalTransactionId("cs_abc_123", "re_xyz_789");
    expect(txId).toContain("cs_abc_123");
    expect(txId).toContain("re_xyz_789");
    expect(txId).not.toBe("cs_abc_123");
    expect(txId.length).toBeGreaterThan("cs_abc_123re_xyz_789".length);
    expect(parseReversalTransactionId(txId)).not.toBeNull();
  });

  it("round-trips a refund id the webhook wrote back to the row it reverses", () => {
    const txId = refundReversalTransactionId("cs_abc_123", "re_xyz_789");
    const link = parseReversalTransactionId(txId);
    expect(link).toEqual({ originalTransactionId: "cs_abc_123", kind: "refund" });
  });

  it("decodes what achAutopay's PRODUCER actually emits — not a hardcoded ':return'", () => {
    // achAutopay.ts owns the ACH-return id format; form1098Batch derives its
    // suffix from that producer instead of restating the literal. Pinning
    // this test to the literal would recreate exactly the drift the
    // derivation removes: rename the suffix at the producer and a
    // literal-pinned test keeps passing while the parser goes blind and
    // reports returned interest to the IRS as interest received.
    const produced = achReturnTransactionId("pi_abc");
    expect(parseReversalTransactionId(produced)).toEqual({
      originalTransactionId: "pi_abc",
      kind: "nonpayment",
    });
    // ...and the two conventions stay distinguishable from each other.
    expect(parseReversalTransactionId(produced)!.kind).not.toBe(
      parseReversalTransactionId(refundReversalTransactionId("pi_abc", "re_1"))!.kind,
    );
  });

  it("treats an ordinary processor id as an ordinary payment", () => {
    expect(parseReversalTransactionId("cs_test_abc123")).toBeNull();
    expect(parseReversalTransactionId(null)).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 7. The acquired ledger carries the same reversal truth
// ───────────────────────────────────────────────────────────────────────────

describe("acquired-note NSF reversals", () => {
  const base = {
    noteId: "anote-1",
    paymentType: "regular",
    originalPaymentId: null as string | null,
  };

  it("VACUITY: a plain acquired ledger reports its interest", () => {
    const entries = toAcquiredLedgerEntries([
      { ...base, id: "p1", paymentDate: "2025-04-01", principalCents: 150_00, interestCents: 350_00 },
    ]).get("anote-1")!;
    expect(deriveInterestBoxes(entries, TAX_YEAR).box1Cents).toBe(350_00);
  });

  it("nets a same-year NSF reversal out of Box 1", () => {
    const entries = toAcquiredLedgerEntries([
      { ...base, id: "p1", paymentDate: "2025-04-01", principalCents: 150_00, interestCents: 350_00 },
      {
        ...base,
        id: "p2",
        paymentDate: "2025-04-20",
        principalCents: -150_00,
        interestCents: -350_00,
        paymentType: "nsf_reversal",
        originalPaymentId: "p1",
      },
    ]).get("anote-1")!;
    expect(deriveInterestBoxes(entries, TAX_YEAR).box1Cents).toBe(0);
  });

  it("refuses a reversal whose original payment is not identified", () => {
    const entries = toAcquiredLedgerEntries([
      { ...base, id: "p1", paymentDate: "2025-04-01", principalCents: 150_00, interestCents: 350_00 },
      {
        ...base,
        id: "p2",
        paymentDate: "2025-04-20",
        principalCents: -150_00,
        interestCents: -350_00,
        paymentType: "nsf_reversal",
        originalPaymentId: null,
      },
    ]).get("anote-1")!;
    expect(deriveInterestBoxes(entries, TAX_YEAR).refusalCodes).toContain("REVERSAL_ORIGIN_UNRESOLVED");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 8. Placeholder TINs are refused on the ACQUIRED side too
// ───────────────────────────────────────────────────────────────────────────

describe("acquired notes get the same placeholder-TIN refusal as originated ones", () => {
  const acquiredLedger: Form1098LedgerEntry[] = [
    { date: "2024-12-01", principalCents: 150_00, interestCents: 350_00 },
    ...Array.from({ length: 12 }, (_, m) => ({
      date: `2025-${String(m + 1).padStart(2, "0")}-01`,
      principalCents: 150_00,
      interestCents: 350_00,
    })),
  ];

  function acquiredCandidate(tin: string | null): Form1098Candidate {
    return { ...candidate(acquiredLedger), source: "acquired", noteRef: "ANOTE-7", accountNumber: "ANOTE-7", borrowerEncryptedTin: tin };
  }

  it("VACUITY: a real TIN on an acquired note still produces a form with a real figure", () => {
    const out = deriveForm1098(acquiredCandidate("412-88-7635"), lender, TAX_YEAR);
    expect(out.kind).toBe("form");
    if (out.kind !== "form") throw new Error("unreachable");
    // Twelve 2025 payments; the 2024 row is outside the year.
    expect(out.form.box1MortgageInterestReceivedCents).toBe(12 * 350_00);
    expect(out.form.box1MortgageInterestReceivedCents).toBeGreaterThan(0);
  });

  it("refuses a placeholder TIN rather than filing it", () => {
    for (const placeholder of ["000-00-0000", "000000000", "00-0000000"]) {
      const out = deriveForm1098(acquiredCandidate(placeholder), lender, TAX_YEAR);
      expect(out.kind).toBe("refusal");
      if (out.kind === "refusal") expect(out.refusal.codes).toContain("BORROWER_TIN_PLACEHOLDER");
    }
  });
});
