/**
 * Track A — the Stripe webhook claim/release idempotency contract
 * (DEFECT-0006 atomic claim + the W1.8 release-on-failure repair).
 *
 * This is the single most safety-critical money-path behavior: a duplicate
 * delivery must be a no-op (never double-provision credits), while a FAILED
 * handler must release its claim and re-throw so Stripe's retry ladder can
 * re-deliver (never ack 200 on charged-but-not-provisioned). These semantics
 * existed but had no direct test coverage.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const state = {
  claims: new Set<string>(),
  dispatches: [] as string[],
  dispatchShouldFail: false,
  deleteFails: false,
};

vi.mock("../../server/stripeClient", () => ({
  getUncachableStripeClient: vi.fn(async () => ({
    webhooks: {
      // Signature verification is Stripe's job — the tests exercise what WE
      // do after a verified event arrives. Payload carries the event JSON.
      constructEvent: (payload: Buffer, _sig: string, _secret: string) => JSON.parse(payload.toString()),
    },
  })),
  getStripeSecretKey: vi.fn(() => "sk_test_123"),
}));

vi.mock("../../server/storage", () => ({
  storage: {},
  db: {
    insert: (_t: any) => ({
      values: (v: any) => ({
        onConflictDoNothing: () => ({
          returning: () => {
            // Mirrors the Postgres unique index on stripe_event_id: first
            // insert claims (returns the row), replays return [].
            if (state.claims.has(v.stripeEventId)) return Promise.resolve([]);
            state.claims.add(v.stripeEventId);
            return Promise.resolve([{ id: 1 }]);
          },
        }),
      }),
    }),
    delete: (_t: any) => ({
      where: (_w: any) => {
        if (state.deleteFails) return Promise.reject(new Error("db down"));
        // The release path deletes by event id; model it as clearing all
        // (each test uses a single event id).
        state.claims.clear();
        return Promise.resolve();
      },
    }),
  },
}));

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/services/autopilot/perception", () => ({ recordSense: vi.fn(async () => {}) }));

import { WebhookHandlers } from "../../server/webhookHandlers";

function eventPayload(id: string): Buffer {
  return Buffer.from(JSON.stringify({ id, type: "checkout.session.completed", data: { object: { id: "cs_1", mode: "payment", metadata: {} } } }));
}

beforeEach(() => {
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  state.claims = new Set();
  state.dispatches = [];
  state.dispatchShouldFail = false;
  state.deleteFails = false;
  // Stub the private static dispatcher — these tests pin the claim/release
  // envelope, not the per-event handlers (covered elsewhere).
  (WebhookHandlers as any).dispatchEvent = vi.fn(async (event: { id: string }) => {
    state.dispatches.push(event.id);
    if (state.dispatchShouldFail) throw new Error("handler exploded");
  });
});

describe("processWebhook — atomic claim / release-on-failure envelope", () => {
  it("first delivery claims the event and dispatches exactly once", async () => {
    await WebhookHandlers.processWebhook(eventPayload("evt_1"), "sig");
    expect(state.dispatches).toEqual(["evt_1"]);
    expect(state.claims.has("evt_1")).toBe(true);
  });

  it("a DUPLICATE delivery is skipped — the handler never runs twice (no double-provisioning)", async () => {
    await WebhookHandlers.processWebhook(eventPayload("evt_1"), "sig");
    await WebhookHandlers.processWebhook(eventPayload("evt_1"), "sig");
    expect(state.dispatches).toEqual(["evt_1"]);
  });

  it("a FAILED handler releases the claim and re-throws — Stripe's retry can be processed", async () => {
    state.dispatchShouldFail = true;
    await expect(WebhookHandlers.processWebhook(eventPayload("evt_2"), "sig")).rejects.toThrow("handler exploded");
    // Claim released → the redelivery is claimable and dispatches again.
    expect(state.claims.has("evt_2")).toBe(false);
    state.dispatchShouldFail = false;
    await WebhookHandlers.processWebhook(eventPayload("evt_2"), "sig");
    expect(state.dispatches).toEqual(["evt_2", "evt_2"]);
    expect(state.claims.has("evt_2")).toBe(true);
  });

  it("a failing release is best-effort — the ORIGINAL handler error still propagates", async () => {
    state.dispatchShouldFail = true;
    state.deleteFails = true;
    await expect(WebhookHandlers.processWebhook(eventPayload("evt_3"), "sig")).rejects.toThrow("handler exploded");
  });

  it("refuses to process without a configured webhook secret", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    await expect(WebhookHandlers.processWebhook(eventPayload("evt_4"), "sig")).rejects.toThrow(/STRIPE_WEBHOOK_SECRET/);
    expect(state.dispatches).toEqual([]);
  });
});
