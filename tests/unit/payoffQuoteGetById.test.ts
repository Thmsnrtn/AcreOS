/**
 * GET /api/notes/:id/payoff/quotes/:quoteId — a non-UUID quoteId must
 * answer a clean 404, never a 500 (#639 audit follow-up, #631 follow-up
 * slice).
 *
 * `note_payoff_quotes.id` is a UUID column. Before this fix the route
 * passed `req.params.quoteId` straight into the lookup: a non-UUID
 * value made Postgres throw invalid-uuid and the handler's catch
 * returned 500 — for an id that simply has no quote. The sibling
 * L9-DEF-1 routes already shape-guard the note id; the quote id now
 * gets the same discipline (isUuidShape → 404 before any lookup).
 *
 * The database is mocked (the acquiredNotesListIsPaged pattern), so
 * the pin is the lookup itself: for a non-UUID quoteId the route must
 * never reach the database — against a real Postgres that call IS
 * the 500. A well-formed UUID still reads through: an issued quote
 * returns 200, an unknown one 404.
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
            orderBy: () => chain,
            limit: () => chain,
            offset: () => rows(),
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

// ── Route harness (same pattern as acquiredNotesListIsPaged.test.ts) ──────

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

async function callGetQuote(id: string, quoteId: string): Promise<{ status: number; body: any }> {
  const handlers = routes.get("GET /api/notes/:id/payoff/quotes/:quoteId");
  expect(handlers, "GET /api/notes/:id/payoff/quotes/:quoteId must be registered").toBeDefined();
  const { res, done } = mockRes();
  const req: any = { headers: {}, params: { id, quoteId }, query: {} };
  for (const handler of handlers!) await handler(req, res, (err?: unknown) => { if (err) throw err; });
  return done;
}

beforeEach(() => {
  state.callRows = [];
  state.calls = [];
});

const UUID = "123e4567-e89b-12d3-a456-426614174000";

describe("GET /api/notes/:id/payoff/quotes/:quoteId — quoteId shape guard", () => {
  it("a non-UUID quoteId answers 404 without ever reaching the database", async () => {
    const { status } = await callGetQuote("58", "not-a-uuid");
    expect(status).toBe(404);
    expect(state.calls).toHaveLength(0);
  });

  it("a numeric quoteId (the serviced-note shape) answers 404 without a lookup", async () => {
    const { status } = await callGetQuote("58", "12345");
    expect(status).toBe(404);
    expect(state.calls).toHaveLength(0);
  });

  it("a well-formed UUID for an issued quote returns 200 with the quote", async () => {
    const quoteRow = { id: UUID, organizationId: 7, noteRef: "58", totalPayoffCents: 5310000 };
    state.callRows = [[quoteRow]];
    const { status, body } = await callGetQuote("58", UUID);
    expect(status).toBe(200);
    expect(body.quote).toEqual(quoteRow);
    expect(state.calls).toHaveLength(1);
  });

  it("a well-formed but unknown UUID answers 404 through the lookup", async () => {
    state.callRows = [[]];
    const { status } = await callGetQuote("58", UUID);
    expect(status).toBe(404);
    expect(state.calls).toHaveLength(1);
  });
});
