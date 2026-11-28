/**
 * N-D-DEF-1 — the acquired-book `/api/notes/:id/…` sub-resources must never
 * 500 on a serviced (integer) id or a malformed id.
 *
 * Filed 2026-11-26 from the Note vertical's (d) onboarding ride (staging
 * org 149): GET /api/notes/75/yield, /amortization and /payments each
 * returned 500 INTERNAL_ERROR for a serviced note, while the same endpoints
 * answered 200 for an acquired UUID note in the same org/minute. Every
 * affected handler passed the raw route param into `acquiredNotes.id` (or
 * a uuid `note_id` column); Postgres throws invalid-uuid for a non-UUID
 * value and the handler's catch turned it into a 500.
 *
 * The cure is the L9-DEF-1 discipline (see payoffQuoteGetById.test.ts):
 * shape-first. Each acquired-only handler refuses a non-UUID id with the
 * family's existing 404 (Errors.notFound "Note") BEFORE any database
 * call. The database is mocked (the acquiredNotesListIsPaged pattern), so
 * the pin is the lookup itself: for a non-UUID id the route must never
 * reach the database — against a real Postgres that call IS the 500.
 * A well-formed UUID still reads through exactly as before: a known note
 * returns its 200 payload, and an unknown UUID — which is also what a
 * cross-org UUID looks like to the unchanged org-scoped lookup — 404s
 * through the lookup.
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
      insert: () => { throw new Error("insert must not run for a refused id"); },
      update: () => { throw new Error("update must not run for a refused id"); },
      delete: () => { throw new Error("delete must not run for a refused id"); },
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

// ── Route harness (same pattern as payoffQuoteGetById.test.ts) ────────────

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
  state.calls = [];
});

const UUID = "123e4567-e89b-12d3-a456-426614174000";
const SERVICED_ID = "75";
const MALFORMED_ID = "not-a-note-id";

const NOTE_ROW = {
  id: UUID,
  organizationId: 7,
  noteNumber: "N-100",
  payerName: "Borrower One",
  payerEncryptedTin: "encrypted-tin-must-not-leak",
  originalPrincipalCents: 5_000_000,
  currentBalanceCents: 4_800_000,
  acquisitionPriceCents: 4_500_000,
  interestRateBps: 900,
  paymentAmountCents: 50_000,
  termMonths: 120,
  paymentDueDay: 15,
  originationDate: "2025-01-15",
  acquisitionDate: "2025-06-01",
  maturityDate: "2035-01-15",
  nextPaymentDate: "2026-12-15",
  status: "performing",
};

// ── The refusal: every affected handler, both wrong shapes ────────────────

const AFFECTED: Array<[string, string]> = [
  ["GET", "/api/notes/:id"],
  ["PATCH", "/api/notes/:id"],
  ["PATCH", "/api/notes/acquired/:id/servicing-arrangement"],
  ["GET", "/api/notes/:id/payments"],
  ["POST", "/api/notes/:id/payments"],
  ["GET", "/api/notes/:id/reconciliation"],
  ["GET", "/api/notes/:id/basis"],
  ["GET", "/api/notes/:id/yield"],
  ["POST", "/api/notes/:id/assignments"],
  ["GET", "/api/notes/:id/assignments"],
  ["GET", "/api/notes/:id/loss-mit-case"],
  ["POST", "/api/notes/:id/loss-mit-case"],
  ["GET", "/api/notes/:id/splits"],
  ["POST", "/api/notes/:id/splits"],
  ["GET", "/api/notes/:id/amortization"],
];

describe("N-D-DEF-1 — non-UUID note ids refuse cleanly on every acquired sub-resource", () => {
  for (const [method, path] of AFFECTED) {
    it(`${method} ${path} — a serviced integer id answers 404 without reaching the database`, async () => {
      const { status, body } = await call(method, path, SERVICED_ID, { servicingArrangement: "self_serviced" });
      expect(status).toBe(404);
      expect(body.error).toBe("NOT_FOUND");
      expect(state.calls).toHaveLength(0);
    });

    it(`${method} ${path} — a malformed id answers 404 without reaching the database`, async () => {
      const { status, body } = await call(method, path, MALFORMED_ID, { servicingArrangement: "self_serviced" });
      expect(status).toBe(404);
      expect(body.error).toBe("NOT_FOUND");
      expect(state.calls).toHaveLength(0);
    });
  }
});

// ── The pass-through: UUID behaviour is unchanged ─────────────────────────

describe("N-D-DEF-1 — UUID ids behave exactly as before", () => {
  it("GET /api/notes/:id/yield — a known acquired note returns 200", async () => {
    state.callRows = [[NOTE_ROW], []];
    const { status, body } = await call("GET", "/api/notes/:id/yield", UUID);
    expect(status).toBe(200);
    expect(body.noteId).toBe(UUID);
  });

  it("GET /api/notes/:id/yield — an unknown UUID (incl. another org's) 404s through the lookup", async () => {
    state.callRows = [[]];
    const { status } = await call("GET", "/api/notes/:id/yield", UUID);
    expect(status).toBe(404);
    expect(state.calls).toHaveLength(1);
  });

  it("GET /api/notes/:id/amortization — a known acquired note returns 200 with a schedule", async () => {
    state.callRows = [[NOTE_ROW]];
    const { status, body } = await call("GET", "/api/notes/:id/amortization", UUID);
    expect(status).toBe(200);
    expect(body.noteId).toBe(UUID);
    expect(Array.isArray(body.schedule)).toBe(true);
  });

  it("GET /api/notes/:id/amortization — an unknown UUID 404s through the lookup", async () => {
    state.callRows = [[]];
    const { status } = await call("GET", "/api/notes/:id/amortization", UUID);
    expect(status).toBe(404);
    expect(state.calls).toHaveLength(1);
  });

  it("GET /api/notes/:id/payments — a known acquired note returns its ledger", async () => {
    const payment = { id: "pay-1", noteId: UUID, principalCents: 1000 };
    state.callRows = [[{ id: UUID }], [payment]];
    const { status, body } = await call("GET", "/api/notes/:id/payments", UUID);
    expect(status).toBe(200);
    expect(body.payments).toEqual([payment]);
  });

  it("GET /api/notes/:id/payments — an unknown UUID 404s through the lookup", async () => {
    state.callRows = [[]];
    const { status } = await call("GET", "/api/notes/:id/payments", UUID);
    expect(status).toBe(404);
    expect(state.calls).toHaveLength(1);
  });

  it("GET /api/notes/:id — a known acquired note returns 200 and never leaks the TIN", async () => {
    state.callRows = [[NOTE_ROW]];
    const { status, body } = await call("GET", "/api/notes/:id", UUID);
    expect(status).toBe(200);
    expect(body.note.id).toBe(UUID);
    expect(body.note.payerEncryptedTin).toBeUndefined();
  });

  it("GET /api/notes/:id/reconciliation — a known acquired note returns 200", async () => {
    state.callRows = [
      [{ id: UUID, originalPrincipalCents: 5_000_000, currentBalanceCents: 4_800_000 }],
      [{ sumOfPrincipalPostedCents: 200_000, sumOfInterestPostedCents: 0, sumOfLateFeesPostedCents: 0, sumOfEscrowPostedCents: 0 }],
      [],
    ];
    const { status, body } = await call("GET", "/api/notes/:id/reconciliation", UUID);
    expect(status).toBe(200);
    expect(body.drift).toBe(0);
  });

  it("GET /api/notes/:id/basis — a known acquired note returns 200", async () => {
    state.callRows = [[NOTE_ROW], []];
    const { status, body } = await call("GET", "/api/notes/:id/basis", UUID);
    expect(status).toBe(200);
    expect(body.noteId).toBe(UUID);
  });

  it("GET /api/notes/:id/assignments — a UUID lists its assignments", async () => {
    const row = { id: "asg-1", noteId: UUID };
    state.callRows = [[row]];
    const { status, body } = await call("GET", "/api/notes/:id/assignments", UUID);
    expect(status).toBe(200);
    expect(body.assignments).toEqual([row]);
  });

  it("GET /api/notes/:id/loss-mit-case — a UUID with no open case returns 200 with case null", async () => {
    state.callRows = [[]];
    const { status, body } = await call("GET", "/api/notes/:id/loss-mit-case", UUID);
    expect(status).toBe(200);
    expect(body.case).toBeNull();
  });

  it("GET /api/notes/:id/splits — a UUID returns its splits and totals", async () => {
    state.callRows = [[{ id: "split-1", noteId: UUID, percentageBps: 6000 }]];
    const { status, body } = await call("GET", "/api/notes/:id/splits", UUID);
    expect(status).toBe(200);
    expect(body.totalBps).toBe(6000);
    expect(body.unallocatedBps).toBe(4000);
  });
});
