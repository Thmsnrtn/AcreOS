/**
 * GET /api/lots/economics-summary — the Finance door's subdivider
 * lot-economics roll-up (wave V2, founder ruling #11 2026-07-28,
 * docs/company/founder-decisions-2026-07-28.md §11).
 *
 * The subdivider persona's Finance hero (PersonaFinanceHero →
 * SubdividerLotEconomicsHero) needs an org-level aggregate over the
 * subdivision stack. This endpoint (server/routes-lot-basis.ts) serves it
 * from REAL stored rows only:
 *
 *   - plansCount          — subdivision_plans rows for the org
 *   - lotsAllocated       — lot_basis_allocations rows for the org
 *   - lotsSold            — allocations with realized_at set (COGS recorded)
 *   - basisAllocatedCents — SUM(allocated_basis_cents)
 *   - realizedSaleProceedsCents / realizedCogsCents — sums over REALIZED
 *     rows only ("where recorded" — never projected, never invented)
 *
 * These tests pin: route registration + middleware chain, the org-scoped
 * table reads, the exact response shape, honest zeros for an empty org,
 * and the standardized Errors.internal envelope on db failure.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks for routes-lot-basis's top-level imports ────────────────────────

const state = {
  // Rows served per db.select() call, in call order.
  callRows: [] as unknown[][],
  calls: [] as Array<{ table: unknown; where: unknown }>,
  shouldThrow: false,
};

vi.mock("../../server/db", () => ({
  db: {
    select: (_fields?: unknown) => ({
      from: (table: unknown) => ({
        where: (whereArg: unknown) => {
          if (state.shouldThrow) return Promise.reject(new Error("boom"));
          const idx = state.calls.length;
          state.calls.push({ table, where: whereArg });
          return Promise.resolve(state.callRows[idx] ?? []);
        },
      }),
    }),
  },
}));

vi.mock("../../server/auth", () => ({
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { id: "user_1", email: "brigid@example.com" };
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

import { registerLotBasisRoutes } from "../../server/routes-lot-basis";
import { subdivisionPlans, lotBasisAllocations } from "@shared/schema";

// ── Route harness (same pattern as verticalPackCatalogRoute.test.ts) ──────

type Handler = (req: any, res: any, next: (err?: unknown) => void) => unknown;

const routes = new Map<string, Handler[]>();
const appStub: any = {
  get: (path: string, ...handlers: Handler[]) => routes.set(`GET ${path}`, handlers),
  post: (path: string, ...handlers: Handler[]) => routes.set(`POST ${path}`, handlers),
};
registerLotBasisRoutes(appStub);

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

async function callSummaryRoute(): Promise<{ status: number; body: any }> {
  const handlers = routes.get("GET /api/lots/economics-summary");
  expect(handlers, "GET /api/lots/economics-summary must be registered").toBeDefined();
  const { res, done } = mockRes();
  const req: any = { headers: {}, params: {}, query: {} };
  const next = (err?: unknown) => {
    if (err) throw err;
  };
  for (const handler of handlers!) {
    await handler(req, res, next);
  }
  return done;
}

beforeEach(() => {
  state.callRows = [];
  state.calls = [];
  state.shouldThrow = false;
});

// ── Tests ─────────────────────────────────────────────────────────────────

describe("GET /api/lots/economics-summary — registration + chain", () => {
  it("is registered with the same auth chain as the rest of the file (3 handlers: isAuthenticated, getOrCreateOrg, handler)", () => {
    const handlers = routes.get("GET /api/lots/economics-summary");
    expect(handlers).toBeDefined();
    expect(handlers!.length).toBe(3);
  });

  it("does not disturb the existing lot-basis routes", () => {
    expect(routes.has("GET /api/parcels/:id/basis-allocation")).toBe(true);
    expect(routes.has("POST /api/parcels/:id/basis-allocation")).toBe(true);
    expect(routes.has("POST /api/lots/:childId/realize-cogs")).toBe(true);
  });
});

describe("GET /api/lots/economics-summary — aggregate shape", () => {
  it("reads subdivision_plans then lot_basis_allocations (org-scoped) and returns the exact roll-up shape", async () => {
    state.callRows = [
      [{ plansCount: 2 }],
      [{
        lotsAllocated: 12,
        lotsSold: 3,
        basisAllocatedCents: 48_000_00,
        realizedSaleProceedsCents: 21_500_00,
        realizedCogsCents: 12_000_00,
      }],
    ];

    const { status, body } = await callSummaryRoute();
    expect(status).toBe(200);
    // Both reads hit the REAL subdivision tables — the roll-up can never be
    // derived from anything else.
    expect(state.calls[0].table).toBe(subdivisionPlans);
    expect(state.calls[1].table).toBe(lotBasisAllocations);
    expect(state.calls).toHaveLength(2);
    // Exact shape the SubdividerLotEconomicsHero consumes.
    expect(body).toEqual({
      plansCount: 2,
      lotsAllocated: 12,
      lotsSold: 3,
      basisAllocatedCents: 48_000_00,
      realizedSaleProceedsCents: 21_500_00,
      realizedCogsCents: 12_000_00,
    });
  });

  it("coerces bigint-ish string sums to numbers (pg COUNT/SUM come back stringly)", async () => {
    state.callRows = [
      [{ plansCount: 1 }],
      [{
        lotsAllocated: 4,
        lotsSold: 1,
        basisAllocatedCents: "250000" as unknown as number,
        realizedSaleProceedsCents: "90000" as unknown as number,
        realizedCogsCents: "62500" as unknown as number,
      }],
    ];

    const { body } = await callSummaryRoute();
    expect(body.basisAllocatedCents).toBe(250000);
    expect(body.realizedSaleProceedsCents).toBe(90000);
    expect(body.realizedCogsCents).toBe(62500);
  });

  it("empty org → honest zeros across the board (never invented numbers)", async () => {
    state.callRows = [[], []];
    const { status, body } = await callSummaryRoute();
    expect(status).toBe(200);
    expect(body).toEqual({
      plansCount: 0,
      lotsAllocated: 0,
      lotsSold: 0,
      basisAllocatedCents: 0,
      realizedSaleProceedsCents: 0,
      realizedCogsCents: 0,
    });
  });
});

describe("GET /api/lots/economics-summary — failure envelope", () => {
  it("db failure → standardized Errors.internal envelope { error, message, statusCode: 500 }", async () => {
    state.shouldThrow = true;
    const { status, body } = await callSummaryRoute();
    expect(status).toBe(500);
    expect(body.statusCode).toBe(500);
    expect(typeof body.error).toBe("string");
    expect(typeof body.message).toBe("string");
  });
});
