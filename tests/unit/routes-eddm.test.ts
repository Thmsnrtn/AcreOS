/**
 * Pillar 3 Tab 4 — EDDM routes unit tests.
 *
 * The synthetic carrier-route stub is deterministic, so we don't need a
 * live DB to verify the routes endpoint shape and the parcels endpoint
 * bbox filtering. We mount the router on a bare express app with auth +
 * org middleware stubbed.
 */

import { describe, it, expect, vi, beforeAll } from "vitest";
import express from "express";
import request from "supertest";

// ── Mock infra dependencies BEFORE importing the module under test ──────────

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../server/auth", () => ({
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { id: "user-1", claims: { sub: "user-1" } };
    next();
  },
}));

vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: any, _res: any, next: any) => {
    req.organization = { id: 42, name: "Test Org" };
    req.organizationId = 42;
    next();
  },
}));

// In-memory stand-in for the properties table. The parcels endpoint runs
// a single select() through drizzle; we stub the chain to return whatever
// matches our bbox.
const fakeParcels = [
  // Inside bbox
  { id: 1, apn: "A1", latitude: "26.2", longitude: "-98.3", sizeAcres: "5", state: "TX", county: "Hidalgo", parcelBoundary: null },
  // Inside bbox, large acreage (will be filtered out when acreageMax=10)
  { id: 2, apn: "A2", latitude: "26.25", longitude: "-98.25", sizeAcres: "50", state: "TX", county: "Hidalgo", parcelBoundary: null },
];

let lastWhereArgs: unknown = null;
// vi.mock factories are hoisted above module-level consts, so the spy has to
// be hoisted with them — a plain `const` here is still in its temporal dead
// zone when the factory runs (`insert:` is read eagerly, unlike the `where`
// closure below, which is why only this one blew up).
const { dbInsertSpy } = vi.hoisted(() => ({
  dbInsertSpy: vi.fn(() => ({ values: () => ({ returning: async () => [{ id: 999 }] }) })),
}));
vi.mock("../../server/db", () => {
  const chain = {
    from: () => chain,
    where: (...args: unknown[]) => {
      lastWhereArgs = args;
      return chain;
    },
    limit: async () => fakeParcels,
    returning: async () => [{ id: 999 }],
  };
  return {
    db: {
      select: () => chain,
      insert: dbInsertSpy,
    },
  };
});

// ── Import the module under test ───────────────────────────────────────────

import { registerEddmRoutes } from "../../server/routes-eddm";

describe("routes-eddm", () => {
  let app: express.Application;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    registerEddmRoutes(app);
  });

  describe("GET /api/outreach/mail/eddm/routes", () => {
    it("returns ≥1 synthetic carrier-route feature for a known county", async () => {
      const res = await request(app)
        .get("/api/outreach/mail/eddm/routes")
        .query({ county: "Hidalgo", state: "TX" });

      expect(res.status).toBe(200);
      expect(res.body.type).toBe("FeatureCollection");
      expect(Array.isArray(res.body.features)).toBe(true);
      expect(res.body.features.length).toBeGreaterThanOrEqual(1);
      // 5 × 4 grid = 20 routes
      expect(res.body.features.length).toBe(20);
      expect(res.body.synthetic).toBe(true);
      expect(res.body.notice).toContain("Demo carrier routes");

      const first = res.body.features[0];
      expect(first.geometry.type).toBe("Polygon");
      expect(first.properties.routeId).toMatch(/^TX-hidalgo-R/);
      expect(first.properties.householdCount).toBeGreaterThanOrEqual(100);
      expect(first.properties.householdCount).toBeLessThanOrEqual(500);
      expect(first.properties.synthetic).toBe(true);
    });

    it("falls back to a generic bbox for unknown counties (always ≥1 feature)", async () => {
      const res = await request(app)
        .get("/api/outreach/mail/eddm/routes")
        .query({ county: "NoSuchCounty", state: "ZZ" });

      expect(res.status).toBe(200);
      expect(res.body.features.length).toBeGreaterThanOrEqual(1);
    });

    it("returns deterministic geometry across calls", async () => {
      const a = await request(app)
        .get("/api/outreach/mail/eddm/routes")
        .query({ county: "Hidalgo", state: "TX" });
      const b = await request(app)
        .get("/api/outreach/mail/eddm/routes")
        .query({ county: "Hidalgo", state: "TX" });
      expect(b.body.features[0].properties.householdCount).toBe(
        a.body.features[0].properties.householdCount,
      );
      expect(b.body.features[0].geometry).toEqual(a.body.features[0].geometry);
    });

    it("rejects missing state with 422", async () => {
      const res = await request(app)
        .get("/api/outreach/mail/eddm/routes")
        .query({ county: "Hidalgo" });
      expect(res.status).toBe(422);
    });
  });

  describe("GET /api/outreach/mail/eddm/parcels", () => {
    it("returns parcels for a valid bbox", async () => {
      const res = await request(app)
        .get("/api/outreach/mail/eddm/parcels")
        .query({ bbox: "-98.5,26.0,-98.0,26.5" });

      expect(res.status).toBe(200);
      expect(res.body.type).toBe("FeatureCollection");
      expect(Array.isArray(res.body.features)).toBe(true);
      // We stubbed the db to return both parcels regardless; the test is
      // that the endpoint composed bbox conditions and serialized features.
      expect(res.body.features.length).toBeGreaterThan(0);
      expect(res.body.features[0].properties.acres).toBeTypeOf("number");
    });

    it("rejects an invalid bbox", async () => {
      const res = await request(app)
        .get("/api/outreach/mail/eddm/parcels")
        .query({ bbox: "not-a-bbox" });
      expect(res.status).toBe(400);
    });

    it("rejects an inverted bbox (west >= east)", async () => {
      const res = await request(app)
        .get("/api/outreach/mail/eddm/parcels")
        .query({ bbox: "-97,30,-98,31" });
      expect(res.status).toBe(400);
    });

    it("passes acreage filter through to the query builder", async () => {
      lastWhereArgs = null;
      const res = await request(app)
        .get("/api/outreach/mail/eddm/parcels")
        .query({ bbox: "-98.5,26.0,-98.0,26.5", acreageMin: 1, acreageMax: 10 });
      expect(res.status).toBe(200);
      // The where chain captured an `and(...conditions)` arg — we can't
      // introspect drizzle SQL fragments cleanly, but the call should have
      // executed (non-null args).
      expect(lastWhereArgs).not.toBeNull();
    });
  });

  // Nothing-lies wave A (2026-07-29): all carrier-route geometry this surface
  // can produce is synthetic (synthesizeRoutes is the only source), so the
  // queue endpoint must NEVER create a shipment. These tests pin the
  // end-to-end block: a well-formed queue request is rejected with an honest
  // 400 and nothing is written to the database.
  describe("POST /api/outreach/mail/eddm/queue (hard-blocked on demo geometry)", () => {
    it("rejects a well-formed queue request with 400 + honest copy, without touching the DB", async () => {
      dbInsertSpy.mockClear();
      const res = await request(app)
        .post("/api/outreach/mail/eddm/queue")
        .send({
          routeIds: ["TX-hidalgo-R00", "TX-hidalgo-R01"],
          pieceType: "postcard_4x6",
          householdCount: 350,
        });

      expect(res.status).toBe(400);
      // Honest copy: says WHY (demo geometry) and that nothing was queued/charged.
      expect(res.body.message).toMatch(/demo geometry/i);
      expect(res.body.message).toMatch(/nothing was queued/i);
      expect(res.body.message).toMatch(/no credits were charged/i);
      // No shipment / pieces rows were created.
      expect(dbInsertSpy).not.toHaveBeenCalled();
    });

    it("still validates input shape first (422 on malformed body)", async () => {
      dbInsertSpy.mockClear();
      const res = await request(app)
        .post("/api/outreach/mail/eddm/queue")
        .send({ routeIds: [], pieceType: "postcard_4x6", householdCount: 0 });
      expect(res.status).toBe(422);
      expect(dbInsertSpy).not.toHaveBeenCalled();
    });
  });
});
