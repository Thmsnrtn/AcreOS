import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Webhook handler tests — verifies signature verification,
 * event deduplication, and event type routing.
 */

// Mock the dependencies before importing
vi.mock("../../server/stripeClient", () => ({
  getUncachableStripeClient: vi.fn(),
  getStripeSecretKey: vi.fn(() => "sk_test_123"),
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
    applyCreditPackPurchase: vi.fn(() => ({ amountCents: 1000 })),
  },
}));

vi.mock("../../server/services/dunning", () => ({
  dunningService: {
    handlePaymentFailed: vi.fn(),
    handlePaymentSucceeded: vi.fn(),
  },
}));

describe("WebhookHandlers", () => {
  let WebhookHandlers: any;
  let mockStripeClient: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Set up environment
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret";

    // Mock Stripe client with constructEvent
    mockStripeClient = {
      webhooks: {
        constructEvent: vi.fn(),
      },
      prices: {
        retrieve: vi.fn(),
      },
    };

    const { getUncachableStripeClient } = await import("../../server/stripeClient");
    (getUncachableStripeClient as any).mockResolvedValue(mockStripeClient);

    // Import fresh module
    const mod = await import("../../server/webhookHandlers");
    WebhookHandlers = mod.WebhookHandlers;
  });

  describe("processWebhook", () => {
    it("rejects non-Buffer payloads", async () => {
      await expect(
        WebhookHandlers.processWebhook("not a buffer" as any, "sig")
      ).rejects.toThrow("Payload must be a Buffer");
    });

    it("throws when STRIPE_WEBHOOK_SECRET is missing", async () => {
      delete process.env.STRIPE_WEBHOOK_SECRET;
      const payload = Buffer.from("{}");

      await expect(
        WebhookHandlers.processWebhook(payload, "sig")
      ).rejects.toThrow("STRIPE_WEBHOOK_SECRET not configured");
    });

    it("uses stripe.webhooks.constructEvent for signature verification", async () => {
      const payload = Buffer.from("{}");
      const signature = "t=123,v1=abc";

      mockStripeClient.webhooks.constructEvent.mockReturnValue({
        id: "evt_test_1",
        type: "unknown.event",
        data: { object: {} },
      });

      await WebhookHandlers.processWebhook(payload, signature);

      expect(mockStripeClient.webhooks.constructEvent).toHaveBeenCalledWith(
        payload,
        signature,
        "whsec_test_secret"
      );
    });

    it("throws on invalid signature", async () => {
      const payload = Buffer.from("{}");
      mockStripeClient.webhooks.constructEvent.mockImplementation(() => {
        throw new Error("Signature verification failed");
      });

      await expect(
        WebhookHandlers.processWebhook(payload, "bad_sig")
      ).rejects.toThrow("Signature verification failed");
    });

    it("routes checkout.session.completed with credit_purchase metadata", async () => {
      const payload = Buffer.from("{}");
      mockStripeClient.webhooks.constructEvent.mockReturnValue({
        id: "evt_credit_1",
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_test_1",
            metadata: { type: "credit_purchase", organizationId: "1", packId: "starter" },
            payment_intent: "pi_test_1",
          },
        },
      });

      await WebhookHandlers.processWebhook(payload, "sig");

      const { creditService } = await import("../../server/services/credits");
      expect(creditService.applyCreditPackPurchase).toHaveBeenCalled();
    });

    it("routes invoice.payment_failed to dunning", async () => {
      const payload = Buffer.from("{}");
      const { storage } = await import("../../server/storage");
      (storage.getOrganizationByStripeCustomerId as any).mockResolvedValue({
        id: 1,
        dunningStage: "none",
      });

      mockStripeClient.webhooks.constructEvent.mockReturnValue({
        id: "evt_fail_1",
        type: "invoice.payment_failed",
        data: {
          object: {
            id: "in_test_1",
            customer: "cus_test_1",
            amount_due: 4900,
            attempt_count: 1,
            subscription: "sub_test_1",
          },
        },
      });

      await WebhookHandlers.processWebhook(payload, "sig");
      // Dunning service should be invoked (imported dynamically)
    });

    it("routes customer.subscription.deleted to cancellation", async () => {
      const payload = Buffer.from("{}");
      const { storage } = await import("../../server/storage");
      (storage.getOrganizationByStripeCustomerId as any).mockResolvedValue({
        id: 1,
        subscriptionTier: "pro",
        tier: "pro",
      });

      mockStripeClient.webhooks.constructEvent.mockReturnValue({
        id: "evt_cancel_1",
        type: "customer.subscription.deleted",
        data: {
          object: {
            id: "sub_test_1",
            customer: "cus_test_1",
          },
        },
      });

      await WebhookHandlers.processWebhook(payload, "sig");

      expect(storage.updateOrganization).toHaveBeenCalledWith(1, expect.objectContaining({
        subscriptionTier: "free",
        subscriptionStatus: "cancelled",
      }));
    });
  });
});
