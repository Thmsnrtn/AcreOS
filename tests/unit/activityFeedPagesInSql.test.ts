/**
 * DEFECT-0162 — the activity feed filters and pages in SQL.
 *
 * GET /api/activity read limit+offset rows of ANY type and filtered in JS, so
 * the Payments / Communications tabs searched only the newest 50 events, and
 * `hasMore: events.length > offset + limit` could never be true — "Load more"
 * never appeared. The page read the response with no ok check, so a 500 also
 * said "No activity recorded yet".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stripComments } from "../helpers/stripComments";

const h = vi.hoisted(() => ({ wheres: [] as unknown[], pageRows: [] as unknown[], total: 0, limit: 0 }));

vi.mock("../../server/storage", () => {
  const select = (proj?: Record<string, unknown>) => {
    const isCount = !!proj && "total" in proj;
    const q: Record<string, unknown> = {};
    q.from = () => q;
    q.where = (w: unknown) => { h.wheres.push(w); return isCount ? Promise.resolve([{ total: h.total }]) : q; };
    q.orderBy = () => q;
    q.limit = (n: number) => { h.limit = n; return q; };
    q.offset = async () => h.pageRows;
    return q;
  };
  return { db: { select }, storage: {} };
});
vi.mock("../../server/auth", () => ({ isAuthenticated: (_r: unknown, _s: unknown, n: () => void) => n() }));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: { organization?: { id: number } }, _s: unknown, n: () => void) => { req.organization = { id: 7 }; n(); },
}));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { registerCRMExtrasRoutes } from "../../server/routes-crm-extras";

const app = express();
app.use(express.json());
registerCRMExtrasRoutes(app);

beforeEach(() => {
  h.wheres.length = 0;
  h.pageRows = [];
  h.total = 0;
});

describe("DEFECT-0162 — GET /api/activity", () => {
  it("filters by event type in SQL, org-scoped", async () => {
    await request(app).get("/api/activity?limit=10&eventTypes=payment_received");
    const q = new PgDialect().sqlToQuery(h.wheres[0] as SQL);
    expect(q.sql).toMatch(/"organization_id" = \$1/);
    expect(q.params).toContain(7);
    expect(q.params).toContain("payment_received");
  });

  it("says there is more when a full page plus one came back", async () => {
    h.pageRows = Array.from({ length: 11 }, (_, i) => ({ id: i }));
    h.total = 40;
    const res = await request(app).get("/api/activity?limit=10");
    expect(res.status).toBe(200);
    expect(h.limit).toBe(11);
    expect(res.body.events).toHaveLength(10);
    expect(res.body.hasMore).toBe(true);
    expect(res.body.total).toBe(40);
  });

  it("clamps a negative limit/offset and accepts a repeated eventTypes param", async () => {
    const neg = await request(app).get("/api/activity?limit=-5&offset=-3");
    expect(neg.status).toBe(200);
    expect(h.limit).toBe(2); // limit clamped to 1, +1 probe row
    h.wheres.length = 0;
    const rep = await request(app).get("/api/activity?eventTypes=payment_received&eventTypes=note_created");
    expect(rep.status).toBe(200);
    const q = new PgDialect().sqlToQuery(h.wheres[0] as SQL);
    expect(q.params).toEqual(expect.arrayContaining(["payment_received", "note_created"]));
  });

  it("the page throws on a failed read instead of rendering an empty feed", () => {
    const page = stripComments(readFileSync(resolve(__dirname, "../../client/src/pages/activity.tsx"), "utf8"));
    const at = page.indexOf('queryKey: ["/api/activity"');
    expect(page.slice(at, at + 500)).toMatch(/okOrThrow\(/);
  });

  it("'Load more' appends a page rather than replacing the first", () => {
    const page = stripComments(readFileSync(resolve(__dirname, "../../client/src/pages/activity.tsx"), "utf8"));
    const at = page.indexOf('queryKey: ["/api/activity"');
    expect(at).toBeGreaterThan(-1);
    // One infinite query, not a query keyed on the offset.
    expect(page.slice(at - 80, at)).toMatch(/useInfiniteQuery\(/);
    expect(page.slice(at, at + 60)).not.toMatch(/offset/);
    expect(page).toMatch(/pages\.flatMap\(\(p\) => p\.events\)/);
  });
});
