/**
 * BD-1 — GET /api/borrower/statements/generate?format=pdf, at the route.
 *
 * The P3-4-style proof leg for the bundle-diet slice: an authenticated
 * borrower session over a paid-cycle fixture gets a real PDF whose
 * content matches the statement the portal used to render in the
 * browser, while the default (no format param) keeps answering the
 * exact JSON shape existing readers know. Auth is unchanged — no
 * session, no PDF.
 *
 * storage/db are mocked at module load (the
 * routes-borrower-periodic-statements.test.ts pattern); no DB runs.
 */
import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const NOTE_ROW = {
  id: 42,
  organizationId: 7,
  borrowerId: 9,
  originalPrincipal: "12000",
  currentBalance: "11980",
  interestRate: "10",
  termMonths: 120,
  monthlyPayment: "100",
  startDate: "2026-01-01",
  maturityDate: "2036-01-01",
  nextPaymentDate: "2026-12-01",
  autoPayEnabled: true,
};

const PAYMENTS = [
  {
    status: "completed",
    paymentDate: "2026-10-01T12:00:00.000Z",
    amount: "100",
    principalAmount: "20",
    interestAmount: "80",
    paymentMethod: "ACH",
  },
  {
    status: "completed",
    paymentDate: "2026-11-01T12:00:00.000Z",
    amount: "100",
    principalAmount: "20.5",
    interestAmount: "79.5",
    paymentMethod: "ACH",
  },
  {
    status: "pending",
    paymentDate: "2026-11-15T12:00:00.000Z",
    amount: "999",
    principalAmount: "999",
    interestAmount: "0",
    paymentMethod: "ACH",
  },
];

vi.mock("../../server/storage", () => {
  const storage = {
    getBorrowerSession: async (token: string) =>
      token === "good-session"
        ? { id: 1, noteId: 42, organizationId: 7, expiresAt: new Date(Date.now() + 3_600_000) }
        : null,
    getLead: async (_org: number, id: number) =>
      id === 9
        ? { id, firstName: "Casey", lastName: "Borrower", address: "12 Meadow Lane", email: "casey@example.com" }
        : null,
    getPayments: async () => PAYMENTS,
    getOrganization: async (id: number) => ({ id, name: "Linnea Lending LLC", settings: {} }),
  };
  const db = {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([NOTE_ROW]),
      }),
    }),
  };
  return { storage, db };
});
vi.mock("../../server/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }) },
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

import { registerBorrowerRoutes } from "../../server/routes-borrower";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req: express.Request, _res: express.Response, next: express.NextFunction) => {
    const m = /(?:^|;\s*)borrower_session=([^;]*)/.exec(String(req.headers.cookie ?? ""));
    (req as express.Request & { cookies: Record<string, string> }).cookies = m
      ? { borrower_session: decodeURIComponent(m[1]) }
      : {};
    next();
  });
  registerBorrowerRoutes(app);
  return app;
}

function pdfBodyParser(res: NodeJS.ReadableStream, callback: (err: Error | null, body?: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on("data", (c: Buffer) => chunks.push(c));
  res.on("end", () => callback(null, Buffer.concat(chunks)));
  res.on("error", (err: Error) => callback(err));
}

const asPdf = (r: request.Test) => r.buffer(true).parse(pdfBodyParser);

describe("GET /api/borrower/statements/generate (BD-1)", () => {
  it("format=pdf answers a PDF of the paid-cycle statement", async () => {
    const res = await asPdf(
      request(makeApp())
        .get("/api/borrower/statements/generate?type=statement&format=pdf")
        .set("cookie", "borrower_session=good-session"),
    );
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(res.headers["content-disposition"]).toMatch(/attachment; filename="statement_\d{4}-\d{2}-\d{2}\.pdf"/);
    const body = res.body as Buffer;
    expect(body.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const text = body.toString("latin1").replace(/\\([()\\])/g, "$1");
    expect(text).toContain("Account Statement");
    expect(text).toContain("Casey Borrower");
    expect(text).toContain("$200.00"); // two completed payments; the pending $999 is excluded
    expect(text).not.toContain("$999.00");
    expect(text).toContain("$40.50");
    expect(text).toContain("$159.50");
  });

  it("without format=pdf the same request still answers the JSON shape", async () => {
    const res = await request(makeApp())
      .get("/api/borrower/statements/generate?type=statement")
      .set("cookie", "borrower_session=good-session");
    expect(res.status).toBe(200);
    expect(res.body.type).toBe("statement");
    expect(res.body.noteId).toBe(42);
    expect(res.body.summary).toEqual({ totalPaid: 200, totalPrincipal: 40.5, totalInterest: 159.5, paymentsCount: 2 });
  });

  it("format=pdf without a session is still 401 — no PDF leaks", async () => {
    const res = await request(makeApp()).get("/api/borrower/statements/generate?type=statement&format=pdf");
    expect(res.status).toBe(401);
  });
});
