/**
 * Wholesale §6.2 — seller follow-up DRAFTS, against a REAL database built from
 * this repository. FALSIFYING: on pre-slice code none of the three
 * /api/wholesale/deals/:dealId/seller-follow-ups routes exist, and the
 * doc-system edit/sign routes accept a row of this type.
 *
 * COMPOSITION
 *   1. the body and subject are the operator's template, character for
 *      character, with ONLY {{owner_name}} {{address}} {{offer_amount}}
 *      {{company_name}} substituted; a token-free template passes through.
 * REFUSALS (each writes nothing)
 *   2. unknown token (named); {{expiration_date}}; {{offer_amount}} with no
 *      deals.offerAmount (the accepted price and the property values are NOT
 *      used instead); unlinked seller; seller opted out by doNotContact; by
 *      optOutDate.
 *   3. consent, positive direction: a seller who has not opted out drafts.
 * CREATE / LIST
 *   4. one generated_documents row, type seller_follow_up_draft, status draft,
 *      content = the merged body, variables carry subject + fact snapshots +
 *      a review seal over what the operator saw; supersedes cites a prior draft
 *      on THIS deal only.
 *   5. list is newest-first, flags a draft stale when a cited fact moves and
 *      names it, and marks the superseded draft.
 *   6. another org's deal is a 404 on all three routes, writing nothing.
 * DOC-SYSTEM GUARDS
 *   7. PUT content / name / signers → 422, row unchanged; PUT status-only is
 *      not refused by the guard; request-signature and send-for-signature →
 *      422; POST /api/signatures → 422, no signature row, status still draft;
 *      an ordinary generated document is still editable (type-scoped).
 * NO SENDS
 *   8. a two-layer net over the email and SMS services — prototype spies on
 *      EmailService/SmsService send methods (including EmailService's private
 *      performSend, which is the only layer the pre-bound `sendEmail` alias
 *      reaches) AND module-export spies on every exported function of both
 *      modules. A control test proves each layer records a deliberate send,
 *      then every route above records ZERO.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import crypto from "crypto";
import express from "express";
import request from "supertest";
import { realDbAvailable, useRealDb } from "../helpers/realDb";

useRealDb("sellerFollowUps.realdb.test.ts");

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

// The doc-system routes sit behind session auth; the org is whichever this
// file is acting as at the moment of the request.
const actor = vi.hoisted(() => ({ org: 0, user: "" }));
vi.mock("../../server/auth", () => ({
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { id: actor.user };
    next();
  },
}));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: any, _res: any, next: any) => {
    req.organization = { id: actor.org };
    req.organizationId = actor.org;
    next();
  },
}));
vi.mock("../../server/middleware/idempotency", () => ({
  idempotencyMiddleware: (_req: any, _res: any, next: any) => next(),
}));

// ── The no-sends net, layer (b): module exports ──────────────────────────────
// Every exported lower-case function of the email and SMS service modules is
// replaced by a recorder. `send*` functions do NOT pass through (a fence that
// forwards a real send is not a fence); the rest pass through so a helper the
// import graph needs still works — but any call to them is still recorded.
// The ORIGINAL exports are kept so the control test can call the pre-bound
// `sendEmail` alias itself and show which layer sees it.
const net = vi.hoisted(() => {
  const moduleSpies: string[] = [];
  const moduleCalls: Array<{ module: string; name: string }> = [];
  const originals: Record<string, Record<string, unknown>> = {};
  const fence = async (module: string, importOriginal: () => Promise<unknown>) => {
    const orig = (await importOriginal()) as Record<string, unknown>;
    originals[module] = orig;
    const wrapped: Record<string, unknown> = { ...orig };
    for (const [k, v] of Object.entries(orig)) {
      if (typeof v !== "function" || /^[A-Z]/.test(k)) continue;
      moduleSpies.push(`${module}::${k}`);
      const blocks = /^send/i.test(k);
      wrapped[k] = (...a: unknown[]) => {
        moduleCalls.push({ module, name: k });
        if (blocks) return Promise.resolve({ success: false, error: "blocked by the sellerFollowUps no-sends fence" });
        return (v as (...x: unknown[]) => unknown)(...a);
      };
    }
    return wrapped;
  };
  return { moduleSpies, moduleCalls, originals, fence };
});
vi.mock("../../server/services/emailService", (io) => net.fence("emailService", io));
vi.mock("../../server/services/smsService", (io) => net.fence("smsService", io));

// ── layer (a): class prototypes, installed in beforeAll ──────────────────────
type ProtoSpy = { name: string; spy: { mock: { calls: unknown[][] }; mockClear: () => void } };
const protoSpies: ProtoSpy[] = [];
const PROTO_SEND = /^send|^performSend$/;

const tag = `sfu${Math.random().toString(36).slice(2, 10)}`;
const USER_ID = `${tag}-user`;
const ORG_NAME = `Acme Land ${tag}`;
let org = 0;
let other = 0;
const ids = {
  seller: 0,
  dncSeller: 0,
  optedOutSeller: 0,
  otherSeller: 0,
  deal: 0,
  dealSecond: 0,
  dealNoOffer: 0,
  dealUnlinked: 0,
  dealDnc: 0,
  dealOptedOut: 0,
  otherDeal: 0,
};
const tpl = { all: 0, plain: 0, unknown: 0, expiry: 0, blind: 0, other: 0, offerOnly: 0 };

// Every token, twice for owner_name (once with inner whitespace), next to
// characters a careless replace would mangle: `$&`, `$1`, braces that are not
// tokens, unicode, and trailing whitespace.
const ALL_SUBJECT = "Re: {{address}} — for {{ owner_name }}";
const ALL_BODY =
  "Hi {{owner_name}},\n\nAbout {{address}}: we can still do {{offer_amount}} cash — {{ owner_name }}, if $& or $1 still works, say so. { not a token }\n\n— {{company_name}} ✓\n  ";
const PLAIN_SUBJECT = "Checking in";
const PLAIN_BODY = "Just checking in on the land. { braces } $& stay exactly as written.\n";

async function q(text: TemplateStringsArray, ...vals: unknown[]) {
  const { db } = await import("../../server/db");
  const { sql } = await import("drizzle-orm");
  const r = await db.execute(sql(text, ...vals));
  return (r as unknown as { rows: Array<Record<string, any>> }).rows;
}

async function wholesaleApp(organizationId: number) {
  const { default: disposition } = await import("../../server/routes-wholesale-disposition");
  const a = express();
  a.use(express.json());
  a.use((req: any, _res, next) => {
    req.organization = { id: organizationId };
    req.organizationId = organizationId;
    req.user = { id: USER_ID };
    next();
  });
  a.use("/api/wholesale", disposition);
  return a;
}
let docApp: express.Express;
async function docSystem(organizationId = org) {
  actor.org = organizationId;
  actor.user = USER_ID;
  return request(docApp);
}

const preview = async (dealId: number, templateId: number, organizationId = org) =>
  request(await wholesaleApp(organizationId)).get(`/api/wholesale/deals/${dealId}/seller-follow-ups/preview?templateId=${templateId}`);
const create = async (dealId: number, body: Record<string, unknown>, organizationId = org) =>
  request(await wholesaleApp(organizationId)).post(`/api/wholesale/deals/${dealId}/seller-follow-ups`).send(body);
const list = async (dealId: number, organizationId = org) =>
  request(await wholesaleApp(organizationId)).get(`/api/wholesale/deals/${dealId}/seller-follow-ups`);

const docCount = async (o = org) => (await q`SELECT count(*)::int AS n FROM generated_documents WHERE organization_id = ${o}`)[0].n as number;
const bothCounts = async () => ({ org: await docCount(org), other: await docCount(other) });
const docRow = async (id: number) => (await q`SELECT * FROM generated_documents WHERE id = ${id}`)[0];
const sigCount = async (documentId: number) => (await q`SELECT count(*)::int AS n FROM signatures WHERE document_id = ${documentId}`)[0].n as number;

function sendsRecorded(): string[] {
  return [
    ...net.moduleCalls.map((c) => `${c.module}::${c.name}`),
    ...protoSpies.filter((s) => s.spy.mock.calls.length > 0).map((s) => `${s.name} ×${s.spy.mock.calls.length}`),
  ];
}
function clearNet() {
  net.moduleCalls.length = 0;
  for (const s of protoSpies) s.spy.mockClear();
}

describe.runIf(realDbAvailable)("seller follow-up drafts (§6.2) — real database", () => {
  vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

  beforeAll(async () => {
    // Load both send modules FIRST so the module-export layer exists before any
    // route runs: a fence over a module that was never loaded is green by construction.
    const emailMod = await import("../../server/services/emailService");
    const smsMod = await import("../../server/services/smsService");
    for (const [cls, label] of [
      [emailMod.EmailService, "EmailService"],
      [smsMod.SmsService, "SmsService"],
    ] as const) {
      const proto = cls.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
      for (const name of Object.getOwnPropertyNames(proto)) {
        if (!PROTO_SEND.test(name) || typeof proto[name] !== "function") continue;
        const spy = vi.spyOn(proto, name).mockImplementation(async () => ({ success: false, error: "blocked by the sellerFollowUps no-sends fence" }));
        protoSpies.push({ name: `${label}.prototype.${name}`, spy });
      }
    }

    const { registerDocSystemRoutes } = await import("../../server/routes-doc-system");
    docApp = express();
    docApp.use(express.json());
    registerDocSystemRoutes(docApp);

    const { db } = await import("../../server/db");
    const { organizations } = await import("@shared/schema");
    const [a] = await db.insert(organizations).values({ name: ORG_NAME, slug: `${tag}-a`, ownerId: `${tag}-oa` } as never).returning();
    const [b] = await db.insert(organizations).values({ name: `${tag}-b`, slug: `${tag}-b`, ownerId: `${tag}-ob` } as never).returning();
    org = a.id;
    other = b.id;

    const lead = async (o: number, first: string, last: string, dnc: boolean, optOut: Date | null) =>
      (await q`INSERT INTO leads (organization_id, type, first_name, last_name, do_not_contact, opt_out_date)
               VALUES (${o}, 'seller', ${first}, ${last}, ${dnc}, ${optOut}) RETURNING id`)[0].id as number;
    ids.seller = await lead(org, "Pat", "Owner", false, null);
    ids.dncSeller = await lead(org, "Dana", "Nocall", true, null);
    ids.optedOutSeller = await lead(org, "Omar", "Optout", false, new Date("2026-10-01T00:00:00Z"));
    ids.otherSeller = await lead(other, "Xavier", "Else", false, null);

    // market_value / after_repair_value / assessed_value are on the record on
    // purpose: none may stand in for a missing offer amount.
    const prop = async (o: number, key: string, sellerId: number | null) =>
      (await q`INSERT INTO properties (organization_id, apn, county, state, size_acres, status, address, city, seller_id, market_value, after_repair_value, assessed_value)
               VALUES (${o}, ${`${tag}-${key}`}, 'Harris', 'TX', '0.2', 'under_contract', ${`9 ${key} St`}, 'Houston', ${sellerId}, '211111', '322222', '133333') RETURNING id`)[0].id as number;
    const deal = async (o: number, p: number, offer: string | null) =>
      (await q`INSERT INTO deals (organization_id, property_id, type, status, offer_amount, accepted_amount)
               VALUES (${o}, ${p}, 'acquisition', 'negotiating', ${offer}, '144444') RETURNING id`)[0].id as number;
    ids.deal = await deal(org, await prop(org, "main", ids.seller), "125000");
    ids.dealSecond = await deal(org, await prop(org, "second", ids.seller), "99000");
    ids.dealNoOffer = await deal(org, await prop(org, "nooffer", ids.seller), null);
    ids.dealUnlinked = await deal(org, await prop(org, "unlinked", null), "125000");
    ids.dealDnc = await deal(org, await prop(org, "dnc", ids.dncSeller), "125000");
    ids.dealOptedOut = await deal(org, await prop(org, "optedout", ids.optedOutSeller), "125000");
    ids.otherDeal = await deal(other, await prop(other, "other", ids.otherSeller), "125000");

    const template = async (o: number, name: string, type: string, subject: string | null, content: string) =>
      (await q`INSERT INTO offer_templates (organization_id, name, type, subject, content)
               VALUES (${o}, ${name}, ${type}, ${subject}, ${content}) RETURNING id`)[0].id as number;
    tpl.all = await template(org, "All four", "follow_up", ALL_SUBJECT, ALL_BODY);
    tpl.plain = await template(org, "Plain", "follow_up", PLAIN_SUBJECT, PLAIN_BODY);
    tpl.unknown = await template(org, "Unknown", "follow_up", "Hello {{owner_name}}", "Call me at {{seller_phone}} about {{address}}.");
    tpl.expiry = await template(org, "Expiry", "follow_up", "Offer", "This offer expires {{expiration_date}}.");
    tpl.offerOnly = await template(org, "Offer only", "follow_up", null, "We can do {{offer_amount}}.");
    tpl.blind = await template(org, "Blind", "blind_offer", "Offer", "We offer {{offer_amount}}.");
    tpl.other = await template(other, "Theirs", "follow_up", "Hi", "Hi {{owner_name}}.");
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    const { pool } = await import("../../server/db");
    for (const o of [org, other].filter(Boolean)) {
      await q`DELETE FROM generated_documents WHERE organization_id = ${o}`;
      await q`DELETE FROM offer_templates WHERE organization_id = ${o}`;
      await q`DELETE FROM deals WHERE organization_id = ${o}`;
      await q`DELETE FROM properties WHERE organization_id = ${o}`;
      await q`DELETE FROM leads WHERE organization_id = ${o}`;
      await q`DELETE FROM organizations WHERE id = ${o}`;
    }
    await pool.end();
  });

  describe("8a. the no-sends net is live (control — runs first)", () => {
    it("every layer exists over the right members, and records a deliberate send", async () => {
      // Per-member vacuity: the names this fence must cover are in the population.
      expect(net.moduleSpies).toEqual(expect.arrayContaining(["emailService::sendEmail", "smsService::sendOrgSMS", "smsService::sendSMSToLead"]));
      expect(protoSpies.map((s) => s.name)).toEqual(
        expect.arrayContaining([
          "EmailService.prototype.sendEmail",
          "EmailService.prototype.performSend",
          "EmailService.prototype.sendTransactionalEmail",
          "EmailService.prototype.sendBulkEmails",
          "SmsService.prototype.sendSMS",
          "SmsService.prototype.sendBulkSMS",
        ]),
      );
      const proto = (n: string) => protoSpies.find((s) => s.name === n)!.spy.mock.calls.length;
      clearNet();

      const emailMod = await import("../../server/services/emailService");
      const smsMod = await import("../../server/services/smsService");
      const msg = { to: "nobody@example.invalid", subject: "fence control", html: "<p>control</p>" };

      // (b) the module export a caller imports is recorded, and goes nowhere.
      await emailMod.sendEmail(msg as never);
      expect(net.moduleCalls).toEqual([{ module: "emailService", name: "sendEmail" }]);
      await smsMod.sendOrgSMS({} as never);
      expect(net.moduleCalls.map((c) => c.name)).toEqual(["sendEmail", "sendOrgSMS"]);

      // (a) a method call on the shared instance is recorded on the prototype.
      await emailMod.emailService.sendEmail(msg as never);
      expect(proto("EmailService.prototype.sendEmail")).toBe(1);
      await smsMod.smsService.sendSMS({ to: "+15555550100", message: "control" } as never);
      expect(proto("SmsService.prototype.sendSMS")).toBe(1);

      // The blind spot of a prototype-only net: the ORIGINAL `sendEmail` export
      // was bound at module load, so it never consults the prototype's
      // sendEmail — that spy stays at 1. It does reach `this.performSend`,
      // which is why performSend is spied too.
      const boundAlias = net.originals.emailService.sendEmail as (o: unknown) => Promise<unknown>;
      await boundAlias(msg);
      expect(proto("EmailService.prototype.sendEmail")).toBe(1);
      expect(proto("EmailService.prototype.performSend")).toBe(1);

      expect(sendsRecorded().length).toBeGreaterThan(0);
      clearNet();
      expect(sendsRecorded()).toEqual([]);
    });
  });

  describe("composition", () => {
    it("1. the template, char for char, with only the four record facts substituted; preview writes nothing", async () => {
      const before = await bothCounts();
      const res = await preview(ids.deal, tpl.all);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.subject).toBe("Re: 9 main St, Houston, TX — for Pat Owner");
      expect(res.body.body).toBe(
        `Hi Pat Owner,\n\nAbout 9 main St, Houston, TX: we can still do $125,000 cash — Pat Owner, if $& or $1 still works, say so. { not a token }\n\n— ${ORG_NAME} ✓\n  `,
      );
      expect(res.body.leadId).toBe(ids.seller);
      expect(res.body.facts.map((f: { token: string }) => f.token)).toEqual(["owner_name", "address", "offer_amount", "company_name"]);
      expect(res.body.facts.find((f: { token: string }) => f.token === "offer_amount").value).toBe("$125,000");
      expect(await bothCounts()).toEqual(before);
    });

    it("1b. a token-free template passes through unchanged", async () => {
      const res = await preview(ids.deal, tpl.plain);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.subject).toBe(PLAIN_SUBJECT);
      expect(res.body.body).toBe(PLAIN_BODY);
      expect(res.body.facts).toEqual([]);
    });

    it("1c. a blind-offer template, another org's template, and an unknown template are 404s", async () => {
      expect((await preview(ids.deal, tpl.blind)).status).toBe(404);
      expect((await preview(ids.deal, tpl.other)).status).toBe(404);
      expect((await preview(ids.deal, 999_999_999)).status).toBe(404);
    });
  });

  describe("refusals — each writes nothing", () => {
    it("2a. an unknown token is refused BY NAME", async () => {
      const before = await bothCounts();
      for (const res of [await preview(ids.deal, tpl.unknown), await create(ids.deal, { offerTemplateId: tpl.unknown })]) {
        expect(res.status).toBe(422);
        expect(res.body.message).toContain("{{seller_phone}}");
      }
      expect(await bothCounts()).toEqual(before);
    });

    it("2b. {{expiration_date}} always refuses — a date is never filled in", async () => {
      const before = await bothCounts();
      for (const res of [await preview(ids.deal, tpl.expiry), await create(ids.deal, { offerTemplateId: tpl.expiry })]) {
        expect(res.status).toBe(422);
        expect(res.body.message).toContain("{{expiration_date}}");
      }
      expect(await bothCounts()).toEqual(before);
    });

    it("2c. {{offer_amount}} with no deals.offerAmount refuses — the accepted price and property values are NOT used", async () => {
      const before = await bothCounts();
      for (const t of [tpl.offerOnly, tpl.all]) {
        for (const res of [await preview(ids.dealNoOffer, t), await create(ids.dealNoOffer, { offerTemplateId: t })]) {
          expect(res.status, JSON.stringify(res.body)).toBe(422);
          expect(res.body.message).toMatch(/no offer amount/);
          const said = JSON.stringify(res.body);
          for (const figure of ["144,444", "144444", "211,111", "211111", "322,222", "322222", "133,333", "133333"]) {
            expect(said).not.toContain(figure);
          }
        }
      }
      expect(await bothCounts()).toEqual(before);
      // The same deal drafts a template that does not cite the amount.
      expect((await preview(ids.dealNoOffer, tpl.plain)).status).toBe(200);
    });

    it("2d. a property with no linked seller refuses", async () => {
      const before = await bothCounts();
      for (const res of [await preview(ids.dealUnlinked, tpl.plain), await create(ids.dealUnlinked, { offerTemplateId: tpl.plain })]) {
        expect(res.status).toBe(422);
        expect(res.body.message).toMatch(/no linked seller/);
      }
      expect(await bothCounts()).toEqual(before);
    });

    it("2e. a seller opted out by doNotContact refuses — even a token-free template", async () => {
      const before = await bothCounts();
      for (const res of [await preview(ids.dealDnc, tpl.plain), await create(ids.dealDnc, { offerTemplateId: tpl.plain })]) {
        expect(res.status).toBe(422);
        expect(res.body.message).toMatch(/opted out/);
      }
      expect(await bothCounts()).toEqual(before);
    });

    it("2f. a seller opted out by optOutDate (doNotContact false) refuses", async () => {
      const before = await bothCounts();
      for (const res of [await preview(ids.dealOptedOut, tpl.plain), await create(ids.dealOptedOut, { offerTemplateId: tpl.plain })]) {
        expect(res.status).toBe(422);
        expect(res.body.message).toMatch(/opted out/);
      }
      expect(await bothCounts()).toEqual(before);
    });

    it("3. consent, positive direction: clearing the opt-out lets the same seller draft", async () => {
      await q`UPDATE leads SET do_not_contact = false WHERE id = ${ids.dncSeller}`;
      try {
        const res = await preview(ids.dealDnc, tpl.all);
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.body.body).toContain("Hi Dana Nocall,");
      } finally {
        await q`UPDATE leads SET do_not_contact = true WHERE id = ${ids.dncSeller}`;
      }
      expect((await preview(ids.dealDnc, tpl.all)).status).toBe(422);
    });
  });

  describe("create + list", () => {
    let first = 0;
    let second = 0;

    it("4. writes exactly one draft row: type, status, content, subject, fact snapshots, and a review seal over what the operator saw", async () => {
      const before = await bothCounts();
      const shown = await preview(ids.deal, tpl.all);
      const res = await create(ids.deal, { offerTemplateId: tpl.all });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(await bothCounts()).toEqual({ org: before.org + 1, other: before.other });
      first = res.body.id;
      expect(res.body.body).toBe(shown.body.body);
      expect(res.body.subject).toBe(shown.body.subject);
      expect(res.body.supersedes).toBeNull();

      const row = await docRow(first);
      expect(row.organization_id).toBe(org);
      expect(row.deal_id).toBe(ids.deal);
      expect(row.lead_id).toBe(ids.seller);
      expect(row.type).toBe("seller_follow_up_draft");
      expect(row.status).toBe("draft");
      expect(row.content).toBe(shown.body.body);
      expect(row.name).toBe(shown.body.subject);
      expect(row.signers ?? null).toBeNull();
      const v = row.variables as Record<string, string>;
      expect(v).toMatchObject({
        kind: "seller_follow_up",
        subject: shown.body.subject,
        offerTemplateId: String(tpl.all),
        citedFacts: "owner_name,address,offer_amount,company_name",
        fact_owner_name: "Pat Owner",
        fact_address: "9 main St, Houston, TX",
        fact_offer_amount: "$125,000",
        fact_company_name: ORG_NAME,
      });
      expect(v.supersedes).toBeUndefined();

      // The seal: sha256 of subject + "\n" + body — exactly what the preview showed.
      const { REVIEW_SEAL_KEY, verifyChainReviewSeal } = await import("../../server/services/contracts/contractAssembly");
      const seen = `${shown.body.subject}\n${shown.body.body}`;
      expect(v[REVIEW_SEAL_KEY]).toBe(crypto.createHash("sha256").update(seen, "utf8").digest("hex"));
      expect(verifyChainReviewSeal(v, seen)).toEqual({ sealed: true, ok: true });
      expect(Object.values(v)).toContain(USER_ID);
    });

    it("4b. supersedes: a correction is a NEW row citing the old one; the old row is untouched", async () => {
      const original = await docRow(first);
      const res = await create(ids.deal, { offerTemplateId: tpl.plain, supersedes: first });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      second = res.body.id;
      expect(second).not.toBe(first);
      expect(res.body.supersedes).toBe(first);
      expect((await docRow(second)).variables.supersedes).toBe(String(first));
      expect(await docRow(first)).toEqual(original);
    });

    it("4c. supersedes refuses another deal's draft, a non-draft document type, another org's draft — writing nothing", async () => {
      const elsewhere = await create(ids.dealSecond, { offerTemplateId: tpl.plain });
      expect(elsewhere.status).toBe(200);
      const [contract] = await q`INSERT INTO generated_documents (organization_id, deal_id, name, type, content, status)
        VALUES (${org}, ${ids.deal}, 'Purchase agreement', 'purchase_agreement', 'terms', 'draft') RETURNING id`;
      const theirs = await create(ids.otherDeal, { offerTemplateId: tpl.other }, other);
      expect(theirs.status, JSON.stringify(theirs.body)).toBe(200);

      const before = await bothCounts();
      for (const supersedes of [elsewhere.body.id, contract.id, theirs.body.id, 999_999_999]) {
        const res = await create(ids.deal, { offerTemplateId: tpl.plain, supersedes });
        expect(res.status, `supersedes=${supersedes}`).toBe(422);
        expect(res.body.message).toMatch(/must be an existing seller follow-up draft on this deal/);
      }
      expect(await bothCounts()).toEqual(before);
    });

    it("5. list: newest first, the superseded draft is marked, and nothing is stale while the record holds", async () => {
      const res = await list(ids.deal);
      expect(res.status).toBe(200);
      const rows = res.body as Array<Record<string, any>>;
      expect(rows.map((r) => r.id)).toEqual([second, first]);
      expect(rows.every((r) => r.status === "draft")).toBe(true);
      const [newer, older] = rows;
      expect(newer).toMatchObject({ supersedes: first, supersededBy: null, stale: false, moved: [] });
      expect(older).toMatchObject({ supersedes: null, supersededBy: second, stale: false, moved: [] });
      expect(older.body).toBe((await docRow(first)).content);
    });

    it("5b. a moved cited fact flags the draft stale and names it; the stored draft is not rewritten", async () => {
      const stored = await docRow(first);
      await q`UPDATE deals SET offer_amount = '130000' WHERE id = ${ids.deal}`;
      try {
        const rows = (await list(ids.deal)).body as Array<Record<string, any>>;
        const older = rows.find((r) => r.id === first)!;
        const newer = rows.find((r) => r.id === second)!;
        expect(older.stale).toBe(true);
        expect(older.moved).toEqual([{ token: "offer_amount", source: "Offer amount on the deal", snapshot: "$125,000", current: "$130,000" }]);
        // The token-free correction cites nothing, so nothing it said moved.
        expect(newer.stale).toBe(false);
        expect(await docRow(first)).toEqual(stored);
      } finally {
        await q`UPDATE deals SET offer_amount = '125000' WHERE id = ${ids.deal}`;
      }
      expect(((await list(ids.deal)).body as Array<{ stale: boolean }>).every((r) => !r.stale)).toBe(true);
    });

    it("6. tenant isolation: another org's deal is a 404 on preview, create and list — in both directions — writing nothing", async () => {
      const before = await bothCounts();
      expect((await preview(ids.deal, tpl.other, other)).status).toBe(404);
      expect((await create(ids.deal, { offerTemplateId: tpl.other }, other)).status).toBe(404);
      expect((await list(ids.deal, other)).status).toBe(404);
      expect((await preview(ids.otherDeal, tpl.all)).status).toBe(404);
      expect((await create(ids.otherDeal, { offerTemplateId: tpl.all })).status).toBe(404);
      expect((await list(ids.otherDeal)).status).toBe(404);
      // My deal, their template.
      expect((await create(ids.deal, { offerTemplateId: tpl.other })).status).toBe(404);
      expect(await bothCounts()).toEqual(before);
    });
  });

  describe("7. doc-system guards", () => {
    let draftId = 0;
    let ordinaryId = 0;

    beforeAll(async () => {
      const res = await create(ids.deal, { offerTemplateId: tpl.all });
      expect(res.status).toBe(200);
      draftId = res.body.id;
      const [ordinary] = await q`INSERT INTO generated_documents (organization_id, deal_id, name, type, content, status)
        VALUES (${org}, ${ids.deal}, 'Ordinary doc', 'purchase_agreement', 'original terms', 'draft') RETURNING id`;
      ordinaryId = ordinary.id;
    });

    it("PUT content, name or signers on a follow-up draft → 422, row unchanged", async () => {
      const before = await docRow(draftId);
      const signers = [{ id: "s1", name: "Pat Owner", email: "pat@example.invalid", role: "seller", status: "pending" }];
      for (const body of [{ content: "rewritten" }, { name: "renamed" }, { signers }, { content: "x", status: "archived" }]) {
        const res = await (await docSystem()).put(`/api/generated-documents/${draftId}`).send(body);
        expect(res.status, JSON.stringify(body)).toBe(422);
        expect(res.body.message).toMatch(/cannot be edited/);
      }
      expect(await docRow(draftId)).toEqual(before);
    });

    it("request-signature and send-for-signature → 422, nothing written", async () => {
      const before = await docRow(draftId);
      const docs = await bothCounts();
      const signers = [{ name: "Pat Owner", email: "pat@example.invalid", role: "seller" }];
      for (const path of ["request-signature", "send-for-signature"]) {
        const res = await (await docSystem()).post(`/api/generated-documents/${draftId}/${path}`).send({ signers });
        expect(res.status, `${path}: ${JSON.stringify(res.body)}`).toBe(422);
        expect(res.body.message).toMatch(/not a signable document/);
      }
      expect(await docRow(draftId)).toEqual(before);
      expect(await bothCounts()).toEqual(docs);
    });

    it("POST /api/signatures on a follow-up draft → 422, no signature row, status still draft", async () => {
      const before = await docRow(draftId);
      expect(before.status).toBe("draft");
      const body = {
        documentId: draftId,
        signerName: "Casey Operator",
        signerEmail: "casey@example.invalid",
        signatureData: "data:image/png;base64,iVBORw0KGgo=",
        signatureType: "drawn",
      };
      const res = await (await docSystem()).post("/api/signatures").send(body);
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(res.body.message).toMatch(/not a signable document/);
      expect(await sigCount(draftId)).toBe(0);
      const after = await docRow(draftId);
      expect(after).toEqual(before);
      expect(after.status).toBe("draft");
      // Type-scoped: the same request against the ordinary document is NOT
      // refused by the type guard — it reaches the self-signature check,
      // which refuses it there (the mocked session carries no email) and
      // still writes nothing.
      const ordinaryBefore = await docRow(ordinaryId);
      const probe = await (await docSystem()).post("/api/signatures").send({ ...body, documentId: ordinaryId });
      expect(probe.status, JSON.stringify(probe.body)).toBe(403);
      expect(await sigCount(ordinaryId)).toBe(0);
      expect(await docRow(ordinaryId)).toEqual(ordinaryBefore);
    });

    it("another org cannot reach the draft through the doc-system at all", async () => {
      const before = await docRow(draftId);
      expect((await (await docSystem(other)).put(`/api/generated-documents/${draftId}`).send({ status: "archived" })).status).toBe(404);
      expect(await docRow(draftId)).toEqual(before);
    });

    it("control: the guard is type-scoped — an ordinary generated document still takes a content edit", async () => {
      const res = await (await docSystem()).put(`/api/generated-documents/${ordinaryId}`).send({ content: "revised terms", name: "Ordinary doc v2" });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const row = await docRow(ordinaryId);
      expect(row.content).toBe("revised terms");
      expect(row.name).toBe("Ordinary doc v2");
    });

    it("PUT status-only is NOT refused by the guard (content stays sealed)", async () => {
      const before = await docRow(draftId);
      const res = await (await docSystem()).put(`/api/generated-documents/${draftId}`).send({ status: "archived" });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const row = await docRow(draftId);
      expect(row.status).toBe("archived");
      expect(row.content).toBe(before.content);
      expect(row.name).toBe(before.name);
      expect(row.variables).toEqual(before.variables);
    });
  });

  describe("8b. no sends", () => {
    it("preview + create + list + the three guarded doc-system routes record ZERO sends", async () => {
      // No clearNet() here: the control emptied the net, so this assertion also
      // covers every route exercised by the tests in between.
      expect(protoSpies.length).toBeGreaterThanOrEqual(6); // vacuity: the prototype layer is installed
      expect(net.moduleSpies.length).toBeGreaterThan(5); // vacuity: the module layer wraps the exports

      expect((await preview(ids.deal, tpl.all)).status).toBe(200);
      const made = await create(ids.deal, { offerTemplateId: tpl.all });
      expect(made.status).toBe(200);
      const corrected = await create(ids.deal, { offerTemplateId: tpl.plain, supersedes: made.body.id });
      expect(corrected.status).toBe(200);
      expect((await list(ids.deal)).status).toBe(200);
      // Refusals send nothing either.
      expect((await create(ids.dealDnc, { offerTemplateId: tpl.plain })).status).toBe(422);
      expect((await create(ids.deal, { offerTemplateId: tpl.expiry })).status).toBe(422);

      const id = corrected.body.id;
      const signers = [{ name: "Pat Owner", email: "pat@example.invalid", role: "seller" }];
      expect((await (await docSystem()).put(`/api/generated-documents/${id}`).send({ content: "edited" })).status).toBe(422);
      expect((await (await docSystem()).post(`/api/generated-documents/${id}/request-signature`).send({ signers })).status).toBe(422);
      expect((await (await docSystem()).post(`/api/generated-documents/${id}/send-for-signature`).send({ signers })).status).toBe(422);

      expect(sendsRecorded()).toEqual([]);
    });

  });
});
