import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * webhookRevenueIsolation.test.ts — shared-Stripe-account isolation on the
 * autopilot revenue-sense bus (commit 4ad77411).
 *
 * AcreOS shares one live Stripe account with Foundry and personal land sales,
 * so `invoice.paid` / dispute / churn events for THOSE businesses arrive on the
 * same webhook. `emitRevenueSense` must only feed the autopilot perception bus
 * (`recordSense`) for events whose customer resolves to an AcreOS org —
 * otherwise Foundry's revenue and land-sale churn would pollute the brain's
 * money signals. This pins that gate in both directions.
 */

// Controllable set of Stripe customer ids that resolve to an AcreOS org.
const acreos = vi.hoisted(() => ({ ids: new Set<string>() }));

vi.mock("../../server/stripeClient", () => ({
  getUncachableStripeClient: vi.fn(),
  getStripeSecretKey: vi.fn(() => "sk_test_123"),
}));

vi.mock("../../server/storage", () => ({
  storage: {
    getOrganizationByStripeCustomerId: vi.fn(async (id: string) =>
      acreos.ids.has(id) ? { id: 1, name: "AcreOS Org" } : undefined,
    ),
  },
  db: {
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(() => []) })) })) })),
    insert: vi.fn(() => ({ values: vi.fn(() => ({ onConflictDoNothing: vi.fn() })) })),
  },
}));

const recordSense = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../../server/services/autopilot/perception", () => ({ recordSense }));

import { WebhookHandlers } from "../../server/webhookHandlers";
import type Stripe from "stripe";

// emitRevenueSense is private + fire-and-forget (`void isAcreosCustomer().then`).
// Reach it directly and let the microtask/promise chain settle before asserting.
function emit(event: Stripe.Event): void {
  (WebhookHandlers as unknown as { emitRevenueSense(e: Stripe.Event): void }).emitRevenueSense(event);
}
const settle = () => new Promise((r) => setImmediate(r));

function invoicePaid(customer: string | null, amountPaid = 4900): Stripe.Event {
  return {
    type: "invoice.paid",
    data: { object: { id: "in_1", customer, amount_paid: amountPaid } },
  } as unknown as Stripe.Event;
}

beforeEach(() => {
  acreos.ids = new Set();
  recordSense.mockClear();
});

describe("webhook revenue-sense isolation (shared Stripe account)", () => {
  it("feeds the perception bus for an AcreOS-customer invoice.paid", async () => {
    acreos.ids = new Set(["cus_acme"]);
    emit(invoicePaid("cus_acme", 4900));
    await settle();
    expect(recordSense).toHaveBeenCalledTimes(1);
    expect(recordSense).toHaveBeenCalledWith("revenue_delta", 4900, { invoice: "in_1" });
  });

  it("STAYS SILENT for a non-AcreOS customer (Foundry / land sale)", async () => {
    // Customer resolves to no AcreOS org → foreign revenue, must be ignored.
    emit(invoicePaid("cus_foundry", 250000));
    await settle();
    expect(recordSense).not.toHaveBeenCalled();
  });

  it("STAYS SILENT when the event carries no customer", async () => {
    emit(invoicePaid(null));
    await settle();
    expect(recordSense).not.toHaveBeenCalled();
  });

  it("isolates churn signals too — foreign subscription cancels don't page", async () => {
    const foreignCancel = {
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_foundry", customer: "cus_foundry" } },
    } as unknown as Stripe.Event;
    emit(foreignCancel);
    await settle();
    expect(recordSense).not.toHaveBeenCalled();

    acreos.ids = new Set(["cus_acme"]);
    const acreosCancel = {
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_acme", customer: "cus_acme" } },
    } as unknown as Stripe.Event;
    emit(acreosCancel);
    await settle();
    expect(recordSense).toHaveBeenCalledWith("churn_signal", 1, { subscription: "sub_acme", reason: "cancelled" });
  });

  it("resolves the customer whether it arrives as a string or an expanded object", async () => {
    acreos.ids = new Set(["cus_acme"]);
    const expanded = {
      type: "invoice.paid",
      data: { object: { id: "in_2", customer: { id: "cus_acme" }, amount_paid: 7900 } },
    } as unknown as Stripe.Event;
    emit(expanded);
    await settle();
    expect(recordSense).toHaveBeenCalledWith("revenue_delta", 7900, { invoice: "in_2" });
  });
});
