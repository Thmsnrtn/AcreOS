/**
 * The Stripe webhook pages on-call only for an incident.
 *
 * A delivery that does not verify (no signature, or one that does not match
 * the endpoint secret) is not an incident: it says nothing about a customer.
 * It answers 400 and never pages. A VERIFIED event whose processing fails is
 * the incident, and it pages exactly once per window, however many times
 * Stripe re-delivers it.
 *
 * The route under test is the real one (mountStripeWebhook) over the real
 * WebhookHandlers verifier with a real Stripe signature; only the pager, the
 * event claim and the dispatch are stubbed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import Stripe from "stripe";

const SECRET = "whsec_test_paging";
const stripe = new Stripe("sk_test_paging");

const notifyOnCall = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => ({ notificationId: 1 })));
vi.mock("../../server/services/oncall", () => ({ notifyOnCall }));
vi.mock("../../server/stripeClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../server/stripeClient")>()),
  getUncachableStripeClient: vi.fn(async () => stripe),
}));
vi.mock("../../server/storage", () => ({ storage: {}, db: {} }));
vi.mock("../../server/db", () => ({ db: {}, withTransaction: vi.fn() }));

function signedEvent(id: string, type = "invoice.payment_succeeded") {
  const payload = JSON.stringify({ id, object: "event", type, data: { object: {} } });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
  return { payload, header };
}

async function freshApp() {
  vi.resetModules();
  const route = await import("../../server/stripeWebhookRoute");
  const { WebhookHandlers } = await import("../../server/webhookHandlers");
  route.resetStripeWebhookPageWindow();
  const handlers = WebhookHandlers as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
  const claim = vi.spyOn(handlers, "claimEvent").mockResolvedValue(true);
  const release = vi.spyOn(handlers, "releaseClaim").mockResolvedValue(undefined);
  const dispatch = vi.spyOn(handlers, "dispatchEvent").mockResolvedValue(undefined);
  const app = express();
  route.mountStripeWebhook(app);
  return { app, claim, release, dispatch };
}

beforeEach(() => {
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  notifyOnCall.mockClear();
});

describe("deliveries that do not verify", () => {
  it("20 forged and 5 unsigned POSTs are all 400 and page no one", async () => {
    const { app, dispatch } = await freshApp();
    const body = JSON.stringify({ id: "evt_forged", type: "checkout.session.completed", data: { object: {} } });

    for (let i = 0; i < 20; i++) {
      const res = await request(app)
        .post("/api/stripe/webhook")
        .set("content-type", "application/json")
        .set("stripe-signature", `t=${1 + i},v1=00`)
        .send(body);
      expect(res.status).toBe(400);
    }
    for (let i = 0; i < 5; i++) {
      const res = await request(app).post("/api/stripe/webhook").set("content-type", "application/json").send(body);
      expect(res.status).toBe(400);
    }

    await new Promise((r) => setImmediate(r));
    expect(notifyOnCall).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("a signature made with a different secret is rejected the same way", async () => {
    const { app } = await freshApp();
    const payload = JSON.stringify({ id: "evt_other", object: "event", type: "x", data: { object: {} } });
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_someone_else" });
    const res = await request(app)
      .post("/api/stripe/webhook")
      .set("content-type", "application/json")
      .set("stripe-signature", header)
      .send(payload);
    expect(res.status).toBe(400);
    await new Promise((r) => setImmediate(r));
    expect(notifyOnCall).not.toHaveBeenCalled();
  });
});

describe("a verified event that fails to process", () => {
  it("pages exactly once, however many times Stripe re-delivers it", async () => {
    const { app, dispatch, release } = await freshApp();
    dispatch.mockRejectedValue(new Error("handler blew up"));
    const { payload, header } = signedEvent("evt_fails");

    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await request(app)
        .post("/api/stripe/webhook")
        .set("content-type", "application/json")
        .set("stripe-signature", header)
        .send(payload);
      expect(res.status).toBe(400);
    }

    await new Promise((r) => setImmediate(r));
    expect(dispatch).toHaveBeenCalledTimes(4);
    expect(release).toHaveBeenCalledTimes(4);
    expect(notifyOnCall).toHaveBeenCalledTimes(1);
    expect(notifyOnCall.mock.calls[0][0]).toBe("P0");
  });

  it("a verified event that processes is 200 and pages no one", async () => {
    const { app } = await freshApp();
    const { payload, header } = signedEvent("evt_ok");
    const res = await request(app)
      .post("/api/stripe/webhook")
      .set("content-type", "application/json")
      .set("stripe-signature", header)
      .send(payload);
    expect(res.status).toBe(200);
    expect(notifyOnCall).not.toHaveBeenCalled();
  });
});

describe("the per-IP limiter applies only to deliveries that do not verify", () => {
  it("a full bucket of forged deliveries from one address does not throttle a verified delivery from it", async () => {
    const { app } = await freshApp();
    // The address a forged header names — the limiter keys on it.
    const ip = "203.0.113.7";

    const statuses: number[] = [];
    for (let i = 0; i < 61; i++) {
      const res = await request(app)
        .post("/api/stripe/webhook")
        .set("cf-connecting-ip", ip)
        .set("content-type", "application/json")
        .set("stripe-signature", "t=1,v1=00")
        .send("{}");
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 60).every((s) => s === 400)).toBe(true);
    expect(statuses[60]).toBe(429);

    for (let i = 0; i < 5; i++) {
      const { payload, header } = signedEvent(`evt_after_burst_${i}`);
      const res = await request(app)
        .post("/api/stripe/webhook")
        .set("cf-connecting-ip", ip)
        .set("content-type", "application/json")
        .set("stripe-signature", header)
        .send(payload);
      expect(res.status).toBe(200);
    }
  });
});

describe("simulation mode does not switch verification off", () => {
  it("with SIMULATION_MODE_STRIPE on, a forged delivery is still rejected and pages no one", async () => {
    const { app, dispatch } = await freshApp();
    const actual = await vi.importActual<typeof import("../../server/stripeClient")>("../../server/stripeClient");
    const mocked = await import("../../server/stripeClient");
    vi.mocked(mocked.getUncachableStripeClient).mockImplementation(actual.getUncachableStripeClient);
    const prev = { key: process.env.STRIPE_SECRET_KEY, sim: process.env.SIMULATION_MODE_STRIPE };
    process.env.STRIPE_SECRET_KEY = "sk_test_paging";
    process.env.SIMULATION_MODE_STRIPE = "true";
    try {
      for (let i = 0; i < 3; i++) {
        const res = await request(app)
          .post("/api/stripe/webhook")
          .set("content-type", "application/json")
          .set("stripe-signature", `t=${i + 1},v1=00`)
          .send(JSON.stringify({ id: "evt_sim", type: "checkout.session.completed", data: { object: {} } }));
        expect(res.status).toBe(400);
      }
      const { payload, header } = signedEvent("evt_sim_ok");
      const ok = await request(app)
        .post("/api/stripe/webhook")
        .set("content-type", "application/json")
        .set("stripe-signature", header)
        .send(payload);
      expect(ok.status).toBe(200);
    } finally {
      process.env.STRIPE_SECRET_KEY = prev.key;
      process.env.SIMULATION_MODE_STRIPE = prev.sim;
      if (prev.key === undefined) delete process.env.STRIPE_SECRET_KEY;
      if (prev.sim === undefined) delete process.env.SIMULATION_MODE_STRIPE;
    }
    await new Promise((r) => setImmediate(r));
    expect(notifyOnCall).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});
