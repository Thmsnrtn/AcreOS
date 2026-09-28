/**
 * DEFECT-0137 — the getting-started checklist is completed by the customer's
 * work, not by the sample book.
 *
 * GET /api/onboarding/checklist-status says "items complete by the user
 * actually doing the work", and counted every lead and deal in the org —
 * including the rows "Try with sample data" seeds. One click ticked "add a
 * lead" and "open a deal" for a customer who had done neither. This drives
 * the real handler and renders each query's WHERE with the Postgres dialect.
 */
import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { PgDialect } from "drizzle-orm/pg-core";
import { getTableName, type SQL } from "drizzle-orm";

const h = vi.hoisted(() => ({ wheres: [] as Array<{ table: string; where: unknown }> }));

vi.mock("../../server/storage", () => {
  const select = () => {
    const q: Record<string, unknown> = {};
    let table = "";
    q.from = (t: unknown) => {
      table = getTableName(t as never);
      return q;
    };
    q.where = (w: unknown) => {
      h.wheres.push({ table, where: w });
      return Promise.resolve([{ count: 0 }]);
    };
    return q;
  };
  return { db: { select }, storage: {} };
});
vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import router from "../../server/routes-onboarding";

const dialect = new PgDialect();
const render = (w: unknown) => {
  const q = dialect.sqlToQuery(w as SQL);
  return { sql: q.sql, params: q.params };
};

async function run() {
  h.wheres.length = 0;
  const app = express();
  app.use((req, _res, next) => {
    (req as unknown as { organization: { id: number } }).organization = { id: 7 };
    next();
  });
  app.use("/api/onboarding", router);
  const res = await request(app).get("/api/onboarding/checklist-status");
  expect(res.status).toBe(200);
  return h.wheres;
}

describe("DEFECT-0137 — sample data does not complete the checklist", () => {
  it("the lead signal excludes seeded sample leads", async () => {
    const wheres = await run();
    const leadQueries = wheres.filter((w) => w.table === "leads").map((w) => render(w.where));
    expect(leadQueries.length).toBeGreaterThan(0);
    const hasLead = leadQueries[0];
    expect(hasLead.sql).toMatch(/NOT IN/);
    expect(hasLead.params).toContain("sample_data");
  });

  it("the deal signal excludes deals on sample properties", async () => {
    const wheres = await run();
    const deal = wheres.filter((w) => w.table === "deals").map((w) => render(w.where));
    expect(deal).toHaveLength(1);
    expect(deal[0].sql).toMatch(/NOT EXISTS/);
    expect(deal[0].params).toContain("SAMPLE-%");
  });

  it("the parcel-lookup signal excludes sample properties", async () => {
    const wheres = await run();
    const prop = wheres.filter((w) => w.table === "properties").map((w) => render(w.where));
    expect(prop).toHaveLength(1);
    expect(prop[0].params).toContain("SAMPLE-%");
  });
});
