/**
 * Click-to-call (W3.9) — on the ORG'S OWN Twilio, DNC-gated, consent-gated,
 * logged to the lead timeline. Build-only: Twilio is mocked at the client
 * boundary (global fetch) and every test asserts what reached the network.
 *
 * Drives the REAL gate (clickToCall.ts), the REAL comms router chokepoint, the
 * REAL Twilio adapter and the REAL DNC seam. Mocked: storage/db rows, the BYO
 * vault, Clerk, the owner opt-out list, the contact-frequency ledger.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { stripComments } from "../helpers/stripComments";

const H = vi.hoisted(() => ({
  vault: new Map<number, string>(),
  leads: [] as any[],
  events: [] as any[],
  created: [] as any[],
  suppressed: new Set<string>(),
  freqAllowed: true,
  touches: [] as any[],
  clerkPhones: [] as any[],
  users: [{ clerkUserId: "user_c" }] as any[],
}));

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/services/founderSettings", () => ({ getSetting: async () => null }));

vi.mock("../../server/db", async () => {
  const schema = await import("@shared/schema");
  const chain = (rows: () => any[]) => {
    const c: any = { where: () => c, orderBy: () => c, limit: () => c, then: (ok: any, bad: any) => Promise.resolve(rows()).then(ok, bad) };
    return c;
  };
  const db: any = {
    select: () => ({ from: (t: any) => chain(() => (t === schema.users ? H.users : [])) }),
    insert: () => ({ values: () => ({ returning: async () => [], then: (ok: any) => Promise.resolve().then(ok) }) }),
  };
  return { db };
});
vi.mock("../../server/storage", async () => {
  const { db } = await import("../../server/db");
  const storage = {
    getLead: async (orgId: number, id: number) => H.leads.find((l) => l.organizationId === orgId && l.id === id),
    findLeadsByPhoneLast10: async (orgId: number, phone: string) =>
      H.leads.filter((l) => l.organizationId === orgId && String(l.phone).replace(/\D/g, "").slice(-10) === phone.replace(/\D/g, "").slice(-10)),
    getOrganization: async (id: number) => ({ id, settings: {} }),
    createActivityEvent: async (e: any) => {
      H.created.push(e);
      H.events.push({ ...e, id: H.events.length + 1 });
      return e;
    },
    getActivityEvents: async (orgId: number, entityType: string, entityId: number, types?: string[]) =>
      H.events.filter((e) => e.organizationId === orgId && e.entityType === entityType && e.entityId === entityId && (!types || types.includes(e.eventType))),
  };
  return { storage, db };
});
vi.mock("../../server/services/byok/key-vault", () => ({
  getByokCredential: async ({ organizationId }: { organizationId: number }) => H.vault.get(organizationId) ?? null,
}));
vi.mock("@clerk/express", () => ({
  clerkClient: { users: { getUser: async () => ({ primaryPhoneNumberId: "p1", phoneNumbers: H.clerkPhones }) } },
}));
vi.mock("../../server/services/trust/ownerSuppression", () => {
  const hit = (ids: any) => H.suppressed.has(String(ids?.phone ?? "").replace(/\D/g, "").slice(-10));
  return {
    OWNER_OPTOUT_REASON: "x",
    ownerContactRefusal: async (_c: string, ids: any) => (hit(ids) ? "Not sent: this owner asked AcreOS to stop all contact (voice)." : null),
    assertOwnerContactAllowed: async (_c: string, ids: any) => {
      if (hit(ids)) throw new Error("Not sent: this owner asked AcreOS to stop all contact (voice).");
    },
    stampOwnerSuppression: async (rows: any[]) => ({ rows, suppressedCount: 0 }),
  };
});
vi.mock("../../server/services/compliance/contactFrequency", () => ({
  frequencyGateForLead: async () => (H.freqAllowed ? { allowed: true } : { allowed: false, reason: "cap" }),
  describeFrequencySkip: () => "Contact-frequency cap reached for this lead.",
  recordContactTouch: async (t: any) => {
    H.touches.push(t);
  },
}));

const { evaluateCallGate, placeLeadCall, recordCallStatus } = await import("../../server/services/clickToCall");
const { verifyOrgTwilioCallCallback } = await import("../../server/middleware/twilioSignature");
const { isCsrfExemptPath } = await import("../../server/middleware/csrf");

const ORG = 7;
const ORG_SID = "ACorg7";
const ORG_TOKEN = "org7-token";
const ORG_NUMBER = "+15125550000";
const OPERATOR = "+15125559876";
const fetchSpy = vi.fn(async (_url: any, _init?: any) => new Response(JSON.stringify({ sid: "CA_PARENT" }), { status: 200 }));
const ENV_KEYS = ["DNC_SCRUB_PROVIDER", "APP_URL", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER", "SIMULATION_MODE", "SEARCHBUG_CO_CODE", "SEARCHBUG_API_KEY"];
const saved: Record<string, string | undefined> = {};

function lead(over: Record<string, unknown> = {}) {
  return {
    id: 5, organizationId: ORG, firstName: "Ana", lastName: "Seller", phone: "(512) 555-0111", timezone: "America/Chicago",
    tcpaConsent: true, consentSource: "website", doNotContact: false, optOutDate: null, assignedTo: null, ...over,
  };
}

beforeEach(() => {
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.DNC_SCRUB_PROVIDER = "fixture";
  process.env.APP_URL = "https://app.example.test";
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-06T17:00:00Z")); // 11:00 Chicago, 12:00 New York, 09:00 Los Angeles
  H.vault = new Map([[ORG, `${ORG_SID}:${ORG_TOKEN}:${ORG_NUMBER}`]]);
  H.leads = [lead()];
  H.events = [];
  H.created = [];
  H.suppressed = new Set();
  H.freqAllowed = true;
  H.touches = [];
  H.clerkPhones = [{ id: "p1", phoneNumber: OPERATOR, verification: { status: "verified" } }];
  H.users = [{ clerkUserId: "user_c" }];
  fetchSpy.mockClear();
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const place = () => placeLeadCall({ organizationId: ORG, leadId: 5, userId: "u1" });
const refusedRow = () => H.created.find((e) => e.eventType === "call_not_placed");

describe("refusals: nothing reaches the network, and the attempt is logged with its reason", () => {
  async function expectRefused(code: string, reason: RegExp) {
    const r = await place();
    expect(r).toMatchObject({ placed: false, code });
    expect(r.reason).toMatch(reason);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(refusedRow()?.description).toMatch(reason);
    expect(refusedRow()?.metadata).toMatchObject({ status: "refused", gate: code });
    expect(H.touches).toHaveLength(0);
  }

  it("no BYO identity → refused; the platform account is never used, even fully keyed", async () => {
    Object.assign(process.env, { TWILIO_ACCOUNT_SID: "ACplatform", TWILIO_AUTH_TOKEN: "platform-token", TWILIO_PHONE_NUMBER: "+18005550000" });
    H.vault.clear();
    await expectRefused("no_identity", /own Twilio account/);
    expect((await evaluateCallGate({ organizationId: ORG, leadId: 5, userId: "u1" })).code).toBe("no_identity");
  });

  it.each([
    ["unset", undefined],
    ["'none'", "none"],
    ["an unknown adapter name", "acme-dnc"],
  ])("DNC seam with %s → refused as not configured (the SMS seam would be inert here)", async (_l, v) => {
    if (v === undefined) delete process.env.DNC_SCRUB_PROVIDER;
    else process.env.DNC_SCRUB_PROVIDER = v;
    await expectRefused("dnc_not_configured", /DNC scrubbing is not configured/);
  });

  it("the fixture list is not a scrub outside the test runner", async () => {
    vi.stubEnv("NODE_ENV", "development");
    try {
      await expectRefused("dnc_not_configured", /DNC scrubbing is not configured/);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("a SELECTED vendor without credentials refuses (fail closed) — it never collapses to a pass", async () => {
    process.env.DNC_SCRUB_PROVIDER = "searchbug";
    await expectRefused("dnc_refused", /unverifiable/);
  });

  it("a DNC registry hit refuses even with written consent", async () => {
    H.leads = [lead({ phone: "555-555-0100" })];
    await expectRefused("dnc_refused", /DNC-listed/);
  });

  it("a litigator hit refuses", async () => {
    H.leads = [lead({ phone: "555-555-0199" })];
    await expectRefused("dnc_refused", /litigator/);
  });

  it.each(["verbal", "manual", "imported", null])("consent source %s (not written) → refused", async (source) => {
    H.leads = [lead({ consentSource: source })];
    await expectRefused("no_consent", /not written/);
  });

  it("no TCPA grant at all → refused", async () => {
    H.leads = [lead({ tcpaConsent: false })];
    await expectRefused("no_consent", /no calling consent/);
  });

  it("another lead at the same number without consent blocks the call", async () => {
    H.leads = [lead(), lead({ id: 6, consentSource: "verbal" })];
    await expectRefused("no_consent", /not written/);
  });

  it("opted out (do not contact) → refused", async () => {
    H.leads = [lead({ doNotContact: true })];
    await expectRefused("opted_out", /opted out/);
  });

  it("platform-wide owner opt-out → refused", async () => {
    H.suppressed.add("5125550111");
    await expectRefused("opted_out", /stop all contact/);
  });

  it("quiet hours in the lead's own zone → refused", async () => {
    H.leads = [lead({ timezone: "Asia/Tokyo" })];
    await expectRefused("quiet_hours", /quiet hours/);
  });

  it("no verified operator phone → refused (an unverified number never rings)", async () => {
    H.clerkPhones = [{ id: "p1", phoneNumber: OPERATOR, verification: { status: "unverified" } }];
    await expectRefused("no_operator_phone", /verify your mobile number/);
  });

  it("frequency cap → refused", async () => {
    H.freqAllowed = false;
    await expectRefused("frequency_cap", /cap/);
  });
});

describe("the carrier adapter itself has no platform fallback", () => {
  it("platform Twilio fully keyed, org has no identity → the router refuses and nothing reaches Twilio", async () => {
    Object.assign(process.env, { TWILIO_ACCOUNT_SID: "ACplatform", TWILIO_AUTH_TOKEN: "platform-token", TWILIO_PHONE_NUMBER: "+18005550000" });
    const { commsRouter } = await import("../../server/services/comms/router");
    await import("../../server/services/comms/providers/twilio");
    await expect(
      commsRouter.initiateCall({ to: "+15125550111", voice: { kind: "human" }, organizationId: 8, preferredProvider: "twilio", bridge: { ringFirst: OPERATOR } }),
    ).rejects.toThrow(/no connected \(BYO\) Twilio identity/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("all gates pass", () => {
  it("exactly one Twilio request, on the org's own account, ringing the operator first, caller ID = the org's number", async () => {
    const r = await place();
    expect(r).toMatchObject({ placed: true, code: "ok" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe(`https://api.twilio.com/2010-04-01/Accounts/${ORG_SID}/Calls.json`);
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from(`${ORG_SID}:${ORG_TOKEN}`).toString("base64")}`);
    const body = new URLSearchParams(init.body);
    expect(body.get("To")).toBe(OPERATOR);
    expect(body.get("From")).toBe(ORG_NUMBER);
    expect(body.get("Twiml")).toBe(
      `<Response><Dial callerId="${ORG_NUMBER}"><Number statusCallbackEvent="completed" statusCallback="https://app.example.test/api/webhooks/twilio/call-status/7/5/lead" statusCallbackMethod="POST">+15125550111</Number></Dial></Response>`,
    );
    expect(body.get("StatusCallback")).toBe("https://app.example.test/api/webhooks/twilio/call-status/7/5/operator");
    expect(body.has("Record")).toBe(false);
    expect(body.get("Twiml")).not.toMatch(/record|<Say/i);
    expect(H.created).toHaveLength(1);
    expect(H.created[0]).toMatchObject({ organizationId: ORG, entityType: "lead", entityId: 5, eventType: "call_made" });
    expect(H.created[0].metadata).toMatchObject({ status: "initiated", callSid: "CA_PARENT", callerId: ORG_NUMBER });
    expect(H.touches).toEqual([expect.objectContaining({ channel: "phone", messageId: "CA_PARENT" })]);
  });

  it("the pre-dial verdict says the operator's phone rings first, and spends nothing", async () => {
    const v = await evaluateCallGate({ organizationId: ORG, leadId: 5, userId: "u1" });
    expect(v).toMatchObject({ allowed: true, code: "ok", callerId: ORG_NUMBER, operatorPhoneMasked: "•••9876" });
    expect(v.reason).toMatch(/rings first/);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(H.created).toHaveLength(0);
  });

  it("simulation mode records the call instead of placing it, and the timeline says so", async () => {
    process.env.SIMULATION_MODE = "true";
    const r = await place();
    expect(r).toMatchObject({ placed: false, simulated: true });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(H.created[0]).toMatchObject({ eventType: "call_not_placed" });
    expect(H.created[0].description).toMatch(/simulated/);
  });
});

describe("status callbacks: signed with the org's OWN token, written only to that org", () => {
  function sign(url: string, body: Record<string, string>, token: string) {
    const payload = url + Object.keys(body).sort().reduce((s, k) => s + k + body[k], "");
    return crypto.createHmac("sha1", token).update(Buffer.from(payload, "utf-8")).digest("base64");
  }
  async function run(orgId: string, body: Record<string, string>, token: string) {
    const originalUrl = `/api/webhooks/twilio/call-status/${orgId}/5/lead`;
    const req: any = {
      headers: { host: "app.example.test", "x-forwarded-proto": "https", "x-twilio-signature": sign(`https://app.example.test${originalUrl}`, body, token) },
      protocol: "https", originalUrl, params: { orgId }, body,
    };
    const res: any = { locals: {}, statusCode: 200, status(c: number) { this.statusCode = c; return this; }, json() { return this; }, send() { return this; }, setHeader() {}, set() { return this; } };
    let passed = false;
    await verifyOrgTwilioCallCallback(req, res, () => { passed = true; });
    return { passed, res };
  }
  const body = { AccountSid: ORG_SID, CallSid: "CA_CHILD", ParentCallSid: "CA_PARENT", CallStatus: "completed", CallDuration: "133" };

  it("a correctly signed callback passes and binds the org from the URL", async () => {
    const { passed, res } = await run("7", body, ORG_TOKEN);
    expect(passed).toBe(true);
    expect(res.locals.twilioCallCallback).toEqual({ organizationId: 7 });
  });

  it("a bad signature is rejected", async () => {
    const { passed, res } = await run("7", body, "not-the-token");
    expect(passed).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it("the PLATFORM token never verifies a call callback", async () => {
    process.env.TWILIO_AUTH_TOKEN = "platform-token";
    expect((await run("7", body, "platform-token")).passed).toBe(false);
  });

  it("org A's signed callback cannot be accepted on org B's URL", async () => {
    H.vault.set(8, "ACorg8:org8-token:+15125550001");
    expect((await run("8", body, ORG_TOKEN)).passed).toBe(false);
    // …and with B's token but A's AccountSid it is refused too.
    const r = await run("8", body, "org8-token");
    expect(r.passed).toBe(false);
    expect(r.res.statusCode).toBe(403);
  });

  it("writes the outcome (with duration) only for a call AcreOS started for this org's lead", async () => {
    await place();
    H.created = [];
    expect(await recordCallStatus({ organizationId: 8, leadId: 5, leg: "lead", body })).toEqual({ written: false });
    expect(await recordCallStatus({ organizationId: ORG, leadId: 5, leg: "lead", body: { ...body, ParentCallSid: "CA_OTHER" } })).toEqual({ written: false });
    expect(H.created).toHaveLength(0);
    expect(await recordCallStatus({ organizationId: ORG, leadId: 5, leg: "lead", body })).toEqual({ written: true });
    expect(H.created[0]).toMatchObject({ organizationId: ORG, entityId: 5, eventType: "call_made", description: "Call completed." });
    expect(H.created[0].metadata).toMatchObject({ status: "completed", leg: "lead", callSid: "CA_PARENT", callDuration: 133 });
    // A repeated delivery writes nothing more.
    expect(await recordCallStatus({ organizationId: ORG, leadId: 5, leg: "lead", body })).toEqual({ written: false });
  });

  it("the operator not answering is logged as not placed — the lead was never dialled", async () => {
    await place();
    H.created = [];
    await recordCallStatus({ organizationId: ORG, leadId: 5, leg: "operator", body: { AccountSid: ORG_SID, CallSid: "CA_PARENT", CallStatus: "no-answer" } });
    expect(H.created[0]).toMatchObject({ eventType: "call_not_placed" });
    expect(H.created[0].description).toMatch(/not dialled/);
  });

  it("the callback path is CSRF-exempt (Twilio cannot carry our token), and only that shape", () => {
    expect(isCsrfExemptPath("/webhooks/twilio/call-status/7/5/lead")).toBe(true);
    expect(isCsrfExemptPath("/webhooks/twilio/call-status/7/5/operator")).toBe(true);
    expect(isCsrfExemptPath("/webhooks/twilio/call-status/7/5/other")).toBe(false);
  });
});

describe("structure", () => {
  const ROOT = path.resolve(__dirname, "../..");
  it("the Twilio adapter's initiateCall never resolves platform credentials", () => {
    const file = path.join(ROOT, "server/services/comms/providers/twilio.ts");
    const sf = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    let body = "";
    const v = (n: ts.Node) => {
      if (ts.isMethodDeclaration(n) && n.name.getText(sf) === "initiateCall") body = n.getText(sf);
      ts.forEachChild(n, v);
    };
    v(sf);
    expect(body).toMatch(/getOrgTwilioCredentials\(/); // vacuity
    expect(stripComments(body)).not.toMatch(/resolveCredentials\(|platformCredentials\(|process\.env/);
  });

  it("both routes and the callback are registered", () => {
    const leadsSrc = stripComments(fs.readFileSync(path.join(ROOT, "server/routes-leads.ts"), "utf8"));
    expect(leadsSrc).toMatch(/api\.get\("\/api\/leads\/:id\/call",[^)]*requirePermission\("canEditLeads"\)/);
    expect(leadsSrc).toMatch(/api\.post\("\/api\/leads\/:id\/call",[^)]*requirePermission\("canEditLeads"\)/);
    const misc = stripComments(fs.readFileSync(path.join(ROOT, "server/routes-misc.ts"), "utf8"));
    expect(misc).toMatch(/api\.post\("\/api\/webhooks\/twilio\/call-status\/:orgId\/:leadId\/:leg", verifyOrgTwilioCallCallback,/);
  });

  it("the gate's consent step agrees with the cold-text predicate over every source", async () => {
    const { hasWrittenSmsConsent } = await import("../../server/services/tcpaCompliance");
    const verdicts = new Set<boolean>();
    for (const source of ["website", "written", "sms_double_optin", "phone_ivr", "verbal", "manual", "imported", null]) {
      H.leads = [lead({ consentSource: source })];
      const v = await evaluateCallGate({ organizationId: ORG, leadId: 5, userId: "u1" });
      expect(v.allowed, String(source)).toBe(hasWrittenSmsConsent({ tcpaConsent: true, consentSource: source }));
      verdicts.add(v.allowed);
    }
    expect([...verdicts].sort()).toEqual([false, true]); // not vacuous
  });
});
