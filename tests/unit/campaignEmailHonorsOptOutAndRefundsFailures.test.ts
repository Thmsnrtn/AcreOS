/**
 * POST /api/campaigns/:id/send-email — two defects, one route.
 *
 * 1. THE AUDIENCE IGNORED OPT-OUT. The SMS path runs every lead through the
 *    TCPA gate and the direct-mail path through the pre-mail scanner, both of
 *    which drop `doNotContact` / `optOutDate` leads. The email path filtered on
 *    "has an email address" and nothing else, so a lead the operator had marked
 *    do-not-contact received the campaign.
 *
 * 2. A FAILED SEND WAS COUNTED AND BILLED AS SENT. `emailService.sendEmail`
 *    reports failure by RETURNING `{ success: false }` (no connected identity,
 *    warm-up cap, suppressed recipient, provider rejection) — it does not throw.
 *    The route awaited it and ignored the result: every recipient was counted
 *    `sent`, recorded as a `sent` delivery event, and kept its upfront charge.
 *
 * This drives the REAL handler (registered from routes-campaigns.ts) against
 * stubbed storage, credits and email transport, and asserts on what the route
 * did — who it mailed, what it recorded, and what it refunded in which
 * transaction — not on what its source says.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { campaignDeliveryEvents } from "@shared/schema";

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

type Lead = {
  id: number;
  firstName: string;
  lastName: string;
  email: string | null;
  doNotContact?: boolean | null;
  optOutDate?: Date | null;
  tcpaConsent?: boolean | null;
};

const S = vi.hoisted(() => ({
  leads: new Map<number, Lead>(),
  failFor: new Set<string>(),
  suppressed: new Set<string>(),
  sentTo: [] as string[],
  deducted: [] as number[],
  refunds: [] as Array<{ cents: number; tx: unknown }>,
  // Every delivery-event insert, tagged with the executor it ran on (db or a tx).
  events: [] as Array<{ row: Record<string, unknown>; on: unknown }>,
  campaignUpdates: [] as Array<Record<string, unknown>>,
  rootDb: null as unknown,
  campaign: {} as Record<string, unknown>,
  // What deductCredits reports it took (the founder bypass takes 0).
  debitTakes: null as number | null,
  // A lead whose failure-record transaction throws (the loop dies there).
  txThrowsFor: null as number | null,
}));

vi.mock("../../server/services/credits", () => ({
  creditService: {
    deductCredits: async (_o: number, cents: number) => (S.deducted.push(cents), { id: 1, amountCents: S.debitTakes ?? -cents }),
    addCredits: async (_o: number, cents: number, _t: string, _d: string, _m?: unknown, opts?: { tx?: unknown }) => {
      S.refunds.push({ cents, tx: opts?.tx });
      return { id: 2 };
    },
  },
  usageMeteringService: {},
}));
vi.mock("../../server/services/emailService", () => ({
  // Merged with the cost-efficiency stack: the route asks the transport's own
  // identity resolver before any credit moves (BYO send rail).
  counterpartyEmailIdentityStatus: async () => ({ canSend: true, ownSesCredentials: false }),
  emailService: {
    sendEmail: async (o: { to: string }) => {
      if (S.failFor.has(o.to)) {
        return { success: false, error: "No connected email identity for this organization.", errorType: "configuration_error" };
      }
      S.sentTo.push(o.to);
      return { success: true, messageId: `m-${o.to}` };
    },
  },
}));
vi.mock("../../server/services/emailSuppressions", () => ({
  filterSuppressed: async (emails: string[]) => {
    const norm = emails.map((e) => e.trim().toLowerCase());
    return { allowed: norm.filter((e) => !S.suppressed.has(e)), suppressed: norm.filter((e) => S.suppressed.has(e)) };
  },
}));
vi.mock("../../server/services/activation", () => ({ recordActivationEventAsync: () => undefined }));
vi.mock("../../server/storage", () => {
  const executor = (tag: unknown) => ({
    insert: (t: unknown) => ({
      values: async (row: Record<string, unknown>) => {
        if (t === campaignDeliveryEvents) S.events.push({ row, on: tag });
        return [];
      },
    }),
  });
  const db: Record<string, unknown> = {
    // The dedup read: nothing has been sent before in these tests.
    select: () => ({ from: () => ({ where: async () => [] }) }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx: Record<string, unknown> = {};
      const inner = executor(tx).insert;
      tx.insert = (t: unknown) => ({
        values: async (row: Record<string, unknown>) => {
          if (S.txThrowsFor !== null && row.leadId === S.txThrowsFor) throw new Error("connection reset");
          return inner(t).values(row);
        },
      });
      return fn(tx);
    },
  };
  Object.assign(db, { insert: executor(db).insert });
  S.rootDb = db;
  return {
    storage: {
      getCampaign: async () => S.campaign,
      getLead: async (_o: number, id: number) => S.leads.get(id),
      updateCampaign: async (_id: number, patch: Record<string, unknown>) => (S.campaignUpdates.push(patch), patch),
    },
    db,
  };
});

type Handler = (req: unknown, res: unknown) => Promise<unknown>;
async function handler(): Promise<Handler> {
  const { registerCampaignRoutes } = await import("../../server/routes-campaigns");
  const routes: Array<{ method: string; path: string; args: unknown[] }> = [];
  const app: Record<string, unknown> = {};
  for (const m of ["get", "post", "patch", "put", "delete", "use"]) {
    app[m] = (path: string, ...args: unknown[]) => routes.push({ method: m, path, args });
  }
  registerCampaignRoutes(app as never);
  const r = routes.find((x) => x.method === "post" && x.path === "/api/campaigns/:id/send-email");
  if (!r) throw new Error("send-email not registered");
  return r.args[r.args.length - 1] as Handler;
}
function res() {
  const r = { statusCode: 200, body: undefined as Record<string, any> | undefined } as {
    statusCode: number;
    body?: Record<string, any>;
    status: (c: number) => unknown;
    json: (b: Record<string, any>) => unknown;
  };
  r.status = (c: number) => ((r.statusCode = c), r);
  r.json = (b: Record<string, any>) => ((r.body = b), r);
  return r;
}
const req = (leadIds: number[]) => ({
  params: { id: "9" },
  body: { leadIds },
  headers: {},
  organization: { id: 5, settings: {} },
  user: { id: "u1" },
  isFounder: false,
});

const lead = (id: number, extra: Partial<Lead> = {}): Lead => ({
  id,
  firstName: `F${id}`,
  lastName: `L${id}`,
  email: `lead${id}@example.com`,
  doNotContact: false,
  optOutDate: null,
  // The stack's email audience is canSendViaChannel: consent is required too.
  tcpaConsent: true,
  ...extra,
});

beforeEach(() => {
  S.leads = new Map();
  S.failFor = new Set();
  S.suppressed = new Set();
  S.sentTo = [];
  S.deducted = [];
  S.refunds = [];
  S.events = [];
  S.campaignUpdates = [];
  S.campaign = { id: 9, name: "October list", type: "email", subject: "About your parcel", content: "Hi {{firstName}}" };
  S.debitTakes = null;
  S.txThrowsFor = null;
});

describe("campaign email: opted-out leads are not in the audience", () => {
  it("a doNotContact lead and an optOutDate lead are excluded, counted, and not charged", async () => {
    S.leads.set(1, lead(1));
    S.leads.set(2, lead(2, { doNotContact: true }));
    S.leads.set(3, lead(3, { optOutDate: new Date("2026-09-01T00:00:00Z") }));
    const r = res();
    await (await handler())(req([1, 2, 3]), r);

    expect(r.statusCode).toBe(200);
    expect(S.sentTo).toEqual(["lead1@example.com"]);
    expect(r.body).toMatchObject({ sent: 1, failed: 0, excluded: { doNotContact: 2, suppressed: 0 } });
    // Charged for the one recipient actually attempted, not three.
    expect(S.deducted).toEqual([1]);
  });

  it("a suppressed address is excluded before it is charged", async () => {
    S.leads.set(1, lead(1));
    S.leads.set(6, lead(6, { email: "Lead6@Example.com" }));
    S.suppressed.add("lead6@example.com");
    const r = res();
    await (await handler())(req([1, 6]), r);
    expect(S.sentTo).toEqual(["lead1@example.com"]);
    expect(r.body).toMatchObject({ sent: 1, excluded: { doNotContact: 0, suppressed: 1 } });
    expect(S.deducted).toEqual([1]);
  });

  it("an audience that is entirely opted out sends nothing and charges nothing", async () => {
    S.leads.set(2, lead(2, { doNotContact: true }));
    const r = res();
    await (await handler())(req([2]), r);
    expect(r.statusCode).toBe(400);
    expect(S.sentTo).toEqual([]);
    expect(S.deducted).toEqual([]);
  });
});

describe("campaign email: a failed send is recorded as failed and its charge returned", () => {
  it("the transport's { success: false } is a failure, not a send", async () => {
    S.leads.set(1, lead(1));
    S.leads.set(4, lead(4));
    S.failFor.add("lead4@example.com");
    const r = res();
    await (await handler())(req([1, 4]), r);

    expect(r.body).toMatchObject({ sent: 1, failed: 1 });
    const byLead = Object.fromEntries(S.events.map((e) => [e.row.leadId, e.row.status]));
    expect(byLead).toEqual({ 1: "sent", 4: "failed" });
    // The failed row does not carry a send time — nothing was sent.
    expect(S.events.find((e) => e.row.leadId === 4)?.row.sentAt).toBeNull();
  });

  it("the refund posts in the SAME transaction that records the failure", async () => {
    S.leads.set(4, lead(4));
    S.failFor.add("lead4@example.com");
    await (await handler())(req([4]), res());

    expect(S.deducted).toEqual([1]);
    expect(S.refunds).toHaveLength(1);
    expect(S.refunds[0].cents).toBe(1);
    const failedEvent = S.events.find((e) => e.row.status === "failed");
    expect(failedEvent, "the failure was never recorded").toBeDefined();
    // Both writes ran on one transaction handle, and it is not the root pool.
    expect(failedEvent!.on).not.toBe(S.rootDb);
    expect(failedEvent!.on).toBeTruthy();
    expect(S.refunds[0].tx).toBe(failedEvent!.on);
  });

  it("a successful recipient is never refunded, and nothing is refunded twice", async () => {
    S.leads.set(1, lead(1));
    S.leads.set(4, lead(4));
    S.leads.set(7, lead(7));
    S.failFor.add("lead4@example.com");
    S.failFor.add("lead7@example.com");
    await (await handler())(req([1, 4, 7]), res());
    expect(S.deducted).toEqual([3]);
    expect(S.refunds.map((x) => x.cents).reduce((a, b) => a + b, 0)).toBe(2);
  });

  it("a campaign where every send failed is not marked sent", async () => {
    S.leads.set(4, lead(4));
    S.failFor.add("lead4@example.com");
    const r = res();
    await (await handler())(req([4]), r);
    expect(r.body).toMatchObject({ sent: 0, failed: 1 });
    expect(S.campaignUpdates.some((u) => u.status === "sent")).toBe(false);
  });
});

describe("campaign email: a refusal before any send keeps no charge", () => {
  it("a campaign with no content is refused before credits are taken", async () => {
    S.campaign = { ...S.campaign, content: "" };
    S.leads.set(1, lead(1));
    const r = res();
    await (await handler())(req([1]), r);
    expect(r.statusCode).toBe(400);
    expect(S.sentTo).toEqual([]);
    // The refusal used to come AFTER the upfront debit, and returned with it kept.
    expect(S.deducted).toEqual([]);
  });
});

describe("campaign email: the charge is exactly what was taken, once per recipient", () => {
  it("a repeated lead id is charged once", async () => {
    S.leads.set(1, lead(1));
    S.leads.set(4, lead(4));
    const r = res();
    await (await handler())(req([1, 1, 4, 4]), r);
    expect(S.deducted).toEqual([2]);
    expect(S.sentTo).toEqual(["lead1@example.com", "lead4@example.com"]);
  });

  it("a zero debit (founder bypass) is never refunded", async () => {
    S.debitTakes = 0;
    S.leads.set(4, lead(4));
    S.failFor.add("lead4@example.com");
    const r = res();
    await (await handler())(req([4]), r);
    expect(r.body).toMatchObject({ failed: 1, refunded: 0 });
    expect(S.refunds).toEqual([]);
  });

  it("a send that dies part-way refunds every recipient not settled", async () => {
    // 1 sends; 4 fails and its failure transaction throws; 7 is never reached.
    for (const id of [1, 4, 7]) S.leads.set(id, lead(id));
    S.failFor.add("lead4@example.com");
    S.txThrowsFor = 4;
    const r = res();
    await (await handler())(req([1, 4, 7]), r);
    expect(r.statusCode).toBe(500);
    expect(S.deducted).toEqual([3]);
    // 4 (its rolled-back refund) and 7 (never attempted) — not 1, which was sent.
    expect(S.refunds.map((x) => x.cents)).toEqual([2]);
  });

  it("the route carries the idempotency middleware, as its siblings do", async () => {
    const { idempotencyMiddleware } = await import("../../server/middleware/idempotency");
    const { registerCampaignRoutes } = await import("../../server/routes-campaigns");
    const routes: Array<{ method: string; path: string; args: unknown[] }> = [];
    const app: Record<string, unknown> = {};
    for (const m of ["get", "post", "patch", "put", "delete", "use"]) {
      app[m] = (path: string, ...args: unknown[]) => routes.push({ method: m, path, args });
    }
    registerCampaignRoutes(app as never);
    for (const path of ["/api/campaigns/:id/send-email", "/api/campaigns/:id/send-sms", "/api/campaigns/:id/send-direct-mail"]) {
      const r = routes.find((x) => x.method === "post" && x.path === path)!;
      expect(r.args, path).toContain(idempotencyMiddleware);
    }
  });
});
