/**
 * GET /api/marketplace/listings/:id/bids answers with the bids the CALLER may
 * see — the seller every bid, anyone else only its own — through
 * marketplaceService.getBidsVisibleTo (the database half:
 * marketplaceBidVisibility.db.test.ts). The router is mounted bare (the
 * ladder flag and auth live in front of it in routes.ts).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const SELLER = 10;
const BIDDER = 20;
const M = vi.hoisted(() => ({
  viewer: 20,
  getListing: vi.fn(),
  getBidsVisibleTo: vi.fn(async () => [] as unknown[]),
  getBidsForListing: vi.fn(async () => [] as unknown[]),
}));

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/auth", () => ({ isAuthenticated: (_q: unknown, _r: unknown, n: () => void) => n() }));
vi.mock("../../server/services/matchmaking", () => ({ matchmaking: {} }));
vi.mock("../../server/services/marketplace", () => ({
  marketplaceService: { getListing: M.getListing, getBidsVisibleTo: M.getBidsVisibleTo, getBidsForListing: M.getBidsForListing },
}));

const { default: marketplaceRouter } = await import("../../server/routes-marketplace");

function app() {
  const a = express();
  a.use((req, _res, next) => {
    Object.assign(req, { organization: { id: M.viewer } });
    next();
  });
  a.use("/api/marketplace", marketplaceRouter);
  return a;
}

beforeEach(() => {
  M.getListing.mockReset();
  M.getBidsVisibleTo.mockClear();
  M.getBidsForListing.mockClear();
  M.getListing.mockResolvedValue({ listing: { id: 5, sellerOrganizationId: SELLER, visibility: "public" } });
});

describe("listing bids are answered for the caller", () => {
  it("a non-seller's request is answered with the caller-scoped read, never the listing's whole bid list", async () => {
    M.viewer = BIDDER;
    const res = await request(app()).get("/api/marketplace/listings/5/bids");
    expect(res.status).toBe(200);
    expect(M.getBidsVisibleTo).toHaveBeenCalledWith(5, BIDDER, SELLER);
    expect(M.getBidsForListing).not.toHaveBeenCalled();
  });

  it("the seller's request names the seller as the viewer", async () => {
    M.viewer = SELLER;
    await request(app()).get("/api/marketplace/listings/5/bids");
    expect(M.getBidsVisibleTo).toHaveBeenCalledWith(5, SELLER, SELLER);
  });

  it("a listing the caller cannot see is a 404", async () => {
    M.getListing.mockResolvedValue(null);
    const res = await request(app()).get("/api/marketplace/listings/5/bids");
    expect(res.status).toBe(404);
    expect(M.getBidsVisibleTo).not.toHaveBeenCalled();
  });
});
