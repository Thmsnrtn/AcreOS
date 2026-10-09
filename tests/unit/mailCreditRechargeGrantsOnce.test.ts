/**
 * A paid mail-credit recharge grants its credits — once.
 *
 * POST /api/outreach/mail/credits/recharge sells a Stripe checkout tagged
 * `metadata.type = "mail_credit_recharge"`. Until 2026-10-09 the webhook had
 * no branch for that type: the customer paid $20–$250 and received nothing.
 *
 * Driven through the REAL route (mountStripeWebhook) and the REAL verifier
 * with a correctly signed event, then the real dispatch → handler → grant.
 * The event-level claim is stubbed to ALWAYS say "new" — the worst case, a
 * claim that lost its row or a second event for the same session — so the
 * at-most-once property has to hold in the grant itself:
 *
 *   pay → credits granted once (at 1.5¢/credit, rounded down, on what was
 *   PAID) → replay 3× → still once → a second event id for the same session
 *   → still once. An unpaid session grants nothing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import Stripe from "stripe";

const SECRET = "whsec_test_mail_recharge";
const stripe = new Stripe("sk_test_mail_recharge");

const fake = vi.hoisted(() => ({
  balance: 0,
  txns: [] as Array<{ id: number; type: string; amountCents: number; stripeCheckoutSessionId?: string; balanceAfterCents: number }>,
}));

vi.mock("../../server/stripeClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../server/stripeClient")>()),
  getUncachableStripeClient: vi.fn(async () => stripe),
}));
vi.mock("../../server/services/oncall", () => ({ notifyOnCall: vi.fn(async () => ({ notificationId: 1 })) }));
vi.mock("../../server/storage", () => ({ storage: {}, db: {} }));
vi.mock("../../server/db", () => {
  // Rows are told apart by SHAPE, not by table identity (vi.resetModules
  // re-instantiates the schema module between apps). A transaction over the two rows the grant touches, honouring the partial
  // unique index credit_txn_mail_recharge_session_uniq.
  const tx = {
    insert: (_table: unknown) => ({
      values: (row: any) => ({
        onConflictDoNothing: () => ({
          returning: async () => {
            if (!("amountCents" in row && "type" in row)) throw new Error("unexpected insert");
            const dup = fake.txns.some(
              (t) => t.type === "mail_credit_recharge" && t.stripeCheckoutSessionId === row.stripeCheckoutSessionId,
            );
            if (row.type === "mail_credit_recharge" && dup) return [];
            const id = fake.txns.length + 1;
            fake.txns.push({ id, ...row });
            return [{ id }];
          },
        }),
      }),
    }),
    update: (_table: unknown) => ({
      set: (patch: any) => ({
        where: () => {
          if ("creditBalance" in patch) {
            const last = fake.txns[fake.txns.length - 1];
            fake.balance += last.amountCents;
            return { returning: async () => [{ newBalance: fake.balance }] };
          }
          const last = fake.txns[fake.txns.length - 1];
          Object.assign(last, patch);
          return Promise.resolve();
        },
      }),
    }),
  };
  return { db: {}, withTransaction: async (fn: (t: unknown) => unknown) => fn(tx) };
});

function signedCheckout(eventId: string, session: Record<string, unknown>) {
  const payload = JSON.stringify({
    id: eventId,
    object: "event",
    type: "checkout.session.completed",
    data: { object: { object: "checkout.session", ...session } },
  });
  return { payload, header: stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET }) };
}

const PAID = {
  id: "cs_mail_1",
  mode: "payment",
  payment_status: "paid",
  amount_total: 5000,
  payment_intent: "pi_mail_1",
  metadata: { type: "mail_credit_recharge", organizationId: "42", packCents: "5000" },
};

async function freshApp() {
  vi.resetModules();
  const route = await import("../../server/stripeWebhookRoute");
  const { WebhookHandlers } = await import("../../server/webhookHandlers");
  const handlers = WebhookHandlers as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
  vi.spyOn(handlers, "claimEvent").mockResolvedValue(true); // worst case: every delivery looks new
  vi.spyOn(handlers, "releaseClaim").mockResolvedValue(undefined);
  const app = express();
  route.mountStripeWebhook(app);
  return app;
}

const post = (app: express.Express, { payload, header }: { payload: string; header: string }) =>
  request(app).post("/api/stripe/webhook").set("content-type", "application/json").set("stripe-signature", header).send(payload);

beforeEach(() => {
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  fake.balance = 0;
  fake.txns.length = 0;
});

describe("mail-credit recharge via the signed Stripe webhook", () => {
  it("pay → granted once at 1.5¢/credit; replay 3× → still once; a second event for the session → still once", async () => {
    const app = await freshApp();
    const evt = signedCheckout("evt_mail_1", PAID);

    expect((await post(app, evt)).status).toBe(200);
    expect(fake.balance).toBe(3333); // $50 / 1.5¢, rounded down
    expect(fake.txns).toHaveLength(1);
    expect(fake.txns[0]).toMatchObject({ type: "mail_credit_recharge", amountCents: 3333, balanceAfterCents: 3333, stripeCheckoutSessionId: "cs_mail_1" });

    for (let i = 0; i < 3; i++) expect((await post(app, evt)).status).toBe(200);
    expect(fake.balance).toBe(3333);
    expect(fake.txns).toHaveLength(1);

    expect((await post(app, signedCheckout("evt_mail_1_dup", PAID))).status).toBe(200);
    expect(fake.balance).toBe(3333);
    expect(fake.txns).toHaveLength(1);
  });

  it("grants on what was PAID, not on the metadata's claim", async () => {
    const app = await freshApp();
    await post(app, signedCheckout("evt_mail_2", { ...PAID, id: "cs_mail_2", amount_total: 2000, metadata: { ...PAID.metadata, packCents: "25000" } }));
    expect(fake.balance).toBe(1333);
  });

  it("an unpaid session grants nothing", async () => {
    const app = await freshApp();
    await post(app, signedCheckout("evt_mail_3", { ...PAID, id: "cs_mail_3", payment_status: "unpaid" }));
    expect(fake.balance).toBe(0);
    expect(fake.txns).toHaveLength(0);
  });
});
