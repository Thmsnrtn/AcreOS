/**
 * Founder ruling 2026-09-29 #3 (DEFECT-0106) — after the 90-day borrower
 * wind-down, the lender cannot mint a new Payment Link for a borrower.
 *
 * `GET /api/stripe/connect/payment-link/:noteId` is a GET, so the pause gate
 * lets a cancelled lender reach it; without its own phase check it minted new
 * links after the portal had told borrowers payments there had ended (found
 * by the independent audit of the wind-down).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  phase: { phase: "full" } as Record<string, unknown>,
  linksMinted: 0,
}));

vi.mock("../../server/storage", () => ({
  storage: { getNote: async (_org: number, id: number) => ({ id, monthlyPayment: "500" }) },
  db: {},
}));
vi.mock("../../server/auth", () => ({ isAuthenticated: (_q: any, _s: any, n: any) => n() }));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: any, _s: any, n: any) => {
    req.organization = { id: 7, name: "Mesa Land" };
    req.organizationId = 7;
    n();
  },
}));
vi.mock("../../server/middleware/idempotency", () => ({ idempotencyMiddleware: (_q: any, _s: any, n: any) => n() }));
vi.mock("../../server/services/usageLimits", () => ({ getAllUsageLimits: vi.fn(), TIER_LIMITS: {} }));
vi.mock("../../server/utils/permissions", () => ({ requirePermission: () => (_q: any, _s: any, n: any) => n() }));
vi.mock("../../server/utils/auditLog", () => ({ auditFromRequest: vi.fn(), AuditActions: {} }));
vi.mock("../../server/utils/customerAudit", () => ({ customerAuditFromRequest: vi.fn(), CustomerAuditActions: {} }));
vi.mock("../../server/db", () => ({ withTransaction: vi.fn(), db: {} }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/services/borrower/servicingPhase", async (orig) => ({
  ...(await orig<typeof import("../../server/services/borrower/servicingPhase")>()),
  lenderServicingPhase: async () => h.phase,
}));
vi.mock("../../server/services/stripeConnect", () => ({
  CustomerMoneyRefusedError: class extends Error {},
  stripeConnectService: {
    getPaymentLink: async () => {
      h.linksMinted++;
      return { url: "https://buy.stripe.com/x", paymentLinkId: "plink_1" };
    },
  },
}));

import { registerBillingRoutes } from "../../server/routes-billing";

type Handler = (req: any, res: any, next: (err?: unknown) => void) => unknown;
const routes = new Map<string, Handler[]>();
const appStub: any = {
  get: (path: string, ...handlers: Handler[]) => routes.set(`GET ${path}`, handlers),
  post: (path: string, ...handlers: Handler[]) => routes.set(`POST ${path}`, handlers),
  use: () => undefined,
  put: () => undefined,
  patch: () => undefined,
  delete: () => undefined,
};
registerBillingRoutes(appStub);

async function call(): Promise<{ status: number; body: any }> {
  const handlers = routes.get("GET /api/stripe/connect/payment-link/:noteId");
  if (!handlers) throw new Error("payment-link route not registered");
  const req: any = { params: { noteId: "42" }, headers: {}, query: {} };
  const out = { status: 200, body: undefined as any };
  const res: any = {
    status(code: number) {
      out.status = code;
      return res;
    },
    json(b: unknown) {
      out.body = b;
      return res;
    },
    setHeader() {},
  };
  for (const hnd of handlers) {
    let advanced = false;
    await hnd(req, res, () => {
      advanced = true;
    });
    if (!advanced) break;
  }
  return out;
}

beforeEach(() => {
  h.phase = { phase: "full" };
  h.linksMinted = 0;
});

describe("payment links follow the borrower wind-down", () => {
  it("after the wind-down, no link is minted and the lender is told why", async () => {
    h.phase = { phase: "ended", endedAt: new Date("2026-05-01T00:00:00Z"), windDownEndsAt: new Date("2026-07-30T00:00:00Z") };
    const r = await call();
    expect(r.status).toBe(400);
    expect(r.body.details.reason).toBe("lender_servicing_ended");
    expect(r.body.message).toMatch(/2026-05-01.*2026-07-30/);
    expect(h.linksMinted).toBe(0);
  });

  it("during the wind-down, and in full servicing, links are minted", async () => {
    expect((await call()).status).toBe(200);
    h.phase = { phase: "wind_down", endedAt: new Date("2026-09-01T00:00:00Z"), windDownEndsAt: new Date("2026-11-30T00:00:00Z") };
    expect((await call()).status).toBe(200);
    expect(h.linksMinted).toBe(2);
  });
});
