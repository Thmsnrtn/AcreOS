/**
 * L-DEF-2 — closing an acquisition deal marks the parcel held.
 *
 * Land journey walk 2026-11-18, Leg 6: deal 7 (acquisition, property 1028)
 * walked to `closed`, but the property stayed `prospect` and listing create
 * refused it as "not held" until the operator separately PUT the property
 * to `owned`. The cure lives in dealRepo — the seam every deal status write
 * passes through — as ONE conditional UPDATE: org-scoped, restricted to the
 * pre-held property statuses (prospect / due_diligence / offer_sent /
 * under_contract), so a property already owned / listed / sold is never
 * overwritten and another org's parcel can never match.
 *
 * These tests pin, against the REAL dealRepo write paths with a scripted
 * db mock (the dealRepo.lifecycle.test.ts pattern):
 *  - acquisition close → property update to `owned`, org + property scoped,
 *    restricted to the pre-held statuses in the WHERE clause itself
 *  - disposition close → no property write
 *  - non-close transitions and closed→closed no-ops → no property write
 *  - a property write that matches no row (already owned / listed / sold)
 *    leaves the deal close — and the property — exactly as they were
 *  - a failing property write never fails the deal close
 *  - bulk close follows the same rule, per deal
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── DB mock: scripted per-operation queues + recorded update calls ─────────
const SELECT_QUEUE: any[][] = [];
const UPDATE_RETURNING: any[][] = [];
const UPDATE_CALLS: Array<{ table: unknown; set: any; where: unknown }> = [];
let UPDATE_FAIL_ON_CALL = 0; // 1-based index into UPDATE_CALLS to fail; 0 = never
vi.mock("../db", () => ({
  db: {
    select: (_p?: unknown) => ({
      from: (_t: unknown) => ({
        where: (_w: unknown) => Promise.resolve(SELECT_QUEUE.shift() ?? []),
      }),
    }),
    update: (table: unknown) => ({
      set: (v: unknown) => ({
        where: (w: unknown) => {
          UPDATE_CALLS.push({ table, set: v, where: w });
          if (UPDATE_FAIL_ON_CALL === UPDATE_CALLS.length) {
            const err = new Error("property write failed");
            return {
              returning: () => Promise.reject(err),
              then: (res: any, rej: any) => Promise.reject(err).then(res, rej),
            };
          }
          const rows = UPDATE_RETURNING.shift() ?? [];
          return {
            returning: () => Promise.resolve(rows),
            then: (res: any, rej: any) => Promise.resolve(rows).then(res, rej),
          };
        },
      }),
    }),
  },
}));

// dealLifecycleEvents is real; only the mesh publisher underneath is mocked.
vi.mock("../services/eventMeshPublisher", () => {
  const record = async () => {};
  return {
    eventMeshPublisher: {
      dealDiscovered: record,
      dealUpdated: record,
      dealClosed: record,
    },
  };
});

import { properties } from "@shared/schema";
import { dealRepo } from "./dealRepo";

// The pre-held statuses the transition may fire from (dealRepo keeps the
// list unexported; the WHERE-clause assertions below pin it by value).
const PRE_HELD_PROPERTY_STATUSES = ["prospect", "due_diligence", "offer_sent", "under_contract"];

const storageThis = {} as any;

/** Primitive values bound into a drizzle WHERE clause (params, not SQL text). */
function boundValues(where: unknown): unknown[] {
  const vals: unknown[] = [];
  const seen = new WeakSet<object>();
  const walk = (n: unknown, depth: number): void => {
    if (n === null || n === undefined || depth > 8) return;
    if (typeof n === "string" || typeof n === "number") {
      vals.push(n);
      return;
    }
    if (typeof n !== "object") return;
    if (seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) {
      n.forEach((c) => walk(c, depth + 1));
      return;
    }
    const name = (n as any).constructor?.name ?? "";
    if (name === "Table" || /Column/.test(name) || name.startsWith("Pg")) return;
    for (const k of Object.keys(n as object)) walk((n as any)[k], depth + 1);
  };
  walk(where, 0);
  return vals;
}

const propertyUpdates = () => UPDATE_CALLS.filter((c) => c.table === properties);

beforeEach(() => {
  SELECT_QUEUE.length = 0;
  UPDATE_RETURNING.length = 0;
  UPDATE_CALLS.length = 0;
  UPDATE_FAIL_ON_CALL = 0;
  vi.clearAllMocks();
});

describe("updateDeal — L-DEF-2 acquisition close → property owned", () => {
  it("transitions the parcel to owned, scoped to the deal's org and restricted to pre-held statuses", async () => {
    SELECT_QUEUE.push([{ status: "in_escrow", propertyId: 1028 }]); // pre-image
    UPDATE_RETURNING.push([{ id: 7, organizationId: 108, type: "acquisition", status: "closed", propertyId: 1028 }]); // deal update
    UPDATE_RETURNING.push([{ id: 1028 }]); // property update matched a row

    const deal = await dealRepo.updateDeal.call(storageThis, 7, { status: "closed" }, undefined, 108);
    expect(deal.status).toBe("closed");

    const writes = propertyUpdates();
    expect(writes).toHaveLength(1);
    expect(writes[0].set.status).toBe("owned");
    const bound = boundValues(writes[0].where);
    // Org isolation + exact parcel: both ids are bound into the WHERE.
    expect(bound).toContain(108);
    expect(bound).toContain(1028);
    // The transition may only fire from a pre-held status — a property
    // already owned / listed / sold matches no row and keeps its status.
    for (const s of PRE_HELD_PROPERTY_STATUSES) expect(bound).toContain(s);
    expect(bound).not.toContain("listed");
    expect(bound).not.toContain("sold");
  });

  it("does NOT touch the property when a DISPOSITION deal closes", async () => {
    SELECT_QUEUE.push([{ status: "in_escrow", propertyId: 1028 }]);
    UPDATE_RETURNING.push([{ id: 8, organizationId: 108, type: "disposition", status: "closed", propertyId: 1028 }]);

    await dealRepo.updateDeal.call(storageThis, 8, { status: "closed" }, undefined, 108);
    expect(propertyUpdates()).toHaveLength(0);
  });

  it("does NOT touch the property on a non-close acquisition transition", async () => {
    SELECT_QUEUE.push([{ status: "negotiating", propertyId: 1028 }]);
    UPDATE_RETURNING.push([{ id: 7, organizationId: 108, type: "acquisition", status: "offer_sent", propertyId: 1028 }]);

    await dealRepo.updateDeal.call(storageThis, 7, { status: "offer_sent" }, undefined, 108);
    expect(propertyUpdates()).toHaveLength(0);
  });

  it("does NOT re-fire on a closed→closed no-op update", async () => {
    SELECT_QUEUE.push([{ status: "closed", propertyId: 1028 }]);
    UPDATE_RETURNING.push([{ id: 7, organizationId: 108, type: "acquisition", status: "closed", propertyId: 1028 }]);

    await dealRepo.updateDeal.call(storageThis, 7, { status: "closed" }, undefined, 108);
    expect(propertyUpdates()).toHaveLength(0);
  });

  it("a property already past held (owned / listed / sold) matches no row and is left alone", async () => {
    SELECT_QUEUE.push([{ status: "in_escrow", propertyId: 1028 }]);
    UPDATE_RETURNING.push([{ id: 7, organizationId: 108, type: "acquisition", status: "closed", propertyId: 1028 }]);
    UPDATE_RETURNING.push([]); // WHERE matched nothing — parcel already owned/listed/sold

    const deal = await dealRepo.updateDeal.call(storageThis, 7, { status: "closed" }, undefined, 108);
    expect(deal.status).toBe("closed");
    // The write was attempted with the pre-held restriction (proven by the
    // bound values in the first test); the database's answer — no row —
    // is the sane outcome, and nothing else is written.
    expect(propertyUpdates()).toHaveLength(1);
    expect(UPDATE_CALLS).toHaveLength(2);
  });

  it("a failing property write never fails the deal close", async () => {
    SELECT_QUEUE.push([{ status: "in_escrow", propertyId: 1028 }]);
    UPDATE_RETURNING.push([{ id: 7, organizationId: 108, type: "acquisition", status: "closed", propertyId: 1028 }]);
    UPDATE_FAIL_ON_CALL = 2; // the deal update is call 1; the property update is call 2

    const deal = await dealRepo.updateDeal.call(storageThis, 7, { status: "closed" }, undefined, 108);
    expect(deal.status).toBe("closed");
    expect(propertyUpdates()).toHaveLength(1); // attempted, failed, logged — not thrown
  });
});

describe("bulkUpdateDeals — L-DEF-2 bulk close", () => {
  it("marks owned only for the acquisition deal, not the disposition beside it", async () => {
    SELECT_QUEUE.push([
      { id: 1, status: "in_escrow", acceptedAmount: null, offerAmount: null, propertyId: 201, type: "acquisition" },
      { id: 2, status: "in_escrow", acceptedAmount: null, offerAmount: null, propertyId: 202, type: "disposition" },
    ]);
    UPDATE_RETURNING.push([]); // the bulk deals update itself
    UPDATE_RETURNING.push([{ id: 201 }]); // the one property transition

    const n = await dealRepo.bulkUpdateDeals.call(storageThis, 42, [1, 2], { status: "closed" });
    expect(n).toBe(2);

    const writes = propertyUpdates();
    expect(writes).toHaveLength(1);
    expect(writes[0].set.status).toBe("owned");
    const bound = boundValues(writes[0].where);
    expect(bound).toContain(42);
    expect(bound).toContain(201);
    expect(bound).not.toContain(202);
  });
});
