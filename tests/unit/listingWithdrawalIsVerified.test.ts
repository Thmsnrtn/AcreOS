/**
 * DEFECT-0173 / 0174 — withdrawing a listing tells the truth per channel, a
 * take-down is scoped to the caller's own listing and verified by the
 * provider, and only held land can be offered.
 *
 *  - Unpublish marked EVERY target "removed" with no provider call.
 *  - The take-down route accepted any `externalListingId` from the body and
 *    sent a DELETE with the platform's own credentials — another tenant's
 *    listing included — and reported success whatever the provider answered.
 *  - Listing create / publish / syndicate / blast checked only that the
 *    property row belonged to the org; a "prospect" or SOLD parcel could be
 *    advertised as available.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const h = vi.hoisted(() => ({
  listing: null as null | Record<string, unknown>,
  property: null as null | Record<string, unknown>,
  updates: [] as Array<Record<string, unknown>>,
  fetchCalls: [] as string[],
  fetchStatus: 200,
}));

vi.mock("../../server/auth", () => ({
  isAuthenticated: (req: { user?: unknown }, _s: unknown, n: () => void) => {
    req.user = { id: "u1" };
    n();
  },
}));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: { organization?: unknown }, _s: unknown, n: () => void) => {
    req.organization = { id: 7, subscriptionTier: "pro" };
    n();
  },
}));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/storage", () => ({
  db: {},
  storage: {
    // Org-scoped: another org's listing is simply not found.
    getPropertyListing: async (orgId: number, id: number) =>
      orgId === 7 && h.listing && h.listing.id === id ? h.listing : undefined,
    updatePropertyListing: async (_id: number, patch: Record<string, unknown>) => {
      h.updates.push(patch);
      return { ...h.listing, ...patch };
    },
    getProperty: async () => h.property,
    getPropertyListingByPropertyId: async () => undefined,
    createPropertyListing: async (v: Record<string, unknown>) => ({ id: 1, ...v }),
  },
}));

globalThis.fetch = vi.fn(async (url: string) => {
  h.fetchCalls.push(String(url));
  return { ok: h.fetchStatus >= 200 && h.fetchStatus < 300, status: h.fetchStatus } as Response;
}) as unknown as typeof fetch;

import { takeDownListing } from "../../server/services/listingSyndication";
import { offerabilityRefusal } from "../../server/services/listability";

const target = (platform: string, status: string, listingId?: string) => ({ platform, status, listingId });

beforeEach(() => {
  h.updates.length = 0;
  h.fetchCalls.length = 0;
  h.fetchStatus = 200;
  process.env.LANDCOM_API_KEY = "k";
});

describe("DEFECT-0173 — takeDownListing believes the provider, not fetch()", () => {
  it("an HTTP 500 is a failure that says the listing may still be live", async () => {
    h.fetchStatus = 500;
    const r = await takeDownListing("land_com", "ext-1");
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/HTTP 500.*may still be live/);
  });
  it("a 2xx is a removal", async () => {
    expect((await takeDownListing("land_com", "ext-1")).success).toBe(true);
  });
});

describe("DEFECT-0173 — the routes", () => {
  const appWith = async () => {
    const app = express();
    app.use(express.json());
    const { registerTeamMessagingRoutes } = await import("../../server/routes-team-messaging");
    registerTeamMessagingRoutes(app);
    const { registerEliteFeatureRoutes } = await import("../../server/routes-elite-features");
    await registerEliteFeatureRoutes(app);
    return app;
  };

  it("unpublish never claims removal: live API targets need a take-down, others a manual removal", async () => {
    h.listing = {
      id: 5,
      status: "active",
      syndicationTargets: [
        target("land_com", "active", "ext-1"),
        target("craigslist", "active"),
        target("landwatch", "failed"),
      ],
    };
    const res = await request(await appWith()).post("/api/listings/5/unpublish");
    expect(res.status).toBe(200);
    const written = h.updates[0].syndicationTargets as Array<{ platform: string; status: string }>;
    expect(written.map((t) => t.status)).toEqual(["withdrawal_requested", "manual_action_required", "failed"]);
    expect(JSON.stringify(written)).not.toContain('"removed"');
    expect(h.fetchCalls).toHaveLength(0);
  });

  it("take-down of another org's listing is refused BEFORE any provider call", async () => {
    h.listing = { id: 5, syndicationTargets: [target("land_com", "active", "ext-1")] };
    const res = await request(await appWith())
      .post("/api/syndication/take-down")
      .send({ listingId: 99, platform: "land_com", externalListingId: "someone-elses" });
    expect(res.status).toBe(404);
    expect(h.fetchCalls).toHaveLength(0);
  });

  it("take-down uses the SAVED external id, not the body's, and records the provider's answer", async () => {
    h.listing = { id: 5, syndicationTargets: [target("land_com", "withdrawal_requested", "ext-1")] };
    h.fetchStatus = 500;
    const res = await request(await appWith())
      .post("/api/syndication/take-down")
      .send({ listingId: 5, platform: "land_com", externalListingId: "someone-elses" });
    expect(res.body.success).toBe(false);
    expect(h.fetchCalls[0]).toContain("/listings/ext-1");
    expect(h.fetchCalls[0]).not.toContain("someone-elses");
    const written = h.updates[0].syndicationTargets as Array<{ status: string }>;
    expect(written[0].status).toBe("withdrawal_failed");
  });
});

describe("DEFECT-0173 audit — the listing PUT edits content, never channel state", () => {
  const appWithPut = async () => {
    const app = express();
    app.use(express.json());
    const { registerTeamMessagingRoutes } = await import("../../server/routes-team-messaging");
    registerTeamMessagingRoutes(app);
    return app;
  };
  it.each([
    ["syndicationTargets", { syndicationTargets: [{ platform: "land_com", status: "active", listingId: "someone-elses" }] }],
    ["status", { status: "active" }],
    ["propertyId", { propertyId: 9 }],
    ["organizationId", { organizationId: 8 }],
  ])("a body carrying %s is refused and writes nothing", async (_k, body) => {
    h.listing = { id: 5, syndicationTargets: [target("land_com", "active", "ext-1")] };
    const res = await request(await appWithPut()).put("/api/listings/5").send(body);
    expect(res.status).toBe(400);
    expect(h.updates).toHaveLength(0);
  });
  it("a content edit still goes through, and only the content is written", async () => {
    h.listing = { id: 5, syndicationTargets: [] };
    const res = await request(await appWithPut()).put("/api/listings/5").send({ title: "Ten acres" });
    expect(res.status).toBe(200);
    expect(h.updates).toEqual([{ title: "Ten acres" }]);
  });
});

describe("DEFECT-0174 — only held land is offerable", () => {
  it.each(["owned", "listed", "under_contract"])("%s may be offered", (s) => {
    expect(offerabilityRefusal(s)).toBeNull();
  });
  it.each(["prospect", "offer_sent", "due_diligence", "sold", "deleted", null])("%s is refused", (s) => {
    expect(offerabilityRefusal(s)).toMatch(/can't be offered|not held/);
  });

  it.each([
    ["syndicationTargets", { syndicationTargets: [{ platform: "land_com", status: "active", listingId: "someone-elses" }] }],
    ["an active status", { status: "active" }],
    ["publishedAt", { publishedAt: "2026-09-01T00:00:00Z" }],
  ])("listing create refuses a body carrying %s (DEFECT-0173 audit)", async (_k, extra) => {
    h.property = { id: 3, status: "owned" };
    const app = express();
    app.use(express.json());
    const { registerTeamMessagingRoutes } = await import("../../server/routes-team-messaging");
    registerTeamMessagingRoutes(app);
    const res = await request(app).post("/api/listings").send({ propertyId: 3, title: "Five acres", askingPrice: "20000", ...extra });
    expect(res.status).toBe(400);
  });
  it("listing create accepts the client's draft body", async () => {
    h.property = { id: 3, status: "owned" };
    const app = express();
    app.use(express.json());
    const { registerTeamMessagingRoutes } = await import("../../server/routes-team-messaging");
    registerTeamMessagingRoutes(app);
    const res = await request(app)
      .post("/api/listings")
      .send({ propertyId: 3, title: "Five acres", askingPrice: "20000", status: "draft", photos: null, description: null });
    expect(res.status).toBe(201);
    expect(res.body.syndicationTargets).toBeUndefined();
  });

  it("listing create refuses a prospect parcel", async () => {
    h.property = { id: 3, status: "prospect" };
    const app = express();
    app.use(express.json());
    const { registerTeamMessagingRoutes } = await import("../../server/routes-team-messaging");
    registerTeamMessagingRoutes(app);
    const res = await request(app).post("/api/listings").send({ propertyId: 3, title: "Five acres", askingPrice: "20000" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not held/);
  });
});
