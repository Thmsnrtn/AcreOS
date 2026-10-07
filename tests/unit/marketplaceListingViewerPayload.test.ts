/**
 * A marketplace listing is served to other organizations without the seller's
 * private records.
 *
 * Three things on a listing response belong to the seller alone: the
 * listing's `minAcceptablePrice` (the seller's floor — the schema marks it
 * "private, not shown"), the seller organization's own row, and the seller's
 * property record (what it paid, its counterparties, its diligence data).
 * Driven through the real router and the real marketplace service; only the
 * database is faked. The fake returns WHOLE rows for whatever it is asked, so
 * the projections are checked twice: on what the service asked the database
 * for, and on what the route served.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const SELLER = 10;
const OTHER = 20;

const DB = vi.hoisted(() => {
  const selects: Array<Record<string, unknown> | undefined> = [];
  const selectQueue: unknown[][] = [];
  const chain = (result: () => unknown) => {
    const proxy: any = new Proxy(function () {} as unknown as object, {
      get(_t, prop) {
        if (prop === "then") {
          return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej);
        }
        return () => proxy;
      },
    });
    return proxy;
  };
  const db = {
    select: (shape?: Record<string, unknown>) => {
      selects.push(shape);
      return chain(() => selectQueue.shift() ?? []);
    },
    update: () => chain(() => []),
    insert: () => chain(() => []),
  };
  return { selects, selectQueue, db, viewer: 0 };
});

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/db", () => ({ db: DB.db, withTransaction: async (fn: (tx: unknown) => unknown) => fn(DB.db) }));
vi.mock("../../server/storage", () => ({ storage: {} }));
vi.mock("../../server/auth", () => ({ isAuthenticated: (_q: unknown, _r: unknown, n: () => void) => n() }));
vi.mock("../../server/services/matchmaking", () => ({ matchmaking: {} }));

const { default: marketplaceRouter } = await import("../../server/routes-marketplace");

function app() {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    Object.assign(req, { organization: { id: DB.viewer } });
    next();
  });
  a.use("/api/marketplace", marketplaceRouter);
  return a;
}

const LISTING = {
  id: 5,
  sellerOrganizationId: SELLER,
  propertyId: 7,
  listingType: "wholesale",
  title: "40 acres",
  askingPrice: "40000",
  minAcceptablePrice: "31000",
  visibility: "public",
  status: "active",
};

/** What the database would hold — the whole rows, private columns included. */
const WHOLE_ROW = {
  listing: LISTING,
  property: { id: 7, organizationId: SELLER, apn: "1-2-3", county: "Brewster", state: "TX", sizeAcres: "40", purchasePrice: "9000", sellerId: 44 },
  seller: { id: SELLER, name: "Seller Co", ein: "12-3456789", stripeCustomerId: "cus_x", taxAddress: "1 Main St" },
};

/**
 * Independent expectations, written from the schema and from what the
 * marketplace page renders (client/src/pages/marketplace.tsx).
 */
const SELLER_KEYS = ["id", "name"];
const PROPERTY_PRIVATE = ["organizationId", "purchasePrice", "purchaseDate", "soldPrice", "sellerId", "buyerId", "dueDiligenceData", "enrichmentData", "parcelData", "assessedValue", "marketValue", "listPrice"];
const PROPERTY_RENDERED = ["apn", "county", "state", "sizeAcres", "zoning"];

function shapeOf(key: string): string[] {
  const shape = DB.selects.find((s) => s && key in s)?.[key];
  if (!shape || typeof shape !== "object") throw new Error(`no select with a ${key} projection was issued`);
  // A Drizzle table object would expose its columns as keys too; a projection
  // is a plain object of columns.
  return Object.keys(shape as object).sort();
}

beforeEach(() => {
  DB.selects.length = 0;
  DB.selectQueue.length = 0;
});

describe("GET /listings/:id", () => {
  it("a non-seller is not served the seller's floor price, org row or property records", async () => {
    DB.viewer = OTHER;
    DB.selectQueue.push([WHOLE_ROW]);
    const res = await request(app()).get("/api/marketplace/listings/5");
    expect(res.status).toBe(200);
    expect(res.body.listing.listing).not.toHaveProperty("minAcceptablePrice");
    expect(res.body.listing.listing.askingPrice).toBe("40000");
    expect(shapeOf("seller")).toEqual(SELLER_KEYS);
    const property = shapeOf("property");
    for (const k of PROPERTY_PRIVATE) expect(property, k).not.toContain(k);
    for (const k of PROPERTY_RENDERED) expect(property, k).toContain(k);
  });

  it("the seller is served its own floor price", async () => {
    DB.viewer = SELLER;
    DB.selectQueue.push([WHOLE_ROW], []);
    const res = await request(app()).get("/api/marketplace/listings/5");
    expect(res.status).toBe(200);
    expect(res.body.listing.listing.minAcceptablePrice).toBe("31000");
  });
});

describe("listing collections", () => {
  it("GET /listings serves no floor price and a projected seller", async () => {
    DB.viewer = OTHER;
    DB.selectQueue.push([WHOLE_ROW]);
    const res = await request(app()).get("/api/marketplace/listings");
    expect(res.status).toBe(200);
    expect(res.body.listings).toHaveLength(1);
    expect(res.body.listings[0].listing).not.toHaveProperty("minAcceptablePrice");
    expect(shapeOf("seller")).toEqual(SELLER_KEYS);
    for (const k of PROPERTY_PRIVATE) expect(shapeOf("property"), k).not.toContain(k);
  });

  it("GET /search serves no floor price to a non-seller, and the seller its own", async () => {
    DB.viewer = OTHER;
    DB.selectQueue.push([WHOLE_ROW]);
    let res = await request(app()).get("/api/marketplace/search");
    expect(res.body.listings[0].listing).not.toHaveProperty("minAcceptablePrice");

    DB.viewer = SELLER;
    DB.selectQueue.push([WHOLE_ROW]);
    res = await request(app()).get("/api/marketplace/search");
    expect(res.body.listings[0].listing.minAcceptablePrice).toBe("31000");
  });

  it("GET /my/bids serves the bidder no floor price on the listings it bid on", async () => {
    DB.viewer = OTHER;
    DB.selectQueue.push([{ bid: { id: 1, bidderOrganizationId: OTHER }, listing: LISTING, property: WHOLE_ROW.property }]);
    const res = await request(app()).get("/api/marketplace/my/bids");
    expect(res.status).toBe(200);
    expect(res.body.bids[0].listing).not.toHaveProperty("minAcceptablePrice");
    for (const k of PROPERTY_PRIVATE) expect(shapeOf("property"), k).not.toContain(k);
  });
});
