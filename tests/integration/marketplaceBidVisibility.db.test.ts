/**
 * Bids on a marketplace listing: the seller sees every bid, any other
 * organization only its own (marketplaceService.getBidsVisibleTo, used by
 * GET /api/marketplace/listings/:id/bids). The marketplace is behind a ladder
 * flag that is off; this holds the day it turns on. Real database: the
 * predicate is evaluated by Postgres.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { realDbAvailable, useRealDb } from "../helpers/realDb";

useRealDb("marketplaceBidVisibility.db");

describe.runIf(realDbAvailable)("marketplace bid visibility", () => {
  let svc: typeof import("../../server/services/marketplace").marketplaceService;
  let db: typeof import("../../server/db").db;
  let schema: typeof import("../../shared/schema");
  let inArray: typeof import("drizzle-orm").inArray;
  const tag = `bids-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const orgs: Record<"seller" | "x" | "y", number> = { seller: 0, x: 0, y: 0 };
  let listingId = 0;
  let propertyId = 0;

  beforeAll(async () => {
    ({ marketplaceService: svc } = await import("../../server/services/marketplace"));
    ({ db } = await import("../../server/db"));
    schema = await import("../../shared/schema");
    ({ inArray } = await import("drizzle-orm"));
    for (const k of ["seller", "x", "y"] as const) {
      const [o] = await db.insert(schema.organizations).values({ name: `${tag}-${k}`, slug: `${tag}-${k}`, ownerId: `${tag}-${k}` }).returning();
      orgs[k] = o.id;
    }
    const [p] = await db
      .insert(schema.properties)
      .values({ organizationId: orgs.seller, apn: `${tag}-apn`, county: "Llano", state: "TX", sizeAcres: "10" })
      .returning();
    propertyId = p.id;
    const [l] = await db
      .insert(schema.marketplaceListings)
      .values({ sellerOrganizationId: orgs.seller, propertyId, title: `${tag}`, listingType: "wholesale", askingPrice: "10000", visibility: "public" } as never)
      .returning();
    listingId = l.id;
    await db.insert(schema.marketplaceBids).values([
      { listingId, bidderOrganizationId: orgs.x, bidAmount: "9000" },
      { listingId, bidderOrganizationId: orgs.y, bidAmount: "9500" },
    ] as never);
  });

  afterAll(async () => {
    if (!listingId) return;
    await db.delete(schema.marketplaceBids).where(inArray(schema.marketplaceBids.listingId, [listingId]));
    await db.delete(schema.marketplaceListings).where(inArray(schema.marketplaceListings.id, [listingId]));
    await db.delete(schema.properties).where(inArray(schema.properties.id, [propertyId]));
    await db.delete(schema.organizations).where(inArray(schema.organizations.id, Object.values(orgs)));
  });

  const bidders = (rows: Array<{ bid: { bidderOrganizationId: number } }>) => rows.map((r) => r.bid.bidderOrganizationId).sort();

  it("the seller sees every bid", async () => {
    expect(bidders(await svc.getBidsVisibleTo(listingId, orgs.seller, orgs.seller))).toEqual([orgs.x, orgs.y].sort());
  });

  it("a bidder sees only its own bid — never another bidder's row", async () => {
    expect(bidders(await svc.getBidsVisibleTo(listingId, orgs.x, orgs.seller))).toEqual([orgs.x]);
    expect(bidders(await svc.getBidsVisibleTo(listingId, orgs.y, orgs.seller))).toEqual([orgs.y]);
  });

  it("an organization that has not bid sees none", async () => {
    const [z] = await db.insert(schema.organizations).values({ name: `${tag}-z`, slug: `${tag}-z`, ownerId: `${tag}-z` }).returning();
    try {
      expect(await svc.getBidsVisibleTo(listingId, z.id, orgs.seller)).toEqual([]);
    } finally {
      await db.delete(schema.organizations).where(inArray(schema.organizations.id, [z.id]));
    }
  });
});
