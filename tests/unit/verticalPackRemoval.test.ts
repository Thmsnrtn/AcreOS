/**
 * Vertical-pack purchase path — REMOVED (founder decision 2026-10-18).
 *
 * Verticals are included profiles, not paid add-ons: there is no price, no
 * Stripe product, and no checkout for a vertical, so no pack subscription
 * can ever exist. These tests pin the removal:
 *
 *   1. the pack activation + cancellation handlers are gone;
 *   2. no `vertical_pack` metadata branching remains in webhookHandlers.ts;
 *   3. a subscription carrying legacy `vertical_pack` metadata is treated
 *      like any other subscription (generic path) — there is no early
 *      return that would swallow it.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HANDLERS_TS = resolve(__dirname, "../../server/webhookHandlers.ts");
const handlersSource = readFileSync(HANDLERS_TS, "utf8");

const state = {
  orgTierUpdates: [] as any[],
  orgLookups: 0,
};

vi.mock("../../server/storage", () => ({
  storage: {
    getOrganizationByStripeCustomerId: vi.fn(async () => {
      state.orgLookups += 1;
      return { id: 1, name: "Org", subscriptionTier: "pro", dunningStage: "none" };
    }),
  },
  db: new Proxy({}, { get: () => () => { throw new Error("db not available in this test"); } }),
}));

vi.mock("../../server/db", () => ({
  withTransaction: vi.fn(async (fn: any) => fn({})),
}));

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { WebhookHandlers } from "../../server/webhookHandlers";

beforeEach(() => {
  state.orgTierUpdates = [];
  state.orgLookups = 0;
});

describe("vertical-pack webhook removal", () => {
  it("the pack activation and cancellation handlers no longer exist", () => {
    const handlers = WebhookHandlers as unknown as Record<string, unknown>;
    expect(handlers.processVerticalPackPurchase).toBeUndefined();
    expect(handlers.cancelVerticalPack).toBeUndefined();
  });

  it("no vertical_pack metadata branching remains in webhookHandlers.ts", () => {
    expect(handlersSource).not.toMatch(/metadata\?\.type === 'vertical_pack'/);
    expect(handlersSource).not.toMatch(/type:\s*["']vertical_pack["']/);
    expect(handlersSource).not.toContain("processVerticalPackPurchase");
    expect(handlersSource).not.toContain("cancelVerticalPack");
  });

  it("a subscription with legacy vertical_pack metadata takes the generic path (no silent swallow)", async () => {
    const sub = {
      id: "sub_legacy_pack",
      customer: "cus_1",
      metadata: { type: "vertical_pack", packKey: "note_investor", organizationId: "7" },
    } as never;

    // With the pack guard removed, the handler looks the org up by Stripe
    // customer id and runs the generic cancellation — it must not return
    // early as if the subscription were a pack add-on.
    await WebhookHandlers.processSubscriptionCancelled(sub).catch(() => {});
    expect(state.orgLookups).toBeGreaterThan(0);
  });
});
