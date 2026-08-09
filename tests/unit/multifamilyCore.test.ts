/**
 * MULTIFAMILY IS CORE — and core is BACKED BY WIRED CAPABILITY (Wave 3).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * A maturity flag is cheap; the honesty is in whether the capability behind it
 * actually ships. This is the light gate that binds the "core" flag to the three
 * things that made the flip honest, so a future edit that removes any of them
 * (or flips the flag back) trips a test rather than shipping a lie:
 *
 *   1. MEASURED operating expenses — the per-building NOI route summarises the
 *      property_expenses ledger (summarizeMeasuredOpEx), not a flat guess.
 *   2. PER-BUILDING occupancy — snapshotForProperty returns an occupancy block
 *      computed by computeOccupancySnapshot.
 *   3. The T-12 UNDERWRITING WORKSPACE — the pure grid (shared/rental/t12.ts),
 *      the GET /api/properties/:id/t12 route, and the T-12 tab on /leases.
 *
 * And that the flip did NOT reach for the residential-comps / market-rent data
 * plane, which stays behind its revenue trigger (a standing hard-stop): the T-12
 * income axis is rent RECEIVED (rent_payments) and its expense axis is
 * property_expenses — no comps, no market rent.
 *
 * These are source-shape assertions because the routes are DB-backed and there
 * is no DATABASE_URL here; the pure grid's behaviour is exercised in
 * t12Workspace.test.ts.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

import { getBusinessType } from "../../shared/business-types";
import { buildT12Grid, T12_MONTHS } from "../../shared/rental/t12";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.resolve(ROOT, p), "utf-8");

const INV = read("server/routes-investor-analytics.ts");
const LEASES = read("client/src/pages/leases.tsx");
const T12WS = read("client/src/components/rentals/t12-workspace.tsx");

/** The body of the T-12 helper, sliced out so the axis assertions are scoped. */
const t12Body = INV.slice(
  INV.indexOf("async function t12ForProperty"),
  INV.indexOf("export function registerInvestorAnalyticsRoutes"),
);

describe("multifamily is core", () => {
  it("the registry entry reads core", () => {
    expect(getBusinessType("multifamily")?.maturity).toBe("core");
  });
});

describe("core capability 1 — measured operating expenses are wired", () => {
  it("the per-building NOI route summarises the property_expenses ledger", () => {
    expect(INV).toContain("summarizeMeasuredOpEx");
    expect(INV).toContain("from(propertyExpenses)");
  });
});

describe("core capability 2 — per-building occupancy is wired", () => {
  it("snapshotForProperty computes and returns a per-building occupancy block", () => {
    expect(INV).toContain("computeOccupancySnapshot({");
    expect(INV).toMatch(/propertyCount: 1,/);
    expect(INV).toMatch(/\n\s*occupancy,\n/);
  });
});

describe("core capability 3 — the T-12 workspace is wired end to end", () => {
  it("the pure grid returns exactly twelve zero-filled rows", () => {
    const grid = buildT12Grid([], [], "2026-01");
    expect(grid).toHaveLength(T12_MONTHS);
    expect(grid.every((r) => r.incomeCents === 0 && r.operatingExpenseCents === 0 && r.noiCents === 0)).toBe(true);
  });

  it("the route is registered and feeds the pure grid", () => {
    expect(INV).toContain('"/api/properties/:id/t12"');
    expect(INV).toContain("buildT12Grid(");
  });

  it("the /leases page mounts the T-12 tab behind the Rentals module (no new nav)", () => {
    expect(LEASES).toContain("T12Workspace");
    expect(LEASES).toContain('value="t12"');
    expect(LEASES).toContain('data-testid="tab-t12"');
  });

  it("the workspace scrolls the wide grid inside its own container", () => {
    expect(T12WS).toContain("overflow-x-auto");
    expect(T12WS).toContain("/t12");
  });
});

describe("the flip did NOT touch the residential-comps / market-rent data plane", () => {
  it("the T-12 axes are rent received + property_expenses only — no comps, no market rent", () => {
    expect(t12Body).toContain("rentPayments");
    expect(t12Body).toContain("propertyExpenses");
    // No residential-comps / market-rent plane pulled into the underwriting grid.
    expect(t12Body).not.toContain("residentialComps");
    expect(t12Body).not.toContain("marketRent");
    expect(t12Body).not.toContain("comps");
  });
});
