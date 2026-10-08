/**
 * Enrichment on a record that cannot be enriched answers 4xx, never 500 — and
 * never with a fabricated location.
 *
 * `enrichProperty` threw a plain Error("Property missing coordinates"), which
 * every caller funnelled through Errors.internal: POST /api/properties/:id/enrich
 * answered 500 ("our bug") for a parcel that simply has no lat/lng. One such
 * parcel in POST /api/properties/bulk-enrich 500'd the whole batch.
 *
 * Population — every route that calls enrichProperty() and answers HTTP:
 *   POST /api/properties/:id/enrich         (routes-property-enrichment.ts)
 *   GET  /api/properties/:id/enrichment     (routes-property-enrichment.ts)
 *   POST /api/properties/bulk-enrich        (routes-property-enrichment.ts)
 *   POST /api/broker/enrich-property        (routes-admin.ts)
 * The last test enumerates the call sites so a new one shows up here.
 *
 * And POST /api/leads/bulk-enrich passes the organization first to the
 * org-first `enrichLead`, whose read and write are both scoped by it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { stripComments } from "../helpers/stripComments";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const h = vi.hoisted(() => ({
  property: null as null | Record<string, unknown>,
  brokerCalls: 0,
  leadWheres: [] as unknown[],
  leadUpdateWheres: [] as unknown[],
}));

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/storage", () => ({
  storage: { getProperty: async (_org: number, id: number) => (h.property && h.property.id === id ? h.property : undefined) },
  db: {},
}));
vi.mock("../../server/db", () => {
  const select = () => {
    const q: Record<string, unknown> = {};
    q.from = () => q;
    q.where = (w: unknown) => {
      h.leadWheres.push(w);
      const rows = Promise.resolve([{ id: 42, organizationId: 7, email: null, phone: null, address: null, enrichmentData: null }]);
      // The GET /enrichment route reads the property row with .limit(1).
      return Object.assign(rows, { limit: async () => (h.property ? [h.property] : []) });
    };
    return q;
  };
  const update = () => ({
    set: () => ({
      where: (w: unknown) => {
        h.leadUpdateWheres.push(w);
        return Promise.resolve();
      },
    }),
  });
  return { db: { select, update } };
});
vi.mock("../../server/services/data-source-broker", () => ({
  dataSourceBroker: {
    lookup: async () => {
      h.brokerCalls += 1;
      return { success: false, data: null };
    },
  },
}));

beforeEach(() => {
  h.property = null;
  h.brokerCalls = 0;
  h.leadWheres.length = 0;
  h.leadUpdateWheres.length = 0;
});

async function app() {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    (req as unknown as { organization: unknown }).organization = { id: 7 };
    next();
  });
  const { default: router } = await import("../../server/routes-property-enrichment");
  a.use("/api/properties", router);
  return a;
}

describe("property enrichment without coordinates", () => {
  it("POST /api/properties/:id/enrich → 422 naming what is missing; no provider is called", async () => {
    h.property = { id: 5, organizationId: 7, latitude: null, longitude: null, enrichedAt: null };
    const res = await request(await app()).post("/api/properties/5/enrich");
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: "UNPROCESSABLE", statusCode: 422 });
    expect(res.body.message).toMatch(/no coordinates/i);
    expect(res.body.details).toMatchObject({ reason: "missing_coordinates", propertyId: 5 });
    expect(h.brokerCalls).toBe(0);
  });

  it("GET /api/properties/:id/enrichment → 422 too", async () => {
    h.property = { id: 5, organizationId: 7, latitude: "", longitude: "", enrichedAt: null };
    const res = await request(await app()).get("/api/properties/5/enrichment");
    expect(res.status).toBe(422);
  });

  it("an unknown property → 404, not 500", async () => {
    const res = await request(await app()).post("/api/properties/999/enrich");
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "NOT_FOUND", statusCode: 404 });
  });

  it("bulk: a record without coordinates is reported as skipped; it does not 500 the batch", async () => {
    h.property = { id: 5, organizationId: 7, latitude: null, longitude: null, enrichedAt: null };
    const res = await request(await app()).post("/api/properties/bulk-enrich").send({ propertyIds: [5, 999] });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
    expect(res.body.skipped).toEqual([
      expect.objectContaining({ propertyId: 5, reason: "missing_coordinates" }),
      expect.objectContaining({ propertyId: 999, reason: "not_found" }),
    ]);
  });

  it("every HTTP caller of enrichProperty maps the refusal (population of call sites)", () => {
    const root = resolve(__dirname, "../../server");
    const files: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.ts$/.test(n) && !/\.test\.ts$/.test(n)) files.push(p);
      }
    };
    walk(root);
    const routeCallers = files.filter((f) => {
      const src = stripComments(readFileSync(f, "utf8"));
      return /propertyEnrichmentService\.enrichProperty\(/.test(src) && /\.(get|post|put|patch)\(\s*["']/.test(src);
    });
    const names = routeCallers.map((f) => f.slice(root.length + 1)).sort();
    // routes-deals.ts calls it only from a background helper that writes a
    // failed status, never an HTTP response.
    expect(names).toEqual(["routes-admin.ts", "routes-deals.ts", "routes-property-enrichment.ts"]);
    for (const f of routeCallers.filter((x) => !x.endsWith("routes-deals.ts"))) {
      expect(stripComments(readFileSync(f, "utf8")), f).toMatch(/respondToEnrichmentRefusal\(res, err\)|enrichmentRefusalOf\(err\)/);
    }
  });
});

describe("POST /api/leads/bulk-enrich reads and writes the caller's own leads", () => {
  it("looks up lead #id IN the caller's org, and the update is org-scoped too", async () => {
    const { batchEnrichLeads } = await import("../../server/services/leadEnrichment");
    await batchEnrichLeads([42], 7);
    const dialect = new PgDialect();
    const read = dialect.sqlToQuery(h.leadWheres[0] as SQL);
    // Bind each column to its parameter, so a swap cannot pass by both values
    // merely being present.
    const bound = (q: { sql: string; params: unknown[] }, col: string) => {
      const m = new RegExp(`"${col}" = \\$(\\d+)`).exec(q.sql);
      return m ? q.params[Number(m[1]) - 1] : undefined;
    };
    expect(bound(read, "id")).toBe(42);
    expect(bound(read, "organization_id")).toBe(7);
    const write = dialect.sqlToQuery(h.leadUpdateWheres[0] as SQL);
    expect(bound(write, "id")).toBe(42);
    expect(bound(write, "organization_id")).toBe(7);
  });
});
