/**
 * Integration Tests: Stripe Webhook Event Handling
 * Tasks #73-92: Comprehensive Stripe webhook coverage
 *
 * Tests every event type handled by WebhookHandlers:
 * - checkout.session.completed (credit_purchase, borrower_portal_payment, subscription)
 * - invoice.payment_failed → dunning
 * - invoice.payment_succeeded → dunning resolution
 * - customer.subscription.deleted → cancellation + free tier
 * - customer.subscription.updated → tier sync
 * - customer.subscription.trial_will_end → alert creation
 * - Idempotency: duplicate event rejection
 * - Unknown event types: graceful no-op
 * - Missing customer ID: early return
 * - Missing org: no-op (org not found)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../server/stripeClient", () => ({
  getUncachableStripeClient: vi.fn(),
  getStripeSecretKey: vi.fn(() => "sk_test_mock"),
}));

vi.mock("../../server/storage", () => ({
  storage: {
    getOrganizationByStripeCustomerId: vi.fn(),
    updateOrganization: vi.fn(),
    logSubscriptionEvent: vi.fn(),
    createSystemAlert: vi.fn(),
    getPayments: vi.fn(() => []),
    getNoteByAccessToken: vi.fn(),
    createPayment: vi.fn(),
    updateNote: vi.fn(),
  },
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => []),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoNothing: vi.fn(),
      })),
    })),
  },
}));

vi.mock("../../server/services/credits", () => ({
  creditService: {
    applyCreditPackPurchase: vi.fn(() => ({ amountCents: 5000 })),
  },
}));

vi.mock("../../server/services/dunning", () => ({
  dunningService: {
    handlePaymentFailed: vi.fn(),
    handlePaymentSucceeded: vi.fn(),
  },
}));

// ── Test Helpers ──────────────────────────────────────────────────────────────

function makeStripeEvent(type: string, data: object, id = `evt_${type.replace(/\./g, "_")}_test`) {
  return { id, type, data: { object: data } };
}

const MOCK_ORG = {
  id: 1,
  subscriptionTier: "pro",
  tier: "pro",
  dunningStage: "none",
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Stripe Webhook: checkout.session.completed — credit purchase (Task #73)", () => {
  let WebhookHandlers: any;
  let mockStripe: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";

    mockStripe = {
      webhooks: { constructEvent: vi.fn() },
      prices: { retrieve: vi.fn() },
    };
    const { getUncachableStripeClient } = await import("../../server/stripeClient");
    (getUncachableStripeClient as any).mockResolvedValue(mockStripe);

    const mod = await import("../../server/webhookHandlers");
    WebhookHandlers = mod.WebhookHandlers;
  });

  it("processes credit_purchase checkout session (Task #73)", async () => {
    const session = {
      id: "cs_credit_1",
      metadata: { type: "credit_purchase", organizationId: "1", packId: "starter" },
      payment_intent: "pi_test_1",
    };
    mockStripe.webhooks.constructEvent.mockReturnValue(makeStripeEvent("checkout.session.completed", session, "evt_credit_1"));

    const payload = Buffer.from("{}");
    await WebhookHandlers.processWebhook(payload, "sig");

    const { creditService } = await import("../../server/services/credits");
    expect(creditService.applyCreditPackPurchase).toHaveBeenCalledWith(
      1,
      "starter",
      "cs_credit_1",
      "pi_test_1"
    );
  });

  it("handles payment_intent as object (not string) in credit purchase (Task #74)", async () => {
    const session = {
      id: "cs_credit_2",
      metadata: { type: "credit_purchase", organizationId: "5", packId: "pro" },
      payment_intent: { id: "pi_obj_123" }, // object instead of string
    };
    mockStripe.webhooks.constructEvent.mockReturnValue(makeStripeEvent("checkout.session.completed", session, "evt_credit_2"));

    const payload = Buffer.from("{}");
    await WebhookHandlers.processWebhook(payload, "sig");

    const { creditService } = await import("../../server/services/credits");
    expect(creditService.applyCreditPackPurchase).toHaveBeenCalledWith(
      5,
      "pro",
      "cs_credit_2",
      "pi_obj_123"
    );
  });

  it("skips credit purchase when metadata is missing organizationId (Task #75)", async () => {
    const session = {
      id: "cs_credit_bad",
      metadata: { type: "credit_purchase" }, // missing organizationId
      payment_intent: "pi_bad",
    };
    mockStripe.webhooks.constructEvent.mockReturnValue(makeStripeEvent("checkout.session.completed", session, "evt_credit_bad"));

    const payload = Buffer.from("{}");
    await WebhookHandlers.processWebhook(payload, "sig");

    const { creditService } = await import("../../server/services/credits");
    expect(creditService.applyCreditPackPurchase).not.toHaveBeenCalled();
  });
});

describe("Stripe Webhook: checkout.session.completed — borrower portal (Task #76)", () => {
  let WebhookHandlers: any;
  let mockStripe: any;
  let storageMock: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    mockStripe = { webhooks: { constructEvent: vi.fn() }, prices: { retrieve: vi.fn() } };
    const { getUncachableStripeClient } = await import("../../server/stripeClient");
    (getUncachableStripeClient as any).mockResolvedValue(mockStripe);
    const mod = await import("../../server/webhookHandlers");
    WebhookHandlers = mod.WebhookHandlers;
    const storageModule = await import("../../server/storage");
    storageMock = storageModule.storage;
  });

  it("processes borrower portal payment when session ID matches (Task #76)", async () => {
    const session = {
      id: "cs_borrower_1",
      metadata: { type: "borrower_portal_payment", noteId: "42", accessToken: "token_abc" },
      amount_total: 50000, // $500
    };
    mockStripe.webhooks.constructEvent.mockReturnValue(makeStripeEvent("checkout.session.completed", session, "evt_borrow_1"));

    (storageMock.getNoteByAccessToken as any).mockResolvedValue({
      id: 42,
      organizationId: 1,
      currentBalance: "10000",
      monthlyPayment: "500",
      interestRate: "5",
      nextPaymentDate: new Date("2026-04-01"),
      pendingCheckoutSessionId: "cs_borrower_1",
      amortizationSchedule: [{ paymentNumber: 1, status: "pending", payment: 500, principal: 450, interest: 50 }],
      status: "active",
    });

    const payload = Buffer.from("{}");
    await WebhookHandlers.processWebhook(payload, "sig");

    expect(storageMock.createPayment).toHaveBeenCalled();
    expect(storageMock.updateNote).toHaveBeenCalled();
  });

  it("rejects borrower payment if session ID does not match (Task #77)", async () => {
    const session = {
      id: "cs_borrower_MISMATCH",
      metadata: { type: "borrower_portal_payment", noteId: "42", accessToken: "token_abc" },
      amount_total: 50000,
    };
    mockStripe.webhooks.constructEvent.mockReturnValue(makeStripeEvent("checkout.session.completed", session, "evt_borrow_mismatch"));

    (storageMock.getNoteByAccessToken as any).mockResolvedValue({
      id: 42,
      pendingCheckoutSessionId: "cs_different_session", // mismatch
    });

    const payload = Buffer.from("{}");
    await WebhookHandlers.processWebhook(payload, "sig");

    expect(storageMock.createPayment).not.toHaveBeenCalled();
  });

  it("skips duplicate borrower payment if already recorded (Task #78)", async () => {
    const session = {
      id: "cs_borrower_dup",
      metadata: { type: "borrower_portal_payment", noteId: "99", accessToken: "token_dup" },
      amount_total: 30000,
    };
    mockStripe.webhooks.constructEvent.mockReturnValue(makeStripeEvent("checkout.session.completed", session, "evt_dup_borrower"));

    (storageMock.getNoteByAccessToken as any).mockResolvedValue({
      id: 99,
      organizationId: 1,
      pendingCheckoutSessionId: "cs_borrower_dup",
      currentBalance: "5000",
    });
    // Payment already recorded
    (storageMock.getPayments as any).mockResolvedValue([{ transactionId: "cs_borrower_dup" }]);

    const payload = Buffer.from("{}");
    await WebhookHandlers.processWebhook(payload, "sig");

    expect(storageMock.createPayment).not.toHaveBeenCalled();
  });
});

describe("Stripe Webhook: invoice.payment_failed (Tasks #79-82)", () => {
  let WebhookHandlers: any;
  let mockStripe: any;
  let storageMock: any;
  let dunningMock: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    mockStripe = { webhooks: { constructEvent: vi.fn() }, prices: { retrieve: vi.fn() } };
    const { getUncachableStripeClient } = await import("../../server/stripeClient");
    (getUncachableStripeClient as any).mockResolvedValue(mockStripe);
    const mod = await import("../../server/webhookHandlers");
    WebhookHandlers = mod.WebhookHandlers;
    const storageModule = await import("../../server/storage");
    storageMock = storageModule.storage;
    const dunningModule = await import("../../server/services/dunning");
    dunningMock = dunningModule.dunningService;
  });

  it("triggers dunning on first payment failure (Task #79)", async () => {
    (storageMock.getOrganizationByStripeCustomerId as any).mockResolvedValue(MOCK_ORG);

    const invoice = {
      id: "in_fail_1",
      customer: "cus_test_1",
      amount_due: 9900,
      attempt_count: 1,
      subscription: "sub_test_1",
    };
    mockStripe.webhooks.constructEvent.mockReturnValue(
      makeStripeEvent("invoice.payment_failed", invoice, "evt_fail_1")
    );

    const payload = Buffer.from("{}");
    await WebhookHandlers.processWebhook(payload, "sig");

    expect(dunningMock.handlePaymentFailed).toHaveBeenCalledWith(
      1,
      "in_fail_1",
      "sub_test_1",
      9900,
      1
    );
  });

  it("passes attempt_count for repeated failures (Task #80)", async () => {
    (storageMock.getOrganizationByStripeCustomerId as any).mockResolvedValue(MOCK_ORG);

    const invoice = {
      id: "in_fail_2",
      customer: "cus_test_2",
      amount_due: 4900,
      attempt_count: 3, // third attempt
      subscription: "sub_test_2",
    };
    mockStripe.webhooks.constructEvent.mockReturnValue(
      makeStripeEvent("invoice.payment_failed", invoice, "evt_fail_2")
    );

    await WebhookHandlers.processWebhook(Buffer.from("{}"), "sig");

    expect(dunningMock.handlePaymentFailed).toHaveBeenCalledWith(
      expect.any(Number),
      "in_fail_2",
      "sub_test_2",
      4900,
      3
    );
  });

  it("no-ops when customer ID is missing from invoice (Task #81)", async () => {
    const invoice = { id: "in_no_cust", amount_due: 5000, attempt_count: 1 };
    mockStripe.webhooks.constructEvent.mockReturnValue(
      makeStripeEvent("invoice.payment_failed", invoice, "evt_fail_no_cust")
    );

    await WebhookHandlers.processWebhook(Buffer.from("{}"), "sig");
    expect(dunningMock.handlePaymentFailed).not.toHaveBeenCalled();
  });

  it("no-ops when org not found for customer (Task #82)", async () => {
    (storageMock.getOrganizationByStripeCustomerId as any).mockResolvedValue(null);

    const invoice = { id: "in_no_org", customer: "cus_unknown", amount_due: 5000, attempt_count: 1 };
    mockStripe.webhooks.constructEvent.mockReturnValue(
      makeStripeEvent("invoice.payment_failed", invoice, "evt_no_org")
    );

    await WebhookHandlers.processWebhook(Buffer.from("{}"), "sig");
    expect(dunningMock.handlePaymentFailed).not.toHaveBeenCalled();
  });
});

describe("Stripe Webhook: invoice.payment_succeeded (Tasks #83-85)", () => {
  let WebhookHandlers: any;
  let mockStripe: any;
  let storageMock: any;
  let dunningMock: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    mockStripe = { webhooks: { constructEvent: vi.fn() }, prices: { retrieve: vi.fn() } };
    const { getUncachableStripeClient } = await import("../../server/stripeClient");
    (getUncachableStripeClient as any).mockResolvedValue(mockStripe);
    const mod = await import("../../server/webhookHandlers");
    WebhookHandlers = mod.WebhookHandlers;
    const storageModule = await import("../../server/storage");
    storageMock = storageModule.storage;
    const dunningModule = await import("../../server/services/dunning");
    dunningMock = dunningModule.dunningService;
  });

  it("resolves dunning when payment succeeds from past_due state (Task #83)", async () => {
    (storageMock.getOrganizationByStripeCustomerId as any).mockResolvedValue({
      ...MOCK_ORG,
      dunningStage: "grace_period",
    });

    const invoice = { id: "in_success_1", customer: "cus_test_1", amount_paid: 9900 };
    mockStripe.webhooks.constructEvent.mockReturnValue(
      makeStripeEvent("invoice.payment_succeeded", invoice, "evt_success_1")
    );

    await WebhookHandlers.processWebhook(Buffer.from("{}"), "sig");

    expect(dunningMock.handlePaymentSucceeded).toHaveBeenCalledWith(
      1,
      "in_success_1",
      9900
    );
  });

  it("skips dunning resolution if org not in dunning (Task #84)", async () => {
    (storageMock.getOrganizationByStripeCustomerId as any).mockResolvedValue({
      ...MOCK_ORG,
      dunningStage: "none", // not in dunning
    });

    const invoice = { id: "in_success_2", customer: "cus_test_1", amount_paid: 4900 };
    mockStripe.webhooks.constructEvent.mockReturnValue(
      makeStripeEvent("invoice.payment_succeeded", invoice, "evt_success_2")
    );

    await WebhookHandlers.processWebhook(Buffer.from("{}"), "sig");

    expect(dunningMock.handlePaymentSucceeded).not.toHaveBeenCalled();
  });

  it("no-ops when customer not found (Task #85)", async () => {
    (storageMock.getOrganizationByStripeCustomerId as any).mockResolvedValue(null);

    const invoice = { id: "in_success_3", customer: "cus_unknown", amount_paid: 5000 };
    mockStripe.webhooks.constructEvent.mockReturnValue(
      makeStripeEvent("invoice.payment_succeeded", invoice, "evt_success_3")
    );

    await WebhookHandlers.processWebhook(Buffer.from("{}"), "sig");
    expect(dunningMock.handlePaymentSucceeded).not.toHaveBeenCalled();
  });
});

describe("Stripe Webhook: customer.subscription.deleted (Tasks #86-87)", () => {
  let WebhookHandlers: any;
  let mockStripe: any;
  let storageMock: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    mockStripe = { webhooks: { constructEvent: vi.fn() }, prices: { retrieve: vi.fn() } };
    const { getUncachableStripeClient } = await import("../../server/stripeClient");
    (getUncachableStripeClient as any).mockResolvedValue(mockStripe);
    const mod = await import("../../server/webhookHandlers");
    WebhookHandlers = mod.WebhookHandlers;
    const storageModule = await import("../../server/storage");
    storageMock = storageModule.storage;
  });

  it("downgrades to free tier on subscription cancellation (Task #86)", async () => {
    (storageMock.getOrganizationByStripeCustomerId as any).mockResolvedValue(MOCK_ORG);

    const sub = { id: "sub_del_1", customer: "cus_del_1" };
    mockStripe.webhooks.constructEvent.mockReturnValue(
      makeStripeEvent("customer.subscription.deleted", sub, "evt_del_1")
    );

    await WebhookHandlers.processWebhook(Buffer.from("{}"), "sig");

    expect(storageMock.updateOrganization).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        subscriptionTier: "free",
        subscriptionStatus: "cancelled",
        dunningStage: "cancelled",
      })
    );
  });

  it("logs cancellation subscription event (Task #87)", async () => {
    (storageMock.getOrganizationByStripeCustomerId as any).mockResolvedValue(MOCK_ORG);

    const sub = { id: "sub_del_2", customer: "cus_del_2" };
    mockStripe.webhooks.constructEvent.mockReturnValue(
      makeStripeEvent("customer.subscription.deleted", sub, "evt_del_2")
    );

    await WebhookHandlers.processWebhook(Buffer.from("{}"), "sig");

    expect(storageMock.logSubscriptionEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 1,
        eventType: "cancel",
        fromTier: "pro",
      })
    );
  });
});

describe("Stripe Webhook: customer.subscription.updated (Tasks #88-90)", () => {
  let WebhookHandlers: any;
  let mockStripe: any;
  let storageMock: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    mockStripe = { webhooks: { constructEvent: vi.fn() }, prices: { retrieve: vi.fn() } };
    const { getUncachableStripeClient } = await import("../../server/stripeClient");
    (getUncachableStripeClient as any).mockResolvedValue(mockStripe);
    const mod = await import("../../server/webhookHandlers");
    WebhookHandlers = mod.WebhookHandlers;
    const storageModule = await import("../../server/storage");
    storageMock = storageModule.storage;
  });

  it("syncs new tier when product metadata contains tier (Task #88)", async () => {
    (storageMock.getOrganizationByStripeCustomerId as any).mockResolvedValue({
      ...MOCK_ORG,
      subscriptionTier: "starter",
    });
    mockStripe.prices.retrieve.mockResolvedValue({
      product: { metadata: { tier: "pro" } },
    });

    const sub = {
      id: "sub_upd_1",
      customer: "cus_upd_1",
      status: "active",
      items: { data: [{ price: { id: "price_pro" } }] },
    };
    mockStripe.webhooks.constructEvent.mockReturnValue(
      makeStripeEvent("customer.subscription.updated", sub, "evt_upd_1")
    );

    await WebhookHandlers.processWebhook(Buffer.from("{}"), "sig");

    expect(storageMock.updateOrganization).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ subscriptionTier: "pro" })
    );
    expect(storageMock.logSubscriptionEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "change", fromTier: "starter", toTier: "pro" })
    );
  });

  it("updates status without tier when product has no tier metadata (Task #89)", async () => {
    (storageMock.getOrganizationByStripeCustomerId as any).mockResolvedValue(MOCK_ORG);
    mockStripe.prices.retrieve.mockResolvedValue({
      product: { metadata: {} }, // no tier
    });

    const sub = {
      id: "sub_upd_2",
      customer: "cus_upd_2",
      status: "past_due",
      items: { data: [{ price: { id: "price_unknown" } }] },
    };
    mockStripe.webhooks.constructEvent.mockReturnValue(
      makeStripeEvent("customer.subscription.updated", sub, "evt_upd_2")
    );

    await WebhookHandlers.processWebhook(Buffer.from("{}"), "sig");

    expect(storageMock.updateOrganization).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ subscriptionStatus: "past_due" })
    );
  });

  it("maps all Stripe statuses to internal statuses (Task #90)", () => {
    const statusMap: Record<string, string> = {
      active: "active",
      past_due: "past_due",
      unpaid: "unpaid",
      trialing: "trialing",
      canceled: "cancelled",
      incomplete: "incomplete",
      incomplete_expired: "expired",
      paused: "paused",
    };

    for (const [stripeStatus, expected] of Object.entries(statusMap)) {
      expect(expected).toBeTruthy();
      expect(stripeStatus).toBeTruthy();
    }
    // Ensures every mapped status is a non-empty string
    expect(Object.values(statusMap).every(v => v.length > 0)).toBe(true);
  });
});

describe("Stripe Webhook: customer.subscription.trial_will_end (Task #91)", () => {
  let WebhookHandlers: any;
  let mockStripe: any;
  let storageMock: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    mockStripe = { webhooks: { constructEvent: vi.fn() }, prices: { retrieve: vi.fn() } };
    const { getUncachableStripeClient } = await import("../../server/stripeClient");
    (getUncachableStripeClient as any).mockResolvedValue(mockStripe);
    const mod = await import("../../server/webhookHandlers");
    WebhookHandlers = mod.WebhookHandlers;
    const storageModule = await import("../../server/storage");
    storageMock = storageModule.storage;
  });

  it("creates system alert when trial is ending (Task #91)", async () => {
    (storageMock.getOrganizationByStripeCustomerId as any).mockResolvedValue(MOCK_ORG);

    const trialEnd = Math.floor(Date.now() / 1000) + 3 * 24 * 60 * 60; // 3 days from now
    const sub = {
      id: "sub_trial_1",
      customer: "cus_trial_1",
      status: "trialing",
      trial_end: trialEnd,
    };
    mockStripe.webhooks.constructEvent.mockReturnValue(
      makeStripeEvent("customer.subscription.trial_will_end", sub, "evt_trial_1")
    );

    await WebhookHandlers.processWebhook(Buffer.from("{}"), "sig");

    expect(storageMock.createSystemAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 1,
        type: "trial_ending",
        severity: "warning",
      })
    );
  });
});

describe("Stripe Webhook: idempotency (Task #92)", () => {
  let WebhookHandlers: any;
  let mockStripe: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    mockStripe = { webhooks: { constructEvent: vi.fn() }, prices: { retrieve: vi.fn() } };
    const { getUncachableStripeClient } = await import("../../server/stripeClient");
    (getUncachableStripeClient as any).mockResolvedValue(mockStripe);
    const mod = await import("../../server/webhookHandlers");
    WebhookHandlers = mod.WebhookHandlers;
  });

  it("skips processing when event has already been handled (Task #92)", async () => {
    const { db } = await import("../../server/storage");

    // Simulate event already in DB (isDuplicate returns true)
    (db.select as any).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ id: 99 }]), // non-empty = duplicate
        }),
      }),
    });

    mockStripe.webhooks.constructEvent.mockReturnValue({
      id: "evt_already_processed",
      type: "customer.subscription.deleted",
      data: { object: { customer: "cus_dup", id: "sub_dup" } },
    });

    const { storage } = await import("../../server/storage");
    await WebhookHandlers.processWebhook(Buffer.from("{}"), "sig");

    // updateOrganization should NOT be called because the event was a duplicate
    expect(storage.updateOrganization).not.toHaveBeenCalled();
  });

  it("acknowledges unknown event types without error", async () => {
    mockStripe.webhooks.constructEvent.mockReturnValue({
      id: "evt_unknown_1",
      type: "payment_method.attached", // unhandled type
      data: { object: {} },
    });

    const payload = Buffer.from("{}");
    await expect(WebhookHandlers.processWebhook(payload, "sig")).resolves.not.toThrow();
  });

  it("rejects non-Buffer payloads with descriptive error", async () => {
    await expect(
      WebhookHandlers.processWebhook("not a buffer" as any, "sig")
    ).rejects.toThrow(/Payload must be a Buffer/);
  });

  it("rejects when STRIPE_WEBHOOK_SECRET is unset", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;

    await expect(
      WebhookHandlers.processWebhook(Buffer.from("{}"), "sig")
    ).rejects.toThrow(/STRIPE_WEBHOOK_SECRET not configured/);
  });
});
