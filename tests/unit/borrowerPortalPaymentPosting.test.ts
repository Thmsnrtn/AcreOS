/**
 * ONE posting rule for a borrower's Checkout payment (DEFECT-0096).
 *
 * Until 2026-09-27 a borrower's Stripe Checkout Session was posted by TWO live
 * writers that disagreed about what the payment meant:
 *
 *   browser return  — integer-cent split, grace-aware late fee, atomic
 *                     ON CONFLICT insert, `payment.received` event, no receipt;
 *   Connect webhook — float schedule-ratio split (.toFixed(2)), late fee "0",
 *                     read-then-write dedupe, NO event, the only receipt email.
 *
 * Which ran first was network timing. Both also marked the next installment
 * `paid` and moved the due date a month for ANY amount.
 *
 * These tests pin the shared rule through a real in-memory ledger keyed on
 * `transaction_id`, so ON CONFLICT means what Postgres means by it:
 *
 *   (1) order symmetry — browser-first and webhook-first produce the same
 *       principal / interest / late fee / balance / next due date;
 *   (2) a partial payment leaves the installment pending and the due date put;
 *   (3) the second writer creates no second row, no second event, no second
 *       receipt — and the winner emits exactly one of each;
 *   (4) an `unpaid` session is refused before any write.
 *
 * At HEAD before the fix, (1) fails on `lateFeeAmount` ("25.00" vs "0") and on
 * the split; (2) fails on both writers; (3) fails with 0 emails / 2 events on
 * one order and 1 / 1 on the other.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── In-memory ledger with a real unique constraint on transaction_id ─────────
type PaymentRow = Record<string, any> & { id: number; transactionId: string };
const state = vi.hoisted(() => ({
  payments: new Map<string, PaymentRow>(),
  nextId: 1,
  noteBalance: "10000.00",
  noteVersion: 1,
  updateNoteCalls: [] as Array<{ id: number; patch: Record<string, unknown>; orgId: number | undefined }>,
  emails: [] as Array<Record<string, unknown>>,
  activities: [] as Array<Record<string, unknown>>,
  events: [] as Array<{ type: string; orgId: number; entityId: number; data: Record<string, any> }>,
}));

function resetState() {
  state.payments.clear();
  state.nextId = 1;
  state.noteBalance = "10000.00";
  state.noteVersion = 1;
  state.updateNoteCalls.length = 0;
  state.emails.length = 0;
  state.activities.length = 0;
  state.events.length = 0;
}

vi.mock("../../server/db", () => {
  // A tiny drizzle-shaped tx over the in-memory ledger. `insert(payments)`
  // honours ON CONFLICT (transaction_id) DO NOTHING RETURNING *; `select`
  // returns the locked note or the existing payment; `update(notes)` applies
  // the balance/version write.
  const tx = {
    insert: () => ({
      values: (vals: any) => ({
        onConflictDoNothing: () => ({
          returning: async () => {
            if (state.payments.has(vals.transactionId)) return [];
            const row = { id: state.nextId++, ...vals };
            state.payments.set(vals.transactionId, row);
            return [row];
          },
        }),
      }),
    }),
    select: () => ({
      from: (table: any) => ({
        where: (_w: any) => {
          const chain: any = {
            for: () => chain,
            then: (ok: any, no: any) => {
              const rows =
                table === MOCK_TABLES.payments
                  ? [state.payments.get(LAST_CONFLICT_ID.id)!]
                  : [{ ...NOTE_ROW, currentBalance: state.noteBalance, version: state.noteVersion }];
              return Promise.resolve(rows).then(ok, no);
            },
          };
          return chain;
        },
      }),
    }),
    update: () => ({
      set: (vals: any) => ({
        where: () => ({
          returning: async () => {
            state.noteBalance = vals.currentBalance;
            state.noteVersion = vals.version;
            return [{ id: NOTE_ROW.id }];
          },
        }),
      }),
    }),
  };
  return {
    db: {},
    withTransaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  };
});

// Which table a `select().from(x)` was asked for, and which transaction id the
// conflict branch is re-reading. The schema tables are real objects, so the mock
// compares identity.
const MOCK_TABLES = vi.hoisted(() => ({ payments: null as any }));
const LAST_CONFLICT_ID = vi.hoisted(() => ({ id: "" }));

vi.mock("../../server/storage", () => ({
  storage: {
    updateNote: vi.fn(async (id: number, patch: Record<string, unknown>, orgId?: number) => {
      state.updateNoteCalls.push({ id, patch, orgId });
      return { ...NOTE_ROW, ...patch };
    }),
    getLead: vi.fn(async () => ({ id: 9, email: "borrower@example.com", firstName: "Bea", lastName: "Rowe" })),
    getOrganization: vi.fn(async () => ({ id: 7, name: "Acme Lender" })),
    logActivity: vi.fn(async (entry: Record<string, unknown>) => {
      state.activities.push(entry);
    }),
  },
  db: {},
}));

vi.mock("../../server/services/workflow-engine", () => ({
  emitPaymentEvent: vi.fn((type: string, orgId: number, entityId: number, data: Record<string, any>) => {
    state.events.push({ type, orgId, entityId, data });
  }),
}));

vi.mock("../../server/services/emailService", () => ({
  emailService: {
    sendEmail: vi.fn(async (opts: Record<string, unknown>) => {
      state.emails.push(opts);
      return { success: true, messageId: "m_1" };
    }),
  },
}));

vi.mock("../../server/services/activation", () => ({
  recordActivationEventAsync: vi.fn(),
}));

import { payments as paymentsTable, type Note } from "@shared/schema";
import {
  postBorrowerPortalCheckoutPayment,
  type PortalCheckoutSession,
} from "../../server/services/borrower/portalPaymentPosting";

MOCK_TABLES.payments = paymentsTable;

// Due 2026-09-01, 10-day grace, $25 late fee. Paid on 2026-09-20 → 19 days
// late → fee applies.
const NOTE_ROW = {
  id: 42,
  organizationId: 7,
  borrowerId: 9,
  currentBalance: "10000.00",
  interestRate: "6",
  monthlyPayment: "100.00",
  lateFee: "25",
  gracePeriodDays: 10,
  nextPaymentDate: new Date("2026-09-01T00:00:00Z"),
  startDate: new Date("2026-01-01T00:00:00Z"),
  pendingCheckoutSessionId: "cs_1",
  amortizationSchedule: [
    { paymentNumber: 1, dueDate: "2026-09-01", payment: 100, principal: 50, interest: 50, balance: 9950, status: "pending" },
    { paymentNumber: 2, dueDate: "2026-10-01", payment: 100, principal: 50.25, interest: 49.75, balance: 9899.75, status: "pending" },
  ],
  status: "active",
  version: 1,
} as unknown as Note;

const NOW = new Date("2026-09-20T15:00:00Z");

function session(overrides: Partial<PortalCheckoutSession> = {}): PortalCheckoutSession {
  return {
    id: "cs_1",
    amount_total: 10000,
    payment_status: "paid",
    metadata: { type: "borrower_portal_payment", noteId: "42", organizationId: "7" },
    ...overrides,
  } as PortalCheckoutSession;
}

async function post(source: "borrower_portal" | "stripe_webhook" | "payment_link", s = session()) {
  LAST_CONFLICT_ID.id = s.id;
  return postBorrowerPortalCheckoutPayment({ note: NOTE_ROW, stripeSession: s, source, now: NOW });
}

/** The ledger facts the two writers used to disagree about. */
function ledgerFacts() {
  const row = [...state.payments.values()][0];
  return {
    amount: row.amount,
    principalAmount: row.principalAmount,
    interestAmount: row.interestAmount,
    lateFeeAmount: row.lateFeeAmount,
    noteBalance: state.noteBalance,
    nextPaymentDate: state.updateNoteCalls.at(-1)?.patch.nextPaymentDate ?? null,
    scheduleStatuses: (state.updateNoteCalls.at(-1)?.patch.amortizationSchedule as any[] | undefined)?.map(
      (s) => s.status,
    ),
  };
}

describe("postBorrowerPortalCheckoutPayment — one rule for both writers", () => {
  beforeEach(resetState);

  it("(1) browser-first and webhook-first post identical ledger facts for the same session", async () => {
    await post("borrower_portal");
    await post("stripe_webhook");
    const browserFirst = ledgerFacts();

    resetState();
    await post("stripe_webhook");
    await post("borrower_portal");
    const webhookFirst = ledgerFacts();

    expect(webhookFirst).toEqual(browserFirst);

    // And the facts themselves are the browser path's rule: integer-cent
    // split (6% on $10,000 for one month = $50.00 interest), grace-aware late
    // fee (19 days late against a 10-day grace → the $25 the note states).
    expect(browserFirst.interestAmount).toBe("50");
    expect(browserFirst.principalAmount).toBe("50");
    expect(browserFirst.lateFeeAmount).toBe("25");
    expect(browserFirst.noteBalance).toBe("9950");
    expect(browserFirst.scheduleStatuses).toEqual(["paid", "pending"]);
    expect(browserFirst.nextPaymentDate).toEqual(new Date("2026-10-01T00:00:00Z"));
  });

  it("(2) a $50 payment against a $100 installment leaves the installment pending and the due date put", async () => {
    const result = await post("borrower_portal", session({ amount_total: 5000 }));
    expect(result.outcome).toBe("posted");
    if (result.outcome !== "posted") return;

    expect(result.installment).toBe("partial");
    // The money is real: ledger row and balance move.
    expect(state.payments.size).toBe(1);
    expect(state.noteBalance).not.toBe("10000.00");
    // The installment is not: no schedule row marked, no month added.
    const patch = state.updateNoteCalls.at(-1)?.patch ?? {};
    expect(patch).not.toHaveProperty("amortizationSchedule");
    expect(patch).not.toHaveProperty("nextPaymentDate");
    expect(result.nextPaymentDate).toEqual(NOTE_ROW.nextPaymentDate);
    // The pending-checkout slot naming THIS session is still cleared.
    expect(patch).toHaveProperty("pendingCheckoutSessionId", null);
    // The workflow event says so.
    expect(state.events).toHaveLength(1);
    expect(state.events[0].data.isPartial).toBe(true);
    expect(state.events[0].data.isFullPayment).toBe(false);
    // The receipt says so.
    expect(state.emails).toHaveLength(1);
    expect(String(state.emails[0].text)).toMatch(/partial payment/i);
  });

  it("(3) the second writer creates no second row, no second event, no second receipt", async () => {
    const first = await post("borrower_portal");
    const second = await post("stripe_webhook");

    expect(first.outcome).toBe("posted");
    expect(second.outcome).toBe("already_recorded");
    expect(state.payments.size).toBe(1);
    expect(state.events).toHaveLength(1);
    expect(state.events[0].type).toBe("payment.received");
    expect(state.events[0].data.source).toBe("borrower_portal");
    expect(state.emails).toHaveLength(1);
    // The loser did not touch the note either.
    expect(state.updateNoteCalls).toHaveLength(1);
  });

  it("(3b) the webhook winning emits the event the old webhook never did", async () => {
    await post("stripe_webhook");
    expect(state.events).toHaveLength(1);
    expect(state.events[0].data.source).toBe("stripe_webhook");
    expect(state.emails).toHaveLength(1);
  });

  it("(4) an unpaid session is refused before any write", async () => {
    const result = await post("stripe_webhook", session({ payment_status: "unpaid" }));
    expect(result).toEqual({ outcome: "refused", reason: "payment_not_completed" });
    expect(state.payments.size).toBe(0);
    expect(state.updateNoteCalls).toHaveLength(0);
    expect(state.events).toHaveLength(0);
    expect(state.emails).toHaveLength(0);
  });

  it("(4b) a session whose metadata names another note is refused before any write", async () => {
    const result = await post(
      "borrower_portal",
      session({ metadata: { type: "borrower_portal_payment", noteId: "43", organizationId: "7" } }),
    );
    expect(result).toEqual({ outcome: "refused", reason: "session_not_for_note" });
    expect(state.payments.size).toBe(0);
  });

  it("does not clear a pending-checkout slot that names a NEWER session", async () => {
    const olderNote = { ...NOTE_ROW, pendingCheckoutSessionId: "cs_newer" } as Note;
    LAST_CONFLICT_ID.id = "cs_1";
    await postBorrowerPortalCheckoutPayment({
      note: olderNote,
      stripeSession: session(),
      source: "stripe_webhook",
      now: NOW,
    });
    const patch = state.updateNoteCalls.at(-1)?.patch ?? {};
    expect(Object.prototype.hasOwnProperty.call(patch, "pendingCheckoutSessionId")).toBe(false);
  });

  it("applies no late fee when the note states no grace period", async () => {
    const noGrace = { ...NOTE_ROW, gracePeriodDays: null } as Note;
    LAST_CONFLICT_ID.id = "cs_1";
    const result = await postBorrowerPortalCheckoutPayment({
      note: noGrace,
      stripeSession: session(),
      source: "borrower_portal",
      now: NOW,
    });
    expect(result.outcome).toBe("posted");
    if (result.outcome === "posted") expect(result.lateFeeCents).toBe(0);
  });
});


// DEFECT-0098 — money beyond the payoff is not silently dropped.
describe("an overpayment beyond the payoff is recorded, reported and disclosed", () => {
  beforeEach(resetState);

  it("a $100 payment on a $50 balance: full amount kept, $49.75 unapplied, lender and borrower told", async () => {
    // 6% on $50 → $0.25 interest; principal is capped at the $50 balance.
    const note = { ...NOTE_ROW, currentBalance: "50.00" } as typeof NOTE_ROW;
    state.noteBalance = "50.00";
    const out = await postBorrowerPortalCheckoutPayment({ note, stripeSession: session(), source: "borrower_portal", now: NOW });
    expect(out.outcome).toBe("posted");
    if (out.outcome !== "posted") return;
    expect(out.principalCents).toBe(5_000);
    expect(out.unappliedCents).toBe(4_975);
    // The ledger row still carries every cent the borrower sent.
    expect(Number(out.payment.amount)).toBe(100);
    // The lender sees it.
    expect(state.activities).toHaveLength(1);
    expect(String(state.activities[0].description)).toMatch(/exceeded the payoff by \$49\.75/);
    // The borrower is told.
    expect(String(state.emails[0].html)).toMatch(/\$49\.75 more than the remaining payoff/);
  });

  it("an ordinary installment records nothing unapplied", async () => {
    const out = await post("borrower_portal");
    expect(out.outcome).toBe("posted");
    if (out.outcome === "posted") expect(out.unappliedCents).toBe(0);
    expect(state.activities).toHaveLength(0);
  });
});
