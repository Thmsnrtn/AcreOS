/**
 * POST /api/properties/fetch-all-parcels bounds its paid lookups per run
 * (W10.2b audit, P1 money).
 *
 * The route calls lookupParcelByAPN — a paid Regrid lookup that can fall back
 * to the PLATFORM key — once per property, in sequence. Reading the capped
 * newest-5,000 list bounded that by accident; once it read the whole book
 * (DEFECT-0171) one click could spend a lookup on every property without a
 * boundary. A run now looks up at most PARCEL_LOOKUPS_PER_RUN, newest first,
 * and reports `processed`, the whole-book `remaining` and the `cap` beside the
 * fields it always returned.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const H = vi.hoisted(() => ({
  eligible: [] as Array<{ id: number; apn: string; state: string; county: string; createdAt: Date }>,
  looked: [] as string[],
  notFound: new Set<string>(),
  updates: [] as number[],
  readOrg: [] as number[],
  limits: [] as number[],
  cursors: [] as Array<number | undefined>,
}));

vi.mock("../../server/auth", () => ({ isAuthenticated: (_r: unknown, _s: unknown, n: () => void) => n() }));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: { organization?: unknown }, _s: unknown, n: () => void) => {
    req.organization = { id: 7 };
    n();
  },
}));
vi.mock("../../server/storage", () => ({
  storage: {
    updateProperty: vi.fn(async (id: number, _patch: unknown, org: number) => {
      if (org === 7) H.updates.push(id);
      return { id };
    }),
  },
  db: {},
}));
vi.mock("../../server/storage/wholeOrgReadsF", () => ({
  // The reader's contract: the newest `limit` eligible rows and the whole-book count.
  propertiesMissingParcelBoundary: vi.fn(async (org: number, limit: number, beforeId?: number) => {
    H.readOrg.push(org);
    H.limits.push(limit);
    H.cursors.push(beforeId);
    // Still eligible = not yet given a boundary by an earlier run.
    const open = H.eligible.filter((p) => !H.updates.includes(p.id));
    return { rows: open.filter((p) => beforeId == null || p.id < beforeId).slice(0, limit), total: open.length };
  }),
}));
vi.mock("../../server/services/parcel", () => ({
  lookupParcelByAPN: vi.fn(async (apn: string) => {
    H.looked.push(apn);
    if (H.notFound.has(apn)) return { found: false, error: "not found" };
    return {
      found: true,
      source: "regrid",
      parcel: { boundary: { type: "Polygon" }, centroid: { lat: 30, lng: -97 }, data: {} },
    };
  }),
}));

const { registerPropertyRoutes } = await import("../../server/routes-properties");
// The route's per-run cap (module-private); pinned by behaviour below.
const PARCEL_LOOKUPS_PER_RUN = 100;
const app = express();
app.use(express.json());
registerPropertyRoutes(app);

// propertiesMissingParcelBoundary returns newest first: a higher id is newer.
const prop = (id: number) => ({ id, apn: `APN-${id}`, state: "TX", county: "Travis", createdAt: new Date(Date.UTC(2026, 0, 1) + id * 60_000) });
const newestFirst = (n: number) => Array.from({ length: n }, (_, i) => prop(n - i));

beforeEach(() => {
  H.eligible = [];
  H.looked = [];
  H.notFound = new Set();
  H.updates = [];
  H.readOrg = [];
  H.limits = [];
  H.cursors = [];
});

describe("fetch-all-parcels — a bounded, honest run", () => {
  it("looks up at most the cap, newest first, and reports processed / remaining / cap", async () => {
    H.eligible = newestFirst(6200);
    H.notFound = new Set(["APN-6199"]);
    const r = await request(app).post("/api/properties/fetch-all-parcels").send({});
    expect(r.status).toBe(200);
    expect(H.readOrg).toEqual([7]);
    // Only the run's batch is read, never the whole eligible set.
    expect(H.limits).toEqual([PARCEL_LOOKUPS_PER_RUN]);
    expect(H.looked).toHaveLength(PARCEL_LOOKUPS_PER_RUN);
    expect(H.looked[0]).toBe("APN-6200");
    expect(H.looked.at(-1)).toBe("APN-6101");
    expect(H.looked).not.toContain("APN-1");
    expect(r.body).toMatchObject({
      updated: 99,
      failed: 1,
      processed: 100,
      // Everything the run did not reach, plus the one lookup that failed.
      remaining: 6101,
      cap: 100,
      // A full batch: the next run continues below the last property looked up.
      nextBeforeId: 6101,
    });
    expect(r.body.results).toHaveLength(100);
    expect(H.updates).toHaveLength(99);
    // The client shows `message` as the toast: it must not read as "all done".
    expect(r.body.message).toBe(
      "Updated 99 of 100 properties with parcel data, 1 failed. 6101 properties still have no boundary — run again to continue with older properties (at most 100 per run).",
    );
  });

  it("a book under the cap is done in one run and says nothing remains", async () => {
    H.eligible = newestFirst(3);
    const r = await request(app).post("/api/properties/fetch-all-parcels").send({});
    expect(H.looked).toEqual(["APN-3", "APN-2", "APN-1"]);
    expect(r.body).toMatchObject({ updated: 3, failed: 0, processed: 3, remaining: 0, cap: 100, nextBeforeId: null });
    expect(r.body.message).toBe("Updated 3 of 3 properties with parcel data");
  });

  it("nothing eligible: no lookups, the same fields, zeros", async () => {
    const r = await request(app).post("/api/properties/fetch-all-parcels").send({});
    expect(H.looked).toHaveLength(0);
    expect(r.body).toEqual({
      message: "All properties already have parcel boundaries",
      updated: 0,
      failed: 0,
      processed: 0,
      remaining: 0,
      cap: 100,
      nextBeforeId: null,
    });
  });

  it("a newest batch that never resolves does not starve the rest: runs walk down the book, then start over", async () => {
    // The re-audit's case: the newest 100 have unfindable APNs. Each run used
    // to pay for the same 100 lookups and never reach an older property.
    H.eligible = newestFirst(250);
    H.notFound = new Set(Array.from({ length: 100 }, (_, i) => `APN-${250 - i}`));
    const first = await request(app).post("/api/properties/fetch-all-parcels").send({});
    expect(first.body).toMatchObject({ updated: 0, failed: 100, nextBeforeId: 151 });
    const second = await request(app).post("/api/properties/fetch-all-parcels").send({ beforeId: first.body.nextBeforeId });
    expect(H.cursors).toEqual([undefined, 151]);
    expect(H.looked.slice(100, 101)).toEqual(["APN-150"]);
    expect(second.body).toMatchObject({ updated: 100, failed: 0, remaining: 150, nextBeforeId: 51 });
    const third = await request(app).post("/api/properties/fetch-all-parcels").send({ beforeId: 51 });
    expect(third.body).toMatchObject({ updated: 50, processed: 50, remaining: 100, nextBeforeId: null });
    expect(third.body.message).toMatch(/this pass reached the oldest; the next run starts again from the newest\.$/);
  });

  it("a cursor that is not a positive integer is ignored, never passed to SQL", async () => {
    H.eligible = newestFirst(3);
    for (const beforeId of ["5; drop table", -4, 2.5, 0, 1e20, 2_147_483_648]) {
      await request(app).post("/api/properties/fetch-all-parcels").send({ beforeId });
    }
    // Out of int4 range would be a Postgres error (a 500), not a cursor.
    expect(H.cursors).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
  });

  it("a cursor with nothing below it starts over from the newest in the same request", async () => {
    // Exactly one full batch left below the previous cursor, now done — or a
    // cursor carried over from another org whose ids are all higher.
    H.eligible = newestFirst(3).map((p) => ({ ...p, id: p.id + 500, apn: `APN-${p.id + 500}` }));
    const r = await request(app).post("/api/properties/fetch-all-parcels").send({ beforeId: 100 });
    expect(H.cursors).toEqual([100, undefined]);
    expect(H.looked).toEqual(["APN-503", "APN-502", "APN-501"]);
    expect(r.body).toMatchObject({ updated: 3, processed: 3, remaining: 0, nextBeforeId: null });
  });
});
