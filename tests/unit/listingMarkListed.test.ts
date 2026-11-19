/**
 * L-DEF-1 (Option C, founder decision 2026-11-19) — "Mark as listed" is the
 * operator's own statement that a listing is on the market.
 *
 * Before this, a listing could never go on the market in production-shaped
 * use: the only door to `active` is a channel posting through AcreOS, no
 * channel is connectable yet, and the syndication surface refused anything
 * not already active. `listed` names the missing fact — the operator posted
 * it themselves, wherever they posted it — without spending `active`'s
 * strict meaning (a provider accepted a posting through AcreOS).
 *
 * The honesty invariants pinned here:
 *   - the write touches ONLY status + publishedAt: syndicationTargets keep
 *     saying exactly what AcreOS did (manual_posting, needs_credentials, …)
 *     and soldAt is never written;
 *   - no publish run is required first;
 *   - sold/withdrawn listings refuse (off the market);
 *   - an already-`active` listing refuses — downgrading it would understate
 *     a provider-proven fact;
 *   - re-marking a `listed` listing is a no-op (the on-market date stands);
 *   - another org's listing is not found (org-scoped read, as every
 *     listing route).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const h = vi.hoisted(() => ({
  listing: null as null | Record<string, unknown>,
  updates: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../server/services/tax/landExit", () => ({ refuseRedeemableDeedSpend: async () => true, taxHoldRefusal: async () => null, heldPropertyIds: async () => new Set<number>() }));
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
vi.mock("../../server/middleware/idempotency", () => ({
  idempotencyMiddleware: (_q: unknown, _s: unknown, n: () => void) => n(),
}));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/storage", async () => {
  const { getTableName } = await import("drizzle-orm");
  const db = {
    select: () => {
      let table = "";
      const q: Record<string, unknown> = {
        from: (t: Parameters<typeof getTableName>[0]) => {
          table = getTableName(t);
          return q;
        },
        where: async () => (table === "organizations" ? [{ id: 7, name: "Org" }] : []),
      };
      return q;
    },
  };
  return {
    db,
    storage: {
      // Org-scoped: another org's listing is simply not found.
      getPropertyListing: async (orgId: number, id: number) =>
        orgId === 7 && h.listing && h.listing.id === id ? h.listing : undefined,
      updatePropertyListing: async (_id: number, patch: Record<string, unknown>) => {
        h.updates.push(patch);
        return { ...h.listing, ...patch };
      },
    },
  };
});

const appWith = async () => {
  const app = express();
  app.use(express.json());
  const { registerTeamMessagingRoutes } = await import("../../server/routes-team-messaging");
  registerTeamMessagingRoutes(app);
  return app;
};

const targets = [
  { platform: "craigslist", status: "manual_posting" },
  { platform: "land_com", status: "needs_credentials" },
];

beforeEach(() => {
  h.updates.length = 0;
  h.listing = { id: 5, propertyId: 3, status: "draft", publishedAt: null, soldAt: null, syndicationTargets: targets };
});

describe("POST /api/listings/:id/mark-listed", () => {
  it("marks a draft listed: writes ONLY status + publishedAt, targets untouched", async () => {
    const res = await request(await appWith()).post("/api/listings/5/mark-listed").send({});
    expect(res.status).toBe(200);
    expect(h.updates).toHaveLength(1);
    const patch = h.updates[0];
    expect(Object.keys(patch).sort()).toEqual(["publishedAt", "status"]);
    expect(patch.status).toBe("listed");
    expect(patch.publishedAt).toBeInstanceOf(Date);
    // The response still carries the channels' own truth, unmodified.
    expect(res.body.syndicationTargets).toEqual(targets);
    expect(res.body.soldAt).toBeNull();
  });

  it("needs no publish run first: a draft with no targets at all can be marked", async () => {
    h.listing = { ...h.listing, syndicationTargets: [] };
    const res = await request(await appWith()).post("/api/listings/5/mark-listed").send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("listed");
  });

  it.each(["sold", "withdrawn"])("a %s listing refuses — it is off the market", async (status) => {
    h.listing = { ...h.listing, status };
    const res = await request(await appWith()).post("/api/listings/5/mark-listed").send({});
    expect(res.status).toBe(400);
    expect(h.updates).toHaveLength(0);
  });

  it("an already-active listing refuses — `listed` would understate a provider-proven fact", async () => {
    h.listing = { ...h.listing, status: "active" };
    const res = await request(await appWith()).post("/api/listings/5/mark-listed").send({});
    expect(res.status).toBe(400);
    expect(h.updates).toHaveLength(0);
  });

  it("re-marking a listed listing is a no-op: the original on-market date stands", async () => {
    const since = new Date("2026-11-01T00:00:00.000Z");
    h.listing = { ...h.listing, status: "listed", publishedAt: since };
    const res = await request(await appWith()).post("/api/listings/5/mark-listed").send({});
    expect(res.status).toBe(200);
    expect(h.updates).toHaveLength(0);
    expect(res.body.publishedAt).toBe(since.toISOString());
  });

  it("another org's listing is not found", async () => {
    const res = await request(await appWith()).post("/api/listings/99/mark-listed").send({});
    expect(res.status).toBe(404);
    expect(h.updates).toHaveLength(0);
  });
});
