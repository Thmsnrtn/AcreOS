/**
 * DEFECT-0182 — the manual "send to channels" route records what it posted
 * and never re-posts a withdrawn listing or target.
 *
 * `POST /api/listings/:id/syndicate` pushed to whatever platforms the body
 * named: a withdrawn listing, a channel where the listing was already live
 * or still coming down. It spread a body `overrides` over the price and
 * terms, and it saved NOTHING — so a posting made here had no stored
 * external id and the take-down route could never remove it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { getTableName } from "drizzle-orm";

const h = vi.hoisted(() => ({
  listing: null as null | Record<string, unknown>,
  writes: [] as Array<Record<string, unknown>>,
  pushed: [] as Array<{ platforms: string[]; askingPrice: unknown }>,
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
vi.mock("../../server/db", () => {
  const select = () => {
    let table = "";
    const q: Record<string, unknown> = {};
    q.from = (t: Parameters<typeof getTableName>[0]) => {
      table = getTableName(t);
      return q;
    };
    q.where = async () => (table === "properties" ? [{ id: 3, organizationId: 7, status: "owned" }] : table === "organizations" ? [{ id: 7 }] : []);
    return q;
  };
  return { db: { select } };
});
vi.mock("../../server/storage", () => ({
  db: {},
  storage: {
    getPropertyListing: async (orgId: number, id: number) => (orgId === 7 && h.listing && h.listing.id === id ? h.listing : undefined),
    updatePropertyListing: async (_id: number, patch: Record<string, unknown>) => {
      h.writes.push(patch);
      return { ...h.listing, ...patch };
    },
  },
}));
vi.mock("../../server/services/listingSyndication", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  buildNormalizedListing: async (_p: unknown, _o: unknown, terms: { askingPrice: unknown }) => ({ askingPrice: terms.askingPrice }),
  // Mirrors the real adapter: Lands of America posts through Land.com and
  // reports `land_com`; Craigslist returns copy/paste text, no external id.
  syndicateListing: async (n: { askingPrice: unknown }, platforms: string[]) => {
    h.pushed.push({ platforms, askingPrice: n.askingPrice });
    return platforms.map((p) =>
      p === "craigslist"
        ? { platform: "craigslist", success: true, requiresManualAction: true, preformattedText: "..." }
        : {
            platform: p === "lands_of_america" ? "land_com" : p,
            success: true,
            listingId: `ext-${p}`,
            listingUrl: `https://x/${p}`,
          },
    );
  },
}));

import { registerEliteFeatureRoutes } from "../../server/routes-elite-features";

let app: express.Express;
beforeEach(async () => {
  h.writes = [];
  h.pushed = [];
  h.listing = { id: 5, propertyId: 3, status: "active", askingPrice: "20000", syndicationTargets: [] };
  if (!app) {
    app = express();
    app.use(express.json());
    await registerEliteFeatureRoutes(app);
  }
});

describe("POST /api/listings/:id/syndicate", () => {
  it("records each posting's external id on the listing, so take-down can find it", async () => {
    const res = await request(app).post("/api/listings/5/syndicate").send({ platforms: ["land_com"] });
    expect(res.status).toBe(200);
    const targets = h.writes[0].syndicationTargets as Array<Record<string, unknown>>;
    expect(targets).toEqual([expect.objectContaining({ platform: "land_com", listingId: "ext-land_com", status: "active" })]);
  });

  it("ignores a body 'overrides' price: the portal shows what the listing records", async () => {
    await request(app).post("/api/listings/5/syndicate").send({ platforms: ["land_com"], overrides: { askingPrice: 1 } });
    expect(h.pushed[0].askingPrice).toBe(20000);
  });

  it.each(["withdrawn", "sold", "draft"])("a %s listing is refused before any provider call", async (status) => {
    h.listing = { ...h.listing, status };
    const res = await request(app).post("/api/listings/5/syndicate").send({ platforms: ["land_com"] });
    expect(res.status).toBe(400);
    expect(h.pushed).toHaveLength(0);
  });

  it.each(["active", "withdrawal_requested", "withdrawal_failed", "manual_action_required"])(
    "a channel whose target is %s is not posted to again",
    async (status) => {
      h.listing = { ...h.listing, syndicationTargets: [{ platform: "land_com", status, listingId: "old" }] };
      const res = await request(app).post("/api/listings/5/syndicate").send({ platforms: ["land_com"] });
      expect(res.status).toBe(400);
      expect(h.pushed).toHaveLength(0);
    },
  );

  it("an alias cannot re-post over a live posting (Lands of America posts as Land.com)", async () => {
    h.listing = { ...h.listing, syndicationTargets: [{ platform: "land_com", status: "active", listingId: "old" }] };
    const res = await request(app).post("/api/listings/5/syndicate").send({ platforms: ["lands_of_america"] });
    expect(res.status).toBe(400);
    expect(h.pushed).toHaveLength(0);
  });

  it("a platform named twice is posted once; unknown platforms are dropped", async () => {
    await request(app).post("/api/listings/5/syndicate").send({ platforms: ["land_com", "land_com", "made_up"] });
    expect(h.pushed[0].platforms).toEqual(["land_com"]);
  });

  it("copy/paste text is recorded as a manual posting, never as a live one", async () => {
    await request(app).post("/api/listings/5/syndicate").send({ platforms: ["craigslist"] });
    const targets = h.writes[0].syndicationTargets as Array<Record<string, unknown>>;
    expect(targets[0]).toMatchObject({ platform: "craigslist", status: "manual_posting" });
    expect(targets[0].postedAt).toBeUndefined();
  });

  it.each(["removed", "failed", "manual_posting", "preview"])("a %s channel can be posted to again", async (status) => {
    h.listing = { ...h.listing, syndicationTargets: [{ platform: "land_com", status }] };
    const res = await request(app).post("/api/listings/5/syndicate").send({ platforms: ["land_com"] });
    expect(res.status).toBe(200);
    expect(h.pushed).toHaveLength(1);
  });
});
