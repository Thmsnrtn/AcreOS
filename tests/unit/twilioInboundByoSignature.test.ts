/**
 * Inbound SMS to a customer's OWN (BYO) Twilio number must arrive.
 *
 * Twilio signs a webhook with the auth token of the account the receiving
 * number lives on. `/api/webhooks/twilio/sms` verified only with the platform
 * TWILIO_AUTH_TOKEN, so every reply — and every STOP — sent to a BYO number was
 * a 401 and never processed. The org lookup by `To` also read only the legacy
 * integration row's plaintext `fromPhoneNumber`, so a number held in the BYOK
 * vault was never matched even when a request did get through.
 *
 * This drives the REAL route (registerTwilioWebhookRoutes) and the REAL
 * tcpaCompliance opt-out path over an in-memory db double, and asserts on the
 * lead row the route actually wrote.
 */
import crypto from "crypto";
import express from "express";
import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, any>;

const H = vi.hoisted(() => ({
  integrations: [] as Row[],
  byokRows: [] as Row[],
  vault: new Map<number, string>(),
  provisioned: [] as Row[],
  tracking: [] as Row[],
  leads: [] as Row[],
  activity: [] as Row[],
  handleIncoming: [] as Array<{ orgId: number; body: string }>,
}));

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/auth", () => ({ isAuthenticated: (_q: unknown, _s: unknown, n: () => void) => n() }));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (_q: unknown, _s: unknown, n: () => void) => n(),
}));
vi.mock("../../server/middleware/idempotency", () => ({
  idempotencyMiddleware: (_q: unknown, _s: unknown, n: () => void) => n(),
}));
vi.mock("../../server/routes-ai-operations", () => ({ registerAIOperationsRoutes: vi.fn() }));
vi.mock("../../server/services/leadQualification", () => ({}));
vi.mock("../../server/services/alerting", () => ({ alertingService: {} }));
vi.mock("../../server/services/credits", () => ({ usageMeteringService: {}, creditService: {} }));
vi.mock("../../server/services/creditPool", () => ({
  poolDebit: vi.fn(),
  refundPoolDebit: vi.fn(),
  poolRefusalDetails: vi.fn(),
}));
vi.mock("../../server/services/webhook-idempotency", () => ({
  withIdempotency: vi.fn(async () => ({ duplicate: false })),
}));
vi.mock("../../server/services/consentEvents", () => ({
  recordConsentRevoked: vi.fn(async () => undefined),
  recordConsentGranted: vi.fn(async () => undefined),
}));
vi.mock("../../server/services/activation", () => ({ recordActivationEventAsync: vi.fn() }));
vi.mock("../../server/services/smsService", () => ({
  handleIncomingSMS: vi.fn(async (orgId: number, _from: string, _to: string, body: string) => {
    H.handleIncoming.push({ orgId, body });
    return { success: true };
  }),
  checkTwilioConfiguration: vi.fn(),
  saveTwilioCredentials: vi.fn(),
}));
vi.mock("../../server/services/byok/key-vault", () => ({
  getByokCredential: vi.fn(async ({ organizationId }: { organizationId: number }) =>
    H.vault.get(organizationId) ?? null,
  ),
}));

const dbDouble = vi.hoisted(() => ({ db: null as any }));
async function buildDb() {
  const { getTableName } = await import("drizzle-orm");
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const dialect = new PgDialect();
  const rowsFor = (table: string): Row[] =>
    table === "organization_integrations"
      ? H.integrations.filter((r) => r.provider === "twilio" && r.isEnabled)
      : table === "byok_credentials"
        ? H.byokRows.filter((r) => r.channel === "twilio" && r.revokedAt == null)
        : table === "provisioned_phone_numbers"
          ? H.provisioned.filter((r) => r.status === "active")
          : table === "tracking_number_assignments"
            ? H.tracking.filter((r) => r.releasedAt == null)
            : [];
  return {
    select: (cols?: Record<string, { name: string }>) => {
      let table = "";
      // Honour a column projection the way drizzle does: { alias: column }.
      const camel = (n: string) => n.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
      const project = (rows: Row[]) =>
        cols
          ? rows.map((r) => Object.fromEntries(Object.entries(cols).map(([k, c]) => [k, r[camel(c.name)]])))
          : rows;
      const q: any = {
        from: (t: any) => {
          table = getTableName(t);
          return q;
        },
        where: () => q,
        limit: () => q,
        orderBy: () => q,
        then: (res: any, rej: any) => Promise.resolve(project(rowsFor(table))).then(res, rej),
      };
      return q;
    },
    update: (t: any) => ({
      set: (patch: Row) => ({
        where: async (cond: any) => {
          if (getTableName(t) !== "leads") return;
          // and(eq(leads.id, X), eq(leads.organizationId, Y)) → params [X, Y]
          const { params } = dialect.sqlToQuery(cond);
          const [id, orgId] = params as number[];
          const lead = H.leads.find((l) => l.id === id && l.organizationId === orgId);
          if (lead) Object.assign(lead, patch);
        },
      }),
    }),
    insert: () => ({
      values: async (v: Row) => {
        H.activity.push(v);
      },
    }),
  };
}

vi.mock("../../server/db", async () => {
  dbDouble.db = dbDouble.db ?? (await buildDb());
  return { db: dbDouble.db };
});
vi.mock("../../server/storage", async () => {
  dbDouble.db = dbDouble.db ?? (await buildDb());
  return {
    db: dbDouble.db,
    storage: {
      findLeadsByPhoneLast10: vi.fn(async (orgId: number, phone: string) => {
        const want = phone.replace(/\D/g, "").slice(-10);
        return H.leads.filter(
          (l) => l.organizationId === orgId && l.phone.replace(/\D/g, "").slice(-10) === want,
        );
      }),
      getLead: vi.fn(async () => undefined),
    },
  };
});

const PLATFORM_TOKEN = "platform-token-aaaaaaaaaaaaaaaa";
const BYO_TOKEN = "byo-token-of-org-7-bbbbbbbbbbbbb";
const OTHER_TOKEN = "byo-token-of-org-9-ccccccccccccc";
const BYO_NUMBER = "+15055550100";
const PLATFORM_NUMBER = "+15055550199";
const SELLER = "+15125550142";
const URL = "https://acreos.test/api/webhooks/twilio/sms";

function sign(token: string, params: Record<string, string>): string {
  const data = URL + Object.keys(params).sort().reduce((s, k) => s + k + params[k], "");
  return crypto.createHmac("sha1", token).update(Buffer.from(data, "utf-8")).digest("base64");
}

let app: express.Express;
beforeAll(async () => {
  const { registerTwilioWebhookRoutes } = await import("../../server/routes-misc");
  app = express();
  app.use(express.urlencoded({ extended: false }));
  await registerTwilioWebhookRoutes(app);
});

beforeEach(() => {
  process.env.TWILIO_AUTH_TOKEN = PLATFORM_TOKEN;
  H.integrations.length = 0;
  H.byokRows.length = 0;
  H.vault.clear();
  H.provisioned.length = 0;
  H.tracking.length = 0;
  H.activity.length = 0;
  H.handleIncoming.length = 0;
  H.leads.length = 0;
  // Org 7 holds its OWN Twilio number in the BYOK vault (no integration row).
  H.byokRows.push({ organizationId: 7, channel: "twilio", revokedAt: null });
  H.vault.set(7, `AC_org7:${BYO_TOKEN}:${BYO_NUMBER}`);
  // Org 9 is another tenant with its own account and number.
  H.integrations.push({
    organizationId: 9,
    provider: "twilio",
    isEnabled: true,
    credentials: { accountSid: "AC_org9", authToken: OTHER_TOKEN, fromPhoneNumber: "+15055550177" },
  });
  // Org 3 texts from a platform-rented tracking number.
  H.tracking.push({ organizationId: 3, number: PLATFORM_NUMBER, releasedAt: null });
  H.leads.push(
    { id: 70, organizationId: 7, phone: "512-555-0142", doNotContact: false, tcpaConsent: true },
    { id: 30, organizationId: 3, phone: "5125550142", doNotContact: false, tcpaConsent: true },
  );
});

function post(params: Record<string, string>, signature: string) {
  return request(app)
    .post("/api/webhooks/twilio/sms")
    .set("x-forwarded-proto", "https")
    .set("x-forwarded-host", "acreos.test")
    .set("x-twilio-signature", signature)
    .type("form")
    .send(params);
}

const stopTo = (to: string, sid: string, body = "STOP") => ({
  From: SELLER,
  To: to,
  Body: body,
  MessageSid: sid,
  AccountSid: "AC_x",
});

describe("inbound SMS to a BYO Twilio number", () => {
  it("a STOP signed with the org's OWN token is accepted and marks the lead do-not-contact", async () => {
    const params = stopTo(BYO_NUMBER, "SM_byo_stop");
    const res = await post(params, sign(BYO_TOKEN, params));
    expect(res.status).toBe(200);
    expect(res.text).toContain("unsubscribed");
    const lead = H.leads.find((l) => l.id === 70)!;
    expect(lead.doNotContact).toBe(true);
    expect(lead.tcpaConsent).toBe(false);
    // Only the owning org was touched.
    expect(H.leads.find((l) => l.id === 30)!.doNotContact).toBe(false);
  });

  it("a natural-language opt-out to a BYO number is honoured too", async () => {
    const params = stopTo(BYO_NUMBER, "SM_byo_nl", "Please stop texting me.");
    const res = await post(params, sign(BYO_TOKEN, params));
    expect(res.status).toBe(200);
    expect(H.leads.find((l) => l.id === 70)!.doNotContact).toBe(true);
  });

  it("a forged signature is still a 401 and changes nothing", async () => {
    const params = stopTo(BYO_NUMBER, "SM_forged");
    const res = await post(params, sign("not-anybodys-token", params));
    expect(res.status).toBe(401);
    expect(H.leads.every((l) => l.doNotContact === false)).toBe(true);
  });

  it("another tenant's token cannot deliver into the number's owner", async () => {
    const params = stopTo(BYO_NUMBER, "SM_cross");
    const res = await post(params, sign(OTHER_TOKEN, params));
    expect(res.status).toBe(401);
    expect(H.leads.find((l) => l.id === 70)!.doNotContact).toBe(false);
  });

  it("a missing signature is a 401", async () => {
    const res = await post(stopTo(BYO_NUMBER, "SM_nosig"), "");
    expect(res.status).toBe(401);
  });

  it("fails closed when no token at all can verify (no platform token, unknown number)", async () => {
    delete process.env.TWILIO_AUTH_TOKEN;
    const params = stopTo("+19995550000", "SM_none");
    const res = await post(params, sign(PLATFORM_TOKEN, params));
    expect(res.status).toBe(401);
  });
});

describe("inbound SMS to a platform number still works", () => {
  it("a platform-signed STOP to a tracking-pool number opts out that org's lead", async () => {
    const params = stopTo(PLATFORM_NUMBER, "SM_platform_stop");
    const res = await post(params, sign(PLATFORM_TOKEN, params));
    expect(res.status).toBe(200);
    expect(H.leads.find((l) => l.id === 30)!.doNotContact).toBe(true);
    expect(H.leads.find((l) => l.id === 70)!.doNotContact).toBe(false);
  });

  it("a platform-signed STOP to a legacy integration number resolves that org", async () => {
    H.integrations.push({
      organizationId: 4,
      provider: "twilio",
      isEnabled: true,
      credentials: { fromPhoneNumber: "+15055550111" },
    });
    H.leads.push({ id: 40, organizationId: 4, phone: SELLER, doNotContact: false });
    const params = stopTo("+15055550111", "SM_legacy");
    const res = await post(params, sign(PLATFORM_TOKEN, params));
    expect(res.status).toBe(200);
    expect(H.leads.find((l) => l.id === 40)!.doNotContact).toBe(true);
  });
});

describe("unmatched opt-outs are recorded", () => {
  it("an opt-out from a number with no lead is stored so the reply gate can see it", async () => {
    const params = { ...stopTo(BYO_NUMBER, "SM_unmatched"), From: "+13035550000" };
    const res = await post(params, sign(BYO_TOKEN, params));
    expect(res.status).toBe(200);
    expect(H.handleIncoming).toEqual([{ orgId: 7, body: "STOP" }]);
  });
});

describe("owner resolution reads no more of other tenants' credentials than can match", () => {
  // One tenant's inbound text used to decrypt EVERY org's Twilio credential and
  // stamp every org's `lastUsedAt` (13 foreign writes per inbound SMS in the
  // year simulation). The lookup is platform-scope by necessity — the number
  // lives inside the ciphertext — but it must stay minimal.
  const OTHER_LAST4_TOKEN = "byo-token-of-org-11-dddddddddddd";
  const SAME_LAST4_TOKEN = "byo-token-of-org-12-eeeeeeeeeeee";

  beforeEach(async () => {
    H.byokRows[0].credentialKeyFingerprint = BYO_NUMBER.slice(-4);
    // Org 11: a different number whose last four cannot match — never decrypted.
    H.byokRows.push({ organizationId: 11, channel: "twilio", revokedAt: null, credentialKeyFingerprint: "0999" });
    H.vault.set(11, `AC_org11:${OTHER_LAST4_TOKEN}:+15055550999`);
    // Org 12: same last four, different number — decrypted to compare, then dropped.
    H.byokRows.push({ organizationId: 12, channel: "twilio", revokedAt: null, credentialKeyFingerprint: BYO_NUMBER.slice(-4) });
    H.vault.set(12, `AC_org12:${SAME_LAST4_TOKEN}:+15065550100`);
    const { getByokCredential } = await import("../../server/services/byok/key-vault");
    vi.mocked(getByokCredential).mockClear();
  });

  it("decrypts only fingerprint candidates, and never as a USE of the credential", async () => {
    const params = stopTo(BYO_NUMBER, "SM_minimal");
    const res = await post(params, sign(BYO_TOKEN, params));
    expect(res.status).toBe(200);
    const { getByokCredential } = await import("../../server/services/byok/key-vault");
    const calls = vi.mocked(getByokCredential).mock.calls;
    expect(calls.map(([a]) => a.organizationId).sort()).toEqual([12, 7].sort());
    for (const [, opts] of calls) expect(opts).toEqual({ touchLastUsed: false });
  });

  it("a decrypted non-owner's token is dropped: it cannot deliver into its own org either", async () => {
    const params = stopTo(BYO_NUMBER, "SM_same_last4");
    const res = await post(params, sign(SAME_LAST4_TOKEN, params));
    expect(res.status).toBe(401);
    expect(H.handleIncoming).toEqual([]);
    expect(H.leads.every((l) => l.doNotContact === false)).toBe(true);
  });
});
