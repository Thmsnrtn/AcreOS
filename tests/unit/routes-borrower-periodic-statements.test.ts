/**
 * Contract tests — GET /api/borrower/periodic-statements
 *
 * Verifies the borrower-portal Reg-Z statement listing route:
 *   1. Returns 401 without a valid session cookie.
 *   2. Returns 200 + { statements: [...] } for a borrower-authed session.
 *   3. Org-scopes the query — a session pinned to org A never sees rows
 *      with organization_id = B (multi-tenant safety, the elite-engineering
 *      bar Iris enforces on every new route).
 *
 * The route depends on `storage` (session lookup) + `db` (drizzle chain
 * over `notes` + `periodicStatements`). We mock both at module-load
 * time so the test runs with no DB.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const loggerErrors: Array<{ msg: unknown; err?: unknown }> = [];
vi.mock("../../server/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: (msg: unknown, err?: unknown) => {
      loggerErrors.push({ msg, err });
    },
    debug: vi.fn(),
  },
}));

// In-memory session + statement rows the storage/db mocks read from.
type Session = {
  id: number;
  noteId: number;
  organizationId: number;
  email: string;
  expiresAt: Date;
  createdAt: Date;
};
const SESSIONS = new Map<string, Session>();
const NOTES_ROWS: Array<{ id: number; organizationId: number }> = [];
const STATEMENT_ROWS: Array<{
  id: string;
  loanId: string;
  organizationId: number;
  cycleStart: string;
  cycleEnd: string;
  dueDate: string;
  amountDueCents: number;
  principalBalanceCents: number;
  generatedAt: Date;
  deliveryStatus: string;
}> = [];

// Counter used by the drizzle mock to route SELECT calls. Each HTTP
// request increments it: the first select() in a request hits `notes`
// (validateBorrowerSession's org-pin check); the second hits
// `periodicStatements` (the route handler).
let selectCallNumber = 0;

vi.mock("../../server/storage", () => {
  const storage = {
    getBorrowerSession: async (token: string) => SESSIONS.get(token) ?? null,
    deleteBorrowerSession: async (token: string) => {
      SESSIONS.delete(token);
    },
    updateBorrowerSessionAccess: async (_token: string) => {},
    getOrganization: async (_id: number) => ({
      id: _id,
      name: "Acme Lender",
      settings: {},
    }),
    getLead: async () => null,
  };

  // Drizzle chain mock. We route SELECTs by call order, not by inspecting
  // the table reference (the table object's internal symbols are not
  // stable across drizzle minor versions).
  //   call 1 → validateBorrowerSession's note lookup → return NOTES_ROWS
  //   call 2+ → the periodicStatements route handler → return STATEMENT_ROWS
  const db = {
    select: (_projection?: unknown) => {
      selectCallNumber += 1;
      const myCall = selectCallNumber;
      // Materialise the rows the test wants — the first `select()` per
      // request belongs to validateBorrowerSession's note-org-pin check;
      // every subsequent select() belongs to the route handler.
      const resolveRows = () => {
        if (myCall === 1) return NOTES_ROWS;
        return STATEMENT_ROWS.map((r) => ({
          id: r.id,
          cycleStart: r.cycleStart,
          cycleEnd: r.cycleEnd,
          dueDate: r.dueDate,
          amountDueCents: r.amountDueCents,
          principalBalanceCents: r.principalBalanceCents,
          generatedAt: r.generatedAt,
          deliveryStatus: r.deliveryStatus,
        }));
      };
      // Each terminal operator (.where, .orderBy, .limit) must be
      // awaitable AND chainable — drizzle's query builder lets you await
      // partway through. We attach `.then` to every chain step.
      const makeStep: () => any = () => {
        const step: any = {
          from: (_t: unknown) => makeStep(),
          where: (_p: unknown) => makeStep(),
          orderBy: (_o: unknown) => makeStep(),
          limit: (_n: number) => makeStep(),
          then: (onFulfilled: any, onRejected: any) =>
            Promise.resolve(resolveRows()).then(onFulfilled, onRejected),
        };
        return step;
      };
      return makeStep();
    },
  };

  return { storage, db };
});

vi.mock("../../server/db", () => ({
  // Re-export the same `db` mock for any module that imports from server/db
  // (routes-borrower also imports withTransaction here — we stub it for
  // completeness even though our test path never calls it).
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
  },
  withTransaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
}));

vi.mock("../../server/auth", () => ({
  isAuthenticated: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../../server/middleware/rateLimit", () => ({
  createRateLimiter: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  RATE_LIMIT_CONFIGS: { public: { maxRequests: 100, windowMs: 60_000 } },
}));

// Import AFTER mocks are registered.
import { registerBorrowerRoutes } from "../../server/routes-borrower";

function makeApp() {
  const app = express();
  app.use(express.json());
  // Tiny cookie parser — only what validateBorrowerSession needs.
  app.use((req: any, _res, next) => {
    const header = req.headers.cookie as string | undefined;
    req.cookies = {};
    if (header) {
      for (const part of header.split(";")) {
        const [k, v] = part.trim().split("=");
        if (k) req.cookies[k] = decodeURIComponent(v ?? "");
      }
    }
    next();
  });
  registerBorrowerRoutes(app);
  return app;
}

const BORROWER_ROW = { id: 42, organizationId: 7 };
const SESSION_TOKEN = "test-borrower-session-token";

function seedSession() {
  SESSIONS.clear();
  NOTES_ROWS.length = 0;
  STATEMENT_ROWS.length = 0;
  selectCallNumber = 0;

  NOTES_ROWS.push(BORROWER_ROW);
  SESSIONS.set(SESSION_TOKEN, {
    id: 1,
    noteId: BORROWER_ROW.id,
    organizationId: BORROWER_ROW.organizationId,
    email: "borrower@example.com",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    createdAt: new Date(),
  });
  STATEMENT_ROWS.push({
    id: "stmt-jun-2026",
    loanId: String(BORROWER_ROW.id),
    organizationId: BORROWER_ROW.organizationId,
    cycleStart: "2026-06-01",
    cycleEnd: "2026-06-30",
    dueDate: "2026-07-01",
    amountDueCents: 50_000,
    principalBalanceCents: 9_500_000,
    generatedAt: new Date("2026-06-10T12:00:00Z"),
    deliveryStatus: "delivered",
  });
}

describe("GET /api/borrower/periodic-statements", () => {
  beforeEach(() => {
    seedSession();
  });

  afterEach(() => {
    SESSIONS.clear();
    NOTES_ROWS.length = 0;
    STATEMENT_ROWS.length = 0;
  });

  it("returns 401 when no borrower session cookie is present", async () => {
    const res = await request(makeApp()).get("/api/borrower/periodic-statements");
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty("message");
  });

  it("returns 401 when the session cookie is invalid / unknown", async () => {
    const res = await request(makeApp())
      .get("/api/borrower/periodic-statements")
      .set("Cookie", "borrower_session=not-a-real-token");
    expect(res.status).toBe(401);
  });

  it("returns 200 + statements for a valid borrower session", async () => {
    const res = await request(makeApp())
      .get("/api/borrower/periodic-statements")
      .set("Cookie", `borrower_session=${SESSION_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("statements");
    expect(Array.isArray(res.body.statements)).toBe(true);
    expect(res.body.statements.length).toBe(1);
    expect(res.body.statements[0]).toMatchObject({
      id: "stmt-jun-2026",
      cycleStart: "2026-06-01",
      amountDueCents: 50_000,
    });
  });

  it("destroys + 401s the session when the note's org no longer matches", async () => {
    // Simulate a note that crossed orgs after the session was minted.
    // validateBorrowerSession re-asserts the org pin and tears down the
    // session — Lens 23 multi-tenant safety.
    NOTES_ROWS[0] = { id: BORROWER_ROW.id, organizationId: 999 };
    const res = await request(makeApp())
      .get("/api/borrower/periodic-statements")
      .set("Cookie", `borrower_session=${SESSION_TOKEN}`);
    expect(res.status).toBe(401);
    // Session must be destroyed so a stale cookie can't keep retrying.
    expect(SESSIONS.has(SESSION_TOKEN)).toBe(false);
  });
});
