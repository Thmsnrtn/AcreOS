/**
 * GET /api/verticals — the vertical catalog endpoint (founder decision
 * 2026-10-18: verticals are included profiles, not paid add-ons).
 *
 * This endpoint is the catalog the pricing page renders. These tests pin
 * its honesty contract:
 *
 *   1. EVERY vertical is listed — including non-selectable (waitlisted)
 *      ones, each carrying a plain-words waitlistReason. Hiding a promised
 *      vertical is a silent broken promise.
 *   2. NO prices anywhere in the payload — verticals are never priced.
 *   3. `selected` reflects the org's real org_vertical_packs rows using the
 *      schema's own active contract (status='active' AND cancel_at NULL or
 *      in the future). Anonymous requests get selected:false and NO db read.
 *   4. `selectable` agrees with isVerticalSelectable, the single maturity
 *      gate the select route enforces.
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
  isVerticalSelectable,
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

async function callVerticalsRoute(req: any): Promise<{ status: number; body: any }> {
  const handlers = routes.get("GET /api/verticals");
  expect(handlers, "GET /api/verticals must be registered").toBeDefined();
  const { res, done } = mockRes();
  const next = (err?: unknown) => {
    if (err) throw err;
  };
  for (const handler of handlers!) {
    await handler(req, res, next);
  }
  return done;
}

async function callSelectRoute(req: any): Promise<{ status: number; body: any }> {
  const handlers = routes.get("POST /api/verticals/select");
  expect(handlers, "POST /api/verticals/select must be registered").toBeDefined();
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

describe("GET /api/verticals — catalog shape", () => {
  it("lists EVERY vertical from VERTICAL_PACKS, including non-selectable ones", async () => {
    const { body } = await callVerticalsRoute(anonReq());
    const keys = body.verticals.map((p: any) => p.key).sort();
    expect(keys).toEqual(Object.keys(VERTICAL_PACKS).sort());
  });

  it("carries NO prices — verticals are never priced", async () => {
    const { body } = await callVerticalsRoute(anonReq());
    for (const p of body.verticals) {
      expect(p, p.key).not.toHaveProperty("priceMonthly");
      expect(p, p.key).not.toHaveProperty("priceYearly");
      expect(p, p.key).not.toHaveProperty("priceMonthlyCents");
      expect(p, p.key).not.toHaveProperty("priceYearlyCents");
      expect(p, p.key).not.toHaveProperty("stripeConfigured");
      expect(p, p.key).not.toHaveProperty("purchasable");
      expect(p, p.key).not.toHaveProperty("owned");
    }
  });

  it("copy comes straight from VERTICAL_PACKS — never invented", async () => {
    const { body } = await callVerticalsRoute(anonReq());
    for (const p of body.verticals) {
      const source = VERTICAL_PACKS[p.key as VerticalPackKey];
      expect(p.name).toBe(source.displayName);
      expect(p.tagline).toBe(source.tagline);
      expect(p.features).toEqual(source.features);
      expect(p.businessTypeId).toBe(source.businessTypeId);
    }
  });

  it("selectability exactly agrees with isVerticalSelectable (the single maturity gate)", async () => {
    const { body } = await callVerticalsRoute(anonReq());
    for (const p of body.verticals) {
      expect(p.selectable, p.key).toBe(isVerticalSelectable(p.key));
    }
  });

  it("non-selectable verticals carry the plain-words waitlist reason; selectable ones carry null", async () => {
    const { body } = await callVerticalsRoute(anonReq());
    for (const p of body.verticals) {
      if (p.selectable) {
        expect(p.waitlistReason, p.key).toBeNull();
      } else {
        expect(p.waitlistReason, p.key).toBe(
          "On the waitlist until this vertical is production-ready",
        );
      }
    }
  });

  it("the old pack catalog and checkout routes are gone", async () => {
    expect(routes.get("GET /api/billing/packs")).toBeUndefined();
    expect(routes.get("POST /api/billing/packs/checkout")).toBeUndefined();
    expect(routes.get("POST /api/billing/packs")).toBeUndefined();
  });
});

describe("GET /api/verticals — selected detection", () => {
  it("anonymous request: authenticated=false, every vertical selected=false, and NO db read", async () => {
    const { body } = await callVerticalsRoute(anonReq());
    expect(body.authenticated).toBe(false);
    for (const p of body.verticals) expect(p.selected).toBe(false);
    expect(state.packSelects).toBe(0);
  });

  it("authenticated org: selected=true only for active, non-expired org_vertical_packs rows", async () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
    state.packRows = [
      { packKey: "note_investor", status: "active", cancelAt: null },
      { packKey: "wholesale", status: "cancelled", cancelAt: null }, // deselected → not selected
      { packKey: "buy_and_hold", status: "active", cancelAt: past }, // cancel window elapsed → not selected
      { packKey: "subdivision", status: "active", cancelAt: future }, // active until future cancel → selected
    ];

    const { body } = await callVerticalsRoute(authedReq());
    expect(body.authenticated).toBe(true);
    expect(state.packSelects).toBe(1);

    const selectedByKey = Object.fromEntries(body.verticals.map((p: any) => [p.key, p.selected]));
    expect(selectedByKey).toMatchObject({
      note_investor: true,
      wholesale: false,
      buy_and_hold: false,
      subdivision: true,
      fix_and_flipper: false,
    });
  });

  it("a selected-but-waitlisted vertical still shows BOTH truths (selected + not selectable)", async () => {
    // An org that selected a vertical before it was demoted must still
    // see it as selected — selection and selectability are independent facts.
    state.packRows = [{ packKey: "fix_and_flipper", status: "active", cancelAt: null }];
    const { body } = await callVerticalsRoute(authedReq());
    const flip = body.verticals.find((p: any) => p.key === "fix_and_flipper");
    expect(flip.selected).toBe(true);
    expect(flip.selectable).toBe(isVerticalSelectable("fix_and_flipper"));
  });
});

describe("POST /api/verticals/select — registered", () => {
  it("is registered (selection writes go through it, not Stripe)", async () => {
    expect(routes.get("POST /api/verticals/select")).toBeDefined();
    expect(routes.get("POST /api/verticals/deselect")).toBeDefined();
  });
});
