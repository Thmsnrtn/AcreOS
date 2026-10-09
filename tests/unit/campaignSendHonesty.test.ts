/**
 * Campaign email/SMS sends tell the truth about who was reached and what it
 * cost.
 *
 * ── THE DEFECTS ─────────────────────────────────────────────────────────────
 * 1. `send-email` filtered recipients only on "has an email", so a lead marked
 *    do-not-contact (or with no consent, or on the suppression list) was
 *    mailed. And the loop ignored `sendEmail`'s result: the transport RETURNS
 *    `{ success: false }` for a refused message rather than throwing, so every
 *    refusal was counted as sent, kept its charge, and was recorded in
 *    campaign_delivery_events as delivered.
 * 2. With no counterparty email identity, the transport refuses every message
 *    (BYO rails) — and the route still charged, looped, and answered
 *    `success: true`. It now refuses up front, with a next step, before any
 *    credit moves.
 * 3. `send-sms` deducted 3¢ per text unconditionally, though campaign SMS only
 *    ever goes out on the org's OWN connected number — the customer already
 *    pays the carrier. A BYO send now costs nothing; a non-BYO (simulated) send
 *    is still charged.
 *
 * Everything below drives the real registered handlers with the transport and
 * ledger mocked, and asserts on the effects: what was sent, what was charged,
 * what was refunded, what was recorded, and what the response said.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

type Lead = {
  id: number;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  doNotContact: boolean;
  tcpaConsent: boolean;
  timezone?: string;
};

const S = vi.hoisted(() => ({
  leads: new Map<number, Lead>(),
  campaignType: "email" as "email" | "sms",
  deducted: [] as number[],
  refunds: [] as number[],
  emailSendsTo: [] as string[],
  emailFailFor: new Set<string>(),
  suppressed: new Set<string>(),
  identity: { canSend: true, ownSesCredentials: false, verifiedDomain: true },
  smsSendsTo: [] as string[],
  byoSms: true,
  simulated: false,
  deliveryInserts: [] as Array<Record<string, unknown>>,
  campaignUpdates: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../server/middleware/idempotency", () => ({
  idempotencyMiddleware: (_q: unknown, _r: unknown, next: () => void) => next(),
}));
vi.mock("../../server/services/credits", () => ({
  creditService: {
    getBalance: async () => 1_000_000,
    deductCredits: async (_o: number, cents: number) => (S.deducted.push(cents), { id: 1, amountCents: -cents }),
    addCredits: async (_o: number, cents: number) => (S.refunds.push(cents), true),
  },
  usageMeteringService: {},
}));
vi.mock("../../server/utils/simulationMode", () => ({
  shouldSimulate: () => S.simulated,
  recordSimulatedAction: async () => ({ id: "sim_1" }),
}));
vi.mock("../../server/services/emailService", () => ({
  emailService: {
    sendEmail: async (o: { to: string }) => {
      S.emailSendsTo.push(o.to);
      return S.emailFailFor.has(o.to)
        ? { success: false, error: "Message rejected by provider" }
        : { success: true, messageId: `m-${o.to}` };
    },
  },
  counterpartyEmailIdentityStatus: async () => S.identity,
}));
vi.mock("../../server/services/emailSuppressions", () => ({
  filterSuppressed: async (emails: string[]) => {
    const n = emails.map((e) => e.trim().toLowerCase());
    return { allowed: n.filter((e) => !S.suppressed.has(e)), suppressed: n.filter((e) => S.suppressed.has(e)) };
  },
}));
vi.mock("../../server/services/smsService", () => ({
  sendOrgSMS: async (o: { to: string }) => (S.smsSendsTo.push(o.to), { success: true }),
  orgHasConnectedSmsIdentity: async () => S.byoSms,
}));
vi.mock("../../server/services/tcpaCompliance", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/services/tcpaCompliance")>();
  return {
    ...actual,
    // Quiet hours depend on the wall clock; this file is about billing.
    isWithinQuietHoursForLead: () => ({ blocked: false }),
  };
});
vi.mock("../../server/storage", () => ({
  storage: {
    getCampaign: async () => ({ id: 9, name: "Fall outreach", type: S.campaignType, subject: "Your land", content: "Hello {{firstName}}" }),
    getLead: async (_o: number, id: number) => S.leads.get(id),
    updateCampaign: async (_id: number, patch: Record<string, unknown>) => (S.campaignUpdates.push(patch), patch),
  },
  db: {
    select: () => ({ from: () => ({ where: async () => [] }) }),
    insert: () => ({ values: async (v: Record<string, unknown>) => { S.deliveryInserts.push(v); } }),
    // Merged with #328: a failed recipient's "failed" outcome row and its
    // refund are written in ONE transaction. Same sink; the row says failed.
    transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ insert: () => ({ values: async (v: Record<string, unknown>) => { S.deliveryInserts.push(v); } }) }),
  },
}));

type Handler = (req: unknown, res: unknown) => Promise<unknown>;
async function handler(path: string): Promise<Handler> {
  const { registerCampaignRoutes } = await import("../../server/routes-campaigns");
  const routes: Array<{ method: string; path: string; args: unknown[] }> = [];
  const app: Record<string, unknown> = {};
  for (const m of ["get", "post", "patch", "put", "delete", "use"]) {
    app[m] = (p: string, ...args: unknown[]) => routes.push({ method: m, path: p, args });
  }
  registerCampaignRoutes(app as never);
  const r = routes.find((x) => x.method === "post" && x.path === path);
  if (!r) throw new Error(`${path} not registered`);
  return r.args[r.args.length - 1] as Handler;
}
function res() {
  const r = { statusCode: 200, body: undefined as Record<string, any> | undefined } as {
    statusCode: number;
    body?: Record<string, any>;
    status: (c: number) => unknown;
    json: (b: Record<string, any>) => unknown;
    req?: unknown;
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
const lead = (id: number, over: Partial<Lead> = {}): Lead => ({
  id,
  firstName: `L${id}`,
  lastName: "Owner",
  email: `lead${id}@example.com`,
  phone: `+1512555010${id}`,
  doNotContact: false,
  tcpaConsent: true,
  timezone: "America/Chicago",
  ...over,
});

beforeEach(() => {
  S.leads = new Map();
  S.campaignType = "email";
  S.deducted = [];
  S.refunds = [];
  S.emailSendsTo = [];
  S.emailFailFor = new Set();
  S.suppressed = new Set();
  S.identity = { canSend: true, ownSesCredentials: false, verifiedDomain: true };
  S.smsSendsTo = [];
  S.byoSms = true;
  S.simulated = false;
  S.deliveryInserts = [];
  S.campaignUpdates = [];
});

describe("send-email: do-not-contact, suppression and failed sends", () => {
  it("never mails a DNC or suppressed lead, never charges or records a failed send, and says so", async () => {
    S.leads.set(1, lead(1)); // ok
    S.leads.set(2, lead(2, { doNotContact: true })); // DNC
    S.leads.set(3, lead(3)); // transport refuses
    S.leads.set(4, lead(4)); // suppressed
    S.emailFailFor.add("lead3@example.com");
    S.suppressed.add("lead4@example.com");

    const r = res();
    await (await handler("/api/campaigns/:id/send-email"))(req([1, 2, 3, 4]), r);

    expect(r.statusCode).toBe(200);
    // Nothing reached the DNC or the suppressed lead.
    expect(S.emailSendsTo).toEqual(["lead1@example.com", "lead3@example.com"]);
    // Charged for the two attempted, refunded the one that failed: net 1¢.
    expect(S.deducted).toEqual([2]);
    expect(S.refunds).toEqual([1]);
    // Only the real send is recorded as delivered; the refused one is recorded
    // as FAILED (not a delivery — it never blocks a retry).
    expect(S.deliveryInserts).toEqual([
      expect.objectContaining({ leadId: 1, status: "sent" }),
      expect.objectContaining({ leadId: 3, status: "failed" }),
    ]);
    // The response is honest about every recipient.
    expect(r.body).toMatchObject({
      success: true,
      sent: 1,
      failed: 1,
      chargedCents: 1,
      refundedCents: 1,
      skipped: { suppressed: 1, noEmail: 0, alreadySent: 0 },
    });
    expect(r.body!.skipped.notContactable).toEqual([expect.objectContaining({ leadId: 2 })]);
    expect(r.body!.errors[0]).toContain("lead3@example.com");
  });

  it("a batch where every send fails reports failure, keeps no charge, and does not mark the campaign sent", async () => {
    S.leads.set(1, lead(1));
    S.emailFailFor.add("lead1@example.com");
    const r = res();
    await (await handler("/api/campaigns/:id/send-email"))(req([1]), r);
    expect(r.body).toMatchObject({ success: false, sent: 0, failed: 1, chargedCents: 0 });
    expect(S.deducted).toEqual([1]);
    expect(S.refunds).toEqual([1]);
    expect(S.deliveryInserts).toEqual([expect.objectContaining({ leadId: 1, status: "failed" })]);
    expect(S.campaignUpdates).toEqual([]);
  });

  it("a repeated leadId is one recipient — charged once", async () => {
    S.leads.set(1, lead(1));
    const r = res();
    await (await handler("/api/campaigns/:id/send-email"))(req([1, 1]), r);
    expect(S.emailSendsTo).toEqual(["lead1@example.com"]);
    expect(S.deducted).toEqual([1]);
    expect(S.refunds).toEqual([]);
  });

  it("only DNC recipients: refused, nothing sent, nothing charged", async () => {
    S.leads.set(2, lead(2, { doNotContact: true }));
    const r = res();
    await (await handler("/api/campaigns/:id/send-email"))(req([2]), r);
    expect(r.statusCode).toBe(400);
    expect(S.emailSendsTo).toEqual([]);
    expect(S.deducted).toEqual([]);
  });
});

describe("send-email: no counterparty email identity", () => {
  it("refuses up front with a next step — nothing sent, nothing charged, never 'success'", async () => {
    S.identity = { canSend: false, ownSesCredentials: false, verifiedDomain: false };
    S.leads.set(1, lead(1));
    const r = res();
    await (await handler("/api/campaigns/:id/send-email"))(req([1]), r);
    expect(r.statusCode).toBe(400);
    expect(r.body).toMatchObject({ details: { reason: "no_counterparty_email_identity", sent: 0, charged: 0 } });
    expect(r.body!.message).toMatch(/sending domain/);
    expect(S.emailSendsTo).toEqual([]);
    expect(S.deducted).toEqual([]);
    expect(S.refunds).toEqual([]);
  });

  it("the org's OWN SES account carries the send — no AcreOS charge", async () => {
    S.identity = { canSend: true, ownSesCredentials: true, verifiedDomain: false };
    S.leads.set(1, lead(1));
    const r = res();
    await (await handler("/api/campaigns/:id/send-email"))(req([1]), r);
    expect(r.body).toMatchObject({ sent: 1, chargedCents: 0 });
    expect(S.deducted).toEqual([]);
  });
});

describe("send-sms: BYO sends are not billed twice", () => {
  it("a text on the org's own Twilio number costs no AcreOS credits", async () => {
    S.campaignType = "sms";
    S.byoSms = true;
    S.leads.set(1, lead(1));
    const r = res();
    await (await handler("/api/campaigns/:id/send-sms"))(req([1]), r);
    expect(S.smsSendsTo).toHaveLength(1);
    expect(S.deducted).toEqual([]);
    expect(S.refunds).toEqual([]);
    expect(r.body).toMatchObject({ sent: 1, chargedCents: 0, billedTo: "your_own_sms_account" });
  });

  // A simulated send moves no real text, so it moves no credit either (Stage 1
  // A5a, "simulated campaign sends are not charged"). Before that ruling this
  // case pinned a 3¢ charge; the BYO no-double-billing invariant above is
  // unchanged.
  it("a non-BYO send (simulation) is not charged — nothing real was sent", async () => {
    S.campaignType = "sms";
    S.byoSms = false;
    S.simulated = true;
    S.leads.set(1, lead(1));
    const r = res();
    await (await handler("/api/campaigns/:id/send-sms"))(req([1]), r);
    expect(S.deducted).toEqual([]);
    expect(S.refunds).toEqual([]);
    expect(r.body).toMatchObject({ sent: 1, chargedCents: 0 });
  });

  it("no BYO number and not simulated: refused before any credit moves", async () => {
    S.campaignType = "sms";
    S.byoSms = false;
    S.leads.set(1, lead(1));
    const r = res();
    await (await handler("/api/campaigns/:id/send-sms"))(req([1]), r);
    expect(r.statusCode).toBe(400);
    expect(S.deducted).toEqual([]);
    expect(S.refunds).toEqual([]);
    expect(S.smsSendsTo).toEqual([]);
  });
});
