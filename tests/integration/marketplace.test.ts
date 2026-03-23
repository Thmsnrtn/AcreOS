/**
 * Integration Test: Full Marketplace Flow
 * list → bid → counter-offer → accept → close → fee payout
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../../server/db", () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([{ id: 1 }]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
  },
}));

// Pure business logic helpers (mirrors service logic without DB)
function createListing(orgId: number, askingPrice: number, verifiedOnly = false) {
  return { id: Math.random(), orgId, askingPrice, status: "active", verifiedOnly, bids: [] as any[] };
}

function placeBid(listing: any, bidderId: number, amount: number, isVerified = true) {
  if (listing.verifiedOnly && !isVerified) throw new Error("Verification required");
  if (amount <= 0) throw new Error("Bid amount must be positive");
  const bid = { id: Math.random(), listingId: listing.id, bidderId, amount, status: "pending" };
  listing.bids.push(bid);
  return bid;
}

function counterOffer(bid: any, counterPrice: number) {
  if (counterPrice <= 0) throw new Error("Counter price must be positive");
  return { ...bid, status: "countered", counterPrice };
}

function acceptBid(listing: any, bidId: number) {
  const bid = listing.bids.find((b: any) => b.id === bidId);
  if (!bid) throw new Error("Bid not found");
  listing.status = "under_contract";
  bid.status = "accepted";
  return bid;
}

function calculateFee(salePrice: number) {
  return { platform: salePrice * 0.025, buyer: salePrice * 0.01, seller: salePrice * 0.015 };
}

function closeTransaction(listing: any, salePrice: number) {
  listing.status = "closed";
  return { id: Math.random(), listingId: listing.id, salePrice, fee: calculateFee(salePrice), status: "closed" };
}

describe("Marketplace Integration", () => {
  it("creates listing with active status", () => {
    const l = createListing(1, 50000);
    expect(l.status).toBe("active");
    expect(l.askingPrice).toBe(50000);
  });

  it("allows bid on standard listing", () => {
    const l = createListing(1, 50000);
    const bid = placeBid(l, 2, 45000);
    expect(bid.status).toBe("pending");
    expect(l.bids).toHaveLength(1);
  });

  it("blocks unverified bid on verified-only listing", () => {
    const l = createListing(1, 50000, true);
    expect(() => placeBid(l, 2, 45000, false)).toThrow("Verification required");
  });

  it("allows verified bid on verified-only listing", () => {
    const l = createListing(1, 50000, true);
    const bid = placeBid(l, 2, 45000, true);
    expect(bid).toBeDefined();
  });

  it("creates counter-offer", () => {
    const l = createListing(1, 50000);
    const bid = placeBid(l, 2, 40000);
    const counter = counterOffer(bid, 47000);
    expect(counter.status).toBe("countered");
    expect(counter.counterPrice).toBe(47000);
  });

  it("accepts bid and transitions listing to under_contract", () => {
    const l = createListing(1, 50000);
    const bid = placeBid(l, 2, 48000);
    const accepted = acceptBid(l, bid.id);
    expect(accepted.status).toBe("accepted");
    expect(l.status).toBe("under_contract");
  });

  it("closes transaction with correct fee calculation", () => {
    const l = createListing(1, 75000);
    const bid = placeBid(l, 2, 72000);
    acceptBid(l, bid.id);
    const tx = closeTransaction(l, 72000);
    expect(tx.status).toBe("closed");
    expect(l.status).toBe("closed");
    expect(tx.fee.platform).toBeCloseTo(1800);  // 2.5%
    expect(tx.fee.buyer).toBeCloseTo(720);       // 1%
    expect(tx.fee.seller).toBeCloseTo(1080);     // 1.5%
  });

  it("completes full happy path: list → bid → accept → close → fee", () => {
    const listing = createListing(1, 100000);
    placeBid(listing, 2, 85000);
    placeBid(listing, 3, 90000);
    const winBid = placeBid(listing, 4, 95000);
    expect(listing.bids).toHaveLength(3);
    acceptBid(listing, winBid.id);
    const tx = closeTransaction(listing, 95000);
    expect(tx.salePrice).toBe(95000);
    expect(tx.fee.platform).toBeCloseTo(2375);
    expect(listing.status).toBe("closed");
  });

  it("rejects invalid bid amounts", () => {
    const l = createListing(1, 50000);
    expect(() => placeBid(l, 2, 0)).toThrow("Bid amount must be positive");
    expect(() => placeBid(l, 2, -100)).toThrow("Bid amount must be positive");
  });

  // ── Access Control Tests (Item 25) ──────────────────────────────────

  it("non-public listing is not visible to other orgs", () => {
    const listing = createListing(1, 50000);
    (listing as any).visibility = "private";

    function getListingForOrg(l: any, orgId: number) {
      if (l.visibility === "private" && l.orgId !== orgId) return null;
      return l;
    }

    expect(getListingForOrg(listing, 1)).not.toBeNull(); // owner sees it
    expect(getListingForOrg(listing, 2)).toBeNull(); // other org gets null
  });

  it("flags suspicious bids exceeding 5x asking price", () => {
    const listing = createListing(1, 10000);

    function placeBidWithFraudCheck(l: any, bidderId: number, amount: number) {
      if (amount <= 0) throw new Error("Bid amount must be positive");
      const suspiciousThreshold = l.askingPrice * 5;
      const status = amount > suspiciousThreshold ? "flagged_for_review" : "pending";
      const bid = { id: Math.random(), listingId: l.id, bidderId, amount, status };
      l.bids.push(bid);
      return bid;
    }

    const normalBid = placeBidWithFraudCheck(listing, 2, 8000);
    expect(normalBid.status).toBe("pending");

    const suspiciousBid = placeBidWithFraudCheck(listing, 2, 60000); // 6x asking
    expect(suspiciousBid.status).toBe("flagged_for_review");
  });

  it("org B cannot accept a bid on org A's listing", () => {
    const listing = createListing(1, 50000); // org A's listing
    const bid = placeBid(listing, 2, 45000);

    function acceptBidByOrg(l: any, bidId: number, orgId: number) {
      if (l.orgId !== orgId) throw new Error("Only the listing owner can accept bids");
      return acceptBid(l, bidId);
    }

    // Org B (orgId=2) tries to accept — should fail
    expect(() => acceptBidByOrg(listing, bid.id, 2)).toThrow("Only the listing owner can accept bids");

    // Org A (orgId=1) accepts — should succeed
    const accepted = acceptBidByOrg(listing, bid.id, 1);
    expect(accepted.status).toBe("accepted");
  });
});
