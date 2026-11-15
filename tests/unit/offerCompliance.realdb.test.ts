/**
 * Assignment compliance on OFFER paths, and RECORDED acknowledgements — Leg 3
 * of the wholesale package, against a REAL database built from this repo (its
 * seeded wholesaler_state_rules: IL license_required = block, CA
 * advertising_restricted = warn, TX unrestricted = pass; an unseeded state is
 * blocked by policy). No rule content is written or altered here.
 *
 * FALSIFYING: on pre-leg main the gate module does not exist, the buyer blast
 * sends for an under-contract IL property, and an acknowledged warn on the
 * document path leaves no record anywhere.
 *
 * Both directions on every path exercised here:
 *   A. the gate itself — owned land is out of scope; block refuses; pass
 *      passes; warn refuses without an ack and RECORDS one with it; a preview
 *      shows a warn without recording; an ack that cannot be written refuses.
 *   B. the buyer blast route (preview and send) — block refuses and writes no
 *      blast row; pass proceeds; warn needs a recorded ack.
 *   C. POST /api/generated-documents (assignment template) — an acknowledged
 *      warn is now recorded; an unacknowledged one is still refused.
 *   D. the background channel sync's refusal — no ack possible, so block AND
 *      warn are skipped; owned land and pass states are not.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { realDbAvailable, useRealDb } from "../helpers/realDb";

useRealDb("offerCompliance.realdb.test.ts");

const sent = vi.hoisted(() => ({ emails: [] as Array<{ to: string }>, posts: [] as string[], flyers: 0, matchEmits: [] as number[] }));

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/auth", () => ({ isAuthenticated: (_req: any, _res: any, next: any) => next() }));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({ getOrCreateOrg: (_req: any, _res: any, next: any) => next() }));
vi.mock("../../server/middleware/roleGuard", () => ({ requireRole: () => (_req: any, _res: any, next: any) => next() }));
vi.mock("../../server/middleware/idempotency", () => ({ idempotencyMiddleware: (_req: any, _res: any, next: any) => next() }));
vi.mock("../../server/services/listingSyndication", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  // The outward post itself: recorded, never performed.
  syndicateListing: vi.fn(async (_l: unknown, platforms: string[]) => {
    sent.posts.push(...platforms);
    return platforms.map((platform) => ({ platform, success: true, listingId: "x", listingUrl: "https://example.test/x" }));
  }),
}));
vi.mock("../../server/services/documents", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  generatePropertyFlyer: vi.fn(async () => {
    sent.flyers += 1;
    return Buffer.from("%PDF-flyer");
  }),
}));
vi.mock("../../server/services/credits", () => ({
  usageMeteringService: { calculateCost: vi.fn(async () => 5), recordUsage: vi.fn(async () => undefined) },
  creditService: { hasEnoughCredits: vi.fn(async () => true), getBalance: vi.fn(async () => 1000) },
}));
vi.mock("../../server/services/buyerEvents", () => ({
  // The event that emails a buyer about a fresh match (tpl_buyer_match_found).
  emitBuyerMatchCreated: vi.fn((match: { propertyId: number }) => {
    sent.matchEmits.push(match.propertyId);
  }),
}));
vi.mock("../../server/services/emailService", () => ({
  sendEmail: vi.fn(async (msg: { to: string }) => {
    sent.emails.push(msg);
    return { success: true };
  }),
}));

const tag = `ocg-${Math.random().toString(36).slice(2, 10)}`;
const USER_ID = `${tag}-user`;
let org = 0;
const prop: Record<string, number> = {};

async function q(text: TemplateStringsArray, ...vals: unknown[]) {
  const { db } = await import("../../server/db");
  const { sql } = await import("drizzle-orm");
  const r = await db.execute(sql(text, ...vals));
  return (r as unknown as { rows: Array<Record<string, any>> }).rows;
}
const acks = () => q`SELECT * FROM audit_log WHERE organization_id = ${org} AND action = 'wholesale.compliance_ack' ORDER BY id`;
const blasts = () => q`SELECT * FROM buyer_blasts WHERE organization_id = ${org}`;

async function blastApp() {
  const { registerBuyerBlastRoutes } = await import("../../server/routes-buyer-blasts");
  const a = express();
  a.use(express.json());
  a.use((req: any, _res, next) => {
    req.organization = { id: org };
    req.organizationId = org;
    req.user = { id: USER_ID };
    next();
  });
  registerBuyerBlastRoutes(a);
  return a;
}
const blast = async (propertyId: number, extra: Record<string, unknown> = {}) =>
  request(await blastApp())
    .post(`/api/properties/${propertyId}/blast-buyers`)
    .send({ subject: "New deal", body: "<p>Cash buyers only</p>", minMatchScore: 0, financingType: "any", ...extra });

describe.runIf(realDbAvailable)("assignment compliance on offer paths — real database", () => {
  vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

  beforeAll(async () => {
    const { db } = await import("../../server/db");
    const { organizations } = await import("@shared/schema");
    const [o] = await db.insert(organizations).values({ name: tag, slug: tag, ownerId: `${tag}-o` } as never).returning();
    org = o.id;
    // Vacuity: the rule rows these assertions lean on are the REPO'S seed.
    const seeded = await q`SELECT state, status FROM wholesaler_state_rules WHERE state IN ('IL','CA','TX') ORDER BY state`;
    expect(seeded).toEqual([
      { state: "CA", status: "advertising_restricted" },
      { state: "IL", status: "license_required" },
      { state: "TX", status: "unrestricted" },
    ]);
    expect(await q`SELECT state FROM wholesaler_state_rules WHERE state = 'WY'`).toEqual([]);

    for (const [key, state, status] of [
      ["ilContract", "IL", "under_contract"],
      ["caContract", "CA", "under_contract"],
      ["txContract", "TX", "under_contract"],
      ["wyContract", "WY", "under_contract"],
      ["ilOwned", "IL", "owned"],
    ] as const) {
      const [r] = await q`
        INSERT INTO properties (organization_id, apn, county, state, size_acres, status, address)
        VALUES (${org}, ${`${tag}-${key}`}, 'Test', ${state}, '0.2', ${status}, ${`1 ${key} St`}) RETURNING id`;
      prop[key] = r.id;
    }

    // One matched, opted-in cash buyer PER property (the cadence guardrail
    // would suppress a buyer shared across sends), so a send that passes the
    // gate actually reaches the (mocked) transport.
    for (const [key, id] of Object.entries(prop)) {
      const [lead] = await q`
        INSERT INTO leads (organization_id, first_name, last_name, email, type)
        VALUES (${org}, 'Bea', ${key}, ${`${tag}-${key}@example.test`}, 'buyer') RETURNING id`;
      const [bp] = await q`
        INSERT INTO buyer_profiles (organization_id, lead_id, is_active, financial_info)
        VALUES (${org}, ${lead.id}, true, '{"financingType":"cash"}'::jsonb) RETURNING id`;
      await q`INSERT INTO buyer_property_matches (organization_id, buyer_profile_id, property_id, match_score) VALUES (${org}, ${bp.id}, ${id}, 90)`;
    }
  });

  afterAll(async () => {
    const { pool } = await import("../../server/db");
    if (org) {
      await q`DELETE FROM buyer_blast_recipients WHERE organization_id = ${org}`;
      await q`DELETE FROM buyer_blasts WHERE organization_id = ${org}`;
      await q`DELETE FROM buyer_property_matches WHERE organization_id = ${org}`;
      await q`DELETE FROM buyer_profiles WHERE organization_id = ${org}`;
      await q`DELETE FROM leads WHERE organization_id = ${org}`;
      await q`DELETE FROM properties WHERE organization_id = ${org}`;
      // audit_log is append-only by trigger; the org's synthetic rows stay, as designed.
    }
    await pool.end();
  });

  describe("A. the gate", () => {
    const gate = async (key: string, state: string, status: string, acknowledged: boolean, previewOnly = false, organizationId = org) => {
      const { offerComplianceGate } = await import("../../server/services/wholesale/offerCompliance");
      return offerComplianceGate({ organizationId, userId: USER_ID, property: { id: prop[key], status, state }, surface: "buyer_blast", acknowledged, previewOnly });
    };

    it("owned land is out of scope even in a block state", async () => {
      expect(await gate("ilOwned", "IL", "owned", false)).toEqual({ ok: true, applies: false });
    });

    it("block refuses (license_required, and an unseeded state) — with or without an ack", async () => {
      for (const [k, s] of [["ilContract", "IL"], ["wyContract", "WY"]] as const) {
        for (const ack of [false, true]) {
          const r = await gate(k, s, "under_contract", ack);
          expect(r.ok, `${s} ack=${ack}`).toBe(false);
          expect(r.ok ? null : r.body.error).toBe("wholesaler_compliance_blocked");
        }
      }
    });

    it("pass passes, and records nothing", async () => {
      const before = (await acks()).length;
      expect(await gate("txContract", "TX", "under_contract", false)).toMatchObject({ ok: true, applies: true, warning: null });
      expect((await acks()).length).toBe(before);
    });

    it("warn: refused without an ack; with one, proceeds and the ack is RECORDED", async () => {
      const before = (await acks()).length;
      const refused = await gate("caContract", "CA", "under_contract", false);
      expect(refused).toMatchObject({ ok: false, status: 409, body: { error: "wholesaler_compliance_warn" } });
      expect((await acks()).length).toBe(before);

      const ok = await gate("caContract", "CA", "under_contract", true);
      expect(ok).toMatchObject({ ok: true, applies: true });
      const rows = await acks();
      expect(rows.length).toBe(before + 1);
      const row = rows[rows.length - 1];
      expect(row).toMatchObject({ user_id: USER_ID, entity_type: "property", entity_id: prop.caContract });
      expect(row.metadata).toMatchObject({ surface: "buyer_blast", state: "CA" });
      expect(row.row_hash, "the ack is chained like every audit row").toBeTruthy();
      expect((ok as { ackId: number }).ackId).toBe(row.id);
    });

    it("a preview shows the warn without needing or recording an ack", async () => {
      const before = (await acks()).length;
      const r = await gate("caContract", "CA", "under_contract", false, true);
      expect(r).toMatchObject({ ok: true, applies: true, warning: { error: "wholesaler_compliance_warn" } });
      expect((await acks()).length).toBe(before);
    });

    it("an ack that cannot be written refuses the action", async () => {
      // An org that does not exist: the audit_log FK refuses the insert, so
      // the acknowledgement cannot be recorded and the action must not proceed.
      const r = await gate("caContract", "CA", "under_contract", true, false, 2_000_000_000);
      expect(r).toMatchObject({ ok: false, status: 503, body: { error: "compliance_ack_not_recorded" } });
    });
  });

  describe("B. the buyer blast", () => {
    it("block: preview and send are refused and no blast row exists", async () => {
      for (const extra of [{ dryRun: true }, { dryRun: false }, { dryRun: false, ackComplianceWarning: true }]) {
        const res = await blast(prop.ilContract, extra);
        expect(res.status, JSON.stringify(extra)).toBe(409);
        expect(res.body.error).toBe("wholesaler_compliance_blocked");
      }
      expect(await blasts()).toEqual([]);
      expect(sent.emails).toEqual([]);
    });

    it("pass: an under-contract TX property sends", async () => {
      const res = await blast(prop.txContract);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(sent.emails.length).toBe(1);
    });

    it("owned land in a block state is not an assignment offer — it sends", async () => {
      const res = await blast(prop.ilOwned);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    });

    it("warn: the preview shows it; a send without an ack is refused; with one it is recorded, then sends", async () => {
      const prev = await blast(prop.caContract, { dryRun: true });
      expect(prev.status).toBe(200);
      expect(prev.body.compliance).toMatchObject({ error: "wholesaler_compliance_warn" });

      const before = { acks: (await acks()).length, emails: sent.emails.length };
      const refused = await blast(prop.caContract);
      expect(refused.status).toBe(409);
      expect(refused.body.error).toBe("wholesaler_compliance_warn");
      expect(sent.emails.length).toBe(before.emails);
      expect((await blasts()).filter((b) => b.property_id === prop.caContract)).toEqual([]);

      const ok = await blast(prop.caContract, { ackComplianceWarning: true });
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
      const rows = await acks();
      expect(rows.length).toBe(before.acks + 1);
      expect(rows[rows.length - 1].metadata).toMatchObject({ surface: "buyer_blast", state: "CA" });
      expect(sent.emails.length).toBe(before.emails + 1);
    });
  });

  describe("C. POST /api/generated-documents — an acknowledged warn is now recorded", () => {
    async function docApp() {
      const { registerDocSystemRoutes } = await import("../../server/routes-doc-system");
      const a = express();
      a.use(express.json());
      a.use((req: any, _res, next) => {
        req.organization = { id: org };
        req.organizationId = org;
        req.user = { id: 7 };
        next();
      });
      registerDocSystemRoutes(a);
      return a;
    }
    let templateId = 0;
    beforeAll(async () => {
      const [t] = await q`
        INSERT INTO document_templates (organization_id, name, type, content)
        VALUES (${org}, ${`${tag} assignment`}, 'assignment', 'The Assignor assigns the contract for {{property_address}}.') RETURNING id`;
      templateId = t.id;
    });
    afterAll(async () => {
      await q`DELETE FROM generated_documents WHERE organization_id = ${org}`;
      await q`DELETE FROM document_templates WHERE organization_id = ${org}`;
    });
    const gen = async (state: string, ack?: boolean) =>
      request(await docApp())
        .post("/api/generated-documents")
        .send({ templateId, variables: { state, property_address: "1 Test St" }, ...(ack === undefined ? {} : { ackComplianceWarning: ack }) });
    const docs = () => q`SELECT id FROM generated_documents WHERE organization_id = ${org}`;

    it("block still refuses, ack or not, and records nothing", async () => {
      const before = (await acks()).length;
      for (const ack of [undefined, true]) {
        const res = await gen("IL", ack);
        expect(res.status).toBe(409);
        expect(res.body.error).toBe("wholesaler_compliance_blocked");
      }
      expect(await docs()).toEqual([]);
      expect((await acks()).length).toBe(before);
    });

    it("warn without an ack is refused; with one the ack is recorded BEFORE the document exists", async () => {
      const before = (await acks()).length;
      const refused = await gen("CA");
      expect(refused.status).toBe(409);
      expect(refused.body.error).toBe("wholesaler_compliance_warn");
      expect(await docs()).toEqual([]);

      const ok = await gen("CA", true);
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
      const rows = await acks();
      expect(rows.length).toBe(before + 1);
      expect(rows[rows.length - 1]).toMatchObject({ entity_type: "document_template", entity_id: templateId, user_id: "7" });
      expect(rows[rows.length - 1].metadata).toMatchObject({ surface: "generated_document", state: "CA" });
      expect((await docs()).length).toBe(1);
    });

    it("pass generates and records nothing", async () => {
      const before = (await acks()).length;
      const res = await gen("TX");
      expect(res.status).toBe(201);
      expect((await acks()).length).toBe(before);
    });
  });

  describe("E. the property flyer (marketing PDF)", () => {
    async function flyerApp() {
      const { registerDocumentRoutes } = await import("../../server/routes-documents");
      const a = express();
      a.use(express.json());
      a.use((req: any, _res, next) => {
        req.organization = { id: org };
        req.organizationId = org;
        req.user = { id: USER_ID };
        next();
      });
      registerDocumentRoutes(a);
      return a;
    }
    const flyer = async (propertyId: number, ack?: boolean) =>
      request(await flyerApp())
        .post("/api/documents/generate/property-flyer")
        .send({ propertyId, ...(ack === undefined ? {} : { ackComplianceWarning: ack }) });

    it("block refuses and generates nothing; owned land and a pass state generate", async () => {
      const before = sent.flyers;
      const blocked = await flyer(prop.ilContract, true);
      expect(blocked.status).toBe(409);
      expect(blocked.body.error).toBe("wholesaler_compliance_blocked");
      expect(sent.flyers).toBe(before);
      expect((await flyer(prop.ilOwned)).status).toBe(200);
      expect((await flyer(prop.txContract)).status).toBe(200);
      expect(sent.flyers).toBe(before + 2);
    });

    it("warn needs a recorded ack", async () => {
      const before = { flyers: sent.flyers, acks: (await acks()).length };
      expect((await flyer(prop.caContract)).status).toBe(409);
      expect(sent.flyers).toBe(before.flyers);
      expect((await flyer(prop.caContract, true)).status).toBe(200);
      const rows = await acks();
      expect(rows.length).toBe(before.acks + 1);
      expect(rows[rows.length - 1].metadata).toMatchObject({ surface: "property_flyer", state: "CA" });
    });
  });

  describe("F. listing syndicate and G. listing publish", () => {
    const listing: Record<string, number> = {};
    beforeAll(async () => {
      for (const key of ["ilContract", "caContract", "txContract"]) {
        const [l] = await q`
          INSERT INTO property_listings (organization_id, property_id, title, asking_price, status)
          VALUES (${org}, ${prop[key]}, ${`${tag} ${key}`}, '150000', 'active') RETURNING id`;
        listing[key] = l.id;
      }
    });
    afterAll(async () => {
      await q`DELETE FROM property_listings WHERE organization_id = ${org}`;
    });
    async function listingApp() {
      const { registerEliteFeatureRoutes } = await import("../../server/routes-elite-features");
      const { registerTeamMessagingRoutes } = await import("../../server/routes-team-messaging");
      const a = express();
      a.use(express.json());
      a.use((req: any, _res, next) => {
        req.organization = { id: org, subscriptionTier: "scale" };
        req.organizationId = org;
        req.user = { id: USER_ID };
        next();
      });
      await registerEliteFeatureRoutes(a);
      registerTeamMessagingRoutes(a);
      return a;
    }
    const syndicate = async (key: string, ack?: boolean) =>
      request(await listingApp())
        .post(`/api/listings/${listing[key]}/syndicate`)
        .send({ platforms: ["landwatch"], ...(ack === undefined ? {} : { ackComplianceWarning: ack }) });
    const publish = async (key: string, extra: Record<string, unknown> = {}) =>
      request(await listingApp())
        .post(`/api/listings/${listing[key]}/publish`)
        .send({ platforms: ["landwatch"], ...extra });

    it("F0. listing create: block refuses and creates nothing; owned land and a pass state create; warn needs a recorded ack", async () => {
      const app = await listingApp();
      const create = (key: string, ack?: boolean) =>
        request(app)
          .post("/api/listings")
          .send({ propertyId: prop[key], title: `${tag} new ${key}`, askingPrice: "150000", status: "draft", ...(ack === undefined ? {} : { ackComplianceWarning: ack }) });
      // The fixtures above already hold listings for the contract properties;
      // free them so "one listing per property" cannot mask the gate.
      await q`DELETE FROM property_listings WHERE organization_id = ${org}`;
      const listings = () => q`SELECT property_id FROM property_listings WHERE organization_id = ${org}`;

      const blocked = await create("ilContract", true);
      expect(blocked.status).toBe(409);
      expect(blocked.body.error).toBe("wholesaler_compliance_blocked");
      expect(await listings()).toEqual([]);

      expect((await create("ilOwned")).status).toBe(201);
      expect((await create("txContract")).status).toBe(201);

      const ackBefore = (await acks()).length;
      const refused = await create("caContract");
      expect(refused.status).toBe(409);
      expect(refused.body.error).toBe("wholesaler_compliance_warn");
      const ok = await create("caContract", true);
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
      const rows = await acks();
      expect(rows.length).toBe(ackBefore + 1);
      expect(rows[rows.length - 1].metadata).toMatchObject({ surface: "listing_create", state: "CA" });

      // Restore the active listings the next two tests drive.
      await q`DELETE FROM property_listings WHERE organization_id = ${org}`;
      for (const key of ["ilContract", "caContract", "txContract"]) {
        const [l] = await q`
          INSERT INTO property_listings (organization_id, property_id, title, asking_price, status)
          VALUES (${org}, ${prop[key]}, ${`${tag} ${key}`}, '150000', 'active') RETURNING id`;
        listing[key] = l.id;
      }
    });

    it("F. syndicate: block refuses and posts nothing; pass posts; warn needs a recorded ack", async () => {
      const before = sent.posts.length;
      const blocked = await syndicate("ilContract", true);
      expect(blocked.status).toBe(409);
      expect(blocked.body.error).toBe("wholesaler_compliance_blocked");
      expect(sent.posts.length).toBe(before);

      const passed = await syndicate("txContract");
      expect(passed.status, JSON.stringify(passed.body)).toBe(200);
      expect(sent.posts.length).toBe(before + 1);

      const ackBefore = (await acks()).length;
      expect((await syndicate("caContract")).status).toBe(409);
      expect(sent.posts.length).toBe(before + 1);
      const ok = await syndicate("caContract", true);
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      const rows = await acks();
      expect(rows.length).toBe(ackBefore + 1);
      expect(rows[rows.length - 1].metadata).toMatchObject({ surface: "listing_syndicate", state: "CA" });
    });

    it("G. publish: block refuses even a dry run; a warn dry run shows nothing to ack; a real warn publish needs a recorded ack", async () => {
      const blockedDry = await publish("ilContract", { dryRun: true });
      expect(blockedDry.status).toBe(409);
      expect(blockedDry.body.error).toBe("wholesaler_compliance_blocked");
      expect((await publish("ilContract", { ackComplianceWarning: true })).status).toBe(409);

      const ackBefore = (await acks()).length;
      const warnDry = await publish("caContract", { dryRun: true });
      expect(warnDry.status, JSON.stringify(warnDry.body)).not.toBe(409);
      expect((await acks()).length).toBe(ackBefore);

      const warnNoAck = await publish("caContract");
      expect(warnNoAck.status).toBe(409);
      expect(warnNoAck.body.error).toBe("wholesaler_compliance_warn");
      const warnAck = await publish("caContract", { ackComplianceWarning: true });
      expect(warnAck.status, JSON.stringify(warnAck.body)).not.toBe(409);
      const rows = await acks();
      expect(rows.length).toBe(ackBefore + 1);
      expect(rows[rows.length - 1].metadata).toMatchObject({ surface: "listing_publish", state: "CA" });

      const pass = await publish("txContract", { dryRun: true });
      expect(pass.status, JSON.stringify(pass.body)).not.toBe(409);
    });
  });

  describe("H. a fresh buyer match (its event emails the buyer)", () => {
    it("is announced for owned land and a pass state, never for an under-contract property in a block or warn state", async () => {
      const { buyerMatchingAIService } = await import("../../server/services/buyerMatchingAI");
      // Scoring is not under test: every buyer scores a match.
      const spy = vi
        .spyOn(buyerMatchingAIService, "calculateMatchScore")
        .mockReturnValue({ score: 90, factors: {} as never, reasons: [], concerns: [] });
      const [lead] = await q`INSERT INTO leads (organization_id, first_name, last_name, email, type) VALUES (${org}, 'New', 'Buyer', ${`${tag}-new@example.test`}, 'buyer') RETURNING id`;
      await q`INSERT INTO buyer_profiles (organization_id, lead_id, is_active, financial_info) VALUES (${org}, ${lead.id}, true, '{"financingType":"cash"}'::jsonb)`;
      sent.matchEmits.length = 0;
      for (const key of ["ilContract", "caContract", "wyContract", "txContract", "ilOwned"]) {
        await buyerMatchingAIService.matchPropertyToBuyers(org, prop[key]);
      }
      spy.mockRestore();
      // The new buyer's match row is written for every property (internal)...
      const rows = await q`SELECT property_id FROM buyer_property_matches WHERE organization_id = ${org} AND buyer_profile_id IN (SELECT id FROM buyer_profiles WHERE lead_id = ${lead.id})`;
      expect(rows.length).toBe(5);
      // ...but only the offerable-without-ack properties are ever announced
      // (once per buyer newly matched to them).
      expect(sent.matchEmits.length).toBeGreaterThan(0);
      expect([...new Set(sent.matchEmits)].sort()).toEqual([prop.txContract, prop.ilOwned].sort());
    });
  });

  describe("D. the background channel sync", () => {
    it("skips an under-contract property in a block or warn state; never owned land or a pass state", async () => {
      const { unattendedOfferRefusal } = await import("../../server/services/wholesale/offerCompliance");
      expect(await unattendedOfferRefusal({ status: "under_contract", state: "IL" })).toMatch(/blocked/);
      expect(await unattendedOfferRefusal({ status: "under_contract", state: "WY" })).toMatch(/blocked/);
      expect(await unattendedOfferRefusal({ status: "under_contract", state: "CA" })).toMatch(/acknowledgement/);
      expect(await unattendedOfferRefusal({ status: "under_contract", state: "TX" })).toBeNull();
      expect(await unattendedOfferRefusal({ status: "owned", state: "IL" })).toBeNull();
    });
  });
});
