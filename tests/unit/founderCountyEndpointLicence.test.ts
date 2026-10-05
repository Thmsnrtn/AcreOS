/**
 * W10.3 audit #3a — the founder's county-licence review.
 *
 * Whether an org may SAVE a county's records into its CRM is a founder
 * licensing decision (shared/geo/countyStatus.ts, Beatrice rule): every
 * county_gis_endpoints row ships 'review-required' and the list builder only
 * lets a list be saved from a 'yes' / 'attribution' row. These two endpoints
 * are how that decision is made and recorded:
 *
 *   GET   /api/founder/county-endpoints?status=review-required
 *   PATCH /api/founder/county-endpoints/:id/licence  { redistributable, note }
 *
 * Driven over HTTP with the REAL requireFounder (identity from FOUNDER_EMAIL),
 * so "a non-founder is refused" is the gate's own answer, not a mock's.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const H = vi.hoisted(() => {
  process.env.FOUNDER_EMAIL = "founder@acreos.test";
  return {
    rows: [] as Array<Record<string, unknown>>,
    total: 0,
    selects: [] as Array<{ fields: Record<string, unknown> | undefined; where: unknown; limit: number | null }>,
    updates: [] as Array<{ set: Record<string, unknown>; where: unknown; viaTx: boolean }>,
    audits: [] as Array<Record<string, unknown>>,
    /** The executor each audit insert was handed, and every transaction opened. */
    auditExecs: [] as unknown[],
    txs: [] as unknown[],
    auditFails: false,
    order: [] as string[],
  };
});

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/auth/clerkAuth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../server/auth/clerkAuth")>()),
  isAuthenticated: (_q: unknown, _s: unknown, n: () => void) => n(),
}));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: { organization?: unknown; user?: unknown; headers: Record<string, string | undefined> }, _s: unknown, n: () => void) => {
    req.organization = { id: 7 };
    const email = req.headers["x-email"] ?? "founder@acreos.test";
    req.user = { id: email === "founder@acreos.test" ? "user_founder" : "user_customer", email };
    n();
  },
}));
vi.mock("../../server/services/coverageLedger", () => ({ getCoverageLedger: vi.fn() }));
vi.mock("../../server/utils/auditEventsChain", () => ({
  chainAndInsertAuditEvent: vi.fn(async (e: Record<string, unknown>, exec?: unknown) => {
    H.order.push("audit");
    H.auditExecs.push(exec);
    if (H.auditFails) throw new Error("audit_events insert failed");
    H.audits.push(e);
    return { id: "a1", ...e };
  }),
}));

const fakeDb = vi.hoisted(() => (viaTx = false): Record<string, unknown> => ({
  select: (fields?: Record<string, unknown>) => {
    const q = { fields, where: undefined as unknown, limit: null as number | null };
    H.selects.push(q);
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: (w: unknown) => ((q.where = w), chain),
      orderBy: () => chain,
      limit: (n: number) => ((q.limit = n), chain),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve(fields && "n" in fields ? [{ n: H.total }] : H.rows).then(res, rej),
    };
    return chain;
  },
  update: () => ({
    set: (set: Record<string, unknown>) => ({
      where: async (where: unknown) => {
        H.order.push("update");
        H.updates.push({ set, where, viaTx });
        return [];
      },
    }),
  }),
  transaction: async (cb: (tx: unknown) => unknown) => {
    const tx = fakeDb(true);
    H.txs.push(tx);
    return cb(tx);
  },
}));
vi.mock("../../server/db", () => ({ db: fakeDb() }));
vi.mock("../../server/db-replica", () => ({ dbForReads: async () => fakeDb() }));

const { registerFounderCoverageRoutes } = await import("../../server/routes-founder-coverage");
const app = express();
app.use(express.json());
registerFounderCoverageRoutes(app);

const dialect = new PgDialect();
const render = (w: unknown) => dialect.sqlToQuery(w as SQL);

const ENDPOINT = { id: 41, state: "TX", county: "Harris", redistributable: "review-required" };
const NOTE = "Read the HCAD terms 2026-10-05: public records, attribution required.";

beforeEach(() => {
  H.rows = [ENDPOINT];
  H.total = 1;
  H.selects = [];
  H.updates = [];
  H.audits = [];
  H.auditFails = false;
  H.order = [];
  H.auditExecs = [];
  H.txs = [];
});

const patch = (body: unknown, email?: string) => {
  const r = request(app).patch("/api/founder/county-endpoints/41/licence");
  return (email ? r.set("x-email", email) : r).send(body as object);
};

describe("PATCH /api/founder/county-endpoints/:id/licence", () => {
  it("FOUNDER-ONLY: a customer is refused (404) and nothing is read, recorded or changed", async () => {
    const r = await patch({ redistributable: "yes", note: NOTE }, "owner@customer.test");
    expect(r.status).toBe(404);
    expect(H.selects).toEqual([]);
    expect(H.audits).toEqual([]);
    expect(H.updates).toEqual([]);
  });

  it("records WHO, WHEN and the NOTE, then changes the licence — the record first", async () => {
    const r = await patch({ redistributable: "attribution", note: NOTE, attribution: "Parcel data: Harris CAD" });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ id: 41, redistributable: "attribution" });

    expect(H.order).toEqual(["audit", "update"]);
    expect(H.audits).toHaveLength(1);
    expect(H.audits[0]).toMatchObject({
      actorUserId: "user_founder",
      actorEmail: "founder@acreos.test",
      action: "county_endpoint.licence_set",
      targetType: "county_endpoint",
      targetId: "41",
      justification: NOTE,
      metadata: { from: "review-required", to: "attribution", state: "TX", county: "Harris", attribution: "Parcel data: Harris CAD" },
    });

    expect(H.updates).toHaveLength(1);
    const u = H.updates[0];
    expect(u.set).toMatchObject({ redistributable: "attribution", reviewedBy: "user_founder", attribution: "Parcel data: Harris CAD" });
    expect(u.set.reviewedAt).toBeInstanceOf(Date);
    const q = render(u.where);
    expect(q.sql).toMatch(/"county_gis_endpoints"\."id" = \$1/);
    expect(q.params).toEqual([41]);
  });

  it("the record and the change are ONE transaction: the audit insert and the update ride the same tx (W10.3 second audit, finding 12)", async () => {
    const r = await patch({ redistributable: "yes", note: NOTE });
    expect(r.status).toBe(200);
    expect(H.txs).toHaveLength(1);
    expect(H.auditExecs[0], "the audit row must be written through the transaction").toBe(H.txs[0]);
    expect(H.updates.map((u) => u.viaTx)).toEqual([true]);
  });

  it("ATTRIBUTION: refused (422) when neither the row nor the request carries the credit line — nothing recorded or changed", async () => {
    // W10.3 second audit, finding 5: 'attribution' with no attribution string
    // let customers save — and public reports publish — records whose
    // required credit line AcreOS could never show.
    for (const attribution of [undefined, null, "   "]) {
      H.rows = [{ ...ENDPOINT, attribution }];
      const r = await patch({ redistributable: "attribution", note: NOTE });
      expect(r.status).toBe(422);
      expect(r.body.message).toMatch(/attribution/i);
    }
    expect(H.audits).toEqual([]);
    expect(H.updates).toEqual([]);
  });

  it("ATTRIBUTION: accepted when the row already carries the credit line (none sent, the stored one kept)", async () => {
    H.rows = [{ ...ENDPOINT, attribution: "Source: Harris Central Appraisal District" }];
    const r = await patch({ redistributable: "attribution", note: NOTE });
    expect(r.status).toBe(200);
    expect(H.updates[0].set).not.toHaveProperty("attribution");
  });

  it.each([
    ["an empty attribution", { redistributable: "attribution", note: NOTE, attribution: "  " }],
    ["an attribution over 500 characters", { redistributable: "attribution", note: NOTE, attribution: "x".repeat(501) }],
    ["an unknown key", { redistributable: "yes", note: NOTE, isActive: true }],
    ["a note under 10 characters", { redistributable: "yes", note: "ok fine" }],
    ["a note over 1000 characters", { redistributable: "yes", note: "x".repeat(1001) }],
    ["no note", { redistributable: "yes" }],
    ["a posture outside the vocabulary", { redistributable: "maybe", note: NOTE }],
  ])("STRICT: %s is a 400 and nothing is written", async (_label, body) => {
    const r = await patch(body);
    expect(r.status).toBe(400);
    expect(H.audits).toEqual([]);
    expect(H.updates).toEqual([]);
  });

  it("an id that is not a positive integer is a 400", async () => {
    const r = await request(app).patch("/api/founder/county-endpoints/abc/licence").send({ redistributable: "yes", note: NOTE });
    expect(r.status).toBe(400);
    expect(H.updates).toEqual([]);
  });

  it("an unknown endpoint is a 404 with nothing recorded", async () => {
    H.rows = [];
    const r = await patch({ redistributable: "yes", note: NOTE });
    expect(r.status).toBe(404);
    expect(H.audits).toEqual([]);
    expect(H.updates).toEqual([]);
  });

  it("if the decision cannot be recorded, the licence is NOT changed", async () => {
    H.auditFails = true;
    const r = await patch({ redistributable: "yes", note: NOTE });
    expect(r.status).toBe(500);
    expect(H.updates).toEqual([]);
  });
});

describe("GET /api/founder/county-endpoints", () => {
  it("FOUNDER-ONLY: a customer is refused (404)", async () => {
    const r = await request(app).get("/api/founder/county-endpoints?status=review-required").set("x-email", "owner@customer.test");
    expect(r.status).toBe(404);
    expect(H.selects).toEqual([]);
  });

  it("lists the endpoints in one licence posture, bounded, with the true total", async () => {
    H.total = 312;
    H.rows = [{ id: 41, state: "TX", county: "Harris", baseUrl: "https://gis.example.gov/x", redistributable: "review-required", isActive: true }];
    const r = await request(app).get("/api/founder/county-endpoints?status=review-required");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ endpoints: H.rows, total: 312 });
    expect(H.selects).toHaveLength(2);
    for (const s of H.selects) {
      const q = render(s.where);
      expect(q.sql).toMatch(/"county_gis_endpoints"\."redistributable" = \$1/);
      expect(q.params).toEqual(["review-required"]);
    }
    const page = H.selects.find((s) => s.limit !== null)!;
    expect(page.limit).toBeGreaterThan(0);
    expect(page.limit).toBeLessThanOrEqual(500);
  });

  it("an unknown status is a 400, never an unfiltered list", async () => {
    const r = await request(app).get("/api/founder/county-endpoints?status=whatever");
    expect(r.status).toBe(400);
    expect(H.selects).toEqual([]);
  });
});
