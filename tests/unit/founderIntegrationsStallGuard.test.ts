/**
 * GET /api/founder/integrations — the B-7 onboarding aging list is
 * guarded (#631 audit follow-up).
 *
 * Before this fix the route awaited `listOnboardingStalls()` bare: a
 * throw from that one read failed the WHOLE integrations endpoint
 * with a 500, even though the endpoint's own payload (which
 * integrations are configured) was already computed. The Bridge route
 * wraps the same read in safe() and degrades to an empty queue; this
 * route now degrades the same way — 200, an empty aging list, and a
 * zeroed stall summary — while a healthy read is served verbatim.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks for the route's auth/infra/service imports ──────────────────────

const state = {
  isFounder: true,
  stalls: null as unknown,
  stallsError: null as Error | null,
};

vi.mock("../../server/services/connectOnboardingStalls", () => ({
  listOnboardingStalls: async () => {
    if (state.stallsError) throw state.stallsError;
    return state.stalls ?? [];
  },
}));

vi.mock("../../server/auth", () => ({
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { id: "founder_1", email: "founder@example.com" };
    req.isFounder = state.isFounder;
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

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { registerFounderIntegrationsRoutes } from "../../server/routes-founder-integrations";

// ── Route harness (same pattern as acquiredNotesListIsPaged.test.ts) ──────

type Handler = (req: any, res: any, next: (err?: unknown) => void) => unknown;

const routes = new Map<string, Handler[]>();
const appStub: any = {
  get: (path: string, ...handlers: Handler[]) => routes.set(`GET ${path}`, handlers),
  post: (path: string, ...handlers: Handler[]) => routes.set(`POST ${path}`, handlers),
  patch: (path: string, ...handlers: Handler[]) => routes.set(`PATCH ${path}`, handlers),
  delete: (path: string, ...handlers: Handler[]) => routes.set(`DELETE ${path}`, handlers),
};
registerFounderIntegrationsRoutes(appStub);

function mockRes() {
  let resolve!: (v: { status: number; body: any }) => void;
  const done = new Promise<{ status: number; body: any }>((r) => (resolve = r));
  const res: any = {
    statusCode: 200,
    getHeader: () => undefined,
    setHeader: () => undefined,
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

async function callIntegrations(): Promise<{ status: number; body: any }> {
  const handlers = routes.get("GET /api/founder/integrations");
  expect(handlers, "GET /api/founder/integrations must be registered").toBeDefined();
  const { res, done } = mockRes();
  const req: any = { headers: {}, params: {}, query: {} };
  for (const handler of handlers!) await handler(req, res, (err?: unknown) => { if (err) throw err; });
  return done;
}

beforeEach(() => {
  state.isFounder = true;
  state.stalls = null;
  state.stallsError = null;
});

describe("GET /api/founder/integrations — stall-list guard", () => {
  it("a throwing stall read degrades to 200 with an empty aging list, not a 500", async () => {
    state.stallsError = new Error("db read failed");
    const { status, body } = await callIntegrations();
    expect(status).toBe(200);
    expect(Array.isArray(body.integrations)).toBe(true);
    expect(body.integrations.length).toBeGreaterThan(0);
    expect(body.connectOnboardingStalls).toEqual([]);
    expect(body.onboardingStallSummary).toEqual({ stalled: 0, alerted: 0 });
  });

  it("a healthy stall read is served verbatim with its summary", async () => {
    const stall = {
      organizationId: 102,
      organizationName: "Org 102",
      accountId: "acct_stalled_1",
      requirements: ["tos_acceptance.date"],
      firstSeenStuckAt: "2026-11-11T12:00:00.000Z",
      daysStuck: 8,
      alertedAt: "2026-11-19T12:00:00.000Z",
      lastValidatedAt: "2026-11-19T11:00:00.000Z",
      chargesEnabled: false,
    };
    state.stalls = [stall];
    const { status, body } = await callIntegrations();
    expect(status).toBe(200);
    expect(body.connectOnboardingStalls).toEqual([stall]);
    expect(body.onboardingStallSummary).toEqual({ stalled: 1, alerted: 1 });
  });

  it("a non-founder is still refused before any stall read matters", async () => {
    state.isFounder = false;
    state.stallsError = new Error("db read failed");
    const { status } = await callIntegrations();
    expect(status).toBe(403);
  });
});
