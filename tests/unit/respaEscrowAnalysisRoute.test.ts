/**
 * GET /api/notes/:id/escrow-analysis — RESPA §1024.17 annual escrow ANALYSIS.
 *
 * Wires server/services/respaEscrowAnalysis.ts (previously a module orphan —
 * its only reference anywhere was a Pax persona capability comment) to a
 * single org-gated read-only GET on the notes router. These tests pin the
 * honest contract of that wiring:
 *
 *   1. Registered with the full auth chain (isAuthenticated, getOrCreateOrg,
 *      ownerOrAdmin, handler).
 *   2. Serves the SELLER-FINANCE (originated) `notes` book only — the schema
 *      the analyzer actually reads. Acquired-book ids (uuids) are refused
 *      with an explanation, never silently coerced.
 *   3. Org-scoped: a note outside the caller's org is a 404, and the module
 *      is never invoked for it.
 *   4. Honesty flags ride the response: `annualStatementProduced: false`
 *      (the §1024.17(i) STATEMENT is deliberately unwired) and
 *      `analysis.projectionSource` marks a trailing-12-month proxy
 *      projection as a proxy, not an operator-supplied schedule.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks for routes-notes's auth/infra imports ───────────────────────────

const state = {
  // Rows served per db.select() call, in call order.
  callRows: [] as unknown[][],
  calls: [] as Array<{ table: unknown }>,
};

vi.mock("../../server/db", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    db: {
      select: (_fields?: unknown) => ({
        from: (table: unknown) => {
          const idx = state.calls.length;
          state.calls.push({ table });
          const rows = () => Promise.resolve(state.callRows[idx] ?? []);
          const chain: any = {
            where: () => chain,
            limit: () => rows(),
            then: (onF: any, onR: any) => rows().then(onF, onR),
          };
          return chain;
        },
      }),
    },
  };
});

vi.mock("../../server/auth", () => ({
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { id: "user_1", email: "operator@example.com" };
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

vi.mock("../../server/middleware/roleGuard", () => ({
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { registerNoteRoutes } from "../../server/routes-notes";
import { notes, taxEscrowPayments } from "@shared/schema";

// ── Route harness (same pattern as lotEconomicsSummaryRoute.test.ts) ──────

type Handler = (req: any, res: any, next: (err?: unknown) => void) => unknown;

const routes = new Map<string, Handler[]>();
const appStub: any = {
  get: (path: string, ...handlers: Handler[]) => routes.set(`GET ${path}`, handlers),
  post: (path: string, ...handlers: Handler[]) => routes.set(`POST ${path}`, handlers),
  patch: (path: string, ...handlers: Handler[]) => routes.set(`PATCH ${path}`, handlers),
  delete: (path: string, ...handlers: Handler[]) => routes.set(`DELETE ${path}`, handlers),
};
registerNoteRoutes(appStub);

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

async function callEscrowAnalysis(
  id: string,
  query: Record<string, string> = {},
): Promise<{ status: number; body: any }> {
  const handlers = routes.get("GET /api/notes/:id/escrow-analysis");
  expect(handlers, "GET /api/notes/:id/escrow-analysis must be registered").toBeDefined();
  const { res, done } = mockRes();
  const req: any = { headers: {}, params: { id }, query };
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
});

// ── Fixtures ──────────────────────────────────────────────────────────────

/** Route pre-check row (org-scoped select of id + taxEscrowEnabled). */
const PRECHECK_ROW = { id: 12, taxEscrowEnabled: true };

/** Full seller-finance note row as the analyzer re-reads it (org-scoped). */
const NOTE_ROW = {
  id: 12,
  organizationId: 7,
  taxEscrowEnabled: true,
  monthlyTaxEscrow: "200.00",
  taxEscrowBalance: "600.00",
};

/** One recorded county tax payment in the trailing year (the proxy source). */
const TRAILING_PAYMENT = {
  paymentDate: new Date("2026-03-15T00:00:00.000Z"),
  amountPaid: "2400.00",
  installment: "annual",
  taxYear: 2025,
};

// ── Tests ─────────────────────────────────────────────────────────────────

describe("GET /api/notes/:id/escrow-analysis — registration + chain", () => {
  it("is registered with the file's full auth chain (4 handlers: isAuthenticated, getOrCreateOrg, ownerOrAdmin, handler)", () => {
    const handlers = routes.get("GET /api/notes/:id/escrow-analysis");
    expect(handlers).toBeDefined();
    expect(handlers!.length).toBe(4);
  });

  it("does not disturb neighboring note routes", () => {
    expect(routes.has("GET /api/notes/:id/amortization")).toBe(true);
    expect(routes.has("GET /api/notes/escrow-disbursements")).toBe(true);
    expect(routes.has("POST /api/notes/from-deal/:dealId")).toBe(true);
  });
});

describe("GET /api/notes/:id/escrow-analysis — the honest analysis contract", () => {
  it("serves an org-scoped §1024.17 analysis off the seller-finance book with the proxy projection FLAGGED", async () => {
    state.callRows = [[PRECHECK_ROW], [NOTE_ROW], [TRAILING_PAYMENT]];

    const { status, body } = await callEscrowAnalysis("12", {
      computationYearStart: "2026-06-01",
    });
    expect(status).toBe(200);

    // Reads the seller-finance `notes` table (pre-check + analyzer), then the
    // recorded tax_escrow_payments — never the acquired book.
    expect(state.calls[0].table).toBe(notes);
    expect(state.calls[1].table).toBe(notes);
    expect(state.calls[2].table).toBe(taxEscrowPayments);
    expect(state.calls).toHaveLength(3);

    // Book + money-unit discriminators, same convention as the rest of the file.
    expect(body.book).toBe("seller_finance");
    expect(body.moneyUnit).toBe("integer_cents");

    // §1024.17 arithmetic off the supplied rows: $2,400 annual disbursements
    // → cushion cap floor(240000/6) = 40000¢; $200/mo deposits from a $600
    // opening balance bottom out at 20000¢ → shortage of 20000¢.
    expect(body.analysis.noteId).toBe(12);
    expect(body.analysis.totalProjectedAnnualDisbursementsCents).toBe(240000);
    expect(body.analysis.maxCushionCents).toBe(40000);
    expect(body.analysis.status).toBe("shortage");
    expect(body.analysis.shortageCents).toBe(20000);
    expect(body.analysis.requiredAction.code).toBe("shortage_collect_lump_or_spread");

    // HONESTY: no operator projection was supplied, so the projection is the
    // trailing-12-month proxy and says so — never passed off as a schedule.
    expect(body.analysis.projectionSource).toBe("trailing_12mo_proxy");

    // HONESTY: the §1024.17(i) annual STATEMENT was NOT produced or delivered
    // by this endpoint — the statement builder is deliberately unwired.
    expect(body.annualStatementProduced).toBe(false);
    expect(body).not.toHaveProperty("statement");
  });

  it("404s a note outside the caller's org (org-scoped pre-check) without invoking the analyzer", async () => {
    state.callRows = [[]]; // org-scoped pre-check finds nothing
    const { status } = await callEscrowAnalysis("12");
    expect(status).toBe(404);
    expect(state.calls).toHaveLength(1); // analyzer never ran
  });

  it("400s a note without tax escrow enabled — §1024.17 analysis is N/A, not fabricated", async () => {
    state.callRows = [[{ id: 12, taxEscrowEnabled: false }]];
    const { status, body } = await callEscrowAnalysis("12");
    expect(status).toBe(400);
    expect(body.message).toMatch(/tax escrow/i);
    expect(state.calls).toHaveLength(1); // analyzer never ran
  });

  it("refuses acquired-book (uuid) ids with the reason, before any db read", async () => {
    const { status, body } = await callEscrowAnalysis("33333333-3333-3333-3333-333333333333");
    expect(status).toBe(400);
    expect(body.message).toMatch(/[Aa]cquired notes are not supported/);
    expect(state.calls).toHaveLength(0);
  });

  it("rejects a malformed computationYearStart", async () => {
    state.callRows = [[PRECHECK_ROW]];
    const { status, body } = await callEscrowAnalysis("12", {
      computationYearStart: "not-a-date",
    });
    expect(status).toBe(400);
    expect(body.message).toContain("computationYearStart");
  });
});
