/**
 * GET /api/marketplace/listings/:id/bids — who may read which bids.
 *
 * The handler checked only that the caller could SEE the listing (any public
 * listing is visible to every org) and then returned every bid on it — bid
 * amounts, terms and bidder identities of competing organizations. Latent
 * behind `requireLadderFlag("feature_marketplace")`, but a flag is a door, not
 * an authority check.
 *
 * The rule: the listing's seller reads every bid; any other org reads only
 * its own bids; a listing the caller cannot see is a 404.
 *
 * The filter lives in marketplaceService.getBidsVisibleTo, which scopes the
 * query itself (tests/integration/marketplaceBidVisibility.db.test.ts proves
 * that against Postgres). This suite pins the ROUTE's half: it never returns
 * the unfiltered listing read, and it names the seller from the listing row,
 * never from anything the caller sends. The mock applies the documented rule
 * so the response bodies below stay meaningful.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const SELLER = 10;
const BIDDER_A = 20;
const BIDDER_B = 30;
const LISTING = 5;

let callerOrg = SELLER;

const getListing = vi.fn();
const getBidsForListing = vi.fn();
const getBidsVisibleTo = vi.fn();

vi.mock("../../server/services/marketplace", () => ({
  marketplaceService: {
    getListing: (...a: unknown[]) => getListing(...a),
    getBidsForListing: (...a: unknown[]) => getBidsForListing(...a),
    getBidsVisibleTo: (...a: unknown[]) => getBidsVisibleTo(...a),
  },
}));
vi.mock("../../server/services/matchmaking", () => ({ matchmaking: {} }));
vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/auth", () => ({ isAuthenticated: (_q: any, _s: any, n: any) => n() }));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import marketplaceRouter from "../../server/routes-marketplace";

const BIDS = [
  { bid: { id: 1, listingId: LISTING, bidderOrganizationId: BIDDER_A, bidAmount: "1000" }, bidder: { id: BIDDER_A, name: "A" } },
  { bid: { id: 2, listingId: LISTING, bidderOrganizationId: BIDDER_B, bidAmount: "2000" }, bidder: { id: BIDDER_B, name: "B" } },
  { bid: { id: 3, listingId: LISTING, bidderOrganizationId: BIDDER_A, bidAmount: "1500" }, bidder: { id: BIDDER_A, name: "A" } },
];

describe("marketplace bids read", () => {
  let app: express.Application;
  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.organization = { id: callerOrg };
      req.organizationId = callerOrg;
      next();
    });
    app.use("/api/marketplace", marketplaceRouter);
  });

  beforeEach(() => {
    getListing.mockReset();
    getBidsForListing.mockReset();
    getBidsVisibleTo.mockReset();
    // A PUBLIC listing: visible to every org, as getListing returns it.
    getListing.mockResolvedValue({ listing: { id: LISTING, sellerOrganizationId: SELLER, visibility: "public" } });
    getBidsForListing.mockResolvedValue(BIDS);
    getBidsVisibleTo.mockImplementation(async (_listingId: number, viewer: number, seller: number) =>
      viewer === seller ? BIDS : BIDS.filter((b) => b.bid.bidderOrganizationId === viewer),
    );
  });

  it("asks the service for the caller's view, with the seller taken from the listing", async () => {
    callerOrg = BIDDER_A;
    await request(app).get(`/api/marketplace/listings/${LISTING}/bids`);
    expect(getBidsVisibleTo).toHaveBeenCalledWith(LISTING, BIDDER_A, SELLER);
    // The unfiltered read is never served straight to a non-seller.
    expect(getBidsForListing).not.toHaveBeenCalled();
  });

  it("the seller reads every bid", async () => {
    callerOrg = SELLER;
    const res = await request(app).get(`/api/marketplace/listings/${LISTING}/bids`);
    expect(res.status).toBe(200);
    expect(res.body.bids.map((b: any) => b.bid.id)).toEqual([1, 2, 3]);
  });

  it("a bidder reads only its own bids", async () => {
    callerOrg = BIDDER_A;
    const res = await request(app).get(`/api/marketplace/listings/${LISTING}/bids`);
    expect(res.status).toBe(200);
    expect(res.body.bids.map((b: any) => b.bid.id)).toEqual([1, 3]);
    expect(JSON.stringify(res.body)).not.toContain("2000");
  });

  it("an org with no bids reads none", async () => {
    callerOrg = 99;
    const res = await request(app).get(`/api/marketplace/listings/${LISTING}/bids`);
    expect(res.status).toBe(200);
    expect(res.body.bids).toEqual([]);
  });

  it("a listing the caller cannot see is a 404", async () => {
    callerOrg = BIDDER_B;
    getListing.mockResolvedValue(null);
    const res = await request(app).get(`/api/marketplace/listings/${LISTING}/bids`);
    expect(res.status).toBe(404);
    expect(getBidsForListing).not.toHaveBeenCalled();
    expect(getBidsVisibleTo).not.toHaveBeenCalled();
  });
});
