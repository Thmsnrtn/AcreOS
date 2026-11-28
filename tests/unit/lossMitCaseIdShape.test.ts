/**
 * LM-DEF-1 — the `/api/loss-mit-cases/:id` handlers must never 500 on a
 * malformed (non-UUID) case id.
 *
 * Filed 2026-11-27 as an out-of-family observation from the N-D-DEF-1 cure
 * lane (Step-0: lossmit-caseid-step0-2026-11.md). `noteLossMitCases.id` is a
 * uuid primary key and `noteLossMitActions.caseId` a uuid foreign key, but
 * PATCH /api/loss-mit-cases/:id, GET /api/loss-mit-cases/:id/actions and
 * POST /api/loss-mit-cases/:id/actions each passed the raw route param into
 * equality on those columns with no shape guard — Postgres throws
 * invalid-uuid and the handler's catch turned it into a 500, the same crash
 * class as N-D-DEF-1.
 *
 * The cure is the same shape-first discipline as #883 / L9-DEF-1: each
 * handler refuses a non-UUID id with the family's existing 404
 * (Errors.notFound "Case") BEFORE any database call and — for PATCH and
 * POST — before the zod body parse. The database is mocked (the
 * notesAcquiredSubResourceIdShape pattern), so the pin is the lookup
 * itself: for a non-UUID id the route must never reach the database —
 * against a real Postgres that call IS the 500. A well-formed UUID still
 * reads through exactly as before: an own-org case is served, and an
 * unknown UUID — which is also what a cross-org UUID looks like to the
 * unchanged org-scoped queries — 404s through the lookup where the
 * handler has a lookup-driven 404 (PATCH, POST). GET …/actions has no
 * existence check by design, so an unknown UUID keeps its existing
 * pass-through behaviour (200 with an empty action list).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks for routes-notes's auth/infra imports ───────────────────────────

const state = {
  // Rows served per db.select() call, in call order.
  callRows: [] as unknown[][],
  // Rows served by db.update(...).returning().
  updateRows: [] as unknown[],
  // Rows served by db.insert(...).returning().
  insertRows: [] as unknown[],
  // Every database entry point touched (select / update / insert).
  touches: 0,
  // db.select() calls so far — indexes callRows.
  selectCount: 0,
  inserted: [] as unknown[],
};

vi.mock("../../server/db", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    db: {
      select: (_fields?: unknown) => ({
        from: (_table: unknown) => {
          state.touches += 1;
          const rows = () => Promise.resolve(state.callRows[state.selectCount++] ?? []);
          const chain: any = {
            where: () => chain,
            orderBy: () => chain,
            limit: () => rows(),
            offset: () => rows(),
            then: (onF: any, onR: any) => rows().then(onF, onR),
          };
          return chain;
        },
      }),
      update: (_table: unknown) => {
        state.touches += 1;
        return {
          set: (_values: unknown) => ({
            where: () => ({
              returning: () => Promise.resolve(state.updateRows),
              then: (onF: any, onR: any) => Promise.resolve(state.updateRows).then(onF, onR),
            }),
          }),
        };
      },
      insert: (_table: unknown) => {
        state.touches += 1;
        return {
          values: (values: unknown) => {
            state.inserted.push(values);
            return { returning: () => Promise.resolve(state.insertRows) };
          },
        };
      },
      delete: () => { throw new Error("delete must not run in these handlers"); },
    },
    withTransaction: () => { throw new Error("withTransaction must not run for a refused id"); },
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

// ── Route harness (same pattern as notesAcquiredSubResourceIdShape) ───────

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
    send(body: any) {
      resolve({ status: this.statusCode, body });
      return this;
    },
  };
  return { res, done };
}

async function call(method: string, path: string, id: string, body: unknown = {}): Promise<{ status: number; body: any }> {
  const handlers = routes.get(`${method} ${path}`);
  expect(handlers, `${method} ${path} must be registered`).toBeDefined();
  const { res, done } = mockRes();
  const req: any = { headers: {}, params: { id }, query: {}, body };
  for (const handler of handlers!) await handler(req, res, (err?: unknown) => { if (err) throw err; });
  return done;
}

beforeEach(() => {
  state.callRows = [];
  state.updateRows = [];
  state.insertRows = [];
  state.touches = 0;
  state.selectCount = 0;
  state.inserted = [];
});

const UUID = "123e4567-e89b-12d3-a456-426614174000";
const INTEGER_ID = "75";
const MALFORMED_ID = "not-a-case-id";

const CASE_ROW = { id: UUID, organizationId: 7, noteId: "223e4567-e89b-12d3-a456-426614174000", status: "open" };
const ACTION_ROW = { id: "333e4567-e89b-12d3-a456-426614174000", caseId: UUID, actionType: "outreach_call" };

const AFFECTED: Array<[string, string, unknown]> = [
  ["PATCH", "/api/loss-mit-cases/:id", { summary: "updated" }],
  ["GET", "/api/loss-mit-cases/:id/actions", {}],
  ["POST", "/api/loss-mit-cases/:id/actions", { actionType: "outreach_call" }],
];

// ── The refusal: every affected handler, both wrong shapes ────────────────

describe("LM-DEF-1 — non-UUID case ids refuse cleanly on every loss-mit handler", () => {
  for (const [method, path, body] of AFFECTED) {
    it(`${method} ${path} — an integer-style id answers 404 without reaching the database`, async () => {
      const { status, body: resBody } = await call(method, path, INTEGER_ID, body);
      expect(status).toBe(404);
      expect(resBody.error).toBe("NOT_FOUND");
      expect(state.touches).toBe(0);
    });

    it(`${method} ${path} — a malformed id answers 404 without reaching the database`, async () => {
      const { status, body: resBody } = await call(method, path, MALFORMED_ID, body);
      expect(status).toBe(404);
      expect(resBody.error).toBe("NOT_FOUND");
      expect(state.touches).toBe(0);
    });
  }

  it("PATCH /api/loss-mit-cases/:id — a malformed id 404s even with an invalid body (guard precedes the zod parse)", async () => {
    const { status, body } = await call("PATCH", "/api/loss-mit-cases/:id", MALFORMED_ID, { status: "bogus" });
    expect(status).toBe(404);
    expect(body.error).toBe("NOT_FOUND");
    expect(state.touches).toBe(0);
  });

  it("POST /api/loss-mit-cases/:id/actions — a malformed id 404s even with an invalid body (guard precedes the zod parse)", async () => {
    const { status, body } = await call("POST", "/api/loss-mit-cases/:id/actions", MALFORMED_ID, { actionType: "bogus" });
    expect(status).toBe(404);
    expect(body.error).toBe("NOT_FOUND");
    expect(state.touches).toBe(0);
  });
});

// ── The pass-through: UUID behaviour is unchanged ─────────────────────────

describe("LM-DEF-1 — UUID case ids behave exactly as before", () => {
  it("PATCH /api/loss-mit-cases/:id — a known own-org case is updated and returned", async () => {
    state.updateRows = [CASE_ROW];
    const { status, body } = await call("PATCH", "/api/loss-mit-cases/:id", UUID, { summary: "updated" });
    expect(status).toBe(200);
    expect(body.case).toEqual(CASE_ROW);
  });

  it("PATCH /api/loss-mit-cases/:id — an unknown UUID (incl. another org's) 404s through the update", async () => {
    state.updateRows = [];
    const { status, body } = await call("PATCH", "/api/loss-mit-cases/:id", UUID, { summary: "updated" });
    expect(status).toBe(404);
    expect(body.error).toBe("NOT_FOUND");
    expect(state.touches).toBe(1);
  });

  it("GET /api/loss-mit-cases/:id/actions — a known own-org case returns its action log", async () => {
    state.callRows = [[ACTION_ROW]];
    const { status, body } = await call("GET", "/api/loss-mit-cases/:id/actions", UUID);
    expect(status).toBe(200);
    expect(body.actions).toEqual([ACTION_ROW]);
  });

  it("GET /api/loss-mit-cases/:id/actions — an unknown UUID keeps the existing pass-through (200, empty log, no existence check)", async () => {
    state.callRows = [[]];
    const { status, body } = await call("GET", "/api/loss-mit-cases/:id/actions", UUID);
    expect(status).toBe(200);
    expect(body.actions).toEqual([]);
  });

  it("POST /api/loss-mit-cases/:id/actions — a known own-org case logs the action", async () => {
    state.callRows = [[{ id: UUID }]];
    state.insertRows = [ACTION_ROW];
    const { status, body } = await call("POST", "/api/loss-mit-cases/:id/actions", UUID, { actionType: "outreach_call" });
    expect(status).toBe(201);
    expect(body.action).toEqual(ACTION_ROW);
    expect(state.inserted).toHaveLength(1);
    expect((state.inserted[0] as any).caseId).toBe(UUID);
  });

  it("POST /api/loss-mit-cases/:id/actions — an unknown UUID (incl. another org's) 404s through the ownership check and never inserts", async () => {
    state.callRows = [[]];
    const { status, body } = await call("POST", "/api/loss-mit-cases/:id/actions", UUID, { actionType: "outreach_call" });
    expect(status).toBe(404);
    expect(body.error).toBe("NOT_FOUND");
    expect(state.inserted).toHaveLength(0);
  });
});
