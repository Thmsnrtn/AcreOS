/**
 * Checkout shows the renewal terms beside the pay button and records which
 * terms were consented to; cancel cancels — no required survey, no second
 * cancel step in a portal (Cal. Bus. & Prof. Code § 17602(a)(1), (a)(6), (d)(1)).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  checkouts: [] as any[],
  cancelled: [] as string[],
  portals: 0,
  org: { id: 7, name: "Mesa Land", stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1", subscriptionTier: "pro", billingInterval: "yearly", trialUsed: true } as any,
}));

vi.mock("../../server/storage", () => ({
  storage: { getPricingConfigForTier: async () => null, updateOrganization: async () => undefined },
  db: { insert: () => ({ values: async () => undefined }) },
}));
vi.mock("../../server/auth", () => ({ isAuthenticated: (_q: any, _s: any, n: any) => n() }));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: any, _s: any, n: any) => { req.organization = h.org; req.organizationId = 7; req.user = { id: "u1", email: "o@x.test" }; n(); },
}));
vi.mock("../../server/middleware/idempotency", () => ({ idempotencyMiddleware: (_q: any, _s: any, n: any) => n() }));
vi.mock("../../server/services/usageLimits", () => ({ getAllUsageLimits: vi.fn(), TIER_LIMITS: {} }));
vi.mock("../../server/utils/permissions", () => ({ requirePermission: () => (_q: any, _s: any, n: any) => n() }));
vi.mock("../../server/utils/auditLog", () => ({ auditFromRequest: vi.fn(), AuditActions: {} }));
vi.mock("../../server/utils/customerAudit", () => ({ customerAuditFromRequest: vi.fn(), CustomerAuditActions: {} }));
vi.mock("../../server/db", () => ({ withTransaction: vi.fn(), db: {} }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/routes-subscription", () => ({ recordSubscriptionHistoryEvent: async () => undefined }));
vi.mock("../../server/stripeService", () => ({
  stripeService: {
    getPrice: async () => ({ unit_amount: 49_000, currency: "usd", recurring: { interval: "year" }, metadata: { tier: "pro" } }),
    createCheckoutSession: async (...args: any[]) => { h.checkouts.push(args); return { url: "https://checkout.stripe.test/s" }; },
    cancelAtPeriodEnd: async (id: string) => { h.cancelled.push(id); return { current_period_end: 1_800_000_000 }; },
    createCustomerPortalSession: async () => { h.portals++; return { url: "https://portal.test" }; },
  },
}));

import { registerBillingRoutes } from "../../server/routes-billing";

type Handler = (req: any, res: any, next: (err?: unknown) => void) => unknown;
const routes = new Map<string, Handler[]>();
const appStub: any = {
  get: (p: string, ...hs: Handler[]) => routes.set(`GET ${p}`, hs),
  post: (p: string, ...hs: Handler[]) => routes.set(`POST ${p}`, hs),
  use: () => undefined, put: () => undefined, patch: () => undefined, delete: () => undefined,
};
registerBillingRoutes(appStub);

async function call(key: string, body: unknown) {
  const hs = routes.get(key);
  if (!hs) throw new Error(`${key} not registered`);
  const req: any = { body, headers: {}, query: {}, params: {}, protocol: "https", get: () => "app.test", ip: "1.1.1.1", socket: {} };
  const out = { status: 200, body: undefined as any };
  const res: any = { status(c: number) { out.status = c; return res; }, json(b: unknown) { out.body = b; return res; }, setHeader() {} };
  for (const hnd of hs) {
    let next = false;
    await hnd(req, res, () => { next = true; });
    if (!next) break;
  }
  return out;
}

beforeEach(() => { h.checkouts = []; h.cancelled = []; h.portals = 0; });

describe("checkout", () => {
  it("passes the renewal terms for the price bought, and records the terms version in the session metadata", async () => {
    const r = await call("POST /api/stripe/checkout", { priceId: "price_pro_year" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const [, , , , metadata, , options] = h.checkouts[0];
    expect(options.renewalTerms).toMatch(/renews automatically every year at \$490\.00/);
    expect(metadata).toEqual(expect.objectContaining({ auto_renewal_terms_version: expect.any(String), auto_renewal_price_cents: "49000", auto_renewal_interval: "year" }));
  });

});

describe("cancel", () => {
  it("cancels at period end directly, with no reason given, and opens no portal", async () => {
    const r = await call("POST /api/subscription/cancel", {});
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toEqual(expect.objectContaining({ cancelled: true }));
    expect(h.cancelled).toEqual(["sub_1"]);
    expect(h.portals).toBe(0);
  });
});
