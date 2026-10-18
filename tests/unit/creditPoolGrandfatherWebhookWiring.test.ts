/**
 * The grandfathered Scale pool (founder decision 2026-10-08: existing Scale
 * orgs keep 8,000 credits until their next renewal) is ENDED by the Stripe
 * webhook. These tests drive the real WebhookHandlers entry points:
 *
 *   - a subscription event stamps the plan period's end;
 *   - a renewal of the org's PLAN subscription ends it;
 *   - a renewal of some OTHER subscription on the same Stripe customer
 *     must NOT end it — that would take the grandfathered pool away before
 *     the plan ever renewed.
 *
 * (Founder decision 2026-10-18 removed vertical-pack subscriptions
 * entirely; the "different subscription" case below used to be a pack
 * add-on. The invariant is unchanged: only the plan's renewal counts.)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const stamp = vi.fn(async () => {});
const endAtRenewal = vi.fn(async () => {});
vi.mock("../../server/services/creditPoolGrandfather", () => ({
  stampGrandfatherPeriodEnd: stamp,
  endGrandfatherAtRenewal: endAtRenewal,
}));
vi.mock("../../server/utils/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
const ORG = { id: 77, stripeSubscriptionId: "sub_plan", subscriptionTier: "scale", dunningStage: "none" };
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

const invoice = (sub: string | null, reason = "subscription_cycle") =>
  ({
    id: "in_1",
    customer: "cus_1",
    billing_reason: reason,
    created: 1_790_000_000,
    amount_paid: 7900,
    parent: sub ? { type: "subscription_details", subscription_details: { subscription: sub } } : null,
    lines: { data: [] },
  }) as never;

describe("credit-pool grandfather — webhook wiring", () => {
  beforeEach(() => {
    stamp.mockClear();
    endAtRenewal.mockClear();
  });

  it("a renewal of the org's plan subscription ends the grandfather at the renewal moment", async () => {
    await WebhookHandlers.processInvoicePaid(invoice("sub_plan"));
    expect(endAtRenewal).toHaveBeenCalledTimes(1);
    expect(endAtRenewal).toHaveBeenCalledWith(77, new Date(1_790_000_000 * 1000));
  });

  it("a renewal of a DIFFERENT subscription on the same customer does not end it", async () => {
    await WebhookHandlers.processInvoicePaid(invoice("sub_other"));
    expect(endAtRenewal).not.toHaveBeenCalled();
  });

  it("a first invoice (subscription_create) is not a renewal", async () => {
    await WebhookHandlers.processInvoicePaid(invoice("sub_plan", "subscription_create"));
    expect(endAtRenewal).not.toHaveBeenCalled();
  });

  it("a plan subscription event stamps the current period's end", async () => {
    const sub = {
      id: "sub_plan",
      customer: "cus_1",
      status: "active",
      metadata: {},
      items: { data: [{ current_period_start: 1_790_000_000, current_period_end: 1_792_592_000, price: { id: "p", recurring: { interval: "month" } } }] },
    } as never;
    // Later steps of the handler reach Stripe, which this test does not have;
    // the stamp runs before them.
    await WebhookHandlers.processSubscriptionUpdated(sub).catch(() => {});
    expect(stamp).toHaveBeenCalledWith(77, new Date(1_792_592_000 * 1000));
  });

  it("a subscription event for a non-plan subscription still stamps its own period", async () => {
    // The stamp records the current period's end from the event itself —
    // it is not plan-gated. (The pack-subscription guard that used to
    // skip stamping here was removed with vertical-pack purchases,
    // founder decision 2026-10-18.)
    const sub = {
      id: "sub_other",
      customer: "cus_1",
      status: "active",
      metadata: {},
      items: { data: [{ current_period_start: 1_790_000_000, current_period_end: 1_792_592_000, price: { id: "p", recurring: { interval: "month" } } }] },
    } as never;
    await WebhookHandlers.processSubscriptionUpdated(sub).catch(() => {});
    expect(stamp).toHaveBeenCalledWith(77, new Date(1_792_592_000 * 1000));
  });
});
