/**
 * The buy-box table and routes (Leg 2) against a REAL database built from this
 * repository, migration 0301 included. FALSIFYING: on pre-leg main the table,
 * the routes and the module do not exist.
 *
 *   1. saving twice makes versions 1 and 2; GET returns 2 as current with both;
 *   2. append-only: UPDATE, TRUNCATE and a DELETE while the org exists are
 *      refused by the database; an org deletion still removes its rows;
 *   3. tenant scope: another org sees nothing and its triage has no buy box;
 *   4. triage reads only the org's own CANDIDATES (prospect / due_diligence /
 *      offer_sent): an owned or under-contract property, another org's
 *      prospect and a soft-deleted one are not candidates; fails and
 *      retirements carry named reasons; triage writes nothing;
 *   5. an invalid buy box is refused and nothing is written.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { realDbAvailable, useRealDb } from "../helpers/realDb";

useRealDb("wholesaleBuyBox.realdb.test.ts");

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const tag = `wbb-${Math.random().toString(36).slice(2, 10)}`;
let org = 0;
let other = 0;
const ids: Record<string, number> = {};

async function q(text: TemplateStringsArray, ...vals: unknown[]) {
  const { db } = await import("../../server/db");
  const { sql } = await import("drizzle-orm");
  const r = await db.execute(sql(text, ...vals));
  return (r as unknown as { rows: Array<Record<string, any>> }).rows;
}
async function appFor(organizationId: number) {
  const { default: router } = await import("../../server/routes-wholesale-buy-box");
  const a = express();
  a.use(express.json());
  a.use((req: any, _res, next) => {
    req.organization = { id: organizationId };
    req.organizationId = organizationId;
    req.user = { id: `${tag}-user` };
    next();
  });
  a.use("/api/wholesale", router);
  return a;
}
const criteria = { states: ["TX"], maxPurchasePriceCents: 20_000_000, staleAfterDays: 30 };

describe.runIf(realDbAvailable)("wholesale buy box — real database", () => {
  vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

  beforeAll(async () => {
    const { db } = await import("../../server/db");
    const { organizations } = await import("@shared/schema");
    const [a] = await db.insert(organizations).values({ name: `${tag}-a`, slug: `${tag}-a`, ownerId: `${tag}-oa` } as never).returning();
    const [b] = await db.insert(organizations).values({ name: `${tag}-b`, slug: `${tag}-b`, ownerId: `${tag}-ob` } as never).returning();
    org = a.id;
    other = b.id;
    const mk = async (o: number, key: string, state: string, status: string, deleted = false, updated = "now()") =>
      (await q`INSERT INTO properties (organization_id, apn, county, state, size_acres, status, address, deleted_at, updated_at)
               VALUES (${o}, ${`${tag}-${key}`}, 'Harris', ${state}, '0.2', ${status}, ${`1 ${key} St`},
                       ${deleted ? new Date() : null}, ${updated === "now()" ? new Date() : new Date(updated)}) RETURNING id`)[0].id;
    ids.fitTx = await mk(org, "fittx", "TX", "prospect");
    ids.failFl = await mk(org, "failfl", "FL", "due_diligence");
    ids.stale = await mk(org, "stale", "TX", "offer_sent", false, "2026-01-15T12:00:00Z");
    ids.owned = await mk(org, "owned", "TX", "owned");
    ids.contract = await mk(org, "contract", "TX", "under_contract");
    ids.deleted = await mk(org, "deleted", "TX", "prospect", true);
    ids.otherOrg = await mk(other, "other", "TX", "prospect");
    await q`INSERT INTO deals (organization_id, property_id, type, status, offer_amount) VALUES (${org}, ${ids.fitTx}, 'acquisition', 'negotiating', '150000')`;
  });

  afterAll(async () => {
    const { pool } = await import("../../server/db");
    for (const o of [org, other].filter(Boolean)) {
      await q`DELETE FROM deals WHERE organization_id = ${o}`;
      await q`DELETE FROM properties WHERE organization_id = ${o}`;
      await q`DELETE FROM organizations WHERE id = ${o}`;
    }
    await pool.end();
  });

  it("1. two saves are two versions; the newest is current", async () => {
    const app = await appFor(org);
    expect((await request(app).post("/api/wholesale/buy-box").send({ criteria: { ...criteria, staleAfterDays: 60 } })).status).toBe(200);
    const second = await request(app).post("/api/wholesale/buy-box").send({ criteria });
    expect(second.status).toBe(200);
    expect(second.body.current.version).toBe(2);
    const got = await request(app).get("/api/wholesale/buy-box");
    expect(got.body.current).toMatchObject({ version: 2, criteria });
    expect(got.body.versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    expect(got.body.versions[1].criteria.staleAfterDays).toBe(60);
  });

  /** The database's own refusal, unwrapped from the driver's "Failed query" envelope. */
  const refusal = async (p: Promise<unknown>) => {
    try {
      await p;
      return "no error";
    } catch (e) {
      const err = e as { message?: string; cause?: { message?: string } };
      return `${err.message ?? ""} ${err.cause?.message ?? ""}`;
    }
  };

  it("2. append-only: UPDATE, TRUNCATE and DELETE-while-the-org-exists are refused by the database", async () => {
    expect(await refusal(q`UPDATE wholesale_buy_boxes SET criteria = '{}'::jsonb WHERE organization_id = ${org}`)).toMatch(/append-only \(UPDATE denied\)/);
    expect(await refusal(q`DELETE FROM wholesale_buy_boxes WHERE organization_id = ${org}`)).toMatch(/leave only with their organization/);
    expect(await refusal(q`TRUNCATE wholesale_buy_boxes`)).toMatch(/append-only \(TRUNCATE denied\)/);
    expect((await q`SELECT count(*)::int AS n FROM wholesale_buy_boxes WHERE organization_id = ${org}`)[0].n).toBe(2);
  });

  it("2b. an organization's deletion still removes its buy boxes (erasable)", async () => {
    const { db } = await import("../../server/db");
    const { organizations } = await import("@shared/schema");
    const [tmp] = await db.insert(organizations).values({ name: `${tag}-t`, slug: `${tag}-t`, ownerId: `${tag}-ot` } as never).returning();
    await request(await appFor(tmp.id)).post("/api/wholesale/buy-box").send({ criteria }).expect(200);
    await q`DELETE FROM organizations WHERE id = ${tmp.id}`;
    expect((await q`SELECT count(*)::int AS n FROM wholesale_buy_boxes WHERE organization_id = ${tmp.id}`)[0].n).toBe(0);
  });

  it("3. tenant scope: another org sees no buy box and cannot triage", async () => {
    const app = await appFor(other);
    expect((await request(app).get("/api/wholesale/buy-box")).body).toEqual({ current: null, versions: [] });
    const t = await request(app).get("/api/wholesale/candidates/triage");
    expect(t.status).toBe(409);
    expect(t.body.error).toBe("NO_BUY_BOX");
  });

  it("4. triage: only the org's own candidates, with named reasons; it writes nothing", async () => {
    const before = await q`SELECT id, status, updated_at FROM properties WHERE organization_id = ${org} ORDER BY id`;
    const res = await request(await appFor(org)).get("/api/wholesale/candidates/triage");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.buyBoxVersion).toBe(2);
    const byId = new Map(res.body.rows.map((r: { propertyId: number }) => [r.propertyId, r]));
    expect([...byId.keys()].sort()).toEqual([ids.fitTx, ids.failFl, ids.stale].sort());
    expect(byId.get(ids.fitTx)).toMatchObject({ verdict: "fits", score: 1 });
    expect((byId.get(ids.fitTx) as { passed: string[] }).passed.join(" ")).toMatch(/\$150,000 is within your \$200,000 max/);
    expect(byId.get(ids.failFl)).toMatchObject({ verdict: "fails" });
    expect((byId.get(ids.failFl) as { failures: string[] }).failures[0]).toMatch(/outside your states/);
    expect(byId.get(ids.stale)).toMatchObject({ verdict: "retired" });
    expect((byId.get(ids.stale) as { retiredBecause: string }).retiredBecause).toMatch(/No activity since 2026-01-15/);
    expect(await q`SELECT id, status, updated_at FROM properties WHERE organization_id = ${org} ORDER BY id`).toEqual(before);
  });

  it("5. an invalid buy box is refused and nothing is written", async () => {
    const before = (await q`SELECT count(*)::int AS n FROM wholesale_buy_boxes WHERE organization_id = ${org}`)[0].n;
    for (const bad of [{}, { states: [], staleAfterDays: 30 }, { states: ["TEXAS"], staleAfterDays: 30 }]) {
      const res = await request(await appFor(org)).post("/api/wholesale/buy-box").send({ criteria: bad });
      expect(res.status, JSON.stringify(bad)).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    }
    expect((await q`SELECT count(*)::int AS n FROM wholesale_buy_boxes WHERE organization_id = ${org}`)[0].n).toBe(before);
  });

  it("6. a key the buy box does not define is dropped, never stored", async () => {
    const res = await request(await appFor(org)).post("/api/wholesale/buy-box").send({ criteria: { ...criteria, skipTrace: true, ownerList: ["x"] } });
    expect(res.status).toBe(200);
    expect(res.body.current.criteria).toEqual(criteria);
    const [row] = await q`SELECT criteria FROM wholesale_buy_boxes WHERE id = ${res.body.current.id}`;
    expect(row.criteria).toEqual(criteria);
  });
});
