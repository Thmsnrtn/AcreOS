/**
 * DEFECT-0131 — the acquired-notes list says how big the book is.
 *
 * The page asked for limit=100 with no offset and no paging control, and the
 * route returned `count: rows.length`, the size of the PAGE. A book of 250
 * notes rendered as 100 notes with nothing to say the rest existed. A status
 * filter with no matches rendered "No notes serviced yet" to an operator who
 * holds a full book.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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

async function callList(query: Record<string, string>): Promise<{ status: number; body: any }> {
  const handlers = routes.get("GET /api/notes/acquired");
  expect(handlers, "GET /api/notes/acquired must be registered").toBeDefined();
  const { res, done } = mockRes();
  const req: any = { headers: {}, params: {}, query };
  for (const handler of handlers!) await handler(req, res, (err?: unknown) => { if (err) throw err; });
  return done;
}

beforeEach(() => {
  state.callRows = [];
  state.calls = [];
});

const row = (i: number) => ({
  id: `n${i}`, organizationId: 7, noteNumber: `N-${i}`, payerName: "Payer", payerEncryptedTin: "TIN_CIPHERTEXT",
  status: "performing", currentBalanceCents: 100_00, nextPaymentDate: null, paidThroughDate: null,
  daysDelinquent: 0, delinquencyStatus: "current",
});

describe("DEFECT-0131 — the acquired book reports its total, not its page", () => {
  it("a 100-row page of a 250-note book says total 250", async () => {
    state.callRows = [Array.from({ length: 100 }, (_, i) => row(i)), [{ total: 250 }]];
    const { status, body } = await callList({ limit: "100", offset: "0" });
    expect(status).toBe(200);
    expect(body.count).toBe(100);
    expect(body.total).toBe(250);
    expect(JSON.stringify(body)).not.toContain("TIN_CIPHERTEXT");
  });

  it("the count query reads the same org-scoped table as the page", async () => {
    state.callRows = [[row(1)], [{ total: 1 }]];
    await callList({ status: "late" });
    expect(state.calls).toHaveLength(2);
    expect(state.calls[1].table).toBe(state.calls[0].table);
  });

  it("the page pages, shows the range, and does not call a filtered miss an empty book", () => {
    const src = readFileSync(resolve(__dirname, "../../client/src/pages/notes.tsx"), "utf8");
    expect(src).toMatch(/queryParams\.set\("offset"/);
    expect(src).toMatch(/Showing \{firstShown\}–\{lastShown\} of \{total\}/);
    expect(src).toMatch(/notes\.length === 0 && statusFilter !== "all"/);
  });
});
