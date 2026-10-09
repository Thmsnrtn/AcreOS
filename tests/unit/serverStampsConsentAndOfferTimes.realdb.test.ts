/**
 * Consent and offer timestamps are the server's, and ISO dates get through.
 *
 * Real Postgres, real route handlers / repository. Three defects:
 *   1. POST /api/offers rejected an ISO `expiresAt` (insert schemas were
 *      `z.date()`, and a JSON body has no Date) — shared/db/createInsertSchema.ts.
 *   2. An offer PATCHed to "sent" / a response status kept whatever `sentAt` /
 *      `respondedAt` the client sent (or none) — server/services/offerTimestamps.ts.
 *   3. A lead written with `tcpaConsent: true` kept the client's `consentDate`
 *      (backdated consent was one request away) — server/services/consentStamp.ts.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { useRealDb, realDbAvailable } from "../helpers/realDb";

useRealDb("serverStampsConsentAndOfferTimes.realdb.test.ts");

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const tag = `ssc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ids = { org: 0 };
const OLD = "2019-01-01T00:00:00.000Z";
const recent = (d: unknown) => {
  const t = new Date(d as string).getTime();
  return Number.isFinite(t) && Math.abs(Date.now() - t) < 5 * 60_000;
};

type Handler = (req: unknown, res: unknown) => Promise<unknown>;
async function vaHandlers(): Promise<Record<string, Handler>> {
  const { registerVAEngineRoutes } = await import("../../server/routes-va-engine");
  const out: Record<string, Handler> = {};
  const app: Record<string, unknown> = {};
  for (const m of ["get", "post", "patch", "put", "delete", "use"]) {
    app[m] = (path: string, ...args: unknown[]) => {
      if (typeof path === "string") out[`${m.toUpperCase()} ${path}`] = args[args.length - 1] as Handler;
    };
  }
  await registerVAEngineRoutes(app as never);
  return out;
}
function res() {
  const r: any = { statusCode: 200, body: undefined };
  r.status = (c: number) => ((r.statusCode = c), r);
  r.json = (b: unknown) => ((r.body = b), r);
  return r;
}

describe.runIf(realDbAvailable)("server-stamped timestamps (real database)", () => {
  vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

  beforeAll(async () => {
    const { db } = await import("../../server/db");
    const { organizations } = await import("@shared/schema");
    const [org] = await db.insert(organizations).values({ name: tag, slug: tag, ownerId: `${tag}-o` } as any).returning();
    ids.org = org.id;
  });
  afterAll(async () => {
    if (!ids.org) return;
    const { db } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`DELETE FROM offers WHERE organization_id = ${ids.org}`);
    await db.execute(sql`DELETE FROM activity_log WHERE organization_id = ${ids.org}`);
    await db.execute(sql`DELETE FROM leads WHERE organization_id = ${ids.org}`);
    await db.execute(sql`DELETE FROM organizations WHERE id = ${ids.org}`);
  });

  it("an offer created with an ISO expiry is accepted, and its lifecycle times are the server's", async () => {
    const h = await vaHandlers();
    const org = { id: ids.org, settings: {} };

    // sentAt is server-owned: a client string for it is refused outright
    // (shared/db/createInsertSchema.ts widens only user-entered dates).
    const refused = res();
    await h["POST /api/offers"]({ organization: org, user: { id: "u" }, body: { status: "draft", cashOffer: "10000", sentAt: OLD } }, refused);
    expect(refused.statusCode).toBe(400);

    const created = res();
    await h["POST /api/offers"]({ organization: org, user: { id: "u" }, body: { status: "draft", cashOffer: "10000", expiresAt: "2026-12-31T00:00:00.000Z" } }, created);
    expect(created.statusCode, JSON.stringify(created.body)).toBe(201);
    expect(new Date(created.body.expiresAt).toISOString()).toBe("2026-12-31T00:00:00.000Z");
    expect(created.body.sentAt).toBeNull();
    const id = created.body.id;

    const sent = res();
    await h["PATCH /api/offers/:id"]({ organization: org, user: { id: "u" }, params: { id: String(id) }, body: { status: "sent", sentAt: OLD } }, sent);
    expect(sent.statusCode).toBe(200);
    expect(recent(sent.body.sentAt), `sentAt=${sent.body.sentAt}`).toBe(true);
    const firstSent = new Date(sent.body.sentAt).getTime();

    const countered = res();
    await h["PATCH /api/offers/:id"]({ organization: org, user: { id: "u" }, params: { id: String(id) }, body: { status: "countered", respondedAt: OLD } }, countered);
    expect(recent(countered.body.respondedAt), `respondedAt=${countered.body.respondedAt}`).toBe(true);
    const firstResponse = new Date(countered.body.respondedAt).getTime();

    await new Promise((r) => setTimeout(r, 20));
    const accepted = res();
    await h["PATCH /api/offers/:id"]({ organization: org, user: { id: "u" }, params: { id: String(id) }, body: { status: "accepted", respondedAt: "2030-01-01T00:00:00.000Z", sentAt: OLD } }, accepted);
    // The first response and the original send are kept.
    expect(new Date(accepted.body.respondedAt).getTime()).toBe(firstResponse);
    expect(new Date(accepted.body.sentAt).getTime()).toBe(firstSent);
  });

  it("a lead's consent date is the server's clock, never the client's", async () => {
    const { storage } = await import("../../server/storage");
    const base = { organizationId: ids.org, firstName: "C", lastName: "T" };

    const granted = await storage.createLead({ ...base, tcpaConsent: true, consentDate: new Date(OLD), consentSource: "invented_source" } as any);
    expect(recent(granted.consentDate)).toBe(true);
    expect(granted.consentSource).toBe("admin_manual"); // not in the vocabulary → the server's label

    const notGranted = await storage.createLead({ ...base, tcpaConsent: false, consentDate: new Date(OLD), consentSource: "website" } as any);
    expect(notGranted.consentDate).toBeNull();
    expect(notGranted.consentSource).toBeNull();

    const later = await storage.updateLead(notGranted.id, { tcpaConsent: true, consentDate: new Date(OLD), consentSource: "written" } as any, ids.org);
    expect(recent(later.consentDate)).toBe(true);
    expect(later.consentSource).toBe("written");
    const firstGrant = new Date(later.consentDate!).getTime();

    // Re-asserting consent is an edit, not a new grant: date and source stay.
    const again = await storage.updateLead(notGranted.id, { tcpaConsent: true, consentDate: new Date("2030-01-01T00:00:00Z"), consentSource: "website" } as any, ids.org);
    expect(new Date(again.consentDate!).getTime()).toBe(firstGrant);
    expect(again.consentSource).toBe("written");

    // A client cannot write a consent date onto a lead that is not consenting.
    const sneaky = await storage.updateLead(granted.id, { consentDate: new Date(OLD) } as any, ids.org);
    expect(new Date(sneaky.consentDate!).getTime()).toBe(new Date(granted.consentDate!).getTime());

    const batch = await storage.createLeadsBatch([{ ...base, tcpaConsent: true, consentDate: new Date(OLD) } as any]);
    expect(recent(batch[0].consentDate)).toBe(true);
    expect(batch[0].consentSource).toBe("imported");
  });
});
