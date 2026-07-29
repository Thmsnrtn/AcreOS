/**
 * Wave B "Wire the engine" — proof that deal + property workflow triggers
 * actually fire, and that they DON'T fire when nothing happened.
 *
 * `emitDealEvent` / `emitPropertyEvent` shipped with the workflow engine and
 * had zero call sites, so every deal-stage and property automation a customer
 * installed sat idle. These tests pin the wiring at the two levels that matter:
 *
 *   1. The pure emitters (server/services/dealEvents.ts, propertyEvents.ts) —
 *      payload shape, honest `previousData`, and the no-op rule.
 *   2. The REAL route handlers (registerDealRoutes / registerPropertyRoutes)
 *      mounted on a live express app with mocked storage, so a regression that
 *      silently drops an emit call from a route is caught.
 *
 * No DATABASE_URL / no network: `./storage`, `./db`, `./auth` and the org
 * middleware are all mocked, and `./services/workflow-engine` is replaced with
 * spies so nothing touches the real engine queue.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

// ---------------------------------------------------------------------------
// Engine spies — the assertion surface. dealEvents/propertyEvents are REAL.
// ---------------------------------------------------------------------------

const emitDealEventSpy = vi.fn();
const emitPropertyEventSpy = vi.fn();

vi.mock("./services/workflow-engine", () => ({
  emitDealEvent: (...args: any[]) => emitDealEventSpy(...args),
  emitPropertyEvent: (...args: any[]) => emitPropertyEventSpy(...args),
}));

vi.mock("./utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ---------------------------------------------------------------------------
// In-memory storage stand-in.
// ---------------------------------------------------------------------------

const ORG = { id: 42, name: "Test Org" };

type Row = Record<string, any>;

const DEALS = new Map<number, Row>();
const PROPERTIES = new Map<number, Row>();
let NEXT_ID = 100;

const storageMock = {
  // deals
  getDeal: vi.fn(async (orgId: number, id: number) => {
    const d = DEALS.get(id);
    return d && d.organizationId === orgId ? { ...d } : undefined;
  }),
  createDeal: vi.fn(async (deal: Row) => {
    const row = { id: NEXT_ID++, status: "negotiating", ...deal };
    DEALS.set(row.id, row);
    return { ...row };
  }),
  updateDeal: vi.fn(async (id: number, updates: Row) => {
    const row = { ...DEALS.get(id), ...updates };
    DEALS.set(id, row);
    return { ...row };
  }),
  bulkUpdateDeals: vi.fn(async (orgId: number, ids: number[], updates: Row) => {
    for (const id of ids) {
      const row = DEALS.get(id);
      if (row && row.organizationId === orgId) DEALS.set(id, { ...row, ...updates });
    }
    return ids.length;
  }),
  checkStageGate: vi.fn(async () => ({ canAdvance: true, incompleteItems: [] })),
  // properties
  getProperty: vi.fn(async (orgId: number, id: number) => {
    const p = PROPERTIES.get(id);
    return p && p.organizationId === orgId ? { ...p } : undefined;
  }),
  createProperty: vi.fn(async (property: Row) => {
    const row = { id: NEXT_ID++, status: "prospect", ...property };
    PROPERTIES.set(row.id, row);
    return { ...row };
  }),
  updateProperty: vi.fn(async (id: number, updates: Row) => {
    const row = { ...PROPERTIES.get(id), ...updates };
    PROPERTIES.set(id, row);
    return { ...row };
  }),
  bulkUpdateProperties: vi.fn(async (orgId: number, ids: number[], updates: Row) => {
    for (const id of ids) {
      const row = PROPERTIES.get(id);
      if (row && row.organizationId === orgId) PROPERTIES.set(id, { ...row, ...updates });
    }
    return ids.length;
  }),
  // shared
  createAuditLogEntry: vi.fn(async () => ({ id: 1 })),
};

vi.mock("./storage", () => ({
  storage: storageMock,
  db: {},
}));

vi.mock("./db", () => ({
  db: {},
  // The POST /api/deals handler wraps create + audit log in a transaction;
  // running the callback inline is faithful enough for wiring assertions.
  withTransaction: async (fn: () => Promise<any>) => fn(),
}));

vi.mock("./auth", () => ({
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { id: "user-1", email: "op@test.com" };
    next();
  },
}));

vi.mock("./middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: any, _res: any, next: any) => {
    req.organization = ORG;
    req.organizationId = ORG.id;
    next();
  },
}));

// Keep the property-create handler from calling the real usage limiter /
// enrichment pre-warm.
vi.mock("./services/usageLimits", () => ({
  checkUsageLimit: vi.fn(async () => ({ allowed: true, current: 0, limit: 100 })),
}));

vi.mock("./services/propertyEnrichment", () => ({
  propertyEnrichmentService: {
    prewarmLandProfile: vi.fn(async () => undefined),
    enrichByCoordinates: vi.fn(async () => undefined),
    enrichProperty: vi.fn(async () => ({ enrichedAt: new Date(), lookupTimeMs: 0 })),
  },
}));

vi.mock("./services/data-cache/observation-log", () => ({
  recordParcelObservations: vi.fn(async () => undefined),
}));

// ---------------------------------------------------------------------------

async function buildApp() {
  const { registerDealRoutes } = await import("./routes-deals");
  const { registerPropertyRoutes } = await import("./routes-properties");
  const app = express();
  app.use(express.json());
  registerDealRoutes(app as any);
  registerPropertyRoutes(app as any);
  return app;
}

function seedDeal(overrides: Row = {}): Row {
  const row = {
    id: NEXT_ID++,
    organizationId: ORG.id,
    type: "acquisition",
    status: "negotiating",
    propertyId: 7,
    offerAmount: "10000",
    acceptedAmount: null,
    closingDate: null,
    ...overrides,
  };
  DEALS.set(row.id, row);
  return row;
}

function seedProperty(overrides: Row = {}): Row {
  const row = {
    id: NEXT_ID++,
    organizationId: ORG.id,
    apn: "123-45-678",
    address: "1 Test Rd",
    city: "Willcox",
    county: "Cochise",
    state: "AZ",
    zip: "85643",
    sizeAcres: "5",
    status: "prospect",
    listPrice: null,
    marketValue: null,
    purchasePrice: null,
    ...overrides,
  };
  PROPERTIES.set(row.id, row);
  return row;
}

/** All deal events emitted so far, as `[event, orgId, id, data, previousData]`. */
const dealCalls = () => emitDealEventSpy.mock.calls;
const propertyCalls = () => emitPropertyEventSpy.mock.calls;

beforeEach(() => {
  DEALS.clear();
  PROPERTIES.clear();
  NEXT_ID = 100;
  emitDealEventSpy.mockClear();
  emitPropertyEventSpy.mockClear();
});

// ---------------------------------------------------------------------------
// 1. Pure emitters
// ---------------------------------------------------------------------------

describe("dealEvents — pure emitters", () => {
  it("deal.stage_changed carries previousData with the PRIOR stage", async () => {
    const { emitDealStageChanged } = await import("./services/dealEvents");

    emitDealStageChanged(
      ORG.id,
      { id: 5, type: "acquisition", status: "negotiating", propertyId: 7 },
      { id: 5, type: "acquisition", status: "under_contract", propertyId: 7 },
    );

    expect(dealCalls()).toHaveLength(1);
    const [event, orgId, dealId, data, previousData] = dealCalls()[0];
    expect(event).toBe("deal.stage_changed");
    expect(orgId).toBe(ORG.id);
    expect(dealId).toBe(5);
    expect(data.status).toBe("under_contract");
    // Templates match on `stage` / `newStage`; both alias the real status.
    expect(data.stage).toBe("under_contract");
    expect(data.newStage).toBe("under_contract");
    expect(previousData).toBeDefined();
    expect(previousData.status).toBe("negotiating");
    expect(previousData.stage).toBe("negotiating");
  });

  it("a no-op update (same status) emits NOTHING", async () => {
    const { emitDealStageChanged } = await import("./services/dealEvents");

    emitDealStageChanged(
      ORG.id,
      { id: 5, status: "negotiating", offerAmount: "10000" },
      // price changed, stage did not
      { id: 5, status: "negotiating", offerAmount: "12500" },
    );

    expect(emitDealEventSpy).not.toHaveBeenCalled();
  });

  it("emits nothing when there is no real pre-image to compare against", async () => {
    const { emitDealStageChanged } = await import("./services/dealEvents");
    emitDealStageChanged(ORG.id, undefined, { id: 5, status: "closed" });
    emitDealStageChanged(ORG.id, { id: 5, status: "negotiating" }, undefined);
    expect(emitDealEventSpy).not.toHaveBeenCalled();
  });

  it("never fabricates: absent columns come through as null, not guesses", async () => {
    const { buildDealEventData } = await import("./services/dealEvents");
    const data = buildDealEventData({ id: 9, status: "closed" });
    expect(data).toEqual({
      dealId: 9,
      dealType: null,
      status: "closed",
      stage: "closed",
      newStage: "closed",
      propertyId: null,
      offerAmount: null,
      acceptedAmount: null,
      closingDate: null,
    });
  });

  it("an engine throw is swallowed — the write path must never see it", async () => {
    const { emitDealCreated } = await import("./services/dealEvents");
    emitDealEventSpy.mockImplementationOnce(() => {
      throw new Error("engine exploded");
    });
    expect(() => emitDealCreated(ORG.id, { id: 5, status: "negotiating" })).not.toThrow();
  });
});

describe("propertyEvents — pure emitters", () => {
  it("property.status_changed carries previousData with the prior status", async () => {
    const { emitPropertyStatusChanged } = await import("./services/propertyEvents");

    emitPropertyStatusChanged(
      ORG.id,
      { id: 3, status: "prospect", county: "Cochise", state: "AZ" },
      { id: 3, status: "under_contract", county: "Cochise", state: "AZ" },
    );

    expect(propertyCalls()).toHaveLength(1);
    const [event, orgId, propertyId, data, previousData] = propertyCalls()[0];
    expect(event).toBe("property.status_changed");
    expect(orgId).toBe(ORG.id);
    expect(propertyId).toBe(3);
    expect(data.status).toBe("under_contract");
    expect(previousData.status).toBe("prospect");
  });

  it("a no-op property update emits NOTHING", async () => {
    const { emitPropertyStatusChanged } = await import("./services/propertyEvents");
    emitPropertyStatusChanged(
      ORG.id,
      { id: 3, status: "prospect", listPrice: null },
      { id: 3, status: "prospect", listPrice: "7900" },
    );
    expect(emitPropertyEventSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 2. Real route handlers
// ---------------------------------------------------------------------------

describe("deal routes emit the workflow triggers", () => {
  it("POST /api/deals emits deal.created", async () => {
    const app = await buildApp();

    const res = await request(app)
      .post("/api/deals")
      .send({ type: "acquisition", propertyId: 7, status: "negotiating", offerAmount: "10000" });

    expect(res.status).toBe(201);
    const created = dealCalls().filter((c) => c[0] === "deal.created");
    expect(created).toHaveLength(1);
    expect(created[0][1]).toBe(ORG.id);
    expect(created[0][3].status).toBe("negotiating");
    // A creation has no prior stage — previousData must be absent, not invented.
    expect(created[0][4]).toBeUndefined();
  });

  it("PATCH /api/deals/:id/stage (the Kanban drag path) emits deal.stage_changed with the prior stage", async () => {
    const app = await buildApp();
    const deal = seedDeal({ status: "negotiating" });

    const res = await request(app)
      .patch(`/api/deals/${deal.id}/stage`)
      .send({ stage: "offer_sent" });

    expect(res.status).toBe(200);
    const changes = dealCalls().filter((c) => c[0] === "deal.stage_changed");
    expect(changes).toHaveLength(1);
    const [, orgId, dealId, data, previousData] = changes[0];
    expect(orgId).toBe(ORG.id);
    expect(dealId).toBe(deal.id);
    expect(data.status).toBe("offer_sent");
    expect(data.newStage).toBe("offer_sent");
    expect(previousData.status).toBe("negotiating");
  });

  it("PUT /api/deals/:id emits deal.stage_changed on a status move", async () => {
    const app = await buildApp();
    const deal = seedDeal({ status: "negotiating" });

    const res = await request(app).put(`/api/deals/${deal.id}`).send({ status: "offer_sent" });

    expect(res.status).toBe(200);
    const changes = dealCalls().filter((c) => c[0] === "deal.stage_changed");
    expect(changes).toHaveLength(1);
    expect(changes[0][3].status).toBe("offer_sent");
    expect(changes[0][4].status).toBe("negotiating");
  });

  it("PUT /api/deals/:id that changes only the offer amount emits NOTHING", async () => {
    const app = await buildApp();
    const deal = seedDeal({ status: "negotiating", offerAmount: "10000" });

    const res = await request(app).put(`/api/deals/${deal.id}`).send({ offerAmount: "12500" });

    expect(res.status).toBe(200);
    expect(emitDealEventSpy).not.toHaveBeenCalled();
  });

  it("PUT /api/deals/:id re-submitting the SAME status emits NOTHING", async () => {
    const app = await buildApp();
    const deal = seedDeal({ status: "negotiating" });

    const res = await request(app).put(`/api/deals/${deal.id}`).send({ status: "negotiating" });

    expect(res.status).toBe(200);
    expect(emitDealEventSpy).not.toHaveBeenCalled();
  });

  it("POST /api/deals/:id/advance-stage emits deal.stage_changed", async () => {
    const app = await buildApp();
    const deal = seedDeal({ status: "negotiating" });

    const res = await request(app).post(`/api/deals/${deal.id}/advance-stage`).send({});

    expect(res.status).toBe(200);
    const changes = dealCalls().filter((c) => c[0] === "deal.stage_changed");
    expect(changes).toHaveLength(1);
    expect(changes[0][4].status).toBe("negotiating");
    expect(changes[0][3].status).toBe(res.body.nextStatus);
  });

  it("POST /api/deals/bulk-update emits one event per deal that ACTUALLY moved", async () => {
    const app = await buildApp();
    const moving = seedDeal({ status: "negotiating" });
    const alreadyThere = seedDeal({ status: "offer_sent" });

    const res = await request(app)
      .post("/api/deals/bulk-update")
      .send({ ids: [moving.id, alreadyThere.id], updates: { status: "offer_sent" } });

    expect(res.status).toBe(200);
    const changes = dealCalls().filter((c) => c[0] === "deal.stage_changed");
    expect(changes).toHaveLength(1);
    expect(changes[0][2]).toBe(moving.id);
    expect(changes[0][4].status).toBe("negotiating");
  });

  it("POST /api/deals/bulk-update with no status in the payload emits NOTHING", async () => {
    const app = await buildApp();
    const deal = seedDeal({ status: "negotiating" });

    const res = await request(app)
      .post("/api/deals/bulk-update")
      .send({ ids: [deal.id], updates: { offerAmount: "9000" } });

    expect(res.status).toBe(200);
    expect(emitDealEventSpy).not.toHaveBeenCalled();
  });

  it("a throwing engine does not fail the deal write", async () => {
    const app = await buildApp();
    const deal = seedDeal({ status: "negotiating" });
    emitDealEventSpy.mockImplementationOnce(() => {
      throw new Error("engine exploded");
    });

    const res = await request(app)
      .patch(`/api/deals/${deal.id}/stage`)
      .send({ stage: "offer_sent" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("offer_sent");
  });
});

describe("property routes emit the workflow triggers", () => {
  it("POST /api/properties emits property.created", async () => {
    const app = await buildApp();

    const res = await request(app)
      .post("/api/properties")
      .send({ apn: "123-45-678", county: "Cochise", state: "AZ", sizeAcres: "5", status: "prospect" });

    expect(res.status).toBe(201);
    const created = propertyCalls().filter((c) => c[0] === "property.created");
    expect(created).toHaveLength(1);
    expect(created[0][3].status).toBe("prospect");
    expect(created[0][3].apn).toBe("123-45-678");
    expect(created[0][4]).toBeUndefined();
  });

  it("PUT /api/properties/:id emits property.status_changed with the prior status", async () => {
    const app = await buildApp();
    const property = seedProperty({ status: "prospect" });

    const res = await request(app).put(`/api/properties/${property.id}`).send({
      apn: property.apn,
      county: property.county,
      state: property.state,
      sizeAcres: property.sizeAcres,
      status: "under_contract",
    });

    expect(res.status).toBe(200);
    const changes = propertyCalls().filter((c) => c[0] === "property.status_changed");
    expect(changes).toHaveLength(1);
    expect(changes[0][3].status).toBe("under_contract");
    expect(changes[0][4].status).toBe("prospect");
  });

  it("PUT /api/properties/:id that changes only the list price emits NOTHING", async () => {
    const app = await buildApp();
    const property = seedProperty({ status: "prospect" });

    const res = await request(app)
      .put(`/api/properties/${property.id}`)
      .send({ listPrice: "7900" });

    expect(res.status).toBe(200);
    expect(emitPropertyEventSpy).not.toHaveBeenCalled();
  });

  it("POST /api/properties/bulk-update emits only for properties that ACTUALLY moved", async () => {
    const app = await buildApp();
    const moving = seedProperty({ status: "prospect" });
    const alreadyThere = seedProperty({ status: "listed" });

    const res = await request(app)
      .post("/api/properties/bulk-update")
      .send({ ids: [moving.id, alreadyThere.id], updates: { status: "listed" } });

    expect(res.status).toBe(200);
    const changes = propertyCalls().filter((c) => c[0] === "property.status_changed");
    expect(changes).toHaveLength(1);
    expect(changes[0][2]).toBe(moving.id);
    expect(changes[0][4].status).toBe("prospect");
  });

  it("PATCH /api/properties/:id/land-status does NOT emit a pipeline status change", async () => {
    const app = await buildApp();
    const property = seedProperty({ status: "prospect", landStatus: "unknown" });

    const res = await request(app)
      .patch(`/api/properties/${property.id}/land-status`)
      .send({ landStatus: "tribal_trust" });

    expect(res.status).toBe(200);
    // landStatus is a regulatory classification, not the pipeline status the
    // property.* trigger family describes.
    expect(emitPropertyEventSpy).not.toHaveBeenCalled();
  });
});
