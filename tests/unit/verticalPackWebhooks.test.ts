/**
 * S3 — vertical-pack add-on purchase path. The packs were priced + tracked +
 * P&L'd but unpurchasable; the new checkout route sells a pack as its OWN
 * Stripe subscription, metadata-tagged {type:"vertical_pack"}. These tests
 * pin the webhook semantics that make that safe on the shared account:
 *
 *   1. a vertical_pack checkout activates org_vertical_packs (upsert);
 *   2. a vertical_pack subscription CANCELLING cancels the pack row and
 *      NEVER downgrades the org's plan tier (the generic path would have
 *      set the whole org to free);
 *   3. subscription.updated for a pack sub is a no-op for plan handling.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const state = {
  packUpserts: [] as any[],
  packUpdates: [] as any[],
  orgTierUpdates: [] as any[],
  orgLookups: 0,
};

vi.mock("../../server/stripeClient", () => ({
  getUncachableStripeClient: vi.fn(async () => ({
    subscriptions: {
      retrieve: async (_id: string) => ({ items: { data: [{ id: "si_pack_1" }] } }),
    },
  })),
  getStripeSecretKey: vi.fn(() => "sk_test_123"),
}));

vi.mock("../../server/storage", () => ({
  storage: {
    getOrganizationByStripeCustomerId: vi.fn(async () => {
      state.orgLookups += 1;
      return { id: 1, name: "Org", subscriptionTier: "pro" };
    }),
  },
  db: {
    insert: (t: any) => ({
      values: (v: any) => ({
        onConflictDoUpdate: (_opts: any) => {
          state.packUpserts.push(v);
          return Promise.resolve();
        },
        onConflictDoNothing: () => Promise.resolve(),
      }),
    }),
    update: (t: any) => ({
      set: (v: any) => ({
        where: (_w: any) => {
          if (t?.__k === "orgVerticalPacks") state.packUpdates.push(v);
          else state.orgTierUpdates.push(v);
          return Promise.resolve();
        },
      }),
    }),
  },
}));

vi.mock("@shared/schema", () => ({
  orgVerticalPacks: { __k: "orgVerticalPacks", organizationId: "ovp.org", packKey: "ovp.pack" },
  organizations: { __k: "organizations" },
}));

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { WebhookHandlers } from "../../server/webhookHandlers";
import type Stripe from "stripe";

beforeEach(() => {
  state.packUpserts = [];
  state.packUpdates = [];
  state.orgTierUpdates = [];
  state.orgLookups = 0;
});

describe("vertical-pack webhook semantics", () => {
  it("activates the pack on checkout completion (upsert active, price + interval recorded)", async () => {
    const session = {
      id: "cs_1",
      mode: "subscription",
      subscription: "sub_pack_1",
      metadata: { type: "vertical_pack", packKey: "note_investor", interval: "monthly", organizationId: "7" },
    } as unknown as Stripe.Checkout.Session;

    await WebhookHandlers.processVerticalPackPurchase(session);

    expect(state.packUpserts).toHaveLength(1);
    expect(state.packUpserts[0]).toMatchObject({
      organizationId: 7,
      packKey: "note_investor",
      status: "active",
      billingInterval: "monthly",
      priceCents: 10000, // $100/mo from VERTICAL_PACKS — real pricing, not a guess
      stripeSubscriptionItemId: "si_pack_1",
    });
  });

  it("a pack subscription cancelling cancels the PACK — and never touches the org's plan tier", async () => {
    const sub = {
      id: "sub_pack_1",
      customer: "cus_1",
      metadata: { type: "vertical_pack", packKey: "note_investor", organizationId: "7" },
    } as unknown as Stripe.Subscription;

    await WebhookHandlers.processSubscriptionCancelled(sub);

    expect(state.packUpdates).toHaveLength(1);
    expect(state.packUpdates[0]).toMatchObject({ status: "cancelled" });
    // The dangerous path: without the guard the generic handler downgrades
    // the whole org to free. It must never run for a pack sub.
    expect(state.orgTierUpdates).toHaveLength(0);
    expect(state.orgLookups).toBe(0);
  });

  it("subscription.updated for a pack sub is a no-op for plan handling", async () => {
    const sub = {
      id: "sub_pack_1",
      customer: "cus_1",
      metadata: { type: "vertical_pack", packKey: "wholesale", organizationId: "7" },
    } as unknown as Stripe.Subscription;

    await WebhookHandlers.processSubscriptionUpdated(sub);

    expect(state.orgTierUpdates).toHaveLength(0);
    expect(state.orgLookups).toBe(0);
  });

  it("yearly interval records yearly price", async () => {
    const session = {
      id: "cs_2",
      mode: "subscription",
      subscription: "sub_pack_2",
      metadata: { type: "vertical_pack", packKey: "buy_and_hold", interval: "yearly", organizationId: "9" },
    } as unknown as Stripe.Checkout.Session;

    await WebhookHandlers.processVerticalPackPurchase(session);

    expect(state.packUpserts[0]).toMatchObject({
      organizationId: 9,
      packKey: "buy_and_hold",
      billingInterval: "yearly",
      priceCents: 200000,
    });
  });
});
