/**
 * A PATCH changes only what it was sent (real database, real routes).
 *
 * Before 2026-11-05, under Zod 4's `.partial()`, these updates wrote the
 * create-time default over fields the request never mentioned:
 *   - PATCH /api/rehab-line-items/:id with only `spentCents` zeroed the line's
 *     budget and committed amounts (the inline editor saves one cell at a time);
 *   - PATCH /api/rehabs/:id with only `name` reset `status` to "planning";
 *   - PATCH /api/draws/:id with only `notes` reset `status` to "planned".
 * Each assertion below failed on main before the fix.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { realDbAvailable, useRealDb } from "../helpers/realDb";

useRealDb("rehabPatchKeepsUnsentFields.realdb.test.ts");

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/auth", () => ({ isAuthenticated: (_r: unknown, _s: unknown, next: () => void) => next() }));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({ getOrCreateOrg: (_r: unknown, _s: unknown, next: () => void) => next() }));

const tag = `rp-${Math.random().toString(36).slice(2, 10)}`;
let org = 0;
let rehabId = "";
let lineId = "";
let drawId = "";

async function q<T = Record<string, any>>(text: string, ...vals: unknown[]): Promise<T[]> {
  const { pool } = await import("../../server/db");
  return (await pool.query(text, vals)).rows as T[];
}
async function app() {
  const { registerRehabRoutes } = await import("../../server/routes-rehabs");
  const { registerConstructionDrawRoutes } = await import("../../server/routes-construction-draws");
  const a = express();
  a.use(express.json());
  a.use((req: any, _res, next) => {
    req.organization = { id: org };
    req.organizationId = org;
    req.user = { id: `${tag}-u` };
    next();
  });
  registerRehabRoutes(a);
  registerConstructionDrawRoutes(a);
  return a;
}

describe.runIf(realDbAvailable)("a PATCH changes only what it was sent", () => {
  beforeAll(async () => {
    org = (await q<{ id: number }>("INSERT INTO organizations (name, slug, owner_id) VALUES ($1, $1, $1) RETURNING id", tag))[0].id;
    const p = (await q<{ id: number }>("INSERT INTO properties (organization_id, apn, county, state, size_acres, status) VALUES ($1, $2, 'X', 'MA', '1', 'owned') RETURNING id", org, tag))[0].id;
    rehabId = (await q<{ id: string }>("INSERT INTO rehabs (organization_id, property_id, name, status) VALUES ($1, $2, 'R', 'framing') RETURNING id", org, p))[0].id;
    lineId = (await q<{ id: string }>("INSERT INTO rehab_line_items (organization_id, rehab_id, category, scope, budget_cents, committed_cents) VALUES ($1, $2, 'kitchen', 'k', 1500000, 1650000) RETURNING id", org, rehabId))[0].id;
    drawId = (await q<{ id: string }>("INSERT INTO construction_draws (organization_id, rehab_id, sequence, label, pct_of_loan, amount_cents, status) VALUES ($1, $2, 1, 'Draw 1', 0.25, 2500000, 'requested') RETURNING id", org, rehabId))[0].id;
  });

  afterAll(async () => {
    const { pool } = await import("../../server/db");
    if (org) await pool.query("DELETE FROM organizations WHERE id = $1", [org]);
    await pool.end();
  });

  it("saving a line's spent amount leaves its budget and committed amounts alone", async () => {
    await request(await app()).patch(`/api/rehab-line-items/${lineId}`).send({ spentCents: 100 }).expect(200);
    const [row] = await q("SELECT budget_cents, committed_cents, spent_cents FROM rehab_line_items WHERE id = $1", lineId);
    expect(row).toEqual({ budget_cents: "1500000", committed_cents: "1650000", spent_cents: "100" });
  });

  it("renaming a rehab leaves its status alone", async () => {
    await request(await app()).patch(`/api/rehabs/${rehabId}`).send({ name: "Renamed" }).expect(200);
    const [row] = await q("SELECT name, status FROM rehabs WHERE id = $1", rehabId);
    expect(row).toEqual({ name: "Renamed", status: "framing" });
  });

  it("noting a draw leaves its status alone", async () => {
    const res = await request(await app()).patch(`/api/draws/${drawId}`).send({ notes: "inspector booked" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const [row] = await q("SELECT status, notes FROM construction_draws WHERE id = $1", drawId);
    expect(row).toEqual({ status: "requested", notes: "inspector booked" });
  });
});
