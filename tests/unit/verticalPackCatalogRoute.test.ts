/**
 * GET /api/billing/packs — the vertical-pack catalog endpoint (wave V1,
 * founder ruling #11 2026-07-28: activate verticals as builds pass the
 * honesty bar).
 *
 * The pack substrate (VERTICAL_PACKS, checkout, webhook activation) was
 * server-only with zero client surface. This endpoint is the catalog the
 * pricing page renders. These tests pin its honesty contract:
 *
 *   1. EVERY pack is listed — including non-purchasable (waitlisted) ones,
 *      each carrying a plain-words waitlistReason. Hiding a promised
 *      vertical is a silent broken promise.
 *   2. Prices come from VERTICAL_PACKS (shared/billing/tier-pricing.ts) —
 *      never invented, never drifting.
 *   3. `owned` reflects the org's real org_vertical_packs rows using the
 *      schema's own active contract (status='active' AND cancel_at NULL or
 *      in the future). Anonymous requests get owned:false and NO db read.
 *   4. `stripeConfigured` truthfully reports whether the price env vars
 *      exist, so the client can render "purchase not yet enabled" instead
 *      of a live button that 503s.
 *
 * Purchasability itself is NOT re-derived here — the endpoint must agree
 * with isVerticalPackPurchasable, the single maturity gate the checkout
 * route enforces.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks for routes-billing's top-level imports ──────────────────────────

const state = {
  packRows: [] as Array<{ packKey: string; status: string; cancelAt: Date | null }>,
  packSelects: 0,
};

vi.mock("../../server/storage", () => ({
  storage: {},
  db: {
    select: (_fields?: unknown) => ({
      from: (_t: unknown) => ({
        where: (_w: unknown) => {
          state.packSelects += 1;
          return Promise.resolve(state.packRows);
        },
      }),
    }),
  },
}));

vi.mock("@shared/schema", () => ({
  SUBSCRIPTION_TIERS: {},
  cancellationSurveys: {},
  refundRequests: {},
  stripeProcessedEvents: {},
  orgVerticalPacks: {
    __k: "orgVerticalPacks",
    organizationId: "ovp.org",
    packKey: "ovp.pack",
    status: "ovp.status",
    cancelAt: "ovp.cancel_at",
  },
}));

// isAuthenticated / getOrCreateOrg — the standard chain the route composes.
// The mocks mirror what the real middleware attaches on success.
vi.mock("../../server/auth", () => ({
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { id: "user_1", email: "owner@example.com" };
    next();
  },
}));

vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: any, _res: any, next: any) => {
    req.organization = { id: 7, name: "Test Org" };
    req.organizationId = 7;
    next();
  },
}));

vi.mock("../../server/middleware/idempotency", () => ({
  idempotencyMiddleware: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../server/services/usageLimits", () => ({
  getAllUsageLimits: vi.fn(),
  TIER_LIMITS: {},
}));

vi.mock("../../server/utils/permissions", () => ({
  requirePermission: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../server/utils/auditLog", () => ({
  auditFromRequest: vi.fn(),
  AuditActions: {},
}));

vi.mock("../../server/utils/customerAudit", () => ({
  customerAuditFromRequest: vi.fn(),
  CustomerAuditActions: {},
}));

vi.mock("../../server/db", () => ({
  withTransaction: vi.fn(),
}));

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { registerBillingRoutes } from "../../server/routes-billing";
import {
  VERTICAL_PACKS,
  isVerticalPackPurchasable,
  type VerticalPackKey,
} from "../../shared/billing/tier-pricing";

// ── Route harness ─────────────────────────────────────────────────────────

type Handler = (req: any, res: any, next: (err?: unknown) => void) => unknown;

const routes = new Map<string, Handler[]>();
const appStub: any = {
  get: (path: string, ...handlers: Handler[]) => routes.set(`GET ${path}`, handlers),
  post: (path: string, ...handlers: Handler[]) => routes.set(`POST ${path}`, handlers),
};
registerBillingRoutes(appStub);

function mockRes() {
  let resolve!: (v: { status: number; body: any }) => void;
  const done = new Promise<{ status: number; body: any }>((r) => (resolve = r));
  const res: any = {
    statusCode: 200,
    getHeader: () => undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: any) {
      resolve({ status: this.statusCode, body });
      return this;
    },
  };
  return { res, done };
}

async function callPacksRoute(req: any): Promise<{ status: number; body: any }> {
  const handlers = routes.get("GET /api/billing/packs");
  expect(handlers, "GET /api/billing/packs must be registered").toBeDefined();
  const { res, done } = mockRes();
  const next = (err?: unknown) => {
    if (err) throw err;
  };
  for (const handler of handlers!) {
    await handler(req, res, next);
  }
  return done;
}

beforeEach(() => {
  state.packRows = [];
  state.packSelects = 0;
});

const anonReq = () => ({ headers: {} });
const authedReq = () => ({ headers: { cookie: "__session=jwt" }, auth: { userId: "user_1" } });

// ── Tests ─────────────────────────────────────────────────────────────────

describe("GET /api/billing/packs — catalog shape", () => {
  it("lists EVERY pack from VERTICAL_PACKS, including non-purchasable ones", async () => {
    const { body } = await callPacksRoute(anonReq());
    const keys = body.packs.map((p: any) => p.key).sort();
    expect(keys).toEqual(Object.keys(VERTICAL_PACKS).sort());
  });

  it("prices come straight from VERTICAL_PACKS — never invented", async () => {
    const { body } = await callPacksRoute(anonReq());
    for (const p of body.packs) {
      const source = VERTICAL_PACKS[p.key as VerticalPackKey];
      expect(p.name).toBe(source.displayName);
      expect(p.tagline).toBe(source.tagline);
      expect(p.businessTypeId).toBe(source.businessTypeId);
      expect(p.priceMonthly).toBe(source.priceMonthlyCents / 100);
      expect(p.priceYearly).toBe(source.priceYearlyCents / 100);
    }
  });

  it("purchasability exactly agrees with isVerticalPackPurchasable (the single maturity gate)", async () => {
    const { body } = await callPacksRoute(anonReq());
    for (const p of body.packs) {
      expect(p.purchasable, p.key).toBe(isVerticalPackPurchasable(p.key));
    }
  });

  it("non-purchasable packs carry the plain-words waitlist reason; purchasable ones carry null", async () => {
    const { body } = await callPacksRoute(anonReq());
    for (const p of body.packs) {
      if (p.purchasable) {
        expect(p.waitlistReason, p.key).toBeNull();
      } else {
        expect(p.waitlistReason, p.key).toBe(
          "On the waitlist until this vertical is production-ready",
        );
      }
    }
  });

  it("stripeConfigured truthfully mirrors the price IDs the checkout route would use", async () => {
    const { body } = await callPacksRoute(anonReq());
    for (const p of body.packs) {
      const source = VERTICAL_PACKS[p.key as VerticalPackKey];
      expect(p.stripeConfigured).toEqual({
        monthly: Boolean(source.stripePriceIdMonthly),
        yearly: Boolean(source.stripePriceIdYearly),
      });
    }
  });
});

describe("GET /api/billing/packs — owned detection", () => {
  it("anonymous request: authenticated=false, every pack owned=false, and NO db read", async () => {
    const { body } = await callPacksRoute(anonReq());
    expect(body.authenticated).toBe(false);
    for (const p of body.packs) expect(p.owned).toBe(false);
    expect(state.packSelects).toBe(0);
  });

  it("authenticated org: owned=true only for active, non-expired org_vertical_packs rows", async () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
    state.packRows = [
      { packKey: "note_investor", status: "active", cancelAt: null },
      { packKey: "wholesale", status: "cancelled", cancelAt: null }, // cancelled → not owned
      { packKey: "buy_and_hold", status: "active", cancelAt: past }, // cancel window elapsed → not owned
      { packKey: "subdivision", status: "active", cancelAt: future }, // active until future cancel → owned
    ];

    const { body } = await callPacksRoute(authedReq());
    expect(body.authenticated).toBe(true);
    expect(state.packSelects).toBe(1);

    const ownedByKey = Object.fromEntries(body.packs.map((p: any) => [p.key, p.owned]));
    expect(ownedByKey).toMatchObject({
      note_investor: true,
      wholesale: false,
      buy_and_hold: false,
      subdivision: true,
      fix_and_flipper: false,
    });
  });

  it("an owned-but-waitlisted pack still shows BOTH truths (owned + not purchasable)", async () => {
    // An org that bought a pack before its vertical was demoted must still
    // see it as active — ownership and purchasability are independent facts.
    state.packRows = [{ packKey: "fix_and_flipper", status: "active", cancelAt: null }];
    const { body } = await callPacksRoute(authedReq());
    const flip = body.packs.find((p: any) => p.key === "fix_and_flipper");
    expect(flip.owned).toBe(true);
    expect(flip.purchasable).toBe(isVerticalPackPurchasable("fix_and_flipper"));
  });
});
