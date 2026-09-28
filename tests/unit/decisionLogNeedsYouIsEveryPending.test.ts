/**
 * DEFECT-0167 — the Decisions door's "needs you" is every pending decision.
 *
 * GET /api/founder/intelligence/decision-log bucketed the newest `limit` rows
 * created in the last `days` (the page asked for 30 days / 300 rows). A
 * pending decision older than the window — or pushed out by newer resolved
 * rows — silently left the founder's queue while it still waited, and the
 * "needs you" count was that partial list's length. The page rendered a
 * failed read as the bucket's empty text.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stripComments } from "../helpers/stripComments";

const h = vi.hoisted(() => ({
  wheres: [] as unknown[],
  results: [] as unknown[][],
}));

vi.mock("../../server/db", () => {
  const select = () => {
    const q: Record<string, unknown> = {};
    let where: unknown;
    q.from = () => q;
    q.where = (w: unknown) => {
      where = w;
      h.wheres.push(w);
      return q;
    };
    q.orderBy = () => q;
    q.limit = async () => {
      const idx = h.wheres.indexOf(where);
      return h.results[idx] ?? [];
    };
    return q;
  };
  return { db: { select } };
});
vi.mock("../../server/services/founder", async (orig) => ({
  ...(await orig<object>()),
  isFounderIdentity: () => true,
}));
vi.mock("../../server/services/autopilot/needsYou", () => ({ countPendingDecisions: async () => 120 }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import router from "../../server/routes-founder-intelligence";

const app = express();
app.use((req, _res, next) => {
  (req as unknown as { user: unknown }).user = { id: "founder", email: "f@example.com" };
  next();
});
app.use("/api/founder/intelligence", router);

const render = (w: unknown) => new PgDialect().sqlToQuery(w as SQL);

beforeEach(() => {
  h.wheres.length = 0;
  h.results = [
    [{ id: 1, status: "pending", createdAt: new Date("2026-01-01") }], // pending, 9 months old
    [{ id: 2, status: "approved", resolvedBy: "founder" }],
  ];
});

describe("DEFECT-0167 — decision-log", () => {
  it("reads pending decisions with NO age window, and the count is every pending one", async () => {
    const res = await request(app).get("/api/founder/intelligence/decision-log?days=30&limit=300");
    expect(res.status).toBe(200);
    const pendingWhere = render(h.wheres[0]);
    expect(pendingWhere.params).toContain("pending");
    expect(pendingWhere.sql).not.toMatch(/created_at/);
    expect(res.body.buckets.needsYou.map((r: { id: number }) => r.id)).toEqual([1]);
    expect(res.body.summary.needsYou).toBe(120);
  });

  it("the windowed history excludes pending rows (no double count)", async () => {
    await request(app).get("/api/founder/intelligence/decision-log");
    const history = render(h.wheres[1]);
    expect(history.sql).toMatch(/created_at/);
    expect(history.sql).toMatch(/<>/);
  });

  it("a non-numeric window does not reach SQL as NaN", async () => {
    const res = await request(app).get("/api/founder/intelligence/decision-log?days=abc&limit=xyz");
    expect(res.status).toBe(200);
    expect(res.body.windowDays).toBe(30);
  });

  it("the Decisions page renders a failed read as an error, not an empty queue", () => {
    const page = stripComments(readFileSync(resolve(__dirname, "../../client/src/pages/founder-decisions.tsx"), "utf8"));
    expect(page).toMatch(/isError: logFailed/);
    expect(page).toMatch(/testId="decision-log-error"/);
  });
});
