/**
 * DEFECT-0116 — a lender-shared Stripe Payment Link is posted by the ONE
 * borrower posting rule, keyed on its Checkout Session, and only from the
 * connected account that owns the org.
 *
 * Until 2026-09-27 the Connect dispatcher only knew portal sessions
 * (`metadata.type === "borrower_portal_payment"`). A Payment Link session,
 * which carries `metadata.paymentType === "note_payment"`, fell through, and
 * the money was posted instead by `handleSuccessfulPayment` on
 * `payment_intent.succeeded`: float split, no late fee, installment marked
 * paid for any amount, `storage.updateNote` with a pre-lock balance, no
 * `payment.received`, no receipt, keyed on `pi_…` where the refund handler
 * looks for `cs_…`, and NO check that the event's connected account was the
 * metadata org's.
 *
 * These tests drive the REAL `stripeConnectService.handleWebhookEvent` into
 * the REAL posting rule over an in-memory ledger with a genuine unique
 * constraint on `transaction_id`.
 *
 *   (1) RED before the fix: a `note_payment` session posts one row keyed on
 *       the session with the integer-cent split and emits `payment.received`
 *       with `source: "payment_link"` (before: zero rows — skipped).
 *   (2) the same session from ANOTHER connected account posts nothing.
 *   (3) RED before the fix: `payment_intent.succeeded` for a `note_payment`
 *       PaymentIntent calls neither `storage.createPayment` nor
 *       `storage.updateNote` (before: both).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

type PaymentRow = Record<string, any> & { id: number; transactionId: string };
const state = vi.hoisted(() => ({
  payments: new Map<string, PaymentRow>(),
  nextId: 1,
  noteBalance: "10000.00",
  noteVersion: 1,
  updateNoteCalls: [] as Array<{ id: number; patch: Record<string, unknown> }>,
  createPaymentCalls: 0,
  events: [] as Array<{ type: string; orgId: number; entityId: number; data: Record<string, any> }>,
  emails: 0,
  /** connected account id → organization id, as the org_integrations table would answer */
  accounts: new Map<string, number>([["acct_lender_own", 5]]),
}));

function resetState() {
  state.payments.clear();
  state.nextId = 1;
  state.noteBalance = "10000.00";
  state.noteVersion = 1;
  state.updateNoteCalls.length = 0;
  state.createPaymentCalls = 0;
  state.events.length = 0;
  state.emails = 0;
}

const TABLES = vi.hoisted(() => ({ payments: null as any }));
const LAST_TXN = vi.hoisted(() => ({ id: "" }));

vi.mock("../../server/db", () => {
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
        where: () => {
          const chain: any = {
            for: () => chain,
            then: (ok: any, no: any) => {
              const rows =
                table === TABLES.payments
                  ? [state.payments.get(LAST_TXN.id)!]
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
  return { db: {}, withTransaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx) };
});

vi.mock("../../server/storage", () => ({
  storage: {
    getNote: vi.fn(async (orgId: number, noteId: number) =>
      orgId === NOTE_ROW.organizationId && noteId === NOTE_ROW.id ? NOTE_ROW : undefined,
    ),
    findOrganizationIntegrationByCredential: vi.fn(async (_type: string, _key: string, accountId: string) => {
      const orgId = state.accounts.get(accountId);
      return orgId ? { organizationId: orgId, type: "stripe_connect" } : null;
    }),
    // The OLD PaymentIntent writer's calls — both must stay at zero.
    createPayment: vi.fn(async (row: any) => {
      state.createPaymentCalls++;
      return { id: 999, ...row };
    }),
    updateNote: vi.fn(async (id: number, patch: Record<string, unknown>) => {
      state.updateNoteCalls.push({ id, patch });
      return { ...NOTE_ROW, ...patch };
    }),
    getLead: vi.fn(async () => ({ id: 9, email: "borrower@example.com", firstName: "Bea", lastName: "Rowe" })),
    // The servicing read (W10.2a): a note's borrower, deleted or not.
    getBorrowerLead: vi.fn(async () => ({ id: 9, email: "borrower@example.com", firstName: "Bea", lastName: "Rowe" })),
    getOrganization: vi.fn(async () => ({ id: 5, name: "Cedar Ridge Land Holdings LLC" })),
    getOrganizationIntegration: vi.fn(async () => null),
    deleteOrganizationIntegration: vi.fn(async () => undefined),
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
    sendEmail: vi.fn(async () => {
      state.emails++;
      return { success: true, messageId: "m_1" };
    }),
  },
}));
// Founder ruling 2026-09-29 #6: the late fee is ASSESSED to the ledger, and a
// payment only COLLECTS toward fees what exceeds the installment.
const LEDGER = vi.hoisted(() => ({ assessed: [] as Array<{ noteId: number }> }));
vi.mock("../../server/services/notes/servicedLateFees", async (orig) => ({
  ...(await orig<typeof import("../../server/services/notes/servicedLateFees")>()),
  assessServicedNoteLateFee: async (note: { id: number }) => {
    LEDGER.assessed.push({ noteId: note.id });
    return { assessed: true, alreadyExisted: false, feeCents: 2500, reason: "test" };
  },
  outstandingServicedLateFeesCents: async () => 2500,
}));
vi.mock("../../server/services/activation", () => ({ recordActivationEventAsync: vi.fn() }));
vi.mock("../../server/stripeClient", () => ({
  STRIPE_API_VERSION: "2026-02-25.clover",
  getStripeSecretKey: () => "sk_test_123",
  getUncachableStripeClient: async () => ({}),
}));

import { payments as paymentsTable, type Note } from "@shared/schema";
import { splitPaymentCents } from "../../server/services/notePaymentMath";

TABLES.payments = paymentsTable;

// 6% on $10,000, $500/month, due 2026-09-01, paid 2026-09-20 (grace 10, fee $25 → applies).
const NOTE_ROW = {
  id: 77,
  organizationId: 5,
  borrowerId: 9,
  currentBalance: "10000.00",
  interestRate: "6",
  monthlyPayment: "500.00",
  lateFee: "25",
  gracePeriodDays: 10,
  nextPaymentDate: new Date("2026-09-01T00:00:00Z"),
  startDate: new Date("2026-01-01T00:00:00Z"),
  pendingCheckoutSessionId: null,
  amortizationSchedule: [
    { paymentNumber: 1, dueDate: "2026-09-01", payment: 500, principal: 450, interest: 50, balance: 9550, status: "pending" },
  ],
  status: "active",
  version: 1,
} as unknown as Note;

function linkSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "cs_link_1",
    object: "checkout.session",
    payment_link: "plink_1",
    amount_total: 50000,
    payment_status: "paid",
    metadata: { organizationId: "5", noteId: "77", paymentType: "note_payment" },
    ...overrides,
  };
}

function connectEvent(type: string, object: unknown, account: string | null = "acct_lender_own") {
  return { id: `evt_${type}_${Math.random().toString(36).slice(2)}`, type, account, data: { object } } as any;
}

async function fire(event: any) {
  const { stripeConnectService } = await import("../../server/services/stripeConnect");
  await stripeConnectService.handleWebhookEvent(event);
}

describe("DEFECT-0116 — Payment Link payments post through the one rule, keyed on the session", () => {
  beforeEach(() => {
    resetState();
    LEDGER.assessed = [];
    LAST_TXN.id = "cs_link_1";
  });

  it("(1) a note_payment Checkout Session posts ONE row keyed on the session, cents-split, and emits payment.received", async () => {
    await fire(connectEvent("checkout.session.completed", linkSession()));

    expect(state.payments.size).toBe(1);
    const row = state.payments.get("cs_link_1")!;
    expect(row).toBeDefined();
    expect(row.organizationId).toBe(5);
    expect(row.noteId).toBe(77);
    const split = splitPaymentCents({ paymentAmountCents: 50000, currentBalanceCents: 1_000_000, annualRateBps: 600 });
    expect(Number(row.principalAmount)).toBe(split.principalCents / 100);
    expect(Number(row.interestAmount)).toBe(split.interestCents / 100);
    // 19 days late against a 10-day grace → the note's $25 fee is ASSESSED
    // (the old PaymentIntent writer never recorded one). An installment-sized
    // payment has no excess, so none of it is collected as a fee.
    expect(LEDGER.assessed).toEqual([{ noteId: 77 }]);
    expect(Number(row.lateFeeAmount)).toBe(0);

    expect(state.events).toHaveLength(1);
    expect(state.events[0].type).toBe("payment.received");
    expect(state.events[0].data.source).toBe("payment_link");
    expect(state.emails).toBe(1);
    // The old writer is not involved.
    expect(state.createPaymentCalls).toBe(0);
  });

  it("(2) the same session arriving on a DIFFERENT connected account posts nothing", async () => {
    await fire(connectEvent("checkout.session.completed", linkSession(), "acct_someone_else"));
    expect(state.payments.size).toBe(0);
    expect(state.updateNoteCalls).toHaveLength(0);
    expect(state.events).toHaveLength(0);
  });

  it("(2b) a session with no connected account on the event posts nothing", async () => {
    await fire(connectEvent("checkout.session.completed", linkSession(), null));
    expect(state.payments.size).toBe(0);
  });

  it("(2c) a session naming a note the org does not have posts nothing", async () => {
    await fire(connectEvent("checkout.session.completed", linkSession({ metadata: { organizationId: "5", noteId: "78", paymentType: "note_payment" } })));
    expect(state.payments.size).toBe(0);
  });

  it("(3) payment_intent.succeeded for a note_payment PaymentIntent no longer posts anything", async () => {
    await fire(
      connectEvent("payment_intent.succeeded", {
        id: "pi_link_1",
        object: "payment_intent",
        amount: 50000,
        amount_received: 50000,
        status: "succeeded",
        metadata: { organizationId: "5", noteId: "77", paymentType: "note_payment" },
      }),
    );
    expect(state.createPaymentCalls).toBe(0);
    expect(state.updateNoteCalls).toHaveLength(0);
    expect(state.payments.size).toBe(0);
  });

  it("(4) a redelivered session is already_recorded — no second row, event or receipt", async () => {
    await fire(connectEvent("checkout.session.completed", linkSession()));
    await fire(connectEvent("checkout.session.completed", linkSession()));
    expect(state.payments.size).toBe(1);
    expect(state.events).toHaveLength(1);
    expect(state.emails).toBe(1);
  });

  it("(5) an unpaid session (delayed-notification method) is refused before any write", async () => {
    await fire(connectEvent("checkout.session.completed", linkSession({ payment_status: "unpaid" })));
    expect(state.payments.size).toBe(0);
  });

  // The PaymentIntent writer used to post delayed-settlement (ACH) link
  // payments on `payment_intent.succeeded`. With it retired, the settlement
  // event must reach the rule or the payment is never posted at all.
  it("(6) an ACH session posts ONCE when it settles (async_payment_succeeded), after completing unpaid", async () => {
    await fire(connectEvent("checkout.session.completed", linkSession({ payment_status: "unpaid" })));
    expect(state.payments.size).toBe(0);
    await fire(connectEvent("checkout.session.async_payment_succeeded", linkSession()));
    expect(state.payments.size).toBe(1);
    expect(state.payments.get("cs_link_1")).toBeDefined();
    expect(state.events).toHaveLength(1);
  });

  it("(7) the settlement event is in the Connect subscription list, so Stripe actually sends it", async () => {
    const { STRIPE_CONNECT_WEBHOOK_EVENTS } = await import("../../server/services/stripeConnect");
    expect(STRIPE_CONNECT_WEBHOOK_EVENTS).toContain("checkout.session.async_payment_succeeded");
  });
});
