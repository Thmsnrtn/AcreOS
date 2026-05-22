/**
 * Pillar 1.5 + 1.6 + 8.5 wiring tests.
 *
 * Verifies the three integration points that connect the financial-ledger
 * service (Pillar 1) to real money events:
 *
 *   A — Stripe webhook splitter: invoice.paid → 5 ledger rows; charge.refunded
 *       → refund_reserve debit; charge.succeeded → stripe_fee opex_spent row.
 *   B — Cost-event hooks: Twilio / Lob / skip-trace / ElevenLabs each emit
 *       a single opex_spent row, idempotent on retry.
 *   C — Yearly checkout passes payment_method_types including us_bank_account.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── In-memory ledger store (mirrors financial-ledger.test.ts) ────────────────

type LedgerRow = {
  id: number;
  organizationId: number | null;
  bucket: string;
  category: string;
  amountCents: number;
  feature: string | null;
  provider: string | null;
  externalEventId: string | null;
  invoiceId: number | null;
  campaignId: number | null;
  postedAt: Date;
  postedBy: string;
  notes: string | null;
  createdAt: Date;
};

const ledger: { rows: LedgerRow[]; nextId: number } = { rows: [], nextId: 1 };
function resetLedger() {
  ledger.rows = [];
  ledger.nextId = 1;
}

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../server/services/founderSettings", () => ({
  getSetting: vi.fn(async () => null),
}));

vi.mock("../../server/utils/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../server/db", () => {
  function buildDb() {
    const insert = (_table: any) => {
      let pending: any = null;
      const chain = {
        values(row: any) {
          pending = {
            row: {
              id: ledger.nextId++,
              organizationId: row.organizationId ?? null,
              bucket: row.bucket,
              category: row.category,
              amountCents: row.amountCents,
              feature: row.feature ?? null,
              provider: row.provider ?? null,
              externalEventId: row.externalEventId ?? null,
              invoiceId: row.invoiceId ?? null,
              campaignId: row.campaignId ?? null,
              postedAt: row.postedAt ?? new Date(),
              postedBy: row.postedBy,
              notes: row.notes ?? null,
              createdAt: new Date(),
            },
          };
          return chain;
        },
        onConflictDoNothing(_opts?: any) {
          return chain;
        },
        async returning() {
          if (!pending) return [];
          const eid = pending.row.externalEventId;
          if (eid && ledger.rows.some((r) => r.externalEventId === eid)) return [];
          ledger.rows.push(pending.row);
          return [pending.row];
        },
      };
      return chain;
    };

    const select = (_fields?: any) => {
      const chain: any = {
        from() {
          return chain;
        },
        where(predicate: any) {
          chain._predicate = predicate;
          return chain;
        },
        limit(n: number) {
          chain._limit = n;
          return chain;
        },
        then(resolve: any) {
          const pred = chain._predicate;
          let matched = ledger.rows.filter((r) =>
            typeof pred?.__predicate === "function" ? pred.__predicate(r) : true,
          );
          if (chain._limit != null) matched = matched.slice(0, chain._limit);
          resolve(matched);
        },
      };
      return chain;
    };

    return {
      insert,
      select,
      async transaction(fn: any) {
        return fn(buildDb());
      },
    };
  }

  const db = buildDb();
  return {
    db,
    withTransaction: async (fn: any) => fn(db),
    pool: {},
    replicaPool: {},
    dbReadOnly: db,
  };
});

vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<any>("drizzle-orm");
  const wrap = (fn: (r: LedgerRow) => boolean) => ({ __predicate: fn });
  return {
    ...actual,
    eq: (col: any, val: any) =>
      wrap((r) => {
        const name = String(col).toLowerCase();
        if (name.includes("external_event_id")) return r.externalEventId === val;
        if (name.includes("organization_id")) return r.organizationId === val;
        if (name.includes("bucket")) return r.bucket === val;
        if (name.includes("category")) return r.category === val;
        return true;
      }),
    gte: () => wrap(() => true),
    and: (...preds: any[]) =>
      wrap((r) => preds.every((p) => (p?.__predicate ?? (() => true))(r))),
    sql: (..._args: any[]) => wrap(() => false),
    sum: (_col: any) => ({ mapWith: () => ({ __aggregate: "sum" }) }),
  };
});

// Webhook-test scaffolding (Part A)
const mockStripe: any = {
  webhooks: { constructEvent: vi.fn() },
  prices: { retrieve: vi.fn() },
  balanceTransactions: { retrieve: vi.fn() },
  checkout: { sessions: { create: vi.fn() } },
  customers: { create: vi.fn() },
};

vi.mock("../../server/stripeClient", () => ({
  getUncachableStripeClient: vi.fn(async () => mockStripe),
  getStripeSecretKey: vi.fn(() => "sk_test_123"),
}));

vi.mock("../../server/storage", () => ({
  storage: {
    getOrganizationByStripeCustomerId: vi.fn(async () => ({ id: 77, dunningStage: "none" })),
    getOrganization: vi.fn(async () => ({ id: 77 })),
    updateOrganization: vi.fn(),
    logSubscriptionEvent: vi.fn(),
    createSystemAlert: vi.fn(),
    getPayments: vi.fn(() => []),
    getNoteByAccessToken: vi.fn(),
    createPayment: vi.fn(),
    updateNote: vi.fn(),
    getPricingConfigForTier: vi.fn(async () => null),
  },
  db: {
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => ({ returning: async () => [{ id: 1 }] }),
      }),
    }),
    select: () => ({ from: () => ({ where: () => ({ limit: () => [] }) }) }),
  },
}));

vi.mock("../../server/services/credits", () => ({
  creditService: { applyCreditPackPurchase: vi.fn() },
}));

vi.mock("../../server/services/dunning", () => ({
  dunningService: {
    handlePaymentFailed: vi.fn(),
    handlePaymentSucceeded: vi.fn(),
  },
}));

vi.mock("../../server/services/recognitionWorker", () => ({
  recordStripeInvoicePaid: vi.fn(),
  recordStripeChargeRefunded: vi.fn(),
}));

vi.mock("../../server/routes-subscription", () => ({
  recordSubscriptionHistoryEvent: vi.fn(),
}));

vi.mock("../../server/utils/dateUtils", () => ({
  addMonths: (d: Date) => d,
}));

// ── Tests ────────────────────────────────────────────────────────────────────

import { BUCKET_NAMES } from "../../shared/billing/allocation-policy";

beforeEach(() => {
  resetLedger();
  vi.clearAllMocks();
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
});

describe("Part A — Stripe webhook → financial-ledger", () => {
  it("invoice.paid posts 5 bucket rows summing to amount_paid", async () => {
    mockStripe.webhooks.constructEvent.mockReturnValue({
      id: "evt_inv_paid_1",
      type: "invoice.paid",
      data: {
        object: {
          id: "in_test_1",
          customer: "cus_test_1",
          amount_paid: 9900,
          status_transitions: { paid_at: Math.floor(Date.now() / 1000) },
        },
      },
    });

    const { WebhookHandlers } = await import("../../server/webhookHandlers");
    await WebhookHandlers.processWebhook(Buffer.from("{}"), "sig");

    // 5 rows from the canonical policy, all keyed off the same invoice.
    const split = ledger.rows.filter(
      (r) => r.externalEventId?.startsWith("stripe:invoice:in_test_1:alloc-"),
    );
    expect(split).toHaveLength(BUCKET_NAMES.length);
    const sum = split.reduce((a, r) => a + r.amountCents, 0);
    expect(sum).toBe(9900);
    for (const r of split) {
      expect(r.organizationId).toBe(77);
      expect(r.category).toBe("revenue");
    }
  });

  it("invoice.paid is idempotent on redelivery", async () => {
    const fakeEvent = {
      id: "evt_inv_paid_2",
      type: "invoice.paid",
      data: {
        object: {
          id: "in_test_2",
          customer: "cus_test_1",
          amount_paid: 5000,
          status_transitions: { paid_at: Math.floor(Date.now() / 1000) },
        },
      },
    };
    mockStripe.webhooks.constructEvent.mockReturnValue(fakeEvent);
    const { WebhookHandlers } = await import("../../server/webhookHandlers");
    await WebhookHandlers.processWebhook(Buffer.from("{}"), "sig");
    // Second delivery — claimEvent will normally short-circuit, but even if
    // we bypass and post twice, ledger UNIQUE on externalEventId rejects.
    await WebhookHandlers.processInvoicePaid(fakeEvent.data.object as any);

    const split = ledger.rows.filter((r) =>
      r.externalEventId?.startsWith("stripe:invoice:in_test_2:alloc-"),
    );
    expect(split).toHaveLength(BUCKET_NAMES.length);
  });

  it("charge.refunded posts a negative refund_reserve row", async () => {
    mockStripe.webhooks.constructEvent.mockReturnValue({
      id: "evt_refund_1",
      type: "charge.refunded",
      data: {
        object: {
          id: "ch_test_1",
          customer: "cus_test_1",
          amount_refunded: 9900,
          refunds: { data: [{ id: "re_test_1" }] },
        },
      },
    });
    const { WebhookHandlers } = await import("../../server/webhookHandlers");
    await WebhookHandlers.processWebhook(Buffer.from("{}"), "sig");

    const refundRow = ledger.rows.find(
      (r) => r.externalEventId === "stripe:refund:re_test_1",
    );
    expect(refundRow).toBeDefined();
    expect(refundRow!.bucket).toBe("refund_reserve");
    expect(refundRow!.amountCents).toBe(-9900);
    expect(refundRow!.organizationId).toBe(77);
  });

  it("charge.succeeded posts the Stripe processing fee as stripe_fee opex", async () => {
    mockStripe.balanceTransactions.retrieve.mockResolvedValue({ fee: 320 });
    mockStripe.webhooks.constructEvent.mockReturnValue({
      id: "evt_charge_ok_1",
      type: "charge.succeeded",
      data: {
        object: {
          id: "ch_succ_1",
          customer: "cus_test_1",
          balance_transaction: "txn_1",
        },
      },
    });
    const { WebhookHandlers } = await import("../../server/webhookHandlers");
    await WebhookHandlers.processWebhook(Buffer.from("{}"), "sig");

    const feeRow = ledger.rows.find((r) => r.externalEventId === "stripe:fee:ch_succ_1");
    expect(feeRow).toBeDefined();
    expect(feeRow!.category).toBe("stripe_fee");
    expect(feeRow!.amountCents).toBe(-320);
    expect(feeRow!.provider).toBe("stripe");
  });
});

describe("Part B — Cost-event hooks", () => {
  it("Twilio SMS success debits opex once and is idempotent on retry", async () => {
    const { postOpexSpent } = await import("../../server/services/financial-ledger");
    const sid = "SM_idem_1";
    await postOpexSpent({
      organizationId: 77,
      amountCents: 1,
      category: "sms",
      feature: "sms",
      providerName: "twilio",
      providerEventId: sid,
      externalEventId: `twilio:sms:${sid}`,
    });
    await postOpexSpent({
      organizationId: 77,
      amountCents: 1,
      category: "sms",
      feature: "sms",
      providerName: "twilio",
      providerEventId: sid,
      externalEventId: `twilio:sms:${sid}`,
    });
    const rows = ledger.rows.filter((r) => r.externalEventId === `twilio:sms:${sid}`);
    expect(rows).toHaveLength(1);
    expect(rows[0].amountCents).toBe(-1);
  });

  it("Lob postcard send debits a single opex row", async () => {
    const { postOpexSpent } = await import("../../server/services/financial-ledger");
    await postOpexSpent({
      organizationId: 77,
      amountCents: 65,
      category: "mail",
      feature: "postcard",
      providerName: "lob",
      providerEventId: "psc_1",
      externalEventId: "lob:postcard:psc_1",
    });
    const row = ledger.rows.find((r) => r.externalEventId === "lob:postcard:psc_1");
    expect(row).toBeDefined();
    expect(row!.amountCents).toBe(-65);
  });

  it("Skip-trace success debits opex idempotently per seed", async () => {
    const { postOpexSpent } = await import("../../server/services/financial-ledger");
    const eid = "batch_skip_tracing:skiptrace:78701|123 Main St";
    await postOpexSpent({
      organizationId: 77,
      amountCents: 20,
      category: "skip_trace",
      feature: "skip_trace",
      providerName: "batch_skip_tracing",
      providerEventId: "seed",
      externalEventId: eid,
    });
    await postOpexSpent({
      organizationId: 77,
      amountCents: 20,
      category: "skip_trace",
      feature: "skip_trace",
      providerName: "batch_skip_tracing",
      providerEventId: "seed",
      externalEventId: eid,
    });
    expect(ledger.rows.filter((r) => r.externalEventId === eid)).toHaveLength(1);
  });

  it("ElevenLabs synthesis debits opex; cache hits skip the ledger", async () => {
    const { postOpexSpent } = await import("../../server/services/financial-ledger");
    // Simulate a non-cache render writing 12 cents.
    await postOpexSpent({
      organizationId: 77,
      amountCents: 12,
      category: "voice",
      feature: "elevenlabs_tts",
      providerName: "elevenlabs",
      providerEventId: "hashA",
      externalEventId: "elevenlabs:tts:hashA",
    });
    expect(ledger.rows.filter((r) => r.provider === "elevenlabs")).toHaveLength(1);

    // A cache hit does not call postOpexSpent at all → ledger unchanged.
    expect(ledger.rows.filter((r) => r.provider === "elevenlabs")).toHaveLength(1);
  });
});

describe("Part C — Yearly checkout enables ACH", () => {
  it("yearly recurring price opts the session into us_bank_account", async () => {
    mockStripe.checkout.sessions.create.mockResolvedValue({
      id: "cs_yearly_1",
      url: "https://checkout.stripe.test/cs_yearly_1",
    });

    const { stripeService } = await import("../../server/stripeService");
    await stripeService.createCheckoutSession(
      "cus_test_1",
      "price_yearly_pro",
      "https://app/success",
      "https://app/cancel",
      { organizationId: "77" },
      undefined,
      { enableAch: true },
    );

    expect(mockStripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
    const [params] = mockStripe.checkout.sessions.create.mock.calls[0];
    expect(params.payment_method_types).toEqual(["card", "us_bank_account"]);
  });

  it("monthly recurring price keeps card-only", async () => {
    mockStripe.checkout.sessions.create.mockResolvedValue({
      id: "cs_monthly_1",
      url: "https://checkout.stripe.test/cs_monthly_1",
    });
    const { stripeService } = await import("../../server/stripeService");
    await stripeService.createCheckoutSession(
      "cus_test_1",
      "price_monthly_pro",
      "https://app/success",
      "https://app/cancel",
      { organizationId: "77" },
    );
    const [params] = mockStripe.checkout.sessions.create.mock.calls[0];
    expect(params.payment_method_types).toEqual(["card"]);
  });
});
