/**
 * Parent-parcel references and subdivider dashboard aggregates are scoped to
 * the caller's organization. Against a REAL database built from this
 * repository, over HTTP through the real handlers. SYNTHETIC data.
 *
 * 1. Every property writer that accepts a payload resolves a supplied
 *    `parentParcelId` inside the writer's organization, or refuses the write
 *    with one response whatever the id is (POST /api/properties,
 *    PUT /api/properties/:id, POST /api/properties/bulk-update, and the
 *    repository the workflow `update_record` action writes through).
 * 2. GET /api/subdivider/dashboard counts only the organization's own child
 *    rows in every aggregate, whatever rows elsewhere reference its parcels.
 *
 * The population of property writers is enumerated by
 * tests/unit/propertyWritersPopulation.test.ts.
 */
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { realDbAvailable, useRealDb } from "../helpers/realDb";

useRealDb("parentParcelOrganizationScope.realdb.test.ts");

const h = vi.hoisted(() => ({ org: { id: 0 } as { id: number }, user: { id: "ppos-user", claims: { sub: "ppos-user" } } }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/auth", () => ({ isAuthenticated: (req: any, _res: any, next: any) => { req.user = h.user; next(); } }));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({ getOrCreateOrg: (req: any, _res: any, next: any) => { req.organization = h.org; req.organizationId = h.org.id; next(); } }));
vi.mock("../../server/utils/permissions", () => ({ requirePermission: () => (_req: any, _res: any, next: any) => next() }));
vi.mock("../../server/services/usageLimits", () => ({ checkUsageLimit: async () => ({ allowed: true, current: 0, limit: null }) }));
vi.mock("../../server/services/propertyEvents", () => ({ emitPropertyCreated: vi.fn(), emitPropertyStatusChanged: vi.fn() }));
vi.mock("../../server/services/data-cache/observation-log", () => ({ recordParcelObservations: vi.fn(async () => undefined) }));
vi.mock("../../server/services/activation", () => ({ recordActivationEventAsync: vi.fn() }));

const tag = `ppos${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const county = `Synth${tag}`;
const orgs = { a: 0, b: 0 };
const ids: Record<string, number> = {};
let app: express.Express;

describe.runIf(realDbAvailable)("parent-parcel references and dashboard aggregates stay inside the organization — real database", () => {
  beforeAll(async () => {
    const { db } = await import("../../server/db");
    const { organizations, properties } = await import("@shared/schema");
    for (const k of ["a", "b"] as const) {
      const [org] = await db.insert(organizations).values({ name: `${tag}${k}`, slug: `${tag}${k}`, ownerId: `${tag}${k}` } as never).returning();
      orgs[k] = org.id;
    }
    const prop = (orgId: number, apn: string, extra: Record<string, unknown> = {}) =>
      ({ organizationId: orgId, apn: `${tag}-${apn}`, county, state: "OH", sizeAcres: "10", status: "owned", ...extra }) as never;
    const ins = async (key: string, orgId: number, extra: Record<string, unknown> = {}) => {
      const [r] = await db.insert(properties).values(prop(orgId, key, extra)).returning({ id: properties.id });
      ids[key] = r.id;
    };
    // Organization A: a subdivided parent with one sold lot of its own, and a
    // second parcel with no lots at all.
    await ins("aParent", orgs.a, { purchasePrice: "10000" });
    await ins("aLot", orgs.a, { parentParcelId: ids.aParent, status: "sold", soldPrice: "4000" });
    await ins("aPlain", orgs.a, { purchasePrice: "5000" });
    // Organization B: its own parcels, a parent of its own, and two rows
    // written straight to the table (no writer) that name A's parcels.
    await ins("bParent", orgs.b);
    await ins("bOther", orgs.b);
    await ins("bStrayOnParent", orgs.b, { parentParcelId: ids.aParent, status: "sold", soldPrice: "90000" });
    await ins("bStrayOnPlain", orgs.b, { parentParcelId: ids.aPlain, status: "sold", soldPrice: "70000" });

    const { registerPropertyRoutes } = await import("../../server/routes-properties");
    const { registerSubdivisionRoutes } = await import("../../server/routes-subdivisions");
    app = express();
    app.use(express.json());
    registerPropertyRoutes(app);
    registerSubdivisionRoutes(app);
  });

  afterAll(async () => {
    const { db, pool } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    for (const orgId of [orgs.b, orgs.a]) {
      await db.execute(sql`UPDATE properties SET parent_parcel_id = NULL WHERE organization_id = ${orgId}`).catch(() => undefined);
    }
    for (const orgId of [orgs.b, orgs.a]) {
      await db.execute(sql`DELETE FROM audit_log WHERE organization_id = ${orgId}`).catch(() => undefined);
      await db.execute(sql`DELETE FROM activity_log WHERE organization_id = ${orgId}`).catch(() => undefined);
      await db.execute(sql`DELETE FROM properties WHERE organization_id = ${orgId}`).catch(() => undefined);
      await db.execute(sql`DELETE FROM organizations WHERE id = ${orgId}`).catch(() => undefined);
    }
    await pool.end();
  });

  const parentOf = async (id: number): Promise<number | null> => {
    const { db } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    const r = (await db.execute(sql`SELECT parent_parcel_id FROM properties WHERE id = ${id}`)).rows[0] as any;
    return r?.parent_parcel_id ?? null;
  };
  const asOrg = (k: "a" | "b") => { h.org = { id: orgs[k] }; };
  const refused = (r: request.Response) => {
    expect(r.status, r.text).toBe(400);
    expect(r.body.error).toBe("INVALID_PARENT_PARCEL");
    return { status: r.status, body: r.body };
  };
  const newProperty = (apn: string, parentParcelId: unknown) => ({ apn: `${tag}-${apn}`, county, state: "OH", sizeAcres: "3", parentParcelId });

  it("POST /api/properties: a parent in another organization is refused and nothing is written; a parent in the caller's organization is kept", async () => {
    asOrg("b");
    refused(await request(app).post("/api/properties").send(newProperty("postForeign", ids.aParent)));
    const { db } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    const written = (await db.execute(sql`SELECT count(*)::int AS c FROM properties WHERE apn = ${`${tag}-postForeign`}`)).rows[0] as any;
    expect(written.c).toBe(0);

    const ok = await request(app).post("/api/properties").send(newProperty("postOwn", ids.bParent));
    expect(ok.status, ok.text).toBe(201);
    expect(await parentOf(ok.body.id)).toBe(ids.bParent);
  });

  it("an id in another organization and an id that exists nowhere get the same response", async () => {
    asOrg("b");
    const foreign = refused(await request(app).post("/api/properties").send(newProperty("probeA", ids.aPlain)));
    const nowhere = refused(await request(app).post("/api/properties").send(newProperty("probeB", 2147483000)));
    expect(nowhere).toEqual(foreign);
  });

  it("PUT /api/properties/:id: re-pointing at another organization's parcel is refused and the row is unchanged; the caller's own parent is accepted; null detaches", async () => {
    asOrg("b");
    refused(await request(app).put(`/api/properties/${ids.bOther}`).send({ parentParcelId: ids.aParent }));
    expect(await parentOf(ids.bOther)).toBeNull();
    // A string id is refused by the route's schema before the repository runs.
    const asString = await request(app).put(`/api/properties/${ids.bOther}`).send({ parentParcelId: String(ids.aParent) });
    expect(asString.status, asString.text).toBe(400);
    expect(await parentOf(ids.bOther)).toBeNull();

    const ok = await request(app).put(`/api/properties/${ids.bOther}`).send({ parentParcelId: ids.bParent });
    expect(ok.status, ok.text).toBe(200);
    expect(await parentOf(ids.bOther)).toBe(ids.bParent);
    const detach = await request(app).put(`/api/properties/${ids.bOther}`).send({ parentParcelId: null });
    expect(detach.status, detach.text).toBe(200);
    expect(await parentOf(ids.bOther)).toBeNull();
  });

  it("POST /api/properties/bulk-update: another organization's parcel as parent is refused and no row changes", async () => {
    asOrg("b");
    refused(await request(app).post("/api/properties/bulk-update").send({ ids: [ids.bOther, ids.bParent], updates: { parentParcelId: ids.aParent } }));
    expect(await parentOf(ids.bOther)).toBeNull();
    expect(await parentOf(ids.bParent)).toBeNull();
    const ok = await request(app).post("/api/properties/bulk-update").send({ ids: [ids.bOther], updates: { parentParcelId: ids.bParent } });
    expect(ok.status, ok.text).toBe(200);
    expect(await parentOf(ids.bOther)).toBe(ids.bParent);
  });

  it("the repository (the path a workflow update_record action writes through) refuses another organization's parcel, with or without a caller-given organization", async () => {
    const { storage } = await import("../../server/storage");
    await expect(storage.updateProperty(ids.bOther, { parentParcelId: ids.aPlain } as never, orgs.b)).rejects.toMatchObject({ name: "ParentParcelNotFoundError" });
    await expect(storage.updateProperty(ids.bOther, { parentParcelId: String(ids.aPlain) } as never)).rejects.toMatchObject({ name: "ParentParcelNotFoundError" });
    await expect(storage.createProperty({ ...newProperty("repoCreate", ids.aPlain), organizationId: orgs.b } as never)).rejects.toMatchObject({ name: "ParentParcelNotFoundError" });
    expect(await parentOf(ids.bOther)).toBe(ids.bParent);
  });

  it("GET /api/subdivider/dashboard counts only the organization's own lots in every aggregate", async () => {
    asOrg("a");
    const r = await request(app).get("/api/subdivider/dashboard");
    expect(r.status, r.text).toBe(200);
    expect(r.body).toMatchObject({
      hasData: true,
      parentCount: 1,
      totalChildLots: 1,
      soldChildLots: 1,
      totalParentBasisCents: 1_000_000,
      totalSoldProceedsCents: 400_000,
      recoveredPct: 40,
    });
  });
});
