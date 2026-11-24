/**
 * L-P3 (2026-11-18) — the publish route must never call a hand-posted
 * channel "sent".
 *
 * POST /api/listings/:id/publish mapped every successful channel result to
 * status "sent" and dropped `preformattedText` from the response. Craigslist
 * — the one channel that works today, by generating ready-to-paste text —
 * therefore rendered in listings.tsx as a green "Sent" badge and a
 * "Published to 1 platform" toast, while nothing had been posted anywhere
 * and the paste text (the channel's only deliverable) never reached the
 * operator. The stored target was already honest (`manual_posting`); the
 * response status was the lie.
 *
 * `publishStatusForResult` is the route's mapping, pinned here:
 *   - provider acceptance with a listing id        → "sent"
 *   - success that needs the operator's own hands  → "manual"
 *   - a "not configured" refusal                   → "missing_credentials"
 *   - any other failure                            → "failed"
 * and the real Craigslist result carries the paste text the response must
 * forward. Mutation: map the manual shape to "sent" → red.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../../server/db", () => ({ db: {} }));

const { syndicateListing, publishStatusForResult, channelCredentialStore } = await import(
  "../../server/services/listingSyndication"
);

const listing = {
  propertyId: 1, organizationId: 7, title: "5 Acres in Bastrop County", description: "Flat, cleared.",
  askingPrice: 10_000, pricePerAcre: 2_000, acreage: 5, address: "", city: "Bastrop", state: "TX",
  zip: "78602", county: "Bastrop", latitude: 0, longitude: 0, propertyType: "vacant land",
  photos: [], sellerFinancingAvailable: false, contactName: "Ana",
  listingUrl: "https://example.com/listings/1",
} as any;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("publishStatusForResult", () => {
  it("a provider acceptance with a listing id is sent", () => {
    expect(
      publishStatusForResult({ platform: "land_com", success: true, listingId: "lc-1", listingUrl: "https://www.land.com/x" }),
    ).toBe("sent");
  });

  it("a hand-post success is manual, never sent", () => {
    expect(
      publishStatusForResult({
        platform: "craigslist",
        success: true,
        requiresManualAction: true,
        preformattedText: "5 Acres…",
      }),
    ).toBe("manual");
  });

  it("a not-configured refusal is missing_credentials; other failures are failed", () => {
    expect(publishStatusForResult({ platform: "land_com", success: false, error: "API key not configured" })).toBe(
      "missing_credentials",
    );
    expect(publishStatusForResult({ platform: "land_com", success: false, error: "HTTP 500" })).toBe("failed");
  });

  it("the real Craigslist result is manual and carries the paste text", async () => {
    const [r] = await syndicateListing(listing, ["craigslist"]);
    expect(r.success).toBe(true);
    expect(r.requiresManualAction).toBe(true);
    expect(r.listingId).toBeUndefined();
    expect(r.preformattedText).toContain("5 Acres in Bastrop County");
    expect(publishStatusForResult(r)).toBe("manual");
  });

  it("a connected customer-account channel that posts is sent", async () => {
    vi.spyOn(channelCredentialStore, "resolve").mockResolvedValue({ apiKey: "k", brokerId: "b" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ id: "lc-9" }), { status: 200 })),
    );
    const [r] = await syndicateListing(listing, ["land_com"]);
    expect(r.success).toBe(true);
    expect(r.listingId).toBe("lc-9");
    expect(publishStatusForResult(r)).toBe("sent");
  });
});
