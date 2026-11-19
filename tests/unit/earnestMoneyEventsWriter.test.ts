/**
 * earnest_money_events writer wiring (0086, 2026-11-19).
 *
 * Migration 0086's append-only EMD event log was created on the release
 * path (PR #623) with no writer: EMD holds changed state in
 * server/routes-earnest-money.ts with no event trail. This suite drives
 * the REAL routes (supertest) against an in-memory fake db and pins the
 * writer contract:
 *
 *   1. Creation appends the initial event (from_state NULL, to_state =
 *      the hold's initial status, the hold's amount/org, actor context).
 *   2. Every status transition — PATCH changes and the money-consequential
 *      release/refund/forfeit endpoints — appends exactly one event with
 *      the correct from/to.
 *   3. Status-preserving updates append nothing.
 *   4. Append failure is FAIL-CLOSED and atomic: the append runs in the
 *      same transaction as the hold mutation, so a failed append rolls
 *      the transition back (500, hold unchanged, no event). The fake's
 *      transaction snapshots state and restores it on throw, mirroring
 *      Postgres rollback.
 *   5. Org scoping: an event always carries its hold's organization_id;
 *      a cross-org attempt writes nothing.
 *   6. Append-only discipline in source: the routes file INSERTs into
 *      earnest_money_events and never UPDATEs or DELETEs it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import { PgDialect } from "drizzle-orm/pg-core";
import { stripComments } from "../helpers/stripComments";

const ORG_A = 42;
const ORG_B = 7;
const UA = "emd-test-agent/1.0";
const IP = "203.0.113.7";

interface HoldRow {
  id: string;
  organizationId: number;
  amountCents: number;
  status: string;
  notes: string | null;
  finalDispositionAmountCents: number | null;
  [k: string]: unknown;
}
interface EventRow {
  organizationId: unknown;
  holdId: unknown;
  fromState: unknown;
  toState: unknown;
  amountCents: unknown;
  actorUserId: unknown;
  actorIp: unknown;
  actorUa: unknown;
  justification: unknown;
}

const H = vi.hoisted(() => ({
  holds: new Map<string, Record<string, unknown>>(),
  events: [] as Array<Record<string, unknown>>,
  sqlSeen: [] as string[],
  failEventInsert: false,
  seq: 0,
}));

/** Every primitive (string/number/null) inside a drizzle WHERE object. */
function primitivesIn(where: unknown): Set<unknown> {
  const out = new Set<unknown>();
  const seen = new Set<unknown>();
  const stack: unknown[] = [where];
  while (stack.length) {
    const v = stack.pop();
    if (v === null || typeof v === "string" || typeof v === "number") {
      out.add(v);
      continue;
    }
    if (!v || typeof v !== "object" || seen.has(v)) continue;
    seen.add(v);
    for (const child of Object.values(v as Record<string, unknown>)) stack.push(child);
  }
  return out;
}

function matchingHolds(where: unknown): Array<Record<string, unknown>> {
  const prims = primitivesIn(where);
  let rows = [...H.holds.values()];
  const idHit = rows.filter((r) => prims.has(r.id));
  if (idHit.length) rows = idHit;
  rows = rows.filter((r) => prims.has(r.organizationId));
  const statusHit = rows.filter((r) => prims.has(r.status));
  if (statusHit.length && !idHit.length) rows = statusHit;
  return rows;
}

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/auth", () => ({
  isAuthenticated: (req: any, _res: unknown, next: () => void) => {
    req.user = { id: "user-1" };
    next();
  },
}));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: any, _res: unknown, next: () => void) => {
    const orgId = Number(req.headers?.["x-test-org"] ?? ORG_A);
    req.organization = { id: orgId };
    req.organizationId = orgId;
    next();
  },
}));
vi.mock("../../server/middleware/roleGuard", () => ({
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../../server/utils/orgScope", () => ({
  assertEntityBelongsToOrg: async () => true,
}));

vi.mock("../../server/db", () => {
  const dialect = new PgDialect();
  const fakeDb: Record<string, unknown> = {};

  fakeDb.select = () => {
    const q: Record<string, unknown> = {};
    q.from = () => q;
    q.where = (w: unknown) => {
      const rows = () => matchingHolds(w).map((r) => ({ ...r }));
      return {
        limit: async (_n: number) => rows(),
        orderBy: async () => rows(),
        then: (ok: (r: unknown) => unknown, bad: (e: unknown) => unknown) =>
          Promise.resolve(rows()).then(ok, bad),
      };
    };
    return q;
  };

  fakeDb.insert = () => ({
    values: (v: Record<string, unknown>) => ({
      returning: async () => {
        H.seq += 1;
        const row: Record<string, unknown> = {
          id: `11111111-2222-3333-4444-${String(H.seq).padStart(12, "0")}`,
          finalDispositionAmountCents: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...v,
        };
        H.holds.set(row.id as string, row);
        return [{ ...row }];
      },
    }),
  });

  fakeDb.update = () => ({
    set: (patch: Record<string, unknown>) => ({
      where: (w: unknown) => ({
        returning: async () => {
          const [target] = matchingHolds(w);
          if (!target) return [];
          for (const [k, val] of Object.entries(patch)) {
            if (val !== undefined) target[k] = val;
          }
          return [{ ...target }];
        },
      }),
    }),
  });

  fakeDb.execute = async (query: unknown) => {
    const compiled = dialect.sqlToQuery(query as never);
    H.sqlSeen.push(compiled.sql);
    if (!/INSERT INTO earnest_money_events/.test(compiled.sql)) {
      throw new Error(`unexpected execute() SQL: ${compiled.sql}`);
    }
    if (H.failEventInsert) throw new Error("emd event append failed (test)");
    const p = compiled.params as unknown[];
    H.events.push({
      organizationId: p[0],
      holdId: p[1],
      fromState: p[2],
      toState: p[3],
      amountCents: p[4],
      actorUserId: p[5],
      actorIp: p[6],
      actorUa: p[7],
      justification: p[8],
    });
    return { rows: [] };
  };

  fakeDb.transaction = async (fn: (tx: unknown) => Promise<unknown>) => {
    const holdsSnapshot = new Map(
      [...H.holds.entries()].map(([k, v]) => [k, { ...v }]),
    );
    const eventsLen = H.events.length;
    try {
      return await fn(fakeDb);
    } catch (err) {
      H.holds = holdsSnapshot;
      H.events.length = eventsLen;
      throw err;
    }
  };

  return { db: fakeDb, withTransaction: fakeDb.transaction };
});

import { registerEarnestMoneyRoutes } from "../../server/routes-earnest-money";

function makeApp() {
  const a = express();
  a.use(express.json());
  registerEarnestMoneyRoutes(a);
  return a;
}

function call(app: express.Application, org = ORG_A) {
  const headers = (r: request.Test) =>
    r.set("user-agent", UA).set("cf-connecting-ip", IP).set("x-test-org", String(org));
  return {
    post: (p: string) => headers(request(app).post(p)),
    patch: (p: string) => headers(request(app).patch(p)),
  };
}

async function createHold(app: express.Application, org = ORG_A): Promise<HoldRow> {
  const res = await call(app, org)
    .post("/api/earnest-money")
    .send({
      amountCents: 150_000,
      depositedAt: "2026-11-01",
      inspectionPeriodDays: 10,
      notes: "initial deposit",
    });
  expect(res.status).toBe(201);
  return res.body.hold as HoldRow;
}

beforeEach(() => {
  H.holds = new Map();
  H.events = [];
  H.sqlSeen = [];
  H.failEventInsert = false;
  H.seq = 0;
});

describe("earnest_money_events writer (0086)", () => {
  it("creation appends the initial event: from_state NULL, hold's status/amount/org, actor context", async () => {
    const app = makeApp();
    const hold = await createHold(app);
    expect(hold.status).toBe("held");
    expect(H.events).toHaveLength(1);
    expect(H.events[0]).toEqual({
      organizationId: ORG_A,
      holdId: hold.id,
      fromState: null,
      toState: "held",
      amountCents: 150_000,
      actorUserId: "user-1",
      actorIp: IP,
      actorUa: UA,
      justification: "initial deposit",
    } satisfies EventRow);
  });

  it("an ordinary PATCH transition appends exactly one event with correct from/to", async () => {
    const app = makeApp();
    const hold = await createHold(app);
    const res = await call(app)
      .patch(`/api/earnest-money/${hold.id}`)
      .send({ status: "non_refundable", notes: "inspection expired" });
    expect(res.status).toBe(200);
    expect(res.body.hold.status).toBe("non_refundable");
    expect(H.events).toHaveLength(2);
    expect(H.events[1]).toMatchObject({
      organizationId: ORG_A,
      holdId: hold.id,
      fromState: "held",
      toState: "non_refundable",
      amountCents: 150_000,
      justification: "inspection expired",
    });
  });

  it("status-preserving PATCH updates append nothing (notes-only and same-status)", async () => {
    const app = makeApp();
    const hold = await createHold(app);
    const r1 = await call(app)
      .patch(`/api/earnest-money/${hold.id}`)
      .send({ notes: "title company confirmed receipt" });
    expect(r1.status).toBe(200);
    const r2 = await call(app)
      .patch(`/api/earnest-money/${hold.id}`)
      .send({ status: "held", titleCompany: "Acme Title" });
    expect(r2.status).toBe(200);
    expect(H.events).toHaveLength(1); // still only the creation event
  });

  it("release appends released_to_seller with the HOLD's amount, not the disposition", async () => {
    const app = makeApp();
    const hold = await createHold(app);
    const res = await call(app)
      .post(`/api/earnest-money/${hold.id}/release`)
      .send({ finalDispositionAmountCents: 140_000, notes: "closed" });
    expect(res.status).toBe(200);
    expect(res.body.hold.status).toBe("released_to_seller");
    expect(res.body.hold.finalDispositionAmountCents).toBe(140_000);
    expect(H.events).toHaveLength(2);
    expect(H.events[1]).toMatchObject({
      organizationId: ORG_A,
      holdId: hold.id,
      fromState: "held",
      toState: "released_to_seller",
      amountCents: 150_000,
      justification: "closed",
    });
  });

  it("refund appends refunded_to_buyer", async () => {
    const app = makeApp();
    const hold = await createHold(app);
    const res = await call(app)
      .post(`/api/earnest-money/${hold.id}/refund`)
      .send({ notes: "backed out in period" });
    expect(res.status).toBe(200);
    expect(H.events).toHaveLength(2);
    expect(H.events[1]).toMatchObject({
      fromState: "held",
      toState: "refunded_to_buyer",
      amountCents: 150_000,
      justification: "backed out in period",
    });
  });

  it("forfeit appends forfeited", async () => {
    const app = makeApp();
    const hold = await createHold(app);
    const res = await call(app)
      .post(`/api/earnest-money/${hold.id}/forfeit`)
      .send({});
    expect(res.status).toBe(200);
    expect(H.events).toHaveLength(2);
    expect(H.events[1]).toMatchObject({
      fromState: "held",
      toState: "forfeited",
      amountCents: 150_000,
      justification: null,
    });
  });

  it("re-applying the terminal status the hold already carries appends nothing", async () => {
    const app = makeApp();
    const hold = await createHold(app);
    await call(app).post(`/api/earnest-money/${hold.id}/release`).send({});
    expect(H.events).toHaveLength(2);
    const res = await call(app).post(`/api/earnest-money/${hold.id}/release`).send({});
    expect(res.status).toBe(200);
    expect(H.events).toHaveLength(2);
  });

  it("append failure is fail-closed: a PATCH transition rolls back (500, hold unchanged, no event)", async () => {
    const app = makeApp();
    const hold = await createHold(app);
    H.failEventInsert = true;
    const res = await call(app)
      .patch(`/api/earnest-money/${hold.id}`)
      .send({ status: "non_refundable" });
    expect(res.status).toBe(500);
    expect(H.holds.get(hold.id)?.status).toBe("held");
    expect(H.events).toHaveLength(1); // creation event only
  });

  it("append failure on creation rolls the hold back too (500, no hold, no event)", async () => {
    const app = makeApp();
    H.failEventInsert = true;
    const res = await call(app)
      .post("/api/earnest-money")
      .send({ amountCents: 5_000, depositedAt: "2026-11-01" });
    expect(res.status).toBe(500);
    expect(H.holds.size).toBe(0);
    expect(H.events).toHaveLength(0);
  });

  it("org scoping: events carry the hold's org, and cross-org writes 404 with no event", async () => {
    const app = makeApp();
    const holdA = await createHold(app, ORG_A);
    const holdB = await createHold(app, ORG_B);
    expect(H.events[0].organizationId).toBe(ORG_A);
    expect(H.events[1].organizationId).toBe(ORG_B);
    expect(H.events[1].holdId).toBe(holdB.id);

    // Org B cannot transition org A's hold, and no event is written.
    const cross = await call(app, ORG_B)
      .patch(`/api/earnest-money/${holdA.id}`)
      .send({ status: "forfeited" });
    expect(cross.status).toBe(404);
    const crossRelease = await call(app, ORG_B)
      .post(`/api/earnest-money/${holdA.id}/release`)
      .send({});
    expect(crossRelease.status).toBe(404);
    expect(H.events).toHaveLength(2);
    expect(H.holds.get(holdA.id)?.status).toBe("held");
  });

  it("source discipline: the routes file only INSERTs into earnest_money_events", () => {
    const src = stripComments(
      fs.readFileSync(
        path.join(process.cwd(), "server/routes-earnest-money.ts"),
        "utf8",
      ),
    );
    expect(src).toMatch(/INSERT INTO earnest_money_events/);
    expect(src).not.toMatch(/UPDATE\s+earnest_money_events/i);
    expect(src).not.toMatch(/DELETE\s+FROM\s+earnest_money_events/i);
    // The table stays unmodelled: no pgTable declaration anywhere for it.
    const schemaDir = path.join(process.cwd(), "shared/schema");
    for (const f of fs.readdirSync(schemaDir)) {
      if (!f.endsWith(".ts")) continue;
      const s = fs.readFileSync(path.join(schemaDir, f), "utf8");
      expect(s).not.toMatch(/pgTable\(\s*"earnest_money_events"/);
    }
  });
});
