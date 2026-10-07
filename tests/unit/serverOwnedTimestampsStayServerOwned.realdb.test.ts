/**
 * A JSON edit cannot write a server-owned timestamp — and can still write a
 * date an operator enters.
 *
 * Insert-schema dates accept ISO strings only for user-entered columns
 * (shared/db/createInsertSchema.ts); server stamps such as deletedAt stay
 * server-owned, and the lead / property / deal update schemas omit
 * deletedAt/deletedBy outright, so a soft delete goes through the delete
 * route and its checks.
 *
 * Real Postgres, real registered PUT handlers. Both directions:
 *   - deletedAt in the body does NOT soft-delete (refused, or dropped);
 *   - deals.closingDate and leads.nextFollowUpAt as ISO strings ARE stored.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { useRealDb, realDbAvailable } from "../helpers/realDb";

useRealDb("serverOwnedTimestampsStayServerOwned.realdb.test.ts");

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const tag = `sot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ids = { org: 0, lead: 0, property: 0, deal: 0 };
const ISO = "2026-12-15T17:00:00.000Z";

type Handler = (req: unknown, res: unknown) => Promise<unknown>;
async function puts(): Promise<Record<string, Handler>> {
  const out: Record<string, Handler> = {};
  const app: Record<string, unknown> = {};
  for (const m of ["get", "post", "patch", "put", "delete", "use"]) {
    app[m] = (path: string, ...args: unknown[]) => {
      if (typeof path === "string") out[`${m.toUpperCase()} ${path}`] = args[args.length - 1] as Handler;
    };
  }
  (await import("../../server/routes-leads")).registerLeadRoutes(app as never);
  (await import("../../server/routes-deals")).registerDealRoutes(app as never);
  (await import("../../server/routes-properties")).registerPropertyRoutes(app as never);
  return out;
}
function res() {
  const r: any = { statusCode: 200, body: undefined };
  r.status = (c: number) => ((r.statusCode = c), r);
  r.json = (b: unknown) => ((r.body = b), r);
  r.send = (b: unknown) => ((r.body = b), r);
  return r;
}
const req = (id: number, body: Record<string, unknown>) => ({
  params: { id: String(id) },
  body,
  organization: { id: ids.org, settings: {} },
  user: { id: `${tag}-owner` },
  headers: {},
  ip: "127.0.0.1",
  socket: {},
});

async function row(table: "leads" | "properties" | "deals", id: number) {
  const { db } = await import("../../server/db");
  const { sql } = await import("drizzle-orm");
  const r = await db.execute(sql`SELECT * FROM ${sql.identifier(table)} WHERE id = ${id}`);
  return (r as any).rows[0];
}

describe.runIf(realDbAvailable)("server-owned timestamps (real database, real routes)", () => {
  vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

  beforeAll(async () => {
    // audit_log is hash-chained and refuses DELETE, so a fixture org that
    // wrote audit rows could never be cleaned up. The audit write is not what
    // this test is about; it is stubbed (the routes await it and move on).
    const { storage } = await import("../../server/storage");
    vi.spyOn(storage, "createAuditLogEntry").mockResolvedValue(undefined as never);
    const { db } = await import("../../server/db");
    const { organizations, leads, properties, deals } = await import("@shared/schema");
    const [org] = await db.insert(organizations).values({ name: tag, slug: tag, ownerId: `${tag}-owner` } as any).returning();
    ids.org = org.id;
    ids.lead = (await db.insert(leads).values({ organizationId: org.id, firstName: "S", lastName: "O" } as any).returning())[0].id;
    ids.property = (
      await db.insert(properties).values({ organizationId: org.id, apn: `${tag}-apn`, county: "Llano", state: "TX", sizeAcres: "5" } as any).returning()
    )[0].id;
    ids.deal = (await db.insert(deals).values({ organizationId: org.id, propertyId: ids.property, type: "acquisition" } as any).returning())[0].id;
  });

  afterAll(async () => {
    if (!ids.org) return;
    const { db } = await import("../../server/db");
    const { eq } = await import("drizzle-orm");
    const { activityLog, deals, properties, leads, organizations: orgs } = await import("@shared/schema");
    const org = ids.org;
    // Typed deletes, so the cleanup's tables and columns are checked by tsc.
    await db.delete(activityLog).where(eq(activityLog.organizationId, org)).catch(() => undefined);
    await db.delete(deals).where(eq(deals.organizationId, org)).catch(() => undefined);
    await db.delete(properties).where(eq(properties.organizationId, org)).catch(() => undefined);
    await db.delete(leads).where(eq(leads.organizationId, org)).catch(() => undefined);
    await db.delete(orgs).where(eq(orgs.id, org));
  });

  it("PUT with deletedAt does not soft-delete a lead, a property or a deal", async () => {
    const h = await puts();
    for (const [route, table, id] of [
      ["PUT /api/leads/:id", "leads", ids.lead],
      ["PUT /api/properties/:id", "properties", ids.property],
      ["PUT /api/deals/:id", "deals", ids.deal],
    ] as const) {
      expect(h[route], `${route} is not registered`).toBeDefined();
      const r = res();
      await h[route](req(id, { deletedAt: ISO, deletedBy: "someone" }), r);
      const after = await row(table, id);
      expect(after.deleted_at, `${route} soft-deleted the row (status ${r.statusCode})`).toBeNull();
      expect(after.deleted_by).toBeNull();
    }
  });

  it("an operator-entered date still accepts an ISO string through the same routes", async () => {
    const h = await puts();
    const d = res();
    await h["PUT /api/deals/:id"](req(ids.deal, { closingDate: ISO }), d);
    expect(d.statusCode, JSON.stringify(d.body)).toBe(200);
    expect(new Date((await row("deals", ids.deal)).closing_date).toISOString()).toBe(ISO);

    const l = res();
    await h["PUT /api/leads/:id"](req(ids.lead, { nextFollowUpAt: ISO }), l);
    expect(l.statusCode, JSON.stringify(l.body)).toBe(200);
    expect(new Date((await row("leads", ids.lead)).next_follow_up_at).toISOString()).toBe(ISO);
  });
});
