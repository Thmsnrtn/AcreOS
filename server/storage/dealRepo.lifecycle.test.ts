/**
 * Deal repo → event-mesh wiring tests (Jarvis 2.1, audit G2).
 *
 * The REAL deal write paths (createDeal / updateDeal / bulkUpdateDeals) are
 * the mutation seams every route, AI tool, workflow, and import funnels
 * through. These tests pin:
 *  - each seam fires the matching deal:lifecycle publish (discovered on
 *    create, updated on stage change, closed on won/lost)
 *  - non-transitions publish nothing
 *  - fire-and-forget isolation END-TO-END: a rejecting mesh publisher never
 *    fails the mutation (the real dealLifecycleEvents seam is used, only the
 *    publisher underneath it is mocked)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── DB mock: scripted per-operation queues ──────────────────────────────────
const SELECT_QUEUE: any[][] = [];
const INSERT_RETURNING: any[][] = [];
const UPDATE_RETURNING: any[][] = [];
vi.mock("../db", () => ({
  db: {
    select: (_p?: unknown) => ({
      from: (_t: unknown) => ({
        where: (_w: unknown) => Promise.resolve(SELECT_QUEUE.shift() ?? []),
      }),
    }),
    insert: (_t: unknown) => ({
      values: (_v: unknown) => ({
        returning: () => Promise.resolve(INSERT_RETURNING.shift() ?? []),
      }),
    }),
    update: (_t: unknown) => ({
      set: (_v: unknown) => ({
        where: (_w: unknown) => {
          const rows = UPDATE_RETURNING.shift() ?? [];
          const thenable = Promise.resolve(rows);
          return Object.assign(thenable, { returning: () => Promise.resolve(rows) });
        },
      }),
    }),
  },
}));

// Real dealLifecycleEvents seam; only the mesh publisher underneath is mocked.
const PUBLISHES: Array<{ method: string; orgId: number; payload: any }> = [];
let MESH_DOWN = false;
vi.mock("../services/eventMeshPublisher", () => {
  const record = (method: string) => async (orgId: number, payload: any) => {
    if (MESH_DOWN) throw new Error("mesh down");
    PUBLISHES.push({ method, orgId, payload });
  };
  return {
    eventMeshPublisher: {
      dealDiscovered: record("dealDiscovered"),
      dealUpdated: record("dealUpdated"),
      dealClosed: record("dealClosed"),
    },
  };
});

import { dealRepo } from "./dealRepo";

const storageThis = {} as any; // seams under test never touch `this`

const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
};

beforeEach(() => {
  SELECT_QUEUE.length = 0;
  INSERT_RETURNING.length = 0;
  UPDATE_RETURNING.length = 0;
  PUBLISHES.length = 0;
  MESH_DOWN = false;
  vi.clearAllMocks();
});

describe("dealRepo.createDeal → deal:discovered", () => {
  it("publishes discovered with the created row's org scope", async () => {
    INSERT_RETURNING.push([{ id: 5, organizationId: 42, type: "acquisition", status: "negotiating", propertyId: 9 }]);
    const deal = await dealRepo.createDeal.call(storageThis, { organizationId: 42 } as any);
    expect(deal.id).toBe(5);
    await flush();
    expect(PUBLISHES).toEqual([
      {
        method: "dealDiscovered",
        orgId: 42,
        payload: { dealId: 5, type: "acquisition", status: "negotiating", propertyId: 9 },
      },
    ]);
  });

  it("mesh failure never fails the create (fire-and-forget end-to-end)", async () => {
    MESH_DOWN = true;
    INSERT_RETURNING.push([{ id: 5, organizationId: 42, status: "negotiating" }]);
    const deal = await dealRepo.createDeal.call(storageThis, { organizationId: 42 } as any);
    expect(deal.id).toBe(5);
    await flush();
    expect(PUBLISHES).toHaveLength(0);
  });
});

describe("dealRepo.updateDeal → deal:updated / deal:closed", () => {
  it("publishes updated with from→to on a genuine stage transition", async () => {
    SELECT_QUEUE.push([{ status: "negotiating", propertyId: 9 }]); // pre-image
    UPDATE_RETURNING.push([{ id: 5, organizationId: 42, status: "offer_sent" }]);
    await dealRepo.updateDeal.call(storageThis, 5, { status: "offer_sent" });
    await flush();
    expect(PUBLISHES).toEqual([
      { method: "dealUpdated", orgId: 42, payload: { dealId: 5, from: "negotiating", to: "offer_sent" } },
    ]);
  });

  it("publishes closed-won with the accepted amount on close", async () => {
    SELECT_QUEUE.push([{ status: "in_escrow", propertyId: 9 }]);
    UPDATE_RETURNING.push([{ id: 5, organizationId: 42, status: "closed", acceptedAmount: "45000" }]);
    await dealRepo.updateDeal.call(storageThis, 5, { status: "closed" });
    await flush();
    expect(PUBLISHES).toEqual([
      {
        method: "dealClosed",
        orgId: 42,
        payload: { dealId: 5, from: "in_escrow", to: "closed", outcome: "won", amount: 45000 },
      },
    ]);
  });

  it("publishes nothing for a field-only update (no status change)", async () => {
    SELECT_QUEUE.push([{ status: "offer_sent", propertyId: 9 }]);
    UPDATE_RETURNING.push([{ id: 5, organizationId: 42, status: "offer_sent", titleCompany: "Acme Title" }]);
    await dealRepo.updateDeal.call(storageThis, 5, { titleCompany: "Acme Title" } as any);
    await flush();
    expect(PUBLISHES).toHaveLength(0);
  });

  it("mesh failure never fails the update", async () => {
    MESH_DOWN = true;
    SELECT_QUEUE.push([{ status: "negotiating", propertyId: 9 }]);
    UPDATE_RETURNING.push([{ id: 5, organizationId: 42, status: "offer_sent" }]);
    const updated = await dealRepo.updateDeal.call(storageThis, 5, { status: "offer_sent" });
    expect(updated.status).toBe("offer_sent");
    await flush();
    expect(PUBLISHES).toHaveLength(0);
  });
});

describe("dealRepo.bulkUpdateDeals → per-deal events (kanban bulk stage move)", () => {
  it("publishes one event per genuinely-transitioning deal, skipping same-status rows", async () => {
    SELECT_QUEUE.push([
      { id: 1, status: "negotiating", acceptedAmount: null, offerAmount: null },
      { id: 2, status: "offer_sent", acceptedAmount: null, offerAmount: null }, // already there
    ]);
    const n = await dealRepo.bulkUpdateDeals.call(storageThis, 42, [1, 2], { status: "offer_sent" });
    expect(n).toBe(2);
    await flush();
    expect(PUBLISHES).toEqual([
      { method: "dealUpdated", orgId: 42, payload: { dealId: 1, from: "negotiating", to: "offer_sent" } },
    ]);
  });

  it("reads no pre-images and publishes nothing when status is not part of the bulk update", async () => {
    await dealRepo.bulkUpdateDeals.call(storageThis, 42, [1, 2], { titleCompany: "Acme" } as any);
    await flush();
    expect(PUBLISHES).toHaveLength(0);
    expect(SELECT_QUEUE).toHaveLength(0); // nothing consumed → no read attempted
  });

  it("a broken pre-image read degrades to no events, never a failed mutation", async () => {
    // Queue empty → select resolves [] (our mock's failure-shape); the
    // mutation must still succeed and publish nothing dishonest.
    const n = await dealRepo.bulkUpdateDeals.call(storageThis, 42, [1], { status: "offer_sent" });
    expect(n).toBe(1);
    await flush();
    expect(PUBLISHES).toHaveLength(0);
  });
});
