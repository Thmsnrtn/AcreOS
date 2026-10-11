/**
 * Built-but-unwired guard for the creator revenue share (W3): the real Stripe
 * webhook entry points must record a conversion for a paid invoice and void
 * one for a fully refunded charge. Drives WebhookHandlers directly.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const record = vi.fn(async () => ({ recorded: true, status: "rate_unset" }));
const voidIt = vi.fn(async () => true);
vi.mock("../../server/services/creatorProgram", () => ({
  recordCreatorConversion: record,
  voidCreatorConversionForInvoice: voidIt,
}));
vi.mock("../../server/services/referralReward", () => ({ markReferralPaid: vi.fn(async () => ({ marked: false })) }));
vi.mock("../../server/services/recognitionWorker", () => ({ recordStripeChargeRefunded: vi.fn(async () => undefined) }));
vi.mock("../../server/services/financial-ledger", () => ({ postRefund: vi.fn(async () => undefined) }));
vi.mock("../../server/utils/logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
const ORG = { id: 77, stripeSubscriptionId: "sub_plan", subscriptionTier: "pro", dunningStage: "none" };
vi.mock("../../server/storage", () => ({
  storage: {
    getOrganizationByStripeCustomerId: vi.fn(async () => ORG),
    getOrganization: vi.fn(async () => ORG),
    updateOrganization: vi.fn(),
    logSubscriptionEvent: vi.fn(),
    createSystemAlert: vi.fn(),
  },
  db: new Proxy({}, { get: () => () => { throw new Error("db not available in this test"); } }),
}));

import { WebhookHandlers } from "../../server/webhookHandlers";

const invoice = {
  id: "in_paid_1",
  customer: "cus_1",
  billing_reason: "subscription_create",
  created: 1_790_000_000,
  amount_paid: 49_000,
  currency: "usd",
  status_transitions: { paid_at: 1_790_000_100 },
  lines: { data: [] },
} as never;

beforeEach(() => {
  record.mockClear();
  voidIt.mockClear();
});

describe("creator revenue share — webhook wiring", () => {
  it("invoice.payment_succeeded records a conversion with the amount actually paid", async () => {
    await WebhookHandlers.processPaymentSucceeded(invoice);
    expect(record).toHaveBeenCalledWith(77, { id: "in_paid_1", amountPaidCents: 49_000, currency: "usd", paidAt: new Date(1_790_000_100 * 1000) });
  });

  it("invoice.paid records it too (idempotent on the invoice id in the service)", async () => {
    await WebhookHandlers.processInvoicePaid(invoice);
    expect(record).toHaveBeenCalledTimes(1);
  });

  it("a fully refunded charge voids its invoice's conversion; a partial refund does not", async () => {
    const charge = (refunded: boolean) => ({ id: "ch_1", customer: "cus_1", invoice: "in_paid_1", refunded, amount_refunded: 49_000, refunds: { data: [] } }) as never;
    await WebhookHandlers.processChargeRefunded(charge(false));
    expect(voidIt).not.toHaveBeenCalled();
    await WebhookHandlers.processChargeRefunded(charge(true));
    expect(voidIt).toHaveBeenCalledWith("in_paid_1", expect.stringContaining("refunded"));
  });
});
